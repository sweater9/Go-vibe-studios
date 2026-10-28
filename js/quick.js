/* GoVibe Mix — shared helpers for the quick audio tools (cutter, booster): decode a file, draw its waveform, encode WAV or MP3, save. Everything stays on this device. */
window.GVQuick = (() => {
  let ctx = null; const AC = () => (ctx = ctx || new (window.AudioContext || window.webkitAudioContext)());
  const decode = async (file) => AC().decodeAudioData(await file.arrayBuffer());
  const fmt = (s) => { s = Math.max(0, s); const m = Math.floor(s / 60); return m + ':' + (s - m * 60).toFixed(2).padStart(5, '0'); };
  const clean = (n) => String(n || 'audio').replace(/\.[a-z0-9]{2,4}$/i, '');
  const peaks = (buf, n) => { const out = new Float32Array(n), ch = [...Array(buf.numberOfChannels)].map((_, c) => buf.getChannelData(c)), step = buf.length / n; for (let i = 0; i < n; i++) { let m = 0; const a = Math.floor(i * step), b = Math.max(a + 1, Math.floor((i + 1) * step)), k = Math.max(1, Math.floor((b - a) / 64)); for (const d of ch) for (let j = a; j < b; j += k) { const v = Math.abs(d[j]); if (v > m) m = v; } out[i] = m; } return out; };
  function draw(canvas, pk, sel, dur, play) {
    const g = canvas.getContext('2d'), W = canvas.width, H = canvas.height; g.clearRect(0, 0, W, H); g.fillStyle = '#0b0b14'; g.fillRect(0, 0, W, H);
    const x0 = sel ? sel[0] / dur * W : 0, x1 = sel ? sel[1] / dur * W : W;
    for (let x = 0; x < W; x++) { const v = pk[Math.min(pk.length - 1, Math.floor(x / W * pk.length))] * H * 0.46, on = x >= x0 && x <= x1; g.fillStyle = on ? '#8b5cf6' : '#3b3b5c'; g.fillRect(x, H / 2 - v, 1, Math.max(1, v * 2)); }
    if (sel) { g.fillStyle = '#22d3ee'; g.fillRect(x0 - 1, 0, 2, H); g.fillRect(x1 - 1, 0, 2, H); }
    if (play != null) { g.fillStyle = '#fff'; g.fillRect(play / dur * W - 1, 0, 2, H); }
  }
  const i16 = (f) => { const o = new Int16Array(f.length); for (let i = 0; i < f.length; i++) { const x = Math.max(-1, Math.min(1, f[i])); o[i] = x < 0 ? x * 32768 : x * 32767; } return o; };
  function wav(chs, rate) {
    const n = chs[0].length, c = chs.length, hdr = new DataView(new ArrayBuffer(44)), w = (o, s) => { for (let i = 0; i < s.length; i++) hdr.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); hdr.setUint32(4, 36 + n * c * 2, true); w(8, 'WAVEfmt '); hdr.setUint32(16, 16, true); hdr.setUint16(20, 1, true); hdr.setUint16(22, c, true); hdr.setUint32(24, rate, true); hdr.setUint32(28, rate * c * 2, true); hdr.setUint16(32, c * 2, true); hdr.setUint16(34, 16, true); w(36, 'data'); hdr.setUint32(40, n * c * 2, true);
    const parts = [hdr.buffer], B = 1 << 16, I = chs.map(i16); for (let i = 0; i < n; i += B) { const m = Math.min(B, n - i), o = new Int16Array(m * c); for (let k = 0; k < m; k++) for (let q = 0; q < c; q++) o[k * c + q] = I[q][i + k]; parts.push(o.buffer); }
    return new Blob(parts, { type: 'audio/wav' });
  }
  const RATES = [48000, 44100, 32000, 24000, 22050, 16000];
  function mp3(chs, rate, kbps, onProgress) {
    return new Promise((res, rej) => {
      if (!RATES.includes(rate)) return rej(new Error('MP3 does not support ' + rate + ' Hz here. Choose WAV.'));
      const w = new Worker('js/convert-worker.js'); w.onmessage = (e) => { if (e.data.done) { w.terminate(); res(e.data.done); } else if (e.data.error) { w.terminate(); rej(new Error(e.data.error)); } else if (e.data.progress != null && onProgress) onProgress(e.data.progress); };
      const a = chs.slice(0, 2).map(i16); w.postMessage({ ch: a, rate, kbps: kbps || 192 }, a.map((x) => x.buffer));
    });
  }
  const encode = (chs, rate, format, kbps, onP) => (format === 'mp3' ? mp3(chs, rate, kbps, onP) : Promise.resolve(wav(chs, rate)));
  const save = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 6000); };
  const hook = (el, onFile) => { // make a drop zone with a hidden file input work
    const input = document.getElementById(el.dataset.input), pick = (f) => f && onFile(f);
    el.addEventListener('click', () => input.click()); el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('over'); }); el.addEventListener('dragleave', () => el.classList.remove('over'));
    el.addEventListener('drop', (e) => { e.preventDefault(); el.classList.remove('over'); pick(e.dataTransfer.files[0]); }); input.onchange = () => { pick(input.files[0]); input.value = ''; };
  };
  return { AC, decode, fmt, clean, peaks, draw, wav, mp3, encode, save, hook };
})();
