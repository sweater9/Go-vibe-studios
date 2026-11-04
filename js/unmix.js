/* GoVibe Mix — AI vocal remover page. Decodes the song, resamples it to 44.1 kHz and hands it to js/unmix-worker.js (Open-Unmix vocals model through ONNX Runtime Web).
   The model is downloaded once from this site and kept in the browser's cache, or loaded from a file the person chooses. Nothing about the song leaves the device. */
(() => {
  const Q = window.GVQuick, $ = (id) => document.getElementById(id), say = (t) => { $('status').textContent = t; }, MODEL = 'models/umx-vocals.onnx', CACHE = 'govibe-models-v1', RATE = 44100;
  let worker = null, ready = false, song = null, name = 'song', busy = false, urls = [];
  const setGo = () => { $('go').disabled = !(ready && song) || busy; };
  function boot() {
    if (worker) worker.terminate(); ready = false; worker = new Worker('js/unmix-worker.js', { type: 'module' });
    worker.onerror = () => { busy = false; setGo(); say('The splitter could not start in this browser.'); };
    worker.onmessage = (e) => {
      const d = e.data;
      if (d.ready) { ready = true; $('mstate').textContent = 'Model ready. It runs on this device.'; $('mprog').classList.add('hidden'); setGo(); }
      else if (d.progress != null) { $('gprog').value = Math.round(d.progress * 100); $('status').textContent = 'Splitting… ' + Math.round(d.progress * 100) + '%'; }
      else if (d.done) finish(d.done);
      else if (d.error) { busy = false; $('gprog').classList.add('hidden'); setGo(); say('Something went wrong: ' + d.error); }
    };
  }
  const loadModel = (buf) => { $('mstate').textContent = 'Starting the model…'; boot(); worker.postMessage({ load: buf }, [buf]); };
  async function fromCache() { try { const c = await caches.open(CACHE), r = await c.match(MODEL); return r ? r.arrayBuffer() : null; } catch (_) { return null; } }
  async function download() {
    $('mget').disabled = true; $('mprog').classList.remove('hidden'); $('mstate').textContent = 'Downloading the model…';
    try {
      const r = await fetch(MODEL); if (!r.ok) throw new Error('the model file is not on the site');
      const total = +r.headers.get('content-length') || 0, rd = r.body.getReader(), parts = []; let got = 0;
      for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(value); got += value.length; if (total) $('mprog').value = Math.round(100 * got / total); }
      try { const c = await caches.open(CACHE); await c.put(MODEL, new Response(new Blob(parts))); } catch (_) { /* private window: just run it */ }
      const buf = new Uint8Array(got); let o = 0; parts.forEach((p) => { buf.set(p, o); o += p.length; }); loadModel(buf.buffer);
    } catch (e) { $('mstate').textContent = 'The model could not be downloaded (' + e.message + '). You can choose a model file from your device instead.'; $('mget').disabled = false; $('mprog').classList.add('hidden'); }
  }
  (async () => {
    const cached = await fromCache(); if (cached) { $('mstate').textContent = 'Using the model saved in this browser…'; return loadModel(cached); }
    let there = false; try { there = (await fetch(MODEL, { method: 'HEAD' })).ok; } catch (_) { /* offline */ }
    if (there) { $('mstate').textContent = 'The model is not on this device yet. It is a one time download of about 17 MB, then it works offline.'; $('mget').classList.remove('hidden'); }
    else $('mstate').textContent = 'No model is installed yet. Choose an Open-Unmix vocals model file (.onnx) from your device to begin.';
  })();
  $('mget').onclick = download;
  $('mpick').onchange = async (e) => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; loadModel(await f.arrayBuffer()); };
  async function resample(buf) {
    const n = Math.ceil(buf.duration * RATE), oc = new OfflineAudioContext(2, n, RATE), src = oc.createBufferSource(); src.buffer = buf; src.connect(oc.destination); src.start();
    const out = await oc.startRendering(); return [out.getChannelData(0).slice(), out.getChannelData(1).slice()];
  }
  Q.hook($('drop'), async (file) => {
    try {
      say('Reading the song…'); const b = await Q.decode(file);
      if (b.duration > 900) return say('That song is longer than 15 minutes. Cut it down first, then try again.');
      name = Q.clean(file.name); song = b; $('run').classList.remove('hidden'); $('res').classList.add('hidden');
      $('sinfo').textContent = name + ', ' + Q.fmt(b.duration) + '. Splitting takes a few times its length on most devices.'; setGo(); say('');
    } catch (e) { say('Could not open that file: ' + e.message); }
  });
  $('go').onclick = async () => {
    if (!ready || !song || busy) return; busy = true; setGo(); $('gprog').value = 0; $('gprog').classList.remove('hidden'); $('res').classList.add('hidden'); say('Getting ready…');
    try { const [L, R] = await resample(song); worker.postMessage({ run: { L, R } }, [L.buffer, R.buffer]); } catch (e) { busy = false; setGo(); say('Could not prepare the song: ' + e.message); }
  };
  function finish({ VL, VR }) {
    const mix = song, n = VL.length, ml = new Float32Array(n), mr = new Float32Array(n);
    resample(mix).then(([L, R]) => {
      for (let i = 0; i < n; i++) { ml[i] = L[i] - VL[i]; mr[i] = R[i] - VR[i]; }
      urls.forEach(URL.revokeObjectURL); const vox = Q.wav([VL, VR], RATE), inst = Q.wav([ml, mr], RATE); urls = [URL.createObjectURL(vox), URL.createObjectURL(inst)];
      $('avox').src = urls[0]; $('ainst').src = urls[1]; $('dvox').onclick = () => Q.save(vox, name + ' (vocals).wav'); $('dinst').onclick = () => Q.save(inst, name + ' (instrumental).wav');
      busy = false; $('gprog').classList.add('hidden'); $('res').classList.remove('hidden'); setGo(); say('Done. Play the stems or save them as WAV files.');
      if (window.__unmix) window.__unmix.last = { vox: VL, inst: ml, rate: RATE };
    });
  }
  if (/[?&]gvtest\b/.test(location.search)) window.__unmix = { get ready() { return ready; }, last: null };
})();
