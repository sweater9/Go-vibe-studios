/* Captures the master output as float samples for lossless WAV recording. Runs on the audio thread. */
class GvRec extends AudioWorkletProcessor {
  constructor() {
    super(); this.on = false; this.armed = false; this.startAt = 0; this.endAt = Infinity; this.skip = 0; this.l = new Float32Array(4096); this.r = new Float32Array(4096); this.n = 0;
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d === 'start') { this.on = true; this.armed = false; this.n = 0; }
      /* the Studio arms a take at an exact frame of the audio clock, optionally with an exact end frame (punch out) */
      else if (d && d.cmd === 'arm') { this.on = false; this.armed = true; this.startAt = d.at; this.endAt = d.end == null ? Infinity : d.end; this.skip = 0; this.n = 0; }
      else if (d === 'flush') { this.on = false; this.armed = false; this.send(); this.port.postMessage({ done: true }); }
    };
  }
  send() { if (!this.n) return; const l = this.l.slice(0, this.n), r = this.r.slice(0, this.n); this.n = 0; this.port.postMessage({ l, r }, [l.buffer, r.buffer]); }
  process(inputs) {
    const i = inputs[0];
    if (this.armed && !this.on && currentFrame + 128 > this.startAt) { this.on = true; this.skip = Math.max(0, this.startAt - currentFrame); }
    if (this.on && i && i[0]) {
      const L = i[0], R = i[1] || i[0];
      for (let k = this.skip || 0; k < L.length; k++) {
        if (currentFrame + k >= this.endAt) { this.on = false; this.armed = false; this.send(); this.port.postMessage({ done: true }); return true; }
        this.l[this.n] = L[k]; this.r[this.n] = R[k]; if (++this.n === 4096) this.send();
      }
      this.skip = 0;
    }
    return true;
  }
}
registerProcessor('gv-rec', GvRec);
