/* GoVibe Mix — mastering page: loudness meters, streaming targets, limiter, A/B compare, export. Heavy maths runs in a worker (js/master-worker.js). */
(() => {
  const $ = (id) => document.getElementById(id);
  const Core = window.GVStudioCore;
  let ctx = null, orig = null, mast = null, aRes = null, mRes = null, name = 'track', src = null, which = 'a', startedAt = 0, offset = 0, playing = false, raf = 0, gainA = null, busy = false;
  const say = (t) => { $('status').textContent = t; };
  const fmt = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
  const num = (v, d) => (isFinite(v) ? v.toFixed(d == null ? 1 : d) : '–');
  const getCtx = () => (ctx = ctx || new (window.AudioContext || window.webkitAudioContext)());
  const chansOf = (buf) => { const a = []; for (let c = 0; c < buf.numberOfChannels; c++) a.push(new Float32Array(buf.getChannelData(c))); return a; };
  const toBuffer = (chans, rate) => { const b = getCtx().createBuffer(chans.length, chans[0].length, rate); chans.forEach((c, i) => b.getChannelData(i).set(c)); return b; };

  function call(msg, transfer) {
    return new Promise((res, rej) => {
      const w = new Worker('js/master-worker.js');
      w.onmessage = (e) => { w.terminate(); e.data.error ? rej(new Error(e.data.error)) : res(e.data); };
      w.onerror = (e) => { w.terminate(); rej(new Error(e.message || 'Worker failed')); };
      w.postMessage(msg, transfer || []);
    });
  }
  function show(prefix, r) {
    $(prefix + '_lufs').textContent = num(r.lufs, 1); $(prefix + '_st').textContent = num(r.shortTermMax, 1); $(prefix + '_lra').textContent = num(r.lra, 1);
    $(prefix + '_tp').textContent = num(r.truePeakDb, 1); $(prefix + '_pk').textContent = num(r.peakDb, 1);
    $(prefix + '_tp').className = r.truePeakDb > -0.9 ? 'bad' : '';
  }
  function hint() {
    if (!aRes) return; const t = +$('target').value, d = t - aRes.lufs, h = $('hint');
    if (!isFinite(aRes.lufs)) { h.textContent = 'This file is too quiet or silent to measure.'; return; }
    h.textContent = 'Your track measures ' + num(aRes.lufs) + ' LUFS. To reach ' + num(t) + ' LUFS it needs ' + (d >= 0 ? '+' : '') + num(d) + ' dB' + (aRes.truePeakDb > -1 ? '. Its true peak is already above −1 dBTP, which can distort after MP3 or AAC conversion.' : '.');
  }

  async function load(file) {
    if (!file) return; say('Reading ' + file.name + '…'); $('fname').textContent = file.name;
    try {
      const ab = await file.arrayBuffer(); orig = await getCtx().decodeAudioData(ab); name = file.name.replace(/\.[^.]+$/, ''); mast = null; mRes = null; stop(); offset = 0;
      ['lufs', 'st', 'lra', 'tp', 'pk'].forEach((k) => { $('m_' + k).textContent = '–'; }); $('m_gain').textContent = '–'; $('save').disabled = true; $('aMast').disabled = true; setWhich('a');
      say('Measuring loudness…'); const r = await call({ op: 'analyze', chans: chansOf(orig), rate: orig.sampleRate }); aRes = r.result; show('o', aRes);
      $('rig').classList.remove('hidden'); hint(); say('Ready. ' + fmt(orig.duration) + ', ' + orig.numberOfChannels + (orig.numberOfChannels === 1 ? ' channel' : ' channels') + ', ' + orig.sampleRate + ' Hz.'); updatePos();
    } catch (e) { say('Could not read this file: ' + (e.message || e)); }
  }

  async function run() {
    if (!orig || busy) return; busy = true; $('go').disabled = true; $('busy').textContent = 'Mastering…'; stop();
    const opts = { targetLufs: +$('target').value, ceiling: +$('ceil').value, bass: +$('bass').value, treble: +$('treble').value, glue: +$('glue').value / 100, width: +$('width').value / 100, releaseMs: +$('rel').value };
    try {
      const chans = chansOf(orig), r = await call({ op: 'master', chans, rate: orig.sampleRate, opts }, chans.map((c) => c.buffer));
      mast = toBuffer(r.chans, orig.sampleRate); mRes = r.result; show('m', mRes);
      $('m_gain').textContent = (r.gainDb >= 0 ? '+' : '') + num(r.gainDb) + ' dB / ' + num(r.maxReduction) + ' dB';
      $('aMast').disabled = false; $('save').disabled = false; setWhich('m'); $('busy').textContent = 'Done. Now at ' + num(mRes.lufs) + ' LUFS, true peak ' + num(mRes.truePeakDb) + ' dBTP.' + (r.maxReduction > 8 ? ' The limiter is working hard, which can flatten the sound.' : '');
    } catch (e) { $('busy').textContent = 'Mastering failed: ' + (e.message || e); }
    busy = false; $('go').disabled = false;
  }

  /* ---------- A/B playback ---------- */
  function cur() { return which === 'm' && mast ? mast : orig; }
  function matchGain() { if (which !== 'a' || !$('match').checked || !mRes || !aRes || !isFinite(mRes.lufs) || !isFinite(aRes.lufs)) return 1; return Math.pow(10, Math.max(-24, Math.min(24, mRes.lufs - aRes.lufs)) / 20); }
  function start() {
    const b = cur(); if (!b) return; const c = getCtx(); c.resume(); stopSrc();
    src = c.createBufferSource(); src.buffer = b; gainA = c.createGain(); gainA.gain.value = matchGain(); src.connect(gainA).connect(c.destination);
    if (offset >= b.duration - 0.05) offset = 0; src.start(0, offset); startedAt = c.currentTime - offset; playing = true; $('play').textContent = 'Pause';
    src.onended = () => { if (src && playing && getCtx().currentTime - startedAt >= b.duration - 0.1) { playing = false; offset = 0; $('play').textContent = 'Play'; updatePos(); } };
    cancelAnimationFrame(raf); const tick = () => { updatePos(); if (playing) raf = requestAnimationFrame(tick); }; tick();
  }
  function stopSrc() { if (src) { try { src.onended = null; src.stop(); } catch (_) {} src.disconnect(); src = null; } }
  function stop() { if (playing) offset = Math.min(cur().duration, getCtx().currentTime - startedAt); stopSrc(); playing = false; $('play').textContent = 'Play'; cancelAnimationFrame(raf); }
  function posNow() { return playing ? Math.min(cur().duration, getCtx().currentTime - startedAt) : offset; }
  function updatePos() { if (!orig) return; const p = posNow(); $('pos').textContent = fmt(p) + ' / ' + fmt(orig.duration); if (document.activeElement !== $('seek')) $('seek').value = Math.round(p / orig.duration * 1000); }
  function setWhich(w) {
    const was = playing; if (was) stop(); which = w; $('aOrig').setAttribute('aria-pressed', w === 'a'); $('aMast').setAttribute('aria-pressed', w === 'm'); if (was) start();
  }

  /* ---------- export ---------- */
  async function save() {
    if (!mast) return; const f = $('fmt').value; $('busy').textContent = 'Preparing file…'; let blob, ext;
    try {
      if (f === 'wav16' || f === 'wav24') { blob = Core.wavBlob(mast, f === 'wav24' ? 24 : 16); ext = '.wav'; }
      else { blob = await Core.mp3Blob(mast, f === 'mp3' ? 320 : 192); ext = '.mp3'; }
    } catch (e) { $('busy').textContent = 'Export failed: ' + (e.message || e); return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name + ' (mastered)' + ext; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    $('busy').textContent = 'Downloaded ' + a.download + '.';
  }

  /* ---------- wiring ---------- */
  $('pick').onclick = () => $('file').click(); $('file').onchange = (e) => load(e.target.files[0]);
  document.addEventListener('dragover', (e) => e.preventDefault()); document.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer.files[0]) load(e.dataTransfer.files[0]); });
  $('preset').onchange = () => { const v = $('preset').value; if (v !== 'custom') { const [t, c] = v.split('|'); $('target').value = t; $('ceil').value = c; } hint(); };
  ['target', 'ceil'].forEach((id) => { $(id).oninput = () => { $('preset').value = 'custom'; hint(); }; });
  $('go').onclick = run; $('save').onclick = save;
  $('play').onclick = () => { playing ? stop() : start(); };
  $('aOrig').onclick = () => setWhich('a'); $('aMast').onclick = () => { if (mast) setWhich('m'); };
  $('match').onchange = () => { if (playing && gainA) gainA.gain.value = matchGain(); };
  $('seek').oninput = () => { if (!orig) return; const was = playing; if (was) stopSrc(); offset = $('seek').value / 1000 * cur().duration; if (was) { playing = false; start(); } updatePos(); };
  window.addEventListener('keydown', (e) => { if (e.code === 'Space' && !/INPUT|SELECT|TEXTAREA|BUTTON/.test(e.target.tagName) && orig) { e.preventDefault(); playing ? stop() : start(); } });
  if (new URLSearchParams(location.search).has('gvtest')) window.__ms = { get orig() { return orig; }, get mast() { return mast; }, get aRes() { return aRes; }, get mRes() { return mRes; }, get playing() { return playing; }, get which() { return which; }, get pos() { return posNow(); }, matchGain };
})();
