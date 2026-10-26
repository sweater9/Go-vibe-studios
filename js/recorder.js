/* GoVibe Mix — mix recorder: lossless WAV (AudioWorklet) or compressed (MediaRecorder) */
(() => {
  const A = window.GVAudio; if (!A) return;
  const { ctx, outBus, recDest, say, fmt } = A, $ = (id) => document.getElementById(id);
  const MAX_SECS = 30 * 60;
  let recording = false, t0 = 0, timer = 0, mr = null, chunks = [], node = null, pcm = [], frames = 0;
  const hasWorklet = !!(ctx.audioWorklet && window.AudioWorkletNode);
  if (!hasWorklet) { $('recfmt').value = 'webm'; $('recfmt').querySelector('[value=wav]').disabled = true; }
  if (!window.MediaRecorder) $('recfmt').querySelector('[value=webm]').disabled = true;

  async function ensureNode() {
    if (node) return node;
    await ctx.audioWorklet.addModule('js/rec-worklet.js');
    node = new AudioWorkletNode(ctx, 'gv-rec', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
    const mute = ctx.createGain(); mute.gain.value = 0; outBus.connect(node); node.connect(mute); mute.connect(ctx.destination);
    return node;
  }
  function wavBlob() {
    const n = frames, v = new DataView(new ArrayBuffer(44 + n * 4)), w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 4, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
    v.setUint32(24, ctx.sampleRate, true); v.setUint32(28, ctx.sampleRate * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 4, true);
    let o = 44; for (const c of pcm) for (let i = 0; i < c.l.length; i++) { v.setInt16(o, c.l[i], true); v.setInt16(o + 2, c.r[i], true); o += 4; }
    return new Blob([v], { type: 'audio/wav' });
  }
  const q16 = (x) => { const s = Math.max(-1, Math.min(1, x)); return s < 0 ? s * 0x8000 : s * 0x7fff; };
  function finish(blob, ext) {
    clearInterval(timer); recording = false; window.dispatchEvent(new CustomEvent('gv-rec', { detail: { state: 'stop', t: Date.now() } }));
    const a = $('recdl'); if (a.href) URL.revokeObjectURL(a.href);
    a.href = URL.createObjectURL(blob); a.download = 'govibe-mix.' + ext; a.textContent = 'Download mix (' + (blob.size / 1048576).toFixed(1) + ' MB)'; a.classList.remove('hidden');
    $('rec').textContent = '● Record mix'; $('rec').classList.remove('rec-on'); $('rectime').textContent = ''; $('recfmt').disabled = false;
    say('Mix recorded. Use "Download mix".');
  }

  async function startWav() {
    const n = await ensureNode(); pcm = []; frames = 0;
    n.port.onmessage = (e) => {
      const m = e.data;
      if (m.l) { const l = new Int16Array(m.l.length), r = new Int16Array(m.r.length); for (let i = 0; i < l.length; i++) { l[i] = q16(m.l[i]); r[i] = q16(m.r[i]); } pcm.push({ l, r }); frames += l.length; }
      else if (m.done) finish(wavBlob(), 'wav');
    };
    n.port.postMessage('start');
  }
  function startCompressed() {
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'], mime = types.find((t) => MediaRecorder.isTypeSupported(t));
    chunks = []; mr = new MediaRecorder(recDest.stream, mime ? { mimeType: mime } : undefined);
    mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    mr.onstop = () => { const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' }); finish(blob, /mp4/.test(blob.type) ? 'm4a' : /ogg/.test(blob.type) ? 'ogg' : 'webm'); mr = null; };
    mr.start();
  }
  async function stop() { if ($('recfmt').value === 'wav' && hasWorklet && node && !mr) node.port.postMessage('flush'); else if (mr) mr.stop(); }

  $('rec').onclick = async () => {
    if (recording) return stop();
    const wav = $('recfmt').value === 'wav';
    if (!wav && !window.MediaRecorder) return say('Recording is not supported in this browser.');
    ctx.resume(); $('recdl').classList.add('hidden');
    try { wav ? await startWav() : startCompressed(); } catch (e) { return say('Could not start recording: ' + e.message); }
    recording = true; t0 = Date.now(); $('recfmt').disabled = true; window.dispatchEvent(new CustomEvent('gv-rec', { detail: { state: 'start', t: t0 } }));
    $('rec').textContent = '■ Stop recording'; $('rec').classList.add('rec-on');
    timer = setInterval(() => { const s = (Date.now() - t0) / 1000; $('rectime').textContent = fmt(s); if (s > MAX_SECS) stop(); }, 250);
  };
})();
