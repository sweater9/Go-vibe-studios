/* Go Vibe Studios — basic in-browser video editor.
 * Clips are played into a canvas; export records canvas + mixed audio in real time with MediaRecorder. */
(() => {
  const $ = (id) => document.getElementById(id);
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  const cv = $('cv'), g = cv.getContext('2d');
  const ASPECT = { '16:9': [1280, 720], '9:16': [720, 1280], '1:1': [720, 720] };
  const fmt = (s) => { s = Math.max(0, s || 0); const m = Math.floor(s / 60); return m + ':' + (s - m * 60).toFixed(1).padStart(4, '0'); };
  const say = (t) => { $('status').textContent = t; };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  let clips = [], texts = [], music = null;
  let tl = 0, playing = false, active = -1, aspect = '16:9';
  let exporting = false, exportDone = null, exportCancelled = false, scrubbing = false;

  /* ---------- audio graph: clips + music -> bus -> (speakers, recorder) ---------- */
  const bus = ctx.createGain(), spk = ctx.createGain(), recDest = ctx.createMediaStreamDestination();
  const origGain = ctx.createGain(), musicGain = ctx.createGain();
  origGain.connect(bus); musicGain.connect(bus); bus.connect(spk); spk.connect(ctx.destination); bus.connect(recDest);
  musicGain.gain.value = 0.7;

  /* ---------- timeline helpers ---------- */
  const len = (c) => Math.max(0, c.out - c.in);
  const total = () => clips.reduce((s, c) => s + len(c), 0);
  const startOf = (i) => clips.slice(0, i).reduce((s, c) => s + len(c), 0);
  function locate(t) {
    let acc = 0;
    for (let i = 0; i < clips.length; i++) {
      const l = len(clips[i]);
      if (t < acc + l || i === clips.length - 1) return { i, off: clamp(t - acc, 0, l) };
      acc += l;
    }
    return null;
  }

  /* ---------- adding clips ---------- */
  function fixDuration(v) {   // MediaRecorder files often report an infinite duration until the end is reached
    return new Promise((res) => {
      const done = () => { v.ontimeupdate = null; v.currentTime = 0; res(); };
      v.ontimeupdate = done; v.currentTime = 1e101; setTimeout(done, 3000);
    });
  }
  async function addFile(file) {
    const url = URL.createObjectURL(file), v = document.createElement('video');
    v.src = url; v.preload = 'auto'; v.playsInline = true; $('vids').appendChild(v);
    try {
      await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error('bad')); });
      if (!isFinite(v.duration)) await fixDuration(v);
      if (!isFinite(v.duration) || v.duration <= 0) throw new Error('bad');
    } catch (_) { v.remove(); URL.revokeObjectURL(url); say('Could not read "' + file.name + '". Try MP4 (H.264) or WebM.'); return; }
    ctx.createMediaElementSource(v).connect(origGain);
    clips.push({ name: file.name, url, v, dur: v.duration, in: 0, out: v.duration });
    if (active < 0) activate(0, 0, false);
    refresh(); say('Added ' + file.name + '.');
  }
  $('addclip').onclick = () => $('clipfile').click();
  $('clipfile').onchange = async () => { for (const f of [...$('clipfile').files]) await addFile(f); $('clipfile').value = ''; };

  /* ---------- playback ---------- */
  function activate(i, off, shouldPlay) {
    clips.forEach((c, k) => { if (k !== i) c.v.pause(); });
    active = i; const c = clips[i]; c.v.currentTime = c.in + off;
    if (shouldPlay) { ctx.resume(); c.v.play().catch(() => {}); }
  }
  function startMusic(at) {
    stopMusic(); if (!music || at >= music.buf.duration) return;
    const s = ctx.createBufferSource(); s.buffer = music.buf; s.connect(musicGain); s.start(0, at); music.src = s;
  }
  function stopMusic() { if (music && music.src) { try { music.src.stop(); } catch (_) {} music.src.disconnect(); music.src = null; } }
  function play() {
    if (!clips.length || playing) return;
    if (tl >= total() - 0.05) tl = 0;
    const loc = locate(tl); activate(loc.i, loc.off, true); startMusic(tl);
    playing = true; $('play').textContent = '❚❚ Pause';
  }
  function pause() { playing = false; clips.forEach((c) => c.v.pause()); stopMusic(); $('play').textContent = '▶ Play'; }
  function seek(t) {
    if (!clips.length) return; tl = clamp(t, 0, total());
    const loc = locate(tl); activate(loc.i, loc.off, playing); if (playing) startMusic(tl);
  }
  function finish() {
    pause(); tl = total();
    if (exporting && exportDone) exportDone();
  }
  $('play').onclick = () => (playing ? pause() : play());
  $('tostart').onclick = () => seek(0);
  $('scrub').addEventListener('pointerdown', () => (scrubbing = true));
  $('scrub').addEventListener('pointerup', () => (scrubbing = false));
  $('scrub').oninput = () => seek($('scrub').value / 1000 * total());

  /* ---------- drawing ---------- */
  function drawText(t) {
    const [W, H] = ASPECT[aspect], lines = t.text.split('\n'), lh = t.size * 1.2;
    g.font = '700 ' + t.size + 'px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = Math.max(2, t.size / 12); g.strokeStyle = '#000'; g.fillStyle = t.color; g.lineJoin = 'round';
    const block = lh * lines.length, y0 = t.pos === 'top' ? H * 0.12 : t.pos === 'middle' ? H / 2 - block / 2 + lh / 2 : H * 0.88 - block + lh / 2;
    lines.forEach((ln, k) => { g.strokeText(ln, W / 2, y0 + k * lh, W * 0.92); g.fillText(ln, W / 2, y0 + k * lh, W * 0.92); });
  }
  function draw() {
    const [W, H] = ASPECT[aspect];
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    const c = clips[active];
    if (c && c.v.videoWidth) {
      const s = Math.min(W / c.v.videoWidth, H / c.v.videoHeight), w = c.v.videoWidth * s, h = c.v.videoHeight * s;
      g.drawImage(c.v, (W - w) / 2, (H - h) / 2, w, h);
    }
    texts.forEach((t) => { if (tl >= t.start && tl <= t.end) drawText(t); });
  }
  (function frame() {
    if (playing && clips[active]) {
      const c = clips[active];
      tl = startOf(active) + (c.v.currentTime - c.in);
      if (c.v.currentTime >= c.out - 0.03 || c.v.ended) {
        if (active < clips.length - 1) activate(active + 1, 0, true); else finish();
      }
    }
    draw();
    const T = total();
    $('clock').textContent = fmt(tl) + ' / ' + fmt(T);
    if (!scrubbing && T > 0) $('scrub').value = Math.round(tl / T * 1000);
    requestAnimationFrame(frame);
  })();

  /* ---------- UI lists ---------- */
  function refresh() {
    const has = clips.length > 0;
    ['play', 'tostart', 'scrub', 'export'].forEach((k) => ($(k).disabled = !has || exporting));
    const list = $('cliplist'); list.innerHTML = '';
    clips.forEach((c, i) => {
      const d = document.createElement('div'); d.className = 'clip';
      d.innerHTML = '<div class="nm"></div><div class="mini"><label class="ctl">In (s)<input type="number" step="0.1" min="0"></label><label class="ctl">Out (s)<input type="number" step="0.1" min="0"></label><label class="ctl">Length<b class="time"></b></label></div><div class="row" style="margin-top:8px"><button class="btn sm" data-a="up">↑</button><button class="btn sm" data-a="down">↓</button><button class="btn sm danger" data-a="del">Remove</button></div>';
      d.querySelector('.nm').textContent = (i + 1) + '. ' + c.name + ' (' + fmt(c.dur) + ')';
      const [inp, outp] = d.querySelectorAll('input'), lenEl = d.querySelector('b');
      inp.value = c.in.toFixed(1); outp.value = c.out.toFixed(1); lenEl.textContent = fmt(len(c));
      inp.onchange = () => { c.in = clamp(+inp.value || 0, 0, c.out - 0.2); refresh(); seek(Math.min(tl, total())); };
      outp.onchange = () => { c.out = clamp(+outp.value || c.dur, c.in + 0.2, c.dur); refresh(); seek(Math.min(tl, total())); };
      d.querySelectorAll('[data-a]').forEach((b) => (b.onclick = () => {
        const a = b.dataset.a, was = clips[active];
        if (a === 'up' && i > 0) [clips[i - 1], clips[i]] = [clips[i], clips[i - 1]];
        if (a === 'down' && i < clips.length - 1) [clips[i + 1], clips[i]] = [clips[i], clips[i + 1]];
        if (a === 'del') { pause(); c.v.remove(); URL.revokeObjectURL(c.url); clips.splice(i, 1); }
        active = clips.indexOf(was); if (active < 0) { active = clips.length ? 0 : -1; tl = 0; if (active >= 0) activate(0, 0, false); }
        refresh(); if (clips.length) seek(Math.min(tl, total()));
      }));
      list.appendChild(d);
    });
    const tl2 = $('textlist'); tl2.innerHTML = '';
    texts.forEach((t, i) => {
      const d = document.createElement('div'); d.className = 'clip';
      d.innerHTML = '<div class="nm"></div><button class="btn sm danger">Remove</button>';
      d.querySelector('.nm').textContent = '“' + t.text.replace(/\n/g, ' ') + '” ' + t.start.toFixed(1) + '–' + t.end.toFixed(1) + 's, ' + t.pos;
      d.querySelector('button').onclick = () => { texts.splice(i, 1); refresh(); };
      tl2.appendChild(d);
    });
  }

  $('tadd').onclick = () => {
    const text = $('ttext').value.trim(); if (!text) return say('Type the text first.');
    const start = Math.max(0, +$('tstart').value || 0), end = Math.max(start + 0.1, +$('tend').value || start + 3);
    texts.push({ text, start, end, pos: $('tpos').value, size: clamp(+$('tsize').value || 64, 16, 300), color: $('tcolor').value });
    $('ttext').value = ''; refresh();
  };
  $('aspect').onchange = () => { aspect = $('aspect').value; };

  /* ---------- music ---------- */
  $('addmusic').onclick = () => $('musicfile').click();
  async function loadMusic(file) {
    try { const buf = await ctx.decodeAudioData(await file.arrayBuffer()); stopMusic(); music = { buf, src: null }; $('mname').textContent = file.name; if (playing) startMusic(tl); }
    catch (_) { say('Could not read that audio file.'); }
  }
  $('musicfile').onchange = () => $('musicfile').files[0] && loadMusic($('musicfile').files[0]);
  $('mvol').oninput = () => (musicGain.gain.value = $('mvol').value / 100);
  $('ovol').oninput = () => (origGain.gain.value = $('ovol').value / 100);

  /* ---------- export (real time) ---------- */
  const TYPES = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  async function exportVideo() {
    if (!clips.length || exporting) return null;
    if (!window.MediaRecorder || !cv.captureStream) { say('This browser cannot record video. Try Chrome, Edge or Firefox.'); return null; }
    pause();
    const mime = TYPES.find((t) => MediaRecorder.isTypeSupported(t)), T = total();
    const stream = cv.captureStream(30); recDest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 5e6 } : undefined), chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const stopped = new Promise((r) => (rec.onstop = r));
    exporting = true; exportCancelled = false; spk.gain.value = 0; refresh();
    $('cancel').classList.remove('hidden'); $('dl').classList.add('hidden');
    const ended = new Promise((r) => (exportDone = r));
    seek(0); rec.start(250); play();
    const prog = setInterval(() => say('Exporting… ' + Math.min(99, Math.round(tl / T * 100)) + '% (keep this tab open)'), 400);
    await ended; await new Promise((r) => setTimeout(r, 120));
    clearInterval(prog); rec.stop(); await stopped;
    exporting = false; exportDone = null; spk.gain.value = 1; $('cancel').classList.add('hidden'); refresh();
    if (exportCancelled) { say('Export cancelled.'); return null; }
    const type = rec.mimeType || mime || 'video/webm', blob = new Blob(chunks, { type }), ext = /mp4/.test(type) ? 'mp4' : 'webm';
    const a = $('dl'); a.href = URL.createObjectURL(blob); a.download = 'govibe-video.' + ext; a.classList.remove('hidden');
    say('Done: ' + ext.toUpperCase() + ', ' + (blob.size / 1048576).toFixed(1) + ' MB. Use Download.');
    return blob;
  }
  $('export').onclick = exportVideo;
  $('cancel').onclick = () => { exportCancelled = true; finish(); };

  window.__ve = { addFile, loadMusic, exportVideo, seek, play, pause, ctx, get state() { return { clips: clips.map((c) => ({ dur: c.dur, in: c.in, out: c.out })), texts: texts.length, tl, total: total(), playing }; } };
})();
