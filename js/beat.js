/* Go Vibe Studios — beat maker: 16-step sequencer with synthesized drums, routed through the DJ master */
(() => {
  const A = window.GVAudio; if (!A) return;
  const { ctx, env, noise } = A, $ = (id) => document.getElementById(id);
  const out = ctx.createGain(); out.gain.value = 0.64; out.connect(A.master);

  const VOICES = {
    Kick(t) { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.25); env(g, t, 0.003, 0.35, 1); o.connect(g).connect(out); o.start(t); o.stop(t + 0.45); },
    Snare(t) { const n = noise(0.25), f = ctx.createBiquadFilter(), g = ctx.createGain(), o = ctx.createOscillator(), og = ctx.createGain(); f.type = 'highpass'; f.frequency.value = 1200; env(g, t, 0.002, 0.18, 0.8); n.connect(f).connect(g).connect(out); n.start(t); n.stop(t + 0.25); o.frequency.value = 190; env(og, t, 0.002, 0.1, 0.5); o.connect(og).connect(out); o.start(t); o.stop(t + 0.15); },
    Clap(t) { const n = noise(0.3), f = ctx.createBiquadFilter(), g = ctx.createGain(); f.type = 'bandpass'; f.frequency.value = 1500; env(g, t, 0.003, 0.2, 0.9); n.connect(f).connect(g).connect(out); n.start(t); n.stop(t + 0.3); },
    'Hat': function (t) { const n = noise(0.08), f = ctx.createBiquadFilter(), g = ctx.createGain(); f.type = 'highpass'; f.frequency.value = 7000; env(g, t, 0.001, 0.05, 0.5); n.connect(f).connect(g).connect(out); n.start(t); n.stop(t + 0.08); },
    'Open hat': function (t) { const n = noise(0.4), f = ctx.createBiquadFilter(), g = ctx.createGain(); f.type = 'highpass'; f.frequency.value = 6000; env(g, t, 0.001, 0.3, 0.4); n.connect(f).connect(g).connect(out); n.start(t); n.stop(t + 0.4); },
    Bass(t) { const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter(); o.type = 'sawtooth'; o.frequency.value = 55; f.type = 'lowpass'; f.frequency.value = 400; env(g, t, 0.005, 0.25, 0.6); o.connect(f).connect(g).connect(out); o.start(t); o.stop(t + 0.3); }
  };
  const NAMES = Object.keys(VOICES), STEPS = 16;
  const empty = () => NAMES.map(() => Array(STEPS).fill(false));
  const fromStr = (rows) => NAMES.map((_, i) => [...(rows[i] || '').padEnd(STEPS, '.')].map((c) => c === 'x'));
  const PRESETS = {
    'House': ['x...x...x...x...', '....x.......x...', '', '..x...x...x...x.', '', 'x..x..x.x..x..x.'],
    'Hip-hop': ['x.....x...x.....', '....x.......x...', '', 'x.x.x.x.x.x.x.x.', '', ''],
    'Trap': ['x.......x.x.....', '........x.......', '', 'x.x.x.x.x.x.xxxx', '', 'x.......x.x.....'],
    'Breakbeat': ['x.....x...x...x.', '....x..x.x..x...', '', 'x.x.x.x.x.x.x.x.', '......x.......x.', '']
  };
  let pat = fromStr(PRESETS.House), bpm = 120, swing = 0, playing = false, step = 0, nextT = 0, timer = 0;

  /* ---------- grid ---------- */
  const grid = $('bgrid'), cells = [];
  NAMES.forEach((nm, r) => {
    const row = document.createElement('div'); row.className = 'brow';
    const lab = document.createElement('span'); lab.textContent = nm; row.appendChild(lab);
    cells[r] = [];
    for (let s = 0; s < STEPS; s++) {
      const b = document.createElement('button'); b.className = 'bstep'; b.setAttribute('aria-label', nm + ' step ' + (s + 1));
      b.onclick = () => { pat[r][s] = !pat[r][s]; paint(); if (pat[r][s]) { ctx.resume(); VOICES[nm](ctx.currentTime + 0.005); } };
      row.appendChild(b); cells[r][s] = b;
    }
    grid.appendChild(row);
  });
  function paint() { cells.forEach((row, r) => row.forEach((b, s) => b.setAttribute('aria-pressed', pat[r][s] ? 'true' : 'false'))); }
  paint();
  function mark(s) { cells.forEach((row) => row.forEach((b, i) => b.classList.toggle('now', i === s))); }

  Object.keys(PRESETS).forEach((k) => { const b = document.createElement('button'); b.className = 'btn'; b.textContent = k; b.onclick = () => { pat = fromStr(PRESETS[k]); paint(); }; $('bpresets').appendChild(b); });
  $('bclear').onclick = () => { pat = empty(); paint(); };

  /* ---------- scheduler (look-ahead) ---------- */
  const stepLen = () => 60 / bpm / 4;
  function tick() {
    while (nextT < ctx.currentTime + 0.12) {
      const s = step, t = nextT + (s % 2 ? (swing / 100) * stepLen() * 0.5 : 0);
      pat.forEach((row, r) => { if (row[s]) VOICES[NAMES[r]](t); });
      const delay = Math.max(0, (t - ctx.currentTime) * 1000);
      setTimeout(() => playing && mark(s), delay);
      nextT += stepLen(); step = (step + 1) % STEPS;
    }
  }
  function start() { ctx.resume(); step = 0; nextT = ctx.currentTime + 0.06; playing = true; timer = setInterval(tick, 25); tick(); $('bplay').textContent = '■ Stop beat'; }
  function stop() { playing = false; clearInterval(timer); mark(-1); $('bplay').textContent = '▶ Play beat'; }
  $('bplay').onclick = () => (playing ? stop() : start());
  $('bbpm').onchange = $('bbpm').oninput = () => { const v = +$('bbpm').value; if (v >= 60 && v <= 200) bpm = v; };
  $('bswing').oninput = () => (swing = +$('bswing').value);
  $('bvol').oninput = () => (out.gain.value = 0.8 * Math.pow($('bvol').value / 100, 1.5));
  $('bmatch').onclick = () => {
    const d = A.decks && A.decks[0], v = d && d.liveBpm;
    if (!v) return alert('Load a track into deck A and detect its BPM first.');
    bpm = Math.min(200, Math.max(60, Math.round(v))); $('bbpm').value = bpm;
  };
  if (/[?&]gvtest\b/.test(location.search)) window.__beat = { get pat() { return pat; }, get playing() { return playing; }, get bpm() { return bpm; }, NAMES };   // test hook
})();
