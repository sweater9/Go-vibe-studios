/* GoVibe Mix — loop and sample maker. Builds drum, bass, chord and melody loops from the Studio instruments, renders them offline, and offers WAV, MIDI and Studio hand-off. */
(() => {
  const $ = (id) => document.getElementById(id), T = window.GVTheory, Core = window.GVStudioCore;
  let ctx = null, playing = null, cat = 'All'; const cache = new Map();
  const say = (t) => { $('status').textContent = t; };
  const getCtx = () => (ctx = ctx || new (window.AudioContext || window.webkitAudioContext)());
  const arr = (idx) => { const a = Array(16).fill(0); idx.forEach((i) => { a[i] = 1; }); return a; };
  const DR = (name, desc, bpm, grid, swing) => ({ cat: 'Drums', name, desc, bpm, kind: 'drum', build: () => ({ type: 'drum', name, grid: Object.fromEntries(Object.entries(grid).map(([k, v]) => [k, arr(v)])), swing: swing || 0 }) });
  const EVENS = [0, 2, 4, 6, 8, 10, 12, 14];
  const rng = (seed) => { let s = seed * 2654435761 >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

  /* chords for each bar from the chosen progression */
  function bars(p) { const ivs = T.SCALES[p.minor ? 'Natural minor' : 'Major'], degs = T.PROGS[p.minor ? 'minor' : 'major'][p.prog] || [0, 3, 4, 3]; return Array.from({ length: p.bars }, (_, b) => T.chord(p.root, ivs, degs[b % degs.length], false)); }
  const BASS = {
    'Root eighths': (c) => EVENS.map((s) => ({ t: s / 2, d: 0.45, p: 36 + c.rootPc, v: s % 4 ? 90 : 110 })),
    'Offbeat pump': (c) => [0.5, 1.5, 2.5, 3.5].map((t) => ({ t, d: 0.4, p: 36 + c.rootPc, v: 105 })),
    'Walking': (c) => [0, 7, 12, 7].map((o, i) => ({ t: i, d: 0.9, p: 36 + c.rootPc + o, v: 100 })),
    'Syncopated': (c) => [[0, 0.7], [0.75, 0.45], [1.5, 0.45], [2.5, 0.7], [3.25, 0.6]].map(([t, d], i) => ({ t, d, p: 36 + c.rootPc + (i === 3 ? 7 : 0), v: i === 0 ? 112 : 95 }))
  };
  const CHORD = {
    'Sustained pads': { inst: 'Pad', f: (c) => c.midi(4).map((p) => ({ t: 0, d: 3.9, p, v: 80 })) },
    'Offbeat stabs': { inst: 'Electric piano', f: (c) => [0.5, 1.5, 2.5, 3.5].flatMap((t) => c.midi(4).map((p) => ({ t, d: 0.35, p, v: 88 }))) },
    'Arpeggio': { inst: 'Piano', f: (c) => { const n = c.midi(4).concat([c.midi(5)[0]]), order = [0, 1, 2, 3, 2, 1]; return Array.from({ length: 16 }, (_, i) => ({ t: i / 4, d: 0.22, p: n[order[i % 6] % n.length], v: i % 4 ? 80 : 100 })); } }
  };
  function melody(p) {
    const r = rng(p.seed * 7919 + p.root * 13 + (p.minor ? 1 : 0)), sc = T.SCALES[p.minor ? 'Minor pentatonic' : 'Major pentatonic'], pool = []; for (let o = 0; o < 3; o++) sc.forEach((i) => pool.push(72 + p.root - 12 + i + 12 * o)); pool.sort((a, b) => a - b);
    let idx = Math.floor(pool.length / 2), notes = []; const rhythms = [[0, 1, 2, 3], [0, 1.5, 2, 3], [0, 0.5, 1, 2.5, 3], [0, 1, 1.5, 2, 3.5], [0, 2, 3]];
    for (let b = 0; b < p.bars; b++) {
      const rh = rhythms[Math.floor(r() * rhythms.length)];
      rh.forEach((t, k) => { const step = Math.round((r() - 0.5) * 4); idx = Math.max(0, Math.min(pool.length - 1, idx + step)); const end = rh[k + 1] == null ? 4 : rh[k + 1]; let note = pool[idx]; if (b === p.bars - 1 && k === rh.length - 1) { note = pool.filter((x) => (x - p.root) % 12 === 0).sort((a, c) => Math.abs(a - pool[idx]) - Math.abs(c - pool[idx]))[0] || note; }
        notes.push({ t: b * 4 + t, d: Math.max(0.25, (end - t) * 0.8), p: note, v: 85 + Math.floor(r() * 25) }); });
    }
    return notes;
  }
  const CATALOG = [
    DR('House', 'Four on the floor with offbeat open hats', 124, { Kick: [0, 4, 8, 12], Clap: [4, 12], 'Open hat': [2, 6, 10, 14], Hat: [1, 3, 5, 7, 9, 11, 13, 15] }),
    DR('Boom bap', 'Dusty hip hop groove with swing', 90, { Kick: [0, 7, 10], Snare: [4, 12], Hat: EVENS }, 0.25),
    DR('Trap', 'Sparse kicks and fast hats', 140, { Kick: [0, 7, 11], Clap: [8], Hat: [0, 2, 4, 6, 8, 10, 12, 14, 15], 'Open hat': [14] }),
    DR('Breakbeat', 'Rolling funk break', 100, { Kick: [0, 6, 10], Snare: [4, 12, 15], Hat: EVENS }),
    DR('Reggaeton', 'Dembow rhythm', 95, { Kick: [0, 4, 8, 12], Snare: [3, 6, 11, 14], Hat: [2, 6, 10, 14] }),
    DR('Drum and bass', 'Fast two step', 172, { Kick: [0, 10], Snare: [4, 12], Hat: EVENS }),
    DR('Lofi', 'Lazy swung beat', 80, { Kick: [0, 5, 10], Snare: [4, 12], Hat: EVENS, Perc: [15] }, 0.35),
    ...Object.keys(BASS).map((n) => ({ cat: 'Bass', name: 'Bass: ' + n, desc: 'Follows the chord progression', kind: 'midi', build: (p) => ({ type: 'midi', inst: 'Bass', name: 'Bass', notes: bars(p).flatMap((c, b) => BASS[n](c).map((x) => Object.assign({}, x, { t: x.t + b * 4 }))) }) })),
    ...Object.keys(CHORD).map((n) => ({ cat: 'Chords', name: 'Chords: ' + n, desc: 'Chords from the progression', kind: 'midi', build: (p) => ({ type: 'midi', inst: CHORD[n].inst, name: 'Chords', notes: bars(p).flatMap((c, b) => CHORD[n].f(c).map((x) => Object.assign({}, x, { t: x.t + b * 4 }))) }) })),
    { cat: 'Melody', name: 'Melody', desc: 'A catchy line on the pentatonic scale. Change Variation for a new one', kind: 'midi', build: (p) => ({ type: 'midi', inst: 'Synth lead', name: 'Melody', notes: melody(p) }) }
  ];
  const params = () => ({ bpm: Math.max(60, Math.min(180, +$('bpm').value || 100)), root: +$('root').value, minor: $('mode').value === 'minor', bars: +$('bars').value, prog: $('prog').value, seed: Math.max(1, +$('seed').value || 1) });

  /* build the project for one loop */
  function projectFor(item, p) {
    const spec = item.build(p), proj = Core.newProject('Loop'), spb = 60 / p.bpm, tr = Core.newTrack(proj, spec.type), dur = p.bars * 4 * spb; proj.bpm = p.bpm; proj.tracks.push(tr);
    if (spec.type === 'midi') { tr.inst = spec.inst; tr.clips.push({ id: Core.uid(), start: 0, dur, notes: spec.notes }); }
    else { const grid = {}; GVSynth.DRUMS.forEach((d) => { grid[d] = spec.grid[d] || Array(16).fill(0); }); tr.clips.push({ id: Core.uid(), start: 0, dur, steps: 16, swing: spec.swing, grid }); }
    return { proj, spec, dur };
  }
  async function render(item, p) {
    const key = item.name + JSON.stringify(p); if (cache.has(key)) return cache.get(key);
    const { proj, spec, dur } = projectFor(item, p), rate = 44100, TAIL = 0.6, raw = await Core.render(proj, {}, { from: 0, to: dur, rate, tail: TAIL }), n = Math.round(dur * rate), out = getCtx().createBuffer(2, n, rate);
    let pk = 0; for (let c = 0; c < 2; c++) { const s = raw.getChannelData(c), d = out.getChannelData(c); for (let i = 0; i < n; i++) d[i] = s[i]; for (let i = 0; n + i < s.length; i++) d[i % n] += s[n + i]; }
    for (let c = 0; c < 2; c++) { const d = out.getChannelData(c); for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(d[i])); }
    const g = pk > 0 ? 0.89 / pk : 1; for (let c = 0; c < 2; c++) { const d = out.getChannelData(c); for (let i = 0; i < n; i++) d[i] *= g; }
    const res = { buf: out, spec, p }; cache.set(key, res); return res;
  }
  const fileBase = (item, p) => item.name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + p.bpm + 'bpm' + (item.cat === 'Drums' ? '' : '-' + T.nm(p.root).replace('♯', 'sharp').replace('♭', 'flat') + (p.minor ? 'm' : ''));
  const dl = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };

  /* ---------- MIDI file (format 0) ---------- */
  const GM = { Kick: 36, Snare: 38, Clap: 39, Hat: 42, 'Open hat': 46, Tom: 45, Perc: 56 };
  function midiFile(spec, p) {
    const TPQ = 480, ev = []; const vlq = (n) => { const b = [n & 127]; while ((n >>= 7)) b.unshift((n & 127) | 128); return b; };
    let notes = [], ch = 0;
    if (spec.type === 'midi') notes = spec.notes.map((n) => ({ t: n.t, d: n.d, p: n.p, v: n.v })); else { ch = 9; for (let b = 0; b < p.bars; b++) Object.entries(spec.grid).forEach(([nm, row]) => row.forEach((on, i) => { if (on) notes.push({ t: b * 4 + i / 4 + (i % 2 ? spec.swing * 0.125 : 0), d: 0.2, p: GM[nm] || 38, v: 100 }); })); }
    notes.forEach((n) => { ev.push({ at: Math.round(n.t * TPQ), b: [0x90 | ch, n.p, Math.max(1, Math.min(127, n.v || 100))] }, { at: Math.round((n.t + n.d) * TPQ), b: [0x80 | ch, n.p, 0] }); });
    ev.sort((a, b) => a.at - b.at || (a.b[0] & 0xf0) - (b.b[0] & 0xf0)); const mpq = Math.round(60000000 / p.bpm), tr = [0, 0xff, 0x51, 3, (mpq >> 16) & 255, (mpq >> 8) & 255, mpq & 255, 0, 0xff, 0x58, 4, 4, 2, 24, 8]; let last = 0;
    ev.forEach((e) => { tr.push(...vlq(e.at - last), ...e.b); last = e.at; }); tr.push(0, 0xff, 0x2f, 0);
    const h = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, TPQ >> 8, TPQ & 255], len = tr.length, t = [0x4d, 0x54, 0x72, 0x6b, (len >>> 24) & 255, (len >> 16) & 255, (len >> 8) & 255, len & 255, ...tr];
    return new Blob([new Uint8Array(h.concat(t))], { type: 'audio/midi' });
  }

  /* ---------- UI ---------- */
  function stop() { if (playing) { try { playing.src.stop(); } catch (_) {} playing.src.disconnect(); playing.btn.textContent = 'Play'; playing.btn.setAttribute('aria-pressed', 'false'); playing = null; } }
  async function play(item, btn) {
    if (playing && playing.btn === btn) { stop(); return; } stop(); const p = params(); btn.disabled = true; btn.textContent = 'Making…';
    try { const r = await render(item, p), c = getCtx(); await c.resume(); const s = c.createBufferSource(); s.buffer = r.buf; s.loop = true; s.connect(c.destination); s.start(); playing = { src: s, btn }; btn.textContent = 'Stop'; btn.setAttribute('aria-pressed', 'true'); say('Playing ' + item.name + ' at ' + p.bpm + ' BPM.'); }
    catch (e) { btn.textContent = 'Play'; say('Could not make this loop: ' + (e.message || e)); }
    btn.disabled = false;
  }
  function card(item) {
    const d = document.createElement('div'); d.className = 'loopcard'; d.innerHTML = '<h3></h3><p></p><div class="row"></div>'; d.querySelector('h3').textContent = item.name; d.querySelector('p').textContent = item.desc + (item.cat === 'Drums' ? '. Suggested ' + item.bpm + ' BPM.' : '');
    const row = d.querySelector('.row'), mk = (txt, fn, label) => { const b = document.createElement('button'); b.className = 'btn mini'; b.textContent = txt; if (label) b.setAttribute('aria-label', label); b.onclick = () => fn(b); row.appendChild(b); return b; };
    const pb = mk('Play', (b) => play(item, b), null); pb.setAttribute('aria-pressed', 'false'); pb.setAttribute('aria-label', 'Play ' + item.name); pb.className = 'btn mini primary';
    mk('WAV', async (b) => { b.disabled = true; try { const p = params(), r = await render(item, p); dl(Core.wavBlob(r.buf, 16), fileBase(item, p) + '.wav'); say('Downloaded ' + fileBase(item, p) + '.wav'); } catch (e) { say('Failed: ' + e.message); } b.disabled = false; });
    mk('MIDI', (b) => { const p = params(), { spec } = projectFor(item, p); dl(midiFile(spec, p), fileBase(item, p) + '.mid'); say('Downloaded ' + fileBase(item, p) + '.mid'); });
    mk('Open in Studio', () => { const p = params(), { spec } = projectFor(item, p); try { localStorage.setItem('govibe.loop', JSON.stringify({ bpm: p.bpm, bars: p.bars, spec })); location.href = 'studio.html?from=samples'; } catch (_) { say('Could not hand over to the Studio.'); } });
    return d;
  }
  function list() { stop(); const box = $('list'); box.innerHTML = ''; CATALOG.filter((i) => cat === 'All' || i.cat === cat).forEach((i) => box.appendChild(card(i))); }
  function progs() { const m = $('mode').value, keep = $('prog').value; $('prog').innerHTML = ''; Object.keys(T.PROGS[m]).forEach((k) => { const o = document.createElement('option'); o.textContent = k; $('prog').appendChild(o); }); if ([...$('prog').options].some((o) => o.value === keep)) $('prog').value = keep; }
  T.NAMES.forEach((n, i) => { const o = document.createElement('option'); o.value = i; o.textContent = n; $('root').appendChild(o); });
  progs(); $('mode').onchange = () => { progs(); stop(); };
  ['bpm', 'root', 'bars', 'prog', 'seed'].forEach((id) => { $(id).onchange = stop; });
  ['All', 'Drums', 'Bass', 'Chords', 'Melody'].forEach((c, i) => { const b = document.createElement('button'); b.className = 'btn'; b.textContent = c; b.setAttribute('aria-pressed', i === 0); b.onclick = () => { cat = c; [...$('cats').children].forEach((x) => x.setAttribute('aria-pressed', x === b)); list(); }; $('cats').appendChild(b); });
  list();
  window.addEventListener('pagehide', stop);
  if (/[?&]gvtest\b/.test(location.search)) window.__sm = { CATALOG, params, render, projectFor, midiFile, get playing() { return !!playing; } };
})();
