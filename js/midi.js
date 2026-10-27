/* GoVibe Mix — Standard MIDI File reader and writer for the Studio. No DOM here.
 * write(project) makes a format 1 file: a tempo track (tempo, time signature, markers) and one track per keys or drum track.
 * read(bytes) understands format 0 and 1 files with running status, tempo, time signature, markers, program changes and drums on channel 10. */
window.GVMidi = (() => {
  const PPQ = 480, MAX_BYTES = 8 * 1024 * 1024, MAX_NOTES = 60000;
  const GM_DRUM = { Kick: 36, Snare: 38, Clap: 39, Hat: 42, 'Open hat': 46, Tom: 45, Perc: 56 };
  const PROGRAM = { Piano: 0, 'Electric piano': 4, Bass: 33, 'Synth lead': 81, Pad: 89 };
  const drumOf = (n) => n === 35 || n === 36 ? 'Kick' : n === 37 || n === 38 || n === 40 ? 'Snare' : n === 39 ? 'Clap' : n === 42 || n === 44 ? 'Hat' : n === 46 ? 'Open hat' : n === 41 || n === 43 || n === 45 || n === 47 || n === 48 || n === 50 ? 'Tom' : 'Perc';
  const instOf = (prog) => prog >= 32 && prog <= 39 ? 'Bass' : prog >= 4 && prog <= 5 ? 'Electric piano' : prog >= 80 && prog <= 87 ? 'Synth lead' : prog >= 88 && prog <= 95 ? 'Pad' : 'Piano';
  const vlq = (n) => { const b = [n & 127]; while ((n = Math.floor(n / 128))) b.unshift((n & 127) | 128); return b; };
  const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const text = (s) => Array.from(new TextEncoder().encode(s)).slice(0, 120);

  /* ---------- write ---------- */
  function trackChunk(events) {
    events.sort((a, b) => a.at - b.at || (a.order || 0) - (b.order || 0)); const out = []; let last = 0;
    events.forEach((e) => { out.push(...vlq(e.at - last), ...e.b); last = e.at; });
    out.push(0, 0xff, 0x2f, 0); return [0x4d, 0x54, 0x72, 0x6b, ...u32(out.length), ...out];
  }
  function write(p) {
    const spb = 60 / p.bpm, tick = (beats) => Math.max(0, Math.round(beats * PPQ)), sig = p.sig || [4, 4], mpq = Math.round(60000000 / p.bpm);
    const conductor = [{ at: 0, order: 0, b: [0xff, 0x03, 5, ...text('Tempo')] }, { at: 0, order: 1, b: [0xff, 0x51, 3, (mpq >> 16) & 255, (mpq >> 8) & 255, mpq & 255] }, { at: 0, order: 2, b: [0xff, 0x58, 4, sig[0], Math.log2(sig[1]), 24, 8] }];
    (p.markers || []).forEach((m) => { const t = text(m.name || 'Marker'); conductor.push({ at: tick(m.t / spb), order: 3, b: [0xff, 0x06, ...vlq(t.length), ...t] }); });
    const chunks = [trackChunk(conductor)]; let ch = 0; const nextCh = () => { if (ch === 9) ch++; return (ch++) % 16; };
    p.tracks.forEach((t) => {
      if (t.type === 'audio') return; const channel = t.type === 'drum' ? 9 : nextCh(), ev = [], nm = text(t.name || 'Track');
      ev.push({ at: 0, order: 0, b: [0xff, 0x03, ...vlq(nm.length), ...nm] });
      if (t.type === 'midi') ev.push({ at: 0, order: 1, b: [0xc0 | channel, PROGRAM[t.inst] || 0] });
      const add = (startBeat, durBeat, pitch, vel) => { const a = tick(startBeat), z = Math.max(a + 1, tick(startBeat + durBeat)), v = Math.max(1, Math.min(127, Math.round(vel))); ev.push({ at: a, order: 3, b: [0x90 | channel, pitch, v] }, { at: z, order: 2, b: [0x80 | channel, pitch, 0] }); };
      t.clips.forEach((c) => {
        const s0 = c.start / spb, e0 = (c.start + c.dur) / spb;
        if (t.type === 'midi') (c.notes || []).forEach((n) => { const at = s0 + n.t; if (at >= e0 - 1e-6) return; add(at, Math.min(n.d, e0 - at), Math.max(0, Math.min(127, n.p)), n.v || 100); });
        else { const steps = c.steps || 16, sd = 0.25, sw = (c.swing || 0) * sd; for (let n = 0; ; n++) { const idx = n % steps, at = s0 + n * sd + (idx % 2 ? sw : 0); if (at >= e0 - 1e-6) break; Object.keys(GM_DRUM).forEach((name) => { const v = c.grid && c.grid[name] && c.grid[name][idx]; if (v) add(at, 0.1, GM_DRUM[name], (v === true ? 0.9 : v) * 127); }); } }
      });
      chunks.push(trackChunk(ev));
    });
    const head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, (chunks.length >> 8) & 255, chunks.length & 255, PPQ >> 8, PPQ & 255];
    return new Uint8Array(head.concat(...chunks));
  }
  const hasNotes = (p) => p.tracks.some((t) => t.type !== 'audio' && t.clips.length);

  /* ---------- read ---------- */
  function read(bytes) {
    if (bytes.length > MAX_BYTES) throw new Error('That MIDI file is larger than 8 MB.');
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), str = (o, n) => String.fromCharCode(...bytes.subarray(o, o + n));
    if (bytes.length < 14 || str(0, 4) !== 'MThd') throw new Error('This does not look like a MIDI file.');
    const hlen = dv.getUint32(4), format = dv.getUint16(8), ntrk = dv.getUint16(10), div = dv.getUint16(12);
    if (div & 0x8000) throw new Error('This MIDI file uses time code timing, which is not supported.');
    if (format > 1) throw new Error('This MIDI file type is not supported. Save it as type 0 or type 1.');
    const ppq = div || 480, warnings = [], dec = new TextDecoder('utf-8'), out = { ppq, bpm: null, sig: null, markers: [], tracks: [], noteCount: 0, warnings }; let o = 8 + hlen, tempoEvents = 0;
    for (let ti = 0; ti < ntrk && o + 8 <= bytes.length; ti++) {
      if (str(o, 4) !== 'MTrk') { o += 8 + dv.getUint32(o + 4); continue; }
      const len = dv.getUint32(o + 4), end = Math.min(bytes.length, o + 8 + len); let p = o + 8, at = 0, running = 0, name = '';
      const active = new Map(), prog = new Array(16).fill(0), groups = new Map();
      const rd = () => { let v = 0, b; do { b = bytes[p++]; v = v * 128 + (b & 127); } while (b & 128 && p < end); return v; };
      const group = (c) => { if (!groups.has(c)) groups.set(c, { channel: c, program: prog[c], notes: [] }); return groups.get(c); };
      const close = (c, pitch, tickNow) => { const k = c * 128 + pitch, st = active.get(k); if (!st || !st.length) return; const n = st.shift(); n.d = Math.max(1, tickNow - n.s) / ppq; delete n.s; };
      while (p < end) {
        at += rd(); let st = bytes[p];
        if (st === 0xff) { const type = bytes[p + 1]; p += 2; const l = rd(), d = bytes.subarray(p, p + l); p += l;
          if (type === 0x51 && l === 3) { tempoEvents++; if (out.bpm == null) out.bpm = 60000000 / ((d[0] << 16) | (d[1] << 8) | d[2]); }
          else if (type === 0x58 && l >= 2) { if (!out.sig) out.sig = [d[0], Math.pow(2, d[1])]; }
          else if (type === 0x03 && !name) name = dec.decode(d);
          else if ((type === 0x06 || type === 0x07) && l) out.markers.push({ beats: at / ppq, name: dec.decode(d).trim() });
          else if (type === 0x2f) break;
          continue; }
        if (st === 0xf0 || st === 0xf7) { p++; const l = rd(); p += l; continue; }
        if (st & 0x80) { running = st; p++; } else if (!running) { throw new Error('This MIDI file is damaged.'); } else st = running;
        const kind = running & 0xf0, c = running & 15;
        if (kind === 0xc0 || kind === 0xd0) { const a = bytes[p++]; if (kind === 0xc0) { prog[c] = a; const g = groups.get(c); if (g && !g.notes.length) g.program = a; } continue; }
        const a = bytes[p++], b = bytes[p++];
        if (kind === 0x90 && b > 0) { const g = group(c), n = { t: at / ppq, d: 0.25, p: a, v: b, s: at }; g.notes.push(n); const k = c * 128 + a; if (!active.has(k)) active.set(k, []); active.get(k).push(n); out.noteCount++; if (out.noteCount > MAX_NOTES) throw new Error('This MIDI file has more than ' + MAX_NOTES + ' notes.'); }
        else if (kind === 0x80 || kind === 0x90) close(c, a, at);
      }
      active.forEach((list) => list.forEach((n) => { n.d = Math.max(1, at - n.s) / ppq; delete n.s; }));
      groups.forEach((g) => { if (g.notes.length) out.tracks.push({ name, channel: g.channel, program: g.program, drum: g.channel === 9, notes: g.notes.sort((x, y) => x.t - y.t) }); });
      o = end;
    }
    if (tempoEvents > 1) warnings.push('The file changes tempo ' + (tempoEvents - 1) + ' time(s). Only the first tempo is used.');
    if (out.bpm == null) out.bpm = 120;
    return out;
  }

  /* ---------- turn a parsed file into Studio track specs. Notes are in beats, so they keep their meaning at any tempo. ---------- */
  function toSpecs(parsed) {
    const specs = [], r2 = (x) => Math.round(x * 1000) / 1000;
    parsed.tracks.forEach((t, i) => {
      if (t.drum) {
        const bars = new Map();
        t.notes.forEach((n) => { const step = Math.round(n.t * 4), bar = Math.floor(step / 16), idx = step - bar * 16, name = drumOf(n.p); if (!bars.has(bar)) bars.set(bar, {}); const g = bars.get(bar); if (!g[name]) g[name] = new Array(16).fill(0); g[name][idx] = Math.max(g[name][idx], Math.round(n.v / 127 * 100) / 100); });
        specs.push({ type: 'drum', name: t.name || 'Drums', clips: [...bars.keys()].sort((a, b) => a - b).map((b) => ({ startBeat: b * 4, grid: bars.get(b) })) });
      } else {
        let end = 0; const notes = t.notes.map((n) => { end = Math.max(end, n.t + n.d); return { t: r2(n.t), d: Math.max(0.05, r2(n.d)), p: Math.max(0, Math.min(127, n.p)), v: n.v }; });
        specs.push({ type: 'midi', name: t.name || ('Keys ' + (i + 1)), inst: instOf(t.program), notes, beats: Math.max(4, Math.ceil(end / 4) * 4), outOfRange: notes.filter((n) => n.p < 36 || n.p > 96).length });
      }
    });
    return specs;
  }
  return { PPQ, write, read, toSpecs, hasNotes, GM_DRUM };
})();
