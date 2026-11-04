/* GoVibe Mix — runs the vocal remover off the main thread: ONNX Runtime Web (WebAssembly, from this site) plus the Open-Unmix vocals model that the person downloads once.
   Messages in: { load: ArrayBuffer } then { run: { L, R } }. Messages out: { ready }, { progress }, { done: { VL, VR } }, { error }. */
import * as ort from '../vendor/ort/ort.wasm.min.mjs';
import { separate } from './unmix-dsp.js';
ort.env.wasm.wasmPaths = new URL('../vendor/ort/', import.meta.url).href; ort.env.wasm.numThreads = 1; ort.env.wasm.proxy = false;
let session = null;
const model = async (mag, T) => {
  const input = new ort.Tensor('float32', mag, [1, 2, 2049, T]), out = await session.run({ [session.inputNames[0]]: input });
  return out[session.outputNames[0]].data;
};
self.onmessage = async (e) => {
  try {
    if (e.data.load) { session = await ort.InferenceSession.create(new Uint8Array(e.data.load), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' }); self.postMessage({ ready: true }); }
    else if (e.data.run) {
      if (!session) throw new Error('the model is not loaded yet');
      const { L, R } = e.data.run, r = await separate(L, R, model, (p) => self.postMessage({ progress: p }));
      self.postMessage({ done: r }, [r.VL.buffer, r.VR.buffer]);
    }
  } catch (err) { self.postMessage({ error: String((err && err.message) || err) }); }
};
