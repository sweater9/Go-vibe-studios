/* GoVibeMix: draws a tapped beat grid over a track's waveform (BPM page). Runs locally; exposes window.GVGrid. */
(() => {
  const $ = (id) => document.getElementById(id);
  const WIN = 16;                       // seconds shown at once
  let peaks = null, dur = 0, t0 = 0, bpm = 0, ctx = null;
  function build(buf) {
    const ch = buf.getChannelData(0), per = 200, n = Math.floor(dur * per), step = Math.max(1, Math.floor(ch.length / n));
    peaks = new Float32Array(n);
    for (let i = 0; i < n; i++) { let m = 0; for (let j = i * step, e = Math.min(ch.length, j + step); j < e; j += 4) { const v = Math.abs(ch[j]); if (v > m) m = v; } peaks[i] = m; }
    return per;
  }
  let per = 200;
  function draw() {
    const cv = $('gridcv'), r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    cv.width = Math.max(10, Math.round(r.width * dpr)); cv.height = Math.round(r.height * dpr);
    const g = cv.getContext('2d'), W = cv.width, H = cv.height; g.clearRect(0, 0, W, H);
    if (!peaks) return;
    const start = (+$('gridpos').value / 1000) * Math.max(0, dur - WIN), len = Math.min(WIN, dur);
    g.fillStyle = '#8b5cf6';
    for (let x = 0; x < W; x++) { const i = Math.floor((start + (x / W) * len) * per); const a = (peaks[i] || 0) * H * 0.46; g.fillRect(x, H / 2 - a, 1, Math.max(1, a * 2)); }
    if (bpm) {
      const p = 60 / bpm; g.strokeStyle = '#22d3ee'; g.lineWidth = Math.max(1, dpr);
      for (let k = Math.ceil((start - t0) / p); t0 + k * p <= start + len; k++) { const x = ((t0 + k * p - start) / len) * W; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    }
  }
  function info() {
    const el = $('gridinfo');
    if (!peaks) { el.textContent = bpm ? 'Choose a track to see your ' + bpm.toFixed(1) + ' BPM grid on it.' : 'Tap at least two beats, then choose a track.'; return; }
    if (!bpm) { el.textContent = 'Tap at least two beats above to draw your grid.'; return; }
    const beats = Math.floor(dur * bpm / 60); el.textContent = 'Cyan lines are your tapped ' + bpm.toFixed(1) + ' BPM grid, starting on the first beat found in the track. Over ' + beats + ' beats it should stay on the peaks; if it drifts, tap again for longer.';
  }
  async function load(file) {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    $('gridinfo').textContent = 'Reading ' + file.name + '…';
    let buf; try { buf = await ctx.decodeAudioData(await file.arrayBuffer()); } catch (_) { $('gridinfo').textContent = 'Could not read this file.'; return; }
    dur = buf.duration; per = 200; peaks = null; const sub = build(buf); per = sub;
    const b0 = window.GVAnalyze && GVAnalyze.detectBPM(buf), gr = b0 && GVAnalyze.detectGrid(buf, b0); t0 = gr ? gr.t0 : 0;
    $('gridpos').disabled = false; $('gridpos').value = 0; info(); draw();
  }
  function setBpm(v) { bpm = v || 0; info(); draw(); }
  $('gridpick').onclick = () => $('gridfile').click();
  $('gridfile').onchange = () => { const f = $('gridfile').files[0]; $('gridfile').value = ''; if (f) load(f); };
  $('gridpos').oninput = draw;
  window.addEventListener('resize', draw);
  if (/[?&]gvtest\b/.test(location.search)) window.__bpmgrid = { get state() { return window.GVGrid.state; } };
  window.GVGrid = { setBpm, get state() { return { bpm, t0, dur, ready: !!peaks }; }, load };
})();
