/* Go Vibe Studios — track queue + Automix (tempo match, bass swap, crossfade) */
(() => {
  const A = window.GVAudio; if (!A) return;
  const { ctx, decks, detectBPM, detectGrid, detectKey, applyXf, fmt } = A, $ = (id) => document.getElementById(id);
  const say = (t) => { $('amstatus').textContent = t; };
  const queue = [];                       // { name, buf, bpm, key }
  const S = { on: false, idx: -1, active: 0, tr: null, timer: 0 };   // idx = queue index playing on deck S.active
  const smooth = (x, a, b) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const xf = $('xf');

  function paint() {
    const ol = $('amlist'); ol.innerHTML = '';
    queue.forEach((q, i) => {
      const li = document.createElement('li'); if (S.on && i === S.idx) li.className = 'now';
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = (i + 1) + '. ' + q.name;
      const meta = document.createElement('span'); meta.className = 'meta'; meta.textContent = (q.bpm ? q.bpm.toFixed(0) + ' BPM' : '— BPM') + (q.key ? ' · ' + q.key : '');
      const rm = document.createElement('button'); rm.className = 'btn'; rm.textContent = '✕'; rm.setAttribute('aria-label', 'Remove ' + q.name);
      rm.onclick = () => { if (S.on) return say('Stop Automix before removing tracks.'); queue.splice(i, 1); paint(); };
      li.append(nm, meta, rm); ol.appendChild(li);
    });
    if (!queue.length) { const li = document.createElement('li'); li.textContent = 'No tracks yet.'; ol.appendChild(li); }
  }
  paint();

  async function addBuffer(buf, name) { const b0 = detectBPM(buf), grid = b0 ? detectGrid(buf, b0) : null; queue.push({ name, buf, bpm: grid ? grid.bpm : b0, key: detectKey(buf), grid }); paint(); }
  $('amadd').onclick = () => $('amfile').click();
  $('amfile').onchange = async () => {
    const files = [...$('amfile').files]; $('amfile').value = '';
    for (const f of files) {
      try { say('Analysing ' + f.name + '…'); await addBuffer(await ctx.decodeAudioData(await f.arrayBuffer()), f.name); }
      catch (_) { say('Could not read ' + f.name + '.'); }
    }
    say(queue.length + ' track' + (queue.length === 1 ? '' : 's') + ' in the queue.');
  };
  $('amclear').onclick = () => { stop(); queue.length = 0; paint(); say('Queue cleared.'); };

  /* ---------- playback control ---------- */
  function load(deckIdx, qi, matchTo) {
    const d = decks[deckIdx], q = queue[qi];
    d.setBuffer(q.buf, q.name, { bpm: q.bpm, key: q.key, grid: q.grid });
    d.el.low.value = 0; d.low.gain.value = 0;
    let pct = 0;
    if (matchTo && matchTo.liveBpm && q.bpm) { const p = (matchTo.liveBpm / q.bpm - 1) * 100; if (Math.abs(p) <= 8) pct = +p.toFixed(1); }
    d.el.tempo.value = pct; d.setTempoPct(pct);
  }
  function start() {
    if (!queue.length) return say('Add some tracks first.');
    ctx.resume(); S.on = true; S.idx = 0; S.active = 0; S.tr = null;
    decks.forEach((d) => d.pause());
    load(0, 0, null); xf.value = 0; applyXf(); decks[0].seek(0); decks[0].play();
    $('amgo').textContent = '■ Stop Automix'; paint(); say('Playing "' + queue[0].name + '".');
    clearInterval(S.timer); S.timer = setInterval(tick, 200);
  }
  function stop() {
    clearInterval(S.timer); S.on = false; S.tr = null; $('amgo').textContent = '▶ Start Automix';
    decks.forEach((d) => { d.low.gain.value = 0; d.el.low.value = 0; }); paint();
  }
  $('amgo').onclick = () => (S.on ? (stop(), say('Automix stopped. The decks keep their current state.')) : start());

  function beginTransition(len) {
    const out = decks[S.active], inc = decks[1 - S.active], ni = S.idx + 1;
    load(1 - S.active, ni, out);
    let s0 = 0; if (out.grid && inc.grid) s0 = inc.grid.t0 + out.beatFrac() * inc.grid.period;   // start on the same point in the beat
    inc.seek(s0); inc.play();
    S.tr = { t0: ctx.currentTime, len, from: S.active, to: 1 - S.active, ni };
    say('Mixing into "' + queue[ni].name + '"…');
  }
  function stepTransition() {
    const T = S.tr, p = Math.min(1, (ctx.currentTime - T.t0) / T.len), out = decks[T.from], inc = decks[T.to];
    const x = T.to === 1 ? p : 1 - p;
    xf.value = Math.round(x * 100); applyXf();
    const outLow = -26 * smooth(p, 0.35, 0.7), inLow = -26 * (1 - smooth(p, 0.1, 0.5));
    out.low.gain.value = outLow; out.el.low.value = outLow; inc.low.gain.value = inLow; inc.el.low.value = inLow;
    if (p >= 1) {
      out.pause(); out.low.gain.value = 0; out.el.low.value = 0; inc.low.gain.value = 0; inc.el.low.value = 0;
      S.active = T.to; S.idx = T.ni; S.tr = null; paint(); say('Playing "' + queue[S.idx].name + '".');
    }
  }
  function tick() {
    if (!S.on) return;
    if (S.tr) return stepTransition();
    const d = decks[S.active], rem = d.buf.duration - d.position() * 1;
    const remReal = rem / d.rate;
    if (S.idx + 1 >= queue.length) { if (!d.playing && d.position() < 0.1) { stop(); say('Automix finished.'); } return; }
    const want = +$('amlen').value, len = Math.max(2, Math.min(want, remReal - 0.5, queue[S.idx + 1].buf.duration * 0.5));
    if (remReal <= len + 0.6 || !d.playing) beginTransition(len);
  }
  $('amskip').onclick = () => {
    if (!S.on) return say('Start Automix first.');
    if (S.tr || S.idx + 1 >= queue.length) return;
    beginTransition(Math.min(+$('amlen').value, 8, queue[S.idx + 1].buf.duration * 0.5));
  };

  if (/[?&]gvtest\b/.test(location.search)) window.__am = { queue, S, addBuffer };   // test hook
})();
