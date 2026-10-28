/* GoVibe Mix — volume booster, bass booster and normalizer. The same filter chain plays the live preview and renders the saved file. */
(() => {
  const Q = window.GVQuick, $ = (id) => document.getElementById(id), say = (t) => { $('status').textContent = t; };
  let buf = null, name = 'audio', src = null, live = null, t0 = 0, off = 0, playing = false, raf = 0, peakIn = 0;
  const P = () => ({ vol: +$('bvol').value, bass: +$('bbass').value, treb: +$('btreb').value, soft: $('bsoft').checked, norm: $('bnorm').checked, mono: $('bmono').checked });
  const soft = (() => { const n = 2048, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1, a = Math.abs(x), k = 0.7; c[i] = a <= k ? x : Math.sign(x) * (k + (1 - k) * Math.tanh((a - k) / (1 - k))); } return c; })();
  /* build vol -> bass -> treble -> (soft clip) -> out on any context; returns nodes for live updates */
  function chain(c, out, p) {
    const g = c.createGain(), lo = c.createBiquadFilter(), hi = c.createBiquadFilter(); lo.type = 'lowshelf'; lo.frequency.value = 110; hi.type = 'highshelf'; hi.frequency.value = 8000;
    g.gain.value = Math.pow(10, p.vol / 20); lo.gain.value = p.bass; hi.gain.value = p.treb; g.connect(lo); lo.connect(hi); const last = hi;
    const ws = c.createWaveShaper(); ws.curve = p.soft === false ? null : soft; ws.oversample = '2x'; const pre = c.createGain(); pre.gain.value = 1; last.connect(pre); pre.connect(ws); ws.connect(out);
    return { in: g, g, lo, hi, ws, pre, apply(q) { ws.curve = q.soft === false ? null : soft; g.gain.value = Math.pow(10, q.vol / 20); lo.gain.value = q.bass; hi.gain.value = q.treb; } };
  }
  const db = (x) => (x > 1e-6 ? 20 * Math.log10(x) : -120);
  const peakOf = (b) => { let m = 0; for (let c = 0; c < b.numberOfChannels; c++) { const d = b.getChannelData(c); for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > m) m = v; } } return m; };
  async function open(f) {
    try { say('Reading ' + f.name + '…'); stop(); buf = await Q.decode(f); } catch (e) { return say('Could not read that file: ' + ((e && e.message) || 'unknown error')); }
    name = Q.clean(f.name); peakIn = peakOf(buf); $('bmain').classList.remove('hidden'); $('bdrop').classList.add('hidden'); readout(); say(name + ' · ' + Q.fmt(buf.duration) + '. Loudest peak ' + db(peakIn).toFixed(1) + ' dBFS.');
  }
  Q.hook($('bdrop'), open);
  const readout = () => { const p = P(); $('vv').textContent = (p.vol > 0 ? '+' : '') + p.vol + ' dB'; $('vb').textContent = (p.bass > 0 ? '+' : '') + p.bass + ' dB'; $('vt').textContent = (p.treb > 0 ? '+' : '') + p.treb + ' dB'; };
  ['bvol', 'bbass', 'btreb', 'bsoft', 'bnorm', 'bmono'].forEach((i) => $(i).addEventListener('input', () => { readout(); if (live) live.apply(P()); }));
  document.querySelectorAll('[data-preset]').forEach((b) => (b.onclick = () => { const [v, ba, t, n] = b.dataset.preset.split(',').map(Number); $('bvol').value = v; $('bbass').value = ba; $('btreb').value = t; $('bnorm').checked = !!n; readout(); if (live) live.apply(P()); }));
  function stop() { cancelAnimationFrame(raf); try { src && src.stop(); } catch (_) { /* ended */ } src = null; live = null; playing = false; $('bplay').textContent = '▶ Preview'; }
  function play(orig) {
    if (playing) { off = Math.min(buf.duration - 0.05, off + Q.AC().currentTime - t0); stop(); return; }
    const c = Q.AC(); c.resume(); src = c.createBufferSource(); src.buffer = buf; live = chain(c, c.destination, orig ? { vol: 0, bass: 0, treb: 0 } : P()); src.connect(live.in); if (orig) live.ws.curve = null; src.start(0, off); t0 = c.currentTime; playing = true; $('bplay').textContent = '❚❚ Stop';
    src.onended = () => { if (playing) { off = 0; stop(); } };
  }
  $('bplay').onclick = () => play(false); $('bplayo').onclick = () => { stop(); play(true); };
  $('brestart').onclick = () => { stop(); off = 0; };
  async function render() {
    const p = P(), r = buf.sampleRate, oc = new OfflineAudioContext(p.mono ? 1 : buf.numberOfChannels, buf.length, r), s = oc.createBufferSource(); s.buffer = buf; const ch = chain(oc, oc.destination, p); s.connect(ch.in); s.start(); const out = await oc.startRendering();
    const chs = [...Array(out.numberOfChannels)].map((_, i) => out.getChannelData(i)); let m = 0; chs.forEach((d) => { for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > m) m = v; } });
    if (p.norm && m > 1e-6) { const k = Math.pow(10, -1 / 20) / m; chs.forEach((d) => { for (let i = 0; i < d.length; i++) d[i] *= k; }); m *= k; }
    return { chs, rate: r, peak: m };
  }
  async function save() {
    if (!buf) return; $('bgo').disabled = true; say('Processing…'); await new Promise((r) => setTimeout(r, 20));
    try { const { chs, rate, peak } = await render(), f = $('bfmt').value, blob = await Q.encode(chs, rate, f, 192, (x) => say('Encoding MP3… ' + Math.round(x * 100) + '%')); Q.save(blob, name + ' boosted.' + f); say('Saved ' + name + ' boosted.' + f + '. New peak ' + db(peak).toFixed(1) + ' dBFS (was ' + db(peakIn).toFixed(1) + ').'); return { blob, peak }; }
    catch (e) { say('Could not save: ' + e.message); } finally { $('bgo').disabled = false; }
  }
  $('bgo').onclick = save; $('bagain').onclick = () => { stop(); off = 0; buf = null; $('bmain').classList.add('hidden'); $('bdrop').classList.remove('hidden'); say(''); };
  if (/[?&]gvtest\b/.test(location.search)) window.__boost = { open, render, save, peakOf, get buf() { return buf; }, set: (v, b, t) => { $('bvol').value = v; $('bbass').value = b; $('btreb').value = t; readout(); } };
})();
