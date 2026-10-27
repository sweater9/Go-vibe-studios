/* GoVibe Mix — voice and mic recorder: lossless capture with an AudioWorklet, level meter, countdown, several takes, WAV or MP3 download. Audio never leaves the device. */
(() => {
  const $ = (id) => document.getElementById(id);
  const MAX_SECS = 30 * 60;
  let sa = null, lv = null, ctx = null, stream = null, src = null, an = null, node = null, monGain = null, mute = null;
  let rec = false, chunks = [], frames = 0, t0 = 0, timer = 0, raf = 0, peakHold = 0, takes = [], seq = 0;
  const say = (t) => { $('status').textContent = t; };
  const fmt = (s) => Math.floor(s / 60) + ':' + (s % 60).toFixed(1).padStart(4, '0');

  function wavBlob(arrs, rate) {
    const n = arrs.reduce((a, c) => a + c.length, 0), v = new DataView(new ArrayBuffer(44 + n * 2)), w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
    let o = 44; for (const c of arrs) for (let i = 0; i < c.length; i++) { const s = Math.max(-1, Math.min(1, c[i])); v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2; }
    return new Blob([v], { type: 'audio/wav' });
  }

  /* ---------- microphone ---------- */
  async function open(deviceId) {
    close();
    const c = { audio: { deviceId: deviceId ? { exact: deviceId } : undefined, echoCancellation: $('aec').checked, noiseSuppression: $('ns').checked, autoGainControl: $('agc').checked, channelCount: 1 } };
    stream = await navigator.mediaDevices.getUserMedia(c);
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); await ctx.resume();
    src = ctx.createMediaStreamSource(stream); an = ctx.createAnalyser(); an.fftSize = 1024; src.connect(an);
    if (!node) { await ctx.audioWorklet.addModule('js/rec-worklet.js'); node = new AudioWorkletNode(ctx, 'gv-rec', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] }); mute = ctx.createGain(); mute.gain.value = 0; node.connect(mute); mute.connect(ctx.destination); }
    src.connect(node);
    if (lv) lv.stop(); sa = ctx.createAnalyser(); src.connect(sa);
    monGain = ctx.createGain(); monGain.gain.value = $('mon').checked ? 1 : 0; src.connect(monGain); monGain.connect(ctx.destination);
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput'), cur = stream.getAudioTracks()[0].getSettings().deviceId;
    const sel = $('dev'); sel.innerHTML = ''; devs.forEach((d, i) => { const o = document.createElement('option'); o.value = d.deviceId; o.textContent = d.label || 'Microphone ' + (i + 1); if (d.deviceId === cur) o.selected = true; sel.appendChild(o); });
    $('setup').classList.add('hidden'); $('rig').classList.remove('hidden'); meter(); lv = GVSpec.live($('livespec'), sa, { log: $('livelog').value === '1' });
    say('Microphone ready. Press Record when you are set.');
  }
  function close() { cancelAnimationFrame(raf); if (lv) { lv.stop(); lv = null; } if (stream) stream.getTracks().forEach((t) => t.stop()); try { src && src.disconnect(); monGain && monGain.disconnect(); } catch (_) {} stream = src = monGain = null; }
  function meter() {
    const buf = new Float32Array(an.fftSize), bar = $('lvl'), m = $('meter');
    const tick = () => {
      an.getFloatTimeDomainData(buf); let pk = 0; for (let i = 0; i < buf.length; i++) pk = Math.max(pk, Math.abs(buf[i]));
      peakHold = Math.max(pk, peakHold * 0.97); const db = peakHold > 0.00001 ? 20 * Math.log10(peakHold) : -90, pct = Math.max(0, Math.min(100, (db + 60) / 60 * 100));
      bar.style.width = pct + '%'; bar.className = 'lvlbar' + (db > -1 ? ' clip' : db > -9 ? ' hot' : '');
      m.setAttribute('aria-valuenow', Math.round(db)); $('lvltxt').textContent = db > -89 ? db.toFixed(0) + ' dB' + (db > -1 ? ' (too loud, move back or turn the input down)' : '') : 'silence';
      raf = requestAnimationFrame(tick);
    };
    tick();
  }

  $('livelog').onchange = () => { if (lv) lv.setLog($('livelog').value === '1'); };

  /* ---------- recording ---------- */
  function begin() {
    chunks = []; frames = 0;
    node.port.onmessage = (e) => { const m = e.data; if (m.l) { chunks.push(m.l); frames += m.l.length; } else if (m.done) done(); };
    node.port.postMessage('start'); rec = true; t0 = Date.now();
    $('rec').textContent = '■ Stop'; $('rec').classList.add('rec-on'); $('dev').disabled = true;
    timer = setInterval(() => { const s = (Date.now() - t0) / 1000; $('time').textContent = fmt(s); if (s > MAX_SECS) stop(); }, 100);
    say('Recording…');
  }
  function stop() { if (!rec) return; node.port.postMessage('flush'); clearInterval(timer); rec = false; }
  function done() {
    const blob = wavBlob(chunks, ctx.sampleRate); seq++;
    takes.push({ id: seq, name: 'Take ' + seq, blob, url: URL.createObjectURL(blob), secs: frames / ctx.sampleRate });
    $('rec').textContent = '● Record'; $('rec').classList.remove('rec-on'); $('dev').disabled = false; $('time').textContent = '0:00.0';
    say('Saved as Take ' + seq + '. Record again for another take.'); renderTakes();
  }
  async function countdown() {
    if (!$('cd').checked) return true;
    $('rec').disabled = true; $('count').classList.remove('hidden');
    for (let n = 3; n > 0; n--) { $('count').textContent = n; await new Promise((r) => setTimeout(r, 800)); }
    $('count').classList.add('hidden'); $('rec').disabled = false; return true;
  }
  $('rec').onclick = async () => { if (rec) return stop(); if (!stream) return; await countdown(); begin(); };
  window.addEventListener('keydown', (e) => { if (e.code === 'Space' && !/INPUT|SELECT|TEXTAREA|BUTTON|AUDIO/.test(e.target.tagName) && stream) { e.preventDefault(); $('rec').click(); } });

  /* ---------- takes ---------- */
  function dl(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 3000); }
  async function toMp3(t, btn) {
    btn.disabled = true; say('Encoding MP3…');
    const ab = await ctx.decodeAudioData(await t.blob.arrayBuffer()), f = ab.getChannelData(0), i16 = new Int16Array(f.length);
    for (let i = 0; i < f.length; i++) { const s = Math.max(-1, Math.min(1, f[i])); i16[i] = s < 0 ? s * 32768 : s * 32767; }
    const rate = [48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000].includes(ab.sampleRate) ? ab.sampleRate : 0;
    if (!rate) { btn.disabled = false; return say('MP3 does not support ' + ab.sampleRate + ' Hz. Download the WAV and use the Audio converter.'); }
    const w = new Worker('js/convert-worker.js');
    w.onmessage = (e) => { if (e.data.done) { dl(e.data.done, t.name + '.mp3'); say('MP3 downloaded.'); w.terminate(); btn.disabled = false; } else if (e.data.error) { say('MP3 failed: ' + e.data.error); w.terminate(); btn.disabled = false; } };
    w.postMessage({ ch: [i16], rate, kbps: 192 }, [i16.buffer]);
  }
  async function send(t, page) {
    try { await GVStore.put(page === 'editor.html' ? 'handoff' : 'studio-import', t.blob); location.href = page + (page === 'editor.html' ? '?from=record' : '?from=record'); } catch (_) { say('Could not hand the file over. Download it instead.'); }
  }
  function renderTakes() {
    const box = $('takes'); box.innerHTML = '';
    takes.forEach((t, idx) => {
      const li = document.createElement('li'); li.className = 'take';
      const h = document.createElement('div'); h.className = 'row'; const nm = document.createElement('b'); nm.textContent = t.name + ' · ' + fmt(t.secs) + ' · ' + (t.blob.size / 1048576).toFixed(1) + ' MB'; h.appendChild(nm);
      const au = document.createElement('audio'); au.controls = true; au.src = t.url; au.setAttribute('aria-label', 'Play ' + t.name);
      const row = document.createElement('div'); row.className = 'row'; row.style.marginTop = '8px';
      const b = (label, fn, aria) => { const x = document.createElement('button'); x.className = 'btn mini'; x.textContent = label; x.setAttribute('aria-label', aria || label + ' ' + t.name); x.onclick = () => fn(x); row.appendChild(x); return x; };
      b('Download WAV', () => dl(t.blob, t.name + '.wav')); b('Download MP3', (x) => toMp3(t, x)); b('Edit', () => send(t, 'editor.html'), 'Open ' + t.name + ' in the Audio Editor'); b('Add to Studio', () => send(t, 'studio.html'), 'Add ' + t.name + ' to the Studio');
      b('Delete', () => { URL.revokeObjectURL(t.url); takes.splice(idx, 1); renderTakes(); });
      li.append(h, au, row); box.appendChild(li);
    });
    $('takeshead').classList.toggle('hidden', !takes.length);
  }

  /* ---------- wiring ---------- */
  $('allow').onclick = async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return say('This browser cannot record from a microphone here. Use a current Chrome, Edge or Firefox over a secure connection.');
    try { await open(); } catch (e) { say(e && e.name === 'NotAllowedError' ? 'Microphone access was blocked. Allow it in the browser address bar, then try again.' : e && e.name === 'NotFoundError' ? 'No microphone was found.' : 'Could not open the microphone: ' + (e && e.message)); }
  };
  $('dev').onchange = async () => { try { await open($('dev').value); } catch (e) { say('Could not switch microphone: ' + (e && e.message)); } };
  ['aec', 'ns', 'agc'].forEach((id) => { $(id).onchange = async () => { if (stream && !rec) { try { await open($('dev').value); } catch (_) {} } }; });
  $('mon').onchange = () => { if (monGain) monGain.gain.value = $('mon').checked ? 1 : 0; };
  window.addEventListener('beforeunload', close);
  if (/[?&]gvtest\b/.test(location.search)) window.__rec = { get takes() { return takes; }, get recording() { return rec; } };
})();
