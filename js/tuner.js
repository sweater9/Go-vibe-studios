/* GoVibe Mix: instrument tuner. Listens through the microphone, finds the pitch and shows how far it is from the nearest note. Nothing is recorded or sent. */
(() => {
  const $ = (id) => document.getElementById(id), P = window.GVPitch;
  const SETS = { chromatic: [], guitar: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'], bass: ['E1', 'A1', 'D2', 'G2'], ukulele: ['G4', 'C4', 'E4', 'A4'], violin: ['G3', 'D4', 'A4', 'E5'], cello: ['C2', 'G2', 'D3', 'A3'] };
  const midiOf = (n) => { const m = /^([A-G])(♯|#|b)?(-?\d)$/.exec(n), base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]]; return 12 * (+m[3] + 1) + base + (m[2] === 'b' ? -1 : m[2] ? 1 : 0); };
  let ac = null, stream = null, an = null, buf = null, timer = 0, recent = [], tone = null;
  const a4 = () => Math.max(400, Math.min(480, +$('a4').value || 440));
  function strings() { const set = SETS[$('inst').value] || [], box = $('strings'); box.replaceChildren(); set.forEach((n) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn mini'; b.textContent = n; b.dataset.m = midiOf(n); b.setAttribute('aria-label', 'Play ' + n + ' as a reference tone'); b.onclick = () => ref(midiOf(n), b); box.appendChild(b); }); box.hidden = !set.length; }
  function ref(m, btn) {
    stopTone(); ac = ac || new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume();
    const o = ac.createOscillator(), g = ac.createGain(); o.type = 'sine'; o.frequency.value = P.toHz(m, a4()); g.gain.value = 0; g.gain.linearRampToValueAtTime(0.25, ac.currentTime + 0.05); o.connect(g).connect(ac.destination); o.start(); tone = { o, g, btn };
    btn.setAttribute('aria-pressed', 'true'); setTimeout(() => { if (tone && tone.o === o) stopTone(); }, 4000);
  }
  function stopTone() { if (!tone) return; try { tone.g.gain.cancelScheduledValues(ac.currentTime); tone.g.gain.linearRampToValueAtTime(0, ac.currentTime + 0.05); tone.o.stop(ac.currentTime + 0.08); } catch (_) { /* already stopped */ } tone.btn.setAttribute('aria-pressed', 'false'); tone = null; }
  function show(r) {
    const needle = $('needle'), nm = $('tnote');
    if (!r) { nm.textContent = '—'; $('thz').textContent = 'Play a note'; $('tcents').textContent = ''; needle.style.left = '50%'; document.querySelector('.tmeter').dataset.state = 'idle'; return; }
    const n = P.nearest(r.hz, a4()); nm.textContent = n.name; $('thz').textContent = r.hz.toFixed(1) + ' Hz';
    $('tcents').textContent = n.cents === 0 ? 'In tune' : (n.cents > 0 ? '+' : '') + n.cents + ' cents ' + (n.cents > 0 ? '(too high)' : '(too low)');
    needle.style.left = (50 + Math.max(-50, Math.min(50, n.cents))) + '%'; document.querySelector('.tmeter').dataset.state = Math.abs(n.cents) <= 5 ? 'ok' : 'off';
    document.querySelectorAll('#strings button').forEach((b) => b.classList.toggle('near', +b.dataset.m === n.midi));
  }
  function tick() {
    an.getFloatTimeDomainData(buf); if (P.rms(buf) < 0.01) { recent = []; return show(null); }
    const r = P.yin(buf, ac.sampleRate, 30, 1500); if (!r || r.clarity < 0.85) return;
    recent.push(r.hz); if (recent.length > 5) recent.shift(); const s = [...recent].sort((a, b) => a - b); show({ hz: s[s.length >> 1] });
  }
  async function start() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch (e) { $('status').textContent = e && e.name === 'NotAllowedError' ? 'Microphone access was blocked. Allow it in your browser settings and try again.' : 'No microphone was found.'; return; }
    ac = ac || new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === 'suspended') await ac.resume();
    an = ac.createAnalyser(); an.fftSize = 4096; buf = new Float32Array(an.fftSize); ac.createMediaStreamSource(stream).connect(an);
    timer = setInterval(tick, 60); $('go').textContent = 'Stop listening'; $('go').setAttribute('aria-pressed', 'true'); $('status').textContent = 'Listening. Play one note at a time.';
  }
  function stop() { clearInterval(timer); timer = 0; if (stream) stream.getTracks().forEach((t) => t.stop()); stream = null; $('go').textContent = 'Start tuning'; $('go').setAttribute('aria-pressed', 'false'); $('status').textContent = 'Stopped.'; show(null); }
  $('go').onclick = () => (timer ? stop() : start()); $('inst').onchange = strings; $('a4').onchange = () => { $('a4').value = a4(); };
  window.addEventListener('pagehide', () => { stop(); stopTone(); });
  strings(); show(null);
  if (/[?&]gvtest\b/.test(location.search)) window.__tuner = { show, strings, get running() { return !!timer; } };
})();
