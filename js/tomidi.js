/* GoVibe Mix: audio to MIDI. Finds the notes of a single melodic line (a voice, a whistle, a bass, a lead) and saves them as a MIDI file.
   It follows one note at a time, so chords and full mixes will not come out right. Everything runs in this browser. */
(() => {
  const $ = (id) => document.getElementById(id), Q = window.GVQuick, P = window.GVPitch;
  const say = (t) => { $('status').textContent = t; };
  let buf = null, notes = [], fileName = 'melody', playing = null;
  const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
  const RANGES = { voice: [80, 1000], bass: [35, 330], lead: [180, 1500], any: [50, 1500] };
  const nap = () => new Promise((r) => setTimeout(r, 0));
  /* chan: Float32Array mono. Returns [{ s, d, p, v }] in seconds, MIDI pitch, velocity 1 to 127. */
  async function analyse(chan, sr, opt = {}) {
    const [fmin, fmax] = opt.range || RANGES.voice, f = Math.max(1, Math.round(sr / 16000)), rate = sr / f, n = Math.floor(chan.length / f), d = new Float32Array(n);
    for (let i = 0; i < n; i++) { let s = 0; for (let k = 0; k < f; k++) s += chan[i * f + k]; d[i] = s / f; }
    const win = 1024, hop = 320, frames = Math.max(0, Math.floor((n - win) / hop)), lv = new Float32Array(frames), pitch = new Array(frames).fill(null);
    for (let i = 0; i < frames; i++) lv[i] = P.rms(d.subarray(i * hop, i * hop + win));
    const sorted = [...lv].sort((a, b) => a - b), top = sorted[Math.floor(sorted.length * 0.95)] || 0, gate = Math.max(0.004, top * 0.1 * (opt.gate || 1));
    for (let i = 0; i < frames; i++) {
      if (lv[i] >= gate) { const r = P.yin(d.subarray(i * hop, i * hop + win), rate, fmin, fmax, 0.15); if (r && r.clarity >= 0.75) pitch[i] = P.toMidi(r.hz); }
      if (i % 200 === 0) { if (opt.onProgress) opt.onProgress(i / frames); await nap(); }
    }
    const out = [], minF = Math.max(2, Math.round(0.07 * rate / hop)); let cur = null, gap = 0;
    const close = () => { if (cur && cur.ps.length >= minF) out.push({ s: cur.a * hop / rate, d: (cur.last - cur.a + 1) * hop / rate, p: Math.round(median(cur.ps)), v: cur.v }); cur = null; gap = 0; };
    for (let i = 0; i < frames; i++) {
      const m = pitch[i];
      if (m == null) { if (cur && ++gap > 2) close(); continue; }
      if (cur && Math.abs(m - median(cur.ps)) > 0.75) close();
      if (!cur) cur = { a: i, ps: [], last: i, v: 0, mx: 0 }; cur.ps.push(m); cur.last = i; gap = 0; cur.mx = Math.max(cur.mx, lv[i]); cur.v = Math.round(Math.max(40, Math.min(120, 40 + 80 * Math.min(1, cur.mx / Math.max(1e-6, top)))));
    }
    close(); if (opt.onProgress) opt.onProgress(1); return out;
  }
  const project = (ns, bpm, dur) => { const spb = 60 / bpm; return { bpm, sig: [4, 4], markers: [], tracks: [{ type: 'midi', name: 'Melody', inst: 'Piano', clips: [{ start: 0, dur: Math.max(0.5, dur), notes: ns.map((n) => ({ t: n.s / spb, d: Math.max(0.05, n.d / spb), p: n.p, v: n.v })) }] }] }; };
  const midiBytes = (ns, bpm, dur) => GVMidi.write(project(ns, bpm, dur));
  function mono(b) { const c = b.numberOfChannels, o = new Float32Array(b.length); for (let k = 0; k < c; k++) { const x = b.getChannelData(k); for (let i = 0; i < o.length; i++) o[i] += x[i] / c; } return o; }
  function draw() {
    const cv = $('roll'), g = cv.getContext('2d'), W = cv.width, H = cv.height; g.clearRect(0, 0, W, H); g.fillStyle = '#10101c'; g.fillRect(0, 0, W, H);
    if (!notes.length) return; const dur = buf.duration, lo = Math.min(...notes.map((n) => n.p)) - 2, hi = Math.max(...notes.map((n) => n.p)) + 2, ph = H / (hi - lo + 1);
    g.fillStyle = '#ffffff10'; for (let p = lo; p <= hi; p++) if ([1, 3, 6, 8, 10].includes(p % 12)) g.fillRect(0, H - (p - lo + 1) * ph, W, ph);
    g.fillStyle = '#a58bff'; notes.forEach((n) => g.fillRect(n.s / dur * W, H - (n.p - lo + 1) * ph + 1, Math.max(2, n.d / dur * W - 1), Math.max(2, ph - 2)));
    g.fillStyle = '#9a9ab8'; g.font = '12px sans-serif'; g.fillText(P.name(hi), 4, 14); g.fillText(P.name(lo), 4, H - 6);
  }
  function stopPlay() { if (playing) { playing.forEach((o) => { try { o.stop(); } catch (_) { /* done */ } }); playing = null; } $('play').textContent = '▶ Hear the notes'; }
  function play() {
    if (playing) return stopPlay(); if (!notes.length) return;
    const ac = Q.AC(), t0 = ac.currentTime + 0.05; playing = [];
    notes.forEach((n) => { const o = ac.createOscillator(), g = ac.createGain(); o.type = 'triangle'; o.frequency.value = P.toHz(n.p); const v = 0.25 * n.v / 127; g.gain.setValueAtTime(0, t0 + n.s); g.gain.linearRampToValueAtTime(v, t0 + n.s + 0.01); g.gain.setValueAtTime(v, t0 + n.s + n.d - 0.03); g.gain.linearRampToValueAtTime(0, t0 + n.s + n.d); o.connect(g).connect(ac.destination); o.start(t0 + n.s); o.stop(t0 + n.s + n.d + 0.02); playing.push(o); });
    $('play').textContent = '■ Stop'; const last = playing[playing.length - 1]; last.onended = () => { if (playing) stopPlay(); };
  }
  async function open(file) {
    try { say('Reading ' + file.name + '…'); buf = await Q.decode(file); } catch (e) { return say('Could not read that file: ' + ((e && e.message) || 'unknown error')); }
    if (buf.duration > 300) { buf = null; return say('This file is longer than 5 minutes. Cut it shorter first, for example with the audio cutter.'); }
    fileName = Q.clean(file.name).replace(/\.[^.]+$/, '') || 'melody'; $('fname').textContent = file.name + ' · ' + buf.duration.toFixed(1) + ' s'; $('rmain').hidden = false; $('rdrop').hidden = true; $('res').hidden = true; say('Ready. Choose the kind of sound and press Find the notes.');
  }
  async function run() {
    if (!buf) return; $('go').disabled = true; stopPlay(); const bpm = Math.max(30, Math.min(300, +$('tempo').value || 120));
    try { notes = await analyse(mono(buf), buf.sampleRate, { range: RANGES[$('kind').value], onProgress: (x) => say('Listening… ' + Math.round(x * 100) + '%') }); }
    catch (e) { say('Something went wrong while listening: ' + ((e && e.message) || 'unknown error')); $('go').disabled = false; return; }
    $('go').disabled = false; $('res').hidden = false; draw();
    say(notes.length ? 'Found ' + notes.length + ' note' + (notes.length === 1 ? '' : 's') + ' (' + P.name(Math.min(...notes.map((n) => n.p))) + ' to ' + P.name(Math.max(...notes.map((n) => n.p))) + '). Save the MIDI file or hear them first.' : 'No clear notes were found. Try another kind of sound, or a recording with one voice or instrument and little background noise.');
    $('save').disabled = $('play').disabled = !notes.length;
  }
  $('go').onclick = run; $('play').onclick = play; $('again').onclick = () => { stopPlay(); buf = null; notes = []; $('rmain').hidden = true; $('rdrop').hidden = false; say(''); };
  $('save').onclick = () => { const bpm = Math.max(30, Math.min(300, +$('tempo').value || 120)), b = new Blob([midiBytes(notes, bpm, buf.duration)], { type: 'audio/midi' }); Q.save(b, fileName + '.mid'); say('Saved ' + fileName + '.mid.'); };
  Q.hook($('rdrop'), open);
  if (window.GVSession) GVSession.bind({ bpm: $('tempo') });
  window.addEventListener('pagehide', stopPlay);
  if (/[?&]gvtest\b/.test(location.search)) window.__midi = { analyse, project, midiBytes, RANGES, open, run, get notes() { return notes; } };
})();
