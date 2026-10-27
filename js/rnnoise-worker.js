/* GoVibe Mix — background noise removal worker. Runs RNNoise (a small neural network, compiled to WebAssembly) on audio at 48 kHz.
 * Input: { id, chans: Float32Array[] (48 kHz), strength: 0..1 }. Output: the cleaned channels, aligned with the input. Nothing leaves the device. */
import createRNNWasmModuleSync from './vendor/rnnoise-sync.js';
const FRAME = 480, DELAY = 960;      // RNNoise works on 10 ms frames and its output trails the input by 960 samples (20 ms)
let M = null;
async function engine() { if (!M) { M = createRNNWasmModuleSync(); await M.ready; } return M; }
async function clean(x, strength, report) {
  const m = await engine(), st = m._rnnoise_create(0), ptr = m._malloc(FRAME * 4), n = x.length, total = n + DELAY, frames = Math.ceil(total / FRAME), wet = new Float32Array(n);
  try {
    for (let f = 0; f < frames; f++) {
      const o = f * FRAME, base = ptr >> 2; let h = m.HEAPF32;
      for (let i = 0; i < FRAME; i++) h[base + i] = (o + i < n ? x[o + i] : 0) * 32768;
      m._rnnoise_process_frame(st, ptr, ptr); h = m.HEAPF32;
      for (let i = 0; i < FRAME; i++) { const j = o + i - DELAY; if (j >= 0 && j < n) wet[j] = h[base + i] / 32768; }
      if (f % 400 === 0) report(f / frames);
    }
  } finally { m._rnnoise_destroy(st); m._free(ptr); }
  const out = new Float32Array(n), s = Math.max(0, Math.min(1, strength));
  for (let i = 0; i < n; i++) out[i] = x[i] * (1 - s) + wet[i] * s;
  return out;
}
self.onmessage = async (e) => {
  const { id, chans, strength } = e.data;
  try {
    const out = [];
    for (let c = 0; c < chans.length; c++) out.push(await clean(chans[c], strength, (p) => self.postMessage({ id, progress: (c + p) / chans.length })));
    self.postMessage({ id, chans: out }, out.map((a) => a.buffer));
  } catch (err) { self.postMessage({ id, error: String((err && err.message) || err) }); }
};
