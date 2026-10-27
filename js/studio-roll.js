/* GoVibe Mix — Studio editors: piano roll for keys clips and a step grid for drum clips. */
window.GVRoll = (() => {
  const S = () => window.GVStudio, pane = () => document.getElementById('rollpane');
  const LOW = 36, HIGH = 96, ROWH = 16, KEYW = 58, PXB = 52;
  const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'], BLACK = new Set([1, 3, 6, 8, 10]);
  const SCALES = { Chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], Major: [0, 2, 4, 5, 7, 9, 11], 'Natural minor': [0, 2, 3, 5, 7, 8, 10], 'Major pentatonic': [0, 2, 4, 7, 9], 'Minor pentatonic': [0, 3, 5, 7, 10], Blues: [0, 3, 5, 6, 7, 10] };
  const CHORDS = { 'Single note': [0], 'Major chord': [0, 4, 7], 'Minor chord': [0, 3, 7], 'Seventh chord': [0, 4, 7, 10], 'Minor seventh': [0, 3, 7, 10] };
  let redrawFn = null, selfEdit = false, fromRoll = false, cur = null, selNote = null, timer = 0, drag = null, lastLen = 1;
  let opts = { grid: 0.25, root: 0, scale: 'Chromatic', chord: 'Single note' };
  const el = (tag, cls, props) => Object.assign(Object.assign(document.createElement(tag), { className: cls || '' }), props || {});
  const find = () => (cur ? S().clipOf(cur.clip) || null : null);
  const inScale = (p) => SCALES[opts.scale].includes(((p - opts.root) % 12 + 12) % 12);

  function close() { cur = null; selNote = null; clearInterval(timer); const p = pane(); if (p) p.innerHTML = ''; }
  function refresh() {
    if (!cur) return; const x = find(); if (!x) return close();
    if (selfEdit && redrawFn && pane().querySelector('#rollcv')) { redrawFn(); return; }
    const sc = pane().querySelector('.rollscroll'), top = sc ? sc.scrollTop : 0, left = sc ? sc.scrollLeft : 0, focus = document.activeElement && document.activeElement.id === 'rollcv';
    build(); const n = pane().querySelector('.rollscroll'); if (n) { n.scrollTop = top; n.scrollLeft = left; } if (focus) { const cv = pane().querySelector('#rollcv'); if (cv) { cv.focus(); setTimeout(() => { const c2 = pane().querySelector('#rollcv'); if (c2 && cur) c2.focus(); }, 0); } }
  }
  function open(track, clip) { cur = { track, clip }; selNote = null; build(); pane().scrollIntoView({ block: 'nearest' }); }

  function build() {
    const x = find(); if (!x) return close(); const { t, c } = x, p = pane(); p.innerHTML = ''; clearInterval(timer); redrawFn = null;
    const panel = el('div', 'panel'); p.appendChild(panel);
    const head = el('div', 'row'); head.style.justifyContent = 'space-between';
    const h = el('h2', '', { textContent: (t.type === 'midi' ? 'Piano roll' : 'Drum pattern') + ' · ' + t.name }); h.id = 'rollh'; const cb = el('button', 'btn', { textContent: 'Close editor' }); cb.onclick = close; head.append(h, cb); panel.appendChild(head);
    panel.setAttribute('role', 'region'); panel.setAttribute('aria-labelledby', 'rollh');
    if (t.type === 'midi') buildRoll(panel, t, c); else buildSteps(panel, t, c);
  }
  const labelled = (txt, ctl) => { const l = el('label', 'ctl'); l.append(document.createTextNode(txt), ctl); return l; };
  const sel = (items, val, fn, aria) => { const s = el('select'); items.forEach((it) => { const o = el('option', '', { textContent: Array.isArray(it) ? it[1] : it, value: Array.isArray(it) ? it[0] : it }); s.appendChild(o); }); s.value = String(val); s.onchange = () => fn(s.value); if (aria) s.setAttribute('aria-label', aria); return s; };
  const apply = (label, fn) => { selfEdit = true; try { S().edit(label, fn); } finally { selfEdit = false; } };

  /* ---------- piano roll ---------- */
  function buildRoll(panel, t, c) {
    const api = S(), spb = api.spb(), bars = () => c.dur / spb;
    const row = el('div', 'row'); row.style.alignItems = 'flex-end'; row.style.marginTop = '8px'; panel.appendChild(row);
    row.append(
      labelled('Grid', sel([[0.25, '1/16'], [0.5, '1/8'], [1, '1/4 beat'], [2, '1/2 note'], [api.barBeats(), 'Bar']], opts.grid, (v) => { opts.grid = +v; })),
      labelled('Scale key', sel(NAMES.map((n, i) => [i, n]), opts.root, (v) => { opts.root = +v; draw(); })),
      labelled('Scale', sel(Object.keys(SCALES), opts.scale, (v) => { opts.scale = v; draw(); })),
      labelled('Click adds', sel(Object.keys(CHORDS), opts.chord, (v) => { opts.chord = v; })),
      labelled('Length in beats', Object.assign(el('input'), { type: 'number', min: 1, max: 256, step: 1, value: Math.round(bars() * 100) / 100, onchange(e) { const v = Math.max(1, Math.min(256, +e.target.value || 4)); apply('Clip length', () => { c.dur = v * spb; }); } }))
    );
    const row2 = el('div', 'row'); row2.style.marginTop = '8px'; panel.appendChild(row2);
    const btn = (txt, fn, aria) => { const b = el('button', 'btn mini', { textContent: txt }); if (aria) b.setAttribute('aria-label', aria); b.onclick = fn; row2.appendChild(b); return b; };
    const targets = () => (selNote ? c.notes.filter((n) => n === selNote) : c.notes);
    btn('Quantize', () => apply('Quantize', () => { const g = opts.grid; targets().forEach((n) => { n.t = Math.max(0, Math.round(n.t / g) * g); n.d = Math.max(g, Math.round(n.d / g) * g); }); }));
    btn('Down 12', () => apply('Transpose', () => targets().forEach((n) => { n.p = Math.max(0, n.p - 12); }))); btn('Down 1', () => apply('Transpose', () => targets().forEach((n) => { n.p = Math.max(0, n.p - 1); })));
    btn('Up 1', () => apply('Transpose', () => targets().forEach((n) => { n.p = Math.min(127, n.p + 1); }))); btn('Up 12', () => apply('Transpose', () => targets().forEach((n) => { n.p = Math.min(127, n.p + 12); })));
    btn('Delete note', () => { if (selNote) apply('Delete note', () => { c.notes = c.notes.filter((n) => n !== selNote); selNote = null; }); });
    btn('Clear all', () => { if (c.notes.length && confirm('Remove every note in this clip?')) apply('Clear', () => { c.notes = []; selNote = null; }); });
    const vel = el('input'); vel.type = 'range'; vel.min = 1; vel.max = 127; vel.value = 100; vel.setAttribute('aria-label', 'Velocity of the selected note'); vel.oninput = () => { if (selNote) { selNote.v = +vel.value; draw(); } }; vel.onchange = () => api.markDirty();
    vel.onpointerdown = () => { vel._b = api.snapshotJSON(); }; vel.onpointerup = () => { if (vel._b && vel._b !== api.snapshotJSON()) api.pushUndo(vel._b); };
    row2.appendChild(labelled('Velocity (selected note)', vel));
    const info = el('p', 'status', { textContent: 'Click to add a note, drag to move, drag the right edge to resize. Delete removes the selected note. Arrow keys move it.' }); info.setAttribute('role', 'status'); panel.appendChild(info);
    const wrap = el('div', 'rollscroll'); const cv = el('canvas'); cv.id = 'rollcv'; cv.tabIndex = 0; cv.setAttribute('role', 'application'); cv.setAttribute('aria-label', 'Piano roll. Click to add a note. Drag to move. Arrow keys move the selected note. Delete removes it.');
    wrap.appendChild(cv); panel.appendChild(wrap);
    const g = cv.getContext('2d'), rows = HIGH - LOW + 1, yOf = (p) => (HIGH - p) * ROWH, pOf = (y) => HIGH - Math.floor(y / ROWH), bx = (b) => KEYW + b * PXB, bOf = (x) => (x - KEYW) / PXB;
    const size = () => { const w = Math.max(600, Math.ceil(KEYW + (bars() + 2) * PXB)), h = rows * ROWH; if (cv.width !== w) cv.width = w; if (cv.height !== h) cv.height = h; };
    redrawFn = () => draw();
    function draw() {
      size(); const W = cv.width, H = cv.height, B = bars(); g.clearRect(0, 0, W, H);
      for (let p = LOW; p <= HIGH; p++) { const y = yOf(p), pc = p % 12, ins = inScale(p); g.fillStyle = BLACK.has(pc) ? (ins ? '#1a1b28' : '#12131c') : (ins ? '#22243a' : '#181a28'); if (opts.scale !== 'Chromatic' && ins && pc === opts.root) g.fillStyle = '#2e2a52'; g.fillRect(KEYW, y, W - KEYW, ROWH); g.fillStyle = '#0d0e16'; g.fillRect(KEYW, y + ROWH - 1, W - KEYW, 1); }
      for (let b = 0; b <= B + 2; b += opts.grid >= 1 ? 1 : opts.grid) { const x = Math.round(bx(b)) + 0.5, strong = Math.abs(b % api.barBeats()) < 1e-6, beat = Math.abs(b % 1) < 1e-6; g.fillStyle = strong ? '#3b4060' : beat ? '#2a2e45' : '#1e2132'; g.fillRect(x, 0, 1, H); }
      g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(bx(B), 0, W - bx(B), H);
      for (let p = LOW; p <= HIGH; p++) { const y = yOf(p), pc = p % 12; g.fillStyle = BLACK.has(pc) ? '#111' : '#e8e8f0'; g.fillRect(0, y, BLACK.has(pc) ? KEYW * 0.62 : KEYW - 1, ROWH - 1); if (pc === 0) { g.fillStyle = '#333'; g.font = '10px system-ui'; g.textBaseline = 'middle'; g.fillText('C' + (Math.floor(p / 12) - 1), KEYW - 24, y + ROWH / 2); } }
      c.notes.forEach((n) => { if (n.p < LOW || n.p > HIGH) return; const x = bx(n.t), y = yOf(n.p), w = Math.max(4, n.d * PXB - 1); g.fillStyle = n === selNote ? '#fbbf24' : '#a78bfa'; g.globalAlpha = 0.45 + 0.55 * ((n.v || 100) / 127); g.fillRect(x, y + 1, w, ROWH - 2); g.globalAlpha = 1; g.strokeStyle = n === selNote ? '#fff' : '#ddd6fe'; g.strokeRect(x + 0.5, y + 1.5, w - 1, ROWH - 3); });
      const ph = (api.playhead - c.start) / spb; if (ph >= 0 && ph <= B) { g.fillStyle = '#fb7185'; g.fillRect(Math.round(bx(ph)), 0, 2, H); }
    }
    const hitNote = (x, y) => { const b = bOf(x), p = pOf(y); for (let i = c.notes.length - 1; i >= 0; i--) { const n = c.notes[i]; if (n.p === p && b >= n.t && b <= n.t + n.d) return { n, edge: x > bx(n.t + n.d) - 7 }; } return null; };
    const preview = (p) => { api.ensureCtx(); const ctx = api.bus().context, tr = api.trackOf(cur.track); ctx.resume(); GVSynth.note(ctx, api.bus(), (tr && tr.inst) || 'Piano', p, 0.8, ctx.currentTime + 0.01, 0.4); };
    cv.addEventListener('pointerdown', (e) => { cv.focus(); fromRoll = true;
      cv.focus(); const r = cv.getBoundingClientRect(), x = (e.clientX - r.left) * (cv.width / r.width), y = (e.clientY - r.top) * (cv.height / r.height); cv.setPointerCapture(e.pointerId);
      if (x < KEYW) { preview(pOf(y)); return; }
      const h = hitNote(x, y), before = api.snapshotJSON();
      if (h) { selNote = h.n; vel.value = h.n.v || 100; drag = { kind: h.edge ? 'resize' : 'move', n: h.n, x0: x, y0: y, orig: Object.assign({}, h.n), before, moved: false }; preview(h.n.p); }
      else { const b = Math.max(0, Math.floor(bOf(x) / opts.grid + 1e-6) * opts.grid), p0 = pOf(y); if (b >= bars()) return; const g0 = Math.min(lastLen, bars() - b);
        let made; apply('Add note', () => { made = CHORDS[opts.chord].map((iv) => ({ t: b, d: g0, p: Math.min(HIGH, p0 + iv), v: +vel.value || 100 })); c.notes.push(...made); selNote = made[0]; }); preview(p0); drag = null; }
      draw();
    });
    cv.addEventListener('pointermove', (e) => {
      const r = cv.getBoundingClientRect(), x = (e.clientX - r.left) * (cv.width / r.width), y = (e.clientY - r.top) * (cv.height / r.height);
      if (!drag) { const h = x > KEYW ? hitNote(x, y) : null; cv.style.cursor = h ? (h.edge ? 'ew-resize' : 'grab') : 'crosshair'; return; }
      const n = drag.n, db = Math.round((bOf(x) - bOf(drag.x0)) / opts.grid) * opts.grid; if (Math.abs(x - drag.x0) > 2 || Math.abs(y - drag.y0) > 2) drag.moved = true; if (!drag.moved) return;
      if (drag.kind === 'move') { n.t = Math.max(0, Math.min(bars() - 0.05, drag.orig.t + db)); const np = Math.max(LOW, Math.min(HIGH, drag.orig.p + (pOf(y) - pOf(drag.y0)))); if (np !== n.p) { n.p = np; preview(np); } }
      else { n.d = Math.max(opts.grid, Math.min(bars() - n.t, drag.orig.d + db)); lastLen = n.d; }
      draw();
    });
    const up = () => { if (!drag) return; const d = drag; drag = null; if (d.moved) api.changed('Edit note', d.before); api.redraw(); };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('keydown', (e) => {
      if (!selNote) return; const k = e.key;
      if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); apply('Delete note', () => { c.notes = c.notes.filter((n) => n !== selNote); selNote = null; }); }
      else if (k === 'ArrowUp' || k === 'ArrowDown') { e.preventDefault(); const d = k === 'ArrowUp' ? 1 : -1, n = selNote; apply('Move note', () => { n.p = Math.max(LOW, Math.min(HIGH, n.p + (e.shiftKey ? 12 * d : d))); }); selNote = n; preview(n.p); }
      else if (k === 'ArrowLeft' || k === 'ArrowRight') { e.preventDefault(); const d = (k === 'ArrowRight' ? 1 : -1) * opts.grid, n = selNote; apply('Move note', () => { n.t = Math.max(0, Math.min(bars() - 0.05, n.t + d)); }); selNote = n; }
      draw();
    });
    draw(); wrap.scrollTop = c.notes.length ? Math.max(0, yOf(Math.max(...c.notes.map((n) => n.p))) - 60) : yOf(72);
    timer = setInterval(draw, 100);
    cv._draw = draw;
  }

  /* ---------- drum step grid ---------- */
  const PRESETS = {
    'Four on the floor': { Kick: [0, 4, 8, 12], Snare: [4, 12], Hat: [2, 6, 10, 14] },
    'Boom bap': { Kick: [0, 7, 10], Snare: [4, 12], Hat: [0, 2, 4, 6, 8, 10, 12, 14] },
    'Trap': { Kick: [0, 7, 11], Clap: [8], Hat: [0, 2, 4, 6, 8, 10, 12, 14, 15], 'Open hat': [14] },
    'Empty': {}
  };
  /* a bar holds beats x 4 sixteenths, so 3/4 has 12 and 7/8 has 14. Offer one, two and four bars of that, plus whatever the clip already uses. */
  function stepChoices(api, c) { const bar = Math.max(4, Math.round(api.barBeats() * 4)); return [...new Set([bar, bar * 2, bar * 4, c.steps || 16])].filter((n) => n <= 96).sort((a, b) => a - b); }
  function buildSteps(panel, t, c) {
    const api = S(), names = GVSynth.DRUMS; c.steps = c.steps || 16; c.grid = c.grid || {};
    const row = el('div', 'row'); row.style.alignItems = 'flex-end'; row.style.marginTop = '8px'; panel.appendChild(row);
    const sw = el('input'); sw.type = 'range'; sw.min = 0; sw.max = 60; sw.value = Math.round((c.swing || 0) * 100); sw.setAttribute('aria-label', 'Swing'); sw.oninput = () => { c.swing = sw.value / 100; api.redraw(); }; sw.onchange = () => api.markDirty();
    sw.onpointerdown = () => { sw._b = api.snapshotJSON(); }; sw.onpointerup = () => { if (sw._b && sw._b !== api.snapshotJSON()) api.pushUndo(sw._b); };
    row.append(
      labelled('Steps (16ths)', sel(stepChoices(api, c), c.steps, (v) => apply('Pattern length', () => { c.steps = +v; }))),
      labelled('Swing', sw),
      labelled('Preset', sel(['Choose…'].concat(Object.keys(PRESETS)), 'Choose…', (v) => { if (!PRESETS[v]) return; apply('Preset ' + v, () => { c.grid = {}; Object.entries(PRESETS[v]).forEach(([nm, idx]) => { c.grid[nm] = Array(c.steps).fill(0); for (let r = 0; r < c.steps; r += 16) idx.forEach((i) => { if (r + i < c.steps) c.grid[nm][r + i] = 1; }); }); }); })),
      labelled('Clip length in bars', Object.assign(el('input'), { type: 'number', min: 1, max: 64, step: 1, value: Math.round(c.dur / api.spb() / api.barBeats() * 100) / 100, onchange(e) { const v = Math.max(1, Math.min(64, +e.target.value || 1)); apply('Clip length', () => { c.dur = v * api.barBeats() * api.spb(); }); } }))
    );
    const info = el('p', 'status', { textContent: 'Press a square to turn a step on or off. The pattern repeats for as long as the clip is.' }); panel.appendChild(info);
    const grid = el('div', 'stepgrid'); grid.style.gridTemplateColumns = '86px repeat(' + c.steps + ', 28px)'; panel.appendChild(grid);
    names.forEach((nm) => {
      grid.appendChild(el('div', 'lab', { textContent: nm }));
      const arr = c.grid[nm] || (c.grid[nm] = Array(c.steps).fill(0));
      for (let i = 0; i < c.steps; i++) {
        const b = el('button', 'stepb' + (i % 4 === 0 ? ' beat' : '')); b.setAttribute('aria-pressed', !!arr[i]); b.setAttribute('aria-label', nm + ' step ' + (i + 1)); b.dataset.n = nm; b.dataset.i = i;
        b.onclick = () => { apply('Step', () => { arr[i] = arr[i] ? 0 : 1; }); if (arr[i]) { api.ensureCtx(); const ctx = api.bus().context; ctx.resume(); GVSynth.drum(ctx, api.bus(), nm, ctx.currentTime + 0.01, 0.9); } const nb = pane().querySelector(`[data-n="${nm}"][data-i="${i}"]`); if (nb) nb.focus(); };
        grid.appendChild(b);
      }
    });
    timer = setInterval(() => { const x = find(); if (!x) return; const sd = api.spb() / 4, ph = api.playhead - c.start; grid.querySelectorAll('.now').forEach((b) => b.classList.remove('now')); if (api.P && ph >= 0 && ph < c.dur) { const idx = Math.floor(ph / sd) % c.steps; grid.querySelectorAll('[data-i="' + idx + '"]').forEach((b) => b.classList.add('now')); } }, 80);
  }
  window.addEventListener('pointerup', () => { if (!fromRoll) return; fromRoll = false; setTimeout(() => { const c = pane() && pane().querySelector('#rollcv'); if (c && cur) c.focus(); }, 0); }, true);
  return { open, close, refresh };
})();
