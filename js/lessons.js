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


  /* ---------- quizzes ---------- */
  const QUIZ = {
    bpm: [
      { q: 'A track is at 126 BPM and the next at 128 BPM. How should you handle the gap?', o: ['Slow the new track by about 1.6 percent', 'Skip the mix', 'Speed the old track up by 20 percent'], a: 0, w: 'Small gaps are fixed with a small tempo change. 126 divided by 128 is about 0.984, so −1.6 percent.' },
      { q: 'Which style usually sits around 170 BPM?', o: ['House', 'Hip hop', 'Drum and bass'], a: 2, w: 'Drum and bass runs at about 170 to 178 BPM.' }
    ],
    phrasing: [
      { q: 'How many beats are in an 8 bar phrase in 4/4?', o: ['16', '32', '64'], a: 1, w: '8 bars times 4 beats is 32 beats.' },
      { q: 'When should the new track normally start?', o: ['At the start of a phrase on the playing track', 'In the middle of a bar', 'Whenever the fader is ready'], a: 0, w: 'Starting on a phrase boundary keeps the structures of both tracks lined up.' }
    ],
    eq: [
      { q: 'Two tracks with strong bass play together. What do you do?', o: ['Turn both lows up', 'Keep only one low on at a time and swap at a phrase change', 'Turn both highs down'], a: 1, w: 'Two basslines at once sound muddy. A bass swap solves it.' },
      { q: 'What does turning the Low knob all the way down do?', o: ['Removes the bass', 'Removes the vocals', 'Mutes the track'], a: 0, w: 'It cuts the low frequencies, so the track sounds thin until you bring them back.' }
    ],
    keys: [
      { q: 'Which keys mix well with 8A?', o: ['8B, 9A and 7A', '3A and 5B', '12B only'], a: 0, w: 'The same number with the other letter, and one number up or down with the same letter.' },
      { q: 'On the Camelot wheel, what does the letter A mean?', o: ['Major', 'Minor', 'Atonal'], a: 1, w: 'A is minor and B is major.' }
    ],
    cues: [
      { q: 'Where is the best place for a cue point?', o: ['On the first strong beat of the part you want to start from', 'In a quiet part with no beat', 'Anywhere, it does not matter'], a: 0, w: 'A cue on a strong beat lets you start the track exactly in time.' },
      { q: 'When should you release a loop?', o: ['At a bar or phrase boundary', 'As soon as you feel like it', 'Never'], a: 0, w: 'Releasing on the bar line keeps the music in time with the rest of the track.' }
    ],
    fx: [
      { q: 'What does a low pass filter do?', o: ['Cuts the highs and keeps the lows', 'Cuts the lows and keeps the highs', 'Raises the volume'], a: 0, w: 'It lets low frequencies pass, so the sound becomes muffled.' },
      { q: 'What is a good rule for effects?', o: ['Keep them on all the time', 'Use them briefly and in time with the music', 'Only use reverb'], a: 1, w: 'Short, well timed effects feel special. Constant effects blur the sound.' }
    ],
    transitions: [
      { q: 'Two tracks have very different tempos. Which transition is the safest?', o: ['Long blend over 32 bars', 'Quick cut or echo out on a phrase start', 'Bass swap'], a: 1, w: 'Without matching tempos a long blend sounds messy, so cut or echo out cleanly.' },
      { q: 'In a bass swap, what happens at the phrase change?', o: ['The old low is cut as the new low opens', 'Both lows are boosted', 'The crossfader stays still'], a: 0, w: 'Only one bassline plays at any moment, so the low end stays clean.' }
    ],
    set: [
      { q: 'Which is a good way to plan a set?', o: ['Start with the biggest track', 'Open gently, build to a peak, then finish well', 'Shuffle randomly'], a: 1, w: 'A shaped energy curve keeps the crowd engaged.' },
      { q: 'What is a typical house tempo?', o: ['80 BPM', '124 BPM', '175 BPM'], a: 1, w: 'House sits at about 120 to 130 BPM.' }
    ],
    review: [
      { q: 'What is a good way to improve between sessions?', o: ['Record a practice mix, listen back, and fix one thing at a time', 'Practise only when performing', 'Never listen to your own mixes'], a: 0, w: 'Listening back shows problems you cannot hear while mixing.' },
      { q: 'Why check the loudness before sharing a mix?', o: ['So it plays at a level streaming services expect', 'To make it as loud as possible', 'It does not matter'], a: 0, w: 'Around −14 LUFS avoids being turned down or sounding squashed.' }
    ]
  };
  function markDone(id) { const b = document.querySelector('[data-done="' + id + '"]'); if (b && !b.checked) { b.checked = true; b.onchange(); } }
  GVQuiz.init(QUIZ, markDone);

  /* ---------- tempo change calculator ---------- */
  function tempoAdjust(a, b) {
    if (!(a > 0) || !(b > 0)) return null; const pct = (a / b - 1) * 100, alt = [];
    [[b / 2, 'half time'], [b * 2, 'double time']].forEach(([nb, nm]) => { const p2 = (a / nb - 1) * 100; if (Math.abs(p2) < Math.abs(pct) && Math.abs(p2) <= 8) alt.push({ name: nm, bpm: nb, pct: p2 }); });
    return { pct, alt, ok: Math.abs(pct) <= 8 };
  }
  function calc() {
    const r = tempoAdjust(+$('cA').value, +$('cB').value), out = $('cOut'); if (!r) { out.textContent = 'Enter both tempos.'; return; }
    const dir = r.pct > 0 ? 'speed it up' : 'slow it down';
    let t = Math.abs(r.pct) < 0.05 ? 'The tempos already match.' : 'To match, ' + dir + ' by ' + Math.abs(r.pct).toFixed(1) + ' percent.';
    t += r.ok ? (Math.abs(r.pct) > 4 ? ' That is a big change. The track will sound different, so a key change effect is likely.' : ' That is a comfortable change.') : ' That is more than 8 percent, which sounds unnatural.';
    if (r.alt.length) t += ' Try ' + r.alt.map((x) => x.name + ' (' + x.bpm.toFixed(1) + ' BPM, ' + (x.pct >= 0 ? '+' : '') + x.pct.toFixed(1) + ' percent)').join(' or ') + ' instead.';
    out.textContent = t;
  }
  ['cA', 'cB'].forEach((id) => { $(id).oninput = calc; }); calc();

  /* ---------- phrase trainer ---------- */
  const phraseScore = (errBeats) => (errBeats < 0.25 ? 3 : errBeats < 0.5 ? 2 : errBeats < 1 ? 1 : 0);
  let pctx = null, ptimer = 0, pround = null;
  function pclick(t, freq, vol, dur) { const o = pctx.createOscillator(), g = pctx.createGain(); o.frequency.value = freq; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.connect(g).connect(pctx.destination); o.start(t); o.stop(t + dur + 0.05); }
  function pbell(t) { [880, 1320, 1760].forEach((f, i) => pclick(t, f, 0.35 / (i + 1), 0.9)); }
  function ptick() {
    const r = pround, horizon = pctx.currentTime + 0.2;
    while (r.next < horizon) {
      const beat = r.n % 4, bar = Math.floor(r.n / 4), phraseStart = r.n % (4 * r.bars) === 0, ph = Math.floor(r.n / (4 * r.bars));
      pclick(r.next, beat === 0 ? 900 : 600, beat === 0 ? 0.5 : 0.3, 0.06); if (phraseStart && ph < 2) pbell(r.next);
      if (beat === 0 && ph < 2) { const bi = bar % r.bars + 1; r.label = 'Phrase ' + (ph + 1) + ', bar ' + bi + ' of ' + r.bars; }
      r.n++; r.next += 60 / r.bpm;
    }
  }
  function pstop() { clearInterval(ptimer); ptimer = 0; }
  $('pstart').onclick = () => {
    if (!pctx) pctx = new (window.AudioContext || window.webkitAudioContext)(); pctx.resume(); pstop();
    const bars = +$('plen').value, bpm = 120; pround = { bars, bpm, n: 0, next: pctx.currentTime + 0.2, t0: 0, label: '' }; pround.t0 = pround.next;
    pround.target = pround.t0 + 2 * bars * 4 * 60 / bpm; $('pnow').disabled = false; $('pstars').textContent = ''; $('pmsg').textContent = 'Listen and count. Press the button when the third phrase starts.';
    ptimer = setInterval(ptick, 25); ptick();
  };
  function pcheck(at) {
    if (!pround) return; const now = at == null ? pctx.currentTime : at, err = Math.abs(now - pround.target) / (60 / pround.bpm), s = phraseScore(err), late = now > pround.target;
    pstop(); $('pnow').disabled = true; $('pstars').textContent = '★'.repeat(s) + '☆'.repeat(3 - s);
    $('pmsg').textContent = (err < 0.1 ? 'Spot on. ' : 'You were ' + err.toFixed(2) + ' beats ' + (late ? 'late' : 'early') + '. ') + (s === 3 ? 'Excellent.' : 'Keep counting the bars in your head.');
    return { err, s };
  }
  $('pnow').onclick = () => pcheck();

  /* ---------- key mixing trainer ---------- */
  let kq = null, kqScore = [0, 0];
  const allKeys = []; for (let n = 1; n <= 12; n++) ['A', 'B'].forEach((x) => allKeys.push(n + x));
  function kqNew() {
    const code = allKeys[Math.floor(Math.random() * allKeys.length)], good = compatible(code).slice(1), bad = allKeys.filter((k) => !compatible(code).includes(k)), pick = good[Math.floor(Math.random() * good.length)], opts = [pick];
    while (opts.length < 4) { const b = bad[Math.floor(Math.random() * bad.length)]; if (!opts.includes(b)) opts.push(b); }
    opts.sort(() => Math.random() - 0.5); kq = { code, opts, good, done: false };
    $('kqtext').textContent = 'Your playing track is in ' + code + ' (' + NAMES[code] + '). Which key mixes well with it?';
    const box = $('kqans'); box.innerHTML = ''; opts.forEach((k) => { const b = document.createElement('button'); b.className = 'btn'; b.textContent = k; b.dataset.k = k; b.setAttribute('aria-label', k + ', ' + NAMES[k]); b.onclick = () => kqAnswer(k, b); box.appendChild(b); });
  }
  function kqAnswer(k, btn) {
    if (!kq || kq.done) return; kq.done = true; kqScore[1]++; const ok = kq.good.includes(k); if (ok) kqScore[0]++;
    btn.dataset.ok = ok ? '1' : '0'; if (!ok) kq.opts.filter((o) => kq.good.includes(o)).forEach((o) => { $('kqans').querySelector('[data-k="' + o + '"]').dataset.ok = '1'; });
    $('kqtext').textContent = (ok ? 'Correct. ' : 'Not quite. ') + kq.code + ' mixes with ' + kq.good.join(', ') + '.'; $('kqscore').textContent = 'Score: ' + kqScore[0] + ' of ' + kqScore[1];
    if (kqScore[1] >= 10 && kqScore[0] / kqScore[1] >= 0.8) markDone('keys');
  }
  $('kqnew').onclick = kqNew;

  if (/[?&]gvtest\b/.test(location.search)) window.__lessons = { compatible, scoreFor, QUIZ, tempoAdjust, phraseScore, pcheck, get pround() { return pround; }, kqNew, get kq() { return kq; }, kqAnswer: (k) => { const b = $('kqans').querySelector('[data-k="' + k + '"]'); b && b.click(); }, pctx: () => pctx };
})();
