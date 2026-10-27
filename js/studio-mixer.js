/* GoVibe Mix — Studio mixer: one channel strip per track, a reverb and a delay return, and a master strip.
 * Each strip has an effects chain (EQ, compressor, saturation, chorus, delay, reverb), send levels, pan, fader and meter.
 * The audio itself is built in studio-core.js and fx.js; this file is only the controls. */
(() => {
  const $ = (id) => document.getElementById(id), S = () => window.GVStudio, Core = () => window.GVStudioCore, Fx = window.GVFx;
  const gvtest = /[?&]gvtest\b/.test(location.search);
  let selFx = null; /* { track: id | 'master' | 'bus', fx: fx id | 'rev' | 'dly' } */
  let meters = [];
  const mk = (tag, cls, props) => Object.assign(document.createElement(tag), Object.assign({ className: cls || '' }, props || {}));
  const trackOf = (id) => S().trackOf(id);
  const listFor = (owner) => owner === 'master' ? S().P.mfx : (trackOf(owner) || {}).fx;
  const ownerName = (owner) => owner === 'master' ? 'Master' : owner === 'bus' ? 'Returns' : (trackOf(owner) || {}).name || 'track';
  const nameOf = (type) => Fx.DEFS[type].name;

  /* a slider that changes the sound while you drag and records one undo step for the whole drag, with a mouse or the keyboard */
  function bind(inp, apply, after) {
    inp.addEventListener('input', () => { if (!inp._b) inp._b = S().snapshotJSON(); apply(+inp.value); if (after) after(); S().applyAllMix(); });
    inp.addEventListener('change', () => { if (inp._b && inp._b !== S().snapshotJSON()) S().pushUndo(inp._b); inp._b = null; S().markDirty(); });
  }
  const fmt = (q, v) => q.unit === '' ? Math.round(v * 100) + '%' : (q.step < 1 ? (Math.round(v * 10) / 10) : Math.round(v)) + ' ' + q.unit;

  /* ---------- channel strips ---------- */
  function slotRow(owner, f) {
    const row = mk('div', 'fxs' + (selFx && selFx.fx === f.id ? ' sel' : '') + (f.on === false ? ' off' : ''));
    const on = mk('input', '', { type: 'checkbox', checked: f.on !== false }); on.setAttribute('aria-label', nameOf(f.type) + ' on ' + ownerName(owner) + ' is on');
    on.onchange = () => { const b = S().snapshotJSON(); f.on = on.checked; row.classList.toggle('off', !f.on); S().applyAllMix(); S().pushUndo(b); S().markDirty(); };
    const b = mk('button', 'btn mini fxname', { textContent: nameOf(f.type), type: 'button' }); b.setAttribute('aria-label', 'Edit ' + nameOf(f.type) + ' on ' + ownerName(owner)); if (selFx && selFx.fx === f.id) b.setAttribute('aria-current', 'true');
    b.onclick = () => { selFx = { track: owner, fx: f.id }; refresh(); };
    row.append(on, b); return row;
  }
  function addSelect(owner) {
    const s = mk('select', 'fxadd'); s.setAttribute('aria-label', 'Add an effect to ' + ownerName(owner));
    const o0 = mk('option', '', { textContent: '+ Effect', value: '' }); s.appendChild(o0);
    Fx.TYPES.forEach((t) => s.appendChild(mk('option', '', { textContent: nameOf(t), value: t })));
    s.onchange = () => { const type = s.value; if (!type) return; addFx(owner, type); };
    return s;
  }
  function addFx(owner, type) {
    const list = listFor(owner); if (!list) return null; if (list.length >= 8) { S().say('A channel holds up to eight effects.'); return null; }
    const f = Core().newFx(type); selFx = { track: owner, fx: f.id }; S().edit('Add effect', () => { list.push(f); }); return f;
  }
  function fader(label, min, max, value, step) { const i = mk('input', 'vfader', { type: 'range', min, max, value, step: step || 1 }); i.setAttribute('aria-label', label); return i; }
  function small(label, value, max) { const i = mk('input', '', { type: 'range', min: 0, max: max || 100, value }); i.setAttribute('aria-label', label); const l = mk('label', 'tl'); l.append(document.createTextNode(label.split(' of ')[0].replace(' send', '')), i); return { l, i }; }

  function trackStrip(t) {
    const st = mk('div', 'strip'); st.style.borderTopColor = t.color; st.dataset.id = t.id;
    const head = mk('div', 'sname', { textContent: t.name, title: t.name });
    const slots = mk('div', 'slots'); (t.fx || []).forEach((f) => slots.appendChild(slotRow(t.id, f))); slots.appendChild(addSelect(t.id));
    const sr = small('Reverb send of ' + t.name, Math.round((t.sendR || 0) * 100)), sd = small('Delay send of ' + t.name, Math.round((t.sendD || 0) * 100));
    bind(sr.i, (v) => { t.sendR = v / 100; }); bind(sd.i, (v) => { t.sendD = v / 100; });
    const pan = small('Pan of ' + t.name, Math.round(t.pan * 100)); pan.i.min = -100; pan.i.value = Math.round(t.pan * 100); pan.i.ondblclick = () => { pan.i.value = 0; pan.i.dispatchEvent(new Event('input')); pan.i.dispatchEvent(new Event('change')); };
    bind(pan.i, (v) => { t.pan = v / 100; }, () => syncHead(t));
    const fb = mk('div', 'fbox'); const meter = mk('div', 'vmeter'); meter.appendChild(mk('i')); const fd = fader('Volume of ' + t.name, 0, 150, Math.round(t.vol * 100)); bind(fd, (v) => { t.vol = v / 100; }, () => syncHead(t)); fb.append(meter, fd);
    const ms = mk('div', 'trow'); const m = mk('button', 'btn mini tbtn2', { textContent: 'M', title: 'Mute', type: 'button' }), s = mk('button', 'btn mini tbtn2', { textContent: 'S', title: 'Solo', type: 'button' });
    m.setAttribute('aria-label', 'Mute ' + t.name); m.setAttribute('aria-pressed', !!t.mute); s.setAttribute('aria-label', 'Solo ' + t.name); s.setAttribute('aria-pressed', !!t.solo);
    m.onclick = () => { const b = S().snapshotJSON(); t.mute = !t.mute; S().applyAllMix(); S().changed('Mute', b); S().buildHeads(); refresh(); };
    s.onclick = () => { const b = S().snapshotJSON(); t.solo = !t.solo; S().applyAllMix(); S().changed('Solo', b); S().buildHeads(); refresh(); };
    ms.append(m, s);
    st.append(head, slots, sr.l, sd.l, pan.l, fb, ms); meters.push({ el: meter.firstChild, id: t.id }); return st;
  }
  function syncHead(t) { const row = document.querySelector('.thead[data-id="' + t.id + '"]'); if (!row) return; const v = row.querySelector('.tvol'), p = row.querySelector('.tpan'); if (v) v.value = Math.round(t.vol * 100); if (p) p.value = Math.round(t.pan * 100); }
  function busStrip(key) {
    const type = Fx.BUS[key].type, st = mk('div', 'strip bus'); st.style.borderTopColor = '#a78bfa';
    st.appendChild(mk('div', 'sname', { textContent: Fx.BUS[key].name }));
    st.appendChild(mk('p', 'status sdesc', { textContent: key === 'rev' ? 'One shared reverb. Turn up Reverb on any channel to send sound to it.' : 'One shared delay, in time with the tempo. Turn up Delay on any channel.' }));
    const b = mk('button', 'btn mini', { textContent: 'Edit ' + nameOf(type).toLowerCase(), type: 'button' }); b.setAttribute('aria-label', 'Edit ' + nameOf(type).toLowerCase() + ' return'); if (selFx && selFx.fx === key) b.setAttribute('aria-current', 'true');
    b.onclick = () => { selFx = { track: 'bus', fx: key }; refresh(); }; st.appendChild(b); return st;
  }
  function masterStrip() {
    const P = S().P, st = mk('div', 'strip master'); st.style.borderTopColor = '#fbbf24';
    st.appendChild(mk('div', 'sname', { textContent: 'Master' }));
    const slots = mk('div', 'slots'); P.mfx.forEach((f) => slots.appendChild(slotRow('master', f))); slots.appendChild(addSelect('master')); st.appendChild(slots);
    const fb = mk('div', 'fbox'); const meter = mk('div', 'vmeter'); meter.appendChild(mk('i')); const fd = fader('Master volume', 0, 120, Math.round(P.master * 100)); fd.id = 'mfader';
    bind(fd, (v) => { P.master = v / 100; $('master').value = v; }); fb.append(meter, fd); st.appendChild(fb); meters.push({ el: meter.firstChild, id: 'master' }); return st;
  }
  function syncMaster() { const f = $('mfader'); if (f) f.value = $('master').value; }

  /* ---------- the editor under the strips ---------- */
  function resolve() {
    if (!selFx) return null; const P = S().P;
    if (selFx.track === 'bus') { const k = selFx.fx; if (!Fx.BUS[k]) return null; return { title: Fx.BUS[k].name, type: Fx.BUS[k].type, data: P.sends[k], bus: k }; }
    const list = listFor(selFx.track); if (!list) return null; const i = list.findIndex((f) => f.id === selFx.fx); if (i < 0) return null;
    return { title: nameOf(list[i].type) + ' on ' + ownerName(selFx.track), type: list[i].type, data: list[i].p, f: list[i], list, i };
  }
  function renderEditor() {
    const box = $('fxedit'); box.innerHTML = ''; const r = resolve();
    if (!r) { selFx = null; box.appendChild(mk('p', 'status', { textContent: 'Choose an effect on a channel, or add one with + Effect, to change its settings here.' })); return; }
    const h = mk('h3', '', { textContent: r.title }); box.appendChild(h);
    const grid = mk('div', 'fxgrid');
    Fx.DEFS[r.type].params.forEach((q) => {
      const v = Fx.full(r.type, r.data)[q.key], l = mk('label', 'fxp'); l.appendChild(mk('span', '', { textContent: q.label }));
      if (q.select) {
        const s = mk('select'); q.options.forEach((o) => { const op = mk('option', '', { textContent: o[1], value: String(o[0]) }); if (o[0] === v) op.selected = true; s.appendChild(op); });
        s.onchange = () => { const b = S().snapshotJSON(); r.data[q.key] = +s.value; S().applyAllMix(); S().pushUndo(b); S().markDirty(); renderEditor(); };
        l.appendChild(s);
      } else {
        const i = mk('input', '', { type: 'range', min: q.min, max: q.max, step: q.step, value: v }), o = mk('output', '', { textContent: fmt(q, v) });
        bind(i, (x) => { r.data[q.key] = x; o.textContent = fmt(q, x); }); l.append(i, o);
      }
      grid.appendChild(l);
    });
    box.appendChild(grid);
    const tools = mk('div', 'row');
    const btn = (txt, label, fn, dis) => { const b = mk('button', 'btn mini', { textContent: txt, type: 'button', disabled: !!dis, title: label }); b.onclick = fn; tools.appendChild(b); };
    btn('Reset settings', 'Put every setting of this effect back to its starting value', () => { S().edit('Reset effect', () => { const d = r.bus ? Fx.BUS[r.bus].p : Fx.defaults(r.type); Object.keys(d).forEach((k) => { r.data[k] = d[k]; }); }); });
    if (r.f) {
      btn('Move earlier', 'Move this effect earlier in the chain', () => { S().edit('Move effect', () => { r.list.splice(r.i - 1, 0, r.list.splice(r.i, 1)[0]); }); }, r.i === 0);
      btn('Move later', 'Move this effect later in the chain', () => { S().edit('Move effect', () => { r.list.splice(r.i + 1, 0, r.list.splice(r.i, 1)[0]); }); }, r.i === r.list.length - 1);
      btn('Remove effect', 'Remove this effect from the chain', () => { S().edit('Remove effect', () => { r.list.splice(r.i, 1); }); });
    }
    box.appendChild(tools);
  }

  /* ---------- build ---------- */
  function refresh() {
    const box = $('strips'); if (!box || !window.GVStudio) return; meters = [];
    const keep = box.scrollLeft; box.innerHTML = ''; const P = S().P;
    if (!P.tracks.length) box.appendChild(mk('p', 'status', { textContent: 'Add a track and it appears here as a channel strip.' }));
    P.tracks.forEach((t) => box.appendChild(trackStrip(t)));
    box.appendChild(busStrip('rev')); box.appendChild(busStrip('dly')); box.appendChild(masterStrip()); box.scrollLeft = keep; renderEditor();
  }
  /* called every frame while the project plays */
  function tick(graph, peak, hold) {
    meters.forEach((m) => {
      let v = 0;
      if (graph) { if (m.id === 'master') v = Math.max(hold[0], hold[1]); else { const n = graph.tracks[m.id]; if (n && n.an) v = peak(n.an); } }
      const db = v > 1e-5 ? 20 * Math.log10(v) : -90; m.el.style.height = graph ? Math.max(0, Math.min(100, (db + 60) / 60 * 100)) + '%' : '0';
    });
  }
  const tg = $('mixtoggle');
  if (tg) tg.onclick = () => { const open = tg.getAttribute('aria-expanded') === 'true'; tg.setAttribute('aria-expanded', !open); tg.textContent = open ? 'Show' : 'Hide'; $('mixbody').hidden = open; };

  window.GVMixer = { refresh, tick, syncMaster, syncTrack: (t) => { const st = document.querySelector('.strip[data-id="' + t.id + '"]'); if (!st) return; const r = st.querySelectorAll('input[type=range]'); r.forEach((i) => { const lb = i.getAttribute('aria-label') || ''; if (lb.indexOf('Volume') === 0) i.value = Math.round(t.vol * 100); else if (lb.indexOf('Pan') === 0) i.value = Math.round(t.pan * 100); }); st.querySelectorAll('button.tbtn2').forEach((b) => { b.setAttribute('aria-pressed', b.textContent === 'M' ? !!t.mute : !!t.solo); }); } };
  if (gvtest) window.__mx = { addFx, get sel() { return selFx; }, select(owner, fx) { selFx = { track: owner, fx }; refresh(); }, refresh };
  refresh();
})();
