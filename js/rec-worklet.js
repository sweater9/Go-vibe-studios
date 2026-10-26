/* Captures the master output as float samples for lossless WAV recording. Runs on the audio thread. */
class GvRec extends AudioWorkletProcessor {
  constructor() {
    super(); this.on = false; this.l = new Float32Array(4096); this.r = new Float32Array(4096); this.n = 0;
    this.port.onmessage = (e) => {
      if (e.data === 'start') { this.on = true; this.n = 0; }
      else if (e.data === 'flush') { this.on = false; this.send(); this.port.postMessage({ done: true }); }
    };
  }
  send() { if (!this.n) return; const l = this.l.slice(0, this.n), r = this.r.slice(0, this.n); this.n = 0; this.port.postMessage({ l, r }, [l.buffer, r.buffer]); }
  process(inputs) {
    const i = inputs[0];
    if (this.on && i && i[0]) { const L = i[0], R = i[1] || i[0]; for (let k = 0; k < L.length; k++) { this.l[this.n] = L[k]; this.r[this.n] = R[k]; if (++this.n === 4096) this.send(); } }
    return true;
  }
}
registerProcessor('gv-rec', GvRec);
