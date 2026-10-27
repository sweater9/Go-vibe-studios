/* GoVibe Mix — spectrogram engine: our own FFT, colour map, frequency axis and a live scrolling view. Runs on your device. */
(() => {
  const FLOOR = -100, CEIL = 0;

  /* ---------- FFT (radix 2, in place) ---------- */
  const tw = {};
  function twiddles(n) {
    if (tw[n]) return tw[n];
    const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos(2 * Math.PI * i / n); sin[i] = -Math.sin(2 * Math.PI * i / n); }
    const rev = new Uint32Array(n), bits = Math.log2(n);
    for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); rev[i] = r; }
    return (tw[n] = { cos, sin, rev });
  }
  function fft(re, im) {
    const n = re.length, t = twiddles(n);
    for (let i = 0; i < n; i++) { const j = t.rev[i]; if (j > i) { let x = re[i]; re[i] = re[j]; re[j] = x; x = im[i]; im[i] = im[j]; im[j] = x; } }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let s = 0; s < n; s += size) {
        for (let k = 0, w = 0; k < half; k++, w += step) {
          const a = s + k, b = a + half, wr = t.cos[w], wi = t.sin[w];
          const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
        }
      }
    }
  }
  const hann = {};
  const win = (n) => hann[n] || (hann[n] = Float64Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n)));

  /* ---------- whole file: one FFT per picture column ---------- */
  function compute(chans, rate, cols, size = 4096) {
    const n = chans[0].length, bins = size / 2, w = win(size), re = new Float64Array(size), im = new Float64Array(size);
    const db = new Float32Array(cols * bins);
    for (let c = 0; c < cols; c++) {
      const start = Math.round((c + 0.5) / cols * n - size / 2);
      for (let i = 0; i < size; i++) {
        const p = start + i; let v = 0;
        if (p >= 0 && p < n) { for (let k = 0; k < chans.length; k++) v += chans[k][p]; v /= chans.length; }
        re[i] = v * w[i]; im[i] = 0;
      }
      fft(re, im);
      for (let b = 0; b < bins; b++) {
        const amp = 4 * Math.hypot(re[b], im[b]) / size;
        db[c * bins + b] = amp > 1e-9 ? 20 * Math.log10(amp) : FLOOR;
      }
    }
    return { db, cols, bins, rate, seconds: n / rate, size };
  }

  /* ---------- colour map: black, indigo, magenta, orange, pale yellow ---------- */
  const STOPS = [[0, 0, 0, 6], [.22, 40, 11, 94], [.45, 142, 34, 120], [.68, 236, 96, 48], [.88, 253, 190, 60], [1, 255, 250, 205]];
  const LUT = (() => {
    const a = new Uint8Array(256 * 3);
    for (let i = 0; i < 256; i++) {
      const t = i / 255; let k = 1; while (k < STOPS.length - 1 && STOPS[k][0] < t) k++;
      const p = STOPS[k - 1], q = STOPS[k], f = (t - p[0]) / (q[0] - p[0]);
      for (let c = 0; c < 3; c++) a[i * 3 + c] = Math.round(p[c + 1] + (q[c + 1] - p[c + 1]) * f);
    }
    return a;
  })();

  /* ---------- frequency axis ---------- */
  const FMIN = 30;
  function freqAtY(yFrac, opts, rate) { // yFrac 0 = top
    const top = Math.min(opts.fmax || 20000, rate / 2), up = 1 - Math.max(0, Math.min(1, yFrac));
    return opts.log ? FMIN * Math.pow(top / FMIN, up) : up * top;
  }
  function rowBins(H, opts, rate, bins) {
    const rows = new Float32Array(H);
    for (let y = 0; y < H; y++) rows[y] = Math.min(bins - 1.001, freqAtY((y + 0.5) / H, opts, rate) / (rate / 2) * bins);
    return rows;
  }
  function colour(db, lo, hi) { return Math.max(0, Math.min(255, Math.round((db - lo) / (hi - lo) * 255))) * 3; }

  /* ---------- paint a computed spectrogram to an offscreen canvas ---------- */
  function image(spec, W, H, opts = {}) {
    const lo = opts.minDb ?? -90, hi = opts.maxDb ?? -10, rows = rowBins(H, opts, spec.rate, spec.bins);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d'), img = g.createImageData(W, H), d = img.data;
    for (let x = 0; x < W; x++) {
      const c = Math.min(spec.cols - 1, Math.floor(x / W * spec.cols)), base = c * spec.bins;
      for (let y = 0; y < H; y++) {
        const fb = rows[y], b0 = Math.floor(fb), f = fb - b0, v = spec.db[base + b0] * (1 - f) + spec.db[base + b0 + 1] * f;
        const li = colour(v, lo, hi), o = (y * W + x) * 4;
        d[o] = LUT[li]; d[o + 1] = LUT[li + 1]; d[o + 2] = LUT[li + 2]; d[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return cv;
  }

  /* what is under the pointer */
  function probe(spec, xFrac, yFrac, opts = {}) {
    const hz = freqAtY(yFrac, opts, spec.rate), c = Math.max(0, Math.min(spec.cols - 1, Math.floor(xFrac * spec.cols)));
    const b = Math.max(0, Math.min(spec.bins - 1, Math.round(hz / (spec.rate / 2) * spec.bins)));
    return { hz, time: xFrac * spec.seconds, db: spec.db[c * spec.bins + b] };
  }

  /* frequency grid lines with labels */
  function axis(g, W, H, opts, rate, scale = 1) {
    const marks = opts.log ? [50, 100, 200, 500, 1000, 2000, 5000, 10000] : [2000, 4000, 6000, 8000, 10000, 12000, 16000, 20000];
    const top = Math.min(opts.fmax || 20000, rate / 2);
    g.save(); g.font = Math.round(11 * scale) + 'px system-ui, sans-serif'; g.textBaseline = 'middle';
    for (const f of marks) {
      if (f >= top * 0.97) continue;
      const up = opts.log ? Math.log(f / FMIN) / Math.log(top / FMIN) : f / top, y = Math.round((1 - up) * H);
      g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(0, y, W, 1);
      const t = f >= 1000 ? (f / 1000) + ' kHz' : f + ' Hz'; g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(2, y - 8 * scale, g.measureText(t).width + 6 * scale, 16 * scale);
      g.fillStyle = '#e9e9f5'; g.fillText(t, 5 * scale, y);
    }
    g.restore();
  }

  /* ---------- live scrolling view fed by an AnalyserNode ---------- */
  function live(canvas, analyser, opts = {}) {
    const g = canvas.getContext('2d'); let raf = 0, run = true, o = { log: !!opts.log, fmax: opts.fmax || 12000, minDb: -95, maxDb: -15 };
    analyser.fftSize = 4096; analyser.smoothingTimeConstant = 0.2; analyser.minDecibels = -110; analyser.maxDecibels = 0;
    const buf = new Float32Array(analyser.frequencyBinCount), colw = Math.max(1, opts.colWidth || 2);
    let rows = null, rowsH = 0, rate = analyser.context.sampleRate;
    function fit() { const r = canvas.getBoundingClientRect(), d = window.devicePixelRatio || 1, w = Math.round(r.width * d), h = Math.round(r.height * d); if (w && (canvas.width !== w || canvas.height !== h)) { canvas.width = w; canvas.height = h; g.fillStyle = '#000'; g.fillRect(0, 0, w, h); rows = null; } }
    function tick() {
      if (!run) return; fit();
      const W = canvas.width, H = canvas.height; if (W) {
        analyser.getFloatFrequencyData(buf);
        if (!rows || rowsH !== H) { rows = rowBins(H, o, rate, buf.length); rowsH = H; }
        const cw = Math.max(1, Math.round(colw * (window.devicePixelRatio || 1)));
        g.drawImage(canvas, -cw, 0);
        const img = g.createImageData(cw, H), d = img.data;
        for (let y = 0; y < H; y++) {
          const fb = rows[y], b0 = Math.floor(fb), f = fb - b0, v = buf[b0] * (1 - f) + buf[b0 + 1] * f, li = colour(v, o.minDb, o.maxDb);
          for (let x = 0; x < cw; x++) { const p = (y * cw + x) * 4; d[p] = LUT[li]; d[p + 1] = LUT[li + 1]; d[p + 2] = LUT[li + 2]; d[p + 3] = 255; }
        }
        g.putImageData(img, W - cw, 0);
      }
      raf = requestAnimationFrame(tick);
    }
    tick();
    return {
      stop() { run = false; cancelAnimationFrame(raf); },
      setLog(v) { o.log = !!v; rows = null; const c = canvas; g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height); },
      probe(xFrac, yFrac) { return { hz: freqAtY(yFrac, o, rate) }; },
      get options() { return o; },
    };
  }

  window.GVSpec = { fft, compute, image, probe, axis, live, freqAtY, FLOOR, CEIL };
})();
