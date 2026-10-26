/* Go Vibe Studios — stem splitter worker (beta).
   Classic signal processing, NOT an AI model: bass by frequency, drums by harmonic/percussive
   median-filter separation, vocals as the centre-panned harmonic part, everything else as "music".
   The four stems add back up to the original. */
'use strict';
const N = 2048, HOP = N / 2, B = N / 2 + 1, MED = 8;
const win = new Float32Array(N); for (let i = 0; i < N; i++) win[i] = Math.sin(Math.PI * (i + 0.5) / N);
const rev = new Uint16Array(N); for (let i = 0, lg = Math.log2(N); i < N; i++) { let r = 0; for (let b = 0; b < lg; b++) if (i & (1 << b)) r |= 1 << (lg - 1 - b); rev[i] = r; }
const cs = new Float32Array(N / 2), sn = new Float32Array(N / 2); for (let i = 0; i < N / 2; i++) { cs[i] = Math.cos(2 * Math.PI * i / N); sn[i] = -Math.sin(2 * Math.PI * i / N); }
function fft(re, im, inv) {
  for (let i = 0; i < N; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let size = 2; size <= N; size <<= 1) {
    const half = size >> 1, step = N / size;
    for (let s = 0; s < N; s += size) for (let k = 0; k < half; k++) {
      const wr = cs[k * step], wi = inv ? -sn[k * step] : sn[k * step], a = s + k, b = a + half;
      const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
      re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
    }
  }
}
const sstep = (x, a, b) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function median(buf, n) { for (let i = 1; i < n; i++) { const v = buf[i]; let j = i - 1; while (j >= 0 && buf[j] > v) { buf[j + 1] = buf[j]; j--; } buf[j + 1] = v; } return buf[n >> 1]; }

onmessage = (e) => {
  const { L, R, sr } = e.data, n = L.length;
  const out = { drumsL: new Float32Array(n), drumsR: new Float32Array(n), musicL: new Float32Array(n), musicR: new Float32Array(n), bass: new Float32Array(n), vocals: new Float32Array(n) };
  const Bm = new Float32Array(B), Wv = new Float32Array(B);
  for (let b = 0; b < B; b++) { const f = b * sr / N; Bm[b] = 1 - sstep(f, 100, 200); Wv[b] = sstep(f, 150, 300) * (1 - sstep(f, 5000, 9000)); }
  const CORE = 1280 * HOP, MG = 48 * HOP, tmp = new Float32Array(2 * MED + 1);
  const re = new Float32Array(N), im = new Float32Array(N);
  let side = 0, tot = 0;
  for (let c0 = 0; c0 < n; c0 += CORE) {
    const c1 = Math.min(n, c0 + CORE), w0 = c0 - MG, W = Math.ceil((c1 + MG - w0) / HOP) * HOP, F = W / HOP + 1;
    const sL = [new Float32Array(F * B), new Float32Array(F * B)], sLi = [new Float32Array(F * B), new Float32Array(F * B)];   // [re],[im] for L then R
    for (let ch = 0; ch < 2; ch++) {
      const src = ch ? R : L;
      for (let k = 0; k < F; k++) {
        const st = w0 + k * HOP - HOP;
        for (let i = 0; i < N; i++) { const p = st + i; re[i] = (p >= 0 && p < n ? src[p] : 0) * win[i]; im[i] = 0; }
        fft(re, im, false);
        for (let b = 0; b < B; b++) { sL[ch][k * B + b] = re[b]; sLi[ch][k * B + b] = im[b]; }
      }
    }
    const [Lr, Rr] = sL, [Li, Ri] = sLi, mag = new Float32Array(F * B), Hm = new Float32Array(F * B);
    for (let i = 0; i < F * B; i++) { const mr = (Lr[i] + Rr[i]) / 2, mi = (Li[i] + Ri[i]) / 2; mag[i] = Math.hypot(mr, mi); }
    for (let k = 0; k < F; k++) for (let b = 0; b < B; b++) {                       // harmonic = median over time
      let m = 0; for (let d = -MED; d <= MED; d++) { const kk = k + d; if (kk >= 0 && kk < F) tmp[m++] = mag[kk * B + b]; }
      Hm[k * B + b] = median(tmp, m);
    }
    const outs = [0, 1, 2, 3, 4, 5].map(() => [new Float32Array(W + 2 * HOP)]);     // bass, vocals, dL, dR, mL, mR
    const spec = [0, 1, 2, 3, 4, 5].map(() => [new Float32Array(B), new Float32Array(B)]);
    for (let k = 0; k < F; k++) {
      const o = k * B;
      for (let b = 0; b < B; b++) {
        let m = 0; for (let d = -MED; d <= MED; d++) { const bb = b + d; if (bb >= 0 && bb < B) tmp[m++] = mag[o + bb]; }
        const P = median(tmp, m), H = Hm[o + b], h2 = H * H, p2 = P * P, Hh = h2 / (h2 + p2 + 1e-12), Ph = 1 - Hh;
        const lr = Lr[o + b], li = Li[o + b], rr = Rr[o + b], ri = Ri[o + b], mr = (lr + rr) / 2, mi = (li + ri) / 2;
        const pl = lr * lr + li * li, pr = rr * rr + ri * ri, cen = (mr * mr + mi * mi) / (0.5 * (pl + pr) + 1e-12);
        const V = Hh * (1 - Bm[b]) * Wv[b] * sstep(cen, 0.55, 0.9), nb = 1 - Bm[b];
        const set = (i, a, bq) => { spec[i][0][b] = a; spec[i][1][b] = bq; };
        set(0, Bm[b] * mr, Bm[b] * mi);
        set(1, V * mr, V * mi);
        set(2, Ph * nb * lr, Ph * nb * li); set(3, Ph * nb * rr, Ph * nb * ri);
        set(4, Hh * nb * lr - V * mr + Bm[b] * (lr - mr), Hh * nb * li - V * mi + Bm[b] * (li - mi));
        set(5, Hh * nb * rr - V * mr + Bm[b] * (rr - mr), Hh * nb * ri - V * mi + Bm[b] * (ri - mi));
        side += (pl + pr) / 2 - (mr * mr + mi * mi); tot += (pl + pr) / 2;
      }
      for (let s = 0; s < 6; s++) {                                                  // inverse STFT, overlap-add
        for (let b = 0; b < B; b++) { re[b] = spec[s][0][b]; im[b] = spec[s][1][b]; }
        for (let b = 1; b < N / 2; b++) { re[N - b] = re[b]; im[N - b] = -im[b]; }
        fft(re, im, true);
        const o2 = outs[s][0], base = k * HOP;                                       // frame start (relative to window start - HOP + HOP)
        for (let i = 0; i < N; i++) o2[base + i] += re[i] / N * win[i];
      }
    }
    const names = ['bass', 'vocals', 'drumsL', 'drumsR', 'musicL', 'musicR'];
    for (let s = 0; s < 6; s++) { const o2 = outs[s][0], dst = out[names[s]]; for (let p = c0; p < c1; p++) dst[p] = o2[p - w0 + HOP]; }
    postMessage({ progress: Math.min(1, c1 / n) });
  }
  postMessage({ done: true, mono: tot > 0 && side / tot < 0.002, out }, Object.values(out).map((a) => a.buffer));
};
