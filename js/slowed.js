/* GoVibe Mix — slowed and reverb / sped up / nightcore maker. Speed changes pitch together, like a tape or record, then reverb is added. The live preview and the saved file use the same chain. */
(() => {
  const Q = window.GVQuick, $ = (id) => document.getElementById(id), say = (t) => { $('status').textContent = t; };
  let buf = null, name = 'audio', src = null, live = null, playing = false, off = 0, t0 = 0, irCache = {};
  const P = () => ({ rate: +$('srate').value / 100, wet: +$('swet').value / 100, room: +$('sroom').value, bass: +$('sbass').value });
  function ir(c, secs, rate) { const k = secs + '|' + rate; if (irCache[k] && irCache[k].sampleRate === rate) return irCache[k]; const n = Math.round(secs * rate), b = c.createBuffer(2, n, rate); for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); let lp = 0; for (let i = 0; i < n; i++) { const t = i / n, env = Math.pow(1 - t, 3.2), x = (Math.random() * 2 - 1) * env; lp += (x - lp) * (0.55 - 0.4 * t); d[i] = lp * 1.4; } } return (irCache[k] = b); }
  function chain(c, out, p) {
    const dry = c.createGain(), wet = c.createGain(), conv = c.createConvolver(), lo = c.createBiquadFilter(), mix = c.createGain(); conv.buffer = ir(c, p.room, c.sampleRate); lo.type = 'lowshelf'; lo.frequency.value = 120; lo.gain.value = p.bass;
    dry.gain.value = 1 - p.wet * 0.45; wet.gain.value = p.wet * 1.1; dry.connect(mix); dry.connect(conv); conv.connect(wet); wet.connect(mix); mix.connect(lo); lo.connect(out);
    return { in: dry, apply(q) { dry.gain.value = 1 - q.wet * 0.45; wet.gain.value = q.wet * 1.1; lo.gain.value = q.bass; } };
  }
  const readout = () => { const p = P(); $('vr').textContent = Math.round(p.rate * 100) + '%' + (p.rate < 1 ? ' (slower, lower)' : p.rate > 1 ? ' (faster, higher)' : ''); $('vw').textContent = Math.round(p.wet * 100) + '%'; $('vo').textContent = p.room + ' s'; $('vbs').textContent = (p.bass > 0 ? '+' : '') + p.bass + ' dB'; };
  async function open(f) {
    try { say('Reading ' + f.name + '…'); stop(); buf = await Q.decode(f); } catch (_) { return say('Could not read that file. Try an MP3, WAV, OGG or M4A.'); }
    name = Q.clean(f.name); off = 0; $('smain').classList.remove('hidden'); $('sdrop').classList.add('hidden'); readout(); say(name + ' · ' + Q.fmt(buf.duration) + '.');
  }
  Q.hook($('sdrop'), open);
  function stop() { try { src && src.stop(); } catch (_) { /* ended */ } src = null; live = null; playing = false; $('splay').textContent = '▶ Preview'; }
  function play() {
    if (playing) { off = Math.min(buf.duration - 0.05, off + (Q.AC().currentTime - t0) * P().rate); stop(); return; }
    const c = Q.AC(); c.resume(); const p = P(); src = c.createBufferSource(); src.buffer = buf; src.playbackRate.value = p.rate; live = chain(c, c.destination, p); src.connect(live.in); src.start(0, off); t0 = c.currentTime; playing = true; $('splay').textContent = '❚❚ Stop';
    src.onended = () => { if (playing) { off = 0; stop(); } };
  }
  ['srate', 'swet', 'sbass'].forEach((i) => $(i).addEventListener('input', () => { readout(); if (live) { src.playbackRate.value = P().rate; live.apply(P()); } }));
  $('sroom').addEventListener('input', () => { readout(); if (playing) { const was = off + (Q.AC().currentTime - t0) * P().rate; stop(); off = was; play(); } });
  document.querySelectorAll('[data-preset]').forEach((b) => (b.onclick = () => { const [r, w, o, ba] = b.dataset.preset.split(',').map(Number); $('srate').value = r; $('swet').value = w; $('sroom').value = o; $('sbass').value = ba; readout(); if (live) { src.playbackRate.value = P().rate; live.apply(P()); } }));
  $('sback').onclick = () => { stop(); off = 0; };
  async function render() {
    const p = P(), r = buf.sampleRate, tail = p.wet > 0 ? p.room : 0, len = Math.ceil((buf.duration / p.rate + tail) * r), oc = new OfflineAudioContext(2, len, r), s = oc.createBufferSource(); s.buffer = buf; s.playbackRate.value = p.rate; const ch = chain(oc, oc.destination, p); s.connect(ch.in); s.start();
    const out = await oc.startRendering(), chs = [out.getChannelData(0), out.getChannelData(1)]; let m = 0; chs.forEach((d) => { for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > m) m = v; } }); if (m > 0.98) { const k = 0.98 / m; chs.forEach((d) => { for (let i = 0; i < d.length; i++) d[i] *= k; }); }
    return { chs, rate: r, dur: out.duration };
  }
  async function save() {
    if (!buf) return; $('sgo').disabled = true; say('Processing…'); await new Promise((r) => setTimeout(r, 20));
    try { const { chs, rate, dur } = await render(), f = $('sfmt').value, blob = await Q.encode(chs, rate, f, 192, (x) => say('Encoding MP3… ' + Math.round(x * 100) + '%')), tag = P().rate < 1 ? ' slowed' : P().rate > 1 ? ' sped up' : ''; Q.save(blob, name + tag + (P().wet > 0 ? ' reverb' : '') + '.' + f); say('Saved (' + Q.fmt(dur) + ').'); return { blob, dur }; }
    catch (e) { say('Could not save: ' + e.message); } finally { $('sgo').disabled = false; }
  }
  $('sgo').onclick = save; $('splay').onclick = play; $('sagain').onclick = () => { stop(); buf = null; $('smain').classList.add('hidden'); $('sdrop').classList.remove('hidden'); say(''); };
  $('smain').addEventListener('input', () => {});
  if (/[?&]gvtest\b/.test(location.search)) window.__slow = { open, render, save, set: (r, w, o, b) => { $('srate').value = r; $('swet').value = w; $('sroom').value = o; $('sbass').value = b; readout(); }, get buf() { return buf; } };
})();
