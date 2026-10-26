/* GoVibe Mix — MP3 encoder worker (lamejs, LGPL, loaded from js/vendor/lame.min.js). Receives 16 bit channel data, returns MP3 bytes. */
importScripts('vendor/lame.min.js');
self.onmessage = (e) => {
  try {
    const { ch, rate, kbps } = e.data, n = ch.length, enc = new lamejs.Mp3Encoder(n, rate, kbps), parts = [], B = 1152 * 8, len = ch[0].length;
    for (let i = 0; i < len; i += B) {
      const a = ch[0].subarray(i, i + B), out = n === 2 ? enc.encodeBuffer(a, ch[1].subarray(i, i + B)) : enc.encodeBuffer(a);
      if (out.length) parts.push(out);
      if (((i / B) & 63) === 0) self.postMessage({ progress: i / len });
    }
    const end = enc.flush(); if (end.length) parts.push(end);
    self.postMessage({ done: new Blob(parts, { type: 'audio/mpeg' }) });
  } catch (err) { self.postMessage({ error: String(err && err.message || err) }); }
};
