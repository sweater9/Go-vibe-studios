/* GoVibe Mix — Studio core: project model, scheduling and offline rendering. No DOM here, so the same code plays live and renders to a file. */
window.GVStudioCore = (() => {
  const uid = () => Math.random().toString(36).slice(2, 10);
  const COLORS = ['#22d3ee', '#a78bfa', '#f472b6', '#34d399', '#fbbf24', '#fb7185', '#60a5fa', '#f97316'];
  const DRUMS = () => GVSynth.DRUMS;

  const SIGS = [[2, 4], [3, 4], [4, 4], [5, 4], [6, 8], [7, 8], [12, 8]];
  const sigOk = (g) => Array.isArray(g) && SIGS.some((x) => x[0] === g[0] && x[1] === g[1]);
  /* length of a bar in quarter note beats, and of one pulse (the bottom number of the time signature) */
  const barBeats = (p) => (sigOk(p.sig) ? p.sig[0] * 4 / p.sig[1] : 4);
  function newProject(name) { return { v: 1, id: uid(), name: name || 'Untitled project', bpm: 120, sig: [4, 4], markers: [], tracks: [], assets: {}, loop: { on: false, a: 0, b: 0 }, master: 0.9, limiter: true, mfx: [], sends: { rev: Object.assign({}, FX().BUS.rev.p), dly: Object.assign({}, FX().BUS.dly.p) } }; }
  function newTrack(p, type) {
    const n = p.tracks.filter((t) => t.type === type).length + 1, label = type === 'audio' ? 'Audio' : type === 'midi' ? 'Keys' : 'Drums';
    return { id: uid(), type, name: label + ' ' + n, vol: 0.8, pan: 0, mute: false, solo: false, color: COLORS[p.tracks.length % COLORS.length], inst: type === 'midi' ? 'Piano' : undefined, fx: [], sendR: 0, sendD: 0, clips: [] };
  }
  const spb = (p) => 60 / p.bpm;
  const clipEnd = (c) => c.start + c.dur;
  function projectEnd(p) { let e = 0; p.tracks.forEach((t) => t.clips.forEach((c) => { e = Math.max(e, clipEnd(c)); })); return e; }
  const anySolo = (p) => p.tracks.some((t) => t.solo);
  const audible = (p, t) => !t.mute && (!anySolo(p) || t.solo);

  /* ---------- mixer data. Older projects have none of this, so ensureMix fills it in. ---------- */
  const FX = () => window.GVFx;
  function ensureMix(p) {
    if (!sigOk(p.sig)) p.sig = [4, 4]; if (!Array.isArray(p.markers)) p.markers = [];
    if (!Array.isArray(p.mfx)) p.mfx = [];
    if (!p.sends) p.sends = {};
    ['rev', 'dly'].forEach((k) => { if (!p.sends[k]) p.sends[k] = Object.assign({}, FX().BUS[k].p); });
    p.tracks.forEach((t) => { if (!Array.isArray(t.fx)) t.fx = []; if (typeof t.sendR !== 'number') t.sendR = 0; if (typeof t.sendD !== 'number') t.sendD = 0; });
    return p;
  }
  function newFx(type) { return { id: uid(), type, on: true, p: FX().defaults(type) }; }
  const sendsUsed = (p) => ({ rev: p.tracks.some((t) => t.sendR > 0 && t.clips.length), dly: p.tracks.some((t) => t.sendD > 0 && t.clips.length) });
  const fxTail = (p) => { const all = [].concat(p.mfx || []); p.tracks.forEach((t) => { if (t.clips.length) all.push(...(t.fx || [])); }); return FX().tailOf(all, p.sends, p.bpm, sendsUsed(p)); };

  /* ---------- graph ---------- */
  function chain(ctx, list, bpm) {
    const slots = [], first = ctx.createGain(); let last = first;
    (list || []).forEach((f) => { if (!FX().DEFS[f.type]) return; const s = FX().make(ctx, f.type, f.p, { bpm, on: f.on !== false }); last.connect(s.in); last = s.out; slots.push({ id: f.id, slot: s }); });
    return { in: first, out: last, slots };
  }
  function buildGraph(ctx, dest, p, opt) {
    opt = opt || {}; ensureMix(p);
    const master = ctx.createGain(); master.gain.value = p.master;
    let out = master;
    if (p.limiter !== false) { const lim = ctx.createDynamicsCompressor(); lim.threshold.value = -1.5; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.1; master.connect(lim); out = lim; }
    out.connect(dest);
    /* tracks sum into mixIn, then the master effects, then the master fader */
    const mixIn = ctx.createGain(), mchain = chain(ctx, p.mfx, p.bpm); mixIn.connect(mchain.in); mchain.out.connect(master);
    const rev = FX().bus(ctx, 'reverb', p.sends.rev, { bpm: p.bpm }), dly = FX().bus(ctx, 'delay', p.sends.dly, { bpm: p.bpm }); rev.out.connect(mixIn); dly.out.connect(mixIn);
    const tracks = {};
    p.tracks.forEach((t) => {
      const input = ctx.createGain(), ch = chain(ctx, t.fx, p.bpm), gain = ctx.createGain(), pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null, sR = ctx.createGain(), sD = ctx.createGain();
      /* every channel is stereo from the first node, so adding an effect never changes the level. Mono sources keep the old 3 dB centre pan level. */
      input.channelCount = 2; input.channelCountMode = 'explicit'; input.channelInterpretation = 'speakers'; input.gain.value = t.type === 'audio' ? 1 : Math.SQRT1_2;
      gain.gain.value = (opt.onlyTrack ? opt.onlyTrack === t.id : audible(p, t)) ? t.vol : 0;
      input.connect(ch.in); ch.out.connect(gain);
      const post = pan || gain; if (pan) { pan.pan.value = t.pan; gain.connect(pan); } post.connect(mixIn);
      sR.gain.value = t.sendR; sD.gain.value = t.sendD; post.connect(sR).connect(rev.in); post.connect(sD).connect(dly.in);
      tracks[t.id] = { in: input, gain, pan, fx: ch.slots, sR, sD };
    });
    const stops = [rev, dly, ...mchain.slots.map((x) => x.slot)]; Object.keys(tracks).forEach((id) => tracks[id].fx.forEach((x) => stops.push(x.slot)));
    return { master, out, tracks, mixIn, mfx: mchain.slots, rev, dly, dispose() { stops.forEach((s) => { try { s.stop(); } catch (_) { /* already stopped */ } }); } };
  }
  function applyFxList(slots, list) { (list || []).forEach((f) => { const s = slots.find((x) => x.id === f.id); if (s) { s.slot.set(f.p, false); s.slot.setOn(f.on !== false, false); } }); }
  function applyMix(graph, p, t) {
    const n = graph.tracks[t.id]; if (!n) return; n.gain.gain.value = audible(p, t) ? t.vol : 0; if (n.pan) n.pan.pan.value = t.pan;
    n.sR.gain.value = t.sendR || 0; n.sD.gain.value = t.sendD || 0; applyFxList(n.fx, t.fx);
  }
  /* master effects, the two send buses and the master fader */
  function applyMaster(graph, p) { ensureMix(p); graph.master.gain.value = p.master; applyFxList(graph.mfx, p.mfx); graph.rev.set(FX().full('reverb', p.sends.rev), false); graph.dly.set(FX().full('delay', p.sends.dly), false); }

  /* ---------- scheduling ---------- */
  function schedAudio(ctx, node, c, buf, seg, live) {
    const s = Math.max(seg.from, c.start), e = Math.min(seg.to, clipEnd(c)); if (e <= s + 0.001 || !buf) return;
    const src = ctx.createBufferSource(), g = ctx.createGain(), when = seg.when + (s - seg.from), base = (c.gain == null ? 1 : c.gain) * (buf.numberOfChannels === 1 ? Math.SQRT1_2 : 1);
    src.buffer = buf; src.connect(g).connect(node.in);
    const fi = c.fadeIn || 0, fo = Math.min(c.fadeOut || 0, Math.max(0, c.dur - fi)), end = clipEnd(c);
    const val = (t) => base * Math.max(0, Math.min(1, fi > 0 ? (t - c.start) / fi : 1, fo > 0 ? (end - t) / fo : 1));
    g.gain.setValueAtTime(val(s), when);
    if (fi > 0 && s < c.start + fi) g.gain.linearRampToValueAtTime(base, when + Math.min(e, c.start + fi) - s);
    if (fo > 0 && e > end - fo) { const ts = Math.max(s, end - fo, c.start + fi); g.gain.setValueAtTime(val(ts), when + (ts - s)); g.gain.linearRampToValueAtTime(0, when + (e - s)); }
    src.start(when, (c.offset || 0) + (s - c.start), e - s); live.push(src);
  }
  function schedMidi(ctx, node, c, t, p, seg) {
    const S = spb(p), inst = t.inst || 'Piano', end = clipEnd(c);
    (c.notes || []).forEach((n) => {
      const at = c.start + n.t * S; if (at < c.start - 1e-6 || at < seg.from - 1e-6 || at >= seg.to || at >= end) return;
      const dur = Math.max(0.05, Math.min(n.d * S, end - at));
      GVSynth.note(ctx, node.in, inst, n.p, (n.v || 100) / 127, seg.when + (at - seg.from), dur);
    });
  }
  function schedDrum(ctx, node, c, p, seg) {
    const sd = spb(p) / 4, steps = c.steps || 16, sw = (c.swing || 0) * sd, end = clipEnd(c);
    let n0 = Math.max(0, Math.floor((seg.from - c.start) / sd) - 1);
    for (let n = n0; ; n++) {
      const idx = n % steps, at = c.start + n * sd + (idx % 2 ? sw : 0); if (at >= end - 1e-6 || at >= seg.to) break; if (at < seg.from - 1e-6) continue;
      DRUMS().forEach((name) => { const v = c.grid && c.grid[name] && c.grid[name][idx]; if (v) GVSynth.drum(ctx, node.in, name, seg.when + (at - seg.from), v === true ? 0.9 : v); });
    }
  }
  function schedClicks(ctx, dest, p, seg) {
    const sg = sigOk(p.sig) ? p.sig : [4, 4], S = spb(p) * 4 / sg[1]; let k = Math.ceil(seg.from / S - 1e-6);
    for (; k * S < seg.to; k++) GVSynth.click(ctx, dest, seg.when + k * S - seg.from, k % sg[0] === 0);
  }
  function scheduleSegment(ctx, graph, p, buffers, seg, opt) {
    opt = opt || {}; const live = opt.live || [];
    p.tracks.forEach((t) => {
      const node = graph.tracks[t.id]; if (!node) return;
      t.clips.forEach((c) => {
        if (clipEnd(c) <= seg.from || c.start >= seg.to) return;
        if (t.type === 'audio') schedAudio(ctx, node, c, buffers.get(c.assetId), seg, live);
        else if (t.type === 'midi') schedMidi(ctx, node, c, t, p, seg);
        else schedDrum(ctx, node, c, p, seg);
      });
    });
    if (opt.metronome) schedClicks(ctx, graph.master, p, seg);
    return live;
  }

  /* ---------- offline render ---------- */
  const LEAD = 0.15;
  async function render(p, buffers, opt) {
    opt = opt || {}; const from = opt.from || 0, to = opt.to == null ? projectEnd(p) : opt.to, rate = opt.rate || 44100, tail = opt.tail == null ? Math.max(1.2, fxTail(p) + 0.3) : opt.tail;
    if (!(to > from)) throw new Error('Nothing to render');
    /* The browser's limiter fades in over its first ~100 ms, which would crush a hit on the very first beat. Render a short lead in and cut it off. */
    const lead = p.limiter === false ? 0 : LEAD, skip = Math.round(lead * rate);
    const oc = new OfflineAudioContext(2, Math.ceil((to - from + tail + lead) * rate), rate), graph = buildGraph(oc, oc.destination, p, { onlyTrack: opt.onlyTrack });
    scheduleSegment(oc, graph, p, buffers, { when: lead, from, to }, {});
    const full = await oc.startRendering(); if (!skip) return full;
    const out = new AudioBuffer({ length: full.length - skip, numberOfChannels: 2, sampleRate: rate });
    for (let c = 0; c < 2; c++) out.copyToChannel(full.getChannelData(c).subarray(skip), c);
    return out;
  }
  function wavBlob(buf, bits) {
    const n = buf.length, ch = buf.numberOfChannels, rate = buf.sampleRate, bytes = (bits === 24 ? 3 : 2), v = new DataView(new ArrayBuffer(44 + n * ch * bytes)), w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + n * ch * bytes, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true); v.setUint32(24, rate, true); v.setUint32(28, rate * ch * bytes, true); v.setUint16(32, ch * bytes, true); v.setUint16(34, bits === 24 ? 24 : 16, true); w(36, 'data'); v.setUint32(40, n * ch * bytes, true);
    const d = []; for (let c = 0; c < ch; c++) d.push(buf.getChannelData(c)); let o = 44;
    for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const s = Math.max(-1, Math.min(1, d[c][i])); if (bytes === 2) { v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2; } else { const x = Math.round(s < 0 ? s * 0x800000 : s * 0x7fffff); v.setUint8(o, x & 255); v.setUint8(o + 1, (x >> 8) & 255); v.setUint8(o + 2, (x >> 16) & 255); o += 3; } }
    return new Blob([v], { type: 'audio/wav' });
  }
  function mp3Blob(buf, kbps) {
    return new Promise((res, rej) => {
      const rates = [48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000]; if (!rates.includes(buf.sampleRate)) return rej(new Error('MP3 does not support ' + buf.sampleRate + ' Hz'));
      const ch = Math.min(2, buf.numberOfChannels), i16 = []; for (let c = 0; c < ch; c++) { const f = buf.getChannelData(c), o = new Int16Array(f.length); for (let i = 0; i < f.length; i++) { const s = Math.max(-1, Math.min(1, f[i])); o[i] = s < 0 ? s * 32768 : s * 32767; } i16.push(o); }
      const w = new Worker('js/convert-worker.js'); w.onmessage = (e) => { if (e.data.done) { w.terminate(); res(e.data.done); } else if (e.data.error) { w.terminate(); rej(new Error(e.data.error)); } }; w.onerror = () => { w.terminate(); rej(new Error('The MP3 encoder could not start')); };
      w.postMessage({ ch: i16, rate: buf.sampleRate, kbps }, i16.map((a) => a.buffer));
    });
  }
  /* waveform summary: min and max of every 256 samples, mixed to mono */
  function peaksOf(buf) {
    const B = 256, n = Math.ceil(buf.length / B), out = new Float32Array(n * 2), ch = buf.numberOfChannels, d = []; for (let c = 0; c < ch; c++) d.push(buf.getChannelData(c));
    for (let i = 0; i < n; i++) { let mn = 1, mx = -1; const a = i * B, b = Math.min(buf.length, a + B); for (let k = a; k < b; k += 2) { let v = 0; for (let c = 0; c < ch; c++) v += d[c][k]; v /= ch; if (v < mn) mn = v; if (v > mx) mx = v; } out[i * 2] = mn; out[i * 2 + 1] = mx; }
    return { B, data: out, rate: buf.sampleRate };
  }
  return { uid, LEAD, SIGS, sigOk, barBeats, COLORS, ensureMix, newFx, fxTail, applyMaster, newProject, newTrack, spb, clipEnd, projectEnd, audible, buildGraph, applyMix, scheduleSegment, render, wavBlob, mp3Blob, peaksOf };
})();
