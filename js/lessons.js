/* GoVibe Mix — DJ lessons: progress, beatmatching trainer, Camelot key helper */
(() => {
  const $ = (id) => document.getElementById(id);

  /* ---------- progress (browser only) ---------- */
  const KEY = 'govibe.lessons';
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (_) { return {}; } };
  const save = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (_) {} };
  const boxes = [...document.querySelectorAll('[data-done]')];
  function paint() {
    const done = boxes.filter((b) => b.checked).length;
    $('bar').style.width = (done / boxes.length * 100) + '%';
    $('ptext').textContent = done + ' of ' + boxes.length + ' lessons done';
  }
  const saved = load();
  boxes.forEach((b) => {
    b.checked = !!saved[b.dataset.done];
    b.onchange = () => { const v = load(); v[b.dataset.done] = b.checked; save(v); paint(); };
  });
  paint();

  /* ---------- Camelot wheel ---------- */
  const NAMES = { '1A': 'A♭ minor', '1B': 'B major', '2A': 'E♭ minor', '2B': 'G♭ major', '3A': 'B♭ minor', '3B': 'D♭ major', '4A': 'F minor', '4B': 'A♭ major', '5A': 'C minor', '5B': 'E♭ major', '6A': 'G minor', '6B': 'B♭ major', '7A': 'D minor', '7B': 'F major', '8A': 'A minor', '8B': 'C major', '9A': 'E minor', '9B': 'G major', '10A': 'B minor', '10B': 'D major', '11A': 'F♯ minor', '11B': 'A major', '12A': 'C♯ minor', '12B': 'E major' };
  function compatible(code) {
    const n = parseInt(code, 10), l = code.slice(-1), other = l === 'A' ? 'B' : 'A';
    const up = (n % 12) + 1, down = ((n + 10) % 12) + 1;
    return [code, up + l, down + l, n + other];
  }
  const keysEl = $('keys');
  for (let n = 1; n <= 12; n++) ['A', 'B'].forEach((l) => {
    const b = document.createElement('button'); b.className = 'key'; b.textContent = n + l; b.dataset.k = n + l; b.title = NAMES[n + l];
    b.onclick = () => selectKey(n + l); keysEl.appendChild(b);
  });
  function selectKey(code) {
    const ok = compatible(code);
    keysEl.querySelectorAll('.key').forEach((b) => { b.classList.toggle('sel', b.dataset.k === code); b.classList.toggle('ok', ok.includes(b.dataset.k) && b.dataset.k !== code); });
    $('kmsg').textContent = code + ' (' + NAMES[code] + ') mixes well with: ' + ok.slice(1).map((k) => k + ' (' + NAMES[k] + ')').join(', ') + '.';
  }
  selectKey('8A');

  /* ---------- beatmatching trainer ---------- */
  let ctx = null, timer = 0, round = null, nextRef = 0, nextYou = 0, panL, panR;
  const BASE = 120;
  const slider = $('padj');
  const yourBpm = () => round.native * (1 + slider.value / 100);
  slider.oninput = () => { $('pv').textContent = (slider.value >= 0 ? '+' : '') + (+slider.value).toFixed(1) + '%'; };

  function click(t, freq, pan) {
    const o = ctx.createOscillator(), g = ctx.createGain(), p = ctx.createStereoPanner();
    o.frequency.value = freq; p.pan.value = pan;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.6, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    o.connect(g).connect(p).connect(ctx.destination); o.start(t); o.stop(t + 0.1);
  }
  function tick() {
    const horizon = ctx.currentTime + 0.15;
    while (nextRef < horizon) { click(nextRef, 220, -1); nextRef += 60 / BASE; }
    while (nextYou < horizon) { click(nextYou, 1200, 1); nextYou += 60 / yourBpm(); }
  }
  function scoreFor(errBpm) { return errBpm < 0.3 ? 3 : errBpm < 1 ? 2 : errBpm < 2.5 ? 1 : 0; }

  $('tstart').onclick = () => {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    ctx.resume(); stop();
    const off = (2 + Math.random() * 4) * (Math.random() < 0.5 ? -1 : 1);   // your track starts 2–6% off
    round = { offPct: off, native: BASE * (1 + off / 100) };
    slider.value = 0; slider.oninput(); slider.disabled = false;
    $('tstop').disabled = false; $('tcheck').disabled = false; $('stars').textContent = '';
    $('tmsg').textContent = 'Playing. Move the slider until the two clicks line up and stop drifting.';
    nextRef = nextYou = ctx.currentTime + 0.1; timer = setInterval(tick, 25); tick();
  };
  function stop() { clearInterval(timer); timer = 0; }
  $('tstop').onclick = () => { stop(); $('tstop').disabled = true; $('tcheck').disabled = true; slider.disabled = true; $('tmsg').textContent = 'Stopped. Press "Start round" to try again.'; };
  $('tcheck').onclick = () => {
    if (!round) return;
    const err = Math.abs(yourBpm() - BASE), s = scoreFor(err);
    stop(); slider.disabled = true; $('tstop').disabled = true; $('tcheck').disabled = true;
    $('stars').textContent = '★'.repeat(s) + '☆'.repeat(3 - s);
    const dir = round.offPct > 0 ? 'fast' : 'slow';
    $('tmsg').textContent = 'Your track started ' + Math.abs(round.offPct).toFixed(1) + '% ' + dir + ', so the perfect move was ' + (round.offPct > 0 ? '−' : '+') + (Math.abs(round.offPct) / (1 + round.offPct / 100)).toFixed(1) + '%. You are off by ' + err.toFixed(2) + ' BPM. ' + ['Keep practising: listen for which click moves ahead.', 'Close. A few more small nudges.', 'Good ear.', 'Locked in!'][s];
  };

  if (/[?&]gvtest\b/.test(location.search)) window.__lessons = { compatible, scoreFor };
})();
