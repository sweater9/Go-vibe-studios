/* GoVibe Mix home page: the playable beat strip and the line that draws above each group of tools. */
(() => {
  const $ = (id) => document.getElementById(id);
  const ROWS = [['Kick', '#b9a3ff'], ['Snare', '#4fe0f5'], ['Hat', '#ffc94d'], ['Clap', '#ff8fc3']];
  const PRESETS = {
    'Boom bap': { bpm: 92, Kick: [0, 7, 10], Snare: [4, 12], Hat: [0, 2, 4, 6, 8, 10, 12, 14], Clap: [] },
    'House': { bpm: 124, Kick: [0, 4, 8, 12], Snare: [], Hat: [2, 6, 10, 14], Clap: [4, 12] },
    'Trap': { bpm: 140, Kick: [0, 7, 11], Snare: [], Hat: [0, 2, 4, 6, 8, 10, 12, 14, 15], Clap: [8] },
    'Empty': { Kick: [], Snare: [], Hat: [], Clap: [] }
  };
  const grid = {}; ROWS.forEach(([n]) => { grid[n] = Array(16).fill(0); });
  const cells = {}; let ctx = null, timer = 0, step = 0, next = 0, playing = false, bus = null;
  const box = $('steps');
  ROWS.forEach(([n, col], r) => {
    const lab = document.createElement('div'); lab.className = 'rl'; lab.textContent = n; box.appendChild(lab); cells[n] = [];
    for (let i = 0; i < 16; i++) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'st' + (i % 4 === 0 ? ' b' : ''); b.style.setProperty('--sc', col); b.style.setProperty('--i', i + r * 3);
      b.setAttribute('aria-pressed', 'false'); b.setAttribute('aria-label', n + ' step ' + (i + 1));
      b.onclick = () => { grid[n][i] = grid[n][i] ? 0 : 1; b.setAttribute('aria-pressed', !!grid[n][i]); if (grid[n][i]) hit(n, 0); stat(); };
      box.appendChild(b); cells[n].push(b);
    }
  });
  function paint() { ROWS.forEach(([n]) => cells[n].forEach((b, i) => b.setAttribute('aria-pressed', !!grid[n][i]))); }
  function load(name) { const p = PRESETS[name]; ROWS.forEach(([n]) => { grid[n] = Array(16).fill(0); (p[n] || []).forEach((i) => { grid[n][i] = 1; }); }); if (p.bpm) { $('dbpm').value = p.bpm; $('dbpmv').textContent = p.bpm; } paint(); stat(); }
  function stat() { const n = ROWS.reduce((a, [r]) => a + grid[r].reduce((x, y) => x + y, 0), 0); $('dstat').textContent = n ? n + ' hits on the grid at ' + $('dbpm').value + ' BPM.' : 'The grid is empty. Tap a square to add a hit.'; }
  function audio() { if (!ctx) { ctx = new (window.AudioContext || window.webkitAudioContext)(); bus = ctx.createGain(); bus.gain.value = 0.9; bus.connect(ctx.destination); } ctx.resume(); return ctx; }
  function hit(name, when) { const c = audio(); GVSynth.drum(c, bus, name, c.currentTime + 0.01 + (when || 0), 0.9); }
  function mark(i) { box.querySelectorAll('.now').forEach((b) => b.classList.remove('now')); ROWS.forEach(([n]) => cells[n][i].classList.add('now')); }
  function tick() {
    const c = ctx, spb16 = 60 / +$('dbpm').value / 4;
    while (next < c.currentTime + 0.12) {
      ROWS.forEach(([n]) => { if (grid[n][step]) GVSynth.drum(c, bus, n, next, 0.9); });
      const s = step, delay = Math.max(0, (next - c.currentTime) * 1000); setTimeout(() => { if (playing) mark(s); }, delay);
      step = (step + 1) % 16; next += spb16;
    }
  }
  function play() { audio(); playing = true; step = 0; next = ctx.currentTime + 0.06; timer = setInterval(tick, 25); tick(); $('dplay').setAttribute('aria-pressed', 'true'); $('dplay').setAttribute('aria-label', 'Stop the beat'); }
  function stop() { playing = false; clearInterval(timer); timer = 0; box.querySelectorAll('.now').forEach((b) => b.classList.remove('now')); $('dplay').setAttribute('aria-pressed', 'false'); $('dplay').setAttribute('aria-label', 'Play the beat'); }
  $('dplay').onclick = () => (playing ? stop() : play());
  $('dpat').onchange = () => load($('dpat').value);
  $('dbpm').oninput = () => { $('dbpmv').textContent = $('dbpm').value; stat(); };
  $('dopen').onclick = (e) => {
    e.preventDefault(); const g = {}; ROWS.forEach(([n]) => { g[n] = grid[n].slice(); });
    try { localStorage.setItem('govibe.loop', JSON.stringify({ bpm: +$('dbpm').value, bars: 4, spec: { type: 'drum', name: 'Home beat', grid: g, swing: 0 } })); location.href = 'studio.html?from=samples'; } catch (_) { location.href = 'studio.html'; }
  };
  load('Boom bap');
  window.addEventListener('pagehide', stop);

  /* the coloured line above each group draws in when it scrolls into view */
  const groups = [...document.querySelectorAll('.grp')];
  if ('IntersectionObserver' in window) { const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.15 }); groups.forEach((g) => io.observe(g)); } else groups.forEach((g) => g.classList.add('in'));
  if (/[?&]gvtest\b/.test(location.search)) window.__home = { grid, play, stop, get playing() { return playing; } };
})();
