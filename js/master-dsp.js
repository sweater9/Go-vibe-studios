/* GoVibe Mix — mastering maths: BS.1770 loudness, true peak, EQ, glue compressor, look ahead limiter. Pure functions, run in a worker. */
(function (root) {
  const db = (x) => 20 * Math.log10(Math.max(1e-12, x)), lin = (d) => Math.pow(10, d / 20);

  /* ITU-R BS.1770-4 K weighting for any sample rate */
  function kCoefs(fs) {
    let f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196, K = Math.tan(Math.PI * f0 / fs);
    const Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416); let a0 = 1 + K / Q + K * K;
    const s1 = { b: [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0], a: [2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0] };
    f0 = 38.13547087602444; Q = 0.5003270373238773; K = Math.tan(Math.PI * f0 / fs); a0 = 1 + K / Q + K * K;
    const s2 = { b: [1, -2, 1], a: [2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0] };
    return [s1, s2];
  }
  function kWeight(x, fs) {
    const out = new Float32Array(x.length), st = kCoefs(fs);
    let a = x;
    st.forEach((s, k) => {
      const y = k === st.length - 1 ? out : new Float32Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
      for (let i = 0; i < a.length; i++) { const xi = a[i], yi = s.b[0] * xi + s.b[1] * x1 + s.b[2] * x2 - s.a[0] * y1 - s.a[1] * y2; x2 = x1; x1 = xi; y2 = y1; y1 = yi; y[i] = yi; }
      a = y;
    });
    return out;
  }
  /* mean square of each 100 ms step, per channel, so any 400 ms or 3 s window is a sum of steps */
  function stepEnergies(chans, fs) {
    const step = Math.round(fs * 0.1), n = Math.floor(chans[0].length / step), e = [];
    chans.forEach((c) => { const k = kWeight(c, fs), arr = new Float64Array(n); for (let b = 0; b < n; b++) { let s = 0; for (let i = b * step; i < (b + 1) * step; i++) s += k[i] * k[i]; arr[b] = s / step; } e.push(arr); });
    return { e, n };
  }
  const lk = (z) => -0.691 + 10 * Math.log10(Math.max(1e-12, z));
  function loudness(chans, fs) {
    const { e, n } = stepEnergies(chans, fs), ch = Math.min(2, chans.length); const win = (a, b) => { let z = 0; for (let c = 0; c < ch; c++) { let s = 0; for (let i = a; i < b; i++) s += e[c][i]; z += s / (b - a); } return z; };
    const blocks = []; for (let i = 0; i + 4 <= n; i++) blocks.push(win(i, i + 4));
    const above = blocks.filter((z) => lk(z) > -70); let integrated = -Infinity;
    if (above.length) { const mean = above.reduce((a, b) => a + b, 0) / above.length, rel = lk(mean) - 10, kept = above.filter((z) => lk(z) > rel); if (kept.length) integrated = lk(kept.reduce((a, b) => a + b, 0) / kept.length); }
    let stMax = -Infinity, momMax = -Infinity; for (let i = 0; i + 30 <= n; i++) stMax = Math.max(stMax, lk(win(i, i + 30))); blocks.forEach((z) => { momMax = Math.max(momMax, lk(z)); });
    /* loudness range from short term values (EBU Tech 3342) */
    const sts = []; for (let i = 0; i + 30 <= n; i++) { const v = lk(win(i, i + 30)); if (v > -70) sts.push(v); }
    let lra = 0; if (sts.length) { const m = lk(sts.map((v) => Math.pow(10, (v + 0.691) / 10)).reduce((a, b) => a + b, 0) / sts.length), g = sts.filter((v) => v > m - 20).sort((a, b) => a - b); if (g.length > 1) lra = g[Math.floor(0.95 * (g.length - 1))] - g[Math.floor(0.1 * (g.length - 1))]; }
    return { lufs: integrated, shortTermMax: stMax, momentaryMax: momMax, lra };
  }
  /* true peak: 4 times oversampling with a windowed sinc (polyphase, 24 taps per phase) */
  const TP = (() => { const L = 4, T = 12, h = []; for (let p = 1; p < L; p++) { const ph = []; for (let k = -T + 1; k <= T; k++) { const x = k - p / L, s = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x), w = 0.5 + 0.5 * Math.cos(Math.PI * x / T); ph.push(s * w); } h.push(ph); } return { L, T, h }; })();
  function truePeak(chans) {
    let pk = 0; chans.forEach((c) => {
      for (let i = 0; i < c.length; i++) { const a = Math.abs(c[i]); if (a > pk) pk = a; }
      const T = TP.T; for (let i = T; i < c.length - T; i++) { const a = Math.abs(c[i]); if (a < pk * 0.5 && a < 0.3) continue; /* only scan loud areas */
        for (let p = 0; p < TP.L - 1; p++) { const ph = TP.h[p]; let s = 0; for (let k = 0; k < ph.length; k++) s += ph[k] * c[i - T + 1 + k]; if (Math.abs(s) > pk) pk = Math.abs(s); } }
    });
    return pk;
  }
  function samplePeak(chans) { let pk = 0; chans.forEach((c) => { for (let i = 0; i < c.length; i++) { const a = Math.abs(c[i]); if (a > pk) pk = a; } }); return pk; }
  function analyze(chans, fs) { const l = loudness(chans, fs), tp = truePeak(chans), sp = samplePeak(chans); return { lufs: l.lufs, shortTermMax: l.shortTermMax, momentaryMax: l.momentaryMax, lra: l.lra, truePeakDb: db(tp), peakDb: db(sp), seconds: chans[0].length / fs }; }

  /* RBJ shelves */
  function shelf(x, fs, type, f0, gainDb) {
    if (!gainDb) return x; const A = Math.pow(10, gainDb / 40), w = 2 * Math.PI * f0 / fs, cs = Math.cos(w), sn = Math.sin(w), al = sn / 2 * Math.sqrt(2), r = 2 * Math.sqrt(A) * al; let b0, b1, b2, a0, a1, a2;
    if (type === 'low') { b0 = A * ((A + 1) - (A - 1) * cs + r); b1 = 2 * A * ((A - 1) - (A + 1) * cs); b2 = A * ((A + 1) - (A - 1) * cs - r); a0 = (A + 1) + (A - 1) * cs + r; a1 = -2 * ((A - 1) + (A + 1) * cs); a2 = (A + 1) + (A - 1) * cs - r; }
    else { b0 = A * ((A + 1) + (A - 1) * cs + r); b1 = -2 * A * ((A - 1) + (A + 1) * cs); b2 = A * ((A + 1) + (A - 1) * cs - r); a0 = (A + 1) - (A - 1) * cs + r; a1 = 2 * ((A - 1) - (A + 1) * cs); a2 = (A + 1) - (A - 1) * cs - r; }
    b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0; const y = new Float32Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) { const xi = x[i], yi = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = xi; y2 = y1; y1 = yi; y[i] = yi; } return y;
  }
  /* gentle feed forward glue compressor, linked channels, amount 0 to 1 */
  function glue(chans, fs, amount) {
    if (!amount) return chans; const thr = -22, ratio = 1 + amount * 3, at = Math.exp(-1 / (0.01 * fs)), rl = Math.exp(-1 / (0.15 * fs)), n = chans[0].length, out = chans.map(() => new Float32Array(n)); let env = 0;
    for (let i = 0; i < n; i++) { let m = 0; for (let c = 0; c < chans.length; c++) { const a = Math.abs(chans[c][i]); if (a > m) m = a; } env = m > env ? at * env + (1 - at) * m : rl * env + (1 - rl) * m;
      const over = db(env) - thr, g = over > 0 ? lin(-over * (1 - 1 / ratio)) : 1; for (let c = 0; c < chans.length; c++) out[c][i] = chans[c][i] * g; }
    return out;
  }
  /* look ahead limiter. Guarantees sample peak <= ceiling. Returns {out, maxReduction} */
  function limit(chans, fs, ceilDb, releaseMs) {
    const n = chans[0].length, ceil = lin(ceilDb), L = Math.max(8, Math.round(fs * 0.002)), g = new Float32Array(n);
    for (let i = 0; i < n; i++) { let m = 0; for (let c = 0; c < chans.length; c++) { const a = Math.abs(chans[c][i]); if (a > m) m = a; } g[i] = m > ceil ? ceil / m : 1; }
    /* sliding minimum over i..i+L-1 (monotonic queue) */
    const m = new Float32Array(n), dq = new Int32Array(n + L); let h = 0, t = 0;
    for (let i = n - 1; i >= -L; i--) { if (i >= 0) { while (t > h && g[dq[t - 1]] >= g[i]) t--; dq[t++] = i; } while (t > h && dq[h] > i + L - 1) h++; if (i >= 0) m[i] = t > h ? g[dq[h]] : 1; }
    /* average the last L values of m so the gain slides in before the peak */
    const s = new Float32Array(n); let acc = 0; for (let i = 0; i < n; i++) { acc += m[i]; if (i >= L) acc -= m[i - L]; s[i] = acc / Math.min(L, i + 1) ; if (i < L - 1) s[i] = Math.min(s[i], m[i]); }
    /* release: gain may rise only slowly (never above s) */
    const k = 1 - Math.exp(-1 / (Math.max(5, releaseMs || 80) / 1000 * fs)); let r = 1, red = 0; const out = chans.map(() => new Float32Array(n));
    for (let i = 0; i < n; i++) { r = Math.min(s[i], r + (1 - r) * k); if (r < red || i === 0) red = Math.min(red || 1, r); for (let c = 0; c < chans.length; c++) out[c][i] = chans[c][i] * r; }
    return { out, maxReduction: -db(red || 1) };
  }
  function width(chans, w) { if (chans.length < 2 || w === 1) return chans; const n = chans[0].length, l = new Float32Array(n), r = new Float32Array(n); for (let i = 0; i < n; i++) { const m = (chans[0][i] + chans[1][i]) / 2, s = (chans[0][i] - chans[1][i]) / 2 * w; l[i] = m + s; r[i] = m - s; } return [l, r]; }

  /* the whole chain. o: {bass, treble, glue 0..1, width 0..2, targetLufs, ceiling, releaseMs} */
  function master(chans, fs, o) {
    let x = chans.map((c) => shelf(shelf(c, fs, 'low', 100, o.bass || 0), fs, 'high', 8000, o.treble || 0)); x = width(x, o.width == null ? 1 : o.width); x = glue(x, fs, o.glue || 0);
    const l0 = loudness(x, fs).lufs; let ceil = o.ceiling == null ? -1 : o.ceiling, gain = isFinite(l0) ? o.targetLufs - l0 : 0, best = null, tpDb = 0;
    for (let it = 0; it < 9; it++) {
      const gl = lin(gain), y = x.map((c) => { const o2 = new Float32Array(c.length); for (let i = 0; i < c.length; i++) o2[i] = c[i] * gl; return o2; });
      const lim = limit(y, fs, ceil, o.releaseMs), l1 = loudness(lim.out, fs).lufs; tpDb = db(truePeak(lim.out)); best = { out: lim.out, maxReduction: lim.maxReduction, gain };
      const errL = o.targetLufs - l1, errTP = tpDb - (o.ceiling == null ? -1 : o.ceiling);
      if (errTP > 0.005) { ceil -= errTP + 0.05; continue; }
      if (Math.abs(errL) < 0.15 || !isFinite(errL)) break; gain += errL; if (errL < 0) continue;
    }
    return { chans: best.out, gainDb: best.gain, maxReduction: best.maxReduction };
  }
  const api = { analyze, loudness, truePeak, samplePeak, master, limit, shelf, glue, db, lin };
  if (typeof module !== 'undefined') module.exports = api; root.GVMaster = api;
})(typeof self !== 'undefined' ? self : this);
