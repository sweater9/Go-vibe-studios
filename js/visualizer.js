/* GoVibe Mix — music visualizer: turns an audio file into a video. The picture is drawn from our own FFT analysis, frame by frame, so the preview and the export match exactly. Fast export uses WebCodecs (MP4 or WebM); older browsers record in real time. Nothing is uploaded. */
(() => {
  const $ = (id) => document.getElementById(id), FFT = window.GVSpec.fft;
  const say = (t) => { $('xstatus').textContent = t; };
  const PAL = { violet: ['#8b5cf6', '#22d3ee'], sunset: ['#ff5e62', '#ffb23e'], neon: ['#00f5a0', '#00d9f5'], ice: ['#e0f2ff', '#7dd3fc'], fire: ['#ffb23e', '#ef4444'], mono: ['#ffffff', '#9a98c4'] };
  const SIZE = 4096, WIN = Float64Array.from({ length: SIZE }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / SIZE));
  let buf = null, mono = null, img = null, ctxA = null, srcNode = null, playing = false, t0Play = 0, offset = 0, raf = 0, last = 0, busy = false, cancelled = false;
  let st = { bars: null, bass: 0, wave: null };

  /* ---------- settings ---------- */
  const opts = () => ({ style: $('vstyle').value, c1: $('vc1').value, c2: $('vc2').value, bg: $('vbg').value, dark: +$('vdark').value / 100, sens: +$('vsens').value / 100, n: +$('vbars').value, pulse: $('vpulse').checked, prog: $('vprog').checked, title: $('vtitle').value.trim(), sub: $('vsub').value.trim(), tpos: $('vtpos').value });
  function dims(forExport) {
    const asp = $('xasp').value, res = forExport ? +$('xres').value : (asp === '9:16' ? 405 : asp === '1:1' ? 640 : 540);
    if (!forExport) return asp === '16:9' ? [960, 540] : asp === '9:16' ? [405, 720] : [640, 640];
    const long = Math.round(res * 16 / 9 / 2) * 2; return asp === '16:9' ? [long, res] : asp === '9:16' ? [res, long] : [res, res];
  }

  /* ---------- analysis: spectrum bars, bass level and a short waveform at time t ---------- */
  const re = new Float64Array(SIZE), im = new Float64Array(SIZE);
  function analyse(t, dt, n) {
    const rate = buf.sampleRate, c = Math.round(t * rate), a = c - SIZE / 2;
    for (let i = 0; i < SIZE; i++) { const p = a + i; re[i] = (p >= 0 && p < mono.length ? mono[p] : 0) * WIN[i]; im[i] = 0; }
    FFT(re, im);
    const bars = new Float32Array(n), nyq = rate / 2, lo = 40, hi = Math.min(16000, nyq * 0.95);
    for (let b = 0; b < n; b++) {
      const f1 = lo * Math.pow(hi / lo, b / n), f2 = lo * Math.pow(hi / lo, (b + 1) / n), k1 = Math.max(1, Math.floor(f1 / nyq * SIZE / 2)), k2 = Math.max(k1 + 1, Math.ceil(f2 / nyq * SIZE / 2));
      let m = 0; for (let k = k1; k < k2 && k < SIZE / 2; k++) m = Math.max(m, Math.hypot(re[k], im[k]));
      const amp = 4 * m / SIZE, db = amp > 1e-7 ? 20 * Math.log10(amp) : -140, tilt = 2.6 * Math.log2(Math.sqrt(f1 * f2) / 100);
      bars[b] = Math.max(0, Math.min(1, (db + tilt + 78) / 62));
    }
    const prev = st.bars && st.bars.length === n ? st.bars : new Float32Array(n), out = new Float32Array(n), rel = Math.min(1, dt * 8);
    for (let b = 0; b < n; b++) out[b] = bars[b] > prev[b] ? prev[b] + (bars[b] - prev[b]) * Math.min(1, dt * 40 + 0.3) : prev[b] - (prev[b] - bars[b]) * rel;
    let bass = 0; const nb = Math.max(2, Math.round(n / 12)); for (let b = 0; b < nb; b++) bass += out[b]; bass /= nb;
    const wave = new Float32Array(256), ws = 4; for (let i = 0; i < 256; i++) { let s = 0; for (let k = 0; k < ws; k++) { const p = c + (i - 128) * ws + k; s += p >= 0 && p < mono.length ? mono[p] : 0; } wave[i] = s / ws; }
    st = { bars: out, bass: Math.max(bass, st.bass * (1 - Math.min(1, dt * 6))), wave };
    return st;
  }

  /* ---------- drawing ---------- */
  function cover(g, im2, W, H, z) { const s = Math.max(W / im2.width, H / im2.height) * z, w = im2.width * s, h = im2.height * s; g.drawImage(im2, (W - w) / 2, (H - h) / 2, w, h); }
  function drawFrame(g, W, H, t, a, o, total) {
    const M = Math.min(W, H), pulse = o.pulse ? a.bass : 0;
    // background
    if (o.bg === 'image' && img) { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); cover(g, img, W, H, 1.04 + pulse * 0.05); g.fillStyle = 'rgba(8,8,16,' + o.dark + ')'; g.fillRect(0, 0, W, H); }
    else if (o.bg === 'solid') { g.fillStyle = '#0b0b14'; g.fillRect(0, 0, W, H); }
    else { const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#0b0b14'); gr.addColorStop(1, mix(o.c1, '#0b0b14', 0.72)); g.fillStyle = gr; g.fillRect(0, 0, W, H); if (o.pulse) { g.fillStyle = hexA(o.c2, pulse * 0.14); g.fillRect(0, 0, W, H); } }
    const n = a.bars.length, grad = (x0, y0, x1, y1) => { const gr = g.createLinearGradient(x0, y0, x1, y1); gr.addColorStop(0, o.c1); gr.addColorStop(1, o.c2); return gr; };
    if (o.style === 'bars' || o.style === 'mirror') {
      const x0 = W * 0.08, span = W * 0.84, bw = span / n, gap = bw * 0.28, base = o.style === 'bars' ? H * 0.74 : H * 0.5, maxH = o.style === 'bars' ? H * 0.5 : H * 0.34;
      for (let b = 0; b < n; b++) {
        const v = Math.min(1, a.bars[b] * o.sens), h = Math.max(H * 0.004, v * maxH), x = x0 + b * bw + gap / 2, w = bw - gap;
        if (o.style === 'bars') { g.fillStyle = grad(0, base - maxH, 0, base); rr(g, x, base - h, w, h, w / 2); g.fill(); g.fillStyle = hexA(o.c2, 0.16); rr(g, x, base + 2, w, h * 0.35, w / 2); g.fill(); }
        else { g.fillStyle = grad(0, base - maxH, 0, base + maxH); rr(g, x, base - h, w, h * 2, w / 2); g.fill(); }
      }
    } else if (o.style === 'circle') {
      const cx = W / 2, cy = H * (o.title || o.sub ? 0.46 : 0.5), r0 = M * (0.17 + pulse * 0.025), count = n * 2, maxL = M * 0.2;
      g.save(); g.translate(cx, cy);
      for (let i = 0; i < count; i++) {
        const b = i < n ? i : count - 1 - i, v = Math.min(1, a.bars[b] * o.sens), L = Math.max(M * 0.004, v * maxL), ang = i / count * Math.PI * 2 - Math.PI / 2;
        g.save(); g.rotate(ang); g.fillStyle = i < n ? o.c1 : o.c2; const w = Math.max(2, 2 * Math.PI * r0 / count * 0.6); rr(g, r0 + M * 0.01, -w / 2, L, w, w / 2); g.fill(); g.restore();
      }
      g.beginPath(); g.arc(0, 0, r0, 0, Math.PI * 2); g.closePath();
      if (img) { g.save(); g.clip(); g.drawImage(img, -r0 * Math.max(1, img.width / img.height), -r0 * Math.max(1, img.height / img.width), 2 * r0 * Math.max(1, img.width / img.height), 2 * r0 * Math.max(1, img.height / img.width)); g.restore(); g.lineWidth = M * 0.006; g.strokeStyle = o.c1; g.stroke(); }
      else { g.fillStyle = hexA(o.c1, 0.18); g.fill(); g.lineWidth = M * 0.006; g.strokeStyle = o.c1; g.stroke(); }
      g.restore();
    } else { // wave
      const w = a.wave, mid = H * 0.5, amp = H * 0.34 * o.sens, x0 = W * 0.06, span = W * 0.88;
      g.lineWidth = Math.max(2, M * 0.008); g.lineJoin = 'round'; g.lineCap = 'round'; g.strokeStyle = grad(x0, 0, x0 + span, 0); g.shadowColor = o.c1; g.shadowBlur = M * 0.03;
      g.beginPath(); for (let i = 0; i < w.length; i++) { const x = x0 + i / (w.length - 1) * span, y = mid - Math.max(-1, Math.min(1, w[i] * 2.2)) * amp; i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); g.shadowBlur = 0;
    }
    // text
    if (o.title || o.sub) {
      const ty = o.tpos === 'top' ? H * 0.1 : o.tpos === 'center' ? H * 0.5 : H * 0.88; g.textAlign = 'center'; g.textBaseline = 'middle'; g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = M * 0.012;
      if (o.title) { g.fillStyle = '#fff'; g.font = '800 ' + fit(g, o.title, W * 0.86, M * 0.07) + 'px system-ui, sans-serif'; g.fillText(o.title, W / 2, ty - (o.sub ? M * 0.03 : 0)); }
      if (o.sub) { g.fillStyle = 'rgba(255,255,255,.82)'; g.font = '600 ' + fit(g, o.sub, W * 0.8, M * 0.038) + 'px system-ui, sans-serif'; g.fillText(o.sub, W / 2, ty + (o.title ? M * 0.045 : 0)); }
      g.shadowBlur = 0;
    }
    if (o.prog && total > 0) { const p = Math.max(0, Math.min(1, t / total)); g.fillStyle = 'rgba(255,255,255,.14)'; g.fillRect(0, H - M * 0.012, W, M * 0.012); g.fillStyle = grad(0, 0, W, 0); g.fillRect(0, H - M * 0.012, W * p, M * 0.012); }
  }
  const rr = (g, x, y, w, h, r) => { r = Math.min(r, w / 2, h / 2); g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
  const fit = (g, text, maxW, size) => { g.font = '800 ' + size + 'px system-ui, sans-serif'; const w = g.measureText(text).width; return Math.max(10, Math.round(w > maxW ? size * maxW / w : size)); };
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)), hexA = (h, a) => { const c = rgb(h); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + Math.max(0, Math.min(1, a)) + ')'; };
  const mix = (a, b, f) => { const x = rgb(a), y = rgb(b); return 'rgb(' + x.map((v, i) => Math.round(v * (1 - f) + y[i] * f)).join(',') + ')'; };

  /* ---------- preview ---------- */
  const cv = $('cv'), g = cv.getContext('2d');
  function size() { const [w, h] = dims(false); if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; } }
  const now = () => (playing ? Math.min(buf.duration, offset + (ctxA.currentTime - t0Play)) : offset);
  function frame() {
    raf = requestAnimationFrame(frame); if (!buf) return; size();
    const t = now(), tm = performance.now(), dt = Math.min(0.1, (tm - last) / 1000 || 0.016); last = tm;
    if (playing && t >= buf.duration - 0.01) { pause(); offset = 0; }
    const a = analyse(t, dt, opts().n); drawFrame(g, cv.width, cv.height, t, a, opts(), buf.duration);
    $('time').textContent = fmt(t) + ' / ' + fmt(buf.duration); if (!seeking) $('seek').value = Math.round(t / buf.duration * 1000);
  }
  const fmt = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
  let seeking = false;
  function play() { if (!buf) return; ctxA = ctxA || new (window.AudioContext || window.webkitAudioContext)(); ctxA.resume(); stopSrc(); srcNode = ctxA.createBufferSource(); srcNode.buffer = buf; srcNode.connect(ctxA.destination); srcNode.start(0, offset); t0Play = ctxA.currentTime; playing = true; $('play').textContent = '❚❚ Pause'; }
  function stopSrc() { try { srcNode && srcNode.stop(); } catch (_) { /* already stopped */ } srcNode = null; }
  function pause() { if (playing) { offset = now(); } stopSrc(); playing = false; $('play').textContent = '▶ Play'; }
  $('play').onclick = () => (playing ? pause() : play());
  $('seek').addEventListener('input', () => { seeking = true; offset = $('seek').value / 1000 * buf.duration; if (playing) play(); });
  $('seek').addEventListener('change', () => { seeking = false; });

  /* ---------- loading ---------- */
  async function load(file) {
    try {
      ctxA = ctxA || new (window.AudioContext || window.webkitAudioContext)(); buf = await ctxA.decodeAudioData(await file.arrayBuffer()); setBuffer(buf, file.name);
    } catch (_) { $('dropmsg').textContent = 'Could not read that file. Try an MP3, WAV, OGG or M4A.'; }
  }
  function setBuffer(b, name) {
    buf = b; mono = new Float32Array(b.length); for (let c = 0; c < b.numberOfChannels; c++) { const d = b.getChannelData(c); for (let i = 0; i < d.length; i++) mono[i] += d[i] / b.numberOfChannels; }
    offset = 0; pause(); st = { bars: null, bass: 0, wave: null }; $('viz').classList.remove('hidden'); $('drop').classList.add('hidden');
    if (!$('vtitle').value) $('vtitle').value = name.replace(/\.[a-z0-9]{2,4}$/i, '').replace(/_/g, ' '); $('xlen').value = Math.min(600, Math.ceil(b.duration)); $('xlen').max = Math.min(600, Math.ceil(b.duration)); $('xstart').max = Math.floor(b.duration);
    size(); cancelAnimationFrame(raf); frame();
  }
  $('drop').addEventListener('click', () => $('file').click()); $('drop').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('file').click(); } });
  $('drop').addEventListener('dragover', (e) => e.preventDefault()); $('drop').addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer.files[0]) load(e.dataTransfer.files[0]); });
  $('file').onchange = () => { if ($('file').files[0]) load($('file').files[0]); };
  $('vimg').onchange = () => { const f = $('vimg').files[0]; if (!f) return; const u = URL.createObjectURL(f), im2 = new Image(); im2.onload = () => { img = im2; $('vbg').value = 'image'; }; im2.src = u; };
  $('vpal').onchange = () => { const p = PAL[$('vpal').value]; if (p) { $('vc1').value = p[0]; $('vc2').value = p[1]; } };
  ['vc1', 'vc2'].forEach((id) => $(id).addEventListener('input', () => { $('vpal').value = 'custom'; }));

  /* ---------- export ---------- */
  const nap = () => new Promise((r) => setTimeout(r, 0)), loaded = {};
  const loadScript = (src) => new Promise((res, rej) => { if (loaded[src]) return res(); const s = document.createElement('script'); s.src = src; s.onload = () => { loaded[src] = 1; res(); }; s.onerror = () => rej(new Error('Could not load ' + src)); document.head.appendChild(s); });
  const fast = () => !!(window.VideoEncoder && window.AudioEncoder && window.VideoFrame && window.AudioData && window.OfflineAudioContext);
  async function pick(want, W, H, fps, bitrate) {
    const tries = []; if (want !== 'webm') tries.push({ kind: 'mp4', v: H >= 1000 ? 'avc1.64002a' : 'avc1.640028', a: 'mp4a.40.2' });
    if (want !== 'mp4') tries.push({ kind: 'webm', v: 'vp09.00.10.08', a: 'opus', mv: 'V_VP9' }, { kind: 'webm', v: 'vp8', a: 'opus', mv: 'V_VP8' });
    for (const t of tries) { try { const v = await VideoEncoder.isConfigSupported({ codec: t.v, width: W, height: H, bitrate, framerate: fps }), a = await AudioEncoder.isConfigSupported({ codec: t.a, sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 }); if (v.supported && a.supported) return t; } catch (_) { /* next */ } }
    return null;
  }
  function range() { const s = Math.max(0, Math.min(buf.duration - 0.5, +$('xstart').value || 0)), l = +$('xlen').value > 0 ? +$('xlen').value : buf.duration - s; return [s, Math.min(Math.min(600, l), buf.duration - s)]; }
  async function exportFast() {
    const [W, H] = dims(true), fps = +$('xfps').value, [s0, len] = range(), o = opts(), bitrate = Math.round((H >= 1000 ? 5e6 : H >= 700 ? 2.8e6 : 1.4e6) * (fps > 30 ? 1.4 : 1)), p = await pick($('xfmt').value, W, H, fps, bitrate);
    if (!p) return null;
    const SR = 48000, N = Math.ceil(len * SR), oc = new OfflineAudioContext(2, N, SR), sn = oc.createBufferSource(), gn = oc.createGain(); sn.buffer = buf; sn.connect(gn); gn.connect(oc.destination);
    gn.gain.setValueAtTime(0, 0); gn.gain.linearRampToValueAtTime(1, 0.03); gn.gain.setValueAtTime(1, Math.max(0.04, len - 0.4)); gn.gain.linearRampToValueAtTime(0, len); sn.start(0, s0, len);
    say('Preparing the sound…'); await nap(); const mixd = await oc.startRendering();
    await loadScript(p.kind === 'mp4' ? 'js/vendor/mp4-muxer.js' : 'js/vendor/webm-muxer.js');
    const M = p.kind === 'mp4' ? Mp4Muxer : WebMMuxer, target = new M.ArrayBufferTarget();
    const muxer = new M.Muxer(p.kind === 'mp4' ? { target, video: { codec: 'avc', width: W, height: H }, audio: { codec: 'aac', numberOfChannels: 2, sampleRate: SR }, fastStart: 'in-memory', firstTimestampBehavior: 'offset' } : { target, video: { codec: p.mv, width: W, height: H, frameRate: fps }, audio: { codec: 'A_OPUS', numberOfChannels: 2, sampleRate: SR }, firstTimestampBehavior: 'offset' });
    let fail = null; const onErr = (e) => { fail = e; };
    const venc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: onErr }); venc.configure({ codec: p.v, width: W, height: H, bitrate, framerate: fps });
    const aenc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: onErr }); aenc.configure({ codec: p.a, sampleRate: SR, numberOfChannels: 2, bitrate: 128000 });
    try {
      const L = mixd.getChannelData(0), R = mixd.getChannelData(1), step = 4800;
      for (let i = 0; i < mixd.length; i += step) { const n = Math.min(step, mixd.length - i), b = new Float32Array(n * 2); b.set(L.subarray(i, i + n), 0); b.set(R.subarray(i, i + n), n); const ad = new AudioData({ format: 'f32-planar', sampleRate: SR, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(i / SR * 1e6), data: b }); aenc.encode(ad); ad.close(); while (aenc.encodeQueueSize > 16) await nap(); }
      const ec = document.createElement('canvas'); ec.width = W; ec.height = H; const eg = ec.getContext('2d'), frames = Math.max(1, Math.ceil(len * fps)); st = { bars: null, bass: 0, wave: null };
      for (let f = 0; f < frames; f++) {
        if (cancelled || fail) break;
        const t = s0 + f / fps, a = analyse(t, 1 / fps, o.n); drawFrame(eg, W, H, t - s0, a, o, len);
        const vf = new VideoFrame(ec, { timestamp: Math.round(f * 1e6 / fps), duration: Math.round(1e6 / fps) }); venc.encode(vf, { keyFrame: f % (fps * 2) === 0 }); vf.close();
        while (venc.encodeQueueSize > 12) await nap();
        if (f % 6 === 0) { $('xprog').value = Math.round(f / frames * 100); say('Making the video… ' + Math.round(f / frames * 100) + '% (keep this tab open)'); await nap(); }
      }
      if (cancelled) return 'cancelled';
      await venc.flush(); await aenc.flush(); if (fail) throw fail; muxer.finalize();
      return { blob: new Blob([target.buffer], { type: p.kind === 'mp4' ? 'video/mp4' : 'video/webm' }), kind: p.kind, W, H };
    } finally { try { venc.state !== 'closed' && venc.close(); aenc.state !== 'closed' && aenc.close(); } catch (_) { /* closed */ } }
  }
  /* older browsers: record the canvas and the sound in real time */
  async function exportLive() {
    const [W, H] = dims(true), fps = +$('xfps').value, [s0, len] = range(), o = opts(); if (!window.MediaRecorder) return null;
    const mt = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)); if (!mt) return null;
    const ec = document.createElement('canvas'); ec.width = W; ec.height = H; const eg = ec.getContext('2d'); ctxA = ctxA || new (window.AudioContext || window.webkitAudioContext)(); await ctxA.resume();
    const dest = ctxA.createMediaStreamDestination(), sn = ctxA.createBufferSource(); sn.buffer = buf; sn.connect(dest); const stream = ec.captureStream(fps); dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
    const rec = new MediaRecorder(stream, { mimeType: mt, videoBitsPerSecond: 3e6 }), parts = []; rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
    const done = new Promise((r) => { rec.onstop = r; }); st = { bars: null, bass: 0, wave: null }; rec.start(200); sn.start(0, s0, len); const t0 = ctxA.currentTime; let lastT = t0;
    await new Promise((res) => { const loop = () => { const el = ctxA.currentTime - t0; if (cancelled || el >= len) return res(); const a = analyse(s0 + el, Math.max(0.001, ctxA.currentTime - lastT), o.n); lastT = ctxA.currentTime; drawFrame(eg, W, H, el, a, o, len); $('xprog').value = Math.round(el / len * 100); say('Recording in real time… ' + Math.round(el / len * 100) + '%'); requestAnimationFrame(loop); }; loop(); });
    try { sn.stop(); } catch (_) { /* ended */ } rec.stop(); await done; if (cancelled) return 'cancelled';
    return { blob: new Blob(parts, { type: 'video/webm' }), kind: 'webm', W, H };
  }
  async function exportVideo() {
    if (busy || !buf) return null; busy = true; cancelled = false; pause(); $('xgo').disabled = true; $('xcancel').classList.remove('hidden'); $('xprog').classList.remove('hidden'); $('xprog').value = 0; $('xout').classList.add('hidden'); $('xdl').classList.add('hidden');
    let res = null; const t0 = performance.now();
    try { if (fast()) res = await exportFast(); if (!res) res = await exportLive(); } catch (e) { say('The video could not be made (' + ((e && e.message) || 'error') + ').'); res = 'error'; }
    busy = false; $('xgo').disabled = false; $('xcancel').classList.add('hidden'); $('xprog').classList.add('hidden');
    if (res === 'cancelled') { say('Export cancelled.'); return null; }
    if (res === 'error') return null;
    if (!res) { say('This browser cannot make video files. Try a current Chrome, Edge or Safari.'); return null; }
    const url = URL.createObjectURL(res.blob); $('xout').src = url; $('xout').classList.remove('hidden'); $('xdl').href = url; $('xdl').download = 'GoVibe visualizer.' + res.kind; $('xdl').textContent = 'Download ' + res.kind.toUpperCase() + ' (' + (res.blob.size / 1048576).toFixed(1) + ' MB)'; $('xdl').classList.remove('hidden');
    say('Done: ' + res.W + ' × ' + res.H + ' ' + res.kind.toUpperCase() + ' in ' + ((performance.now() - t0) / 1000).toFixed(1) + ' s.'); return res;
  }
  $('xgo').onclick = exportVideo; $('xcancel').onclick = () => { cancelled = true; };
  window.addEventListener('resize', size);
  if (/[?&]gvtest\b/.test(location.search)) window.__viz = { setBuffer, exportVideo, analyse: (t, n) => analyse(t, 0.033, n || 64), draw: (t) => { size(); const a = analyse(t, 0.033, opts().n); drawFrame(g, cv.width, cv.height, t, a, opts(), buf.duration); return a; }, get cv() { return cv; }, get buf() { return buf; }, get ctxA() { return ctxA || (ctxA = new (window.AudioContext || window.webkitAudioContext)()); }, setImage: (im2) => { img = im2; } };
})();
