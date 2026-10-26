/* GoVibe Mix — audio analysis shared by the DJ console and the BPM and key finder: tempo, beat grid and musical key (Camelot). No dependencies. */
(() => {
  /* ---------- BPM detection (onset autocorrelation) ---------- */
  function detectBPM(buf) {
    const sr = buf.sampleRate, ch = buf.getChannelData(0);
    const hop = Math.round(sr / 100);                       // 10 ms frames
    const span = Math.min(buf.length, sr * 90);
    const from = Math.floor((buf.length - span) / 2);
    const frames = Math.floor(span / hop);
    if (frames < 400) return null;
    const env = new Float32Array(frames);
    for (let f = 0; f < frames; f++) {
      let s = 0; const o = from + f * hop;
      for (let i = 0; i < hop; i++) { const v = ch[o + i]; s += v * v; }
      env[f] = Math.sqrt(s / hop);
    }
    const on = new Float32Array(frames);
    for (let f = 1; f < frames; f++) on[f] = Math.max(0, env[f] - env[f - 1]);
    const at = (x) => { const i = Math.floor(x), fr = x - i; return i + 1 < frames ? on[i] * (1 - fr) + on[i + 1] * fr : 0; };
    const ac = (lag) => { let s = 0; for (let i = 0; i + 2 * lag < frames; i++) s += on[i] * at(i + lag); return s; };
    let best = 0, bestBpm = null;
    for (let bpm = 75; bpm <= 175; bpm += 0.1) {
      const lag = 6000 / bpm, score = ac(lag) + 0.5 * ac(2 * lag);
      if (score > best) { best = score; bestBpm = bpm; }
    }
    return best > 0 ? bestBpm : null;
  }

  /* ---------- beat grid: refine BPM and find where the beats fall ---------- */
  function detectGrid(buf, bpm0) {
    if (!bpm0) return null;
    const sr = buf.sampleRate, ch = buf.getChannelData(0), hop = Math.max(1, Math.round(sr / 200));    // 5 ms frames
    const frames = Math.min(Math.floor(buf.length / hop), Math.floor(150 * sr / hop));
    if (frames < 800) return null;
    const env = new Float32Array(frames), on = new Float32Array(frames);
    for (let f = 0; f < frames; f++) { let sum = 0; const o = f * hop; for (let i = 0; i < hop; i++) { const v = ch[o + i]; sum += v * v; } env[f] = Math.sqrt(sum / hop); }
    for (let f = 1; f < frames; f++) on[f] = Math.max(0, env[f] - env[f - 1]);
    const sm = new Float32Array(frames); for (let f = 1; f < frames - 1; f++) sm[f] = on[f] + 0.5 * (on[f - 1] + on[f + 1]);
    const scan = (bpm) => {
      const p = 60 * sr / (hop * bpm); let best = -1, ph0 = 0;
      for (let ph = 0; ph < p; ph++) { let sum = 0, n = 0; for (let t = ph; t < frames - 1; t += p) { sum += sm[Math.round(t)]; n++; } const sc = sum / n; if (sc > best) { best = sc; ph0 = ph; } }
      return [best, ph0];
    };
    const res = []; let top = -1;
    for (let d = -60; d <= 60; d++) { const bpm = bpm0 + d * 0.01, [sc] = scan(bpm); res.push([bpm, sc]); if (sc > top) top = sc; }
    const near = res.filter((r) => r[1] >= top * 0.995).map((r) => r[0]).sort((a, b) => a - b);      // centre of the best plateau
    const bBpm = near[near.length >> 1], bPhase = scan(bBpm)[1] + 0.5;
    return { bpm: bBpm, t0: bPhase * hop / sr, period: 60 / bBpm };
  }

  /* ---------- key detection (chroma + Krumhansl-Schmuckler profiles) ---------- */
  const CAM_MAJ = [8, 3, 10, 5, 12, 7, 2, 9, 4, 11, 6, 1], CAM_MIN = [5, 12, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10];
  const KS_MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88], KS_MIN = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
  function detectKey(buf) {
    const sr = buf.sampleRate, ch = buf.getChannelData(0), N = 8192, hopS = Math.round(sr * 0.5);
    const span = Math.min(buf.length, sr * 40), from = Math.floor((buf.length - span) / 2);
    if (span < N * 4) return null;
    const chroma = new Float64Array(12), win = new Float32Array(N);
    for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
    const coef = []; for (let m = 36; m < 96; m++) coef.push({ pc: m % 12, c: 2 * Math.cos(2 * Math.PI * 440 * Math.pow(2, (m - 69) / 12) / sr) });
    for (let o = from; o + N <= from + span; o += hopS) {
      const fr = new Float32Array(N); for (let i = 0; i < N; i++) fr[i] = ch[o + i] * win[i];
      for (const { pc, c } of coef) { let s1 = 0, s2 = 0; for (let i = 0; i < N; i++) { const s0 = fr[i] + c * s1 - s2; s2 = s1; s1 = s0; } chroma[pc] += Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - c * s1 * s2)); }
    }
    const tot = chroma.reduce((a, b) => a + b, 0); if (!(tot > 0)) return null;
    const corr = (prof, k) => { let ma = 0, mb = 0; for (let i = 0; i < 12; i++) { ma += chroma[(i + k) % 12]; mb += prof[i]; } ma /= 12; mb /= 12; let n = 0, da = 0, db = 0; for (let i = 0; i < 12; i++) { const a = chroma[(i + k) % 12] - ma, b = prof[i] - mb; n += a * b; da += a * a; db += b * b; } return n / Math.sqrt(da * db || 1); };
    let best = -2, res = null;
    for (let k = 0; k < 12; k++) {
      const a = corr(KS_MAJ, k), b = corr(KS_MIN, k);
      if (a > best) { best = a; res = CAM_MAJ[k] + 'B'; }
      if (b > best) { best = b; res = CAM_MIN[k] + 'A'; }
    }
    return res;
  }
  function keysMatch(a, b) {
    if (!a || !b) return null;
    const na = +a.slice(0, -1), nb = +b.slice(0, -1), d = Math.min((na - nb + 12) % 12, (nb - na + 12) % 12);
    return a === b ? 'same key' : (a[a.length - 1] === b[b.length - 1] && d === 1) || (na === nb) ? 'compatible' : 'clash';
  }

  const NAMES_MAJ = ['C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'D♭', 'A♭', 'E♭', 'B♭', 'F'];
  const keyName = (cam) => { if (!cam) return ''; const n = +cam.slice(0, -1), minor = cam.slice(-1) === 'A', i = CAM_MAJ.indexOf(minor ? ((n + 2) % 12) + 1 : n); return i < 0 ? '' : ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'][i] + (minor ? ' minor' : ' major'); };
  window.GVAnalyze = { detectBPM, detectGrid, detectKey, keysMatch, keyName };
})();
