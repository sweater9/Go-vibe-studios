/* GoVibe Mix — demo tracks: three short house style tracks the site synthesises itself (kick, clap, hats, bass and a minor chord), so a visitor can try Automix without any music of their own.
   Each is 32 bars: 8 bars of intro, 16 bars of full groove, 8 bars of outro. They are made on the device from code, nothing is downloaded and there is no recording or sample involved. */
window.GVDemo = (() => {
  const SONGS = [
    { name: 'Demo 1, Night Drive.wav', bpm: 124, key: '8A', root: 55.0, minor: [0, 3, 7], bass: [0, 0, 7, 0, 3, 0, 5, 7], seed: 3 },
    { name: 'Demo 2, Neon Streets.wav', bpm: 126, key: '9A', root: 41.2, minor: [0, 3, 7], bass: [0, 7, 0, 5, 0, 3, 0, 10], seed: 11 },
    { name: 'Demo 3, Afterglow.wav', bpm: 122, key: '8A', root: 55.0, minor: [0, 3, 10], bass: [0, 0, 3, 0, 7, 0, 3, 5], seed: 29 },
  ];
  const rng = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  async function make(i, rate = 44100) {
    const S = SONGS[i % SONGS.length], spb = 60 / S.bpm, bars = 32, dur = bars * 4 * spb + 1.5, oc = new OfflineAudioContext(2, Math.ceil(dur * rate), rate), r = rng(S.seed);
    const out = oc.createGain(), comp = oc.createDynamicsCompressor(); out.gain.value = 0.62; out.connect(comp); comp.connect(oc.destination);
    const nb = oc.createBuffer(1, rate, rate), nd = nb.getChannelData(0); for (let k = 0; k < nd.length; k++) nd[k] = r() * 2 - 1;
    const env = (g, t, a, peak, d) => { g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); };
    const kick = (t, v) => { const o = oc.createOscillator(), g = oc.createGain(); o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(46, t + 0.12); env(g, t, 0.003, v, 0.34); o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.4); };
    const noise = (t, type, f, a, peak, d, q = 1) => { const s = oc.createBufferSource(), fl = oc.createBiquadFilter(), g = oc.createGain(); s.buffer = nb; fl.type = type; fl.frequency.value = f; fl.Q.value = q; env(g, t, a, peak, d); s.connect(fl); fl.connect(g); g.connect(out); s.start(t, r() * 0.5); s.stop(t + a + d + 0.05); };
    const bass = (t, f, len, v) => { const o = oc.createOscillator(), fl = oc.createBiquadFilter(), g = oc.createGain(); o.type = 'sawtooth'; o.frequency.value = f; fl.type = 'lowpass'; fl.frequency.setValueAtTime(700, t); fl.frequency.exponentialRampToValueAtTime(160, t + len); env(g, t, 0.005, v, len); o.connect(fl); fl.connect(g); g.connect(out); o.start(t); o.stop(t + len + 0.1); };
    const chord = (t, len, v) => S.minor.forEach((st, k) => { for (const det of [-6, 6]) { const o = oc.createOscillator(), fl = oc.createBiquadFilter(), g = oc.createGain(); o.type = 'sawtooth'; o.frequency.value = S.root * 4 * Math.pow(2, st / 12); o.detune.value = det + k; fl.type = 'lowpass'; fl.frequency.value = 1400; env(g, t, 0.03, v, len); o.connect(fl); fl.connect(g); g.connect(out); o.start(t); o.stop(t + len + 0.1); } });
    for (let b = 0; b < bars; b++) {
      const intro = b < 8, groove = b >= 8 && b < 24, outro = b >= 24, fade = outro ? 0.5 - (b - 24) * 0.05 : 1;
      for (let beat = 0; beat < 4; beat++) {
        const t = (b * 4 + beat) * spb; kick(t, (intro ? (b < 4 ? 0.4 : 0.5) : 1) * fade);
        if (groove && (beat === 1 || beat === 3)) noise(t, 'bandpass', 1700, 0.002, 0.5, 0.16, 0.8);
        noise(t + spb / 2, 'highpass', 7500, 0.001, groove ? 0.34 : 0.16 * fade, groove && beat === 3 ? 0.18 : 0.05);
        if (groove || b >= 4) noise(t, 'highpass', 9000, 0.001, 0.08 * fade, 0.03);
        if (groove) bass(t + spb / 2, S.root * Math.pow(2, S.bass[(beat * 2 + 1) % 8] / 12), spb * 0.42, 0.9);
      }
      if (groove && b % 2 === 0) chord(b * 4 * spb, spb * 3.6, 0.07);
      if (b >= 4 && b < 8) chord(b * 4 * spb, spb * 3.6, 0.02);
    }
    const buf = await oc.startRendering();
    return { buf, name: S.name, pre: { bpm: S.bpm, key: S.key, grid: { t0: 0, period: spb, bpm: S.bpm } } };
  }
  return { make, count: SONGS.length };
})();
