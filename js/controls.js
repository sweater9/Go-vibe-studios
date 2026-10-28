/* GoVibe Mix — keyboard shortcuts, MIDI controllers and level meters for the DJ page */
(() => {
  const A = window.GVAudio; if (!A) return;
  const { decks } = A, $ = (id) => document.getElementById(id);
  const click = (el) => el && el.click();

  /* ---------- actions (shared by keyboard and MIDI) ---------- */
  const ACT = [];
  const add = (id, label, kind, run, key) => ACT.push({ id, label, kind, run, key });
  const slider = (el) => (v) => { const lo = +el.min, hi = +el.max; el.value = lo + v * (hi - lo); el.dispatchEvent(new Event('input', { bubbles: true })); };
  const xfStep = (d) => { const x = $('xf'); x.value = Math.max(0, Math.min(100, +x.value + d)); x.dispatchEvent(new Event('input', { bubbles: true })); };
  add('xf', 'Crossfader', 'slider', slider($('xf')));
  add('master', 'Master volume', 'slider', slider($('master')));
  decks.forEach((d, i) => {
    const n = d.name, p = n.toLowerCase(), K = i === 1 ? ['p', 'l', 'm', 'i', '7', '8', '9', '0'] : i === 0 ? ['q', 'a', 'z', 'e', '1', '2', '3', '4'] : [];
    [['vol', 'volume'], ['low', 'bass EQ'], ['mid', 'mid EQ'], ['high', 'treble EQ'], ['filt', 'filter'], ['echo', 'echo'], ['rev', 'reverb'], ['fxamt', 'effect amount'], ['tempo', 'tempo']].forEach(([k, l]) => add(p + '.' + k, 'Deck ' + n + ' ' + l, 'slider', slider(d.el[k])));
    add(p + '.play', 'Deck ' + n + ' play / pause', 'button', () => click(d.el.play), K[0]);
    add(p + '.cue', 'Deck ' + n + ' cue', 'button', () => click(d.el.cue), K[1]);
    add(p + '.sync', 'Deck ' + n + ' sync to the other deck', 'button', () => click($('sync' + n)), K[2]);
    add(p + '.loop', 'Deck ' + n + ' loop on / off', 'button', () => click(d.el.loop), K[3]);
    for (let h = 1; h <= A.CUES; h++) add(p + '.hot' + h, 'Deck ' + n + ' hot cue ' + h, 'button', () => click(d.el['hot' + h]), K[3 + h]);
    [['r8', '1/8'], ['r4', '1/4'], ['r2', '1/2'], ['r1', '1 beat']].forEach(([k, l]) => add(p + '.roll' + k, 'Deck ' + n + ' loop roll ' + l + ' (hold)', 'hold', (on) => (on ? d.rollStart(+d.el[k].dataset.beats, d.el[k]) : d.rollEnd(d.el[k]))));
    [['jm8', '−8 beats'], ['jp8', '+8 beats'], ['jm4', '−4 beats'], ['jm1', '−1 beat'], ['jp1', '+1 beat'], ['jp4', '+4 beats']].forEach(([k, l]) => add(p + '.' + k, 'Deck ' + n + ' jump ' + l, 'button', () => click(d.el[k])));
  });
  add('xfl', 'Crossfader towards A', 'button', () => xfStep(-5), '[');
  add('xfr', 'Crossfader towards B', 'button', () => xfStep(5), ']');
  add('xfc', 'Crossfader to centre', 'button', () => { $('xf').value = 50; $('xf').dispatchEvent(new Event('input', { bubbles: true })); }, '\\');
  add('beat', 'Beat maker start / stop', 'button', () => click($('bplay')), 'b');
  add('rec', 'Record mix', 'button', () => click($('rec')), 'r');
  ['Kick', 'Clap', 'Horn', 'Riser'].forEach((nm, i) => add('pad' + i, 'Pad ' + nm, 'button', () => click(document.querySelectorAll('#pads .pad')[i]), ['x', 'c', 'v', 'n'][i]));
  add('perf', 'Full performance view on / off', 'button', () => click($('perfbtn')), 'f');
  add('theme', 'Light / dark console', 'button', () => click($('themebtn')), 't');
  add('help', 'Show keyboard shortcuts', 'button', () => openHelp(), '?');

  /* ---------- help dialog ---------- */
  const modal = document.createElement('div'); modal.className = 'modal hidden'; modal.id = 'helpmodal'; modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-labelledby', 'helptitle');
  const box = document.createElement('div'); box.className = 'box'; box.style.maxWidth = '560px'; box.style.maxHeight = '85vh'; box.style.overflow = 'auto';
  box.innerHTML = '<h2 id="helptitle">Keyboard shortcuts</h2><p class="status">Shortcuts are off while you type in a text box. MIDI controllers can be mapped to any control in the Controller section.</p><table class="keytbl"></table><div class="row" style="margin-top:12px"><button class="btn primary" id="helpclose">Close</button></div>';
  modal.appendChild(box); document.body.appendChild(modal);
  const tbl = box.querySelector('table');
  ACT.filter((a) => a.key).forEach((a) => { const tr = document.createElement('tr'); tr.innerHTML = '<td></td><td><kbd></kbd></td>'; tr.cells[0].textContent = a.label; tr.cells[1].firstChild.textContent = a.key === '\\' ? '\\' : a.key.toUpperCase(); tbl.appendChild(tr); });
  let lastFocus = null;
  function openHelp() { lastFocus = document.activeElement; modal.classList.remove('hidden'); $('helpclose').focus(); }
  function closeHelp() { modal.classList.add('hidden'); if (lastFocus && lastFocus.focus) lastFocus.focus(); }
  $('helpclose').onclick = closeHelp; $('helpbtn').onclick = openHelp;
  modal.addEventListener('click', (e) => { if (e.target === modal) closeHelp(); });

  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) return closeHelp();
    if (e.ctrlKey || e.metaKey || e.altKey || !modal.classList.contains('hidden')) return;
    const t = e.target;
    if (t.matches && t.matches('input:not([type=range]):not([type=checkbox]), textarea, select, [contenteditable]')) return;
    if (t.tagName === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key, a = ACT.find((x) => x.key === k);
    if (a) { e.preventDefault(); a.run(); }
  });

  /* ---------- MIDI ---------- */
  const MK = 'govibe.midimap';
  let map = {}; try { map = JSON.parse(localStorage.getItem(MK)) || {}; } catch (_) {}
  const saveMap = () => { try { localStorage.setItem(MK, JSON.stringify(map)); } catch (_) {} };
  let learning = null; const down = {};
  const say = (t) => { $('midistatus').textContent = t; };
  const sel = $('mact'); ACT.forEach((a) => sel.add(new Option(a.label + (a.kind === 'slider' ? ' (knob / fader)' : a.kind === 'hold' ? ' (pad, hold)' : ' (button)'), a.id)));
  function listMap() {
    const rows = Object.entries(map).map(([k, id]) => { const a = ACT.find((x) => x.id === id), [t, ch, n] = k.split(':'); return (a ? a.label : id) + ' ← ' + (t === 'n' ? 'note ' : 'CC ') + n + ' (ch ' + (+ch + 1) + ')'; });
    $('mlist').textContent = rows.length ? rows.join('; ') : 'Nothing mapped yet. Pick a control, press Learn, then move or press the control on your device.';
  }
  listMap();
  const keyOf = (d) => { const st = d[0] & 0xf0, ch = d[0] & 0x0f; if (st === 0x90 && d[2] > 0) return 'n:' + ch + ':' + d[1]; if (st === 0xb0) return 'c:' + ch + ':' + d[1]; return null; };
  function handle(d) {
    const st = d[0] & 0xf0, off = st === 0x80 || (st === 0x90 && d[2] === 0), key = off ? 'n:' + (d[0] & 15) + ':' + d[1] : keyOf(d); if (!key) return;
    if (off) { const h = ACT.find((x) => x.id === map[key]); if (h && h.kind === 'hold') h.run(false); return; }
    if (learning) {
      Object.keys(map).forEach((k) => { if (map[k] === learning) delete map[k]; });
      map[key] = learning; saveMap(); const a = ACT.find((x) => x.id === learning); learning = null; $('mlearn').textContent = 'Learn'; listMap(); say('Mapped ' + a.label + '.'); return;
    }
    const a = ACT.find((x) => x.id === map[key]); if (!a) return;
    if (a.kind === 'slider') { if (st === 0xb0) a.run(d[2] / 127); return; }
    if (a.kind === 'hold') { if (st === 0xb0) { const now = d[2] >= 64; if (now !== !!down[key]) { down[key] = now; a.run(now); } } else a.run(true); return; }
    if (st === 0xb0) { const was = down[key]; down[key] = d[2] >= 64; if (down[key] && !was) a.run(); } else a.run();
  }
  $('mlearn').onclick = () => { if (learning) { learning = null; $('mlearn').textContent = 'Learn'; return say('Learning cancelled.'); } learning = sel.value; $('mlearn').textContent = 'Waiting…'; say('Now move or press the control on your MIDI device.'); };
  $('mclear').onclick = () => { Object.keys(map).forEach((k) => { if (map[k] === sel.value) delete map[k]; }); saveMap(); listMap(); };
  $('mreset').onclick = () => { map = {}; saveMap(); listMap(); say('All mappings cleared.'); };
  /* save and load the mapping as a small file, so it can move between browsers and be shared */
  const MAPKIND = 'govibe-dj-midi-map';
  function mapFile() { return new Blob([JSON.stringify({ app: 'go-vibe-studios', kind: MAPKIND, version: 1, map }, null, 1)], { type: 'application/json' }); }
  function applyMapData(data) {
    if (!data || data.kind !== MAPKIND || !data.map || typeof data.map !== 'object') throw new Error('This is not a GoVibe Mix MIDI mapping file.');
    const next = {}; let n = 0, skipped = 0;
    Object.entries(data.map).forEach(([k, id]) => { if (/^[nc]:\d{1,2}:\d{1,3}$/.test(k) && ACT.some((x) => x.id === id)) { next[k] = id; n++; } else skipped++; });
    map = next; saveMap(); listMap(); return { n, skipped };
  }
  $('msave').onclick = () => { if (!Object.keys(map).length) return say('Nothing is mapped yet.'); const a = document.createElement('a'); a.href = URL.createObjectURL(mapFile()); a.download = 'govibe-midi-mapping.json'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); say('Mapping saved as a file.'); };
  $('mload').onclick = () => $('mfile').click();
  $('mfile').onchange = async () => { const f = $('mfile').files[0]; $('mfile').value = ''; if (!f) return; try { const r = applyMapData(JSON.parse(await f.text())); say('Loaded ' + r.n + ' mapping' + (r.n === 1 ? '' : 's') + (r.skipped ? ' (' + r.skipped + ' skipped)' : '') + '.'); } catch (e) { say(e instanceof SyntaxError ? 'That file is not valid JSON.' : e.message); } };
  let access = null;
  function attach() {
    const names = []; access.inputs.forEach((inp) => { inp.onmidimessage = (m) => handle(m.data); names.push(inp.name); });
    say(names.length ? 'Connected: ' + names.join(', ') + '.' : 'MIDI is on but no device was found. Plug one in.');
  }
  $('midibtn').onclick = async () => {
    if (!navigator.requestMIDIAccess) return say('This browser does not support MIDI. Use Chrome or Edge on a computer.');
    try { access = await navigator.requestMIDIAccess(); access.onstatechange = attach; attach(); }
    catch (_) { say('MIDI access was blocked. Allow it in the browser prompt or site settings.'); }
  };

  /* ---------- meters + limiter ---------- */
  const lim = $('lim'); lim.onchange = () => A.setLimiter(lim.checked);
  const tb = new Float32Array(1024), peak = (an) => { an.getFloatTimeDomainData(tb); let m = 0; for (let i = 0; i < tb.length; i++) { const v = Math.abs(tb[i]); if (v > m) m = v; } return m; };
  const frac = (p) => Math.max(0, Math.min(1, (20 * Math.log10(p + 1e-6) + 60) / 60));
  const col = (p) => (p > 0.89 ? '#fb7185' : p > 0.25 ? '#fbbf24' : '#34d399');
  const hold = [0, 0], holdT = [0, 0], shown = [0, 0], dshown = decks.map(() => 0);
  const mm = $('mmeter'), g = mm.getContext('2d'), SEG = 30;
  const segCol = (f, lit) => (f > 0.9 ? (lit ? '#ff4d6d' : '#3a1a22') : f > 0.72 ? (lit ? '#fbbf24' : '#3a3118') : (lit ? '#34d399' : '#14301f'));
  (function frame() {
    const now = performance.now(), pk = [peak(A.anL), peak(A.anR)];
    if (mm.width !== mm.clientWidth && mm.clientWidth) { mm.width = mm.clientWidth; mm.height = mm.clientHeight || 46; }
    const W = mm.width, H = mm.height; g.clearRect(0, 0, W, H);
    const bw = W - 34, sw = bw / SEG;
    pk.forEach((p, i) => {
      shown[i] = Math.max(p, shown[i] * 0.9); if (p >= hold[i] || now - holdT[i] > 1200) { hold[i] = p; holdT[i] = now; }
      const y = 5 + i * (H / 2 - 2), h = H / 2 - 7, fv = frac(shown[i]), fh = frac(hold[i]);
      for (let k = 0; k < SEG; k++) { const f = (k + 1) / SEG; g.fillStyle = segCol(f, f <= fv + 0.001 || (Math.abs(f - fh) < 0.5 / SEG)); g.fillRect(2 + k * sw, y, Math.max(1, sw - 1.5), h); }
      g.fillStyle = pk[i] >= 0.985 ? '#ff4d6d' : '#2a2d38'; g.fillRect(W - 28, y, 24, h);
    });
    const red = A.comp.reduction; $('limred').textContent = lim.checked && red < -1 ? 'limiting ' + red.toFixed(0) + ' dB' : '';
    decks.forEach((d, i) => {
      const c = d.el.meter; if (c.height !== c.clientHeight || c.width !== c.clientWidth) { c.width = c.clientWidth || 12; c.height = c.clientHeight || 170; }
      const p = d.level(); dshown[i] = Math.max(p, dshown[i] * 0.9); const x = c.getContext('2d'), n = 18, sh = c.height / n, fv = frac(dshown[i]);
      x.clearRect(0, 0, c.width, c.height);
      for (let k = 0; k < n; k++) { const f = (k + 1) / n; x.fillStyle = segCol(f, f <= fv + 0.001); x.fillRect(1, c.height - (k + 1) * sh + 1, c.width - 2, Math.max(1, sh - 2)); }
    });
    requestAnimationFrame(frame);
  })();

  if (/[?&]gvtest\b/.test(location.search)) window.__ctl = { handle, ACT, applyMapData, mapFile, learn: (id) => { learning = id; }, get map() { return map; }, peak: () => [peak(A.anL), peak(A.anR)] };   // test hook
})();
