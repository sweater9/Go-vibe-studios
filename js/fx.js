/* GoVibe Mix — shared effects engine. Plain Web Audio node graphs, so the same code runs live and in an OfflineAudioContext.
 * Used by the Studio mixer today and written to be reused by the DJ decks and the Video editor. Nothing here touches the DOM. */
window.GVFx = (() => {
  const num = (key, label, min, max, def, unit, step) => ({ key, label, min, max, def, unit: unit || '', step: step || (max - min > 50 ? 1 : 0.01) });
  const sel = (key, label, options, def) => ({ key, label, options, def, select: true });
  const SYNCS = [[0, 'Free (ms)'], [0.25, '1/16'], [0.5, '1/8'], [0.75, 'Dotted 1/8'], [1, '1/4'], [1.5, 'Dotted 1/4']];
  const DEFS = {
    eq: { name: 'EQ', params: [num('low', 'Low', -18, 18, 0, 'dB', 0.5), num('mid', 'Mid', -18, 18, 0, 'dB', 0.5), num('midf', 'Mid frequency', 200, 5000, 1000, 'Hz', 10), num('high', 'High', -18, 18, 0, 'dB', 0.5)] },
    comp: { name: 'Compressor', params: [num('thresh', 'Threshold', -60, 0, -20, 'dB', 1), num('ratio', 'Ratio', 1, 20, 3, ':1', 0.5), num('attack', 'Attack', 1, 100, 10, 'ms', 1), num('release', 'Release', 20, 1000, 160, 'ms', 5), num('makeup', 'Make up gain', 0, 24, 0, 'dB', 0.5), num('mix', 'Mix', 0, 1, 1, '', 0.01)] },
    sat: { name: 'Saturation', params: [num('drive', 'Drive', 0, 1, 0.3, '', 0.01), num('tone', 'Tone', 1000, 18000, 12000, 'Hz', 100), num('mix', 'Mix', 0, 1, 1, '', 0.01)] },
    chorus: { name: 'Chorus', params: [num('rate', 'Rate', 0.1, 6, 0.8, 'Hz', 0.1), num('depth', 'Depth', 0, 1, 0.5, '', 0.01), num('mix', 'Mix', 0, 1, 0.4, '', 0.01)] },
    delay: { name: 'Delay', params: [num('time', 'Time', 20, 1500, 350, 'ms', 5), sel('sync', 'Tempo sync', SYNCS, 0), num('fb', 'Feedback', 0, 0.9, 0.35, '', 0.01), num('tone', 'Tone', 500, 12000, 5000, 'Hz', 100), num('mix', 'Mix', 0, 1, 0.3, '', 0.01)] },
    reverb: { name: 'Reverb', params: [num('size', 'Size', 0.3, 6, 1.8, 's', 0.1), num('damp', 'Damping', 0, 1, 0.5, '', 0.01), num('predelay', 'Pre delay', 0, 100, 15, 'ms', 1), num('mix', 'Mix', 0, 1, 0.25, '', 0.01)] }
  };
  const TYPES = Object.keys(DEFS);
  /* the shared send buses start from these. mix is the return level, because a bus is wet only. */
  const BUS = { rev: { type: 'reverb', name: 'Reverb return', p: { size: 2.2, damp: 0.5, predelay: 20, mix: 1 } }, dly: { type: 'delay', name: 'Delay return', p: { time: 350, sync: 0.75, fb: 0.4, tone: 4500, mix: 1 } } };

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  /* fill missing values with defaults and keep every value inside its range */
  function full(type, p) {
    const d = DEFS[type], out = {}; p = p || {};
    d.params.forEach((q) => { let v = p[q.key]; if (typeof v !== 'number' || !isFinite(v)) v = q.def; out[q.key] = q.select ? (q.options.some((o) => o[0] === v) ? v : q.def) : clamp(v, q.min, q.max); });
    return out;
  }
  function defaults(type) { return full(type, {}); }

  /* smooth when changing while playing, exact when building */
  function ap(param, v, init, ctx) { if (init) param.value = v; else param.setTargetAtTime(v, ctx.currentTime, 0.015); }

  /* seeded noise so the reverb sounds identical live and in a file export */
  function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const irCache = new Map();
  function impulse(ctx, size, damp) {
    const key = ctx.sampleRate + '|' + size.toFixed(2) + '|' + damp.toFixed(2); if (irCache.has(key)) return irCache.get(key);
    const rate = ctx.sampleRate, len = Math.max(256, Math.floor(size * rate)), buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch), r = rng(1234 + ch * 777); let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len, x = r() * 2 - 1, k = 1 - damp * (0.25 + 0.7 * t);
        lp += (x - lp) * Math.max(0.04, k);
        const fade = Math.min(1, i / (rate * 0.003));
        d[i] = lp * Math.exp(-6.9 * t) * fade;
      }
    }
    if (irCache.size > 24) irCache.delete(irCache.keys().next().value);
    irCache.set(key, buf); return buf;
  }

  /* ---------- the effects (cores). A core has in, out, set(values, init) and stop(). wetOnly drops the dry path (used for send buses). ---------- */
  function mixNodes(ctx, o, xfade) {
    const inn = ctx.createGain(), outn = ctx.createGain(), dry = ctx.createGain(), wet = ctx.createGain();
    inn.connect(dry).connect(outn); wet.connect(outn);
    return { inn, outn, dry, wet, setMix(m, init) { if (o.wetOnly) { dry.gain.value = 0; ap(wet.gain, m, init, ctx); } else if (xfade) { ap(dry.gain, 1 - m, init, ctx); ap(wet.gain, m, init, ctx); } else { dry.gain.value = 1; ap(wet.gain, m, init, ctx); } } };
  }
  const CORES = {
    eq(ctx) {
      const lo = ctx.createBiquadFilter(), mi = ctx.createBiquadFilter(), hi = ctx.createBiquadFilter();
      lo.type = 'lowshelf'; lo.frequency.value = 120; mi.type = 'peaking'; mi.Q.value = 0.9; hi.type = 'highshelf'; hi.frequency.value = 6500; lo.connect(mi).connect(hi);
      return { in: lo, out: hi, set(v, init) { ap(lo.gain, v.low, init, ctx); ap(mi.gain, v.mid, init, ctx); ap(mi.frequency, v.midf, init, ctx); ap(hi.gain, v.high, init, ctx); }, stop() {} };
    },
    comp(ctx, o) {
      const m = mixNodes(ctx, o, true), c = ctx.createDynamicsCompressor(), mk = ctx.createGain(); c.knee.value = 6; m.inn.connect(c); c.connect(mk).connect(m.wet);
      return { in: m.inn, out: m.outn, set(v, init) { c.threshold.value = v.thresh; c.ratio.value = v.ratio; c.attack.value = v.attack / 1000; c.release.value = v.release / 1000; ap(mk.gain, Math.pow(10, v.makeup / 20), init, ctx); m.setMix(v.mix, init); }, stop() {} };
    },
    sat(ctx, o) {
      const m = mixNodes(ctx, o, true), pre = ctx.createGain(), sh = ctx.createWaveShaper(), post = ctx.createGain(), lp = ctx.createBiquadFilter(), n = 4096, curve = new Float32Array(n);
      for (let i = 0; i < n; i++) curve[i] = Math.tanh(4 * (i / (n - 1) * 2 - 1));
      sh.curve = curve; sh.oversample = '4x'; lp.type = 'lowpass'; lp.Q.value = 0.5; m.inn.connect(pre).connect(sh).connect(post).connect(lp).connect(m.wet);
      return { in: m.inn, out: m.outn, set(v, init) { const g = 1 + v.drive * 14; ap(pre.gain, g / 4, init, ctx); ap(post.gain, 1 / Math.sqrt(g), init, ctx); ap(lp.frequency, v.tone, init, ctx); m.setMix(v.mix, init); }, stop() {} };
    },
    chorus(ctx, o) {
      const m = mixNodes(ctx, o, false), dL = ctx.createDelay(0.06), dR = ctx.createDelay(0.06), mg = ctx.createChannelMerger(2), lfo = ctx.createOscillator(), dep = ctx.createGain(), inv = ctx.createGain();
      dL.delayTime.value = 0.018; dR.delayTime.value = 0.024; lfo.type = 'sine'; lfo.connect(dep); dep.connect(dL.delayTime); dep.connect(inv); inv.gain.value = -1; inv.connect(dR.delayTime);
      m.inn.connect(dL).connect(mg, 0, 0); m.inn.connect(dR).connect(mg, 0, 1); mg.connect(m.wet); lfo.start();
      return { in: m.inn, out: m.outn, set(v, init) { ap(lfo.frequency, v.rate, init, ctx); ap(dep.gain, v.depth * 0.007, init, ctx); m.setMix(v.mix, init); }, stop() { try { lfo.stop(); } catch (_) { /* already stopped */ } } };
    },
    delay(ctx, o) {
      const m = mixNodes(ctx, o, false), d = ctx.createDelay(3), fb = ctx.createGain(), tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.Q.value = 0.4;
      m.inn.connect(d); d.connect(tone); tone.connect(m.wet); tone.connect(fb); fb.connect(d);
      return { in: m.inn, out: m.outn, set(v, init) { const t = v.sync > 0 ? v.sync * 60 / (o.bpm || 120) : v.time / 1000; ap(d.delayTime, clamp(t, 0.02, 2.9), init, ctx); ap(fb.gain, v.fb, init, ctx); ap(tone.frequency, v.tone, init, ctx); m.setMix(v.mix, init); }, stop() {} };
    },
    reverb(ctx, o) {
      const m = mixNodes(ctx, o, false), pre = ctx.createDelay(0.2), conv = ctx.createConvolver(); let last = '';
      m.inn.connect(pre).connect(conv).connect(m.wet);
      return { in: m.inn, out: m.outn, set(v, init) { ap(pre.delayTime, v.predelay / 1000, init, ctx); const k = v.size + '|' + v.damp; if (k !== last) { last = k; conv.buffer = impulse(ctx, v.size, v.damp); } m.setMix(v.mix * 3, init); }, stop() {} };
    }
  };

  /* a bus is a core on its own: wet only, no bypass */
  function bus(ctx, type, params, o) { const c = CORES[type](ctx, Object.assign({}, o, { wetOnly: true })); c.set(full(type, params), true); c.type = type; return c; }
  /* an insert effect: the core plus a bypass that crossfades, so switching on and off never clicks */
  function make(ctx, type, params, o) {
    o = o || {}; const core = CORES[type](ctx, o), inn = ctx.createGain(), outn = ctx.createGain(), byp = ctx.createGain(), act = ctx.createGain();
    inn.connect(byp).connect(outn); inn.connect(core.in); core.out.connect(act).connect(outn);
    const slot = { type, in: inn, out: outn, set(v, init) { core.set(full(type, v), !!init); }, setOn(on, init) { ap(byp.gain, on ? 0 : 1, init, ctx); ap(act.gain, on ? 1 : 0, init, ctx); }, stop() { core.stop(); } };
    slot.set(params, true); slot.setOn(o.on !== false, true); return slot;
  }
  /* seconds of sound that can still ring after the last clip ends, so exports are not cut off */
  function tailOf(fx, sends, bpm, sendsUsed) {
    let t = 0; const add = (type, p) => { p = full(type, p); if (type === 'reverb') t = Math.max(t, p.size + p.predelay / 1000); if (type === 'delay') { const ms = (p.sync > 0 ? p.sync * 60 / (bpm || 120) : p.time / 1000), f = Math.min(0.9, p.fb); t = Math.max(t, f > 0.02 ? Math.min(6, ms * Math.ceil(Math.log(0.001) / Math.log(f))) : ms); } };
    (fx || []).forEach((f) => { if (f.on !== false) add(f.type, f.p); });
    if (sendsUsed && sendsUsed.rev) add('reverb', sends && sends.rev); if (sendsUsed && sendsUsed.dly) add('delay', sends && sends.dly);
    return Math.min(8, t);
  }
  return { DEFS, TYPES, BUS, SYNCS, full, defaults, make, bus, tailOf };
})();
