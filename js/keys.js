/* GoVibe Mix — key and scale helper. */
(() => {
  const $ = (id) => document.getElementById(id), T = window.GVTheory;
  let ctx = null, tries = 0; const picked = new Set(); const LOW = 48, HIGH = 83; /* C3 to B5 */
  const ac = () => { ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); ctx.resume(); return ctx; };
  const state = () => ({ root: +$('root').value, scale: $('scale').value });
  const isMM = (s) => s === 'Major' || s === 'Natural minor';
  function sound(midi, when, dur) { const c = ac(), out = c.createGain(); out.gain.value = 0.9; out.connect(c.destination); GVSynth.note(c, out, $('inst').value, midi, 0.8, c.currentTime + (when || 0.01), dur || 1.2); }
  function chordSound(notes, when, dur) { notes.forEach((m) => sound(m, when, dur)); }

  function keyboard() {
    const { root, scale } = state(), set = new Set(T.SCALES[scale].map((i) => (root + i) % 12)), kb = $('kb'); kb.innerHTML = '';
    const WH = [0, 2, 4, 5, 7, 9, 11], W = 38; let x = 0; const pos = {};
    for (let m = LOW; m <= HIGH; m++) if (WH.includes(m % 12)) { pos[m] = x; x += W; }
    const inner = document.createElement('div'); inner.className = 'kbin'; inner.style.width = x + 'px'; kb.appendChild(inner);
    for (let m = LOW; m <= HIGH; m++) {
      const pc = m % 12, white = WH.includes(pc), b = document.createElement('button'); b.type = 'button';
      b.className = (white ? 'wk' : 'bk') + (set.has(pc) ? ' in' : '') + (pc === root ? ' root' : '');
      b.style.left = (white ? pos[m] : pos[m - 1] + W - 12) + 'px'; b.style.width = (white ? W : 24) + 'px';
      b.setAttribute('aria-label', T.nm(pc) + (Math.floor(m / 12) - 1) + (pc === root ? ', root' : set.has(pc) ? ', in the scale' : ''));
      b.onclick = () => sound(m); inner.appendChild(b);
    }
  }
  function chords() {
    const { root, scale } = state(), seventh = $('sev').checked, list = T.chordsInKey(root, scale, seventh), tb = $('chords').querySelector('tbody'); tb.innerHTML = '';
    $('nochords').textContent = list.length ? '' : 'Chords are listed for the seven note scales (major, minor, modes). Pick one of those to see them.';
    list.forEach((c) => {
      const tr = document.createElement('tr'), ns = c.midi(4).map((m) => T.nm(m)).join(' ');
      tr.innerHTML = '<th scope="row"></th><td></td><td></td><td><button class="btn mini"></button></td>'; tr.children[0].textContent = c.roman; tr.children[1].textContent = c.name; tr.children[2].textContent = ns;
      const b = tr.querySelector('button'); b.textContent = 'Play'; b.setAttribute('aria-label', 'Play ' + c.name); b.onclick = () => chordSound(c.midi(3), 0, 1.6); tb.appendChild(tr);
    });
    const minor = scale === 'Natural minor' ? 'minor' : 'major', cur = $('prog').dataset.mode;
    if (cur !== minor) { $('prog').dataset.mode = minor; $('prog').innerHTML = ''; Object.keys(T.PROGS[minor]).forEach((k) => { const o = document.createElement('option'); o.textContent = k; $('prog').appendChild(o); }); }
    progShow();
  }
  const progChords = () => { const { root, scale } = state(), mode = $('prog').dataset.mode, ivs = T.SCALES[scale]; if (ivs.length !== 7) return []; return (T.PROGS[mode][$('prog').value] || []).map((d) => T.chord(root, ivs, d, $('sev').checked)); };
  function progShow() { const cs = progChords(); $('pshow').textContent = cs.length ? cs.map((c) => c.name).join('  →  ') : 'Progressions need a seven note scale.'; }
  function progPlay() { const cs = progChords(), spb = 60 / (+$('pbpm').value || 90); cs.forEach((c, i) => chordSound(c.midi(3), i * spb * 4, spb * 3.8)); }
  function compat() {
    const { root, scale } = state(), tb = $('compat').querySelector('tbody'); tb.innerHTML = '';
    if (!isMM(scale)) { $('ncompat').textContent = 'DJ key codes (Camelot) are defined for major and minor keys. Pick Major or Natural minor to see them.'; return; } $('ncompat').textContent = '';
    T.compatible(root, scale === 'Natural minor').forEach((k) => { const tr = document.createElement('tr'); tr.innerHTML = '<th scope="row"></th><td></td><td></td>'; tr.children[0].textContent = k.code; tr.children[1].textContent = k.name; tr.children[2].textContent = k.why; tb.appendChild(tr); });
  }
  function summary() {
    const { root, scale } = state(), ivs = T.SCALES[scale], notes = ivs.map((i) => T.nm(root + i)).join('  '), cam = isMM(scale) ? ' · Camelot ' + T.camelot(root, scale === 'Natural minor') : '';
    $('summary').textContent = T.nm(root) + ' ' + scale + ': ' + notes + cam;
  }
  function finder() {
    const list = T.findScales([...picked]), ul = $('found'); ul.innerHTML = '';
    if (!picked.size) { const li = document.createElement('li'); li.className = 'status'; li.textContent = 'No notes ticked yet.'; ul.appendChild(li); return; }
    if (!list.length) { const li = document.createElement('li'); li.className = 'status'; li.textContent = 'No common scale contains all of these notes.'; ul.appendChild(li); return; }
    list.slice(0, 16).forEach((s) => { const li = document.createElement('li'), b = document.createElement('button'); b.className = 'btn mini'; b.textContent = T.nm(s.root) + ' ' + s.scale; b.onclick = () => { $('root').value = s.root; $('scale').value = s.scale; all(); window.scrollTo({ top: 0, behavior: 'smooth' }); }; li.appendChild(b); ul.appendChild(li); });
  }
  function all() { summary(); keyboard(); chords(); compat(); }
  T.NAMES.forEach((n, i) => { const o = document.createElement('option'); o.value = i; o.textContent = n; $('root').appendChild(o); });
  Object.keys(T.SCALES).forEach((s) => { const o = document.createElement('option'); o.textContent = s; $('scale').appendChild(o); });
  T.NAMES.forEach((n, i) => { const l = document.createElement('label'); l.className = 'row time'; const c = document.createElement('input'); c.type = 'checkbox'; c.onchange = () => { c.checked ? picked.add(i) : picked.delete(i); finder(); }; l.append(c, document.createTextNode(' ' + n)); $('pcs').appendChild(l); });
  ['root', 'scale'].forEach((id) => { $(id).onchange = all; }); $('sev').onchange = chords; $('prog').onchange = progShow; $('pplay').onclick = progPlay;
  all(); finder();
  if (window.GVSession) GVSession.bind({ root: $('root'), minor: { el: $('scale'), read: () => ({ 'Major': false, 'Natural minor': true })[$('scale').value] ?? null, write: (m) => { $('scale').value = m ? 'Natural minor' : 'Major'; } } });
  if (/[?&]gvtest\b/.test(location.search)) window.__keys = { all, state, picked };
})();
