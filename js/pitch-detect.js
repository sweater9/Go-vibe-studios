/* GoVibe Mix: monophonic pitch detection (the YIN method) shared by the Tuner and Audio to MIDI. Runs locally. */
window.GVPitch = (() => {
  const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  const toMidi = (hz, a4 = 440) => 69 + 12 * Math.log2(hz / a4), toHz = (m, a4 = 440) => a4 * Math.pow(2, (m - 69) / 12);
  const name = (m) => NAMES[((Math.round(m) % 12) + 12) % 12] + (Math.floor(Math.round(m) / 12) - 1);
  /* d: Float32Array of samples. Returns { hz, clarity } or null when there is no clear pitch. */
  function yin(d, sr, fmin = 50, fmax = 1200, thr = 0.12) {
    const tmin = Math.max(2, Math.floor(sr / fmax)), tmax = Math.min(Math.floor(sr / fmin), d.length >> 1), W = d.length - tmax; if (W < 64 || tmax <= tmin + 2) return null;
    const cm = new Float32Array(tmax + 1); let run = 0; cm[0] = 1;
    for (let t = 1; t <= tmax; t++) { let s = 0; for (let i = 0; i < W; i++) { const x = d[i] - d[i + t]; s += x * x; } run += s; cm[t] = run > 0 ? s * t / run : 1; }
    let tau = -1; for (let t = tmin; t < tmax; t++) { if (cm[t] < thr) { while (t + 1 < tmax && cm[t + 1] < cm[t]) t++; tau = t; break; } }
    if (tau < 0) return null;
    const a = cm[tau - 1], b = cm[tau], c = cm[tau + 1 <= tmax ? tau + 1 : tau], den = a - 2 * b + c, shift = den ? 0.5 * (a - c) / den : 0;
    return { hz: sr / (tau + Math.max(-1, Math.min(1, shift))), clarity: 1 - b };
  }
  const rms = (d) => { let s = 0; for (let i = 0; i < d.length; i++) s += d[i] * d[i]; return Math.sqrt(s / Math.max(1, d.length)); };
  /* the cents sharp (+) or flat (-) of a pitch from the nearest note */
  function nearest(hz, a4 = 440) { const m = toMidi(hz, a4), r = Math.round(m); return { midi: r, name: name(r), cents: Math.round((m - r) * 100) }; }
  return { NAMES, toMidi, toHz, name, yin, rms, nearest };
})();
