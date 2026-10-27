/* GoVibe Mix — background noise removal helper shared by the Audio Editor and the Video Editor.
 * GVDenoise.run(channels, sampleRate, strength 0..1, onProgress) -> cleaned Float32Array[] at the same sample rate.
 * The work is done by RNNoise in js/rnnoise-worker.js (WebAssembly, on this device). Nothing is uploaded. */
window.GVDenoise = (() => {
  const resample = (x, from, to) => {
    if (from === to) return Promise.resolve(x.slice());
    const n = Math.max(1, Math.round(x.length * to / from)), oc = new OfflineAudioContext(1, n, to), b = oc.createBuffer(1, Math.max(1, x.length), from);
    b.copyToChannel(x, 0); const s = oc.createBufferSource(); s.buffer = b; s.connect(oc.destination); s.start();
    return oc.startRendering().then((r) => r.getChannelData(0).slice());
  };
  const worker = (arrs, strength, onProgress) => new Promise((res, rej) => {
    let w; try { w = new Worker('js/rnnoise-worker.js', { type: 'module' }); } catch (e) { return rej(e); }
    w.onmessage = (e) => { if (e.data.progress != null) return onProgress(e.data.progress); w.terminate(); if (e.data.error) rej(new Error(e.data.error)); else res(e.data.chans); };
    w.onerror = (e) => { w.terminate(); rej(new Error(e.message || 'worker failed')); };
    w.postMessage({ id: 1, chans: arrs, strength }, arrs.map((a) => a.buffer));
  });
  async function run(chans, rate, strength, onProgress) {
    const seg = await Promise.all(chans.map((c) => resample(c, rate, 48000)));
    const out = await worker(seg, strength, onProgress || (() => {}));
    return Promise.all(out.map((o) => resample(o, 48000, rate)));
  }
  return { run };
})();
