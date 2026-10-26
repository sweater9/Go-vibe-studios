/* GoVibe Mix — small built in synthesizer and drum kit for the Studio. Pure Web Audio, works with a live or an offline context. */
window.GVSynth = (() => {
  const noiseCache = new WeakMap();
  const noiseBuf = (ctx) => { let b = noiseCache.get(ctx); if (!b) { b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); const d = b.getChannelData(0); let s = 1; for (let i = 0; i < d.length; i++) { s = (s * 16807) % 2147483647; d[i] = s / 1073741823 - 1; } noiseCache.set(ctx, b); } return b; };
  const noise = (ctx, t, len) => { const s = ctx.createBufferSource(); s.buffer = noiseBuf(ctx); s.loop = true; s.start(t); s.stop(t + len); return s; };
  const env = (g, t, a, d, peak) => { g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); };
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

  const DRUMS = ['Kick', 'Snare', 'Clap', 'Hat', 'Open hat', 'Tom', 'Perc'];
  const drum = {
    Kick(c, o, t, v) { const os = c.createOscillator(), g = c.createGain(); os.frequency.setValueAtTime(150, t); os.frequency.exponentialRampToValueAtTime(42, t + 0.22); env(g, t, 0.002, 0.38, v); os.connect(g).connect(o); os.start(t); os.stop(t + 0.5); },
    Snare(c, o, t, v) { const f = c.createBiquadFilter(), g = c.createGain(), os = c.createOscillator(), og = c.createGain(); f.type = 'highpass'; f.frequency.value = 1200; env(g, t, 0.002, 0.18, 0.8 * v); noise(c, t, 0.25).connect(f).connect(g).connect(o); os.frequency.value = 190; env(og, t, 0.002, 0.1, 0.5 * v); os.connect(og).connect(o); os.start(t); os.stop(t + 0.15); },
    Clap(c, o, t, v) { const f = c.createBiquadFilter(), g = c.createGain(); f.type = 'bandpass'; f.frequency.value = 1500; g.gain.setValueAtTime(0.0001, t); for (let i = 0; i < 3; i++) { g.gain.linearRampToValueAtTime(0.9 * v, t + i * 0.012 + 0.002); g.gain.exponentialRampToValueAtTime(0.2 * v, t + i * 0.012 + 0.01); } g.gain.linearRampToValueAtTime(0.7 * v, t + 0.038); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22); noise(c, t, 0.3).connect(f).connect(g).connect(o); },
    Hat(c, o, t, v) { const f = c.createBiquadFilter(), g = c.createGain(); f.type = 'highpass'; f.frequency.value = 7000; env(g, t, 0.001, 0.045, 0.5 * v); noise(c, t, 0.08).connect(f).connect(g).connect(o); },
    'Open hat'(c, o, t, v) { const f = c.createBiquadFilter(), g = c.createGain(); f.type = 'highpass'; f.frequency.value = 6000; env(g, t, 0.001, 0.3, 0.4 * v); noise(c, t, 0.4).connect(f).connect(g).connect(o); },
    Tom(c, o, t, v) { const os = c.createOscillator(), g = c.createGain(); os.frequency.setValueAtTime(190, t); os.frequency.exponentialRampToValueAtTime(95, t + 0.2); env(g, t, 0.002, 0.3, 0.8 * v); os.connect(g).connect(o); os.start(t); os.stop(t + 0.4); },
    Perc(c, o, t, v) { const os = c.createOscillator(), g = c.createGain(); os.type = 'square'; os.frequency.value = 820; env(g, t, 0.001, 0.07, 0.25 * v); os.connect(g).connect(o); os.start(t); os.stop(t + 0.1); }
  };

  const INSTS = ['Piano', 'Electric piano', 'Bass', 'Synth lead', 'Pad'];
  function tone(c, o, t, dur, m, v, type, a, rel, harm, filt) {
    const f0 = hz(m), g = c.createGain(), end = t + Math.max(0.05, dur), nodes = [];
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = filt || 8000; g.connect(lp).connect(o);
    const vel = Math.max(0.05, Math.min(1, v));
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.3 * vel, t + a); g.gain.setValueAtTime(0.3 * vel, Math.max(t + a, end)); g.gain.exponentialRampToValueAtTime(0.0001, end + rel);
    harm.forEach(([mult, amp]) => { const os = c.createOscillator(), og = c.createGain(); os.type = type; os.frequency.value = f0 * mult; og.gain.value = amp; os.connect(og).connect(g); os.start(t); os.stop(end + rel + 0.05); });
    return g;
  }
  function note(c, o, inst, m, v, t, dur) {
    v = v == null ? 0.8 : v;
    if (inst === 'Piano') { const end = t + Math.min(dur, 2.5), g = tone(c, o, t, 0.05, m, v, 'triangle', 0.003, 1.4, [[1, 1], [2, 0.35], [3, 0.12]], 5000); g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.35 * v, t + 0.004); g.gain.exponentialRampToValueAtTime(0.06 * v, t + 0.6); g.gain.setValueAtTime(0.06 * v, Math.max(t + 0.6, t + dur)); g.gain.exponentialRampToValueAtTime(0.0001, Math.max(t + 0.65, t + dur + 0.25)); }
    else if (inst === 'Electric piano') tone(c, o, t, dur, m, v, 'sine', 0.004, 0.5, [[1, 1], [2, 0.5], [4, 0.12]], 4000);
    else if (inst === 'Bass') tone(c, o, t, dur, m, v, 'sawtooth', 0.005, 0.12, [[1, 1], [0.5, 0.6]], 700);
    else if (inst === 'Synth lead') tone(c, o, t, dur, m, v, 'sawtooth', 0.01, 0.15, [[1, 0.8], [1.005, 0.8]], 5000);
    else tone(c, o, t, dur, m, v, 'sawtooth', 0.25, 0.6, [[1, 0.6], [1.007, 0.6], [0.5, 0.3]], 1800);
  }
  const click = (c, o, t, strong) => { const os = c.createOscillator(), g = c.createGain(); os.frequency.value = strong ? 1600 : 1000; env(g, t, 0.001, 0.04, strong ? 0.5 : 0.3); os.connect(g).connect(o); os.start(t); os.stop(t + 0.06); };
  return { DRUMS, INSTS, drum: (c, o, name, t, v) => drum[name](c, o, t, v == null ? 0.9 : v), note, click, hz };
})();
