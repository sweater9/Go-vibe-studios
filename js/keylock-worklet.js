/* GoVibe Mix — key lock: a granular pitch shifter that runs on the audio thread. A deck playing faster or slower changes pitch; shifting by the opposite ratio brings the pitch back,
   so tempo can change without the key changing. Two read heads move through a short delay line and cross fade with a raised cosine window. It is a simple shifter: fine for the
   small changes of a tempo match (up to about 16 percent), with a slight chorus like roughness on sustained notes. */
class GvKeyLock extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [{ name: 'ratio', defaultValue: 1, minValue: 0.5, maxValue: 2, automationRate: 'k-rate' }]; }
  constructor() {
    super(); this.N = 16384; this.buf = [new Float32Array(this.N), new Float32Array(this.N)]; this.w = 0; this.ph = 0; this.G = Math.round(0.05 * sampleRate);
    this.port.postMessage({ latency: this.G / 2 / sampleRate });
  }
  rd(c, pos) {
    const N = this.N, b = this.buf[c]; let i0 = Math.floor(pos), f = pos - i0; i0 = ((i0 % N) + N) % N; const i1 = (i0 + 1) % N;
    return b[i0] * (1 - f) + b[i1] * f;
  }
  process(inputs, outputs, params) {
    const inp = inputs[0], out = outputs[0]; if (!out || !out.length) return true;
    const r = params.ratio[0], N = this.N, G = this.G, nch = Math.min(2, out.length), len = out[0].length, step = (1 - r) / G;
    for (let i = 0; i < len; i++) {
      const w = this.w, p1 = this.ph, p2 = (p1 + 0.5) % 1, g1 = 0.5 - 0.5 * Math.cos(2 * Math.PI * p1), g2 = 1 - g1, d1 = p1 * G, d2 = p2 * G;
      for (let c = 0; c < nch; c++) this.buf[c][w] = inp && inp.length ? (inp[c] || inp[0])[i] : 0;
      for (let c = 0; c < nch; c++) out[c][i] = g1 * this.rd(c, w - d1) + g2 * this.rd(c, w - d2);
      this.w = (w + 1) % N; this.ph = p1 + step; if (this.ph >= 1) this.ph -= 1; else if (this.ph < 0) this.ph += 1;
    }
    return true;
  }
}
registerProcessor('gv-keylock', GvKeyLock);
