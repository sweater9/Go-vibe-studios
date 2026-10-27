/* GoVibe Mix — looper: a loop station. The first pass sets the loop, later passes layer on top. Recording starts and ends on exact frames of the audio clock, so layers stay in time. Audio never leaves the device. */
(() => {
  const $ = (id) => document.getElementById(id);
  const MAX_LAYERS = 12;
  let ctx = null, stream = null, src = null, an = null, node = null, mute0 = null, monGain = null, master = null, metGain = null;
  let drain = false, layers = [], seq = 0, running = false, T0 = 0, L = 0, beatSecs = 0, sched = 0, nextBeat = 0, countBeats = 0;
  let pending = null /* { at, end, lat, chunks, frames, cancelled } */, raf = 0;
  const say = (t) => { $('status').textContent = t; };
  const rate = () => ctx.sampleRate;
  const fmt = (s) => Math.floor(s / 60) + ':' + (s % 60).toFixed(1).padStart(4, '0');

  function wavBlob(arr, r) {
    const n = arr.length, v = new DataView(new ArrayBuffer(44 + n * 2)), w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, r, true); v.setUint32(28, r * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
    for (let i = 0, o = 44; i < n; i++, o += 2) { const s = Math.max(-1, Math.min(1, arr[i])); v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
    return new Blob([v], { type: 'audio/wav' });
  }
  const dl = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };

  /* ---------- microphone ---------- */
  async function open() {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } });
    ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' }); await ctx.resume();
    src = ctx.createMediaStreamSource(stream); an = ctx.createAnalyser(); an.fftSize = 1024; src.connect(an);
    await ctx.audioWorklet.addModule('js/rec-worklet.js');
    node = new AudioWorkletNode(ctx, 'gv-rec', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] }); mute0 = ctx.createGain(); mute0.gain.value = 0; node.connect(mute0); mute0.connect(ctx.destination); src.connect(node);
    node.port.onmessage = onChunk;
    monGain = ctx.createGain(); monGain.gain.value = $('mon').checked ? 1 : 0; src.connect(monGain); monGain.connect(ctx.destination);
    master = ctx.createGain(); master.connect(ctx.destination); metGain = ctx.createGain(); metGain.gain.value = 0.5; metGain.connect(ctx.destination);
    const est = Math.round(((ctx.baseLatency || 0) + (ctx.outputLatency || 0)) * 1000); $('lat').value = Math.min(300, est); $('latv').textContent = $('lat').value + ' ms';
    $('setup').classList.add('hidden'); $('rig').classList.remove('hidden'); updateLen(); meter(); frame();
  }
  function meter() {
    const buf = new Float32Array(an.fftSize); let hold = 0;
    const tick = () => { an.getFloatTimeDomainData(buf); let pk = 0; for (let i = 0; i < buf.length; i++) pk = Math.max(pk, Math.abs(buf[i])); hold = Math.max(pk, hold * 0.97); const db = hold > 1e-5 ? 20 * Math.log10(hold) : -90; $('lvl').style.width = Math.max(0, Math.min(100, (db + 60) / 60 * 100)) + '%'; $('lvl').className = 'lvlbar' + (db > -1 ? ' clip' : db > -9 ? ' hot' : ''); $('meter').setAttribute('aria-valuenow', Math.round(db)); $('lvltxt').textContent = db > -89 ? Math.round(db) + ' dB' : 'silence'; requestAnimationFrame(tick); };
    tick();
  }

  /* ---------- loop geometry ---------- */
  const bpm = () => Math.max(40, Math.min(240, +$('bpm').value || 100)), num = () => +$('num').value, bars = () => +$('bars').value;
  function updateLen() { beatSecs = 60 / bpm(); L = Math.round(beatSecs * num() * bars() * rate()) / rate(); $('lplen').textContent = 'Loop ' + L.toFixed(2) + ' s · ' + num() * bars() + ' beats'; }
  const lockable = () => !layers.length && !running; // tempo and length can change only before the first loop exists
  function syncLock() { for (const id of ['bpm', 'num', 'bars']) $(id).disabled = !lockable(); }

  /* ---------- click track ---------- */
  function click(t, accent) {
    const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = accent ? 1600 : 1100; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(accent ? 0.9 : 0.6, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0008, t + 0.04);
    o.connect(g); g.connect(metGain); o.start(t); o.stop(t + 0.06);
  }
  function schedule() {
    while (T0 + nextBeat * beatSecs < ctx.currentTime + 0.12) {
      const t = T0 + nextBeat * beatSecs;
      if (nextBeat < 0 ? true : $('met').checked) click(t, ((nextBeat % num()) + num()) % num() === 0);
      nextBeat++;
    }
  }

  /* ---------- layers ---------- */
  function startLayer(l) {
    const s = ctx.createBufferSource(); s.buffer = l.buf; s.loop = true; s.connect(l.gain); l.gain.connect(master);
    const now = ctx.currentTime + 0.02, phase = (((now - T0) % L) + L) % L; s.start(now, phase); l.src = s;
  }
  function stopLayer(l) { try { l.src && l.src.stop(); } catch (_) {} l.src = null; }
  function addLayer(buf) {
    const l = { id: ++seq, buf, gain: ctx.createGain(), vol: 1, muted: false, src: null }; layers.push(l);
    if (running) startLayer(l); renderLayers(); syncButtons();
  }
  function peaksOf(data, w) { const out = new Float32Array(w), step = data.length / w; for (let x = 0; x < w; x++) { let m = 0; const a = Math.floor(x * step), b = Math.floor((x + 1) * step); for (let i = a; i < b; i += Math.max(1, (b - a) >> 5)) m = Math.max(m, Math.abs(data[i])); out[x] = m; } return out; }
  function renderLayers() {
    const ul = $('layers'); ul.innerHTML = '';
    layers.forEach((l, i) => {
      const li = document.createElement('li'); if (l.muted) li.className = 'muted';
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = 'Layer ' + (i + 1);
      const cv = document.createElement('canvas'); cv.width = 320; cv.height = 72; cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', 'Waveform of layer ' + (i + 1));
      const g = cv.getContext('2d'), pk = peaksOf(l.buf.getChannelData(0), 320), mx = Math.max(0.05, ...pk); g.fillStyle = '#22d3ee'; for (let x = 0; x < 320; x++) { const h = Math.max(1, pk[x] / mx * 68); g.fillRect(x, 36 - h / 2, 1, h); }
      const vol = document.createElement('input'); vol.type = 'range'; vol.min = 0; vol.max = 120; vol.value = Math.round(l.vol * 100); vol.setAttribute('aria-label', 'Volume of layer ' + (i + 1));
      vol.oninput = () => { l.vol = vol.value / 100; if (!l.muted) l.gain.gain.value = l.vol; };
      const m = document.createElement('button'); m.className = 'btn mini'; m.textContent = l.muted ? 'Unmute' : 'Mute'; m.setAttribute('aria-pressed', l.muted); m.setAttribute('aria-label', (l.muted ? 'Unmute' : 'Mute') + ' layer ' + (i + 1));
      m.onclick = () => { l.muted = !l.muted; l.gain.gain.value = l.muted ? 0 : l.vol; renderLayers(); };
      const d = document.createElement('button'); d.className = 'btn mini'; d.textContent = 'Download'; d.setAttribute('aria-label', 'Download layer ' + (i + 1) + ' as WAV'); d.onclick = () => dl(wavBlob(l.buf.getChannelData(0), rate()), 'Loop layer ' + (i + 1) + '.wav');
      const x = document.createElement('button'); x.className = 'btn mini'; x.textContent = 'Delete'; x.setAttribute('aria-label', 'Delete layer ' + (i + 1)); x.onclick = () => { stopLayer(l); layers.splice(layers.indexOf(l), 1); renderLayers(); syncButtons(); };
      li.append(nm, cv, vol, m, d, x); ul.appendChild(li);
    });
    $('layempty').classList.toggle('hidden', layers.length > 0);
  }
  function syncButtons() {
    const has = layers.length > 0;
    $('rec').textContent = pending ? '■ Cancel' : has ? '● Overdub' : '● Record loop'; $('rec').classList.toggle('rec-on', !!pending);
    $('play').disabled = !has; $('play').textContent = running ? '■ Stop' : '▶ Play'; $('undo').disabled = !has; $('clear').disabled = !has;
    for (const id of ['dlmix', 'toed', 'tostu']) $(id).disabled = !has;
    syncLock();
  }

  /* ---------- transport ---------- */
  function startTransport(fromRecord) {
    updateLen(); const cin = fromRecord && !layers.length && $('cin').checked;
    countBeats = cin ? num() : 0; T0 = ctx.currentTime + 0.15 + countBeats * beatSecs; nextBeat = -countBeats; running = true;
    schedule(); sched = setInterval(schedule, 25);
    for (const l of layers) startLayer(l);
    syncButtons();
  }
  function stopTransport() {
    running = false; clearInterval(sched); for (const l of layers) stopLayer(l);
    if (pending) cancelRecording();
    $('lpbar').className = 'lpbar'; $('lpfill').style.width = '0'; $('lpinfo').textContent = 'Stopped'; syncButtons();
  }
  function armRecording() {
    const r = rate(), lat = Math.round(+$('lat').value / 1000 * r);
    let B = T0; if (running) { const now = ctx.currentTime + 0.08; B = T0 + Math.max(0, Math.ceil((now - T0) / L)) * L; }
    const at = Math.round(B * r), len = Math.round(L * r);
    pending = { at, end: at + len + lat, lat, len, chunks: [], frames: 0, cancelled: false, start: B };
    node.port.postMessage({ cmd: 'arm', at, end: pending.end });
    say(B > ctx.currentTime + 0.3 ? 'Recording starts at the top of the loop…' : 'Recording…'); syncButtons();
  }
  function cancelRecording() { if (!pending) return; pending.cancelled = true; drain = true; node.port.postMessage('flush'); pending = null; say('Recording cancelled.'); syncButtons(); }
  function onChunk(e) {
    const m = e.data;
    if (drain) { if (m.done) drain = false; return; } // leftovers of a cancelled take
    if (!pending) return;
    if (m.l) { pending.chunks.push(m.l); pending.frames += m.l.length; return; }
    if (!m.done) return;
    const p = pending; pending = null; if (p.cancelled) { syncButtons(); return; }
    const all = new Float32Array(p.frames); let o = 0; for (const c of p.chunks) { all.set(c, o); o += c.length; }
    const out = new Float32Array(p.len); for (let i = 0; i < p.len; i++) out[i] = all[i + p.lat] || 0; // drop the input delay so the layer lines up
    const buf = ctx.createBuffer(1, p.len, rate()); buf.copyToChannel(out, 0);
    addLayer(buf); say('Layer ' + layers.length + ' recorded. Press Overdub to add another.');
  }

  $('rec').onclick = () => {
    if (!ctx) return;
    if (pending) return cancelRecording();
    if (layers.length >= MAX_LAYERS) return say('That is the maximum of ' + MAX_LAYERS + ' layers. Delete one to add another.');
    ctx.resume(); updateLen();
    if (!running) startTransport(true);
    armRecording();
  };
  $('play').onclick = () => { if (!ctx) return; ctx.resume(); running ? stopTransport() : startTransport(false); };
  $('undo').onclick = () => { const l = layers.pop(); if (l) { stopLayer(l); renderLayers(); syncButtons(); say('Removed the last layer.'); } };
  $('clear').onclick = () => { if (running) stopTransport(); layers.forEach(stopLayer); layers = []; renderLayers(); syncButtons(); say('Cleared. Pick a tempo and record a new loop.'); };
  for (const id of ['bpm', 'num', 'bars']) $(id).onchange = () => { if (ctx) updateLen(); };
  $('mon').onchange = () => { if (monGain) monGain.gain.value = $('mon').checked ? 1 : 0; };
  $('lat').oninput = () => { $('latv').textContent = $('lat').value + ' ms'; };
  window.addEventListener('keydown', (e) => { if (e.code === 'Space' && ctx && !/^(INPUT|SELECT|TEXTAREA|BUTTON|A)$/.test(e.target.tagName) && !$('rig').classList.contains('hidden')) { e.preventDefault(); $('rec').click(); } });

  /* ---------- progress ---------- */
  function frame() {
    raf = requestAnimationFrame(frame); if (!ctx || !running) return;
    const now = ctx.currentTime, bar = $('lpbar'), fill = $('lpfill');
    if (now < T0) { const left = T0 - now, k = countBeats ? Math.ceil(left / beatSecs) : 0; bar.className = 'lpbar count'; fill.style.width = (countBeats ? (1 - left / (countBeats * beatSecs)) * 100 : 0) + '%'; $('lpinfo').textContent = countBeats ? 'Count in… ' + Math.min(countBeats, k) : 'Starting…'; return; }
    const ph = ((now - T0) % L) / L, beat = Math.floor(ph * num() * bars()), recNow = pending && now >= pending.start;
    bar.className = 'lpbar' + (recNow ? ' rec' : ''); if (recNow && $('status').textContent.startsWith('Recording starts')) say('Recording…'); fill.style.width = (ph * 100).toFixed(1) + '%'; bar.setAttribute('aria-valuenow', Math.round(ph * 100));
    $('lpinfo').textContent = (recNow ? 'Recording · ' : pending ? 'Armed · ' : 'Playing · ') + 'bar ' + (Math.floor(beat / num()) + 1) + ' of ' + bars() + ', beat ' + (beat % num() + 1);
  }

  /* ---------- export ---------- */
  function mix(reps) {
    const n = Math.round(L * rate()), out = new Float32Array(n * reps);
    for (const l of layers) { if (l.muted) continue; const d = l.buf.getChannelData(0); for (let r = 0; r < reps; r++) for (let i = 0; i < n; i++) out[r * n + i] += d[i] * l.vol; }
    let pk = 0; for (let i = 0; i < out.length; i++) pk = Math.max(pk, Math.abs(out[i])); if (pk > 0.98) { const g = 0.98 / pk; for (let i = 0; i < out.length; i++) out[i] *= g; }
    return out;
  }
  const mixBlob = () => wavBlob(mix(+$('reps').value), rate());
  $('dlmix').onclick = () => dl(mixBlob(), 'Loop mix.wav');
  async function send(page, key) { try { await GVStore.put(key, mixBlob()); location.href = page + '?from=record'; } catch (_) { say('Could not hand the file over. Download the mix instead.'); } }
  $('toed').onclick = () => send('editor.html', 'handoff'); $('tostu').onclick = () => send('studio.html', 'studio-import');

  $('allow').onclick = async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return $('allow').insertAdjacentHTML('afterend', '<p class="status" role="alert">This browser cannot record from a microphone here.</p>');
    try { await open(); } catch (e) { $('allow').insertAdjacentHTML('afterend', '<p class="status" role="alert">' + (e && e.name === 'NotAllowedError' ? 'Microphone access was blocked. Allow it in the browser address bar, then try again.' : 'The microphone could not be opened.') + '</p>'); }
  };
  window.addEventListener('pagehide', () => { if (stream) stream.getTracks().forEach((t) => t.stop()); });

  syncLock(); renderLayers();
  if (/[?&]gvtest\b/.test(location.search)) window.__loop = { get layers() { return layers; }, get running() { return running; }, get frames() { return L * (ctx ? rate() : 0); }, get pending() { return !!pending; }, mix, get T0() { return T0; }, get L() { return L; }, get ctx() { return ctx; } };
})();
