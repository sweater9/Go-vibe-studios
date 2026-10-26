/* GoVibe Mix — beat maker: 16-step sequencer with synthesized drums, routed through the DJ master */
(() => {
  const A = window.GVAudio; if (!A) return;
  const { ctx, env } = A, $ = (id) => document.getElementById(id);
  const out = ctx.createGain(); out.gain.value = 0.64; out.connect(A.master);

  const noise = (c, len) => { const bf = c.createBuffer(1, Math.floor(c.sampleRate * len), c.sampleRate), d = bf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; const s = c.createBufferSource(); s.buffer = bf; return s; };
  const voices = (ctx, out) => ({
    Kick(t) { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.25); env(g, t, 0.003, 0.35, 1); o.connect(g).connect(out); o.start(t); o.stop(t + 0.45); },
    Snare(t) { const n = noise(ctx, 0.25), f = ctx.createBiquadFilter(), g = ctx.createGain(), o = ctx.createOscillator(), og = ctx.createGain(); f.type = 'highpass'; f.frequency.value = 1200; env(g, t, 0.002, 0.18, 0.8); n.connect(f).connect(g).connect(out); n.start(t); n.stop(t + 0.25); o.frequency.value = 190; env(og, t, 0.002, 0.1, 0.5); o.connect(og).connect(out); o.start(t); o.stop(t + 0.15); },
    Clap(t) { const n = noise(ctx, 0.3), f = ctx.createBiquadFilter(), g = ctx.createGain(); f.type = 'bandpass'; f.frequency.value = 1500; env(g, t, 0.003, 0.2, 0.9); n.connect(f).connect(g).connect(out); n.start(t); n.stop(t + 0.3); },
    'Hat': function (t) { const n = noise(ctx, 0.08), f = ctx.createBiquadFilter(), g = ctx.createGain(); f.type = 'highpass'; f.frequency.value = 7000; env(g, t, 0.001, 0.05, 0.5); n.connect(f).connect(g).connect(out); n.start(t); n.stop(t + 0.08); },
    'Open hat': function (t) { const n = noise(ctx, 0.4), f = ctx.createBiquadFilter(), g = ctx.createGain(); f.type = 'highpass'; f.frequency.value = 6000; env(g, t, 0.001, 0.3, 0.4); n.connect(f).connect(g).connect(out); n.start(t); n.stop(t + 0.4); },
    Bass(t) { const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter(); o.type = 'sawtooth'; o.frequency.value = 55; f.type = 'lowpass'; f.frequency.value = 400; env(g, t, 0.005, 0.25, 0.6); o.connect(f).connect(g).connect(out); o.start(t); o.stop(t + 0.3); }
  });
  const VOICES = voices(ctx, out);
  const NAMES = Object.keys(VOICES), STEPS = 16;
  const empty = () => NAMES.map(() => Array(STEPS).fill(false));
  const fromStr = (rows) => NAMES.map((_, i) => [...(rows[i] || '').padEnd(STEPS, '.')].map((c) => c === 'x'));
  const PRESETS = {
    'House': ['x...x...x...x...', '....x.......x...', '', '..x...x...x...x.', '', 'x..x..x.x..x..x.'],
    'Hip-hop': ['x.....x...x.....', '....x.......x...', '', 'x.x.x.x.x.x.x.x.', '', ''],
    'Trap': ['x.......x.x.....', '........x.......', '', 'x.x.x.x.x.x.xxxx', '', 'x.......x.x.....'],
    'Breakbeat': ['x.....x...x...x.', '....x..x.x..x...', '', 'x.x.x.x.x.x.x.x.', '......x.......x.', '']
  };
  let pat = fromStr(PRESETS.House), bpm = 120, swing = 0, playing = false, step = 0, nextT = 0, timer = 0;

  /* ---------- grid ---------- */
  const grid = $('bgrid'), cells = [];
  NAMES.forEach((nm, r) => {
    const row = document.createElement('div'); row.className = 'brow';
    const lab = document.createElement('span'); lab.textContent = nm; row.appendChild(lab);
    cells[r] = [];
    for (let s = 0; s < STEPS; s++) {
      const b = document.createElement('button'); b.className = 'bstep'; b.setAttribute('aria-label', nm + ' step ' + (s + 1));
      b.onclick = () => { pat[r][s] = !pat[r][s]; paint(); if (pat[r][s]) { ctx.resume(); VOICES[nm](ctx.currentTime + 0.005); } };
      row.appendChild(b); cells[r][s] = b;
    }
    grid.appendChild(row);
  });
  function paint() { cells.forEach((row, r) => row.forEach((b, s) => b.setAttribute('aria-pressed', pat[r][s] ? 'true' : 'false'))); }
  paint();
  function mark(s) { cells.forEach((row) => row.forEach((b, i) => b.classList.toggle('now', i === s))); }

  Object.keys(PRESETS).forEach((k) => { const b = document.createElement('button'); b.className = 'btn'; b.textContent = k; b.onclick = () => { pat = fromStr(PRESETS[k]); paint(); }; $('bpresets').appendChild(b); });
  $('bclear').onclick = () => { pat = empty(); paint(); };

  /* ---------- scheduler (look-ahead) ---------- */
  const stepLen = () => 60 / bpm / 4;
  function tick() {
    while (nextT < ctx.currentTime + 0.12) {
      const s = step, t = nextT + (s % 2 ? (swing / 100) * stepLen() * 0.5 : 0);
      pat.forEach((row, r) => { if (row[s]) VOICES[NAMES[r]](t); });
      const delay = Math.max(0, (t - ctx.currentTime) * 1000);
      setTimeout(() => playing && mark(s), delay);
      nextT += stepLen(); step = (step + 1) % STEPS;
    }
  }
  function start() { ctx.resume(); step = 0; nextT = ctx.currentTime + 0.06; playing = true; timer = setInterval(tick, 25); tick(); $('bplay').textContent = '■ Stop beat'; }
  function stop() { playing = false; clearInterval(timer); mark(-1); $('bplay').textContent = '▶ Play beat'; }
  $('bplay').onclick = () => (playing ? stop() : start());
  $('bbpm').onchange = $('bbpm').oninput = () => { const v = +$('bbpm').value; if (v >= 60 && v <= 200) bpm = v; };
  $('bswing').oninput = () => (swing = +$('bswing').value);
  $('bvol').oninput = () => (out.gain.value = 0.8 * Math.pow($('bvol').value / 100, 1.5));
  $('bmatch').onclick = () => {
    const d = A.decks && A.decks[0], v = d && d.liveBpm;
    if (!v) return alert('Load a track into deck A and detect its BPM first.');
    bpm = Math.min(200, Math.max(60, Math.round(v))); $('bbpm').value = bpm;
  };

  /* ---------- save / load patterns (this browser only) ---------- */
  const SK = 'govibe.beats';
  const getAll = () => { try { return JSON.parse(localStorage.getItem(SK)) || {}; } catch (_) { return {}; } };
  const putAll = (v) => { try { localStorage.setItem(SK, JSON.stringify(v)); return true; } catch (_) { return false; } };
  const toStr = () => pat.map((r) => r.map((x) => (x ? 'x' : '.')).join(''));
  const setBpm = (v) => { bpm = v; $('bbpm').value = v; };
  function refreshSaved() { const sel = $('bsaved'), all = getAll(); sel.innerHTML = ''; const ks = Object.keys(all); if (!ks.length) sel.add(new Option('No saved beats', '')); ks.forEach((k) => sel.add(new Option(k, k))); }
  $('bsave').onclick = () => {
    const name = $('bname').value.trim().slice(0, 40); if (!name) return alert('Give the beat a name.');
    const all = getAll(); all[name] = { rows: toStr(), bpm, swing };
    if (!putAll(all)) return alert('Could not save in this browser.');
    refreshSaved(); $('bsaved').value = name; $('bstatus').textContent = 'Saved "' + name + '".';
  };
  $('bload').onclick = () => {
    const k = $('bsaved').value, d = getAll()[k]; if (!d) return;
    pat = fromStr(d.rows); setBpm(d.bpm); swing = d.swing || 0; $('bswing').value = swing; $('bname').value = k; paint(); $('bstatus').textContent = 'Loaded "' + k + '".';
  };
  $('bdel').onclick = () => { const k = $('bsaved').value, all = getAll(); if (!all[k]) return; delete all[k]; putAll(all); refreshSaved(); $('bstatus').textContent = 'Deleted "' + k + '".'; };
  refreshSaved();

  /* ---------- export as WAV (rendered offline, faster than real time) ---------- */
  function wav(buf) {
    const n = buf.length, ch = buf.numberOfChannels, d = [...Array(ch)].map((_, i) => buf.getChannelData(i)), v = new DataView(new ArrayBuffer(44 + n * ch * 2));
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + n * ch * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
    v.setUint32(24, buf.sampleRate, true); v.setUint32(28, buf.sampleRate * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * ch * 2, true);
    let o = 44; for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const s = Math.max(-1, Math.min(1, d[c][i])); v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2; }
    return new Blob([v], { type: 'audio/wav' });
  }
  async function render() {
    const bars = +$('bbars').value, sl = 60 / bpm / 4, len = bars * STEPS * sl + 1, sr = 44100;
    const oc = new OfflineAudioContext(2, Math.ceil(sr * len), sr), g = oc.createGain(); g.gain.value = 0.8 * Math.pow($('bvol').value / 100, 1.5) * 0.8; g.connect(oc.destination);
    const V = voices(oc, g);
    for (let i = 0; i < bars * STEPS; i++) { const s = i % STEPS, t = 0.05 + i * sl + (s % 2 ? (swing / 100) * sl * 0.5 : 0); pat.forEach((row, r) => { if (row[s]) V[NAMES[r]](t); }); }
    return wav(await oc.startRendering());
  }
  let lastBlob = null;
  $('bexport').onclick = async () => {
    if (!pat.some((r) => r.some(Boolean))) return ($('bstatus').textContent = 'The pattern is empty. Add some steps first.');
    $('bexport').disabled = true; $('bstatus').textContent = 'Rendering…';
    try {
      lastBlob = await render();
      const a = $('bdl'); if (a.href) URL.revokeObjectURL(a.href);
      a.href = URL.createObjectURL(lastBlob); a.download = 'govibe-beat-' + bpm + 'bpm.wav'; a.classList.remove('hidden'); $('btoedit').classList.remove('hidden');
      $('bstatus').textContent = 'Ready: ' + $('bbars').value + ' bars at ' + bpm + ' BPM.';
    } catch (e) { $('bstatus').textContent = 'Could not render: ' + e.message; }
    $('bexport').disabled = false;
  };
  $('btoedit').onclick = async () => { if (!lastBlob) return; try { await GVStore.put('handoff', lastBlob); location.href = 'editor.html?from=create'; } catch (_) { $('bstatus').textContent = 'Could not hand the file to the editor. Download it and open it there.'; } };
  if (/[?&]gvtest\b/.test(location.search)) window.__beat = { get pat() { return pat; }, get playing() { return playing; }, get bpm() { return bpm; }, get lastBlob() { return lastBlob; }, NAMES };   // test hook
})();
