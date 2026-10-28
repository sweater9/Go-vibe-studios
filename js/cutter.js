/* GoVibe Mix — audio cutter and joiner. */
(() => {
  const Q = window.GVQuick, $ = (id) => document.getElementById(id), say = (t) => { $('status').textContent = t; };
  let buf = null, pk = null, name = 'audio', src = null, t0 = 0, off = 0, raf = 0, playing = false;
  const sel = () => [Math.min(+$('cs').value, +$('ce').value), Math.max(+$('cs').value, +$('ce').value)];
  const paint = (p) => { if (buf) Q.draw($('wave'), pk, sel(), buf.duration, p); };
  function setSel(a, b) { $('cs').value = a.toFixed(2); $('ce').value = b.toFixed(2); $('csr').value = a; $('cer').value = b; info(); }
  const info = () => { const [a, b] = sel(); $('cinfo').textContent = 'Selected ' + Q.fmt(a) + ' to ' + Q.fmt(b) + ' · ' + (b - a).toFixed(2) + ' s of ' + buf.duration.toFixed(2) + ' s'; paint(); };
  async function open(f) {
    try { say('Reading ' + f.name + '…'); stop(); buf = await Q.decode(f); } catch (_) { return say('Could not read that file. Try an MP3, WAV, OGG or M4A.'); }
    name = Q.clean(f.name); pk = Q.peaks(buf, 1200); $('cut').classList.remove('hidden'); $('cdrop').classList.add('hidden');
    ['cs', 'ce', 'csr', 'cer'].forEach((i) => { $(i).max = buf.duration; $(i).step = 0.01; }); setSel(0, buf.duration); say(name + ' · ' + Q.fmt(buf.duration) + ', ' + buf.numberOfChannels + ' channel' + (buf.numberOfChannels > 1 ? 's' : '') + ', ' + buf.sampleRate + ' Hz.');
  }
  Q.hook($('cdrop'), open);
  ['cs', 'ce'].forEach((i) => $(i).addEventListener('input', () => { $(i + 'r').value = $(i).value; info(); }));
  ['csr', 'cer'].forEach((i) => $(i).addEventListener('input', () => { $(i.slice(0, 2)).value = (+$(i).value).toFixed(2); info(); }));
  $('wave').addEventListener('pointerdown', (e) => { const r = $('wave').getBoundingClientRect(), t = (e.clientX - r.left) / r.width * buf.duration, [a, b] = sel(), near = Math.abs(t - a) < Math.abs(t - b); near ? setSel(Math.min(t, b), b) : setSel(a, Math.max(t, a)); });
  function stop() { cancelAnimationFrame(raf); try { src && src.stop(); } catch (_) { /* ended */ } src = null; playing = false; $('cplay').textContent = '▶ Play selection'; }
  function play() {
    if (playing) { stop(); paint(); return; } const [a, b] = sel(); if (b - a < 0.05) return say('Select a longer part first.');
    const c = Q.AC(); c.resume(); src = c.createBufferSource(); src.buffer = buf; const g = c.createGain(); src.connect(g); g.connect(c.destination); fades(g.gain, c.currentTime, b - a); src.start(0, a, b - a); t0 = c.currentTime; off = a; playing = true; $('cplay').textContent = '❚❚ Stop';
    src.onended = () => { if (playing) { stop(); paint(); } }; const tick = () => { if (!playing) return; paint(off + c.currentTime - t0); raf = requestAnimationFrame(tick); }; tick();
  }
  const fades = (p, at, len) => { const fi = Math.min(+$('cfi').value, len / 2), fo = Math.min(+$('cfo').value, len / 2); p.setValueAtTime(fi > 0 ? 0 : 1, at); if (fi > 0) p.linearRampToValueAtTime(1, at + fi); if (fo > 0) { p.setValueAtTime(1, at + len - fo); p.linearRampToValueAtTime(0, at + len); } };
  $('cplay').onclick = play;
  async function cutOut(keepInside) {
    const [a, b] = sel(), r = buf.sampleRate, i0 = Math.round(a * r), i1 = Math.round(b * r), n = buf.numberOfChannels, chs = [];
    for (let c = 0; c < n; c++) { const d = buf.getChannelData(c); chs.push(keepInside ? d.slice(i0, i1) : (() => { const o = new Float32Array(d.length - (i1 - i0)); o.set(d.subarray(0, i0)); o.set(d.subarray(i1), i0); return o; })()); }
    const len = chs[0].length; if (len < 10) throw new Error('Nothing would be left.');
    const fi = Math.min(Math.round(+$('cfi').value * r), len >> 1), fo = Math.min(Math.round(+$('cfo').value * r), len >> 1);
    if (keepInside) chs.forEach((d) => { for (let i = 0; i < fi; i++) d[i] *= i / fi; for (let i = 0; i < fo; i++) d[len - 1 - i] *= i / fo; });
    return { chs, rate: r };
  }
  async function exportIt(keepInside) {
    if (!buf) return; $('cbusy').classList.remove('hidden'); try {
      const { chs, rate } = await cutOut(keepInside), f = $('cfmt').value, blob = await Q.encode(chs, rate, f, +$('ckbps').value, (p) => say('Encoding MP3… ' + Math.round(p * 100) + '%'));
      Q.save(blob, name + (keepInside ? ' cut' : ' trimmed') + '.' + f); say('Saved ' + name + (keepInside ? ' cut' : ' trimmed') + '.' + f + ' (' + (blob.size / 1048576).toFixed(2) + ' MB).'); return blob;
    } catch (e) { say('Could not save: ' + e.message); } finally { $('cbusy').classList.add('hidden'); }
  }
  $('ckeep').onclick = () => exportIt(true); $('cremove').onclick = () => exportIt(false);
  $('cagain').onclick = () => { stop(); buf = null; $('cut').classList.add('hidden'); $('cdrop').classList.remove('hidden'); say(''); };

  /* ---------- joiner ---------- */
  const parts = [];
  const paintJ = () => {
    const ul = $('jlist'); ul.innerHTML = ''; parts.forEach((p, i) => { const li = document.createElement('li'); li.className = 'jrow'; const s = document.createElement('span'); s.textContent = (i + 1) + '. ' + p.name + ' (' + Q.fmt(p.buf.duration) + ')'; li.appendChild(s);
      [['↑', 'Move up', () => { if (i) [parts[i - 1], parts[i]] = [parts[i], parts[i - 1]]; }], ['↓', 'Move down', () => { if (i < parts.length - 1) [parts[i + 1], parts[i]] = [parts[i], parts[i + 1]]; }], ['✕', 'Remove', () => parts.splice(i, 1)]].forEach(([t, l, fn]) => { const b = document.createElement('button'); b.className = 'btn mini'; b.textContent = t; b.setAttribute('aria-label', l + ' ' + p.name); b.onclick = () => { fn(); paintJ(); }; li.appendChild(b); }); ul.appendChild(li); });
    $('jgo').disabled = parts.length < 2; $('jtotal').textContent = parts.length ? parts.length + ' files, ' + Q.fmt(parts.reduce((a, p) => a + p.buf.duration, 0)) + ' in total' : 'No files yet.';
  };
  $('jadd').onclick = () => $('jfile').click();
  $('jfile').onchange = async () => { for (const f of [...$('jfile').files]) { try { parts.push({ name: Q.clean(f.name), buf: await Q.decode(f) }); } catch (_) { $('jstatus').textContent = 'Could not read ' + f.name + '.'; } } $('jfile').value = ''; paintJ(); };
  async function join() {
    if (parts.length < 2) return; $('jgo').disabled = true; $('jstatus').textContent = 'Joining…';
    try {
      const rate = 44100, x = +$('jx').value, n = 2, total = parts.reduce((a, p, i) => a + p.buf.duration - (i ? Math.min(x, p.buf.duration / 2) : 0), 0), oc = new OfflineAudioContext(n, Math.ceil(total * rate), rate); let at = 0;
      parts.forEach((p, i) => { const s = oc.createBufferSource(), g = oc.createGain(), f = i ? Math.min(x, p.buf.duration / 2, parts[i - 1].buf.duration / 2) : 0; s.buffer = p.buf; s.connect(g); g.connect(oc.destination); const st = i ? at - f : 0; if (f > 0) { g.gain.setValueAtTime(0, st); g.gain.linearRampToValueAtTime(1, st + f); } if (i < parts.length - 1) { const nf = Math.min(x, parts[i + 1].buf.duration / 2, p.buf.duration / 2); if (nf > 0) { g.gain.setValueAtTime(1, st + p.buf.duration - nf); g.gain.linearRampToValueAtTime(0, st + p.buf.duration); } } s.start(Math.max(0, st)); at = st + p.buf.duration; });
      const out = await oc.startRendering(), f = $('jfmt').value, chs = [out.getChannelData(0), out.getChannelData(1)], blob = await Q.encode(chs, rate, f, 192, (p) => ($('jstatus').textContent = 'Encoding MP3… ' + Math.round(p * 100) + '%'));
      Q.save(blob, 'GoVibe joined.' + f); $('jstatus').textContent = 'Saved GoVibe joined.' + f + ' (' + Q.fmt(out.duration) + ').'; return { blob, dur: out.duration };
    } catch (e) { $('jstatus').textContent = 'Could not join: ' + e.message; } finally { $('jgo').disabled = parts.length < 2; }
  }
  $('jgo').onclick = join; paintJ();
  if (/[?&]gvtest\b/.test(location.search)) window.__cut = { open, setSel, sel, exportIt, cutOut, join, get parts() { return parts; }, get buf() { return buf; }, addPart: (n, b) => { parts.push({ name: n, buf: b }); paintJ(); } };
})();
