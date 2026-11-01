/* GoVibe Mix — track map: finds the intro, the drop and the outro of a track from its audio and beat grid, so Automix knows where to mix out and where to come in.
   Pure functions on an AudioBuffer-like object ({ length, sampleRate, duration, numberOfChannels, getChannelData }) and a grid ({ t0, period }).
   Energy is the loudness of each beat (with a bass heavy weighting), averaged per bar and scaled to 0..1 against the track's own loud parts. It is an estimate:
   it works best on dance music with a clear arrangement and can be wrong on live or very quiet recordings. */
window.GVTrackMap = (() => {
  const pct = (a, q) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0; };
  const mean = (a, i, j) => { let s = 0, n = 0; for (let k = Math.max(0, i); k < Math.min(a.length, j); k++) { s += a[k]; n++; } return n ? s / n : 0; };

  /* overall loudness (RMS, sampled), used to match levels between tracks */
  function level(buf) { const a = buf.getChannelData(0); let s = 0, n = 0; for (let i = 0; i < a.length; i += 7) { s += a[i] * a[i]; n++; } return Math.sqrt(s / Math.max(1, n)); }
  function analyze(buf, grid) {
    const dur = buf.duration, lvl = level(buf);
    if (!grid || !(grid.period > 0.15 && grid.period < 2.5)) return { grid: false, lvl, dur, t0: 0, beat: 0, intro: 0, drop: null, dropE: 0, outro: Math.max(0, dur - 30), inE: 0.5, outE: 0.5, bars: [] };
    const sr = buf.sampleRate, n = buf.length, a = buf.getChannelData(0), b = buf.numberOfChannels > 1 ? buf.getChannelData(1) : a, per = grid.period;
    const t0 = ((grid.t0 % per) + per) % per, nb = Math.floor((dur - t0) / per);
    if (nb < 16) return { grid: true, lvl, dur, t0, beat: per, intro: t0, drop: null, dropE: 0, outro: Math.max(t0, dur - 10), inE: 0.5, outE: 0.5, bars: [] };
    const lp = 1 - Math.exp(-2 * Math.PI * 150 / sr), beatE = new Float32Array(nb); let low = 0;
    for (let k = 0; k < nb; k++) {
      const i0 = Math.floor((t0 + k * per) * sr), i1 = Math.min(n, Math.floor((t0 + (k + 1) * per) * sr)); let s = 0, sl = 0;
      for (let i = i0; i < i1; i++) { const x = (a[i] + b[i]) * 0.5; low += lp * (x - low); s += x * x; sl += low * low; }
      const m = Math.max(1, i1 - i0); beatE[k] = Math.sqrt(0.55 * s / m + 0.45 * sl / m);
    }
    const nbar = Math.floor(nb / 4), raw = new Float32Array(nbar);
    for (let i = 0; i < nbar; i++) raw[i] = mean(beatE, i * 4, i * 4 + 4);
    const top = pct(Array.from(raw), 0.9) || 1e-9, bars = Array.from(raw, (v) => Math.min(1, v / top));
    const full = (i) => bars[i] >= 0.62, phr = (bar) => Math.round(bar / 4) * 4;
    // intro: the first bar from which the track stays at full energy for two bars
    let intro = 0; for (let i = 0; i < nbar - 1; i++) if (full(i) && full(i + 1)) { intro = i; break; }
    // drops: bars that jump well above the two bars before them and stay high
    const drops = []; for (let i = 4; i < nbar - 4; i++) { const jump = bars[i] - mean(bars, i - 2, i); if (jump >= 0.2 && bars[i] >= 0.62 && mean(bars, i, i + 3) >= 0.6) { const p = phr(i); if (!drops.length || p > drops[drops.length - 1]) drops.push(p); i += 3; } }
    const dropBar = drops.length ? drops[0] : -1;
    // outro: the phrase after the last bar at full energy
    let last = nbar - 1; while (last > 0 && !full(last)) last--;
    let lastLive = nbar - 1; while (lastLive > 0 && bars[lastLive] < 0.08) lastLive--;
    let peakBar = 0, pe = -1; for (let i = 0; i + 4 <= nbar; i += 4) { const e = mean(bars, i, i + 4); if (e > pe + 1e-9) { pe = e; peakBar = i; } }
    const outBar = Math.min(nbar, Math.ceil((last + 1) / 4) * 4), at = (bar) => t0 + bar * 4 * per;
    return {
      grid: true, lvl, dur, t0, beat: per, bars, peak: at(peakBar),
      intro: at(phr(intro)), introBars: phr(intro),
      drop: dropBar >= 0 ? at(dropBar) : null, dropE: dropBar >= 0 ? mean(bars, dropBar, dropBar + 4) : 0, drops: drops.map(at),
      outro: at(outBar), lastLive: at(lastLive + 1),
      inE: mean(bars, 0, 4), outE: mean(bars, Math.max(0, outBar - 4), outBar),
    };
  }
  return { analyze };
})();
