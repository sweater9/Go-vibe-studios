/* GoVibe Mix: advanced note editing for the Studio piano roll. Adds multiple selection (shift click, drag a box, select all), moving and
   resizing several notes together, copy, paste and duplicate, quantize with strength, humanize, legato, snap to scale and a velocity lane. */
window.GVRollPlus = (() => {
  let clip = [];                       // copied notes, relative to the first one
  const el = (tag, cls, props) => Object.assign(Object.assign(document.createElement(tag), { className: cls || '' }), props || {});
  function attach(X) {
    const { panel, row2, wrap, cv, c, api, draw, apply, opts, bx, bOf, yOf, pOf, hitNote, setPrimary, getPrimary, inScale, bars, KEYW, LOW, HIGH, ROWH } = X;
    const sel = new Set(); let multi = null, box = null, vdrag = null, tip = '';
    const say = (t) => { tip = t; const s = panel.querySelector('.rollplus-note'); if (s) s.textContent = t; };
    const chosen = () => (sel.size ? [...sel] : c.notes);
    const g = () => opts.grid, clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const row3 = el('div', 'row'); row3.style.marginTop = '8px'; row3.style.alignItems = 'flex-end'; row2.after(row3);
    const btn = (txt, fn, aria) => { const b = el('button', 'btn mini', { textContent: txt }); if (aria) b.setAttribute('aria-label', aria); b.onclick = fn; row3.appendChild(b); return b; };
    const slider = (label, min, max, val, unit) => { const i = el('input'); i.type = 'range'; i.min = min; i.max = max; i.value = val; i.setAttribute('aria-label', label); const o = el('output', '', { textContent: val + unit }); i.addEventListener('input', () => { o.textContent = i.value + unit; }); const l = el('label', 'ctl'); l.append(document.createTextNode(label + ' '), o, i); row3.appendChild(l); return i; };
    const strength = slider('Quantize strength', 0, 100, 100, '%'), loose = slider('Humanize timing', 0, 60, 20, ' ms'), spread = slider('Humanize velocity', 0, 40, 12, '');
    btn('Select all', () => { c.notes.forEach((n) => sel.add(n)); setPrimary(c.notes[c.notes.length - 1] || null); say(sel.size + ' notes selected.'); draw(); });
    btn('Select none', () => { sel.clear(); setPrimary(null); say('Selection cleared.'); draw(); });
    btn('Quantize selection', () => { const k = strength.value / 100; apply('Quantize', () => chosen().forEach((n) => { const q = Math.round(n.t / g()) * g(); n.t = Math.max(0, n.t + (q - n.t) * k); const qd = Math.max(g(), Math.round(n.d / g()) * g()); n.d = Math.max(0.05, n.d + (qd - n.d) * k); })); say('Quantized to the grid at ' + strength.value + '%.'); draw(); });
    btn('Humanize', () => { const h = loose.value / 1000 / api.spb(), v = +spread.value; apply('Humanize', () => chosen().forEach((n) => { n.t = clamp(n.t + (Math.random() * 2 - 1) * h, 0, bars() - 0.05); n.v = Math.round(clamp((n.v || 100) + (Math.random() * 2 - 1) * v, 1, 127)); })); say('Loosened the timing and velocity a little.'); draw(); });
    btn('Legato', () => { apply('Legato', () => { const all = [...c.notes].sort((a, b) => a.t - b.t); chosen().forEach((n) => { const nx = all.find((m) => m.t > n.t + 1e-6 && m.p !== undefined); if (nx) n.d = Math.max(0.05, nx.t - n.t); }); }); say('Each note now lasts until the next one starts.'); draw(); });
    btn('Snap to scale', () => { if (opts.scale === 'Chromatic') return say('Choose a scale first. Chromatic has every note.'); let moved = 0; apply('Snap to scale', () => chosen().forEach((n) => { if (inScale(n.p)) return; for (let d = 1; d < 7; d++) { if (inScale(n.p - d)) { n.p -= d; moved++; return; } if (inScale(n.p + d)) { n.p += d; moved++; return; } } })); say(moved + ' note' + (moved === 1 ? '' : 's') + ' moved into the scale.'); draw(); });
    const copyNotes = () => { const s = chosen(); if (!s.length) return; const t0 = Math.min(...s.map((n) => n.t)); clip = s.map((n) => ({ dt: n.t - t0, d: n.d, p: n.p, v: n.v })); say('Copied ' + clip.length + ' note' + (clip.length === 1 ? '' : 's') + '.'); };
    const pasteAt = (at) => { if (!clip.length) return say('Nothing copied yet.'); const made = []; apply('Paste', () => clip.forEach((k) => { const t = at + k.dt; if (t < bars() - 0.01) { const n = { t, d: Math.min(k.d, bars() - t), p: k.p, v: k.v }; c.notes.push(n); made.push(n); } })); sel.clear(); made.forEach((n) => sel.add(n)); setPrimary(made[0] || null); say(made.length ? 'Pasted ' + made.length + ' note' + (made.length === 1 ? '' : 's') + '.' : 'There is no room left in the clip. Make it longer first.'); draw(); };
    const endOfSel = () => { const s = chosen(); return s.length ? Math.ceil((Math.max(...s.map((n) => n.t + n.d)) - 1e-6) / g()) * g() : 0; };
    btn('Copy', copyNotes); btn('Paste', () => pasteAt(sel.size || c.notes.length ? endOfSel() : 0), 'Paste after the selection');
    btn('Duplicate', () => { copyNotes(); pasteAt(endOfSel()); });
    const info = el('p', 'status rollplus-note', { textContent: 'Shift click selects several notes, and shift drag draws a selection box. Control or Command with A, C, V and D select all, copy, paste and duplicate.' }); info.setAttribute('role', 'status'); row3.after(info);
    /* velocity lane */
    const vw = el('div', 'velscroll'); vw.style.overflowY = 'hidden'; vw.style.maxHeight = '110px'; const vc = el('canvas'); vc.height = 96; vc.setAttribute('role', 'img'); vc.setAttribute('aria-label', 'Velocity lane. Drag a bar up or down to change how hard that note is played.'); vw.appendChild(vc); wrap.after(vw);
    const lab = el('p', 'status', { textContent: 'Velocity lane: drag a bar up or down. Selected notes change together.' }); vw.before(lab);
    let syncing = false; wrap.addEventListener('scroll', () => { if (syncing) return; syncing = true; vw.scrollLeft = wrap.scrollLeft; syncing = false; }); vw.addEventListener('scroll', () => { if (syncing) return; syncing = true; wrap.scrollLeft = vw.scrollLeft; syncing = false; });
    const lane = () => { if (vc.width !== cv.width) vc.width = cv.width; const v = vc.getContext('2d'), W = vc.width, H = vc.height; v.clearRect(0, 0, W, H); v.fillStyle = '#12131c'; v.fillRect(0, 0, W, H); v.fillStyle = '#ffffff12'; for (let k = 1; k < 4; k++) v.fillRect(KEYW, H * k / 4, W - KEYW, 1);
      v.fillStyle = '#9a9ab8'; v.font = '11px sans-serif'; v.fillText('Velocity', 6, 14);
      c.notes.forEach((n) => { const h = (n.v || 100) / 127 * (H - 8), x = bx(n.t); v.fillStyle = sel.has(n) || n === getPrimary() ? '#fbbf24' : '#a78bfa'; v.fillRect(x, H - h, 6, h); }); };
    const vpos = (e) => { const r = vc.getBoundingClientRect(); return { x: (e.clientX - r.left) * (vc.width / r.width), y: (e.clientY - r.top) * (vc.height / r.height) }; };
    vc.addEventListener('pointerdown', (e) => { const { x, y } = vpos(e); const hit = [...c.notes].reverse().find((n) => x >= bx(n.t) - 3 && x <= bx(n.t) + 9); if (!hit) return; vc.setPointerCapture(e.pointerId); if (!sel.has(hit)) { sel.clear(); sel.add(hit); } setPrimary(hit); vdrag = { before: api.snapshotJSON(), moved: false }; setV(y); });
    const setV = (y) => { const v = Math.round(clamp((1 - (y - 4) / (vc.height - 8)) * 127, 1, 127)); chosen().forEach((n) => { n.v = v; }); draw(); };
    vc.addEventListener('pointermove', (e) => { if (!vdrag) return; vdrag.moved = true; setV(vpos(e).y); });
    const vup = () => { if (!vdrag) return; const d = vdrag; vdrag = null; if (d.moved || api.snapshotJSON() !== d.before) api.changed('Velocity', d.before); api.redraw(); };
    vc.addEventListener('pointerup', vup); vc.addEventListener('pointercancel', vup);
    /* selection with the pointer: capture runs before the roll's own handler */
    const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * (cv.width / r.width), y: (e.clientY - r.top) * (cv.height / r.height) }; };
    cv.addEventListener('pointerdown', (e) => {
      const { x, y } = pos(e); if (x < KEYW) return; const h = hitNote(x, y);
      if (e.shiftKey) { e.stopImmediatePropagation(); cv.focus(); cv.setPointerCapture(e.pointerId); if (h) { if (sel.has(h.n)) sel.delete(h.n); else sel.add(h.n); setPrimary(h.n); say(sel.size + ' selected.'); draw(); } else box = { x0: x, y0: y, x1: x, y1: y }; return; }
      if (h && sel.has(h.n) && sel.size > 1) { multi = { p: h.n, t: h.n.t, pitch: h.n.p, d: h.n.d, edge: h.edge, from: new Map([...sel].map((n) => [n, { t: n.t, p: n.p, d: n.d }])) }; } else { multi = null; sel.clear(); }
    }, true);
    cv.addEventListener('pointermove', (e) => {
      if (box) { const { x, y } = pos(e); box.x1 = x; box.y1 = y; draw(); return; }
      if (!multi) return; const n = multi.p, dt = n.t - multi.t, dp = n.p - multi.pitch, dd = n.d - multi.d;
      multi.from.forEach((o, m) => { if (m === n) return; if (multi.edge) m.d = Math.max(g(), o.d + dd); else { m.t = Math.max(0, Math.min(bars() - 0.05, o.t + dt)); m.p = clamp(o.p + dp, LOW, HIGH); } });
    });
    cv.addEventListener('pointerup', () => {
      if (box) { const a = Math.min(box.x0, box.x1), b = Math.max(box.x0, box.x1), y0 = Math.min(box.y0, box.y1), y1 = Math.max(box.y0, box.y1); box = null; c.notes.forEach((n) => { const nx = bx(n.t), nw = Math.max(4, n.d * X.PXB), ny = yOf(n.p); if (nx + nw >= a && nx <= b && ny + ROWH >= y0 && ny <= y1) sel.add(n); }); const l = [...sel]; setPrimary(l[l.length - 1] || null); say(sel.size + ' note' + (sel.size === 1 ? '' : 's') + ' selected.'); draw(); return; }
      if (multi) { multi = null; return; }
      const p = getPrimary(); if (p) { sel.clear(); sel.add(p); }
    });
    cv.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
      if (mod && k === 'a') { e.preventDefault(); c.notes.forEach((n) => sel.add(n)); setPrimary(c.notes[c.notes.length - 1] || null); say(sel.size + ' notes selected.'); draw(); }
      else if (mod && k === 'c') { e.preventDefault(); copyNotes(); } else if (mod && k === 'v') { e.preventDefault(); pasteAt(endOfSel()); } else if (mod && k === 'd') { e.preventDefault(); copyNotes(); pasteAt(endOfSel()); }
      else if (k === 'escape') { sel.clear(); setPrimary(null); draw(); }
      else if ((k === 'delete' || k === 'backspace') && sel.size > 1) { e.preventDefault(); e.stopImmediatePropagation(); apply('Delete notes', () => { c.notes = c.notes.filter((n) => !sel.has(n)); }); sel.clear(); setPrimary(null); draw(); }
    }, true);
    return {
      sel, lane, tip: () => tip,
      overlay(ctx) {
        ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 2; sel.forEach((n) => { if (n.p < LOW || n.p > HIGH) return; ctx.strokeRect(bx(n.t) - 1, yOf(n.p) - 1, Math.max(4, n.d * X.PXB - 1) + 2, ROWH + 1); });
        if (box) { ctx.fillStyle = '#22d3ee22'; ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 1; const x = Math.min(box.x0, box.x1), y = Math.min(box.y0, box.y1), w = Math.abs(box.x1 - box.x0), h = Math.abs(box.y1 - box.y0); ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h); }
        lane();
      }
    };
  }
  return { attach };
})();
