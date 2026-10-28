/* GoVibe Mix — pitch and speed changer for practice: change the key or the tempo on their own, loop a section, save the result. */
(() => {
  const Q = window.GVQuick, S = window.GVStretch, $ = (id) => document.getElementById(id), say = (t) => { $('status').textContent = t; }, MAX = 12 * 60;
  let buf = null, name = 'audio', out = null, key = '', src = null, playing = false;
  const P = () => ({ speed: +$('pspeed').value / 100, semi: +$('psemi').value, cents: +$('pcents').value, tape: $('ptape').checked });
  const semis = (p) => p.semi + p.cents / 100;
  const readout = () => { const p = P(); $('vs').textContent = Math.round(p.speed * 100) + '%'; $('vp').textContent = (semis(p) > 0 ? '+' : '') + semis(p).toFixed(2).replace(/\.?0+$/, '') + ' semitones'; };
  async function open(f) {
    try { say('Reading ' + f.name + '…'); stop(); buf = await Q.decode(f); } catch (_) { return say('Could not read that file. Try an MP3, WAV, OGG or M4A.'); }
    if (buf.duration > MAX) { buf = null; return say('That file is longer than 12 minutes. Cut it shorter in the Audio cutter first.'); }
    name = Q.clean(f.name); out = null; key = ''; $('pmain').classList.remove('hidden'); $('pdrop').classList.add('hidden'); $('pla').max = $('plb').max = Math.floor(buf.duration); $('plb').value = Math.floor(buf.duration); $('pla').value = 0; readout(); say(name + ' · ' + Q.fmt(buf.duration) + '.');
  }
  Q.hook($('pdrop'), open);
  /* returns Float32Array channels at the file's own sample rate */
  function process(p) {
    const chs = [...Array(buf.numberOfChannels)].map((_, i) => buf.getChannelData(i));
    if (p.tape) { // speed and pitch move together, like a record: pitch from the speed plus any semitone offset
      const k = p.speed * Math.pow(2, semis(p) / 12), n = Math.round(chs[0].length / k); return chs.map((c) => S.resample(c, n, k));
    }
    let r = chs; if (Math.abs(p.speed - 1) > 1e-4) r = S.stretch(r, 1 / p.speed); if (Math.abs(semis(p)) > 1e-4) r = S.pitchShift(r, semis(p)); return r;
  }
  async function ensure() { const p = P(), k = JSON.stringify(p); if (out && k === key) return out; say('Processing…'); await new Promise((r) => setTimeout(r, 30)); out = process(p); key = k; say('Ready.'); return out; }
  function stop() { try { src && src.stop(); } catch (_) { /* ended */ } src = null; playing = false; $('pplay').textContent = '▶ Play'; }
  async function play(orig) {
    if (playing) return stop(); const c = Q.AC(); c.resume(); let b = buf, loop = null, speed = 1;
    if (!orig) { const o = await ensure(), nb = c.createBuffer(o.length, o[0].length, buf.sampleRate); o.forEach((d, i) => nb.copyToChannel(d, i)); b = nb; speed = b.duration / buf.duration; }
    src = c.createBufferSource(); src.buffer = b; if ($('ploop').checked) { const a = +$('pla').value, e = +$('plb').value; if (e - a > 0.2) { src.loop = true; src.loopStart = a * (b.duration / buf.duration); src.loopEnd = Math.min(b.duration, e * (b.duration / buf.duration)); loop = a; } }
    src.connect(c.destination); src.start(0, loop != null ? src.loopStart : 0); playing = true; $('pplay').textContent = '❚❚ Stop'; src.onended = () => { if (playing) stop(); };
  }
  ['pspeed', 'psemi', 'pcents', 'ptape'].forEach((i) => $(i).addEventListener('input', readout));
  $('pplay').onclick = () => play(false); $('pplayo').onclick = () => { stop(); play(true); };
  document.querySelectorAll('[data-preset]').forEach((b) => (b.onclick = () => { const [s, st] = b.dataset.preset.split(',').map(Number); $('pspeed').value = s; $('psemi').value = st; $('pcents').value = 0; readout(); }));
  async function save() {
    if (!buf) return; $('pgo').disabled = true; try { const o = await ensure(), f = $('pfmt').value, blob = await Q.encode(o, buf.sampleRate, f, 192, (x) => say('Encoding MP3… ' + Math.round(x * 100) + '%')), p = P(); Q.save(blob, name + ' (' + Math.round(p.speed * 100) + '% ' + (semis(p) > 0 ? '+' : '') + semis(p) + 'st).' + f); say('Saved.'); return { blob, len: o[0].length / buf.sampleRate }; }
    catch (e) { say('Could not save: ' + e.message); } finally { $('pgo').disabled = false; }
  }
  $('pgo').onclick = save; $('pagain').onclick = () => { stop(); buf = null; out = null; $('pmain').classList.add('hidden'); $('pdrop').classList.remove('hidden'); say(''); };
  if (/[?&]gvtest\b/.test(location.search)) window.__pitch = { open, process: async () => { const o = await ensure(); return { n: o[0].length, rate: buf.sampleRate, ch: o }; }, save, set: (sp, st, ce, tape) => { $('pspeed').value = sp; $('psemi').value = st; $('pcents').value = ce || 0; $('ptape').checked = !!tape; readout(); } };
})();
