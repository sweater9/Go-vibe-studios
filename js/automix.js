/* GoVibe Mix — track queue + Automix (tempo match, bass swap, crossfade) */
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
      const meta = document.createElement('span'); meta.className = 'meta'; meta.textContent = (q.bpm ? q.bpm.toFixed(0) + ' BPM' : '— BPM') + (q.key ? ' · ' + q.key : '') + (q.map && q.map.grid && q.map.drop != null ? ' · drop ' + fmt(q.map.drop) : '') + (q.map && q.map.grid ? ' · outro ' + fmt(q.map.outro) : '');
      const rm = document.createElement('button'); rm.className = 'btn'; rm.textContent = '✕'; rm.setAttribute('aria-label', 'Remove ' + q.name);
      rm.onclick = () => { if (S.on) return say('Stop Automix before removing tracks.'); queue.splice(i, 1); paint(); };
      li.append(nm, meta, rm); ol.appendChild(li);
    });
    if (!queue.length) { const li = document.createElement('li'); li.textContent = 'No tracks yet.'; ol.appendChild(li); }
  }
  paint();

  async function addBuffer(buf, name, pre) {
    if (pre) queue.push({ name, buf, bpm: pre.bpm, key: pre.key, grid: pre.grid ? { ...pre.grid } : null, id: pre.id });
    else { const b0 = detectBPM(buf), grid = b0 ? detectGrid(buf, b0) : null; queue.push({ name, buf, bpm: grid ? grid.bpm : b0, key: detectKey(buf), grid }); }
    mapOf(queue[queue.length - 1]); paint();
  }
  A.queueAdd = (buf, name, pre) => { addBuffer(buf, name, pre); say(queue.length + ' track' + (queue.length === 1 ? '' : 's') + ' in the queue.'); };
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

  /* ---------- pick tracks from the library by itself ---------- */
  const auto = () => !!$('amauto') && $('amauto').checked, used = new Set(); let fetching = false, failed = false;
  try { if (localStorage.getItem('govibe.amauto') === '1') $('amauto').checked = true; } catch (_) { /* no storage */ }
  ['amint', 'amstyle', 'amshape', 'amplay'].forEach((id) => { try { const v = localStorage.getItem('govibe.' + id); if (v && $(id) && [...$(id).options].some((o) => o.value === v)) $(id).value = v; } catch (_) { /* no storage */ } if ($(id)) $(id).addEventListener('change', () => { try { localStorage.setItem('govibe.' + id, $(id).value); } catch (_) { /* ignore */ } }); });
  try { if (localStorage.getItem('govibe.amlive') === '0' && $('amlive')) $('amlive').checked = false; } catch (_) { /* no storage */ }
  if ($('amlive')) $('amlive').onchange = () => { try { localStorage.setItem('govibe.amlive', $('amlive').checked ? '1' : '0'); } catch (_) { /* ignore */ } };
  $('amauto').onchange = () => { try { localStorage.setItem('govibe.amauto', auto() ? '1' : '0'); } catch (_) { /* ignore */ } };
  async function pickFrom(cur, opt) {
    const recs = A.libRecs ? A.libRecs() : []; queue.forEach((q) => { if (q.id) used.add(q.id); });
    const sh = GVMixPlan.shape($('amshape') ? $('amshape').value : 'steady', queue.length), o2 = { used, drift: sh.drift, lift: sh.lift, ...opt };
    let i = GVMixPlan.pickNext(cur, recs, o2); if (i < 0 && recs.length > 1) { used.clear(); queue.slice(-1).forEach((q) => { if (q.id) used.add(q.id); }); i = GVMixPlan.pickNext(cur, recs, o2); }
    if (i < 0) return null; const f = await A.libFetch(recs[i]); used.add(f.pre.id);
    return { name: f.name, buf: f.buf, bpm: f.pre.bpm, key: f.pre.key, grid: f.pre.grid, id: f.pre.id };
  }
  async function autoPick(cur) {
    if (fetching || failed) return; fetching = true;
    try { const q = await pickFrom(cur); if (!S.on) return; if (!q) { failed = true; return say('Your library has no other tracks to pick from. Add more tracks in the Library tab.'); } queue.push(q); mapOf(q); queue.forEach((x, i) => { if (i < S.idx - 1) x.buf = null; }); paint(); say('Next up, picked from your library: "' + q.name + '"' + (cur && cur.bpm && q.bpm ? ' (' + (q.bpm - cur.bpm >= 0 ? '+' : '') + (q.bpm - cur.bpm).toFixed(0) + ' BPM' + (q.key ? ', ' + q.key : '') + ')' : '') + '.'); }
    catch (_) { failed = true; say('Could not load the next track from the library.'); } finally { fetching = false; }
  }
  async function seedFromLibrary() {
    if ((A.libRecs ? A.libRecs() : []).length < 2) { say('Add at least two tracks to your library first (Library tab), then Automix can choose by itself.'); return false; }
    say('Choosing the first track…'); try { const q = await pickFrom(null, { variety: 1.5 }); if (!q) return false; queue.push(q); paint(); return true; } catch (_) { say('Could not load a track from the library.'); return false; }
  }

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
    for (let i = queue.length - 1; i >= 0; i--) if (!queue[i].buf) queue.splice(i, 1);
    failed = false; used.clear(); if (!queue.length) return say('Add some tracks first.');
    ctx.resume(); S.on = true; S.idx = 0; S.active = 0; S.tr = null; S.plan = null; S.last = null; S.ramp = null; S.inAt = 0;
    decks.forEach((d) => d.pause());
    load(0, 0, null); xf.value = 0; applyXf(); decks[0].seek(0); decks[0].play();
    $('amgo').textContent = '■ Stop Automix'; paint(); say('Playing "' + queue[0].name + '".');
    clearInterval(S.timer); S.timer = setInterval(tick, 40);
  }
  function stop() {
    clearInterval(S.timer); const was = S.tr; S.on = false; S.tr = null; S.plan = null; $('amgo').textContent = '▶ Start Automix'; killFx(); cancelMove(); showProg('', 0);
    decks.forEach((d) => { d.low.gain.value = 0; d.el.low.value = 0; if (was) { d.pre.gain.cancelScheduledValues(0); d.pre.gain.value = 1; if (d.loop) { d.loop = null; d.eachSrc((x) => (x.loop = false)); } } }); paint();
  }
  $('amgo').onclick = async () => { if (S.on) { stop(); return say('Automix stopped. The decks keep their current state.'); } if (!queue.length && auto() && !(await seedFromLibrary())) return; start(); };

  /* ---------- smart transitions: track maps, a style for each pair, builds and drops ---------- */
  const smart = () => !!$('amsmart') && $('amsmart').checked, style = () => ($('amstyle') ? $('amstyle').value : 'blend'), intensity = () => ($('amint') ? $('amint').value : 'club');
  const mapOf = (q) => q.map || (q.map = window.GVTrackMap ? GVTrackMap.analyze(q.buf, q.grid) : { grid: false, dur: q.buf.duration, drop: null, outro: q.buf.duration - 30, inE: 0.5, outE: 0.5 });
  const NAMES = { blend: 'a bass swap blend', sweep: 'a filter sweep', echo: 'an echo out', cut: 'a quick cut', wash: 'a reverb wash', gate: 'a tremolo gate', riser: 'a riser into the drop', banger: 'a loop build and drop', brake: 'a spin down and drop' };
  const BEATS = { blend: 32, sweep: 32, wash: 24, gate: 16, echo: 16, cut: 2 }, BUILD = { riser: 8, banger: 8, brake: 4 };
  /* the latest 16 beat phrase start (in the track's own seconds) from which a transition of len seconds still finishes before the track ends */
  function phraseStart(d, len, late) {
    if (!d.grid || !d.buf) return null; const p = d.grid.period, ph = 16 * p, lenSrc = len * (d.rate || 1), k = Math.floor((d.buf.duration - 0.7 - lenSrc - d.grid.t0) / ph);
    if (k < 1) return null; const b = d.grid.t0 + k * ph; return b < d.position() - (late == null ? 0.05 : late) ? null : b;
  }
  const resetFx = (d) => {
    d.el.filt.value = 0; d.setFilter(0); d.el.echo.value = 0; d.echoWet.gain.value = 0; d.el.rev.value = 0; d.revWet.gain.value = 0;
    d.pre.gain.cancelScheduledValues(0); d.pre.gain.value = 1; if (d.loop) { d.loop = null; d.eachSrc((x) => (x.loop = false)); }
  };
  const curve = (st, p) => (st === 'cut' ? smooth(p, 0.45, 0.55) : st === 'echo' ? smooth(p, 0.25, 0.6) : p);

  /* synthesised risers and impacts (nothing is loaded from anywhere) */
  const nodes = new Set();
  function riser(t, dur) {
    const n = A.noise(dur + 0.3), f = ctx.createBiquadFilter(), g = ctx.createGain(), o = ctx.createOscillator(), og = ctx.createGain();
    f.type = 'bandpass'; f.Q.value = 2.2; f.frequency.setValueAtTime(250, t); f.frequency.exponentialRampToValueAtTime(9000, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.32, t + dur * 0.96); g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.05);
    o.type = 'sawtooth'; o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(1760, t + dur); og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.08, t + dur * 0.96); og.gain.linearRampToValueAtTime(0.0001, t + dur + 0.05);
    n.connect(f); f.connect(g); g.connect(A.master); o.connect(og); og.connect(A.master); n.start(t); n.stop(t + dur + 0.1); o.start(t); o.stop(t + dur + 0.1);
    [n, o].forEach((x) => { nodes.add(x); x.onended = () => nodes.delete(x); });
  }
  function impact(t) {
    const o = ctx.createOscillator(), g = ctx.createGain(), n = A.noise(0.3), f = ctx.createBiquadFilter(), ng = ctx.createGain();
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.32); g.gain.setValueAtTime(0.85, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    f.type = 'lowpass'; f.frequency.value = 3500; ng.gain.setValueAtTime(0.3, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    o.connect(g); g.connect(A.master); n.connect(f); f.connect(ng); ng.connect(A.master); o.start(t); o.stop(t + 0.8); n.start(t); n.stop(t + 0.3); crash(t);
    [n, o].forEach((x) => { nodes.add(x); x.onended = () => nodes.delete(x); });
  }
  function snareRoll(t0, tB, bs) {                    // noise hits getting faster: eighths, then sixteenths, then thirty seconds, louder as they go
    for (let t = t0, k = 0; t < tB - 0.02; k++) {
      const left = (tB - t) / bs, step = left > 2 ? bs / 2 : left > 1 ? bs / 4 : bs / 8, amp = 0.1 + 0.3 * (1 - left / ((tB - t0) / bs)), n = A.noise(0.12), f = ctx.createBiquadFilter(), g = ctx.createGain();
      f.type = 'highpass'; f.frequency.value = 1800; g.gain.setValueAtTime(amp, t); g.gain.exponentialRampToValueAtTime(0.0001, t + Math.min(0.1, step * 0.9));
      n.connect(f); f.connect(g); g.connect(A.master); n.start(t); n.stop(t + 0.12); nodes.add(n); n.onended = () => nodes.delete(n); t += step;
    }
  }
  function crash(t) {
    const n = A.noise(2), f = ctx.createBiquadFilter(), g = ctx.createGain(); f.type = 'highpass'; f.frequency.value = 5200; g.gain.setValueAtTime(0.32, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
    n.connect(f); f.connect(g); g.connect(A.master); n.start(t); n.stop(t + 2); nodes.add(n); n.onended = () => nodes.delete(n);
  }
  const killFx = () => { nodes.forEach((x) => { try { x.stop(); } catch (_) { /* done */ } }); nodes.clear(); };

  /* work out how the next transition will go: which style, where to leave the outgoing track, where to come in on the next one */
  function makePlan(mode) {                           // mode: 'auto' (wait for the right moment), 'now' (next phrase), 'skip' (immediately)
    const oq = queue[S.idx], nq = queue[S.idx + 1], out = decks[S.active]; if (!oq || !nq || !nq.buf || !out.buf) return null;
    const om = oq.grid && out.grid ? mapOf(oq) : null, im = nq.grid ? mapOf(nq) : null, grids = !!(om && im && om.grid && im.grid), lo = Math.min(oq.bpm || 1, nq.bpm || 1);
    let st = style();
    if (st === 'auto') st = GVMixPlan.chooseStyle({ grids, gap: oq.bpm && nq.bpm ? GVMixPlan.tempoGap(oq.bpm, nq.bpm) / lo : 0, kc: GVMixPlan.keyCost(oq.key, nq.key), outE: om ? om.outE : 0.5, inE: im ? im.inE : 0.5, hasDrop: !!(im && im.drop != null), dropE: im ? im.dropE : 0, intensity: intensity(), last: S.last });
    if (!grids && BUILD[st]) st = 'sweep';
    if (mode === 'skip' && BUILD[st]) st = 'blend';
    const rate = out.rate || 1, bs = grids ? out.grid.period / rate : 0.5, pre = BUILD[st] || 0, preSec = pre * bs, pos = out.position(), dur = out.buf.duration;
    let len;
    if (BUILD[st]) len = Math.max(0.8, 2 * bs);
    else {
      const am = $('amlen').value, roomy = grids && st === 'blend' && (dur - om.outro) / bs >= 32 && (im.intro - im.t0) / bs >= 32, want = am === 'auto' ? (grids ? (roomy ? 48 : BEATS[st]) * bs : 14) : +am;
      len = Math.max(2, Math.min(want, (dur - pos) / rate - 0.5, nq.buf.duration * 0.5)); if (st === 'cut') len = Math.min(len, Math.max(1, 2 * bs));
    }
    const base = S.inAt || 0, pf = $('amplay') ? $('amplay').value : 'auto', outro = om ? om.outro : dur - 30;
    let tgt = pf === 'outro' ? outro : pf === 'auto' ? Math.min(outro, base + 0.68 * (dur - base)) : base + (+pf);
    if (mode === 'auto' && tgt > dur - 1) tgt = null;
    const plan = { for: S.idx, tgt, next: nq, st, pre, preSec, len, bs, B: null, free: false, now: mode === 'now', skip: mode === 'skip', inStart: 0 };
    if (BUILD[st] && im) plan.inStart = im.drop != null ? im.drop : im.t0;
    if (mode !== 'skip' && grids && smart()) {
      const per = out.grid.period, ph = 16 * per, t0 = out.grid.t0, tail = BUILD[st] ? 3 * per : len * rate + 0.7;
      const minB = pos + preSec * rate + (mode === 'now' ? 0.4 : -0.05), kLo = Math.max(1, Math.ceil((minB - t0) / ph)), kHi = Math.floor((dur - tail - 0.3 - t0) / ph);
      if (kHi >= kLo) {
        let best = kHi; if (mode !== 'now') { let bd = Infinity; for (let k = kLo; k <= kHi; k++) { const dd = Math.abs(t0 + k * ph - (tgt == null ? om.outro : tgt)); if (dd < bd) { bd = dd; best = k; } } } else best = kLo;
        plan.B = t0 + best * ph;
      } else if (mode === 'now') {                      // too close to the end for a phrase: use the next beat
        const kb = Math.ceil((minB - t0) / per); if (t0 + kb * per + tail + 0.3 <= dur) plan.B = t0 + kb * per;
      }
      if (plan.B == null && BUILD[st]) { st = 'sweep'; plan.st = st; plan.pre = plan.preSec = 0; plan.inStart = 0; plan.len = Math.max(2, Math.min(+($('amlen').value === 'auto' ? 12 : $('amlen').value), (dur - pos) / rate - 0.5, nq.buf.duration * 0.5)); }
    } else if (BUILD[st]) plan.free = true;
    return plan;
  }

  /* loop roll on the outgoing deck: the loop always restarts at the same beat, getting shorter each time */
  function roll(T, out, beats) {
    const g = out.grid; if (!g || !out.playing || !out.buf) return;
    if (T.loopStart == null) T.loopStart = g.t0 + Math.floor((out.position() - g.t0) / g.period + 0.03) * g.period;
    if (T.loopStart + beats * g.period > out.buf.duration - 0.05) return;
    out.loop = { start: T.loopStart, end: T.loopStart + beats * g.period }; out.startPos = T.loopStart; out.startCtx = ctx.currentTime; out.play();
  }
  function drop(T, out, inc) {
    out.loop = null; if (out.playing) out.pause(); out.el.rev.value = 55; out.revWet.gain.value = Math.pow(0.55, 1.3) * 1.1;
    inc.el.low.value = 0; inc.low.gain.value = 0; inc.startPos = T.inStart; inc.play(); impact(ctx.currentTime); T.dropped = true;
  }

  /* ---------- live moves while a track plays: echo throws, filter sweeps, bass drops, gates and loop rolls, on the beat ---------- */
  const liveOn = () => !$('amlive') || $('amlive').checked;
  const MOVES = {
    echo: { beats: 4, name: 'an echo throw', step: (d, p) => { const e = Math.round(75 * (p < 0.5 ? 1 : 1 - (p - 0.5) * 2)); d.el.echo.value = e; d.echoWet.gain.value = Math.pow(e / 100, 1.3) * 0.9; } },
    sweep: { beats: 8, name: 'a filter sweep', step: (d, p) => { const v = Math.round(70 * Math.sin(Math.PI * p)); d.el.filt.value = v; d.setFilter(v); } },
    dip: { beats: 4, name: 'a low pass dip', step: (d, p) => { const v = -Math.round(80 * Math.sin(Math.PI * p)); d.el.filt.value = v; d.setFilter(v); } },
    reverb: { beats: 6, name: 'a reverb throw', step: (d, p) => { const r = Math.round(60 * (p < 0.33 ? p / 0.33 : 1 - (p - 0.33) / 0.67)); d.el.rev.value = r; d.revWet.gain.value = Math.pow(r / 100, 1.3) * 1.1; } },
    bass: { beats: 4, name: 'a bass drop out', step: (d, p) => { const v = -26 * smooth(p, 0, 0.06) * (1 - smooth(p, 0.94, 1)); d.low.gain.value = v; d.el.low.value = v; } },
    gate: { beats: 2, name: 'a stutter gate' },
    roll: { beats: 4.3, name: 'a loop roll' },
  };
  const WEIGHT = { smooth: { echo: 3, sweep: 3, dip: 2 }, club: { echo: 3, sweep: 3, dip: 2, reverb: 2, bass: 2, gate: 1 }, banger: { echo: 2, sweep: 3, dip: 2, reverb: 2, bass: 2, gate: 2, roll: 4 } }, PROB = { smooth: 0.12, club: 0.3, banger: 0.5 };
  function cancelMove() {
    const m = S.mv; if (!m) return; S.mv = null; const d = m.d;
    d.el.filt.value = 0; d.setFilter(0); d.el.echo.value = 0; d.echoWet.gain.value = 0; d.el.rev.value = 0; d.revWet.gain.value = 0; d.low.gain.value = 0; d.el.low.value = 0;
    d.pre.gain.cancelScheduledValues(0); d.pre.gain.value = 1; if (d.slip) d.rollEnd();
  }
  function startMove(d, key) {
    cancelMove(); const M = MOVES[key], bs = d.grid.period / (d.rate || 1), now = ctx.currentTime, m = S.mv = { key, d, t0: now, dur: M.beats * bs, ev: [], bs }; S.moves = (S.moves || 0) + 1; S.mvLast = key;
    if (key === 'gate') { const g = d.pre.gain, step = bs / 4, N = Math.round(2 * bs / step); g.cancelScheduledValues(now); for (let k = 0; k < N; k++) { const t = now + k * step; g.setValueAtTime(1, t); g.setValueAtTime(0.12, t + step / 2); } g.setValueAtTime(1, now + N * step); }
    if (key === 'roll') m.ev.push({ at: now, fn: () => d.rollStart(1) }, { at: now + 2 * bs, fn: () => d.rollStart(0.5) }, { at: now + 3 * bs, fn: () => d.rollStart(0.25) }, { at: now + 4 * bs, fn: () => d.rollEnd() });
    say('Live move: ' + M.name + '.');
  }
  function stepMove() {
    const m = S.mv, now = ctx.currentTime; while (m.ev.length && m.ev[0].at <= now + 0.02) m.ev.shift().fn();
    const p = (now - m.t0) / m.dur; if (p >= 1) return cancelMove(); const M = MOVES[m.key]; if (M.step) M.step(m.d, p);
  }
  function liveStep(d, plan) {
    if (S.mv) return stepMove();
    if (!liveOn() || !d.playing || !d.grid || !d.buf) return;
    const g = d.grid, rate = d.rate || 1, bs = g.period / rate, pos = d.position(), x = (pos - g.t0) / g.period, bi = Math.floor(x + 0.02);
    if (bi < 16 || bi % 8 !== 0 || bi === S.mvBeat) return; S.mvBeat = bi; if (x - bi > 0.3) return;
    const left = plan && plan.B != null ? (plan.B - plan.preSec * rate - pos) / rate : plan && plan.tgt != null ? (plan.tgt - pos) / rate : (d.buf.duration - pos) / rate - 20;
    if (left < 14 * bs) return;
    const lvl = intensity(), w = WEIGHT[lvl] || WEIGHT.club; if (Math.random() > (S.mvProb != null ? S.mvProb : /[?&]gvtest\b/.test(location.search) ? 0 : PROB[lvl] || 0.3)) return;
    const keys = Object.keys(w), tot = keys.reduce((a, k) => a + w[k] * (k === S.mvLast ? 0.2 : 1), 0); let r = Math.random() * tot, pick = keys[0];
    for (const k of keys) { r -= w[k] * (k === S.mvLast ? 0.2 : 1); if (r <= 0) { pick = k; break; } }
    startMove(d, pick);
  }

  function beginTransition(plan) {
    cancelMove();
    const out = decks[S.active], inc = decks[1 - S.active], ni = S.idx + 1, st = plan.st, now = ctx.currentTime;
    load(1 - S.active, ni, out);
    const T = { t0: now, len: plan.len, from: S.active, to: 1 - S.active, ni, st, ev: [], bs: plan.bs, pre: plan.preSec };
    if (BUILD[st]) {
      const toB = plan.B != null ? Math.max(0.05, (plan.B - out.position()) / (out.rate || 1)) : plan.preSec;
      T.tB = now + toB; T.t0 = T.tB; T.build = true; T.inStart = plan.inStart; T.inAt = plan.inStart; T.preSec = Math.min(plan.preSec, toB);
      if (st !== 'brake') { riser(now, toB); snareRoll(now + Math.max(0, toB - 4 * plan.bs), T.tB - 0.35 * plan.bs, plan.bs); }
      T.ev.push({ at: T.tB, fn: () => drop(T, out, inc) });
      if (st === 'banger') [[4, 2], [2, 1], [1, 0.5], [0.5, 0.25]].forEach(([before, len]) => { if (before * plan.bs <= toB) T.ev.push({ at: T.tB - before * plan.bs, fn: () => roll(T, out, len) }); });
      if (st !== 'brake' && 0.35 * plan.bs < toB) T.ev.push({ at: T.tB - 0.35 * plan.bs, fn: () => { out.loop = null; out.pause(); } });   // a breath of near silence before the drop
      if (st === 'brake') T.brake = Math.min(toB, 1.6 * plan.bs);
      T.ev.sort((a, b) => a.at - b.at);
    } else {
      let s0 = 0; if (out.grid && inc.grid) s0 = inc.grid.t0 + out.beatFrac() * inc.grid.period;   // start on the same point in the beat
      inc.seek(s0); inc.play(); T.inAt = s0;
      if (st === 'gate') {                                                // a volume gate chopping the outgoing track, getting deeper
        const g = out.pre.gain, step = plan.bs / 2, N = Math.floor(T.len / step); g.cancelScheduledValues(now);
        for (let k = 0; k < N; k++) { const t = now + k * step; g.setValueAtTime(1, t); g.setValueAtTime(Math.max(0.08, 1 - 0.95 * (k / N)), t + step / 2); }
        g.setValueAtTime(1, now + T.len + 0.05);
      }
    }
    S.tr = T; S.last = st; S.plan = null; S.ramp = null;
    say('Mixing into "' + queue[ni].name + '" with ' + NAMES[st] + (BUILD[st] ? ' (dropping on its ' + (plan.inStart > 1 ? 'drop' : 'first beat') + ')' : '') + '…');
  }
  function endTransition(T, out, inc) {
    out.pause(); resetFx(inc); const quiet = T.build || T.st === 'echo' || T.st === 'wash';
    setTimeout(() => resetFx(out), quiet ? 2500 : 0);
    [out, inc].forEach((d) => { d.low.gain.value = 0; d.el.low.value = 0; d.mid.gain.value = 0; d.el.mid.value = 0; d.high.gain.value = 0; d.el.high.value = 0; });
    const pct = +inc.el.tempo.value; S.ramp = Math.abs(pct) > 0.3 && T.bs ? { deck: inc, from: pct, t0: ctx.currentTime, dur: Math.max(4, 16 * T.bs) } : null;   // ease the new track back to its own tempo
    S.active = T.to; S.idx = T.ni; S.tr = null; S.inAt = T.inAt || 0; paint(); say('Playing "' + queue[S.idx].name + '".');
  }
  function stepBuild(T, now, out, inc) {
    if (now < T.tB) {                                                      // the build: filter rising, echo and bass cut, loops rolling
      const pb = Math.min(1, Math.max(0, 1 - (T.tB - now) / T.preSec)), hp = Math.round(65 * smooth(pb, 0, 1)), e = Math.round(70 * smooth(pb, 0.45, 1)), lw = -26 * smooth(pb, 0.55, 0.8);
      if (T.brake && now > T.tB - T.brake) { const q = (now - (T.tB - T.brake)) / T.brake; out.el.tempo.value = -Math.round(96 * q * q); out.setTempoPct(-96 * q * q); }
      out.el.filt.value = hp; out.setFilter(hp); out.el.echo.value = e; out.echoWet.gain.value = Math.pow(e / 100, 1.3) * 0.9; out.low.gain.value = lw; out.el.low.value = lw; return;
    }
    if (!T.dropped) drop(T, out, inc);
    const p = Math.min(1, (now - T.tB) / T.len), x = smooth(p, 0, 0.85); xf.value = Math.round((T.to === 1 ? x : 1 - x) * 100); applyXf();
    out.el.echo.value = 100; out.echoWet.gain.value = 0.9;
    if (p >= 1) endTransition(T, out, inc);
  }
  function stepTransition() {
    const T = S.tr, now = ctx.currentTime, out = decks[T.from], inc = decks[T.to];
    while (T.ev.length && T.ev[0].at <= now + 0.02) T.ev.shift().fn();
    if (T.build) return stepBuild(T, now, out, inc);
    const p = Math.min(1, (now - T.t0) / T.len), pc = curve(T.st, p), x = T.to === 1 ? pc : 1 - pc;
    xf.value = Math.round(x * 100); applyXf();
    const outLow = -26 * smooth(p, 0.35, 0.7), inLow = -26 * (1 - smooth(p, 0.1, 0.5));
    if (T.st === 'sweep') { const fo = Math.round(100 * smooth(p, 0.1, 0.9)), fi = -Math.round(100 * (1 - smooth(p, 0, 0.7))); out.el.filt.value = fo; out.setFilter(fo); inc.el.filt.value = fi; inc.setFilter(fi); }
    else if (T.st === 'echo') { const e = Math.round(85 * smooth(p, 0.05, 0.3)); out.el.echo.value = e; out.echoWet.gain.value = Math.pow(e / 100, 1.3) * 0.9; }
    else if (T.st === 'wash') {
      const r = Math.round(90 * smooth(p, 0.05, 0.5)), lpv = -Math.round(85 * smooth(p, 0.15, 0.95)); out.el.rev.value = r; out.revWet.gain.value = Math.pow(r / 100, 1.3) * 1.1; out.el.filt.value = lpv; out.setFilter(lpv);
      const fi = -Math.round(60 * (1 - smooth(p, 0, 0.6))); inc.el.filt.value = fi; inc.setFilter(fi);
    }
    out.low.gain.value = outLow; out.el.low.value = outLow; inc.low.gain.value = inLow; inc.el.low.value = inLow;
    if (T.st === 'blend' || T.st === 'gate') { const oh = -16 * smooth(p, 0.5, 0.95), om = -8 * smooth(p, 0.6, 0.95), ih = -14 * (1 - smooth(p, 0.05, 0.45)); out.high.gain.value = oh; out.el.high.value = oh; out.mid.gain.value = om; out.el.mid.value = om; inc.high.gain.value = ih; inc.el.high.value = ih; }
    if (p >= 1) endTransition(T, out, inc);
  }
  let lastTxt = '';
  function showProg(txt, pct) { const el = $('amcount'), pr = $('amprog'); if (el && txt !== lastTxt) { el.textContent = txt; lastTxt = txt; } if (pr) pr.value = pct; }
  function tick() {
    if (!S.on) return showProg('', 0);
    if (S.tr) { const T = S.tr, now = ctx.currentTime, tot = (T.build ? T.preSec : 0) + T.len, el = now - (T.build ? T.tB - T.preSec : T.t0); showProg('Mixing into "' + queue[T.ni].name + '" · ' + NAMES[T.st] + ' · ' + Math.max(0, Math.min(100, Math.round(100 * el / tot))) + '%', Math.max(0, Math.min(100, 100 * el / tot))); return stepTransition(); }
    if (S.ramp) { const R = S.ramp, p = Math.min(1, (ctx.currentTime - R.t0) / R.dur), v = +(R.from * (1 - smooth(p, 0, 1))).toFixed(2); R.deck.el.tempo.value = v; R.deck.setTempoPct(v); if (p >= 1) { S.ramp = null; S.plan = null; } }
    const d = decks[S.active], rem = d.buf.duration - d.position() * 1;
    const remReal = rem / d.rate;
    if (S.idx + 1 >= queue.length && auto() && !failed) { autoPick(queue[queue.length - 1]); return; }
    if (S.idx + 1 >= queue.length) { if (!d.playing && d.position() < 0.1) { stop(); say('Automix finished.'); } return; }
    let plan = S.plan; if (!plan || plan.for !== S.idx || plan.next !== queue[S.idx + 1]) { plan = S.plan = makePlan('auto'); if (plan) say('Next: ' + NAMES[plan.st] + ' into "' + queue[S.idx + 1].name + '".'); }
    if (!plan) return;
    liveStep(d, plan);
    { const pos0 = d.position(), left = plan.B != null ? (plan.B - plan.preSec * (d.rate || 1) - pos0) / (d.rate || 1) : plan.tgt != null ? (plan.tgt - pos0) / (d.rate || 1) : remReal - plan.len; showProg('Now playing "' + queue[S.idx].name + '" · next mix in ' + fmt(Math.max(0, left)) + ' (' + NAMES[plan.st] + ')', 0); }
    if (plan.B != null && d.playing && d.grid) {
      const at = plan.B - plan.preSec * (d.rate || 1), pos = d.position();
      if (pos > plan.B + 3 && !plan.now) { S.plan = null; return; }                                  // jumped past it: plan again
      if (pos >= at - 0.05) beginTransition(plan);
      return;
    }
    if (plan.now && plan.B == null && !BUILD[plan.st]) return beginTransition(plan);
    if (plan.B == null && plan.tgt != null && !plan.free && d.playing && d.position() >= plan.tgt && !BUILD[plan.st]) return beginTransition(plan);
    const need = BUILD[plan.st] ? plan.preSec + 3 * plan.bs + 0.8 : plan.len + 0.6;
    if (remReal <= need || !d.playing) beginTransition(plan);
  }
  $('amskip').onclick = () => {
    if (!S.on) return say('Start Automix first.');
    if (S.tr) return; if (S.idx + 1 >= queue.length) return say(auto() ? 'Picking the next track. Try again in a moment.' : 'This is the last track.');
    const plan = makePlan('skip'); if (plan) { plan.len = Math.min(plan.len, 8); beginTransition(plan); }
  };
  if ($('ammix')) $('ammix').onclick = () => {
    if (!S.on) return say('Start Automix first.');
    if (S.tr) return; if (S.idx + 1 >= queue.length) return say(auto() ? 'Picking the next track. Try again in a moment.' : 'This is the last track.');
    const plan = makePlan('now'); if (!plan) return; S.plan = plan;
    say(plan.B != null ? 'Mixing at the next phrase with ' + NAMES[plan.st] + '.' : 'Mixing now with ' + NAMES[plan.st] + '.');
  };

  A.amQueue = queue; A.amPaint = paint; A.amState = S;
  if (/[?&]gvtest\b/.test(location.search)) window.__am = { queue, S, addBuffer, used, phraseStart, makePlan, mapOf, roll, startMove, MOVES, stepMove };   // test hook
})();
