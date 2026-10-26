/* GoVibe Mix — audio converter: decode in the browser, optionally resample or mix to mono, write WAV or MP3. Nothing is uploaded. */
(() => {
  const $ = (id) => document.getElementById(id);
  const MP3_RATES = [48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000];
  const MAX_BYTES = 300 * 1024 * 1024;
  let ctx = null, items = [], busy = false;
  const say = (t) => { $('status').textContent = t; };
  const size = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
  const base = (n) => n.replace(/\.[^.]+$/, '');

  function wavBlob(chans, rate) {
    const n = chans.length, len = chans[0].length, buf = new ArrayBuffer(44 + len * n * 2), v = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + len * n * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, n, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * n * 2, true); v.setUint16(32, n * 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, len * n * 2, true);
    let o = 44; for (let i = 0; i < len; i++) for (let c = 0; c < n; c++) { const s = Math.max(-1, Math.min(1, chans[c][i])); v.setInt16(o, s < 0 ? s * 32768 : s * 32767, true); o += 2; }
    return new Blob([buf], { type: 'audio/wav' });
  }
  const to16 = (f) => { const o = new Int16Array(f.length); for (let i = 0; i < f.length; i++) { const s = Math.max(-1, Math.min(1, f[i])); o[i] = s < 0 ? s * 32768 : s * 32767; } return o; };

  async function prepare(buf, opt) {
    let rate = opt.rate || buf.sampleRate; const mp3 = opt.fmt === 'mp3';
    if (mp3 && !MP3_RATES.includes(rate)) rate = 48000;
    const ch = opt.mono ? 1 : Math.min(2, buf.numberOfChannels);
    if (rate === buf.sampleRate && ch === buf.numberOfChannels) return { chans: [...Array(ch).keys()].map((i) => buf.getChannelData(i)), rate };
    const off = new OfflineAudioContext(ch, Math.max(1, Math.ceil(buf.duration * rate)), rate), s = off.createBufferSource();
    s.buffer = buf; s.connect(off.destination); s.start(); const out = await off.startRendering();
    return { chans: [...Array(ch).keys()].map((i) => out.getChannelData(i)), rate };
  }
  function encodeMp3(chans, rate, kbps, onProg) {
    return new Promise((res, rej) => {
      const w = new Worker('js/convert-worker.js');
      w.onmessage = (e) => { if (e.data.progress != null) onProg(e.data.progress); else if (e.data.done) { w.terminate(); res(e.data.done); } else { w.terminate(); rej(new Error(e.data.error)); } };
      w.onerror = (e) => { w.terminate(); rej(new Error(e.message || 'The MP3 encoder failed to start')); };
      const i16 = chans.map(to16); w.postMessage({ ch: i16, rate, kbps }, i16.map((a) => a.buffer));
    });
  }
  async function convertOne(it, opt) {
    it.state = 'Decoding…'; render();
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    let buf; try { buf = await ctx.decodeAudioData(await it.file.arrayBuffer()); } catch (_) { it.state = 'Could not read this file'; it.err = true; render(); return; }
    it.state = 'Converting…'; render();
    const { chans, rate } = await prepare(buf, opt);
    let blob;
    if (opt.fmt === 'mp3') blob = await encodeMp3(chans, rate, opt.kbps, (p) => { it.state = 'Encoding MP3 ' + Math.round(p * 100) + '%'; render(); });
    else blob = wavBlob(chans, rate);
    if (it.url) URL.revokeObjectURL(it.url);
    it.blob = blob; it.url = URL.createObjectURL(blob); it.out = base(it.file.name) + '.' + opt.fmt; it.state = 'Done'; it.err = false; render();
  }
  async function run() {
    if (busy || !items.length) return; busy = true; $('go').disabled = true;
    const opt = { fmt: $('fmt').value, kbps: +$('kbps').value, rate: +$('rate').value || 0, mono: $('chan').value === 'mono' };
    try { for (const it of items) { if (it.blob && it.opt === JSON.stringify(opt)) continue; it.opt = JSON.stringify(opt); try { await convertOne(it, opt); } catch (e) { it.state = 'Failed: ' + e.message; it.err = true; render(); } } }
    finally { busy = false; $('go').disabled = false; }
    const ok = items.filter((i) => i.blob).length; say(ok + ' of ' + items.length + ' converted.'); render();
  }
  function render() {
    const tb = $('rows'); tb.innerHTML = '';
    items.forEach((it, idx) => {
      const tr = tb.insertRow(); tr.insertCell().textContent = it.file.name; tr.insertCell().textContent = size(it.file.size);
      const st = tr.insertCell(); st.textContent = it.state; if (it.err) st.className = 'bad';
      tr.insertCell().textContent = it.blob ? size(it.blob.size) : '—';
      const act = tr.insertCell();
      if (it.blob) { const a = document.createElement('a'); a.className = 'btn mini'; a.href = it.url; a.download = it.out; a.textContent = 'Download'; a.setAttribute('aria-label', 'Download ' + it.out); act.appendChild(a); }
      const rm = document.createElement('button'); rm.className = 'btn mini'; rm.textContent = '✕'; rm.setAttribute('aria-label', 'Remove ' + it.file.name); rm.disabled = busy; rm.onclick = () => { if (it.url) URL.revokeObjectURL(it.url); items.splice(idx, 1); render(); }; act.appendChild(rm);
    });
    $('list').classList.toggle('hidden', !items.length);
    $('zip').classList.toggle('hidden', items.filter((i) => i.blob).length < 2);
    $('go').disabled = busy || !items.length;
  }
  function add(files) {
    let skipped = 0;
    for (const f of files) { if (f.size > MAX_BYTES) { skipped++; continue; } items.push({ file: f, state: 'Ready', blob: null }); }
    say(skipped ? skipped + ' file(s) skipped: over 300 MB.' : ''); render();
  }
  $('fmt').onchange = () => { $('kbpsw').classList.toggle('hidden', $('fmt').value !== 'mp3'); };
  $('drop').onclick = () => $('file').click();
  $('drop').onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('file').click(); } };
  $('drop').ondragover = (e) => { e.preventDefault(); $('drop').classList.add('over'); };
  $('drop').ondragleave = () => $('drop').classList.remove('over');
  $('drop').ondrop = (e) => { e.preventDefault(); $('drop').classList.remove('over'); add([...e.dataTransfer.files]); };
  $('file').onchange = () => { add([...$('file').files]); $('file').value = ''; };
  $('go').onclick = run;
  $('zip').onclick = async () => {
    const used = {}, entries = [];
    for (const it of items) if (it.blob) { let n = it.out; if (used[n]) n = base(n) + ' (' + used[n] + ')' + n.slice(base(n).length); used[it.out] = (used[it.out] || 0) + 1; entries.push({ name: n, blob: it.blob }); }
    const z = await GVZip.write(entries), a = document.createElement('a'); a.href = URL.createObjectURL(z); a.download = 'govibe-converted.zip'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };
  render();
  if (/[?&]gvtest\b/.test(location.search)) window.__conv = { get items() { return items; }, add, run, wavBlob };
})();
