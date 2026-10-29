/* GoVibe Mix — metronome: sample accurate lookahead scheduling on the audio clock, synthesised clicks, accents, subdivisions, swing, tap tempo and a tempo trainer. */
(() => {
  const $ = (id) => document.getElementById(id);
  const LOOK = 0.12, EVERY = 25; // seconds scheduled ahead, timer interval in ms
  let ctx = null, master = null, running = false, timer = 0, raf = 0;
  let bpm = 100, num = 4, sub = 1, swing = 0, snd = 'click', vol = 0.8;
  let acc = [3, 2, 2, 2]; // 0 silent, 1 soft, 2 normal, 3 accent
  let beat = 0, tick = 0, bar = 0, nextTime = 0, queue = [];
  const log = [];

  const NAMES = [[24, 'Larghissimo'], [40, 'Grave'], [60, 'Largo'], [66, 'Larghetto'], [76, 'Adagio'], [108, 'Andante'], [120, 'Moderato'], [156, 'Allegro'], [176, 'Vivace'], [200, 'Presto'], [999, 'Prestissimo']];
  const tempoName = (b) => NAMES.find((n) => b < n[0])[1];
  const clampBpm = (v) => Math.max(20, Math.min(300, Math.round(v) || 100));

  /* ---------- sounds ---------- */
  let noiseBuf = null;
  function noise() { if (!noiseBuf) { noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.2, ctx.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; } return noiseBuf; }
  function voice(t, level, main) { // level 0..1, main = accent or beat, otherwise subdivision
    const g = ctx.createGain(); g.connect(master);
    const amp = level * (main ? 1 : 0.6);
    if (snd === 'click' || snd === 'beep') {
      const o = ctx.createOscillator(), dur = snd === 'click' ? 0.04 : 0.09;
      o.type = 'sine'; o.frequency.value = (snd === 'click' ? (level > 0.9 ? 1800 : level > 0.6 ? 1200 : 900) : (level > 0.9 ? 1046 : level > 0.6 ? 784 : 659)) * (main ? 1 : 0.75);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(amp, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
      o.connect(g); o.start(t); o.stop(t + dur + 0.01);
    } else if (snd === 'wood') {
      const o = ctx.createOscillator(), f = ctx.createBiquadFilter();
      o.type = 'triangle'; o.frequency.setValueAtTime((level > 0.9 ? 1100 : 820) * (main ? 1 : 0.8), t); o.frequency.exponentialRampToValueAtTime(420, t + 0.05);
      f.type = 'bandpass'; f.frequency.value = 1400; f.Q.value = 1.2; o.connect(f); f.connect(g);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(amp * 1.3, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0008, t + 0.07);
      o.start(t); o.stop(t + 0.09);
    } else { // hat
      const n = ctx.createBufferSource(), f = ctx.createBiquadFilter(); n.buffer = noise(); f.type = 'highpass'; f.frequency.value = level > 0.9 ? 6500 : 8000; n.connect(f); f.connect(g);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(amp * 0.9, t + 0.001); g.gain.exponentialRampToValueAtTime(0.0008, t + (level > 0.9 ? 0.09 : 0.04));
      n.start(t); n.stop(t + 0.12);
    }
  }

  /* ---------- scheduler ---------- */
  const LEVEL = [0, 0.35, 0.7, 1];
  function tickOffset(k) { // position of subdivision k inside the beat, as a fraction
    if (sub === 2 && k === 1) return 0.5 + swing / 2;
    return k / sub;
  }
  function schedule() {
    const beatSecs = 60 / bpm;
    while (nextTime < ctx.currentTime + LOOK) {
      const lv = acc[beat] ?? 2, t = nextTime + tickOffset(tick) * beatSecs;
      if (tick === 0) { if (lv > 0) voice(t, LEVEL[lv], true); }
      else if (acc[beat] !== 0) voice(t, 0.5, false);
      queue.push({ t, beat, tick, bar });
      if (log.length < 4000 && window.__met) log.push({ t, beat, tick, lv, bpm });
      tick++;
      if (tick >= sub) {
        tick = 0; beat++; nextTime += beatSecs;
        if (beat >= num) { beat = 0; bar++; trainer(); }
      }
    }
  }
  function trainer() {
    if (!$('tr').checked) return;
    const every = Math.max(1, +$('trbars').value || 4), step = Math.max(1, +$('trstep').value || 4), top = clampBpm(+$('trmax').value || 140);
    if (bar % every === 0 && bar > 0 && bpm < top) { setBpm(Math.min(top, bpm + step)); $('status').textContent = 'Trainer: ' + bpm + ' BPM' + (bpm >= top ? ' (goal reached)' : ''); }
  }

  /* ---------- visuals ---------- */
  function buildDots() {
    const box = $('beats'), pick = $('beatpick'); box.innerHTML = ''; pick.innerHTML = '';
    box.setAttribute('aria-label', num + ' beats per bar');
    for (let i = 0; i < num; i++) {
      const d = document.createElement('span'); d.className = 'dot'; d.dataset.l = acc[i]; box.appendChild(d);
      const b = document.createElement('button'); b.className = 'btn bp'; b.dataset.l = acc[i]; b.textContent = String(i + 1);
      b.setAttribute('aria-label', 'Beat ' + (i + 1) + ': ' + LBL[acc[i]] + '. Press to change.');
      b.onclick = () => { acc[i] = (acc[i] + 3) % 4; /* 3 -> 2 -> 1 -> 0 -> 3 */ b.dataset.l = d.dataset.l = acc[i]; b.setAttribute('aria-label', 'Beat ' + (i + 1) + ': ' + LBL[acc[i]] + '. Press to change.'); };
      pick.appendChild(b);
    }
  }
  const LBL = ['silent', 'soft', 'normal', 'accent'];
  function frame() {
    raf = requestAnimationFrame(frame); if (!ctx) return;
    const now = ctx.currentTime; let cur = null;
    while (queue.length && queue[0].t <= now) { const q = queue.shift(); if (q.tick === 0) cur = q; }
    if (cur) { const dots = $('beats').children; for (let i = 0; i < dots.length; i++) dots[i].classList.toggle('on', i === cur.beat); }
  }

  /* ---------- controls ---------- */
  function setBpm(v) { bpm = clampBpm(v); $('bpm').value = bpm; $('bpmr').value = bpm; $('tname').textContent = tempoName(bpm); }
  function start() {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (!master) { master = ctx.createGain(); master.connect(ctx.destination); }
    master.gain.value = vol; ctx.resume();
    beat = 0; tick = 0; bar = 0; queue = []; nextTime = ctx.currentTime + 0.08; running = true;
    schedule(); timer = setInterval(schedule, EVERY);
    $('go').textContent = '■ Stop'; $('go').classList.add('rec-on'); $('status').textContent = '';
  }
  function stop() {
    running = false; clearInterval(timer); queue = [];
    $('go').textContent = '▶ Start'; $('go').classList.remove('rec-on');
    for (const d of $('beats').children) d.classList.remove('on');
  }
  const toggle = () => (running ? stop() : start());

  const remember = () => { if (window.GVSession) GVSession.set({ bpm }); };
  let taps = [];
  function tap() {
    const now = performance.now(); if (taps.length && now - taps[taps.length - 1] > 2000) taps = [];
    taps.push(now); if (taps.length > 8) taps.shift();
    if (taps.length >= 2) { const iv = (taps[taps.length - 1] - taps[0]) / (taps.length - 1); setBpm(60000 / iv); remember(); $('status').textContent = 'Tap ' + taps.length + ' times or more for a steadier reading.'; }
    else $('status').textContent = 'Keep tapping on the beat.';
  }

  $('go').onclick = toggle; $('tap').onclick = tap;
  $('dn').onclick = () => { setBpm(bpm - 1); remember(); }; $('up').onclick = () => { setBpm(bpm + 1); remember(); }; $('bpmr').addEventListener('change', remember);
  $('bpmr').oninput = () => setBpm(+$('bpmr').value);
  $('bpm').onchange = () => setBpm(+$('bpm').value);
  for (let i = 1; i <= 12; i++) { const o = document.createElement('option'); o.value = i; o.textContent = i; $('num').appendChild(o); } $('num').value = 4;
  $('num').onchange = () => { const n = +$('num').value, old = acc.slice(); num = n; acc = Array.from({ length: n }, (_, i) => (i < old.length ? old[i] : 2)); acc[0] = old[0] ?? 3; if (beat >= num) beat = 0; buildDots(); };
  $('sub').onchange = () => { sub = +$('sub').value; tick = 0; };
  $('swing').onchange = () => { swing = +$('swing').value; };
  $('snd').onchange = () => { snd = $('snd').value; };
  $('vol').oninput = () => { vol = +$('vol').value / 100; if (master) master.gain.value = vol; };
  document.addEventListener('keydown', (e) => {
    const t = e.target, tag = t && t.tagName;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === ' ' && !(tag === 'BUTTON' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'A')) { e.preventDefault(); toggle(); }
    else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !(tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA')) { e.preventDefault(); setBpm(bpm + (e.key === 'ArrowUp' ? 1 : -1)); }
  });
  window.addEventListener('pagehide', stop);

  buildDots(); setBpm(100); frame(); if (window.GVSession) GVSession.bind({ bpm: $('bpm') });
  if (/[?&]gvtest\b/.test(location.search)) window.__met = { log, get running() { return running; }, get bpm() { return bpm; }, tempoName, get acc() { return acc; }, get bar() { return bar; } };
})();
