/* GoVibe Mix — Studio: multitrack timeline (audio, keys and drum tracks), mixer, loop, metronome, save and export. */
(() => {
  const $ = (id) => document.getElementById(id), Core = GVStudioCore, IO = GVStudioIO;
  const RULER = 28, LANE = 122;
  const gvtest = /[?&]gvtest\b/.test(location.search);
  let ctx = null, bus = null, anL = null, anR = null;
  let P = Core.newProject(), buffers = new Map(), blobs = new Map(), peaks = new Map();
  let sel = { track: null, clip: null }, clipboard = null;
  let playhead = 0, playing = false, pps = 60, scrollX = 0;
  let undoS = [], redoS = [];
  let graph = null, live = [], segs = [], startAt = 0, tick = 0, dirty = true, saveT = 0, restartT = 0;
  const canvas = $('tl'), g = canvas.getContext('2d');
  const say = (t) => { $('status').textContent = t; };
  const fmtT = (s) => { const m = Math.floor(s / 60); return m + ':' + (s - m * 60).toFixed(2).padStart(5, '0'); };
  const spb = () => Core.spb(P);
  const trackOf = (id) => P.tracks.find((t) => t.id === id);
  const clipOf = (id) => { for (const t of P.tracks) { const c = t.clips.find((x) => x.id === id); if (c) return { t, c }; } return null; };
  const xOf = (t) => (t - scrollX) * pps, tOf = (x) => x / pps + scrollX;
  const SNAPS = { off: 0, '16': 0.25, '8': 0.5, '4': 1, bar: 4 };
  const snapUnit = () => SNAPS[$('snap').value] * spb();
  const snap = (t) => { const u = snapUnit(); return u ? Math.round(t / u) * u : t; };

  /* ---------- audio context ---------- */
  function ensureCtx() {
    if (ctx) return ctx;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    bus = ctx.createGain(); const sp = ctx.createChannelSplitter(2); anL = ctx.createAnalyser(); anR = ctx.createAnalyser(); anL.fftSize = anR.fftSize = 1024;
    bus.connect(ctx.destination); bus.connect(sp); sp.connect(anL, 0); sp.connect(anR, 1);
    return ctx;
  }

  /* ---------- undo and autosave ---------- */
  const snapshotJSON = () => JSON.stringify(P);
  function pushUndo(s) { undoS.push(s); if (undoS.length > 60) undoS.shift(); redoS = []; syncUndo(); }
  function syncUndo() { $('undo').disabled = !undoS.length; $('redo').disabled = !redoS.length; }
  function restore(s) { const keep = P.assets; P = JSON.parse(s); P.assets = Object.assign({}, keep, P.assets); afterStructure(); }
  function undo() { if (!undoS.length) return; redoS.push(snapshotJSON()); restore(undoS.pop()); syncUndo(); }
  function redo() { if (!redoS.length) return; undoS.push(snapshotJSON()); restore(redoS.pop()); syncUndo(); }
  function changed(label, before) { if (before != null) pushUndo(before); markDirty(); if (playing) scheduleRestart(); }
  function edit(label, fn) { const b = snapshotJSON(); fn(); changed(label, b); afterStructure(); }
  function markDirty() { dirty = true; $('saved').textContent = 'Unsaved changes'; clearTimeout(saveT); saveT = setTimeout(saveNow, 1200); }
  async function saveNow() { try { await IO.save(P, blobs); $('saved').textContent = 'Saved in this browser at ' + new Date().toLocaleTimeString(); } catch (e) { $('saved').textContent = 'Could not save: ' + (e && e.message || 'storage is full or blocked') + '. Use Download backup.'; } }
  function afterStructure() {
    if (sel.clip && !clipOf(sel.clip)) sel.clip = null; if (sel.track && !trackOf(sel.track)) sel.track = null;
    $('bpm').value = P.bpm; $('pname').value = P.name; $('master').value = Math.round(P.master * 100); $('lim').checked = P.limiter !== false; $('loop').setAttribute('aria-pressed', !!P.loop.on);
    buildHeads(); refreshSelUI(); dirty = true; if (playing) scheduleRestart(); if (window.GVRoll) GVRoll.refresh();
  }

  /* ---------- tracks and clips ---------- */
  function addTrack(type) { let tr; edit('Add track', () => { tr = Core.newTrack(P, type); P.tracks.push(tr); sel.track = tr.id; }); return tr; }
  function removeTrack(id) { edit('Remove track', () => { P.tracks = P.tracks.filter((t) => t.id !== id); }); }
  async function importFiles(files) {
    ensureCtx(); let n = 0;
    for (const f of files) {
      if (f.size > 300 * 1024 * 1024) { say(f.name + ' is over 300 MB and was skipped.'); continue; }
      say('Reading ' + f.name + '…'); let buf;
      try { buf = await ctx.decodeAudioData(await f.arrayBuffer()); } catch (_) { say('Could not read ' + f.name + '. Try MP3, WAV or OGG.'); continue; }
      const aid = Core.uid(); P.assets[aid] = { id: aid, name: f.name, dur: buf.duration }; buffers.set(aid, buf); blobs.set(aid, f); peaks.set(aid, Core.peaksOf(buf));
      edit('Import audio', () => { const tr = Core.newTrack(P, 'audio'); tr.name = f.name.replace(/\.[^.]+$/, '').slice(0, 24); P.tracks.push(tr); const c = { id: Core.uid(), assetId: aid, start: snap(playhead), offset: 0, dur: buf.duration, gain: 1, fadeIn: 0, fadeOut: 0 }; tr.clips.push(c); sel = { track: tr.id, clip: c.id }; });
      n++;
    }
    if (n) say(n + ' file(s) added. Drag clips to arrange them.');
  }
  function splitAt(t) {
    const target = sel.clip ? clipOf(sel.clip) : (() => { const tr = trackOf(sel.track); const c = tr && tr.clips.find((x) => x.start < t && Core.clipEnd(x) > t); return c ? { t: tr, c } : null; })();
    if (!target || !(t > target.c.start + 0.02 && t < Core.clipEnd(target.c) - 0.02)) return say('Put the playhead inside the clip you want to split, and select that clip.');
    edit('Split', () => {
      const { t: tr, c } = target, cut = t - c.start, right = JSON.parse(JSON.stringify(c)); right.id = Core.uid(); right.start = t; right.dur = c.dur - cut; c.dur = cut;
      if (tr.type === 'audio') { right.offset = (c.offset || 0) + cut; right.fadeIn = 0; c.fadeOut = 0; }
      else if (tr.type === 'midi') { const bt = cut / spb(); right.notes = (c.notes || []).filter((n) => n.t >= bt).map((n) => Object.assign({}, n, { t: n.t - bt })); c.notes = (c.notes || []).filter((n) => n.t < bt).map((n) => Object.assign({}, n, { d: Math.min(n.d, bt - n.t) })); }
      tr.clips.push(right); sel.clip = right.id;
    });
  }
  function dupClip() { const x = sel.clip && clipOf(sel.clip); if (!x) return; edit('Duplicate', () => { const c = JSON.parse(JSON.stringify(x.c)); c.id = Core.uid(); c.start = Core.clipEnd(x.c); x.t.clips.push(c); sel.clip = c.id; }); }
  function delClip() { const x = sel.clip && clipOf(sel.clip); if (!x) return; edit('Delete clip', () => { x.t.clips = x.t.clips.filter((c) => c.id !== x.c.id); sel.clip = null; }); }
  function copyClip() { const x = sel.clip && clipOf(sel.clip); if (x) { clipboard = { type: x.t.type, c: JSON.parse(JSON.stringify(x.c)) }; say('Clip copied.'); } }
  function pasteClip() {
    if (!clipboard) return; const tr = trackOf(sel.track) && trackOf(sel.track).type === clipboard.type ? trackOf(sel.track) : P.tracks.find((t) => t.type === clipboard.type);
    if (!tr) return say('Add a ' + clipboard.type + ' track to paste into.');
    edit('Paste', () => { const c = JSON.parse(JSON.stringify(clipboard.c)); c.id = Core.uid(); c.start = snap(playhead); tr.clips.push(c); sel = { track: tr.id, clip: c.id }; });
  }
  function newMidiClip(tr, at) { let c; edit('New clip', () => { c = tr.type === 'midi' ? { id: Core.uid(), start: at, dur: 4 * spb(), notes: [] } : { id: Core.uid(), start: at, dur: 4 * spb(), steps: 16, swing: 0, grid: {} }; tr.clips.push(c); sel = { track: tr.id, clip: c.id }; }); return c; }

  /* ---------- track headers ---------- */
  function buildHeads() {
    const box = $('heads'); box.innerHTML = ''; const sp = document.createElement('div'); sp.style.height = RULER + 'px'; sp.setAttribute('aria-hidden', 'true'); box.appendChild(sp);
    P.tracks.forEach((t) => {
      const row = document.createElement('div'); row.className = 'thead' + (sel.track === t.id ? ' sel' : ''); row.style.height = LANE + 'px'; row.style.borderLeftColor = t.color; row.dataset.id = t.id;
      const mk = (tag, cls, props) => Object.assign(document.createElement(tag), Object.assign({ className: cls || '' }, props || {}));
      const name = mk('input', 'tname', { type: 'text', value: t.name }); name.setAttribute('aria-label', 'Track name'); name.onchange = () => edit('Rename track', () => { t.name = name.value.trim() || t.name; });
      const typ = mk('span', 'ttype', { textContent: t.type === 'audio' ? 'Audio' : t.type === 'midi' ? 'Keys' : 'Drums' });
      const m = mk('button', 'btn mini tbtn2', { textContent: 'M', title: 'Mute' }); m.setAttribute('aria-label', 'Mute ' + t.name); m.setAttribute('aria-pressed', t.mute);
      m.onclick = () => { const b = snapshotJSON(); t.mute = !t.mute; applyAllMix(); changed('Mute', b); buildHeads(); };
      const s = mk('button', 'btn mini tbtn2', { textContent: 'S', title: 'Solo' }); s.setAttribute('aria-label', 'Solo ' + t.name); s.setAttribute('aria-pressed', t.solo);
      s.onclick = () => { const b = snapshotJSON(); t.solo = !t.solo; applyAllMix(); changed('Solo', b); buildHeads(); };
      const x = mk('button', 'btn mini tbtn2', { textContent: '✕', title: 'Remove track' }); x.setAttribute('aria-label', 'Remove ' + t.name); x.onclick = () => removeTrack(t.id);
      const vol = mk('input', 'tvol', { type: 'range', min: 0, max: 150, value: Math.round(t.vol * 100) }); vol.setAttribute('aria-label', 'Volume of ' + t.name);
      vol.oninput = () => { t.vol = vol.value / 100; applyAllMix(); }; vol.onchange = () => { markDirty(); }; vol.onpointerdown = () => { vol._b = snapshotJSON(); }; vol.onpointerup = () => { if (vol._b && vol._b !== snapshotJSON()) pushUndo(vol._b); };
      const pan = mk('input', 'tpan', { type: 'range', min: -100, max: 100, value: Math.round(t.pan * 100) }); pan.setAttribute('aria-label', 'Pan of ' + t.name);
      pan.oninput = () => { t.pan = pan.value / 100; applyAllMix(); }; pan.onchange = () => markDirty(); pan.ondblclick = () => { t.pan = 0; pan.value = 0; applyAllMix(); markDirty(); };
      pan.onpointerdown = () => { pan._b = snapshotJSON(); }; pan.onpointerup = () => { if (pan._b && pan._b !== snapshotJSON()) pushUndo(pan._b); };
      const lv = mk('div', 'tlvl'); const lb = mk('div', 'tlvlb'); lv.appendChild(lb); lv.dataset.lv = t.id;
      const top = mk('div', 'trow'); top.append(name, typ);
      const mid = mk('div', 'trow'); mid.append(m, s, x);
      if (t.type === 'midi') { const ins = mk('select', 'tinst'); ins.setAttribute('aria-label', 'Instrument of ' + t.name); GVSynth.INSTS.forEach((n) => { const o = document.createElement('option'); o.textContent = n; if (n === t.inst) o.selected = true; ins.appendChild(o); }); ins.onchange = () => edit('Instrument', () => { t.inst = ins.value; }); mid.appendChild(ins); }
      const lab = (txt, el) => { const l = mk('label', 'tl'); l.append(document.createTextNode(txt), el); return l; };
      row.append(top, mid, lab('Vol', vol), lab('Pan', pan), lv);
      row.addEventListener('pointerdown', (e) => { if (e.target.closest('input,button,select')) return; sel.track = t.id; sel.clip = null; buildHeads(); dirty = true; });
      box.appendChild(row);
    });
    canvas.height = RULER + Math.max(P.tracks.length, 1) * LANE + 1; canvas.style.height = canvas.height + 'px'; $('heads').style.minHeight = canvas.height + 'px'; dirty = true;
  }

  /* ---------- drawing ---------- */
  function fitCanvas() { const r = $('tlwrap').getBoundingClientRect(), w = Math.max(100, Math.floor(r.width)); if (canvas.width !== w) { canvas.width = w; dirty = true; } }
  function roundRect(x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  function draw() {
    fitCanvas(); const W = canvas.width, H = canvas.height; g.clearRect(0, 0, W, H);
    const dark = getComputedStyle(document.documentElement); g.fillStyle = '#0d0e16'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < Math.max(P.tracks.length, 1); i++) { g.fillStyle = i % 2 ? '#10111a' : '#0f1019'; g.fillRect(0, RULER + i * LANE, W, LANE); g.fillStyle = '#1b1d2a'; g.fillRect(0, RULER + (i + 1) * LANE - 1, W, 1); }
    // grid
    const S = spb(), t0 = scrollX, t1 = scrollX + W / pps, beatPx = S * pps;
    if (beatPx > 10) for (let k = Math.max(0, Math.floor(t0 / S)); k * S < t1; k++) { const x = Math.round(xOf(k * S)) + 0.5, bar = k % 4 === 0; g.fillStyle = bar ? '#262a3c' : '#171927'; if (bar || beatPx > 22) g.fillRect(x, RULER, 1, H - RULER); }
    else for (let k = Math.max(0, Math.floor(t0 / (S * 4))); k * S * 4 < t1; k++) { g.fillStyle = '#262a3c'; g.fillRect(Math.round(xOf(k * S * 4)) + 0.5, RULER, 1, H - RULER); }
    // ruler
    g.fillStyle = '#141623'; g.fillRect(0, 0, W, RULER); g.fillStyle = '#9aa0b8'; g.font = '11px system-ui, sans-serif'; g.textBaseline = 'middle';
    const barSec = S * 4, barPx = barSec * pps, every = barPx < 40 ? Math.ceil(40 / barPx) : 1;
    for (let k = Math.max(0, Math.floor(t0 / barSec)); k * barSec < t1; k++) { const x = xOf(k * barSec); g.fillStyle = '#3a3f58'; g.fillRect(Math.round(x), 14, 1, 14); if (k % every === 0) { g.fillStyle = '#c3c8de'; g.fillText(String(k + 1), x + 4, 9); g.fillStyle = '#7a809b'; g.fillText(fmtT(k * barSec).replace(/\.\d+$/, ''), x + 4, 21); } }
    if (P.loop.on || P.loop.b > P.loop.a) { const a = xOf(P.loop.a), b = xOf(P.loop.b); g.fillStyle = P.loop.on ? 'rgba(251,191,36,.18)' : 'rgba(251,191,36,.06)'; g.fillRect(a, RULER, b - a, H - RULER); g.fillStyle = P.loop.on ? '#fbbf24' : '#8a7a40'; g.fillRect(a, 0, b - a, 4); }
    // clips
    P.tracks.forEach((t, i) => t.clips.forEach((c) => {
      const x = xOf(c.start), w = c.dur * pps; if (x + w < 0 || x > W) return;
      const y = RULER + i * LANE + 4, h = LANE - 9, isSel = c.id === sel.clip, dim = !Core.audible(P, t);
      g.globalAlpha = dim ? 0.45 : 1; g.fillStyle = t.color + '33'; roundRect(x, y, Math.max(2, w), h, 6); g.fill(); g.strokeStyle = isSel ? '#fff' : t.color + 'aa'; g.lineWidth = isSel ? 2 : 1; g.stroke();
      g.save(); roundRect(x, y, Math.max(2, w), h, 6); g.clip();
      if (t.type === 'audio') drawWave(c, t, x, y, w, h);
      else if (t.type === 'midi') drawNotes(c, t, x, y, w, h); else drawSteps(c, t, x, y, w, h);
      g.fillStyle = '#ffffffcc'; g.font = '11px system-ui, sans-serif'; g.textBaseline = 'top';
      const nm = t.type === 'audio' ? ((P.assets[c.assetId] || {}).name || 'audio') : t.name; g.fillText(nm, Math.max(x, 0) + 6, y + 4);
      if (t.type === 'audio') { const fi = (c.fadeIn || 0) * pps, fo = (c.fadeOut || 0) * pps; g.strokeStyle = '#ffffffaa'; g.lineWidth = 1; if (fi > 2) { g.beginPath(); g.moveTo(x, y + h); g.lineTo(x + fi, y); g.stroke(); } if (fo > 2) { g.beginPath(); g.moveTo(x + w - fo, y); g.lineTo(x + w, y + h); g.stroke(); } if (isSel) { g.fillStyle = '#fff'; g.fillRect(x + fi - 3, y, 6, 6); g.fillRect(x + w - fo - 3, y, 6, 6); } }
      g.restore(); g.globalAlpha = 1;
    }));
    if (!P.tracks.length) { g.fillStyle = '#6d738d'; g.font = '15px system-ui, sans-serif'; g.textAlign = 'center'; g.fillText('Add a track with the buttons above, or drop audio files here.', W / 2, RULER + 50); g.textAlign = 'left'; }
    const px = xOf(playhead); if (px >= 0 && px <= W) { g.fillStyle = '#fb7185'; g.fillRect(Math.round(px), 0, 2, H); g.beginPath(); g.moveTo(px - 6, 0); g.lineTo(px + 7, 0); g.lineTo(px + 1, 9); g.closePath(); g.fill(); }
    dirty = false;
  }
  function drawWave(c, t, x, y, w, h) {
    const pk = peaks.get(c.assetId); if (!pk) return; const mid = y + h / 2, amp = (h - 16) / 2 * (c.gain == null ? 1 : Math.min(1.5, c.gain)), W = canvas.width; g.fillStyle = t.color;
    const a = Math.max(0, Math.floor(x)), b = Math.min(W, Math.ceil(x + w));
    for (let px = a; px < b; px++) {
      const ta = (px - x) / pps + (c.offset || 0), tb = (px + 1 - x) / pps + (c.offset || 0), ia = Math.max(0, Math.floor(ta * pk.rate / pk.B)), ib = Math.min(pk.data.length / 2 - 1, Math.max(ia, Math.floor(tb * pk.rate / pk.B)));
      let mn = 1, mx = -1; for (let i = ia; i <= ib; i++) { if (pk.data[i * 2] < mn) mn = pk.data[i * 2]; if (pk.data[i * 2 + 1] > mx) mx = pk.data[i * 2 + 1]; }
      if (mn > mx) continue; g.fillRect(px, mid - mx * amp, 1, Math.max(1, (mx - mn) * amp));
    }
  }
  function drawNotes(c, t, x, y, w, h) {
    const ns = c.notes || []; if (!ns.length) return; let lo = 127, hi = 0; ns.forEach((n) => { lo = Math.min(lo, n.p); hi = Math.max(hi, n.p); }); const span = Math.max(12, hi - lo + 1), S = spb();
    g.fillStyle = t.color; ns.forEach((n) => { const nx = x + n.t * S * pps, ny = y + 16 + (h - 24) * (1 - (n.p - lo + 0.5) / span); g.fillRect(nx, ny - 2, Math.max(2, n.d * S * pps - 1), 4); });
  }
  function drawSteps(c, t, x, y, w, h) {
    const sd = spb() / 4 * pps, steps = c.steps || 16, names = GVSynth.DRUMS, rh = (h - 18) / names.length; g.fillStyle = t.color;
    for (let n = 0; n * sd < w; n++) { const idx = n % steps; names.forEach((nm, r) => { if (c.grid && c.grid[nm] && c.grid[nm][idx]) g.fillRect(x + n * sd, y + 16 + r * rh, Math.max(2, sd - 1), Math.max(1, rh - 1)); }); }
  }

  /* ---------- hit testing and dragging ---------- */
  function hit(x, y) {
    if (y < RULER) return { zone: 'ruler' };
    const i = Math.floor((y - RULER) / LANE), t = P.tracks[i]; if (!t) return { zone: 'empty', index: i };
    for (let k = t.clips.length - 1; k >= 0; k--) {
      const c = t.clips[k], cx = xOf(c.start), cw = c.dur * pps; if (x < cx - 2 || x > cx + cw + 2) continue;
      const yy = y - (RULER + i * LANE);
      if (t.type === 'audio' && c.id === sel.clip && yy < 14) { if (Math.abs(x - (cx + (c.fadeIn || 0) * pps)) < 7) return { zone: 'fadein', t, c, index: i }; if (Math.abs(x - (cx + cw - (c.fadeOut || 0) * pps)) < 7) return { zone: 'fadeout', t, c, index: i }; }
      if (x < cx + 6) return { zone: 'left', t, c, index: i }; if (x > cx + cw - 6) return { zone: 'right', t, c, index: i };
      return { zone: 'body', t, c, index: i };
    }
    return { zone: 'lane', t, index: i };
  }
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    canvas.focus(); const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, h = hit(x, y); canvas.setPointerCapture(e.pointerId);
    if (h.zone === 'ruler') { drag = { kind: e.shiftKey ? 'loop' : 'seek', a: tOf(x) }; if (!e.shiftKey) { setPlayhead(Math.max(0, snap(tOf(x)))); } return; }
    if (h.zone === 'empty') { sel = { track: null, clip: null }; buildHeads(); return; }
    sel.track = h.t.id;
    if (h.zone === 'lane') { sel.clip = null; setPlayhead(Math.max(0, snap(tOf(x)))); buildHeads(); refreshSelUI(); dirty = true; return; }
    sel.clip = h.c.id; buildHeads(); refreshSelUI(); dirty = true;
    drag = { kind: h.zone, t: h.t, c: h.c, x0: x, orig: JSON.parse(JSON.stringify(h.c)), before: snapshotJSON(), moved: false, track0: h.index };
  });
  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (!drag) { const h = hit(x, y); canvas.style.cursor = h.zone === 'left' || h.zone === 'right' ? 'ew-resize' : h.zone === 'body' ? 'grab' : h.zone === 'fadein' || h.zone === 'fadeout' ? 'col-resize' : 'default'; return; }
    if (drag.kind === 'seek') { setPlayhead(Math.max(0, snap(tOf(x)))); return; }
    if (drag.kind === 'loop') { const a = snap(drag.a), b = snap(tOf(x)); P.loop.a = Math.max(0, Math.min(a, b)); P.loop.b = Math.max(P.loop.a + 0.1, Math.max(a, b)); P.loop.on = true; $('loop').setAttribute('aria-pressed', true); dirty = true; return; }
    const { c, orig, t } = drag, dt = (x - drag.x0) / pps; if (Math.abs(x - drag.x0) > 2) drag.moved = true; if (!drag.moved) return;
    if (drag.kind === 'body') {
      c.start = Math.max(0, snap(orig.start + dt));
      const idx = Math.max(0, Math.min(P.tracks.length - 1, Math.floor((y - RULER) / LANE))), nt = P.tracks[idx];
      if (nt && nt !== t && nt.type === t.type) { t.clips = t.clips.filter((k) => k !== c); nt.clips.push(c); drag.t = nt; sel.track = nt.id; buildHeads(); }
    } else if (drag.kind === 'left') {
      let ns = Math.max(0, snap(orig.start + dt)); ns = Math.min(ns, orig.start + orig.dur - 0.05); if (t.type === 'audio') ns = Math.max(ns, orig.start - (orig.offset || 0));
      const d = ns - orig.start; c.start = ns; c.dur = orig.dur - d; if (t.type === 'audio') { c.offset = (orig.offset || 0) + d; } else if (t.type === 'midi') c.notes = (orig.notes || []).map((n) => Object.assign({}, n, { t: n.t - d / spb() }));
    } else if (drag.kind === 'right') {
      let nd = Math.max(0.05, snap(orig.start + orig.dur + dt) - orig.start); if (t.type === 'audio') { const a = P.assets[c.assetId]; if (a) nd = Math.min(nd, a.dur - (orig.offset || 0)); } c.dur = nd;
    } else if (drag.kind === 'fadein') c.fadeIn = Math.max(0, Math.min(orig.dur - (c.fadeOut || 0), (orig.fadeIn || 0) + dt));
    else if (drag.kind === 'fadeout') c.fadeOut = Math.max(0, Math.min(orig.dur - (c.fadeIn || 0), (orig.fadeOut || 0) - dt));
    dirty = true;
  });
  const endDrag = () => {
    if (!drag) return; const d = drag; drag = null;
    if (d.kind === 'loop') { markDirty(); if (playing) scheduleRestart(); return; }
    if (d.kind === 'seek') return; if (d.moved) { changed('Edit clip', d.before); afterStructure(); }
  };
  canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('dblclick', (e) => {
    const r = canvas.getBoundingClientRect(), h = hit(e.clientX - r.left, e.clientY - r.top);
    if (h.c && h.t.type !== 'audio') openEditor(h.t, h.c);
    else if ((h.zone === 'lane') && h.t.type !== 'audio') { const c = newMidiClip(h.t, Math.max(0, snap(tOf(e.clientX - r.left)))); openEditor(h.t, c); }
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) { const r = canvas.getBoundingClientRect(), tm = tOf(e.clientX - r.left); setZoom(pps * (e.deltaY < 0 ? 1.15 : 1 / 1.15)); scrollX = Math.max(0, tm - (e.clientX - r.left) / pps); syncScroll(); }
    else { scrollX = Math.max(0, scrollX + (e.deltaX || e.deltaY) / pps); syncScroll(); }
    dirty = true;
  }, { passive: false });
  function setZoom(v) { pps = Math.max(8, Math.min(600, v)); $('zoom').value = Math.round(Math.log(pps / 8) / Math.log(600 / 8) * 100); dirty = true; syncScroll(); }
  function syncScroll() { const total = Math.max(60, Core.projectEnd(P) + 30); $('hscroll').max = Math.round(total * 10); $('hscroll').value = Math.round(scrollX * 10); }
  $('hscroll').oninput = () => { scrollX = $('hscroll').value / 10; dirty = true; };
  $('zoom').oninput = () => setZoom(8 * Math.pow(600 / 8, $('zoom').value / 100));
  $('zoomin').onclick = () => setZoom(pps * 1.4); $('zoomout').onclick = () => setZoom(pps / 1.4);
  const drop = $('tlwrap');
  ['dragover', 'dragenter'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => importFiles([...e.dataTransfer.files].filter((f) => /^audio\//.test(f.type) || /\.(mp3|wav|ogg|m4a|aac|flac|webm)$/i.test(f.name))));

  /* ---------- transport and playback ---------- */
  function setPlayhead(t) { playhead = Math.max(0, t); if (playing) scheduleRestart(true); dirty = true; $('time').textContent = fmtT(playhead); ensureVisible(); }
  function ensureVisible() { const W = canvas.width / pps; if (playhead < scrollX || playhead > scrollX + W - 1) { scrollX = Math.max(0, playhead - W * 0.1); syncScroll(); } }
  function stopSources() { live.forEach((s) => { try { s.onended = null; s.stop(); } catch (_) {} }); live = []; if (graph) { try { graph.out.disconnect(); graph.master.disconnect(); } catch (_) {} } graph = null; }
  function tracksTap() { P.tracks.forEach((t) => { const n = graph.tracks[t.id]; if (!n) return; const an = ctx.createAnalyser(); an.fftSize = 512; n.gain.connect(an); n.an = an; }); }
  function endOfSong() { return Core.projectEnd(P) + 0.05; }
  function startFrom(pos) {
    ensureCtx(); ctx.resume(); stopSources();
    graph = Core.buildGraph(ctx, bus, P, {}); tracksTap();
    let from = pos; if (P.loop.on && P.loop.b > P.loop.a && from >= P.loop.b) from = P.loop.a;
    const to = P.loop.on && P.loop.b > P.loop.a ? P.loop.b : endOfSong();
    if (!(to > from)) { playing = false; return say('There is nothing to play after the playhead.'); }
    segs = [{ when: ctx.currentTime + 0.08, from, to }]; Core.scheduleSegment(ctx, graph, P, buffers, segs[0], { live, metronome: $('metro').getAttribute('aria-pressed') === 'true' });
    playing = true; $('play').textContent = '❚❚ Pause'; $('play').setAttribute('aria-label', 'Pause');
    clearInterval(tick); tick = setInterval(pump, 40); pump();
  }
  function pump() {
    if (!playing) return; const last = segs[segs.length - 1], loopOn = P.loop.on && P.loop.b > P.loop.a;
    while (loopOn && last && segs[segs.length - 1].when + (segs[segs.length - 1].to - segs[segs.length - 1].from) < ctx.currentTime + 1.2 && segs.length < 400) {
      const ps = segs[segs.length - 1], seg = { when: ps.when + (ps.to - ps.from), from: P.loop.a, to: P.loop.b }; segs.push(seg); Core.scheduleSegment(ctx, graph, P, buffers, seg, { live, metronome: $('metro').getAttribute('aria-pressed') === 'true' });
    }
    if (segs.length > 3) { const keep = segs.filter((s) => s.when + (s.to - s.from) > ctx.currentTime - 0.2); segs = keep.length ? keep : segs.slice(-1); }
    const p = posNow(); if (p != null) { playhead = p; $('time').textContent = fmtT(playhead); dirty = true; }
    const l = segs[segs.length - 1]; if (!loopOn && ctx.currentTime > l.when + (l.to - l.from) + 1.4) { stop(true); }
  }
  function posNow() { const now = ctx.currentTime; for (const s of segs) { const len = s.to - s.from; if (now >= s.when && now < s.when + len) return s.from + (now - s.when); } const f = segs[0]; return f && now < f.when ? f.from : (segs.length ? Math.min(segs[segs.length - 1].to, playhead) : null); }
  function stop(atEnd) { clearInterval(tick); const pos = playing && ctx ? posNow() : playhead; stopSources(); playing = false; $('play').textContent = '▶ Play'; $('play').setAttribute('aria-label', 'Play'); if (atEnd) { playhead = P.loop.on ? P.loop.a : 0; ensureVisible(); } else if (pos != null) playhead = pos; $('time').textContent = fmtT(playhead); dirty = true; }
  function toggle() { if (playing) stop(); else startFrom(playhead); }
  function scheduleRestart() { clearTimeout(restartT); restartT = setTimeout(() => { if (playing) { const p = posNow(); startFrom(p == null ? playhead : p); } }, 120); }
  function applyAllMix() { if (graph) P.tracks.forEach((t) => Core.applyMix(graph, P, t)); }
  $('play').onclick = toggle; $('stop').onclick = () => { if (playing) stop(); playhead = 0; scrollX = 0; $('time').textContent = fmtT(0); syncScroll(); dirty = true; };
  $('rew').onclick = () => { setPlayhead(P.loop.on ? P.loop.a : 0); };
  $('loop').onclick = () => { const b = snapshotJSON(); P.loop.on = !P.loop.on; if (P.loop.on && !(P.loop.b > P.loop.a)) { P.loop.a = 0; P.loop.b = 4 * spb() * 2; } $('loop').setAttribute('aria-pressed', P.loop.on); changed('Loop', b); dirty = true; };
  $('metro').onclick = () => { $('metro').setAttribute('aria-pressed', $('metro').getAttribute('aria-pressed') !== 'true'); if (playing) scheduleRestart(); };
  $('bpm').onchange = () => { const v = Math.max(30, Math.min(300, +$('bpm').value || 120)); const b = snapshotJSON(); P.bpm = v; $('bpm').value = v; changed('Tempo', b); dirty = true; };
  $('master').oninput = () => { P.master = $('master').value / 100; if (graph) graph.master.gain.value = P.master; }; $('master').onchange = () => markDirty();
  $('lim').onchange = () => { P.limiter = $('lim').checked; markDirty(); if (playing) scheduleRestart(); };
  $('pname').onchange = () => { P.name = $('pname').value.trim() || 'Untitled project'; markDirty(); };
  $('snap').onchange = () => { dirty = true; };
  ['addaudio', 'addkeys', 'adddrums'].forEach((id) => { $(id).onclick = () => { addTrack(id === 'addaudio' ? 'audio' : id === 'addkeys' ? 'midi' : 'drum'); }; });
  $('import').onclick = () => $('file').click(); $('file').onchange = () => { importFiles([...$('file').files]); $('file').value = ''; };
  $('split').onclick = () => splitAt(playhead); $('dup').onclick = dupClip; $('del').onclick = delClip; $('undo').onclick = undo; $('redo').onclick = redo;
  function refreshSelUI() { const has = !!sel.clip; ['split', 'dup', 'del'].forEach((k) => { $(k).disabled = !has; }); const x = has && clipOf(sel.clip); $('clipinfo').textContent = x ? (x.t.type === 'audio' ? 'Clip: ' + ((P.assets[x.c.assetId] || {}).name || 'audio') + ' · ' + fmtT(x.c.dur) : 'Clip on ' + x.t.name + ' · ' + fmtT(x.c.dur) + (x.t.type !== 'audio' ? ' · double click or press Enter to edit' : '')) : 'No clip selected'; }

  /* ---------- keyboard ---------- */
  window.addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return; if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName) && e.target.type !== 'range' && !(e.target.type === 'checkbox')) return; if (e.target.closest && e.target.closest('#rollpane')) return;
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); } else if (mod && k === 'y') { e.preventDefault(); redo(); } else if (mod && k === 'd') { e.preventDefault(); dupClip(); } else if (mod && k === 'c') { copyClip(); } else if (mod && k === 'v') { pasteClip(); } else if (mod && k === 's') { e.preventDefault(); saveNow(); }
    else if (e.code === 'Space' && e.target.tagName !== 'BUTTON') { e.preventDefault(); toggle(); }
    else if (k === 's' && !mod) splitAt(playhead); else if (k === 'delete' || k === 'backspace') { if (sel.clip) { e.preventDefault(); delClip(); } }
    else if (k === 'l') $('loop').click(); else if (k === 'm' && !mod) $('metro').click(); else if (k === 'home') setPlayhead(0); else if (k === '=' || k === '+') setZoom(pps * 1.4); else if (k === '-') setZoom(pps / 1.4);
    else if (k === 'enter' && sel.clip) { const x = clipOf(sel.clip); if (x && x.t.type !== 'audio') openEditor(x.t, x.c); }
    else if (k === 'arrowleft' || k === 'arrowright') { if (document.activeElement !== canvas) return; e.preventDefault(); const u = snapUnit() || 0.1, d = (k === 'arrowright' ? 1 : -1) * (e.shiftKey ? 4 : 1) * u; if (e.altKey && sel.clip) { const x = clipOf(sel.clip); edit('Nudge', () => { x.c.start = Math.max(0, x.c.start + d); }); } else setPlayhead(Math.max(0, playhead + d)); }
    else if (k === 'arrowup' || k === 'arrowdown') { if (document.activeElement !== canvas) return; e.preventDefault(); const i = P.tracks.findIndex((t) => t.id === sel.track), n = Math.max(0, Math.min(P.tracks.length - 1, (i < 0 ? 0 : i) + (k === 'arrowdown' ? 1 : -1))); if (P.tracks[n]) { sel.track = P.tracks[n].id; sel.clip = null; buildHeads(); refreshSelUI(); } }
    else if (k === ']' || k === '[') { const tr = trackOf(sel.track); if (!tr || !tr.clips.length) return; const cs = tr.clips.slice().sort((a, b) => a.start - b.start), i = cs.findIndex((c) => c.id === sel.clip), n = Math.max(0, Math.min(cs.length - 1, i < 0 ? 0 : i + (k === ']' ? 1 : -1))); sel.clip = cs[n].id; setPlayhead(cs[n].start); refreshSelUI(); }
  });

  /* ---------- meters and render loop ---------- */
  const lvl = new Float32Array(1024), mcan = $('mmeter'), mg = mcan.getContext('2d'); let hold = [0, 0];
  const peakDb = (an, buf) => { an.getFloatTimeDomainData(buf); let p = 0; for (let i = 0; i < buf.length; i++) p = Math.max(p, Math.abs(buf[i])); return p; };
  function loop() {
    if (dirty || playing) draw();
    if (ctx && playing && anL) {
      const pl = peakDb(anL, lvl), pr = peakDb(anR, lvl); hold[0] = Math.max(pl, hold[0] * 0.92); hold[1] = Math.max(pr, hold[1] * 0.92);
      mg.clearRect(0, 0, mcan.width, mcan.height); [hold[0], hold[1]].forEach((v, i) => { const db = v > 1e-5 ? 20 * Math.log10(v) : -90, w = Math.max(0, Math.min(1, (db + 60) / 60)) * mcan.width; mg.fillStyle = db > -1 ? '#f43f5e' : db > -9 ? '#fbbf24' : '#34d399'; mg.fillRect(0, i * 11 + 2, w, 8); });
      $('mdb').textContent = (Math.max(hold[0], hold[1]) > 1e-5 ? (20 * Math.log10(Math.max(hold[0], hold[1]))).toFixed(1) : '−∞') + ' dB peak';
      document.querySelectorAll('[data-lv]').forEach((el) => { const n = graph && graph.tracks[el.dataset.lv]; if (n && n.an) { const v = peakDb(n.an, lvl), db = v > 1e-5 ? 20 * Math.log10(v) : -90; el.firstChild.style.width = Math.max(0, Math.min(100, (db + 60) / 60 * 100)) + '%'; } });
    } else if (!playing && hold[0] > 0) { hold = [0, 0]; mg.clearRect(0, 0, mcan.width, mcan.height); $('mdb').textContent = ''; document.querySelectorAll('[data-lv]').forEach((el) => { el.firstChild.style.width = '0'; }); }
    requestAnimationFrame(loop);
  }

  /* ---------- editors (piano roll and step grid live in studio-roll.js) ---------- */
  function openEditor(t, c) { sel = { track: t.id, clip: c.id }; buildHeads(); refreshSelUI(); if (window.GVRoll) GVRoll.open(t.id, c.id); }
  const api = { get P() { return P; }, trackOf, clipOf, spb, edit, markDirty, changed, snapshotJSON, pushUndo, ensureCtx, bus: () => bus, say, afterStructure, get playhead() { return playhead; }, redraw: () => { dirty = true; } };
  window.GVStudio = api;

  /* ---------- projects, backup, export ---------- */
  async function refreshProjects() {
    const box = $('plist'); box.innerHTML = ''; const items = IO.list();
    if (!items.length) { const li = document.createElement('li'); li.textContent = 'No saved projects yet. Your work is saved here automatically.'; li.className = 'status'; box.appendChild(li); return; }
    items.forEach((it) => {
      const li = document.createElement('li'); li.className = 'prow'; const nm = document.createElement('span'); nm.textContent = it.name + (it.id === P.id ? ' (open)' : '') + ' · ' + (it.tracks || 0) + ' tracks · ' + new Date(it.updated).toLocaleString(); li.appendChild(nm);
      const o = document.createElement('button'); o.className = 'btn mini'; o.textContent = 'Open'; o.setAttribute('aria-label', 'Open project ' + it.name); o.onclick = () => openProject(it.id);
      const d = document.createElement('button'); d.className = 'btn mini'; d.textContent = 'Delete'; d.setAttribute('aria-label', 'Delete project ' + it.name); d.onclick = async () => { if (!confirm('Delete the project "' + it.name + '"? This cannot be undone.')) return; await IO.remove(it.id); if (it.id === P.id) newProject(); refreshProjects(); };
      li.append(o, d); box.appendChild(li);
    });
  }
  async function loadBuffers() {
    for (const [aid, b] of blobs) { if (buffers.has(aid)) continue; try { ensureCtx(); const buf = await ctx.decodeAudioData(await b.arrayBuffer()); buffers.set(aid, buf); peaks.set(aid, Core.peaksOf(buf)); } catch (_) { say('Could not read audio for ' + ((P.assets[aid] || {}).name || 'a clip') + '.'); } }
  }
  function resetView() { stop(); undoS = []; redoS = []; syncUndo(); sel = { track: null, clip: null }; playhead = 0; scrollX = 0; $('time').textContent = fmtT(0); if (window.GVRoll) GVRoll.close(); }
  async function openProject(id) { try { await saveNow(); const r = await IO.load(id); resetView(); P = r.p; blobs = r.blobs; buffers = new Map(); peaks = new Map(); await loadBuffers(); afterStructure(); syncScroll(); refreshProjects(); say('Opened ' + P.name + '.'); } catch (e) { say('Could not open that project: ' + e.message); } }
  function newProject() { resetView(); P = Core.newProject(); blobs = new Map(); buffers = new Map(); peaks = new Map(); afterStructure(); markDirty(); refreshProjects(); }
  $('pnew').onclick = async () => { await saveNow(); newProject(); say('Started a new project.'); };
  $('pexport').onclick = async () => { await saveNow(); const z = await IO.exportZip(P, blobs); dl(z, (P.name.replace(/[^\w\- ]+/g, '_') || 'project') + '.govibe-project.zip'); say('Backup downloaded. It holds the project and its audio.'); };
  $('pimport').onclick = () => $('pimpfile').click();
  $('pimpfile').onchange = async () => { const f = $('pimpfile').files[0]; $('pimpfile').value = ''; if (!f) return; try { const r = await IO.importZip(f); resetView(); if (IO.list().some((x) => x.id === r.p.id)) { r.p.id = Core.uid(); r.p.name += ' (imported)'; } P = r.p; blobs = r.blobs; buffers = new Map(); peaks = new Map(); await loadBuffers(); afterStructure(); syncScroll(); await saveNow(); refreshProjects(); say('Imported ' + P.name + '.'); } catch (e) { say('Import failed: ' + e.message); } };
  function dl(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
  async function exportMix() {
    ensureCtx(); const range = $('xrange').value, fmt = $('xfmt').value; let from = 0, to = Core.projectEnd(P);
    if (range === 'loop') { from = P.loop.a; to = P.loop.b; } if (!(to > from)) return say('Nothing to export yet. Add some clips first.');
    $('xgo').disabled = true; say('Rendering…');
    try {
      const buf = await Core.render(P, buffers, { from, to, rate: ctx.sampleRate }), safe = (P.name.replace(/[^\w\- ]+/g, '_') || 'mix');
      if (fmt === 'mp3') dl(await Core.mp3Blob(buf, 192), safe + '.mp3'); else dl(Core.wavBlob(buf, fmt === 'wav24' ? 24 : 16), safe + '.wav'); say('Export downloaded.');
    } catch (e) { say('Export failed: ' + e.message); } finally { $('xgo').disabled = false; }
  }
  async function exportStems() {
    ensureCtx(); const to = Core.projectEnd(P); if (!(to > 0) || !P.tracks.length) return say('Nothing to export yet.'); $('xstems').disabled = true; say('Rendering each track…'); const entries = [], used = {};
    try { for (const t of P.tracks) { if (!t.clips.length) continue; const buf = await Core.render(P, buffers, { from: 0, to, rate: ctx.sampleRate, onlyTrack: t.id }); let n = t.name.replace(/[^\w\- ]+/g, '_') || 'track'; used[n] = (used[n] || 0) + 1; if (used[n] > 1) n += ' (' + used[n] + ')'; entries.push({ name: n + '.wav', blob: Core.wavBlob(buf, 16) }); } dl(await GVZip.write(entries), (P.name.replace(/[^\w\- ]+/g, '_') || 'stems') + '-stems.zip'); say('Stems downloaded: one WAV per track, all the same length.'); }
    catch (e) { say('Export failed: ' + e.message); } finally { $('xstems').disabled = false; }
  }
  $('xgo').onclick = exportMix; $('xstems').onclick = exportStems;

  /* ---------- start ---------- */
  async function start() {
    syncUndo(); afterStructure(); syncScroll(); setZoom(60); $('time').textContent = fmtT(0); requestAnimationFrame(loop);
    const from = new URLSearchParams(location.search).get('from');
    if (from === 'record' && window.GVStore) { try { const b = await GVStore.get('studio-import'); if (b) { await GVStore.del('studio-import'); b.name = 'Recording.wav'; await importFiles([b]); } } catch (_) { /* nothing handed over */ } }
    else { const items = IO.list(); if (items.length) await openProject(items[0].id); }
    refreshProjects();
  }
  window.addEventListener('beforeunload', () => { if (dirty) saveNow(); });
  window.addEventListener('resize', () => { dirty = true; });
  if (gvtest) window.__st = Object.defineProperties(api, Object.getOwnPropertyDescriptors({ Core, get buffers() { return buffers; }, get blobs() { return blobs; }, get sel() { return sel; }, set sel(v) { sel = v; }, importFiles, addTrack, splitAt, toggle, startFrom, stop, get playing() { return playing; }, get segs() { return segs; }, setPlayhead, xOf, tOf, setZoom, get pps() { return pps; }, saveNow, openProject, newProject, exportMix, exportStems, get graph() { return graph; }, undo, redo, newMidiClip, dupClip, delClip, get undoDepth() { return undoS.length; } }));
  start();
})();
