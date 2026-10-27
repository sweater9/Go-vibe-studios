/* GoVibe Mix — tuner: pitch detection with the YIN method, written from the published algorithm. Audio stays on the device. */
(() => {
  const $ = (id) => document.getElementById(id);
  const SHARP = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'], FLAT = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
  const TUNINGS = { // MIDI numbers, low string first
    guitar: [40, 45, 50, 55, 59, 64], bass: [28, 33, 38, 43], ukulele: [67, 60, 64, 69], violin: [55, 62, 69, 76],
  };
  let a4 = 440, flats = false, inst = 'chromatic';
  const midiHz = (m) => a4 * Math.pow(2, (m - 69) / 12);
  const name = (m) => (flats ? FLAT : SHARP)[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);

  /* ---------- YIN pitch detection ---------- */
  function detect(buf, rate) {
    const W = 2048, minHz = 27, maxHz = 2200;
    const tauMax = Math.min(Math.floor(rate / minHz), buf.length - W - 1), tauMin = Math.max(2, Math.floor(rate / maxHz));
    if (tauMax <= tauMin) return null;
    const start = buf.length - W - tauMax - 1 >= 0 ? buf.length - W - tauMax - 1 : 0;
    let e = 0; for (let i = 0; i < W; i++) e += buf[start + i] * buf[start + i];
    if (Math.sqrt(e / W) < 0.006) return null; // too quiet
    const d = new Float32Array(tauMax + 1);
    for (let tau = 1; tau <= tauMax; tau++) { let s = 0; for (let i = 0; i < W; i++) { const x = buf[start + i] - buf[start + i + tau]; s += x * x; } d[tau] = s; }
    const cm = new Float32Array(tauMax + 1); cm[0] = 1; let run = 0;
    for (let tau = 1; tau <= tauMax; tau++) { run += d[tau]; cm[tau] = run > 0 ? d[tau] * tau / run : 1; }
    let tau = -1; const TH = 0.14;
    for (let t = tauMin; t <= tauMax; t++) {
      if (cm[t] < TH) { while (t + 1 <= tauMax && cm[t + 1] < cm[t]) t++; tau = t; break; }
    }
    if (tau < 0) { // no clear dip: take the deepest one if it is still decent
      let best = tauMin; for (let t = tauMin; t <= tauMax; t++) if (cm[t] < cm[best]) best = t;
      if (cm[best] > 0.3) return null; tau = best;
    }
    let tp = tau; // parabolic interpolation
    if (tau > 1 && tau < tauMax) { const a = cm[tau - 1], b = cm[tau], c = cm[tau + 1], den = a - 2 * b + c; if (den !== 0) tp = tau + 0.5 * (a - c) / den; }
    return { hz: rate / tp, clarity: 1 - cm[tau] };
  }
  function noteOf(hz) {
    const m = 69 + 12 * Math.log2(hz / a4), n = Math.round(m);
    return { midi: n, cents: (m - n) * 100, name: name(n), target: midiHz(n) };
  }

  /* ---------- gauge ---------- */
  const NS = 'http://www.w3.org/2000/svg';
  (function ticks() {
    const g = $('ticks'); if (!g) return;
    for (let c = -50; c <= 50; c += 10) {
      const a = c * 0.9 * Math.PI / 180, r1 = c % 50 === 0 || c === 0 ? 138 : 146, r2 = 160, l = document.createElementNS(NS, 'line');
      l.setAttribute('x1', 200 + Math.sin(a) * r1); l.setAttribute('y1', 210 - Math.cos(a) * r1); l.setAttribute('x2', 200 + Math.sin(a) * r2); l.setAttribute('y2', 210 - Math.cos(a) * r2); l.setAttribute('class', c === 0 ? 'tk mid' : 'tk');
      g.appendChild(l);
    }
  })();
  let lastVerdict = '', verdictAt = 0;
  function show(info, hz) {
    const n = $('needle'), v = $('verdict');
    if (!info) { $('note').classList.add('dim'); n.style.opacity = '.35'; return; }
    $('note').classList.remove('dim'); n.style.opacity = '1';
    const c = Math.max(-50, Math.min(50, info.cents));
    n.style.transform = 'rotate(' + (c * 0.9) + 'deg)';
    $('note').textContent = info.name; $('hz').textContent = hz.toFixed(1) + ' Hz';
    $('cents').textContent = (info.cents >= 0 ? '+' : '−') + Math.abs(info.cents).toFixed(0) + ' cents';
    const ok = Math.abs(info.cents) <= 5, txt = ok ? 'In tune' : info.cents < 0 ? 'Too low, tune up' : 'Too high, tune down';
    v.className = 'tverdict ' + (ok ? 'good' : Math.abs(info.cents) < 15 ? 'near' : 'off');
    $('gauge').classList.toggle('good', ok);
    const now = performance.now(); if (txt !== lastVerdict && now - verdictAt > 600) { v.textContent = txt; lastVerdict = txt; verdictAt = now; }
    for (const b of document.querySelectorAll('#strings button')) b.classList.toggle('near', +b.dataset.m === info.midi);
  }

  /* ---------- strings and reference tones ---------- */
  let ctx = null, tone = null;
  function renderStrings() {
    const box = $('strings'), list = TUNINGS[inst]; box.innerHTML = '';
    $('strhelp').textContent = list ? 'Press a string to hear its note. The one you are playing lights up.' : 'Chromatic mode listens for any note.';
    box.classList.toggle('hidden', !list); if (!list) return;
    list.forEach((m, i) => { const b = document.createElement('button'); b.className = 'btn'; b.dataset.m = m; b.textContent = name(m); b.setAttribute('aria-label', 'Play ' + name(m) + ', string ' + (list.length - i)); b.onclick = () => play(m, b); box.appendChild(b); });
  }
  function play(m, btn) {
    if (!ctx) return; stopTone();
    const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
    o.type = 'triangle'; o2.type = 'sine'; o.frequency.value = midiHz(m); o2.frequency.value = midiHz(m) * 2;
    const g2 = ctx.createGain(); g2.gain.value = 0.15; o2.connect(g2); g2.connect(g); o.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.25, t + 0.05); g.gain.setValueAtTime(0.25, t + 2.4); g.gain.linearRampToValueAtTime(0, t + 2.8);
    o.start(t); o2.start(t); o.stop(t + 2.9); o2.stop(t + 2.9);
    tone = { o, o2, g, btn }; btn.classList.add('playing'); o.onended = () => { btn.classList.remove('playing'); if (tone && tone.o === o) tone = null; };
  }
  function stopTone() { if (!tone) return; try { tone.g.gain.cancelScheduledValues(ctx.currentTime); tone.g.gain.setValueAtTime(0, ctx.currentTime); tone.o.stop(); tone.o2.stop(); } catch (_) {} tone.btn.classList.remove('playing'); tone = null; }

  /* ---------- microphone ---------- */
  let an = null, stream = null, buf = null, hist = [], quiet = 0, raf = 0, last = 0;
  async function open() {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } });
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); await ctx.resume();
    const src = ctx.createMediaStreamSource(stream); an = ctx.createAnalyser(); an.fftSize = 8192; an.smoothingTimeConstant = 0; src.connect(an);
    buf = new Float32Array(an.fftSize); $('setup').classList.add('hidden'); $('rig').classList.remove('hidden'); renderStrings(); loop();
  }
  function level(b) { let pk = 0; for (let i = b.length - 2048; i < b.length; i++) pk = Math.max(pk, Math.abs(b[i])); const db = pk > 1e-5 ? 20 * Math.log10(pk) : -90; $('lvl').style.width = Math.max(0, Math.min(100, (db + 60) / 60 * 100)) + '%'; $('meter').setAttribute('aria-valuenow', Math.round(db)); $('lvltxt').textContent = db > -89 ? Math.round(db) + ' dB' : 'silence'; }
  function feed(hz) {
    if (!hz) { if (++quiet > 10) { hist = []; show(null); if (quiet === 11) { $('verdict').className = 'tverdict'; $('verdict').textContent = 'Play a note'; lastVerdict = ''; $('cents').textContent = 'listening…'; } } return; }
    quiet = 0; hist.push(hz); if (hist.length > 5) hist.shift();
    // reject a jump of more than a semitone against the recent median, unless it keeps coming
    const s = hist.slice().sort((a, b) => a - b), med = s[s.length >> 1];
    const use = hist.filter((h) => Math.abs(12 * Math.log2(h / med)) < 1);
    const hzOut = use.length ? use.reduce((a, b) => a + b, 0) / use.length : hz;
    show(noteOf(hzOut), hzOut);
  }
  function loop() {
    raf = requestAnimationFrame(loop); const t = performance.now(); if (t - last < 40) return; last = t;
    an.getFloatTimeDomainData(buf); level(buf); const r = detect(buf, ctx.sampleRate); feed(r && r.clarity > 0.8 ? r.hz : 0);
  }

  $('allow').onclick = () => { open().catch((e) => { $('allow').parentElement.insertAdjacentHTML('afterend', '<p class="status" role="alert">The microphone could not be opened (' + (e && e.name || 'error') + '). Check the browser permission and try again.</p>'); }); };
  $('inst').onchange = () => { inst = $('inst').value; renderStrings(); };
  $('acc').onchange = () => { flats = $('acc').value === 'f'; renderStrings(); };
  $('a4').onchange = () => { const v = Math.max(415, Math.min(466, +$('a4').value || 440)); a4 = v; $('a4').value = v; };
  window.addEventListener('pagehide', () => { cancelAnimationFrame(raf); if (stream) stream.getTracks().forEach((t) => t.stop()); });

  if (/[?&]gvtest\b/.test(location.search)) window.__tuner = { detect, noteOf, show: (hz) => show(noteOf(hz), hz), setA4: (v) => { a4 = v; }, get a4() { return a4; } };
})();
