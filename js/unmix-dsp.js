/* GoVibe Mix — signal processing for the AI vocal remover: the short time Fourier transform and its inverse, laid out the way Open-Unmix expects
   (44.1 kHz, 4096 point FFT, hop 1024, periodic Hann window, centred with reflect padding, 2049 bins), and the ratio mask that turns a model's vocal estimate into audio.
   Plain functions, no dependencies, used inside a worker and in tests. */
export const N = 4096, HOP = 1024, BINS = N / 2 + 1;
const win = new Float32Array(N); for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
const rev = new Uint16Array(N); for (let i = 0, b = Math.log2(N); i < N; i++) { let r = 0; for (let k = 0; k < b; k++) if (i & (1 << k)) r |= 1 << (b - 1 - k); rev[i] = r; }
const cs = new Float64Array(N / 2), sn = new Float64Array(N / 2); for (let i = 0; i < N / 2; i++) { cs[i] = Math.cos(2 * Math.PI * i / N); sn[i] = -Math.sin(2 * Math.PI * i / N); }
/* in place complex FFT of length N; inverse = true gives the unscaled inverse */
export function fft(re, im, inverse) {
  for (let i = 0; i < N; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  const sg = inverse ? -1 : 1;
  for (let len = 2; len <= N; len <<= 1) {
    const h = len >> 1, st = N / len;
    for (let i = 0; i < N; i += len) for (let k = 0, w = 0; k < h; k++, w += st) {
      const wr = cs[w], wi = sg * sn[w], a = i + k, b = a + h, xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
      re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
    }
  }
}
const refl = (i, n) => { if (n < 2) return 0; const p = 2 * (n - 1); i = ((i % p) + p) % p; return i < n ? i : p - i; };
export const frames = (len) => 1 + Math.floor(len / HOP);
/* STFT of two channels at once (L in the real part, R in the imaginary part). Returns { T, re, im } with layout [channel][bin][frame] flattened, ready for a model input of shape [1, 2, 2049, T] */
export function stft(L, R) {
  const len = L.length, T = frames(len), re = new Float32Array(2 * BINS * T), im = new Float32Array(2 * BINS * T), zr = new Float64Array(N), zi = new Float64Array(N);
  for (let t = 0; t < T; t++) {
    const s0 = t * HOP - N / 2;
    for (let i = 0; i < N; i++) { const p = refl(s0 + i, len); zr[i] = L[p] * win[i]; zi[i] = R[p] * win[i]; }
    fft(zr, zi, false);
    for (let k = 0; k < BINS; k++) {
      const m = (N - k) & (N - 1), ar = zr[k], ai = zi[k], br = zr[m], bi = zi[m];
      const lr = 0.5 * (ar + br), li = 0.5 * (ai - bi), rr = 0.5 * (ai + bi), ri = -0.5 * (ar - br);
      re[k * T + t] = lr; im[k * T + t] = li; re[(BINS + k) * T + t] = rr; im[(BINS + k) * T + t] = ri;
    }
  }
  return { T, re, im };
}
/* inverse of stft: overlap add with window squared normalisation, cropped back to `len` samples */
export function istft(re, im, T, len) {
  const total = (T - 1) * HOP + N, oL = new Float32Array(total), oR = new Float32Array(total), env = new Float32Array(total), zr = new Float64Array(N), zi = new Float64Array(N);
  for (let t = 0; t < T; t++) {
    for (let k = 0; k < BINS; k++) {
      const lr = re[k * T + t], li = im[k * T + t], rr = re[(BINS + k) * T + t], ri = im[(BINS + k) * T + t];
      zr[k] = lr - ri; zi[k] = li + rr;                                    // L + iR for bins 0..N/2
      if (k > 0 && k < N / 2) { zr[N - k] = lr + ri; zi[N - k] = -li + rr; }  // L* + iR* for the mirrored bins
    }
    fft(zr, zi, true);
    const o = t * HOP; for (let i = 0; i < N; i++) { const w = win[i]; oL[o + i] += zr[i] / N * w; oR[o + i] += zi[i] / N * w; env[o + i] += w * w; }
  }
  const L = new Float32Array(len), R = new Float32Array(len);
  for (let i = 0; i < len; i++) { const p = i + N / 2, e = env[p] > 1e-6 ? env[p] : 1; L[i] = oL[p] / e; R[i] = oR[p] / e; }
  return { L, R };
}
/* the model estimates the vocal magnitude; turn it into a 0..1 ratio mask over the mixture and apply it to the mixture's own phase */
export function applyMask(re, im, est, floor = 1e-7) {
  const n = re.length, vr = new Float32Array(n), vi = new Float32Array(n);
  for (let i = 0; i < n; i++) { const m = Math.hypot(re[i], im[i]), r = Math.max(0, Math.min(1, est[i] / (m + floor))); vr[i] = re[i] * r; vi[i] = im[i] * r; }
  return { vr, vi };
}
export const magnitude = (re, im) => { const m = new Float32Array(re.length); for (let i = 0; i < m.length; i++) m[i] = Math.hypot(re[i], im[i]); return m; };
/* split a long song into pieces so memory stays flat. `model(mag, T)` returns the estimated vocal magnitude (same layout). Every piece gets some lead in and lead out so the model has context. */
export async function separate(L, R, model, onProgress, opt = {}) {
  const sr = opt.rate || 44100, seg = Math.round((opt.seconds || 20) * sr), pad = Math.round((opt.pad || 1.5) * sr), len = L.length, VL = new Float32Array(len), VR = new Float32Array(len);
  for (let s = 0; s < len; s += seg) {
    const e = Math.min(len, s + seg), a = Math.max(0, s - pad), b = Math.min(len, e + pad), cl = L.subarray(a, b), cr = R.subarray(a, b);
    const X = stft(cl, cr), est = await model(magnitude(X.re, X.im), X.T), M = applyMask(X.re, X.im, est), y = istft(M.vr, M.vi, X.T, b - a);
    VL.set(y.L.subarray(s - a, e - a), s); VR.set(y.R.subarray(s - a, e - a), s);
    if (onProgress) onProgress(e / len);
  }
  return { VL, VR };
}
