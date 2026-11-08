/* GoVibeMix — DJ sound effects made from scratch (noise and oscillators): risers, impacts, crashes and snare rolls. They take any audio context, so the live Automix and the
   Mix maker's offline render use the same sounds. Each function returns the source nodes it started, so a caller can stop them early. Nothing is loaded from anywhere. */
window.GVDjFx = (() => {
  const noise = (c, len) => { const b = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * len)), c.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; const s = c.createBufferSource(); s.buffer = b; return s; };
  function riser(c, dest, t, dur) {
    const n = noise(c, dur + 0.3), f = c.createBiquadFilter(), g = c.createGain(), o = c.createOscillator(), og = c.createGain();
    f.type = 'bandpass'; f.Q.value = 2.2; f.frequency.setValueAtTime(250, t); f.frequency.exponentialRampToValueAtTime(9000, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.32, t + dur * 0.96); g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.05);
    o.type = 'sawtooth'; o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(1760, t + dur); og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.08, t + dur * 0.96); og.gain.linearRampToValueAtTime(0.0001, t + dur + 0.05);
    n.connect(f); f.connect(g); g.connect(dest); o.connect(og); og.connect(dest); n.start(t); n.stop(t + dur + 0.1); o.start(t); o.stop(t + dur + 0.1);
    return [n, o];
  }
  function crash(c, dest, t) {
    const n = noise(c, 2), f = c.createBiquadFilter(), g = c.createGain(); f.type = 'highpass'; f.frequency.value = 5200; g.gain.setValueAtTime(0.32, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
    n.connect(f); f.connect(g); g.connect(dest); n.start(t); n.stop(t + 2); return [n];
  }
  function impact(c, dest, t) {
    const o = c.createOscillator(), g = c.createGain(), n = noise(c, 0.3), f = c.createBiquadFilter(), ng = c.createGain();
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.32); g.gain.setValueAtTime(0.85, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    f.type = 'lowpass'; f.frequency.value = 3500; ng.gain.setValueAtTime(0.3, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    o.connect(g); g.connect(dest); n.connect(f); f.connect(ng); ng.connect(dest); o.start(t); o.stop(t + 0.8); n.start(t); n.stop(t + 0.3);
    return [o, n, ...crash(c, dest, t)];
  }
  /* noise hits getting faster (eighths, sixteenths, thirty seconds) and louder, from t0 until tB; bs is the length of a beat in seconds */
  function snareRoll(c, dest, t0, tB, bs) {
    const out = [];
    for (let t = t0; t < tB - 0.02;) {
      const left = (tB - t) / bs, step = left > 2 ? bs / 2 : left > 1 ? bs / 4 : bs / 8, amp = 0.1 + 0.3 * (1 - left / ((tB - t0) / bs)), n = noise(c, 0.12), f = c.createBiquadFilter(), g = c.createGain();
      f.type = 'highpass'; f.frequency.value = 1800; g.gain.setValueAtTime(amp, t); g.gain.exponentialRampToValueAtTime(0.0001, t + Math.min(0.1, step * 0.9));
      n.connect(f); f.connect(g); g.connect(dest); n.start(t); n.stop(t + 0.12); out.push(n); t += step;
    }
    return out;
  }
  return { noise, riser, crash, impact, snareRoll };
})();
