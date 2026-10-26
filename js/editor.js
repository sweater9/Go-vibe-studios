/* GoVibe Mix — in-browser audio editor (Web Audio API, no dependencies) */
(() => {
  const $ = (id) => document.getElementById(id);
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();

  const drop = $('drop'), fileInput = $('file'), editor = $('editor');
  const canvas = $('wave'), g = canvas.getContext('2d');
  const statusEl = $('status');

  /** Buffer state: array of Float32Array channels + sampleRate */
  let sr = 44100;
  let chans = null;             // Float32Array[]
  let history = [], future = []; // snapshots of chans
  let selStart = 0, selEnd = 0;  // in samples; selStart===selEnd means no selection
  let playSrc = null, playStartedAt = 0, playOffset = 0, playing = false, rafId = 0;

  const len = () => (chans ? chans[0].length : 0);
  const fmt = (s) => {
    const m = Math.floor(s / 60), r = s - m * 60;
    return m + ':' + r.toFixed(2).padStart(5, '0');
  };
  const say = (t) => { statusEl.textContent = t; };

  /* ---------- loading ---------- */
  async function loadFile(file) {
    if (!file) return;
    say('Decoding…');
    try {
      const buf = await ctx.decodeAudioData(await file.arrayBuffer());
      sr = buf.sampleRate;
      chans = [];
      for (let c = 0; c < buf.numberOfChannels; c++) chans.push(new Float32Array(buf.getChannelData(c)));
      history = []; future = []; selStart = selEnd = 0;
      editor.classList.remove('hidden');
      drop.classList.add('hidden');
      stop();
      refresh();
      say('Loaded ' + (file.name || 'audio'));
    } catch (e) {
      say('');
      alert('Could not read that file. Try MP3, WAV or OGG.');
    }
  }
  drop.addEventListener('click', () => fileInput.click());
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter') fileInput.click(); });
  fileInput.addEventListener('change', () => loadFile(fileInput.files[0]));
  ['dragover', 'dragenter'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => loadFile(e.dataTransfer.files[0]));

  // Hand-off from the Create page
  { const from = new URLSearchParams(location.search).get('from');
  if ((from === 'create' || from === 'record' || from === 'studio') && window.GVStore)
    GVStore.get('handoff').then((b) => { if (b) { b.name = from === 'record' ? 'recording' : from === 'studio' ? 'studio mix' : 'generated track'; loadFile(b); GVStore.del('handoff'); } }).catch(() => {});
  }

  /* ---------- history ---------- */
  function snapshot() { history.push(chans.map((c) => c.slice())); if (history.length > 20) history.shift(); future = []; }
  function undo() { if (!history.length) return; future.push(chans); chans = history.pop(); clampSel(); stop(); refresh(); }
  function redo() { if (!future.length) return; history.push(chans); chans = future.pop(); clampSel(); stop(); refresh(); }
  function clampSel() { selStart = Math.min(selStart, len()); selEnd = Math.min(selEnd, len()); }
  $('undo').onclick = undo; $('redo').onclick = redo;

  /* ---------- drawing ---------- */
  function fit() {
    const r = canvas.getBoundingClientRect(), d = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(r.width * d)) { canvas.width = Math.round(r.width * d); canvas.height = Math.round(r.height * d); }
  }
  function draw() {
    if (!chans) return;
    fit();
    const W = canvas.width, H = canvas.height, n = len();
    g.clearRect(0, 0, W, H);
    // selection
    if (selEnd > selStart) {
      g.fillStyle = 'rgba(139,92,246,.28)';
      g.fillRect(selStart / n * W, 0, (selEnd - selStart) / n * W, H);
    }
    // waveform (min/max per pixel column, first channel mixed with others)
    g.fillStyle = '#22d3ee';
    const step = n / W;
    for (let x = 0; x < W; x++) {
      const a = Math.floor(x * step), b = Math.min(n, Math.floor((x + 1) * step) + 1);
      let mn = 1, mx = -1;
      const stride = Math.max(1, Math.floor((b - a) / 64));
      for (let i = a; i < b; i += stride) {
        let v = 0;
        for (let c = 0; c < chans.length; c++) v += chans[c][i];
        v /= chans.length;
        if (v < mn) mn = v; if (v > mx) mx = v;
      }
      if (mn > mx) { mn = mx = 0; }
      const y1 = (1 - mx) * 0.5 * H, y2 = (1 - mn) * 0.5 * H;
      g.fillRect(x, y1, 1, Math.max(1, y2 - y1));
    }
    // centre line
    g.fillStyle = '#ffffff22'; g.fillRect(0, H / 2, W, 1);
    // playhead
    if (playing) {
      const pos = (playOffset + (ctx.currentTime - playStartedAt) * playRate) ;
      const x = Math.min(1, pos / (n / sr)) * W;
      g.fillStyle = '#fbbf24'; g.fillRect(x, 0, 2, H);
    }
  }
  let playRate = 1;
  function refresh() {
    $('info').textContent = fmt(len() / sr) + ' · ' + chans.length + ' ch · ' + sr + ' Hz';
    $('sel').textContent = selEnd > selStart
      ? 'Selection ' + fmt(selStart / sr) + ' → ' + fmt(selEnd / sr) + ' (' + fmt((selEnd - selStart) / sr) + ')'
      : 'No selection (edits apply to whole track)';
    $('undo').disabled = !history.length; $('redo').disabled = !future.length;
    draw();
  }
  window.addEventListener('resize', draw);

  /* ---------- selecting ---------- */
  let dragStart = null, dragMoved = false;
  const sampleAt = (e) => {
    const r = canvas.getBoundingClientRect();
    return Math.max(0, Math.min(len(), Math.round((e.clientX - r.left) / r.width * len())));
  };
  canvas.addEventListener('pointerdown', (e) => { if (!chans) return; canvas.setPointerCapture(e.pointerId); dragStart = sampleAt(e); dragMoved = false; });
  canvas.addEventListener('pointermove', (e) => {
    if (dragStart === null) return;
    const s = sampleAt(e);
    if (Math.abs(s - dragStart) > len() / canvas.width * 3) dragMoved = true;
    if (dragMoved) { selStart = Math.min(dragStart, s); selEnd = Math.max(dragStart, s); refresh(); }
  });
  canvas.addEventListener('pointerup', (e) => {
    if (dragStart === null) return;
    if (!dragMoved) { selStart = selEnd = 0; playOffset = dragStart / sr; refresh(); if (playing) play(dragStart / sr); }
    dragStart = null;
  });

  /* ---------- playback ---------- */
  function toBuffer(arrs) {
    const b = ctx.createBuffer(arrs.length, arrs[0].length, sr);
    arrs.forEach((a, c) => b.copyToChannel(a, c));
    return b;
  }
  function play(from) {
    if (!chans) return;
    stop(true);
    ctx.resume();
    const hasSel = selEnd > selStart;
    const startS = from != null ? from * sr : (hasSel ? selStart : playOffset * sr);
    const endS = hasSel && from == null ? selEnd : len();
    const buf = toBuffer(chans);
    const src = ctx.createBufferSource();
    src.buffer = buf; src.connect(ctx.destination);
    const doLoop = $('loop').checked && hasSel;
    if (doLoop) { src.loop = true; src.loopStart = selStart / sr; src.loopEnd = selEnd / sr; }
    src.start(0, startS / sr, doLoop ? undefined : Math.max(0.01, (endS - startS) / sr));
    src.onended = () => { if (playSrc === src) { stop(); } };
    playSrc = src; playOffset = startS / sr; playStartedAt = ctx.currentTime; playing = true;
    $('play').textContent = '❚❚ Pause';
    loop();
  }
  function loop() { cancelAnimationFrame(rafId); const t = () => { if (!playing) return; draw(); rafId = requestAnimationFrame(t); }; t(); }
  function stop(keep) {
    if (playSrc) { const s = playSrc; playSrc = null; s.onended = null; try { s.stop(); } catch (_) {} }
    playing = false; cancelAnimationFrame(rafId);
    if (!keep) { $('play').textContent = '▶ Play'; draw(); }
  }
  $('play').onclick = () => {
    if (playing) { playOffset += ctx.currentTime - playStartedAt; stop(); } else play();
  };
  $('stop').onclick = () => { playOffset = 0; stop(); };

  /* ---------- editing ---------- */
  const range = () => (selEnd > selStart ? [selStart, selEnd] : [0, len()]);
  const speedEl = $('speed'), gainEl = $('gain');
  speedEl.oninput = () => { $('speedv').textContent = (speedEl.value / 100).toFixed(2) + '×'; };
  gainEl.oninput = () => { $('gainv').textContent = gainEl.value + '%'; };
  const lab = (id, out, f) => { $(id).oninput = () => { $(out).textContent = f($(id).value); }; };
  lab('pitch', 'pitchv', (v) => (v > 0 ? '+' : '') + v + ' semitones'); lab('eqlo', 'eqlov', (v) => (v > 0 ? '+' : '') + v + ' dB'); lab('eqmid', 'eqmidv', (v) => (v > 0 ? '+' : '') + v + ' dB');
  lab('eqhi', 'eqhiv', (v) => (v > 0 ? '+' : '') + v + ' dB'); lab('gate', 'gatev', (v) => v + ' dB');


  /* ---------- DSP helpers: biquad filters, time stretch (WSOLA), pitch shift, noise gate ---------- */
  function biquad(type, f0, gainDb, Q) {                    // RBJ audio EQ cookbook coefficients, normalised
    const A = Math.pow(10, gainDb / 40), w = 2 * Math.PI * f0 / sr, cs = Math.cos(w), sn = Math.sin(w), al = sn / (2 * Q), sq = 2 * Math.sqrt(A) * al;
    let b0, b1, b2, a0, a1, a2;
    if (type === 'lowshelf') { b0 = A * ((A + 1) - (A - 1) * cs + sq); b1 = 2 * A * ((A - 1) - (A + 1) * cs); b2 = A * ((A + 1) - (A - 1) * cs - sq); a0 = (A + 1) + (A - 1) * cs + sq; a1 = -2 * ((A - 1) + (A + 1) * cs); a2 = (A + 1) + (A - 1) * cs - sq; }
    else if (type === 'highshelf') { b0 = A * ((A + 1) + (A - 1) * cs + sq); b1 = -2 * A * ((A - 1) + (A + 1) * cs); b2 = A * ((A + 1) + (A - 1) * cs - sq); a0 = (A + 1) - (A - 1) * cs + sq; a1 = 2 * ((A - 1) - (A + 1) * cs); a2 = (A + 1) - (A - 1) * cs - sq; }
    else if (type === 'peaking') { b0 = 1 + al * A; b1 = -2 * cs; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cs; a2 = 1 - al / A; }
    else { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = (1 + cs) / 2; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }   // highpass
    return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
  }
  function runBiquad(x, a, b, co) {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = a; i < b; i++) { const v = x[i], y = co[0] * v + co[1] * x1 + co[2] * x2 - co[3] * y1 - co[4] * y2; x2 = x1; x1 = v; y2 = y1; y1 = y; x[i] = y; }
  }
  function stretchChans(arrs, ratio) {                       // WSOLA: change duration by ratio (out/in) without changing pitch
    const inLen = arrs[0].length, outLen = Math.max(1, Math.round(inLen * ratio)), N = 2048, Hs = N / 2, Ha = Hs / ratio, D = 384;
    if (inLen < N * 2) return arrs.map((c) => { const o = new Float32Array(outLen); for (let i = 0; i < outLen; i++) o[i] = c[Math.min(inLen - 1, Math.floor(i / ratio))]; return o; });
    const win = new Float32Array(N); for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
    const out = arrs.map(() => new Float32Array(outLen + N)), norm = new Float32Array(outLen + N);
    const m = new Float32Array(inLen); for (let i = 0; i < inLen; i++) { let v = 0; for (let c = 0; c < arrs.length; c++) v += arrs[c][i]; m[i] = v / arrs.length; }
    let prev = 0;                                             // input position of the previous chosen frame
    for (let k = 0, o = 0; o < outLen; k++, o += Hs) {
      let pos = Math.round(k * Ha);
      if (k > 0) {
        const want = prev + Hs; let best = -Infinity, bp = pos;
        for (let d = -D; d <= D; d += 2) {
          const p = pos + d; if (p < 0 || p + N > inLen || want + N > inLen) continue;
          let sc = 0; for (let i = 0; i < N; i += 8) sc += m[p + i] * m[want + i];
          if (sc > best) { best = sc; bp = p; }
        }
        pos = bp;
      }
      pos = Math.max(0, Math.min(inLen - N, pos)); prev = pos;
      for (let c = 0; c < arrs.length; c++) { const src = arrs[c], dst = out[c]; for (let i = 0; i < N; i++) dst[o + i] += src[pos + i] * win[i]; }
      for (let i = 0; i < N; i++) norm[o + i] += win[i];
    }
    return out.map((dst) => { const r = new Float32Array(outLen); for (let i = 0; i < outLen; i++) r[i] = norm[i] > 1e-3 ? dst[i] / norm[i] : 0; return r; });
  }
  function resampleTo(x, outLen, k) {                         // read x at step k with linear interpolation
    const r = new Float32Array(outLen), n = x.length;
    for (let i = 0; i < outLen; i++) { const p = i * k, i0 = Math.floor(p), f = p - i0; r[i] = (x[Math.min(i0, n - 1)] || 0) * (1 - f) + (x[Math.min(i0 + 1, n - 1)] || 0) * f; }
    return r;
  }
  function pitchShift(arrs, semis) {
    const p = Math.pow(2, semis / 12), inLen = arrs[0].length, st = stretchChans(arrs, p);
    return st.map((c) => resampleTo(c, inLen, p));
  }
  function gate(x, a, b, thrDb) {
    const thr = Math.pow(10, thrDb / 20), win = Math.max(1, Math.round(sr * 0.01)), floor = 0.03;
    const atk = 1 - Math.exp(-1 / (sr * 0.005)), rel = 1 - Math.exp(-1 / (sr * 0.08)), hold = Math.round(sr * 0.05);
    let e = 0, g = floor, h = 0;
    const k = 1 - Math.exp(-1 / win);
    for (let i = a; i < b; i++) {
      e += k * (x[i] * x[i] - e);
      if (Math.sqrt(e) > thr) h = hold; else if (h > 0) h--;
      const target = h > 0 ? 1 : floor;
      g += (target - g) * (target > g ? atk : rel);
      x[i] *= g;
    }
  }

  const ops = {
    trim() { const [a, b] = range(); chans = chans.map((c) => c.slice(a, b)); selStart = selEnd = 0; },
    cut() {
      if (!(selEnd > selStart)) return say('Select a part first.');
      const a = selStart, b = selEnd;
      chans = chans.map((c) => { const o = new Float32Array(c.length - (b - a)); o.set(c.subarray(0, a)); o.set(c.subarray(b), a); return o; });
      selStart = selEnd = 0;
    },
    silence() { const [a, b] = range(); chans.forEach((c) => c.fill(0, a, b)); },
    fadein() { const [a, b] = range(); chans.forEach((c) => { for (let i = a; i < b; i++) c[i] *= (i - a) / (b - a); }); },
    fadeout() { const [a, b] = range(); chans.forEach((c) => { for (let i = a; i < b; i++) c[i] *= 1 - (i - a) / (b - a); }); },
    reverse() { const [a, b] = range(); chans.forEach((c) => c.subarray(a, b).reverse()); },
    normalize() {
      const [a, b] = range(); let peak = 0;
      chans.forEach((c) => { for (let i = a; i < b; i++) peak = Math.max(peak, Math.abs(c[i])); });
      if (peak === 0) return say('Nothing to normalize (silence).');
      const k = 0.98 / peak; chans.forEach((c) => { for (let i = a; i < b; i++) c[i] *= k; });
    },
    gain() {
      const [a, b] = range(); const k = gainEl.value / 100;
      chans.forEach((c) => { for (let i = a; i < b; i++) c[i] = Math.max(-1, Math.min(1, c[i] * k)); });
    },
    speed() {
      const [a, b] = range(); const k = speedEl.value / 100;
      const outLen = Math.max(1, Math.round((b - a) / k));
      chans = chans.map((c) => {
        const seg = new Float32Array(outLen);
        for (let i = 0; i < outLen; i++) {
          const p = a + i * k, i0 = Math.floor(p), f = p - i0;
          seg[i] = c[i0] * (1 - f) + (c[Math.min(i0 + 1, b - 1)] || 0) * f;
        }
        const o = new Float32Array(c.length - (b - a) + outLen);
        o.set(c.subarray(0, a)); o.set(seg, a); o.set(c.subarray(b), a + outLen);
        return o;
      });
      selStart = selEnd = 0;
    },
    pitch() {
      const st = +$('pitch').value; if (!st) return say('Move the pitch slider first.');
      const [a, b] = range(), seg = pitchShift(chans.map((c) => c.slice(a, b)), st);
      chans = chans.map((c, ci) => { const o = c.slice(); o.set(seg[ci], a); return o; });
    },
    eq() {
      const lo = +$('eqlo').value, mid = +$('eqmid').value, hi = +$('eqhi').value; if (!lo && !mid && !hi) return say('Move an EQ slider first.');
      const [a, b] = range(), cos = [];
      if (lo) cos.push(biquad('lowshelf', 120, lo, 0.707)); if (mid) cos.push(biquad('peaking', 1000, mid, 0.9)); if (hi) cos.push(biquad('highshelf', 8000, hi, 0.707));
      chans.forEach((c) => cos.forEach((co) => runBiquad(c, a, b, co)));
      chans.forEach((c) => { for (let i = a; i < b; i++) c[i] = Math.max(-1, Math.min(1, c[i])); });
    },
    gate() { const [a, b] = range(); chans.forEach((c) => gate(c, a, b, +$('gate').value)); },
    rumble() { const [a, b] = range(), co = biquad('highpass', 80, 0, 0.707); chans.forEach((c) => { runBiquad(c, a, b, co); runBiquad(c, a, b, co); }); },
    selectall() { selStart = 0; selEnd = len(); return 'nosnap'; }
  };
  document.querySelectorAll('[data-op]').forEach((btn) => {
    btn.onclick = () => {
      if (!chans) return;
      const name = btn.dataset.op;
      if (name === 'selectall') { ops.selectall(); refresh(); return; }
      say('');
      snapshot();
      const before = history.length;
      const r = ops[name]();
      // if the op bailed out with a message, drop the snapshot
      if (statusEl.textContent && history.length === before) { history.pop(); }
      stop(); refresh();
    };
  });

  /* ---------- export WAV (16-bit PCM) ---------- */
  function wavBlob(arrs) {
    const nCh = arrs.length, n = arrs[0].length, bytes = n * nCh * 2;
    const buf = new ArrayBuffer(44 + bytes), v = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + bytes, true); w(8, 'WAVE'); w(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nCh, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * nCh * 2, true); v.setUint16(32, nCh * 2, true); v.setUint16(34, 16, true);
    w(36, 'data'); v.setUint32(40, bytes, true);
    let o = 44;
    for (let i = 0; i < n; i++) for (let c = 0; c < nCh; c++) {
      const s = Math.max(-1, Math.min(1, arrs[c][i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2;
    }
    return new Blob([buf], { type: 'audio/wav' });
  }
  function download(blob, name) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  $('export').onclick = () => chans && download(wavBlob(chans), 'govibe-edit.wav');
  $('exportmp3').onclick = () => {
    if (!chans) return;
    if (![48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000].includes(sr)) return say('MP3 does not support ' + sr + ' Hz. Use the Audio converter, which resamples for you.');
    say('Encoding MP3…'); $('exportmp3').disabled = true;
    const w = new Worker('js/convert-worker.js'), i16 = chans.map((c) => { const o = new Int16Array(c.length); for (let i = 0; i < c.length; i++) { const v = Math.max(-1, Math.min(1, c[i])); o[i] = v < 0 ? v * 32768 : v * 32767; } return o; });
    const done = () => { w.terminate(); $('exportmp3').disabled = false; };
    w.onmessage = (e) => { if (e.data.done) { download(e.data.done, 'govibe-edit.mp3'); say('MP3 downloaded.'); done(); } else if (e.data.error) { say('MP3 failed: ' + e.data.error); done(); } };
    w.onerror = () => { say('The MP3 encoder could not start.'); done(); };
    w.postMessage({ ch: i16.slice(0, 2), rate: sr, kbps: 192 }, i16.map((a) => a.buffer));
  };
  $('exportsel').onclick = () => {
    if (!chans) return;
    if (!(selEnd > selStart)) return say('Select a part first.');
    download(wavBlob(chans.map((c) => c.slice(selStart, selEnd))), 'govibe-selection.wav');
  };

  /* ---------- keyboard ---------- */
  window.addEventListener('keydown', (e) => {
    if (!chans || /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    if (e.code === 'Space') { e.preventDefault(); $('play').click(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  });

  // test hook: only exposed when the page URL contains ?gvtest
  if (/[?&]gvtest\b/.test(location.search)) window.__gv = { loadBuffers: (c, rate) => { chans = c; sr = rate; history = []; future = []; selStart = selEnd = 0; editor.classList.remove('hidden'); drop.classList.add('hidden'); refresh(); }, ops, get chans() { return chans; }, set sel(v) { selStart = v[0]; selEnd = v[1]; }, wavBlob };
})();
