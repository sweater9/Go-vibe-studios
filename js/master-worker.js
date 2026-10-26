/* GoVibe Mix — mastering worker. Receives {op, chans, rate, opts}. */
importScripts('master-dsp.js');
self.onmessage = (e) => {
  try {
    const { op, chans, rate, opts } = e.data;
    if (op === 'analyze') self.postMessage({ op, result: GVMaster.analyze(chans, rate) });
    else { const r = GVMaster.master(chans, rate, opts), a = GVMaster.analyze(r.chans, rate); self.postMessage({ op, result: a, chans: r.chans, gainDb: r.gainDb, maxReduction: r.maxReduction }, r.chans.map((c) => c.buffer)); }
  } catch (err) { self.postMessage({ error: String(err && err.message || err) }); }
};
