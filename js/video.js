/* GoVibe Mix — basic in-browser video editor.
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
  const prevCv = document.createElement('canvas'), pg2 = prevCv.getContext('2d'); let havePrev = false, prevFor = -1, ovolv = 1;
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
    clips.push({ name: file.name, url, v, dur: v.duration, in: 0, out: v.duration, fi: 0, fo: 0, trans: 'cut', tdur: 0.6 });
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
  /* Video layer with per clip fades and the transition into this clip. The last frame of the previous clip is kept in prevCv. */
  function fit(c, x, y) { const [W, H] = ASPECT[aspect], s = Math.min(W / c.v.videoWidth, H / c.v.videoHeight), w = c.v.videoWidth * s, h = c.v.videoHeight * s; g.drawImage(c.v, (W - w) / 2 + (x || 0), (H - h) / 2 + (y || 0), w, h); }
  function clipLevels(c, i) {
    const tin = Math.max(0, c.v.currentTime - c.in), tleft = Math.max(0, c.out - c.v.currentTime); let a = 1;
    if (c.fi > 0 && tin < c.fi) a = Math.min(a, tin / c.fi); if (c.fo > 0 && tleft < c.fo) a = Math.min(a, tleft / c.fo);
    let p = 1; const tr = i > 0 && c.trans !== 'cut' && c.tdur > 0 && tin < c.tdur; if (tr) p = tin / c.tdur;
    return { tin, tleft, a, p, tr };
  }
  function draw() {
    const [W, H] = ASPECT[aspect];
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; havePrev = false; }
    g.globalAlpha = 1; g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    const c = clips[active]; let audio = 1;
    if (c && c.v.videoWidth) {
      const L = clipLevels(c, active); audio = L.a;
      const usePrev = L.tr && havePrev && prevFor === active - 1 && prevCv.width === W && prevCv.height === H, p = L.p;
      if (L.tr && !usePrev) { g.globalAlpha = Math.min(L.a, p); fit(c); audio = Math.min(audio, p); }
      else if (L.tr && c.trans === 'fade') { g.drawImage(prevCv, 0, 0); g.globalAlpha = Math.min(L.a, p); fit(c); audio = Math.min(audio, p); }
      else if (L.tr && c.trans === 'dip') { if (p < 0.5) { g.globalAlpha = 1 - p * 2; g.drawImage(prevCv, 0, 0); audio = 0; } else { g.globalAlpha = Math.min(L.a, p * 2 - 1); fit(c); audio = Math.min(audio, p * 2 - 1); } }
      else if (L.tr && c.trans === 'wipe') { g.drawImage(prevCv, 0, 0); g.save(); g.beginPath(); g.rect(0, 0, W * p, H); g.clip(); g.globalAlpha = L.a; fit(c); g.restore(); audio = Math.min(audio, 0.3 + 0.7 * p); }
      else if (L.tr && c.trans === 'slide') { g.drawImage(prevCv, -W * p, 0); g.globalAlpha = L.a; fit(c, W * (1 - p), 0); audio = Math.min(audio, 0.3 + 0.7 * p); }
      else { g.globalAlpha = L.a; fit(c); }
      g.globalAlpha = 1;
      /* keep the last frame of this clip for the next transition */
      if (active < clips.length - 1 && L.tleft < 0.2) { if (prevCv.width !== W || prevCv.height !== H) { prevCv.width = W; prevCv.height = H; } pg2.drawImage(cv, 0, 0); havePrev = true; prevFor = active; }
    }
    origGain.gain.value = ovolv * audio;
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
      const fx = document.createElement('div'); fx.className = 'mini'; fx.style.marginTop = '8px';
      fx.innerHTML = '<label class="ctl">Fade in (s)<input type="number" class="fi" step="0.1" min="0" max="5"></label><label class="ctl">Fade out (s)<input type="number" class="fo" step="0.1" min="0" max="5"></label>' + (i > 0 ? '<label class="ctl">Transition in<select class="tr"><option value="cut">Cut</option><option value="fade">Crossfade</option><option value="dip">Dip to black</option><option value="wipe">Wipe</option><option value="slide">Slide</option></select></label><label class="ctl">Length (s)<input type="number" class="td" step="0.1" min="0.1" max="3"></label>' : '');
      const fi = fx.querySelector('.fi'), fo = fx.querySelector('.fo'), tr = fx.querySelector('.tr'), td = fx.querySelector('.td');
      fi.value = c.fi; fo.value = c.fo; fi.onchange = () => { c.fi = clamp(+fi.value || 0, 0, Math.min(5, len(c) / 2)); fi.value = c.fi; }; fo.onchange = () => { c.fo = clamp(+fo.value || 0, 0, Math.min(5, len(c) / 2)); fo.value = c.fo; };
      if (tr) { tr.value = c.trans; td.value = c.tdur; tr.onchange = () => { c.trans = tr.value; }; td.onchange = () => { c.tdur = clamp(+td.value || 0.6, 0.1, Math.min(3, len(c))); td.value = c.tdur; }; }
      d.appendChild(fx); list.appendChild(d);
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
  $('ovol').oninput = () => { ovolv = $('ovol').value / 100; };

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

  if (/[?&]gvtest\b/.test(location.search)) window.__ve = { addFile, loadMusic, exportVideo, seek, play, pause, ctx, get state() { return { clips: clips.map((c) => ({ dur: c.dur, in: c.in, out: c.out, fi: c.fi, fo: c.fo, trans: c.trans })), texts: texts.length, tl, total: total(), playing }; } };
})();
