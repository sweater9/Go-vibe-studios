/* GoVibe Mix — in-browser video editor.
 * Clips are played into a canvas; export records canvas + mixed audio with MediaRecorder.
 * Per clip: trim, speed and speed ramp, colour grade, zoom and pan, green screen, stabilise, fades and transitions.
 * Project: text and subtitle layers (SRT and VTT in, SRT out), a music track with ducking, screen recording. Nothing leaves the device. */
(() => {
  const $ = (id) => document.getElementById(id);
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  const cv = $('cv'), g = cv.getContext('2d', { willReadFrequently: false });
  const ASPECT = { '16:9': [1280, 720], '9:16': [720, 1280], '1:1': [720, 720] };
  const fmt = (s) => { s = Math.max(0, s || 0); const m = Math.floor(s / 60); return m + ':' + (s - m * 60).toFixed(1).padStart(4, '0'); };
  const say = (t) => { $('status').textContent = t; };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, p) => a + (b - a) * p;
  const hasFilter = 'filter' in g;

  let clips = [], texts = [], music = null, bgImg = null, overlays = [], voices = [], drawings = [];
  let tl = 0, playing = false, active = -1, aspect = '16:9', outScale = 1;
  const prevCv = document.createElement('canvas'), pg2 = prevCv.getContext('2d'); let havePrev = false, prevFor = -1, ovolv = 1;
  const keyCv = document.createElement('canvas'), kg = keyCv.getContext('2d', { willReadFrequently: true });
  let exporting = false, exportDone = null, exportCancelled = false, scrubbing = false, busyStab = false;
  const dims = () => { const [w, h] = ASPECT[aspect]; return [Math.round(w * outScale / 2) * 2, Math.round(h * outScale / 2) * 2]; };

  /* ---------- audio graph: clips + music -> bus -> (speakers, recorder) ---------- */
  const bus = ctx.createGain(), spk = ctx.createGain(), recDest = ctx.createMediaStreamDestination();
  const origGain = ctx.createGain(), musicGain = ctx.createGain(), musicDuck = ctx.createGain(), anOrig = ctx.createAnalyser();
  anOrig.fftSize = 1024; const anBuf = new Float32Array(1024);
  origGain.connect(bus); origGain.connect(anOrig); musicDuck.connect(musicGain); musicGain.connect(bus); bus.connect(spk); spk.connect(ctx.destination); bus.connect(recDest);
  const voiceGain = ctx.createGain(); voiceGain.connect(bus); voiceGain.gain.value = 1;
  musicGain.gain.value = 0.7;

  /* ---------- clip model ---------- */
  const newClip = (name, url, v, file) => ({
    name, url, v, file, dur: v.duration, in: 0, out: v.duration, fi: 0, fo: 0, trans: 'cut', tdur: 0.6,
    speed: 1, speed2: 1,
    grade: { b: 100, c: 100, s: 100, h: 0, sep: 0 },
    zoom: { s1: 100, s2: 100, x1: 0, x2: 0, y1: 0, y2: 0 },
    key: { on: false, color: '#00b140', tol: 40, soft: 15, bg: '#000000' },
    xf: { rot: 0, fh: false, fv: false, cl: 0, ct: 0, cr: 0, cb: 0 },
    vol: 1, mute: false, gain: null, cgain: null, clean: null, csrc: null, sil: { th: -42, min: 0.6 },
    stab: null, stabOn: false, open: {}
  });
  const applyVol = (c) => { if (c.gain) c.gain.gain.value = c.mute || c.clean ? 0 : c.vol; if (c.cgain) c.cgain.gain.value = c.mute ? 0 : c.vol; };
  /* a clip with cleaned sound plays the cleaned copy instead of the video's own sound; both are tied to the same source time */
  function stopClean(c) { if (c.csrc) { try { c.csrc.stop(); } catch (_) {} c.csrc.disconnect(); c.csrc = null; } }
  function startClean(c, srcTime, rate) { stopClean(c); if (!c.clean || srcTime >= c.clean.duration) return; const sn = ctx.createBufferSource(); sn.buffer = c.clean; sn.playbackRate.value = rate; sn.connect(c.cgain); sn.start(0, srcTime); c.csrc = sn; }
  /* speed is a straight line from `speed` at the start of the trimmed part to `speed2` at its end (equal values mean a constant speed) */
  function lenOf(c) {
    const L = Math.max(0, c.out - c.in); if (!L) return 0;
    const s1 = c.speed, s2 = c.speed2; if (Math.abs(s2 - s1) < 1e-6) return L / s1;
    return L * Math.log(s2 / s1) / (s2 - s1);
  }
  const len = lenOf;
  function srcAt(c, t) {       // seconds of source after t seconds of timeline
    const s1 = c.speed, s2 = c.speed2, L = Math.max(1e-6, c.out - c.in); if (Math.abs(s2 - s1) < 1e-6) return t * s1;
    const k = (s2 - s1) / L; return s1 * (Math.exp(k * t) - 1) / k;
  }
  function tAt(c, u) {         // seconds of timeline after u seconds of source
    const s1 = c.speed, s2 = c.speed2, L = Math.max(1e-6, c.out - c.in); if (Math.abs(s2 - s1) < 1e-6) return u / s1;
    const k = (s2 - s1) / L; return Math.log(Math.max(1e-9, (s1 + k * u) / s1)) / k;
  }
  function speedAt(c, u) { const L = Math.max(1e-6, c.out - c.in); return lerp(c.speed, c.speed2, clamp(u / L, 0, 1)); }
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
    const gn = ctx.createGain(); ctx.createMediaElementSource(v).connect(gn); gn.connect(origGain);
    const nc = newClip(file.name, url, v, file); nc.gain = gn; nc.cgain = ctx.createGain(); nc.cgain.connect(origGain); clips.push(nc);
    if (active < 0) activate(0, 0, false);
    refresh(); say('Added ' + file.name + '.');
  }
  $('addclip').onclick = () => $('clipfile').click();
  $('clipfile').onchange = async () => { for (const f of [...$('clipfile').files]) await addFile(f); $('clipfile').value = ''; };

  /* ---------- playback ---------- */
  function activate(i, off, shouldPlay) {
    clips.forEach((c, k) => { if (k !== i) c.v.pause(); stopClean(c); });
    active = i; const c = clips[i], u = srcAt(c, off); c.v.currentTime = c.in + u; c.v.playbackRate = clamp(speedAt(c, u), 0.25, 4);
    if (shouldPlay) { ctx.resume(); c.v.play().catch(() => {}); startClean(c, c.in + u, clamp(speedAt(c, u), 0.25, 4)); }
  }
  function startMusic(at) {
    stopMusic(); if (!music || at >= music.buf.duration) return;
    const s = ctx.createBufferSource(); s.buffer = music.buf; s.connect(musicDuck); s.start(0, at); music.src = s;
  }
  function startVoices(at) {
    stopVoices();
    voices.forEach((v) => {
      const end = v.start + v.buf.duration; if (at >= end) return;
      const s = ctx.createBufferSource(); s.buffer = v.buf; s.connect(voiceGain); const lead = Math.max(0, v.start - at); s.start(ctx.currentTime + lead, Math.max(0, at - v.start)); v.src = s;
    });
  }
  function stopVoices() { voices.forEach((v) => { if (v.src) { try { v.src.stop(); } catch (_) {} v.src.disconnect(); v.src = null; } }); }
  function stopMusic() { if (music && music.src) { try { music.src.stop(); } catch (_) {} music.src.disconnect(); music.src = null; } }
  function play() {
    if (!clips.length || playing) return;
    if (tl >= total() - 0.05) tl = 0;
    const loc = locate(tl); activate(loc.i, loc.off, true); startMusic(tl); startVoices(tl);
    playing = true; $('play').textContent = '❚❚ Pause';
  }
  function pause() { playing = false; clips.forEach((c) => { c.v.pause(); stopClean(c); }); stopMusic(); stopVoices(); $('play').textContent = '▶ Play'; }
  function seek(t) {
    if (!clips.length) return; tl = clamp(t, 0, total());
    const loc = locate(tl); activate(loc.i, loc.off, playing); if (playing) { startMusic(tl); startVoices(tl); }
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

  /* ---------- drawing: text ---------- */
  const FONTS = { sans: 'system-ui, sans-serif', serif: 'Georgia, "Times New Roman", serif', mono: 'ui-monospace, Menlo, Consolas, monospace', bold: 'Impact, "Arial Black", system-ui, sans-serif' };
  function drawText(t) {
    const [W, H] = dims(), k = W / ASPECT[aspect][0], size = t.size * k, lines = String(t.text).split('\n'), lh = size * 1.2;
    const lt = tl - t.start, al = Math.max(0.1, t.alen || 0.5), inP = clamp(lt / al, 0, 1), outP = clamp((t.end - tl) / al, 0, 1);
    let alpha = 1, dy = 0, shown = lines;
    if (t.anim === 'fade') alpha = Math.min(inP, outP);
    else if (t.anim === 'rise') { alpha = Math.min(inP, outP); dy = (1 - inP) * H * 0.05; }
    else if (t.anim === 'type') {
      const all = lines.join('\n'), n = Math.ceil(all.length * clamp(lt / Math.max(0.2, al * 2), 0, 1)); shown = all.slice(0, n).split('\n');
    }
    g.save(); g.globalAlpha = alpha; g.filter = 'none';
    g.font = '700 ' + size + 'px ' + (FONTS[t.font] || FONTS.sans); g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    const block = lh * lines.length, y0 = (t.pos === 'top' ? H * 0.12 : t.pos === 'middle' ? H / 2 - block / 2 + lh / 2 : H * 0.88 - block + lh / 2) + dy;
    if (t.style === 'box') {
      const w = Math.min(W * 0.96, Math.max(...lines.map((l) => g.measureText(l).width)) + size * 0.8);
      g.fillStyle = 'rgba(0,0,0,0.62)'; const x = (W - w) / 2, y = y0 - lh / 2 - size * 0.12, h = block + size * 0.24, r = size * 0.25;
      g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); g.fill();
    }
    g.fillStyle = t.color;
    if (t.style === 'shadow') { g.shadowColor = 'rgba(0,0,0,0.85)'; g.shadowBlur = size * 0.2; g.shadowOffsetY = size * 0.05; }
    shown.forEach((ln, i) => {
      if (!t.style || t.style === 'outline') { g.lineWidth = Math.max(2, size / 12); g.strokeStyle = '#000'; g.strokeText(ln, W / 2, y0 + i * lh, W * 0.92); }
      g.fillText(ln, W / 2, y0 + i * lh, W * 0.92);
    });
    g.restore();
  }

  /* ---------- drawing: video layers ---------- */
  const filterOf = (gr) => (gr.b === 100 && gr.c === 100 && gr.s === 100 && !gr.h && !gr.sep) ? 'none' : 'brightness(' + gr.b + '%) contrast(' + gr.c + '%) saturate(' + gr.s + '%) hue-rotate(' + gr.h + 'deg) sepia(' + gr.sep + '%)';
  const STAB_FPS = 10, STAB_ZOOM = 1.1;
  function stabOffset(c) {     // [x, y] as fractions of the drawn width and height
    if (!c.stabOn || !c.stab) return [0, 0];
    const f = clamp((c.v.currentTime - c.in) * STAB_FPS, 0, c.stab.dx.length - 1), i = Math.floor(f), j = Math.min(c.stab.dx.length - 1, i + 1), p = f - i;
    return [lerp(c.stab.dx[i], c.stab.dx[j], p), lerp(c.stab.dy[i], c.stab.dy[j], p)];
  }
  /* draw the clip onto target context t, with grade, zoom and pan, and stabilisation */
  function fit(c, x, y, t, prog) {
    t = t || g; const [W, H] = dims(), vw = c.v.videoWidth, vh = c.v.videoHeight, X = c.xf;
    const sx = vw * X.cl / 100, sy = vh * X.ct / 100, sw = Math.max(2, vw * (1 - (X.cl + X.cr) / 100)), sh = Math.max(2, vh * (1 - (X.ct + X.cb) / 100));
    const turn = X.rot === 90 || X.rot === 270, lw = turn ? sh : sw, lh = turn ? sw : sh, s0 = Math.min(W / lw, H / lh);
    const p = prog == null ? 0 : prog, z = c.zoom, sc = lerp(z.s1, z.s2, p) / 100 * (c.stabOn && c.stab ? STAB_ZOOM : 1);
    const w = lw * s0 * sc, h = lh * s0 * sc, st = stabOffset(c);
    const cx = (W - w) / 2 + (x || 0) + lerp(z.x1, z.x2, p) / 100 * W + st[0] * w, cy = (H - h) / 2 + (y || 0) + lerp(z.y1, z.y2, p) / 100 * H + st[1] * h;
    if (hasFilter) t.filter = filterOf(c.grade);
    if (!X.rot && !X.fh && !X.fv) t.drawImage(c.v, sx, sy, sw, sh, cx, cy, w, h);
    else {
      t.save(); t.translate(cx + w / 2, cy + h / 2); t.scale(X.fh ? -1 : 1, X.fv ? -1 : 1); t.rotate(X.rot * Math.PI / 180);
      const dw = turn ? h : w, dh = turn ? w : h; t.drawImage(c.v, sx, sy, sw, sh, -dw / 2, -dh / 2, dw, dh); t.restore();
    }
    if (hasFilter) t.filter = 'none';
  }
  /* remove the key colour: alpha from the distance in chroma (Cb, Cr), plus a gentle despill on the dominant channel */
  function keyPixels(data, key) {
    const hx = key.color, kr = parseInt(hx.slice(1, 3), 16), kgc = parseInt(hx.slice(3, 5), 16), kb = parseInt(hx.slice(5, 7), 16);
    const kcb = -0.1687 * kr - 0.3313 * kgc + 0.5 * kb, kcr = 0.5 * kr - 0.4187 * kgc - 0.0813 * kb;
    const t0 = key.tol / 100 * 0.5 * 255, t1 = t0 + Math.max(0.5, key.soft / 100 * 0.4 * 255);
    const dom = kgc >= kr && kgc >= kb ? 1 : kb >= kr && kb >= kgc ? 2 : 0, strong = Math.max(kr, kgc, kb) - Math.min(kr, kgc, kb) > 60;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], gg = data[i + 1], b = data[i + 2];
      const cb = -0.1687 * r - 0.3313 * gg + 0.5 * b, cr = 0.5 * r - 0.4187 * gg - 0.0813 * b, d = Math.hypot(cb - kcb, cr - kcr);
      const a = d <= t0 ? 0 : d >= t1 ? 1 : (d - t0) / (t1 - t0);
      data[i + 3] = Math.round(data[i + 3] * a);
      if (strong && a > 0) {
        const o1 = dom === 0 ? gg : dom === 1 ? r : r, o2 = dom === 0 ? b : dom === 1 ? b : gg, cur = data[i + dom], spill = cur - Math.max(o1, o2);
        if (spill > 0) data[i + dom] = cur - spill * 0.8 * (1 - a * 0.5);
      }
    }
  }
  function layer(c, x, y, prog) {
    if (!c.key.on) return fit(c, x, y, g, prog);
    const [W, H] = dims();
    if (keyCv.width !== W || keyCv.height !== H) { keyCv.width = W; keyCv.height = H; }
    kg.clearRect(0, 0, W, H); fit(c, x, y, kg, prog);
    const im = kg.getImageData(0, 0, W, H); keyPixels(im.data, c.key); kg.putImageData(im, 0, 0);
    if (bgImg) { const s = Math.max(W / bgImg.width, H / bgImg.height); g.drawImage(bgImg, (W - bgImg.width * s) / 2, (H - bgImg.height * s) / 2, bgImg.width * s, bgImg.height * s); }
    else { g.fillStyle = c.key.bg; g.fillRect(0, 0, W, H); }
    g.drawImage(keyCv, 0, 0);
  }
  function levelsAt(c, i, tin, T) {         // fades and transition progress at tin seconds into the clip's slot on the timeline
    const tleft = Math.max(0, T - tin); let a = 1;
    if (c.fi > 0 && tin < c.fi) a = Math.min(a, tin / c.fi); if (c.fo > 0 && tleft < c.fo) a = Math.min(a, tleft / c.fo);
    let p = 1; const tr = i > 0 && c.trans !== 'cut' && c.tdur > 0 && tin < c.tdur; if (tr) p = tin / c.tdur;
    return { tin, tleft, a, p, tr, prog: T > 0 ? tin / T : 0 };
  }
  function clipLevels(c, i) { const u = Math.max(0, c.v.currentTime - c.in), T = len(c); return levelsAt(c, i, Math.min(T, tAt(c, u)), T); }
  function audioOf(c, L) {                  // the sound level that goes with a picture state (the same rules draw() uses)
    let au = L.a; if (!L.tr) return au;
    if (c.trans === 'fade') return Math.min(au, L.p);
    if (c.trans === 'dip') return L.p < 0.5 ? 0 : Math.min(au, L.p * 2 - 1);
    return Math.min(au, 0.3 + 0.7 * L.p);
  }
  function drawStroke(d) {
    const [W, H] = dims(), P = d.pts.map(([x, y]) => [x / 100 * W, y / 100 * H]); if (P.length < 2) return;
    g.save(); g.globalAlpha = 1; g.filter = 'none'; g.strokeStyle = d.color; g.fillStyle = d.color; g.lineWidth = Math.max(1, d.w * W / 1280); g.lineCap = 'round'; g.lineJoin = 'round';
    const a = P[0], b = P[P.length - 1];
    if (d.tool === 'pen') { g.beginPath(); g.moveTo(a[0], a[1]); P.slice(1).forEach((q) => g.lineTo(q[0], q[1])); g.stroke(); }
    else if (d.tool === 'box') g.strokeRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
    else if (d.tool === 'circle') { g.beginPath(); g.ellipse((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.max(1, Math.abs(b[0] - a[0]) / 2), Math.max(1, Math.abs(b[1] - a[1]) / 2), 0, 0, Math.PI * 2); g.stroke(); }
    else if (d.tool === 'arrow') {
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), hl = Math.max(12, g.lineWidth * 4);
      g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
      g.beginPath(); g.moveTo(b[0], b[1]); g.lineTo(b[0] - hl * Math.cos(ang - 0.45), b[1] - hl * Math.sin(ang - 0.45)); g.lineTo(b[0] - hl * Math.cos(ang + 0.45), b[1] - hl * Math.sin(ang + 0.45)); g.closePath(); g.fill();
    }
    g.restore();
  }
  function drawOverlay(o) {
    const [W, H] = dims(), px = W * o.size / 100, cx = W * o.x / 100, cy = H * o.y / 100;
    g.save(); g.globalAlpha = o.op / 100; g.filter = 'none';
    if (o.kind === 'img' && o.img) { const h = px * o.img.height / o.img.width; g.drawImage(o.img, cx - px / 2, cy - h / 2, px, h); }
    else if (o.kind === 'emoji') { g.font = Math.round(px) + 'px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(o.emoji, cx, cy); }
    g.restore();
  }
  function draw() {
    const [W, H] = dims();
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; havePrev = false; }
    g.globalAlpha = 1; g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    const c = clips[active]; let audio = 1;
    if (c && c.v.videoWidth) {
      const L = clipLevels(c, active); audio = L.a;
      const usePrev = L.tr && havePrev && prevFor === active - 1 && prevCv.width === W && prevCv.height === H, p = L.p, q = L.prog;
      if (L.tr && !usePrev) { g.globalAlpha = Math.min(L.a, p); layer(c, 0, 0, q); audio = Math.min(audio, p); }
      else if (L.tr && c.trans === 'fade') { g.drawImage(prevCv, 0, 0); g.globalAlpha = Math.min(L.a, p); layer(c, 0, 0, q); audio = Math.min(audio, p); }
      else if (L.tr && c.trans === 'dip') { if (p < 0.5) { g.globalAlpha = 1 - p * 2; g.drawImage(prevCv, 0, 0); audio = 0; } else { g.globalAlpha = Math.min(L.a, p * 2 - 1); layer(c, 0, 0, q); audio = Math.min(audio, p * 2 - 1); } }
      else if (L.tr && c.trans === 'wipe') { g.drawImage(prevCv, 0, 0); g.save(); g.beginPath(); g.rect(0, 0, W * p, H); g.clip(); g.globalAlpha = L.a; layer(c, 0, 0, q); g.restore(); audio = Math.min(audio, 0.3 + 0.7 * p); }
      else if (L.tr && c.trans === 'slide') { g.drawImage(prevCv, -W * p, 0); g.globalAlpha = L.a; layer(c, W * (1 - p), 0, q); audio = Math.min(audio, 0.3 + 0.7 * p); }
      else { g.globalAlpha = L.a; layer(c, 0, 0, q); }
      g.globalAlpha = 1;
      /* keep the last frame of this clip for the next transition */
      if (active < clips.length - 1 && L.tleft < 0.2) { if (prevCv.width !== W || prevCv.height !== H) { prevCv.width = W; prevCv.height = H; } pg2.drawImage(cv, 0, 0); havePrev = true; prevFor = active; }
    }
    origGain.gain.value = ovolv * audio;
    overlays.forEach((o) => { if (tl >= o.start && tl <= o.end) drawOverlay(o); });
    drawings.forEach((d) => { if (tl >= d.start - 0.001 && tl <= d.end) drawStroke(d); });
    texts.forEach((t) => { if (tl >= t.start && tl <= t.end) drawText(t); });
  }

  /* ---------- music ducking: the music dips while the video's own sound is present ---------- */
  const duck = { on: false, db: 12, thresh: 0.02 };
  function duckStep() {
    const now = ctx.currentTime;
    if (!duck.on || !playing) { if (musicDuck.gain.value < 0.999) musicDuck.gain.setTargetAtTime(1, now, 0.15); return; }
    anOrig.getFloatTimeDomainData(anBuf); let s = 0; for (let i = 0; i < anBuf.length; i++) s += anBuf[i] * anBuf[i];
    const rms = Math.sqrt(s / anBuf.length), tgt = rms > duck.thresh ? Math.pow(10, -duck.db / 20) : 1;
    musicDuck.gain.setTargetAtTime(tgt, now, tgt < 1 ? 0.06 : 0.45);
  }

  (function frame() {
    if (playing && clips[active]) {
      const c = clips[active], u = c.v.currentTime - c.in;
      tl = startOf(active) + tAt(c, Math.max(0, u));
      c.v.playbackRate = clamp(speedAt(c, u), 0.25, 4);
      if (c.v.currentTime >= c.out - 0.03 || c.v.ended) {
        if (active < clips.length - 1) activate(active + 1, 0, true); else finish();
      }
    }
    draw(); duckStep();
    const T = total();
    $('clock').textContent = fmt(tl) + ' / ' + fmt(T);
    if (!scrubbing && T > 0) $('scrub').value = Math.round(tl / T * 1000);
    requestAnimationFrame(frame);
  })();

  /* ---------- stabilise: estimate the shake between sampled frames, then smooth it ---------- */
  function estimateShift(a, b, w, h, R) {     // content moved by [dx, dy] pixels from frame a to frame b (grey images, w x h)
    R = R || 8; let best = Infinity, bx = 0, by = 0;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      let sad = 0, n = 0;
      for (let y = R; y < h - R; y += 2) for (let x = R; x < w - R; x += 2) { sad += Math.abs(b[(y + dy) * w + x + dx] - a[y * w + x]); n++; }
      sad /= n; if (sad < best - 1e-9 || (Math.abs(sad - best) <= 1e-9 && Math.abs(dx) + Math.abs(dy) < Math.abs(bx) + Math.abs(by))) { best = sad; bx = dx; by = dy; }
    }
    return [bx, by];
  }
  function smoothPath(P, half) {
    return P.map((_, i) => { let s = 0, n = 0; for (let k = Math.max(0, i - half); k <= Math.min(P.length - 1, i + half); k++) { s += P[k]; n++; } return s / n; });
  }
  const seekTo = (v, t) => new Promise((res) => { const done = () => { v.removeEventListener('seeked', done); clearTimeout(to); res(); }; const to = setTimeout(done, 2000); v.addEventListener('seeked', done); v.currentTime = t; });
  async function stabilise(i, onProgress) {
    const c = clips[i]; if (!c || busyStab) return false; busyStab = true; pause();
    try {
      const SW = 96, SH = Math.max(24, Math.round(SW * c.v.videoHeight / c.v.videoWidth)), sm = document.createElement('canvas'); sm.width = SW; sm.height = SH;
      const sg = sm.getContext('2d', { willReadFrequently: true }), n = Math.max(2, Math.floor((c.out - c.in) * STAB_FPS) + 1);
      const px = [0], py = [0]; let prev = null;
      for (let k = 0; k < n; k++) {
        await seekTo(c.v, Math.min(c.out - 0.001, c.in + k / STAB_FPS)); sg.drawImage(c.v, 0, 0, SW, SH);
        const d = sg.getImageData(0, 0, SW, SH).data, gr = new Float32Array(SW * SH); for (let j = 0; j < gr.length; j++) gr[j] = d[j * 4] * 0.3 + d[j * 4 + 1] * 0.59 + d[j * 4 + 2] * 0.11;
        if (prev) { const [dx, dy] = estimateShift(prev, gr, SW, SH, 8); px.push(px[k - 1] + dx); py.push(py[k - 1] + dy); }
        prev = gr;
        if (onProgress && k % 4 === 0) onProgress(k / n);
      }
      const sx = smoothPath(px, 5), sy = smoothPath(py, 5), LIM = 0.05;
      c.stab = { dx: Float32Array.from(px, (v, k) => clamp((sx[k] - v) / SW, -LIM, LIM)), dy: Float32Array.from(py, (v, k) => clamp((sy[k] - v) / SH, -LIM, LIM)) };
      c.stabOn = true; return true;
    } finally { busyStab = false; if (clips.includes(c)) { c.v.currentTime = c.in; } }
  }

  /* ---------- UI: clip list ---------- */
  const GRADES = { normal: { b: 100, c: 100, s: 100, h: 0, sep: 0 }, warm: { b: 105, c: 105, s: 115, h: -8, sep: 18 }, cool: { b: 100, c: 105, s: 95, h: 12, sep: 0 }, bw: { b: 105, c: 115, s: 0, h: 0, sep: 0 }, vintage: { b: 100, c: 92, s: 80, h: -6, sep: 40 }, vivid: { b: 102, c: 115, s: 150, h: 0, sep: 0 }, faded: { b: 112, c: 82, s: 78, h: 0, sep: 8 } };
  const ZOOMS = { none: [100, 100, 0, 0, 0, 0], zin: [100, 118, 0, 0, 0, 0], zout: [118, 100, 0, 0, 0, 0], left: [115, 115, 6, -6, 0, 0], right: [115, 115, -6, 6, 0, 0] };
  const field = (cls, label, attrs) => '<label class="ctl">' + label + '<input class="' + cls + '" ' + attrs + '></label>';
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
      inp.onchange = () => { c.in = clamp(+inp.value || 0, 0, c.out - 0.2); c.stab = null; c.stabOn = false; refresh(); seek(Math.min(tl, total())); };
      outp.onchange = () => { c.out = clamp(+outp.value || c.dur, c.in + 0.2, c.dur); c.stab = null; c.stabOn = false; refresh(); seek(Math.min(tl, total())); };
      d.querySelectorAll('[data-a]').forEach((b) => (b.onclick = () => {
        const a = b.dataset.a, was = clips[active];
        if (a === 'up' && i > 0) [clips[i - 1], clips[i]] = [clips[i], clips[i - 1]];
        if (a === 'down' && i < clips.length - 1) [clips[i + 1], clips[i]] = [clips[i], clips[i + 1]];
        if (a === 'del') { pause(); stopClean(c); c.v.remove(); URL.revokeObjectURL(c.url); clips.splice(i, 1); }
        active = clips.indexOf(was); if (active < 0) { active = clips.length ? 0 : -1; tl = 0; if (active >= 0) activate(0, 0, false); }
        refresh(); if (clips.length) seek(Math.min(tl, total()));
      }));
      const fx = document.createElement('div'); fx.className = 'mini'; fx.style.marginTop = '8px';
      fx.innerHTML = '<label class="ctl">Fade in (s)<input type="number" class="fi" step="0.1" min="0" max="5"></label><label class="ctl">Fade out (s)<input type="number" class="fo" step="0.1" min="0" max="5"></label>' + (i > 0 ? '<label class="ctl">Transition in<select class="tr"><option value="cut">Cut</option><option value="fade">Crossfade</option><option value="dip">Dip to black</option><option value="wipe">Wipe</option><option value="slide">Slide</option></select></label><label class="ctl">Length (s)<input type="number" class="td" step="0.1" min="0.1" max="3"></label>' : '');
      const fi = fx.querySelector('.fi'), fo = fx.querySelector('.fo'), tr = fx.querySelector('.tr'), td = fx.querySelector('.td');
      fi.value = c.fi; fo.value = c.fo; fi.onchange = () => { c.fi = clamp(+fi.value || 0, 0, Math.min(5, len(c) / 2)); fi.value = c.fi; }; fo.onchange = () => { c.fo = clamp(+fo.value || 0, 0, Math.min(5, len(c) / 2)); fo.value = c.fo; };
      if (tr) { tr.value = c.trans; td.value = c.tdur; tr.onchange = () => { c.trans = tr.value; }; td.onchange = () => { c.tdur = clamp(+td.value || 0.6, 0.1, Math.min(3, len(c))); td.value = c.tdur; }; }
      d.appendChild(fx);
      d.appendChild(sections(c));
      list.appendChild(d);
    });
    const tl2 = $('textlist'); tl2.innerHTML = '';
    texts.sort((a, b) => a.start - b.start);
    texts.forEach((t, i) => {
      const dd = document.createElement('div'); dd.className = 'clip';
      dd.innerHTML = '<div class="nm"></div><div class="row"><button class="btn sm" data-a="edit">Edit</button><button class="btn sm danger" data-a="del">Remove</button></div>';
      dd.querySelector('.nm').textContent = '“' + t.text.replace(/\n/g, ' ') + '” ' + t.start.toFixed(1) + '–' + t.end.toFixed(1) + 's, ' + t.pos;
      dd.querySelector('[data-a=del]').onclick = () => { texts.splice(i, 1); refresh(); };
      dd.querySelector('[data-a=edit]').onclick = () => { $('ttext').value = t.text; $('tstart').value = t.start; $('tend').value = t.end; $('tpos').value = t.pos; $('tsize').value = t.size; $('tcolor').value = t.color; $('tfont').value = t.font || 'sans'; $('tstyle').value = t.style || 'outline'; $('tanim').value = t.anim || 'none'; texts.splice(i, 1); refresh(); $('ttext').focus(); };
      tl2.appendChild(dd);
    });
    const ol = $('ovlist'); ol.innerHTML = '';
    overlays.forEach((o, i) => {
      const dd = document.createElement('div'); dd.className = 'clip';
      dd.innerHTML = '<div class="nm"></div><div class="mini">' + field('os', 'Start (s)', 'type="number" min="0" step="0.1"') + field('oe', 'End (s)', 'type="number" min="0" step="0.1"') + field('ox', 'Across (%)', 'type="number" min="0" max="100"') + field('oy', 'Down (%)', 'type="number" min="0" max="100"') + field('oz', 'Size (% of width)', 'type="number" min="2" max="100"') + field('oo', 'Opacity (%)', 'type="number" min="5" max="100"') + '</div><div class="row" style="margin-top:8px"><button class="btn sm danger">Remove</button></div>';
      dd.querySelector('.nm').textContent = (o.kind === 'emoji' ? 'Sticker ' + o.emoji : 'Picture ' + o.name);
      const m = { os: 'start', oe: 'end', ox: 'x', oy: 'y', oz: 'size', oo: 'op' }, lim = { start: [0, 1e5], end: [0.1, 1e5], x: [0, 100], y: [0, 100], size: [2, 100], op: [5, 100] };
      Object.entries(m).forEach(([cls, k]) => { const el = dd.querySelector('.' + cls); el.value = o[k]; el.onchange = () => { o[k] = clamp(+el.value, lim[k][0], lim[k][1]); if (o.end <= o.start) o.end = o.start + 0.1; refresh(); }; });
      dd.querySelector('button').onclick = () => { overlays.splice(i, 1); refresh(); };
      ol.appendChild(dd);
    });
    const dl = $('drlist'); dl.innerHTML = '';
    drawings.forEach((d, i) => {
      const dd = document.createElement('div'); dd.className = 'clip'; dd.innerHTML = '<div class="nm"></div><div class="mini">' + field('ds', 'Start (s)', 'type="number" min="0" step="0.1"') + field('de', 'End (s)', 'type="number" min="0" step="0.1"') + '</div><div class="row" style="margin-top:8px"><button class="btn sm danger">Remove</button></div>';
      dd.querySelector('.nm').textContent = ({ pen: 'Pen drawing', arrow: 'Arrow', box: 'Box', circle: 'Circle' })[d.tool];
      const ds = dd.querySelector('.ds'), de = dd.querySelector('.de'); ds.value = d.start.toFixed(1); de.value = d.end.toFixed(1);
      ds.onchange = () => { d.start = Math.max(0, +ds.value || 0); if (d.end <= d.start) d.end = d.start + 0.5; refresh(); }; de.onchange = () => { d.end = Math.max(d.start + 0.1, +de.value || d.start + 3); refresh(); };
      dd.querySelector('button').onclick = () => { drawings.splice(i, 1); refresh(); }; dl.appendChild(dd);
    });
    const vl = $('volist'); vl.innerHTML = ''; $('voname').textContent = voices.length ? voices.length + ' recorded' : 'None';
    voices.forEach((v, i) => {
      const dd = document.createElement('div'); dd.className = 'clip'; dd.innerHTML = '<div class="nm"></div><div class="row"><button class="btn sm danger">Remove</button></div>';
      dd.querySelector('.nm').textContent = v.name + ' at ' + fmt(v.start) + ', ' + fmt(v.buf.duration) + ' long';
      dd.querySelector('button').onclick = () => { stopVoices(); voices.splice(i, 1); refresh(); }; vl.appendChild(dd);
    });
    $('subcount').textContent = texts.length ? texts.length + ' text layer' + (texts.length === 1 ? '' : 's') : 'No text yet';
  }
  /* collapsible groups under each clip: speed, colour, zoom and pan, green screen, stabilise */
  function sections(c) {
    const wrap = document.createElement('div'); wrap.className = 'vfxwrap';
    const det = (key, title, html) => { const e = document.createElement('details'); e.className = 'vfx'; e.open = !!c.open[key]; e.innerHTML = '<summary>' + title + '</summary><div class="mini" style="margin-top:8px">' + html + '</div>'; e.addEventListener('toggle', () => { c.open[key] = e.open; }); wrap.appendChild(e); return e; };
    /* speed */
    let e = det('speed', 'Speed and speed ramp', field('sp1', 'Speed at start (×)', 'type="number" min="0.25" max="4" step="0.05"') + field('sp2', 'Speed at end (×)', 'type="number" min="0.25" max="4" step="0.05"') + '<label class="ctl">&nbsp;<button class="btn sm sp0">Reset</button></label>');
    const s1 = e.querySelector('.sp1'), s2 = e.querySelector('.sp2'); s1.value = c.speed; s2.value = c.speed2;
    const setSpeed = (a, b) => { c.speed = clamp(+a || 1, 0.25, 4); c.speed2 = clamp(+b || c.speed, 0.25, 4); refresh(); seek(Math.min(tl, total())); };
    s1.onchange = () => { const wasConst = Math.abs(c.speed2 - c.speed) < 1e-6; setSpeed(s1.value, wasConst ? s1.value : s2.value); };
    s2.onchange = () => setSpeed(s1.value, s2.value); e.querySelector('.sp0').onclick = () => setSpeed(1, 1);
    /* colour */
    e = det('grade', 'Colour grading', '<label class="ctl">Look<select class="sel gp"><option value="">Custom</option><option value="normal">Normal</option><option value="warm">Warm</option><option value="cool">Cool</option><option value="bw">Black and white</option><option value="vintage">Vintage</option><option value="vivid">Vivid</option><option value="faded">Faded</option></select></label>'
      + field('gb', 'Brightness', 'type="range" min="50" max="150"') + field('gc', 'Contrast', 'type="range" min="50" max="150"') + field('gs', 'Saturation', 'type="range" min="0" max="200"') + field('gh', 'Hue', 'type="range" min="-180" max="180"') + field('gx', 'Sepia', 'type="range" min="0" max="100"'));
    const ge = e, gp = e.querySelector('.gp'), gm = { b: 'gb', c: 'gc', s: 'gs', h: 'gh', sep: 'gx' }, sync = () => { Object.entries(gm).forEach(([k, cls]) => (ge.querySelector('.' + cls).value = c.grade[k])); gp.value = Object.keys(GRADES).find((n) => Object.keys(gm).every((k) => GRADES[n][k] === c.grade[k])) || ''; };
    sync(); Object.entries(gm).forEach(([k, cls]) => (e.querySelector('.' + cls).oninput = (ev) => { c.grade[k] = +ev.target.value; gp.value = ''; }));
    gp.onchange = () => { if (gp.value) { Object.assign(c.grade, GRADES[gp.value]); sync(); } };
    if (!hasFilter) { const n = document.createElement('p'); n.className = 'status'; n.textContent = 'This browser cannot apply colour grading to the picture. Use Chrome, Edge or Firefox.'; e.appendChild(n); }
    /* zoom and pan */
    e = det('zoom', 'Zoom and pan (start to end of the clip)', '<label class="ctl">Preset<select class="sel zp"><option value="">Custom</option><option value="none">None</option><option value="zin">Slow zoom in</option><option value="zout">Slow zoom out</option><option value="left">Pan left</option><option value="right">Pan right</option></select></label>'
      + field('zs1', 'Zoom at start (%)', 'type="number" min="100" max="300" step="1"') + field('zs2', 'Zoom at end (%)', 'type="number" min="100" max="300" step="1"')
      + field('zx1', 'Across at start (%)', 'type="number" min="-50" max="50" step="1"') + field('zx2', 'Across at end (%)', 'type="number" min="-50" max="50" step="1"')
      + field('zy1', 'Up/down at start (%)', 'type="number" min="-50" max="50" step="1"') + field('zy2', 'Up/down at end (%)', 'type="number" min="-50" max="50" step="1"'));
    const ze = e, zm = { s1: 'zs1', s2: 'zs2', x1: 'zx1', x2: 'zx2', y1: 'zy1', y2: 'zy2' }, zp = e.querySelector('.zp'), zsync = () => { Object.entries(zm).forEach(([k, cls]) => (ze.querySelector('.' + cls).value = c.zoom[k])); zp.value = Object.keys(ZOOMS).find((n) => Object.keys(zm).every((k, j) => ZOOMS[n][j] === c.zoom[k])) || ''; };
    zsync(); Object.entries(zm).forEach(([k, cls]) => (e.querySelector('.' + cls).onchange = (ev) => { c.zoom[k] = clamp(+ev.target.value || (k[0] === 's' ? 100 : 0), k[0] === 's' ? 100 : -50, k[0] === 's' ? 300 : 50); zsync(); }));
    zp.onchange = () => { if (zp.value) { Object.keys(zm).forEach((k, j) => (c.zoom[k] = ZOOMS[zp.value][j])); zsync(); } };
    /* green screen */
    e = det('key', 'Green screen (chroma key)', '<label class="ctl">&nbsp;<span class="row" style="gap:6px"><input type="checkbox" class="ko"> Remove the key colour</span></label>' + field('kc', 'Key colour', 'type="color"') + field('kt', 'Tolerance', 'type="range" min="0" max="100"') + field('ks', 'Edge softness', 'type="range" min="0" max="100"') + field('kb', 'Background colour', 'type="color"') + '<label class="ctl">Background picture<span class="row" style="gap:6px"><button class="btn sm kbi">Choose…</button><button class="btn sm kbx">Clear</button></span></label>');
    const ko = e.querySelector('.ko'), kc = e.querySelector('.kc'), kt = e.querySelector('.kt'), ks = e.querySelector('.ks'), kb = e.querySelector('.kb');
    ko.checked = c.key.on; kc.value = c.key.color; kt.value = c.key.tol; ks.value = c.key.soft; kb.value = c.key.bg;
    ko.onchange = () => { c.key.on = ko.checked; }; kc.oninput = () => { c.key.color = kc.value; }; kt.oninput = () => { c.key.tol = +kt.value; }; ks.oninput = () => { c.key.soft = +ks.value; }; kb.oninput = () => { c.key.bg = kb.value; };
    e.querySelector('.kbi').onclick = () => $('bgfile').click(); e.querySelector('.kbx').onclick = () => { bgImg = null; say('Background picture cleared.'); };
    /* stabilise */
    e = det('stab', 'Stabilise shaky footage', '<label class="ctl">&nbsp;<button class="btn sm sa">Analyse and stabilise</button></label><label class="ctl">&nbsp;<span class="row" style="gap:6px"><input type="checkbox" class="so"> Use stabilisation</span></label><p class="status sn" role="status" style="grid-column:1/-1"></p>');
    const so = e.querySelector('.so'), sa = e.querySelector('.sa'), sn = e.querySelector('.sn'); so.checked = c.stabOn; so.disabled = !c.stab;
    sn.textContent = c.stab ? 'Stabilisation is ready. It crops in about 10% to hide the moving edges.' : 'Analysing takes a few seconds per minute of footage. It looks for camera shake only, and works best on steady scenes.';
    so.onchange = () => { c.stabOn = so.checked; };
    sa.onclick = async () => { sa.disabled = true; const ok = await stabilise(clips.indexOf(c), (p) => { sn.textContent = 'Analysing… ' + Math.round(p * 100) + '%'; }); sa.disabled = false; so.disabled = !c.stab; so.checked = c.stabOn; sn.textContent = ok ? 'Done. Stabilisation is on; play the clip to see it.' : 'Could not analyse this clip.'; };
    /* volume and sound */
    e = det('vol', 'Volume and sound', field('cv', 'Volume (%)', 'type="range" min="0" max="200"') + '<label class="ctl">&nbsp;<span class="row" style="gap:6px"><input type="checkbox" class="cm"> Mute this clip</span></label>');
    const cvr = e.querySelector('.cv'), cm = e.querySelector('.cm'); cvr.value = Math.round(c.vol * 100); cm.checked = c.mute;
    cvr.oninput = () => { c.vol = +cvr.value / 100; applyVol(c); }; cm.onchange = () => { c.mute = cm.checked; applyVol(c); };
    /* crop, rotate, flip */
    e = det('xf', 'Crop, rotate and flip', '<label class="ctl">Rotate<select class="sel xr"><option value="0">None</option><option value="90">90° right</option><option value="180">180°</option><option value="270">90° left</option></select></label><label class="ctl">&nbsp;<span class="row" style="gap:6px"><input type="checkbox" class="xh"> Flip left to right</span></label><label class="ctl">&nbsp;<span class="row" style="gap:6px"><input type="checkbox" class="xv"> Flip top to bottom</span></label>'
      + field('xl', 'Crop left (%)', 'type="range" min="0" max="45"') + field('xt', 'Crop top (%)', 'type="range" min="0" max="45"') + field('xri', 'Crop right (%)', 'type="range" min="0" max="45"') + field('xb', 'Crop bottom (%)', 'type="range" min="0" max="45"'));
    const xe = e, xr = e.querySelector('.xr'), xh = e.querySelector('.xh'), xv = e.querySelector('.xv'), xm = { cl: 'xl', ct: 'xt', cr: 'xri', cb: 'xb' };
    xr.value = String(c.xf.rot); xh.checked = c.xf.fh; xv.checked = c.xf.fv; Object.entries(xm).forEach(([k, cls]) => { xe.querySelector('.' + cls).value = c.xf[k]; xe.querySelector('.' + cls).oninput = (ev) => { c.xf[k] = +ev.target.value; }; });
    xr.onchange = () => { c.xf.rot = +xr.value; }; xh.onchange = () => { c.xf.fh = xh.checked; }; xv.onchange = () => { c.xf.fv = xv.checked; };
    /* clean the sound: background noise removal on this device */
    e = det('clean', 'Clean the sound', field('cn', 'Strength (%)', 'type="range" min="10" max="100"') + '<label class="ctl">&nbsp;<span class="row" style="gap:6px"><button class="btn sm cr">Remove background noise</button><button class="btn sm co">Use original sound</button></span></label><p class="status sn cs" role="status" style="grid-column:1/-1"></p>');
    const cn = e.querySelector('.cn'), cr = e.querySelector('.cr'), co = e.querySelector('.co'), cs = e.querySelector('.cs'); cn.value = c.cn || 100; co.disabled = !c.clean;
    cs.textContent = c.clean ? 'The cleaned sound is on for this clip.' : 'Reduces steady background noise such as hiss, hum and fans, mostly in speech. It runs on this device and takes a few seconds per minute of sound.';
    cn.oninput = () => { c.cn = +cn.value; };
    cr.onclick = async () => {
      if (Math.abs(c.speed2 - c.speed) > 1e-6) { cs.textContent = 'Use a steady speed for this clip first (set both speeds the same).'; return; }
      cr.disabled = true; cs.textContent = 'Preparing…';
      try {
        const ab = await ctx.decodeAudioData((await c.file.arrayBuffer()).slice(0)), arrs = []; for (let k = 0; k < ab.numberOfChannels; k++) arrs.push(ab.getChannelData(k).slice());
        const out = await GVDenoise.run(arrs, ab.sampleRate, (c.cn || 100) / 100, (pr) => { cs.textContent = 'Removing noise… ' + Math.round(pr * 100) + '%'; });
        const nb = ctx.createBuffer(out.length, out[0].length, ab.sampleRate); out.forEach((o, k) => nb.copyToChannel(o, k));
        const was = playing; if (was) pause(); c.clean = nb; applyVol(c); co.disabled = false; cs.textContent = 'Done. The cleaned sound is on for this clip, in the preview and the export.'; if (was) play();
      } catch (err) { cs.textContent = /decode/i.test(String(err && err.message)) || (err && err.name === 'EncodingError') ? 'This clip has no sound to clean.' : 'Could not clean the sound in this browser. A recent Chrome, Edge or Firefox is needed.'; }
      cr.disabled = false;
    };
    co.onclick = () => { const was = playing; if (was) pause(); c.clean = null; applyVol(c); co.disabled = true; cs.textContent = 'Back to the original sound.'; if (was) play(); };
    /* remove silence */
    e = det('sil', 'Remove silence', field('sth', 'Counts as silence below (dB)', 'type="range" min="-60" max="-15"') + field('smp', 'Shortest pause to cut (s)', 'type="number" min="0.2" max="3" step="0.1"') + '<label class="ctl">&nbsp;<span class="row" style="gap:6px"><button class="btn sm sf">Find pauses</button><button class="btn sm sc" disabled>Cut them out</button></span></label><p class="status sn sl" role="status" style="grid-column:1/-1">Finds quiet gaps in the clip\'s sound and cuts them out, so the clip is split into the parts with speech or sound.</p>');
    const sth = e.querySelector('.sth'), smp = e.querySelector('.smp'), sf = e.querySelector('.sf'), sc = e.querySelector('.sc'), sl = e.querySelector('.sl'); sth.value = c.sil.th; smp.value = c.sil.min; let found = null;
    sth.oninput = () => { c.sil.th = +sth.value; sc.disabled = true; found = null; }; smp.onchange = () => { c.sil.min = clamp(+smp.value || 0.6, 0.2, 3); smp.value = c.sil.min; sc.disabled = true; found = null; };
    sf.onclick = async () => {
      sf.disabled = true; sl.textContent = 'Listening…';
      const r = await findSilence(c, c.sil.th, c.sil.min); sf.disabled = false;
      if (!r) { sl.textContent = c.speed !== 1 || c.speed2 !== 1 ? 'Reset the clip speed to 1 first.' : 'This clip has no sound to analyse.'; return; }
      found = r; sc.disabled = !r.pauses; sl.textContent = r.pauses ? 'Found ' + r.pauses + ' pause' + (r.pauses === 1 ? '' : 's') + ', ' + r.removed.toFixed(1) + ' s in all. Press Cut them out to remove them.' : 'No pauses that long. Try a higher dB level or a shorter pause.';
    };
    sc.onclick = async () => { if (!found) return; sc.disabled = true; const n = await cutSilence(clips.indexOf(c), found.keep); if (!n) sl.textContent = 'Could not cut this clip.'; };
    return wrap;
  }
  /* ---------- remove silence: split a clip into the parts that have sound ---------- */
  async function findSilence(c, th, minPause) {
    if (c.speed !== 1 || c.speed2 !== 1) return null;
    let ab; try { ab = await ctx.decodeAudioData((await c.file.arrayBuffer()).slice(0)); } catch (_) { return null; }
    const sr = ab.sampleRate, win = Math.round(sr * 0.02), a = Math.floor(c.in * sr), b = Math.min(ab.length, Math.ceil(c.out * sr)), limit = Math.pow(10, th / 20), n = Math.floor((b - a) / win), quiet = [];
    const chans = []; for (let k = 0; k < ab.numberOfChannels; k++) chans.push(ab.getChannelData(k));
    for (let w = 0; w < n; w++) { let sum = 0; for (let k = 0; k < chans.length; k++) { const d = chans[k]; for (let i = a + w * win; i < a + (w + 1) * win; i++) sum += d[i] * d[i]; } quiet.push(Math.sqrt(sum / (win * chans.length)) < limit); }
    const dt = win / sr, pad = 0.12, keep = [], cuts = []; let i = 0, from = c.in;
    while (i < n) {
      if (!quiet[i]) { i++; continue; }
      let j = i; while (j < n && quiet[j]) j++;
      const len = (j - i) * dt; if (len >= minPause && len - 2 * pad > 0.05) cuts.push([c.in + i * dt + pad, c.in + j * dt - pad]);
      i = j;
    }
    cuts.forEach(([x, y]) => { if (x - from > 0.1) keep.push([from, x]); from = y; });
    if (c.out - from > 0.1) keep.push([from, c.out]); if (!cuts.length) return { pauses: 0, removed: 0, keep: [[c.in, c.out]] };
    return { pauses: cuts.length, removed: cuts.reduce((s2, [x, y]) => s2 + (y - x), 0), keep };
  }
  async function cloneClip(c, a, b) {
    const url = URL.createObjectURL(c.file), v = document.createElement('video'); v.src = url; v.preload = 'auto'; v.playsInline = true; $('vids').appendChild(v);
    await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error('bad')); }); if (!isFinite(v.duration)) await fixDuration(v);
    const gn = ctx.createGain(); ctx.createMediaElementSource(v).connect(gn); gn.connect(origGain);
    const n = newClip(c.name, url, v, c.file); n.gain = gn; n.cgain = ctx.createGain(); n.cgain.connect(origGain); n.clean = c.clean; n.in = a; n.out = Math.min(b, v.duration);
    n.grade = { ...c.grade }; n.zoom = { ...c.zoom }; n.key = { ...c.key }; n.xf = { ...c.xf }; n.vol = c.vol; n.mute = c.mute; n.sil = { ...c.sil }; applyVol(n); return n;
  }
  async function cutSilence(i, keep) {
    const c = clips[i]; if (!c || !keep.length) return 0; pause(); const parts = [];
    try { for (const [a, b] of keep) parts.push(await cloneClip(c, a, b)); } catch (_) { parts.forEach((p2) => { p2.v.remove(); URL.revokeObjectURL(p2.url); }); return 0; }
    parts[0].fi = c.fi; parts[0].trans = c.trans; parts[0].tdur = c.tdur; parts[parts.length - 1].fo = c.fo;
    parts.forEach((p2, k) => { p2.name = c.name + ' (part ' + (k + 1) + ')'; });
    const startT = startOf(i); c.v.remove(); URL.revokeObjectURL(c.url); clips.splice(i, 1, ...parts);
    active = Math.min(clips.length - 1, Math.max(0, i)); tl = Math.min(startT, total()); activate(locate(tl).i, locate(tl).off, false); refresh(); seek(tl);
    say('Cut the pauses: the clip is now ' + parts.length + ' part' + (parts.length === 1 ? '' : 's') + ', ' + fmt(parts.reduce((s2, p2) => s2 + len(p2), 0)) + ' long.'); return parts.length;
  }
  $('bgfile').onchange = () => {
    const f = $('bgfile').files[0]; $('bgfile').value = ''; if (!f) return;
    const im = new Image(), u = URL.createObjectURL(f); im.onload = () => { bgImg = im; say('Background picture set.'); }; im.onerror = () => say('Could not read that picture.'); im.src = u;
  };

  /* ---------- drawing on the picture ---------- */
  let drawOn = false, drawing = null;
  $('drmode').onclick = () => { drawOn = !drawOn; $('drmode').setAttribute('aria-pressed', drawOn); $('drmode').textContent = 'Draw on the picture: ' + (drawOn ? 'on' : 'off'); cv.classList.toggle('drawing', drawOn); };
  const cvPos = (e) => { const r = cv.getBoundingClientRect(); return [clamp((e.clientX - r.left) / r.width * 100, 0, 100), clamp((e.clientY - r.top) / r.height * 100, 0, 100)]; };
  cv.addEventListener('pointerdown', (e) => {
    if (!drawOn || !clips.length) return; e.preventDefault(); try { cv.setPointerCapture(e.pointerId); } catch (_) { /* fine */ }
    const len = clamp(+$('drlen').value || 3, 0.5, 60); drawing = { tool: $('drtool').value, color: $('drcolor').value, w: clamp(+$('drw').value || 6, 1, 30), start: tl, end: tl + len, pts: [cvPos(e)] }; drawings.push(drawing);
  });
  cv.addEventListener('pointermove', (e) => { if (!drawing) return; const p = cvPos(e); if (drawing.tool === 'pen') drawing.pts.push(p); else drawing.pts[1] = p; });
  const endDraw = () => { if (!drawing) return; if (drawing.pts.length < 2) drawings.pop(); drawing = null; refresh(); };
  cv.addEventListener('pointerup', endDraw); cv.addEventListener('pointercancel', endDraw);

  /* ---------- pictures, logos and stickers ---------- */
  const endDefault = () => Math.max(3, Math.round(total() * 10) / 10);
  function addOverlay(o) { overlays.push(Object.assign({ start: 0, end: endDefault(), x: 50, y: 50, size: 20, op: 100 }, o)); refresh(); }
  $('ovpic').onclick = () => $('ovfile').click();
  $('ovfile').onchange = () => {
    const f = $('ovfile').files[0]; $('ovfile').value = ''; if (!f) return;
    const im = new Image(), u = URL.createObjectURL(f); im.onload = () => { addOverlay({ kind: 'img', img: im, name: f.name, x: 85, y: 14, size: 18 }); say('Added ' + f.name + '. Set where it sits and when it shows.'); }; im.onerror = () => say('Could not read that picture.'); im.src = u;
  };
  $('ovsticker').onclick = () => { addOverlay({ kind: 'emoji', emoji: $('ovemoji').value, size: 14 }); say('Sticker added. Set where it sits and when it shows.'); };

  /* ---------- text and subtitles ---------- */
  $('tadd').onclick = () => {
    const text = $('ttext').value.trim(); if (!text) return say('Type the text first.');
    const start = Math.max(0, +$('tstart').value || 0), end = Math.max(start + 0.1, +$('tend').value || start + 3);
    texts.push({ text, start, end, pos: $('tpos').value, size: clamp(+$('tsize').value || 64, 16, 300), color: $('tcolor').value, font: $('tfont').value, style: $('tstyle').value, anim: $('tanim').value, alen: clamp(+$('talen').value || 0.5, 0.1, 3) });
    $('ttext').value = ''; refresh();
  };
  $('aspect').onchange = () => { aspect = $('aspect').value; };
  const stamp = (s) => { s = Math.max(0, s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = Math.floor(s % 60), ms = Math.round((s - Math.floor(s)) * 1000); const p = (n, w) => String(n).padStart(w, '0'); return p(h, 2) + ':' + p(m, 2) + ':' + p(sec >= 60 ? 59 : sec, 2) + ',' + p(ms >= 1000 ? 999 : ms, 3); };
  function parseSubs(text) {
    const out = [], re = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})\s*-->\s*(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;
    const sec = (h, m, s, ms) => (+h || 0) * 3600 + (+m) * 60 + (+s) + (+String(ms).padEnd(3, '0')) / 1000;
    text.replace(/^﻿/, '').replace(/\r/g, '').split(/\n{2,}/).forEach((blk) => {
      const lines = blk.split('\n'), ti = lines.findIndex((l) => re.test(l)); if (ti < 0) return;
      const m = lines[ti].match(re), body = lines.slice(ti + 1).join('\n').replace(/<[^>]+>/g, '').trim(); if (!body) return;
      const start = sec(m[1], m[2], m[3], m[4]), end = sec(m[5], m[6], m[7], m[8]); if (end > start) out.push({ text: body, start, end });
    });
    return out.slice(0, 3000);
  }
  function importSubs(text) {
    const cues = parseSubs(text); if (!cues.length) return 0;
    cues.forEach((q) => texts.push({ text: q.text, start: q.start, end: q.end, pos: 'bottom', size: 44, color: '#ffffff', font: 'sans', style: 'box', anim: 'none', alen: 0.5, sub: true }));
    refresh(); return cues.length;
  }
  const exportSrt = () => texts.slice().sort((a, b) => a.start - b.start).map((t, i) => (i + 1) + '\n' + stamp(t.start) + ' --> ' + stamp(t.end) + '\n' + t.text + '\n').join('\n');
  $('subimp').onclick = () => $('subfile').click();
  $('subfile').onchange = async () => { const f = $('subfile').files[0]; $('subfile').value = ''; if (!f) return; const n = importSubs(await f.text()); say(n ? 'Added ' + n + ' subtitle' + (n === 1 ? '' : 's') + ' from ' + f.name + '.' : 'No subtitles found in that file. Use an SRT or VTT file.'); };
  $('subexp').onclick = () => { if (!texts.length) return say('Add some text or subtitles first.'); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([exportSrt()], { type: 'application/x-subrip' })); a.download = 'govibe-subtitles.srt'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); say('Saved the text layers as an SRT file.'); };

  /* ---------- music ---------- */
  $('addmusic').onclick = () => $('musicfile').click();
  async function loadMusic(file) {
    try { const buf = await ctx.decodeAudioData(await file.arrayBuffer()); stopMusic(); music = { buf, src: null, file }; $('mname').textContent = file.name; if (playing) startMusic(tl); }
    catch (_) { say('Could not read that audio file.'); }
  }
  $('musicfile').onchange = () => $('musicfile').files[0] && loadMusic($('musicfile').files[0]);
  $('mvol').oninput = () => (musicGain.gain.value = $('mvol').value / 100);
  $('ovol').oninput = () => { ovolv = $('ovol').value / 100; };
  $('duck').onchange = () => { duck.on = $('duck').checked; };
  $('duckamt').oninput = () => { duck.db = +$('duckamt').value; };

  /* ---------- recording: screen, camera, voiceover ---------- */
  let scr = null;      // the recording in progress (screen or camera)
  async function stopScreen() { if (scr && scr.rec.state !== 'inactive') scr.rec.stop(); }
  const stopNote = (kind) => 'Recording the ' + kind + '. Press Stop when you are done; the clip is added to the timeline.';
  async function capture(btn, idle, kind, getStream, nameBase, preview) {
    if (scr) return stopScreen();
    if (!window.MediaRecorder || !navigator.mediaDevices) return say('This browser cannot record. Use Chrome, Edge or Firefox on a computer.');
    let stream; try { stream = await getStream(); } catch (e) { return say(e && e.name === 'NotAllowedError' ? 'Recording was cancelled or blocked. Allow access in the browser and try again.' : 'Could not start recording. Check that the device is connected.'); }
    const mime = TYPES.find((t) => MediaRecorder.isTypeSupported(t)), rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined), chunks = [];
    scr = { rec, stream, btn }; rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    if (preview) { const pv = $('campreview'); pv.srcObject = stream; pv.classList.remove('hidden'); pv.play().catch(() => {}); }
    const t0 = performance.now(), tick = setInterval(() => { btn.textContent = '■ Stop recording (' + Math.round((performance.now() - t0) / 1000) + ' s)'; }, 500);
    stream.getVideoTracks()[0].addEventListener('ended', () => stopScreen());
    rec.onstop = async () => {
      clearInterval(tick); stream.getTracks().forEach((t) => t.stop()); scr = null; btn.textContent = idle;
      if (preview) { const pv = $('campreview'); pv.srcObject = null; pv.classList.add('hidden'); }
      const type = rec.mimeType || mime || 'video/webm', blob = new Blob(chunks, { type }); if (blob.size < 1000) return say('Nothing was recorded.');
      await addFile(new File([blob], nameBase + ' ' + (clips.filter((c) => c.name.indexOf(nameBase) === 0).length + 1) + (/mp4/.test(type) ? '.mp4' : '.webm'), { type }));
    };
    btn.textContent = '■ Stop recording (0 s)'; rec.start(500); say(stopNote(kind));
  }
  $('screen').onclick = () => capture($('screen'), '● Record screen', 'screen', () => navigator.mediaDevices.getDisplayMedia({ video: true, audio: $('screenaud').checked }), 'Screen recording');
  $('camera').onclick = () => capture($('camera'), '● Record camera', 'camera', () => navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: true }), 'Camera recording', true);

  /* voiceover: records the microphone while the video plays, and places it where the recording began */
  let vrec = null;
  async function recordVoice() {
    if (vrec) { vrec.rec.stop(); return; }
    if (!clips.length) return say('Add a video clip first, then record the voiceover over it.');
    if (!window.MediaRecorder || !navigator.mediaDevices) return say('This browser cannot record. Use Chrome, Edge or Firefox on a computer.');
    let stream; try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); } catch (e) { return say(e && e.name === 'NotAllowedError' ? 'Microphone access was blocked. Allow it in the browser and try again.' : 'Could not start the microphone.'); }
    const rec = new MediaRecorder(stream), chunks = [], start = tl, btn = $('vorec');
    vrec = { rec }; rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const t0 = performance.now(), tick = setInterval(() => { btn.textContent = '■ Stop (' + Math.round((performance.now() - t0) / 1000) + ' s)'; }, 500);
    rec.onstop = async () => {
      clearInterval(tick); stream.getTracks().forEach((t) => t.stop()); vrec = null; btn.textContent = '● Record voiceover'; pause();
      const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' }); if (blob.size < 500) return say('Nothing was recorded.');
      try { const buf = await ctx.decodeAudioData(await blob.arrayBuffer()); voices.push({ buf, file: blob, start, name: 'Voiceover ' + (voices.length + 1), src: null }); refresh(); say('Voiceover added at ' + fmt(start) + '. Play the video to hear it.'); }
      catch (_) { say('Could not read the recording.'); }
    };
    btn.textContent = '■ Stop (0 s)'; rec.start(250); if (tl >= total() - 0.05) seek(0); play(); say('Recording the voiceover. Speak now, then press Stop.');
    const end = setInterval(() => { if (!vrec) return clearInterval(end); if (!playing && !exporting) { clearInterval(end); if (vrec.rec.state !== 'inactive') vrec.rec.stop(); } }, 300);
  }
  $('vorec').onclick = recordVoice;
  $('vovol').oninput = () => { voiceGain.gain.value = $('vovol').value / 100; };

  /* ---------- export ---------- */
  const TYPES = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  const RES = { 480: 480 / 720, 720: 1, 1080: 1.5, 2160: 3 }, QUAL = { low: 2.5e6, std: 5e6, high: 12e6 };
  async function exportRealtime() {
    if (!clips.length || exporting) return null;
    if (!window.MediaRecorder || !cv.captureStream) { say('This browser cannot record video. Try Chrome, Edge or Firefox.'); return null; }
    pause();
    const want = $('xfmt').value === 'wav' ? 'auto' : $('xfmt').value, pool = want === 'webm' ? TYPES.filter((t) => /webm/.test(t)) : want === 'mp4' ? TYPES.filter((t) => /mp4/.test(t)) : TYPES;
    const mime = pool.find((t) => MediaRecorder.isTypeSupported(t)), T = total(), fps = +$('xfps').value || 30, scale = RES[$('xres').value] || 1;
    if (want !== 'auto' && !mime) { say('This browser cannot make ' + want.toUpperCase() + ' files. Choose Automatic.'); return null; }
    outScale = scale; draw();
    const stream = cv.captureStream(fps); recDest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
    const bits = QUAL[$('xq').value] * scale * scale * (fps > 30 ? 1.5 : 1), rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: Math.round(bits) } : undefined), chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const stopped = new Promise((r) => (rec.onstop = r));
    exporting = true; exportCancelled = false; spk.gain.value = 0; refresh();
    $('cancel').classList.remove('hidden'); $('dl').classList.add('hidden');
    const ended = new Promise((r) => (exportDone = r));
    seek(0); rec.start(250); play();
    const prog = setInterval(() => say('Exporting… ' + Math.min(99, Math.round(tl / T * 100)) + '% (keep this tab open)'), 400);
    await ended; await new Promise((r) => setTimeout(r, 120));
    clearInterval(prog); rec.stop(); await stopped;
    exporting = false; exportDone = null; spk.gain.value = 1; outScale = 1; $('cancel').classList.add('hidden'); refresh();
    if (exportCancelled) { say('Export cancelled.'); return null; }
    const type = rec.mimeType || mime || 'video/webm', blob = new Blob(chunks, { type }), ext = /mp4/.test(type) ? 'mp4' : 'webm';
    const a = $('dl'); a.href = URL.createObjectURL(blob); a.download = 'govibe-video.' + ext; a.classList.remove('hidden');
    say('Done: ' + ext.toUpperCase() + ', ' + (blob.size / 1048576).toFixed(1) + ' MB. Use Download.');
    return blob;
  }

  /* ---------- fast export: frames and sound are made as quickly as the device can, not in real time (WebCodecs) ---------- */
  const loaded = {}; let fastFailed = false;
  const loadScript = (src) => new Promise((res, rej) => { if (loaded[src]) return res(); const sc = document.createElement('script'); sc.src = src; sc.onload = () => { loaded[src] = 1; res(); }; sc.onerror = () => rej(new Error('Could not load ' + src)); document.head.appendChild(sc); });
  const fastCapable = () => !!(window.VideoEncoder && window.AudioEncoder && window.VideoFrame && window.AudioData && window.OfflineAudioContext);
  async function pickCodecs(want, W, H, fps, bitrate) {
    const tries = [];
    if (want !== 'webm') tries.push({ kind: 'mp4', v: H >= 1500 || W >= 1500 && H >= 1500 ? 'avc1.640033' : (H >= 1000 || fps > 30) ? 'avc1.64002a' : 'avc1.640028', a: 'mp4a.40.2' });
    if (want !== 'mp4') tries.push({ kind: 'webm', v: 'vp09.00.10.08', a: 'opus', mv: 'V_VP9' }, { kind: 'webm', v: 'vp8', a: 'opus', mv: 'V_VP8' });
    for (const t of tries) {
      try {
        const v = await VideoEncoder.isConfigSupported({ codec: t.v, width: W, height: H, bitrate, framerate: fps }), a = await AudioEncoder.isConfigSupported({ codec: t.a, sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 });
        if (v.supported && a.supported) return t;
      } catch (_) { /* try the next one */ }
    }
    return null;
  }
  const SR = 48000;
  /* the finished soundtrack: every clip's sound with its fades and transitions, plus the music with ducking */
  async function mixAudio(T) {
    const N = Math.max(1, Math.ceil(T * SR)), oc = new OfflineAudioContext(2, N, SR); let acc = 0;
    for (let i = 0; i < clips.length; i++) {
      const c = clips[i], Ti = len(c);
      try {
        const ab = c.clean || await oc.decodeAudioData(await c.file.arrayBuffer()), src = oc.createBufferSource(), gn = oc.createGain(), n = Math.max(2, Math.ceil(Ti * 100) + 1), curve = new Float32Array(n);
        for (let k = 0; k < n; k++) curve[k] = ovolv * (c.mute ? 0 : c.vol) * audioOf(c, levelsAt(c, i, k / (n - 1) * Ti, Ti));
        src.buffer = ab; gn.gain.setValueCurveAtTime(curve, acc, Ti); src.connect(gn).connect(oc.destination); src.start(acc, c.in, c.out - c.in);
      } catch (_) { /* this clip has no sound track */ }
      acc += Ti;
    }
    const orig = await oc.startRendering();
    if (!music && !voices.length) return orig;
    const oc2 = new OfflineAudioContext(2, N, SR), os = oc2.createBufferSource(); os.buffer = orig; os.connect(oc2.destination); os.start(0);
    for (const v of voices) { try { const vb = await oc2.decodeAudioData(await v.file.arrayBuffer()), vs = oc2.createBufferSource(), vg = oc2.createGain(); vs.buffer = vb; vg.gain.value = voiceGain.gain.value; vs.connect(vg).connect(oc2.destination); vs.start(Math.max(0, v.start)); } catch (_) { /* skip */ } }
    if (!music) return oc2.startRendering();
    const mb = await oc2.decodeAudioData(await music.file.arrayBuffer()), ms = oc2.createBufferSource(), mg = oc2.createGain(); ms.buffer = mb;
    const base = musicGain.gain.value;
    if (duck.on) {                      // follow the original sound the same way the live ducking does
      const hop = 1024, steps = Math.ceil(N / hop), env = new Float32Array(steps), d = orig.getChannelData(0), tgtLow = Math.pow(10, -duck.db / 20); let gcur = 1;
      for (let k = 0; k < steps; k++) {
        let sum = 0, cnt = 0; for (let j = k * hop; j < Math.min(N, (k + 1) * hop); j++) { sum += d[j] * d[j]; cnt++; }
        const tgt = Math.sqrt(sum / Math.max(1, cnt)) > duck.thresh ? tgtLow : 1, tau = tgt < 1 ? 0.06 : 0.45; gcur += (tgt - gcur) * (1 - Math.exp(-(hop / SR) / tau)); env[k] = gcur * base;
      }
      mg.gain.setValueCurveAtTime(env.length > 1 ? env : new Float32Array([base, base]), 0, Math.max(0.01, steps * hop / SR));
    } else mg.gain.value = base;
    ms.connect(mg).connect(oc2.destination); ms.start(0); return oc2.startRendering();
  }
  const wavOf = (ab) => {
    const n = ab.length, ch = 2, v = new DataView(new ArrayBuffer(44 + n * ch * 2)), w = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + n * ch * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true); v.setUint32(24, ab.sampleRate, true); v.setUint32(28, ab.sampleRate * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * ch * 2, true);
    const L = ab.getChannelData(0), R = ab.numberOfChannels > 1 ? ab.getChannelData(1) : L; let o = 44;
    for (let i = 0; i < n; i++) { for (const x of [L[i], R[i]]) { const q = Math.max(-1, Math.min(1, x)); v.setInt16(o, q < 0 ? q * 0x8000 : q * 0x7fff, true); o += 2; } }
    return new Blob([v], { type: 'audio/wav' });
  };
  const nap = () => new Promise((r) => { const ch = new MessageChannel(); ch.port1.onmessage = () => { ch.port1.close(); r(); }; ch.port2.postMessage(0); });   // yields without the 4 ms timer delay
  function finishDownload(blob, name, label) {
    const a = $('dl'); a.href = URL.createObjectURL(blob); a.download = name; a.classList.remove('hidden');
    say('Done: ' + label + ', ' + (blob.size / 1048576).toFixed(1) + ' MB. Use Download.');
  }
  async function exportFast() {
    pause(); const want = $('xfmt').value, T = total(), fps = +$('xfps').value || 30, scale = RES[$('xres').value] || 1;
    exporting = true; exportCancelled = false; refresh(); $('cancel').classList.remove('hidden'); $('dl').classList.add('hidden'); outScale = scale;
    const t0 = performance.now(); let venc = null, aenc = null;
    try {
      say('Mixing the sound…'); await nap();
      const mix = await mixAudio(T);
      if (exportCancelled) { say('Export cancelled.'); return null; }
      if (want === 'wav') { const b = wavOf(mix); finishDownload(b, 'govibe-audio.wav', 'WAV audio'); return b; }
      draw(); const [W, H] = dims(), bitrate = Math.round(QUAL[$('xq').value] * scale * scale * (fps > 30 ? 1.5 : 1)), pick = await pickCodecs(want, W, H, fps, bitrate);
      if (!pick) { fastFailed = true; return null; }
      await loadScript(pick.kind === 'mp4' ? 'js/vendor/mp4-muxer.js' : 'js/vendor/webm-muxer.js');
      const M = pick.kind === 'mp4' ? Mp4Muxer : WebMMuxer, target = new M.ArrayBufferTarget();
      const muxer = new M.Muxer(pick.kind === 'mp4' ? { target, video: { codec: 'avc', width: W, height: H }, audio: { codec: 'aac', numberOfChannels: 2, sampleRate: SR }, fastStart: 'in-memory', firstTimestampBehavior: 'offset' }
        : { target, video: { codec: pick.mv, width: W, height: H, frameRate: fps }, audio: { codec: 'A_OPUS', numberOfChannels: 2, sampleRate: SR }, firstTimestampBehavior: 'offset' });
      let fail = null; const onErr = (e) => { fail = e; };
      venc = new VideoEncoder({ output: (ch, meta) => muxer.addVideoChunk(ch, meta), error: onErr }); venc.configure({ codec: pick.v, width: W, height: H, bitrate, framerate: fps });
      aenc = new AudioEncoder({ output: (ch, meta) => muxer.addAudioChunk(ch, meta), error: onErr }); aenc.configure({ codec: pick.a, sampleRate: SR, numberOfChannels: 2, bitrate: 128000 });
      /* sound first (it is already rendered), then the pictures one by one */
      const L = mix.getChannelData(0), R = mix.numberOfChannels > 1 ? mix.getChannelData(1) : L, step = 4800;
      for (let o = 0; o < mix.length; o += step) {
        const n = Math.min(step, mix.length - o), buf = new Float32Array(n * 2); buf.set(L.subarray(o, o + n), 0); buf.set(R.subarray(o, o + n), n);
        const ad = new AudioData({ format: 'f32-planar', sampleRate: SR, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(o / SR * 1e6), data: buf }); aenc.encode(ad); ad.close();
        while (aenc.encodeQueueSize > 16) await nap();
      }
      const frames = Math.max(1, Math.ceil(T * fps));
      for (let f = 0; f < frames; f++) {
        if (exportCancelled || fail) break;
        const t = Math.min(Math.max(0, T - 0.001), f / fps), loc = locate(t), c = clips[loc.i];
        active = loc.i; tl = t; await seekTo(c.v, c.in + srcAt(c, loc.off)); draw();
        const vf = new VideoFrame(cv, { timestamp: Math.round(f * 1e6 / fps), duration: Math.round(1e6 / fps) }); venc.encode(vf, { keyFrame: f % (fps * 2) === 0 }); vf.close();
        while (venc.encodeQueueSize > 12) await nap();
        if (f % 5 === 0) { say('Exporting fast… ' + Math.min(99, Math.round(f / frames * 100)) + '% (keep this tab open)'); await nap(); }
      }
      if (exportCancelled) { say('Export cancelled.'); return null; }
      await venc.flush(); await aenc.flush(); if (fail) throw fail; muxer.finalize();
      const blob = new Blob([target.buffer], { type: pick.kind === 'mp4' ? 'video/mp4' : 'video/webm' });
      finishDownload(blob, 'govibe-video.' + pick.kind, pick.kind.toUpperCase() + ' in ' + ((performance.now() - t0) / 1000).toFixed(1) + ' s'); return blob;
    } catch (e) { fastFailed = true; return null; }
    finally { try { if (venc && venc.state !== 'closed') venc.close(); if (aenc && aenc.state !== 'closed') aenc.close(); } catch (_) { /* closed */ } exporting = false; outScale = 1; $('cancel').classList.add('hidden'); draw(); refresh(); seek(0); }
  }
  /* choose the fast path when this browser and this project allow it, otherwise record in real time */
  /* animated GIF: frames are drawn one by one, like fast export, then packed with gifenc (MIT). No sound; at most 60 seconds, at a smaller size. */
  async function exportGif() {
    const T = Math.min(60, total()), fps = Math.min(15, +$('xfps').value || 15), scale = Math.min(RES[$('xres').value] || 1, 0.5);
    pause(); exporting = true; exportCancelled = false; refresh(); $('cancel').classList.remove('hidden'); $('dl').classList.add('hidden'); outScale = scale;
    const t0 = performance.now();
    try {
      await loadScript('js/vendor/gifenc.js'); const G = window.GIFenc, enc = G.GIFEncoder(); draw(); const [W, H] = dims(), frames = Math.max(1, Math.ceil(T * fps)), delay = Math.round(1000 / fps);
      for (let f = 0; f < frames; f++) {
        if (exportCancelled) break;
        const t = Math.min(Math.max(0, total() - 0.001), f / fps), loc = locate(t), c = clips[loc.i];
        active = loc.i; tl = t; await seekTo(c.v, c.in + srcAt(c, loc.off)); draw();
        const px = g.getImageData(0, 0, W, H).data, pal = G.quantize(px, 256), idx = G.applyPalette(px, pal);
        enc.writeFrame(idx, W, H, { palette: pal, delay, repeat: 0 });
        if (f % 3 === 0) { say('Making the GIF… ' + Math.min(99, Math.round(f / frames * 100)) + '% (keep this tab open)'); await nap(); }
      }
      if (exportCancelled) { say('Export cancelled.'); return null; }
      enc.finish(); const blob = new Blob([enc.bytes()], { type: 'image/gif' });
      finishDownload(blob, 'govibe-video.gif', 'GIF, ' + W + ' × ' + H + (total() > 60 ? ', first 60 s' : '') + ', in ' + ((performance.now() - t0) / 1000).toFixed(1) + ' s'); return blob;
    } catch (e) { say('Could not make the GIF: ' + ((e && e.message) || 'unknown error') + '.'); return null; }
    finally { exporting = false; outScale = 1; $('cancel').classList.add('hidden'); draw(); refresh(); seek(0); }
  }
  async function exportVideo() {
    if (!clips.length || exporting) return null;
    if ($('xfmt').value === 'gif') return exportGif();
    const wav = $('xfmt').value === 'wav', slow = clips.some((c) => c.speed !== 1 || c.speed2 !== 1);
    if (wav) {
      if (!fastCapable()) { say('Audio only export needs a recent Chrome or Edge.'); return null; }
      if (slow) { say('Audio only export does not support speed changes yet. Reset the speed first.'); return null; }
      return exportFast();
    }
    if ($('xmode').value === 'fast' && fastCapable() && !slow) {
      fastFailed = false; const b = await exportFast(); if (b || exportCancelled || !fastFailed) return b;
    }
    const r = await exportRealtime();
    if (r && $('xmode').value === 'fast') say($('status').textContent + (slow ? ' (Clips with a speed change use real time export.)' : fastCapable() ? ' (Fast export did not work here, so real time export was used.)' : ' (This browser has no fast export, so real time export was used.)'));
    return r;
  }
  $('export').onclick = exportVideo;
  $('cancel').onclick = () => { exportCancelled = true; finish(); };


  /* ---------- Auto and Guided: a kit that sets the editor up from a few choices ---------- */
  const TPL = {
    social: { aspect: '9:16', cut: true, loud: true, fade: true, trans: 'fade', grade: 'vivid', res: '1080', mute: false },
    square: { aspect: '1:1', cut: false, loud: true, fade: true, trans: 'fade', grade: 'warm', res: '1080', mute: false },
    youtube: { aspect: '16:9', cut: false, loud: true, fade: true, trans: 'dip', grade: 'normal', res: '1080', mute: false, title: true },
    music: { aspect: '16:9', cut: false, loud: false, fade: true, trans: 'fade', grade: 'vintage', res: '1080', mute: true, title: true },
    talk: { aspect: '16:9', cut: true, loud: true, fade: true, trans: 'cut', grade: 'normal', res: '1080', mute: false }
  };
  async function soundOf(c) {
    try {
      const ab = await ctx.decodeAudioData((await c.file.arrayBuffer()).slice(0)), sr = ab.sampleRate, a = Math.floor(c.in * sr), b = Math.min(ab.length, Math.ceil(c.out * sr)), d = ab.getChannelData(0);
      let sum = 0, n = 0; for (let i = a; i < b; i += 4) { sum += d[i] * d[i]; n++; }
      return n ? 10 * Math.log10(sum / n + 1e-12) : null;
    } catch (_) { return null; }
  }
  function sizeOf() { const c = clips[0]; if (!c) return 'landscape'; const w = c.v.videoWidth, h = c.v.videoHeight; return h > w * 1.1 ? 'portrait' : w > h * 1.1 ? 'landscape' : 'square'; }
  async function apply(cfg) {
    const log = []; if (!clips.length) return log; pause();
    let as = cfg.aspect; if (!as || as === 'auto') { const o = sizeOf(); as = o === 'portrait' ? '9:16' : o === 'square' ? '1:1' : '16:9'; }
    aspect = as; $('aspect').value = as; log.push('Video shape set to ' + as + '.');
    if (cfg.cut) {
      const orig = clips.slice(); let removed = 0;
      for (const oc of orig) {
        const i = clips.indexOf(oc); if (i < 0) continue;
        const r = await findSilence(oc, -42, 0.6);
        if (r && r.pauses) { removed += r.removed; await cutSilence(i, r.keep); }
      }
      log.push(removed > 0 ? 'Cut ' + removed.toFixed(1) + ' seconds of silent pauses.' : 'No long pauses to cut.');
    }
    if (cfg.loud) {
      let n = 0; const levels = [];
      for (const c of clips) { const db = await soundOf(c); levels.push(db); }
      const have = levels.filter((x) => x != null && x > -70); const target = -20;
      clips.forEach((c, k) => { const db = levels[k]; if (db == null || db <= -70) return; c.vol = clamp(Math.pow(10, (target - db) / 20), 0.3, 2); applyVol(c); n++; });
      log.push(n ? 'Evened out the loudness of ' + n + ' clip' + (n === 1 ? '' : 's') + '.' : 'No sound found to even out.');
    }
    if (cfg.mute) { clips.forEach((c) => { c.mute = true; applyVol(c); }); log.push('Video sound switched off.'); }
    clips.forEach((c, k) => { c.fi = 0; c.fo = 0; c.trans = 'cut'; c.grade = { ...(GRADES[cfg.grade] || GRADES.normal) }; if (k > 0 && cfg.trans && cfg.trans !== 'cut') { c.trans = cfg.trans; c.tdur = Math.min(0.6, Math.max(0.2, len(c) / 3)); } });
    if (cfg.grade && cfg.grade !== 'normal') log.push('Look: ' + cfg.grade + '.');
    if (clips.length > 1 && cfg.trans && cfg.trans !== 'cut') log.push('Joined the clips with a ' + (cfg.trans === 'fade' ? 'crossfade' : cfg.trans === 'dip' ? 'dip to black' : cfg.trans) + '.');
    if (cfg.fade) {
      const f = clips[0], l = clips[clips.length - 1]; f.fi = Math.min(0.5, len(f) / 4); l.fo = Math.min(0.7, len(l) / 4); log.push('Fade in at the start and out at the end.');
    }
    if (cfg.title && cfg.title.text) {
      texts.length = 0; texts.push({ text: cfg.title.text, start: 0, end: Math.min(3, Math.max(1, total() - 0.2)), pos: cfg.title.pos || 'middle', size: as === '16:9' ? 72 : 64, color: '#ffffff', font: 'sans', style: 'outline', anim: 'fade', alen: 0.5 });
      log.push('Added the title "' + cfg.title.text + '".');
    }
    if (music) {
      musicGain.gain.value = clamp(cfg.mvol == null ? 0.3 : cfg.mvol, 0, 1); $('mvol').value = Math.round(musicGain.gain.value * 100);
      duck.on = !cfg.mute; $('duck').checked = duck.on; log.push(duck.on ? 'Music added, and it dips under speech.' : 'Music added.');
    }
    if (cfg.res) { $('xres').value = cfg.res; }
    refresh(); seek(0); log.push('Total length ' + fmt(total()) + '. Press Export when you are happy.');
    return log;
  }
  const auto = () => { const o = sizeOf(); return apply({ aspect: 'auto', cut: true, loud: true, fade: true, trans: clips.length > 1 ? 'fade' : 'cut', grade: 'normal', mute: false, mvol: 0.3, res: o === 'portrait' ? '1080' : '720' }); };
  function hubSum() {
    const n = clips.length, t = total();
    $('hsum').textContent = n ? n + ' video' + (n === 1 ? '' : 's') + ', ' + fmt(t) + (music ? ', with music.' : '.') : 'No videos yet. Add one or more, in the order you want them.';
    $('hauto').disabled = $('hgo').disabled = !n;
  }
  const fill = (ul, log) => { ul.replaceChildren(...log.map((t) => { const li = document.createElement('li'); li.textContent = t; return li; })); };
  $('hadd').onclick = () => $('hfile').click();
  $('hfile').onchange = async () => { for (const f of [...$('hfile').files]) await addFile(f); $('hfile').value = ''; hubSum(); };
  $('hmus').onclick = () => $('hmusic').click();
  $('hmusic').onchange = async () => { const f = $('hmusic').files[0]; $('hmusic').value = ''; if (f) { await loadMusic(f); hubSum(); } };
  $('hauto').onclick = async () => { $('hauto').disabled = true; say('Working on it...'); try { const l = await auto(); fill($('hauto-log'), l); say('Done. Check the preview, then export.'); } finally { hubSum(); } };
  const gcfg = () => ({ aspect: $('gaspect').value, cut: $('gcut').checked, loud: $('gloud').checked, fade: $('gfade').checked, mute: $('gmute').checked, trans: $('gtrans').value, grade: $('ggrade').value, res: $('gres').value, mvol: (+$('gmvol').value || 0) / 100, title: $('gtitle').value.trim() ? { text: $('gtitle').value.trim(), pos: $('gtpos').value } : null });
  function setG(t) {
    const x = TPL[t]; if (!x) return;
    $('gaspect').value = x.aspect; $('gcut').checked = x.cut; $('gloud').checked = x.loud; $('gfade').checked = x.fade; $('gmute').checked = x.mute; $('gtrans').value = x.trans; $('ggrade').value = x.grade; $('gres').value = x.res;
  }
  const mark = () => document.querySelectorAll('.tpl').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.t === $('gtpl').value)));
  $('gtpl').onchange = () => { setG($('gtpl').value); mark(); };
  document.querySelectorAll('.tpl').forEach((b) => (b.onclick = () => { $('gtpl').value = b.dataset.t; $('gtpl').onchange(); }));
  ['gaspect', 'gcut', 'gloud', 'gfade', 'gmute', 'gtrans', 'ggrade', 'gres'].forEach((id) => $(id).addEventListener('change', () => { $('gtpl').value = 'custom'; mark(); }));
  $('hgo').onclick = async () => { $('hgo').disabled = true; say('Working on it...'); try { const l = await apply(gcfg()); fill($('hg-log'), l); say('Done. Check the preview, then export.'); } finally { hubSum(); } };
  setG('social');
  const showFiles = () => { const pro = $('tab-p').getAttribute('aria-selected') === 'true'; $('hubfiles').hidden = pro; };
  ['tab-a', 'tab-g', 'tab-p'].forEach((id) => $(id).addEventListener('click', showFiles));
  $('tab-p').addEventListener('keydown', showFiles); $('tab-a').addEventListener('keydown', showFiles); $('tab-g').addEventListener('keydown', showFiles);
  window.GVVideoKit = { apply, auto, templates: TPL, refreshSummary: hubSum };
  if (/[?&]tab=pro\b/.test(location.search)) $('tab-p').click();

  if (/[?&]gvtest\b/.test(location.search)) window.__ve = {
    addFile, loadMusic, exportVideo, seek, hubSum, play, pause, ctx, estimateShift, smoothPath, parseSubs, importSubs, exportSrt, keyPixels, stabilise, lenOf, srcAt, tAt, hasFilter,
    get clips() { return clips; }, get texts() { return texts; }, get duckGain() { return musicDuck.gain.value; }, get screen() { return !!scr; }, get overlays() { return overlays; }, get drawings() { return drawings; }, get active() { return active; }, get voices() { return voices; }, addOverlay, findSilence, cutSilence, recordVoice, draw,
    get state() { return { clips: clips.map((c) => ({ vol: c.vol, mute: c.mute, xf: c.xf, dur: c.dur, in: c.in, out: c.out, fi: c.fi, fo: c.fo, trans: c.trans, speed: c.speed, speed2: c.speed2 })), texts: texts.length, tl, total: total(), playing }; }
  };
})();
