/* GoVibe Mix — chord and fretboard tools page: chord finder, chord shapes, fretboard map, circle of fifths and chord chart transposer. Sound comes from the built in synth. Nothing leaves the device. */
(() => {
  const $ = (id) => document.getElementById(id), C = window.GVChords, NS = 'http://www.w3.org/2000/svg';
  let ctx = null;
  const ac = () => { ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); ctx.resume(); return ctx; };
  function play(midis, gap = 0, dur = 1.4, inst = 'Piano') { const c = ac(), out = c.createGain(); out.gain.value = 0.9; out.connect(c.destination); midis.forEach((m, i) => GVSynth.note(c, out, inst, m, 0.8, c.currentTime + 0.02 + i * gap, dur)); }
  const el = (tag, attrs = {}, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
  const opt = (sel, value, text) => { const o = document.createElement('option'); o.value = value; o.textContent = text; sel.appendChild(o); };
  const ROOTS = ['C', 'C♯ / D♭', 'D', 'D♯ / E♭', 'E', 'F', 'F♯ / G♭', 'G', 'G♯ / A♭', 'A', 'A♯ / B♭', 'B'];
  const FLATKEYS = new Set([1, 3, 5, 8, 10]); // roots usually written with flats

  /* ---------- tabs ---------- */
  document.querySelectorAll('.ttab').forEach((t) => t.addEventListener('click', () => { if (t.id === 'tab-lib') shapes(); if (t.id === 'tab-fret') fret(); if (t.id === 'tab-circle') circleInit(); }));

  /* ---------- chord finder ---------- */
  const picked = new Set(); let flatsF = false;
  function buildFinder() {
    const box = $('fpcs'); box.innerHTML = '';
    for (let pc = 0; pc < 12; pc++) { const b = document.createElement('button'); b.type = 'button'; b.className = [1, 3, 6, 8, 10].includes(pc) ? 'blk' : ''; b.textContent = C.noteName(pc, flatsF); b.setAttribute('aria-pressed', picked.has(pc)); b.onclick = () => { if (picked.has(pc)) picked.delete(pc); else { picked.add(pc); play([60 + pc], 0, 0.9); } finder(); }; box.appendChild(b); }
    const bs = $('fbass'), cur = bs.value; bs.innerHTML = ''; opt(bs, '', 'Any'); for (let pc = 0; pc < 12; pc++) opt(bs, pc, C.noteName(pc, flatsF)); bs.value = cur;
  }
  function finder() {
    [...$('fpcs').children].forEach((b, pc) => b.setAttribute('aria-pressed', picked.has(pc)));
    const res = $('fres'), pcs = [...picked].sort((a, b) => a - b), bass = $('fbass').value === '' ? null : +$('fbass').value; res.innerHTML = '';
    const p = (cls, txt) => { const e = document.createElement('p'); if (cls) e.className = cls; e.textContent = txt; res.appendChild(e); return e; };
    if (pcs.length < 2) return p('status', pcs.length ? 'Press at least one more note.' : 'No notes chosen yet.');
    if (bass != null && !picked.has(bass)) return p('status', 'The lowest note must be one of the notes you pressed.');
    const r = C.identify(pcs, bass, flatsF);
    if (r.exact.length) {
      const top = r.exact[0], h = document.createElement('div'); const big = document.createElement('span'); big.className = 'big'; big.textContent = top.name; h.appendChild(big);
      const d = document.createElement('span'); d.textContent = top.long + (top.isBass ? '' : ' (inversion)'); h.appendChild(d); res.appendChild(h);
      p('status', 'Notes: ' + pcs.map((x) => C.noteName(x, flatsF) + ' (' + C.INTERVAL_NAMES[(x - top.root + 12) % 12] + ')').join(', '));
      if (r.exact.length > 1) { p('status', 'The same notes can also be named:'); const w = document.createElement('div'); r.exact.slice(1).forEach((c) => { const s = document.createElement('span'); s.className = 'alt'; s.textContent = c.name + ' (' + c.long + ')'; w.appendChild(s); }); res.appendChild(w); }
    } else if (pcs.length === 2) {
      const iv = (pcs[1] - pcs[0] + 12) % 12, a = C.INTERVAL_NAMES[iv], b = C.INTERVAL_NAMES[12 - iv === 12 ? 0 : 12 - iv];
      p('', 'Two notes make an interval, not a chord: ' + C.noteName(pcs[0], flatsF) + ' to ' + C.noteName(pcs[1], flatsF) + ' is a ' + a + ' going up, or a ' + b + ' going down.');
      if (r.partial.length) { p('status', 'Chords that contain both notes:'); const w = document.createElement('div'); r.partial.forEach((c) => { const s = document.createElement('span'); s.className = 'alt'; s.textContent = c.name; w.appendChild(s); }); res.appendChild(w); }
    } else {
      p('', 'No exact chord name for these notes.');
      if (r.partial.length) { p('status', 'Closest chords, with the notes they would add:'); const w = document.createElement('div'); r.partial.forEach((c) => { const s = document.createElement('span'); s.className = 'alt'; s.textContent = c.name + ' (add ' + c.missing.join(', ') + ')'; w.appendChild(s); }); res.appendChild(w); }
    }
  }
  $('fspell').onchange = () => { flatsF = $('fspell').value === 'f'; buildFinder(); finder(); };
  $('fbass').onchange = finder; $('fclear').onclick = () => { picked.clear(); $('fbass').value = ''; finder(); };
  $('fplay').onclick = () => { const pcs = [...picked].sort((a, b) => a - b); if (!pcs.length) return; const b = $('fbass').value === '' ? pcs[0] : +$('fbass').value, order = pcs.slice().sort((x, y) => ((x - b + 12) % 12) - ((y - b + 12) % 12)); let m = 48 + b; const out = []; order.forEach((pc, i) => { if (i === 0) out.push(m); else { let n = out[out.length - 1]; do n++; while (n % 12 !== pc); out.push(n); } }); play(out, 0.0, 1.8); };

  /* ---------- chord shapes ---------- */
  function buildShapes() {
    ROOTS.forEach((n, i) => opt($('lroot'), i, n)); C.TYPES.forEach((t) => opt($('ltype'), t[0], t[0] ? t[0] + ' · ' + t[2] : 'major')); $('ltype').value = ''; $('ltype').selectedIndex = 0;
    Object.keys(C.TUNINGS).forEach((k) => opt($('linst'), k, k)); $('linst').value = Object.keys(C.TUNINGS)[0];
    ['lroot', 'ltype', 'linst'].forEach((id) => { $(id).onchange = shapes; });
  }
  function pianoSvg(root, suffix) {
    const host = $('lpiano'); host.innerHTML = ''; const W = 20, svg = el('svg', { viewBox: '0 0 ' + (21 * W) + ' 74', role: 'img' }); const t = C.TYPE[suffix], set = new Set(), rootSet = 48 + root;
    t[1].forEach((i) => set.add(rootSet + i)); svg.setAttribute('aria-label', 'Piano keys for the chord');
    const WH = [0, 2, 4, 5, 7, 9, 11]; let x = 0; const pos = {};
    for (let m = 48; m < 84; m++) if (WH.includes(m % 12)) { pos[m] = x; el('rect', { x: x + 0.5, y: 0.5, width: W - 1, height: 72, rx: 2, fill: set.has(m) ? (m === rootSet ? '#8b5cf6' : '#22d3ee') : '#f1f1f6', stroke: '#222' }, svg); x += W; }
    for (let m = 48; m < 84; m++) if (!WH.includes(m % 12)) el('rect', { x: pos[m - 1] + W - 6, y: 0.5, width: 12, height: 44, rx: 2, fill: set.has(m) ? (m === rootSet ? '#8b5cf6' : '#22d3ee') : '#15151f', stroke: '#000' }, svg);
    host.appendChild(svg);
  }
  function shapeSvg(tuning, v, root) {
    const n = tuning.length, svg = el('svg', { viewBox: '0 0 100 124', role: 'img' }), left = 16, right = 90, sp = (right - left) / (n - 1), top = 32, fh = 17;
    const fretted = v.frets.filter((f) => f > 0), hi = fretted.length ? Math.max(...fretted) : 0, base = hi <= 5 ? 1 : v.lo;
    for (let i = 0; i < n; i++) el('line', { x1: left + i * sp, y1: top, x2: left + i * sp, y2: top + fh * 5, stroke: '#9a98c4', 'stroke-width': 1.2 }, svg);
    for (let r = 0; r <= 5; r++) el('line', { x1: left, y1: top + r * fh, x2: right, y2: top + r * fh, stroke: r === 0 && base === 1 ? '#ecebff' : '#5a5890', 'stroke-width': r === 0 && base === 1 ? 4 : 1 }, svg);
    if (base > 1) { const t = el('text', { x: 1, y: top + fh * 0.7, fill: '#ecebff', 'font-size': 10 }, svg); t.textContent = base + 'fr'; }
    v.frets.forEach((f, i) => {
      const x = left + i * sp;
      if (f < 0) { const t = el('text', { x, y: top - 8, fill: '#9a98c4', 'font-size': 11, 'text-anchor': 'middle' }, svg); t.textContent = '×'; }
      else if (f === 0) el('circle', { cx: x, cy: top - 11, r: 3.6, fill: 'none', stroke: '#ecebff', 'stroke-width': 1.3 }, svg);
      else el('circle', { cx: x, cy: top + (f - base + 0.5) * fh, r: 5.4, fill: (tuning[i] + f) % 12 === root ? '#8b5cf6' : '#22d3ee' }, svg);
    });
    return svg;
  }
  function shapes() {
    const root = +$('lroot').value, suf = $('ltype').value, tuning = C.TUNINGS[$('linst').value], flats = FLATKEYS.has(root), name = C.noteName(root, flats) + suf;
    $('lsum').textContent = name + ' (' + C.TYPE[suf][2] + '): ' + C.chordNotes(root, suf, flats).join('  ');
    pianoSvg(root, suf);
    const box = $('lshapes'); box.innerHTML = ''; const vs = C.voicings(tuning, root, suf, 4);
    if (!vs.length) { const p = document.createElement('p'); p.className = 'status'; p.textContent = 'No easy shape found for this chord on this instrument. Try another tuning or a simpler chord type.'; box.appendChild(p); return; }
    vs.forEach((v, i) => {
      const d = document.createElement('div'), svg = shapeSvg(tuning, v, root); d.className = 'shape'; svg.setAttribute('aria-label', name + ' shape ' + (i + 1) + ': ' + v.frets.map((f) => (f < 0 ? 'x' : f)).join(' '));
      const cap = document.createElement('div'); cap.className = 'status'; cap.textContent = v.frets.map((f) => (f < 0 ? 'x' : f)).join(' ');
      const b = document.createElement('button'); b.className = 'btn mini'; b.textContent = 'Play'; b.setAttribute('aria-label', 'Play ' + name + ' shape ' + (i + 1)); b.onclick = () => play(C.voicingMidi(tuning, v), 0.045, 1.8, 'Electric piano');
      d.append(svg, cap, b); box.appendChild(d);
    });
  }

  /* ---------- fretboard ---------- */
  const DEG = ['1', '♭2', '2', '♭3', '3', '4', '♭5', '5', '♭6', '6', '♭7', '7'];
  function buildFret() {
    ROOTS.forEach((n, i) => opt($('froot'), i, n)); $('froot').value = 9;
    const sc = Object.assign({}, window.GVTheory ? window.GVTheory.SCALES : { Major: [0, 2, 4, 5, 7, 9, 11], 'Natural minor': [0, 2, 3, 5, 7, 8, 10] }); Object.keys(sc).forEach((k) => opt($('fscale'), k, k)); opt($('fscale'), 'Just one note', 'Just one note'); $('fscale').value = 'Minor pentatonic' in sc ? 'Minor pentatonic' : 'Natural minor';
    Object.keys(C.TUNINGS).forEach((k) => opt($('ftune'), k, k)); $('ftune').value = Object.keys(C.TUNINGS)[0];
    ['froot', 'fscale', 'ftune', 'flabel'].forEach((id) => { $(id).onchange = fret; });
  }
  function fret() {
    const root = +$('froot').value, scName = $('fscale').value, tuning = C.TUNINGS[$('ftune').value], flats = FLATKEYS.has(root), degrees = $('flabel').value === 'd';
    const ivs = scName === 'Just one note' ? [0] : window.GVTheory.SCALES[scName], set = new Map(ivs.map((i) => [(root + i) % 12, i]));
    $('fsum').textContent = (scName === 'Just one note' ? C.noteName(root, flats) : C.noteName(root, flats) + ' ' + scName.toLowerCase()) + ': ' + ivs.map((i) => C.noteName(root + i, flats)).join('  ');
    const svg = $('fb'), n = tuning.length, FR = 15, x0 = 56, fw = 52, ys = 30, H = (n - 1) * ys + 60; svg.innerHTML = ''; svg.setAttribute('viewBox', '0 0 ' + (x0 + FR * fw + 20) + ' ' + H);
    el('rect', { x: x0, y: 20, width: FR * fw, height: (n - 1) * ys + 20, fill: '#1b1b38', rx: 4 }, svg);
    for (const f of [3, 5, 7, 9, 15]) el('circle', { cx: x0 + (f - 0.5) * fw, cy: 20 + ((n - 1) * ys + 20) / 2, r: 7, fill: '#2a2a52' }, svg);
    for (const dy of [-1, 1]) el('circle', { cx: x0 + 11.5 * fw, cy: 20 + ((n - 1) * ys + 20) / 2 + dy * ys * 0.9, r: 7, fill: '#2a2a52' }, svg);
    for (let f = 0; f <= FR; f++) el('line', { x1: x0 + f * fw, y1: 20, x2: x0 + f * fw, y2: 20 + (n - 1) * ys + 20, stroke: f === 0 ? '#ecebff' : '#5a5890', 'stroke-width': f === 0 ? 5 : 1.5 }, svg);
    for (let f = 1; f <= FR; f++) { if (![3, 5, 7, 9, 12, 15].includes(f)) continue; const t = el('text', { x: x0 + (f - 0.5) * fw, y: H - 6, fill: '#9a98c4', 'font-size': 12, 'text-anchor': 'middle' }, svg); t.textContent = f; }
    for (let s = 0; s < n; s++) {
      const y = 30 + (n - 1 - s) * ys; el('line', { x1: x0, y1: y, x2: x0 + FR * fw, y2: y, stroke: '#9a98c4', 'stroke-width': 1 + (n - 1 - s === 0 ? 0 : (s < 3 ? 1.6 - s * 0.4 : 0.8)) * 0.8 }, svg);
      for (let f = 0; f <= FR; f++) {
        const m = tuning[s] + f, pc = m % 12; if (!set.has(pc)) continue;
        const cx = f === 0 ? x0 - 20 : x0 + (f - 0.5) * fw, isRoot = pc === root, g = el('g', { tabindex: 0, role: 'button', 'aria-label': C.noteName(pc, flats) + ', string ' + (n - s) + ', fret ' + f, style: 'cursor:pointer' }, svg);
        el('circle', { cx, cy: y, r: 12, fill: isRoot ? '#8b5cf6' : '#22d3ee' }, g);
        const t = el('text', { x: cx, y: y + 4, 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 700, fill: isRoot ? '#fff' : '#04222a' }, g); t.textContent = degrees ? DEG[(pc - root + 12) % 12] : C.noteName(pc, flats);
        const go = () => play([m], 0, 1.2, 'Electric piano'); g.addEventListener('click', go); g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
      }
    }
  }

  /* ---------- circle of fifths ---------- */
  let cSel = { i: 0, minor: false }, circleBuilt = false;
  const polar = (r, deg) => [r * Math.sin(deg * Math.PI / 180), -r * Math.cos(deg * Math.PI / 180)];
  function wedge(r1, r2, a1, a2) { const [x1, y1] = polar(r2, a1), [x2, y2] = polar(r2, a2), [x3, y3] = polar(r1, a2), [x4, y4] = polar(r1, a1); return 'M' + x1 + ' ' + y1 + ' A' + r2 + ' ' + r2 + ' 0 0 1 ' + x2 + ' ' + y2 + ' L' + x3 + ' ' + y3 + ' A' + r1 + ' ' + r1 + ' 0 0 0 ' + x4 + ' ' + y4 + ' Z'; }
  function circleInit() {
    if (circleBuilt) return; circleBuilt = true; const svg = $('circle');
    for (const minor of [false, true]) for (let i = 0; i < 12; i++) {
      const a = i * 30, g = el('g', { class: 'seg' + (minor ? ' min' : ''), tabindex: 0, role: 'button', 'data-i': i, 'data-m': minor ? 1 : 0 }, svg), k = C.keyInfo(i, minor);
      el('path', { d: minor ? wedge(92, 148, a - 15, a + 15) : wedge(150, 235, a - 15, a + 15) }, g);
      const [tx, ty] = polar(minor ? 122 : 192, a), t = el('text', { x: tx, y: ty }, g); t.textContent = k.tonic + (minor ? 'm' : '') + (i === 6 && !minor ? '' : '');
      g.setAttribute('aria-label', k.tonic + (minor ? ' minor' : ' major') + ', ' + (k.sig === 0 ? 'no sharps or flats' : Math.abs(k.sig) + (k.sig > 0 ? ' sharps' : ' flats')));
      const pick = () => circleSelect(i, minor); g.addEventListener('click', pick); g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    }
    $('c7').onchange = () => circleSelect(cSel.i, cSel.minor); circleSelect(0, false);
    $('cprog').onclick = () => { const ch = C.diatonic(C.keyInfo(cSel.i, cSel.minor).tonic, cSel.minor, false), idx = cSel.minor ? [0, 5, 2, 6] : [0, 4, 5, 3]; idx.forEach((d, k) => playChord(ch[d], k * 0.9, 1.1)); };
  }
  function chordMidis(ch) { let m = 48 + ch.pcs[0]; const out = [m]; for (let i = 1; i < ch.pcs.length; i++) { let n = out[out.length - 1]; do n++; while (n % 12 !== ch.pcs[i]); out.push(n); } return out; }
  function playChord(ch, when = 0, dur = 1.4) { const c = ac(), o = c.createGain(); o.gain.value = 0.9; o.connect(c.destination); chordMidis(ch).forEach((m) => GVSynth.note(c, o, 'Piano', m + 12, 0.75, c.currentTime + 0.02 + when, dur)); }
  function circleSelect(i, minor) {
    cSel = { i, minor }; const k = C.keyInfo(i, minor);
    document.querySelectorAll('#circle g.seg').forEach((g) => { const gi = +g.dataset.i, gm = g.dataset.m === '1'; g.setAttribute('aria-pressed', gi === i && gm === minor); g.classList.toggle('on', gi === i && gm === minor); g.classList.toggle('nb', gm === minor && (gi === (i + 1) % 12 || gi === (i + 11) % 12)); g.classList.toggle('rel', gm !== minor && gi === i); });
    const info = $('cinfo'); info.innerHTML = '';
    const line = (b, t) => { const p = document.createElement('p'); p.style.margin = '4px 0'; const s = document.createElement('b'); s.textContent = b; p.append(s, ' ' + t); info.appendChild(p); };
    line(k.tonic + (minor ? ' minor' : ' major'), '');
    line('Key signature:', k.sig === 0 ? 'no sharps or flats' : Math.abs(k.sig) + (k.sig > 0 ? ' sharp' : ' flat') + (Math.abs(k.sig) > 1 ? 's' : '') + ' (' + k.accidentals.join(' ') + ')');
    line('Notes:', k.scale.join(' '));
    line('Relative ' + (minor ? 'major:' : 'minor:'), k.relative + (minor ? ' major' : ' minor'));
    line(minor ? 'iv and v:' : 'IV and V:', minor ? k.subMin + 'm and ' + k.domMin + 'm' : k.sub + ' and ' + k.dom + ' (the neighbours on the circle)');
    const ch = C.diatonic(k.tonic, minor, $('c7').checked), tb = $('ctable').querySelector('tbody'); tb.innerHTML = '';
    ch.forEach((c) => { const tr = document.createElement('tr'); for (const txt of [c.roman, c.name, c.notes.join(' ')]) { const td = document.createElement('td'); td.textContent = txt; tr.appendChild(td); } const td = document.createElement('td'), b = document.createElement('button'); b.className = 'btn mini'; b.textContent = 'Play'; b.setAttribute('aria-label', 'Play ' + c.name); b.onclick = () => playChord(c); td.appendChild(b); tr.appendChild(td); tb.appendChild(tr); });
    $('cprog').textContent = 'Play the chords ' + (minor ? 'i, VI, III, VII' : 'I, V, vi, IV'); $('cprogtxt').textContent = (minor ? [0, 5, 2, 6] : [0, 4, 5, 3]).map((d) => ch[d].name).join('  ');
  }

  /* ---------- transposer ---------- */
  const KEYS12 = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'], FLATMAJ = new Set([5, 10, 3, 8, 1]);
  function buildTrans() {
    for (let s = -11; s <= 11; s++) opt($('tsemi'), s, (s > 0 ? '+' : s < 0 ? '−' : '') + Math.abs(s) + ' semitone' + (Math.abs(s) === 1 ? '' : 's')); $('tsemi').value = 2;
    opt($('tfrom'), '', '(not set)'); opt($('tto'), '', '(not set)'); KEYS12.forEach((k, i) => { opt($('tfrom'), i, k); opt($('tto'), i, k); });
    ['tsemi', 'tfrom', 'tto', 'tspell'].forEach((id) => { $(id).onchange = trans; }); $('tin').addEventListener('input', trans);
  }
  function trans() {
    const from = $('tfrom').value, to = $('tto').value, text = $('tin').value; let n = +$('tsemi').value, flats, msg = '';
    if (from !== '' && to !== '') { n = (+to - +from + 12) % 12; flats = FLATMAJ.has(+to); msg = 'Moved from ' + KEYS12[+from] + ' to ' + KEYS12[+to] + ' (' + n + ' semitones up).'; $('tsemi').disabled = true; $('tspell').disabled = true; }
    else { $('tsemi').disabled = false; $('tspell').disabled = false; const sp = $('tspell').value; flats = sp === 'f' ? true : sp === 's' ? false : /(^|[\s\[|(/])[A-G](b|♭)/m.test(text); msg = 'Moved by ' + n + ' semitone' + (Math.abs(n) === 1 ? '' : 's') + '.'; }
    $('tout').value = C.transpose(text, n, flats); $('tstat').textContent = msg;
  }
  $('tcopy').onclick = async () => { try { await navigator.clipboard.writeText($('tout').value); $('tstat').textContent = 'Copied.'; } catch (_) { $('tout').select(); try { document.execCommand('copy'); $('tstat').textContent = 'Copied.'; } catch (_2) { $('tstat').textContent = 'Select the text and copy it with your keyboard.'; } } };
  $('tdl').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([$('tout').value], { type: 'text/plain' })); a.download = 'transposed chart.txt'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };

  buildFinder(); finder(); buildShapes(); buildFret(); buildTrans(); trans();
})();
