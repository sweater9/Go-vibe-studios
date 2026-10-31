/* GoVibe Mix: practice player. Slow a song down or change its key without changing the other, loop a section, hear a count-in and a click,
   and, if you like, split it into rough stems (vocals, drums, bass, music) to mute or solo. The stems use signal processing, not AI. Everything stays on this device. */
(() => {
  const $ = (id) => document.getElementById(id), Q = window.GVQuick, S = window.GVStretch, say = (t) => { $('status').textContent = t; }, MAX = 300;
  const NAMES = { vocals: 'Vocals', drums: 'Drums', bass: 'Bass', music: 'Other music', song: 'Song' };
  const nap = () => new Promise((r) => setTimeout(r, 0));
  let ac = null, buf = null, name = 'song', tracks = [], mute = {}, solo = {}, proc = null, procSig = '', pk = null;
  let playing = false, srcs = [], songStart = 0, startProc = 0, opos = 0, A = null, B = null, timer = 0, raf = 0, nextClick = 0, busy = false;
  const P = () => ({ speed: +$('speed').value / 100, semi: +$('semi').value });
  const AC = () => (ac = ac || Q.AC());
  const sig = () => { const p = P(); return p.speed + '|' + p.semi + '|' + tracks.map((t) => t.key).join(); };
  const readout = () => { const p = P(); $('vs').textContent = Math.round(p.speed * 100) + '%'; $('vk').textContent = (p.semi > 0 ? '+' : '') + p.semi + ' semitones'; };
  function chansOf(b) { return [...Array(b.numberOfChannels)].map((_, i) => b.getChannelData(i)); }
  async function prepare() {
    const s = sig(); if (proc && s === procSig) return proc; const p = P(); say('Preparing the sound…'); await nap(); const out = {};
    for (const t of tracks) {
      let r = chansOf(t.buf); if (Math.abs(p.speed - 1) > 1e-4) r = S.stretch(r, 1 / p.speed); if (p.semi) r = S.pitchShift(r, p.semi);
      out[t.key] = r; await nap();
    }
    proc = out; procSig = s; say(''); return out;
  }
  const speed = () => P().speed;
  const audible = (k) => { const anySolo = Object.values(solo).some(Boolean); return anySolo ? !!solo[k] : !mute[k]; };
  function click(t, accent) { const o = AC().createOscillator(), g = AC().createGain(); o.frequency.value = accent ? 1500 : 1000; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05); o.connect(g).connect(AC().destination); o.start(t); o.stop(t + 0.06); }
  async function play() {
    if (!buf || busy) return; if (playing) return stop(); busy = true; const pr = await prepare(); busy = false; const c = AC(); if (c.state === 'suspended') await c.resume();
    const sp = speed(), tempo = Math.max(30, Math.min(300, +$('tempo').value || 100)) * sp, beat = 60 / tempo, count = $('count').checked ? Math.max(1, +$('beats').value || 4) : 0;
    if (A != null && B != null && opos >= B) opos = A; startProc = opos / sp; const t0 = c.currentTime + 0.08; songStart = t0 + count * beat;
    for (let i = 0; i < count; i++) click(t0 + i * beat, i === 0);
    srcs = []; const looping = $('loop').checked && A != null && B != null && B > A + 0.2;
    tracks.forEach((t) => {
      const chs = pr[t.key], ab = c.createBuffer(chs.length, chs[0].length, buf.sampleRate); chs.forEach((x, i) => ab.copyToChannel(x, i));
      const s = c.createBufferSource(), g = c.createGain(); s.buffer = ab; g.gain.value = audible(t.key) ? 1 : 0; t.gain = g;
      if (looping) { s.loop = true; s.loopStart = A / sp; s.loopEnd = Math.min(B / sp, ab.duration); } s.connect(g).connect(c.destination); s.start(songStart, Math.min(startProc, ab.duration - 0.01)); srcs.push(s);
    });
    playing = true; $('play').textContent = '■ Stop'; nextClick = songStart; schedule(); timer = setInterval(schedule, 80); raf = requestAnimationFrame(frame);
    if (srcs[0] && !looping) srcs[0].onended = () => { if (playing && !($('loop').checked)) { stop(); opos = 0; draw(); } };
  }
  function schedule() { if (!playing || !$('metro').checked) return; const c = AC(), tempo = Math.max(30, Math.min(300, +$('tempo').value || 100)) * speed(), beat = 60 / tempo; while (nextClick < c.currentTime + 0.25) { if (nextClick >= c.currentTime - 0.02) click(nextClick, false); nextClick += beat; } }
  function posNow() {
    const c = AC(), sp = speed(); let pp = startProc + Math.max(0, c.currentTime - songStart);
    if ($('loop').checked && A != null && B != null && B > A + 0.2) { const as = A / sp, bs = B / sp; if (pp > as) pp = as + ((pp - as) % (bs - as)); }
    return Math.min(buf.duration, pp * sp);
  }
  function frame() { if (!playing) return; opos = posNow(); draw(); raf = requestAnimationFrame(frame); }
  function stop() { playing = false; clearInterval(timer); cancelAnimationFrame(raf); srcs.forEach((s) => { try { s.onended = null; s.stop(); } catch (_) { /* done */ } }); srcs = []; $('play').textContent = '▶ Play'; draw(); }
  function restartIfPlaying() { if (playing) { const keep = opos; stop(); opos = keep; play(); } }
  function draw() {
    if (!buf || !pk) return; const cv = $('wave'); Q.draw(cv, pk, A != null && B != null ? [Math.min(A, B), Math.max(A, B)] : null, buf.duration, opos);
    $('clock').textContent = Q.fmt(opos) + ' / ' + Q.fmt(buf.duration); $('la').textContent = A == null ? 'not set' : Q.fmt(A); $('lb').textContent = B == null ? 'not set' : Q.fmt(B);
  }
  function seekTo(t) { opos = Math.max(0, Math.min(buf.duration - 0.05, t)); draw(); restartIfPlaying(); }
  $('wave').addEventListener('click', (e) => { if (!buf) return; const r = $('wave').getBoundingClientRect(); seekTo((e.clientX - r.left) / r.width * buf.duration); });
  $('wave').addEventListener('keydown', (e) => { if (!buf) return; if (e.key === 'ArrowRight') { e.preventDefault(); seekTo(opos + 5); } if (e.key === 'ArrowLeft') { e.preventDefault(); seekTo(opos - 5); } });
  function renderTracks() {
    const box = $('tracks'); box.replaceChildren(); tracks.forEach((t) => {
      const row = document.createElement('div'); row.className = 'rstep'; const nm = document.createElement('strong'); nm.textContent = NAMES[t.key]; row.appendChild(nm);
      const g = document.createElement('div'); g.className = 'row';
      [['Mute', mute], ['Solo', solo]].forEach(([lab, st]) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn mini'; b.textContent = lab; b.setAttribute('aria-pressed', String(!!st[t.key])); b.setAttribute('aria-label', lab + ' ' + NAMES[t.key]); b.onclick = () => { st[t.key] = !st[t.key]; renderTracks(); applyGains(); }; g.appendChild(b); });
      row.appendChild(g); box.appendChild(row);
    });
  }
  function applyGains() { tracks.forEach((t) => { if (t.gain) t.gain.gain.value = audible(t.key) ? 1 : 0; }); }
  async function open(f) {
    try { say('Reading ' + f.name + '…'); stop(); buf = await Q.decode(f); } catch (e) { return say('Could not read that file: ' + ((e && e.message) || 'unknown error')); }
    if (buf.duration > MAX) { buf = null; return say('This file is longer than 5 minutes. Cut it shorter in the audio cutter first.'); }
    name = Q.clean(f.name); tracks = [{ key: 'song', buf }]; mute = {}; solo = {}; proc = null; procSig = ''; A = B = null; opos = 0; pk = Q.peaks(buf, 1000);
    $('pdrop').hidden = true; $('pmain').hidden = false; $('fname').textContent = f.name + ' · ' + Q.fmt(buf.duration); $('split').disabled = false; $('stemnote').textContent = ''; renderTracks(); draw(); say('Ready. Press Play.');
  }
  function split() {
    if (!buf || busy) return; busy = true; stop(); $('split').disabled = true; const n = buf.length, L = new Float32Array(buf.getChannelData(0)), R = new Float32Array(buf.numberOfChannels > 1 ? buf.getChannelData(1) : buf.getChannelData(0));
    let w; try { w = new Worker('js/stems-worker.js'); } catch (_) { busy = false; $('split').disabled = false; return say('This browser could not start the splitter.'); }
    w.onerror = () => { busy = false; w.terminate(); $('split').disabled = false; say('Splitting failed in this browser.'); };
    w.onmessage = (e) => {
      const m = e.data; if (m.progress != null) return say('Splitting… ' + Math.round(m.progress * 100) + '%'); if (!m.done) return;
      const o = m.out, mk = (arrs) => { const b2 = AC().createBuffer(arrs.length, n, buf.sampleRate); arrs.forEach((a, i) => b2.copyToChannel(a, i)); return b2; };
      tracks = [{ key: 'vocals', buf: mk([o.vocals]) }, { key: 'drums', buf: mk([o.drumsL, o.drumsR]) }, { key: 'bass', buf: mk([o.bass]) }, { key: 'music', buf: mk([o.musicL, o.musicR]) }]; mute = {}; solo = {}; proc = null; procSig = '';
      w.terminate(); busy = false; renderTracks(); $('stemnote').textContent = 'These stems are made with signal processing, not AI, so expect some bleed between them. They add back up to the original.'; say(m.mono ? 'Done. This track looks mono, so the vocals stem holds most of the melody. Stereo recordings split better.' : 'Done. Use Mute and Solo on each part.');
    };
    w.postMessage({ L, R, sr: buf.sampleRate }, [L.buffer, R.buffer]);
  }
  async function mixOf(onlyLoop) {
    const pr = await prepare(), sp = speed(), keys = tracks.filter((t) => audible(t.key)).map((t) => t.key); if (!keys.length) return null;
    const len = Math.max(...keys.map((k) => pr[k][0].length)), outCh = Math.max(...keys.map((k) => pr[k].length)), out = [...Array(outCh)].map(() => new Float32Array(len));
    keys.forEach((k) => pr[k].forEach((x, c) => { const o = out[c]; for (let i = 0; i < x.length; i++) o[i] += x[i]; if (pr[k].length === 1 && outCh > 1) { for (let c2 = 1; c2 < outCh; c2++) { const o2 = out[c2]; for (let i = 0; i < x.length; i++) o2[i] += x[i]; } } }));
    if (onlyLoop && A != null && B != null && B > A) { const a = Math.floor(A / sp * buf.sampleRate), b = Math.min(len, Math.ceil(B / sp * buf.sampleRate)); return out.map((x) => x.slice(a, b)); }
    return out;
  }
  $('savemix').onclick = async () => { if (!buf || busy) return; busy = true; try { const m = await mixOf($('onlyloop').checked); if (!m) say('Every part is muted, so there is nothing to save.'); else { Q.save(Q.wav(m, buf.sampleRate), name + '-practice.wav'); say('Saved.'); } } finally { busy = false; } };
  $('savestems').onclick = async () => {
    if (!buf || busy || tracks.length < 2) return say('Split the song into stems first.'); busy = true;
    try { const pr = await prepare(), ent = tracks.map((t) => ({ name: name + '-' + t.key + '.wav', blob: Q.wav(pr[t.key], buf.sampleRate) })); Q.save(await GVZip.write(ent), name + '-stems.zip'); say('Saved the stems as a ZIP file.'); } catch (e) { say('Could not save: ' + e.message); } finally { busy = false; }
  };
  $('play').onclick = play; $('tostart').onclick = () => seekTo(A != null ? A : 0);
  $('seta').onclick = () => { A = opos; if (B != null && B <= A) B = null; draw(); restartIfPlaying(); }; $('setb').onclick = () => { if (A == null) A = 0; if (opos > A + 0.2) { B = opos; $('loop').checked = true; } draw(); restartIfPlaying(); };
  $('clear').onclick = () => { A = B = null; draw(); restartIfPlaying(); }; $('loop').onchange = restartIfPlaying;
  $('speed').oninput = readout; $('semi').oninput = readout; $('speed').onchange = () => { readout(); restartIfPlaying(); }; $('semi').onchange = () => { readout(); restartIfPlaying(); };
  $('split').onclick = split; $('again').onclick = () => { stop(); buf = null; tracks = []; $('pmain').hidden = true; $('pdrop').hidden = false; say(''); };
  $('instr').onclick = () => { mute = { vocals: true }; solo = {}; renderTracks(); applyGains(); }; $('vonly').onclick = () => { solo = { vocals: true }; mute = {}; renderTracks(); applyGains(); }; $('all').onclick = () => { mute = {}; solo = {}; renderTracks(); applyGains(); };
  Q.hook($('pdrop'), open); readout(); if (window.GVSession) GVSession.bind({ bpm: $('tempo') }); window.addEventListener('pagehide', stop);
  if (/[?&]gvtest\b/.test(location.search)) window.__prac = { open, play, stop, split, prepare, mixOf, get tracks() { return tracks; }, get pos() { return opos; }, get playing() { return playing; }, get loop() { return [A, B]; }, setLoop(a, b) { A = a; B = b; $('loop').checked = true; draw(); }, get proc() { return proc; } };
})();
