/* GoVibe Mix — time stretch (WSOLA) and pitch shift for the pitch and speed changer. Same method as the Audio Editor. Pure functions on Float32Array channels. */
window.GVStretch = (() => {
  function stretchChans(arrs, ratio) {                       // WSOLA: change duration by ratio (out/in) without changing pitch
    const inLen = arrs[0].length, outLen = Math.max(1, Math.round(inLen * ratio)), N = 2048, Hs = N / 2, Ha = Hs / ratio, D = 384;
    if (inLen < N * 2) return arrs.map((c) => { const o = new Float32Array(outLen); for (let i = 0; i < outLen; i++) o[i] = c[Math.min(inLen - 1, Math.floor(i / ratio))]; return o; });
    const win = new Float32Array(N); for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
    const out = arrs.map(() => new Float32Array(outLen + N)), norm = new Float32Array(outLen + N);
    const m = new Float32Array(inLen); for (let i = 0; i < inLen; i++) { let v = 0; for (let c = 0; c < arrs.length; c++) v += arrs[c][i]; m[i] = v / arrs.length; }
    let prev = 0;                                             // input position of the previous chosen frame
    for (let k = 0, o = 0; o < outLen; k++, o += Hs) {
      let pos = Math.round(k * Ha);
      if (k > 0) {
        const want = prev + Hs; let best = -Infinity, bp = pos;
        for (let d = -D; d <= D; d += 2) {
          const p = pos + d; if (p < 0 || p + N > inLen || want + N > inLen) continue;
          let sc = 0; for (let i = 0; i < N; i += 8) sc += m[p + i] * m[want + i];
          if (sc > best) { best = sc; bp = p; }
        }
        pos = bp;
      }
      pos = Math.max(0, Math.min(inLen - N, pos)); prev = pos;
      for (let c = 0; c < arrs.length; c++) { const src = arrs[c], dst = out[c]; for (let i = 0; i < N; i++) dst[o + i] += src[pos + i] * win[i]; }
      for (let i = 0; i < N; i++) norm[o + i] += win[i];
    }
    return out.map((dst) => { const r = new Float32Array(outLen); for (let i = 0; i < outLen; i++) r[i] = norm[i] > 1e-3 ? dst[i] / norm[i] : 0; return r; });
  }
  function resampleTo(x, outLen, k) {                         // read x at step k with linear interpolation
    const r = new Float32Array(outLen), n = x.length;
    for (let i = 0; i < outLen; i++) { const p = i * k, i0 = Math.floor(p), f = p - i0; r[i] = (x[Math.min(i0, n - 1)] || 0) * (1 - f) + (x[Math.min(i0 + 1, n - 1)] || 0) * f; }
    return r;
  }
  function pitchShift(arrs, semis) {
    const p = Math.pow(2, semis / 12), inLen = arrs[0].length, st = stretchChans(arrs, p);
    return st.map((c) => resampleTo(c, inLen, p));
  }
  return { stretch: stretchChans, resample: resampleTo, pitchShift };
})();
