/* GoVibe Mix — music and production lessons: progress, quizzes, ear trainer. Progress stays in this browser. */
(() => {
  const $ = (id) => document.getElementById(id), T = window.GVTheory;
  const KEY = 'govibe.learn', EKEY = 'govibe.ear';
  const load = (k) => { try { return JSON.parse(localStorage.getItem(k)) || {}; } catch (_) { return {}; } }, save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };

  /* ---------- quizzes (a = index of the right option) ---------- */
  const QUIZ = {
    rhythm: [
      { q: 'How many beats are in a bar of 4/4 time?', o: ['Three', 'Four', 'Eight'], a: 1, w: '4/4 means four beats in each bar.' },
      { q: 'In a house beat, where does the kick usually fall?', o: ['On every beat', 'Only on beat 3', 'Only on the offbeats'], a: 0, w: 'Four on the floor: a kick on all four beats.' },
      { q: 'What does swing do to a drum pattern?', o: ['Makes it faster', 'Delays every second sixteenth note a little', 'Removes the hi hats'], a: 1, w: 'Swing shifts the offbeat sixteenths later, which gives a relaxed, bouncy feel.' }
    ],
    scales: [
      { q: 'Which step pattern builds a major scale? (W = whole step, H = half step)', o: ['W W H W W W H', 'W H W W H W W', 'H H W W W W H'], a: 0, w: 'Whole, whole, half, whole, whole, whole, half.' },
      { q: 'C major and A minor share the same notes. What are they called?', o: ['Parallel keys', 'Relative keys', 'Opposite keys'], a: 1, w: 'Relative keys use the same notes but have a different home note.' },
      { q: 'How many notes does a pentatonic scale have?', o: ['Five', 'Seven', 'Twelve'], a: 0, w: '"Penta" means five.' }
    ],
    chords: [
      { q: 'What are the notes of a C major triad?', o: ['C E G', 'C E♭ G', 'C F A'], a: 0, w: 'Root, major third, fifth: C, E, G.' },
      { q: 'In the key of C, what chords are in the I V vi IV progression?', o: ['C G Am F', 'C F G Am', 'C Dm Em F'], a: 0, w: 'I = C, V = G, vi = Am, IV = F.' },
      { q: 'A lower case roman numeral such as vi means the chord is…', o: ['Major', 'Minor', 'Suspended'], a: 1, w: 'Lower case numerals mark minor chords.' }
    ],
    mixing: [
      { q: 'Which sounds are normally panned to the centre?', o: ['Kick, bass and lead vocal', 'Everything', 'Only the reverb'], a: 0, w: 'Low and important sounds stay in the middle so the mix is solid and balanced.' },
      { q: 'Two sounds are muddy together. What is a good first fix?', o: ['Raise both of them', 'Use EQ to give each its own range', 'Add more reverb'], a: 1, w: 'EQ lets each sound occupy its own space in the frequency range.' },
      { q: 'You cannot hear the quiet vocal. What should you try first?', o: ['Turn the master up until it clips', 'Lower the instruments or raise the vocal, staying under 0 dB', 'Delete the vocal'], a: 1, w: 'Balance the tracks, and keep the master below 0 dB to avoid clipping.' }
    ],
    recording: [
      { q: 'What level should your loudest recorded parts reach?', o: ['0 dB, as loud as possible', 'About −12 to −6 dB', 'About −40 dB'], a: 1, w: 'That leaves a safe margin below clipping while staying well above the noise.' },
      { q: 'Why wear headphones when recording over a backing track?', o: ['To stop the track leaking into the microphone', 'To make the recording louder', 'It is only for comfort'], a: 0, w: 'Speakers would be picked up by the microphone and ruin the recording.' },
      { q: 'Why record a few seconds of silence first?', o: ['To warm up the microphone', 'So noise can be measured and removed later', 'To reset the level meter'], a: 1, w: 'Noise reduction and gates work best when they know what the background noise sounds like.' }
    ],
    mastering: [
      { q: 'About what loudness do major streaming services aim for?', o: ['−14 LUFS', '0 LUFS', '−40 LUFS'], a: 0, w: 'Around −14 LUFS. Louder tracks are turned down.' },
      { q: 'What does a limiter do?', o: ['Adds bass', 'Holds peaks under a ceiling', 'Makes the stereo image wider'], a: 1, w: 'It is a very fast compressor that stops peaks going above the ceiling.' },
      { q: 'Why keep true peak under about −1 dBTP?', o: ['So MP3 and AAC conversion does not distort', 'Because 0 is unlucky', 'To make the track quieter'], a: 0, w: 'Lossy encoders can raise peaks slightly, and peaks between samples can exceed the sample peak.' }
    ]
  };

  /* ---------- progress ---------- */
  const boxes = [...document.querySelectorAll('[data-done]')];
  function paint() { const done = boxes.filter((b) => b.checked).length; $('bar').style.width = (done / boxes.length * 100) + '%'; $('ptext').textContent = done + ' of ' + boxes.length + ' lessons done'; }
  const saved = load(KEY);
  boxes.forEach((b) => { b.checked = !!saved[b.dataset.done]; b.onchange = () => { const v = load(KEY); v[b.dataset.done] = b.checked; save(KEY, v); paint(); }; });
  paint();
  function markDone(id) { const b = document.querySelector('[data-done="' + id + '"]'); if (b && !b.checked) { b.checked = true; b.onchange(); } }

  /* ---------- quiz rendering ---------- */
  document.querySelectorAll('[data-quiz]').forEach((box) => {
    const id = box.dataset.quiz, qs = QUIZ[id]; if (!qs) return;
    const h = document.createElement('h3'); h.textContent = 'Check yourself'; h.style.fontSize = '15px'; box.appendChild(h);
    qs.forEach((q, qi) => {
      const fs = document.createElement('fieldset'), lg = document.createElement('legend'); lg.textContent = (qi + 1) + '. ' + q.q; fs.appendChild(lg);
      q.o.forEach((txt, oi) => { const lb = document.createElement('label'), r = document.createElement('input'); r.type = 'radio'; r.name = 'q-' + id + '-' + qi; r.value = oi; lb.append(r, document.createTextNode(' ' + txt)); fs.appendChild(lb); });
      const fb = document.createElement('div'); fb.className = 'qfb'; fb.setAttribute('role', 'status'); fs.appendChild(fb); box.appendChild(fs);
    });
    const btn = document.createElement('button'); btn.className = 'btn'; btn.textContent = 'Check answers'; const res = document.createElement('p'); res.className = 'status'; res.setAttribute('role', 'status'); box.append(btn, res);
    btn.onclick = () => {
      let right = 0, answered = 0;
      qs.forEach((q, qi) => { const sel = box.querySelector('input[name="q-' + id + '-' + qi + '"]:checked'), fb = box.querySelectorAll('.qfb')[qi]; if (!sel) { fb.textContent = 'Pick an answer.'; fb.className = 'qfb'; return; } answered++; const ok = +sel.value === q.a; if (ok) right++; fb.textContent = (ok ? 'Correct. ' : 'Not quite. ') + q.w; fb.className = 'qfb ' + (ok ? 'ok' : 'no'); });
      if (answered < qs.length) { res.textContent = 'Answer all ' + qs.length + ' questions first.'; return; }
      res.textContent = right + ' of ' + qs.length + ' correct.' + (right === qs.length ? ' Lesson marked as done.' : ' Read the notes above and try again.'); if (right === qs.length) markDone(id);
    };
  });

  /* ---------- ear trainer ---------- */
  const INTERVALS = [[0, 'Unison'], [1, 'Minor 2nd'], [2, 'Major 2nd'], [3, 'Minor 3rd'], [4, 'Major 3rd'], [5, 'Perfect 4th'], [6, 'Tritone'], [7, 'Perfect 5th'], [8, 'Minor 6th'], [9, 'Major 6th'], [10, 'Minor 7th'], [11, 'Major 7th'], [12, 'Octave']];
  const MODES = {
    'int-easy': { label: 'interval', set: () => [3, 4, 7, 12].map((s) => INTERVALS.find((i) => i[0] === s)).map(([s, n]) => ({ id: n, notes: [0, s], seq: true })) },
    'int-all': { label: 'interval', set: () => INTERVALS.slice(1).map(([s, n]) => ({ id: n, notes: [0, s], seq: true })) },
    'chord': { label: 'chord', set: () => [['Major', [0, 4, 7]], ['Minor', [0, 3, 7]], ['Diminished', [0, 3, 6]], ['Augmented', [0, 4, 8]]].map(([n, notes]) => ({ id: n, notes, seq: false })) },
    'scale': { label: 'scale', set: () => ['Major', 'Natural minor', 'Dorian', 'Major pentatonic'].map((n) => ({ id: n, notes: T.SCALES[n].concat(12), seq: true })) }
  };
  let ctx = null, cur = null, answered = true; const st = Object.assign({ correct: 0, total: 0, streak: 0, best: 0 }, load(EKEY));
  const ac = () => { ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); ctx.resume(); return ctx; };
  function playCur() {
    if (!cur) return; const c = ac(), out = c.createGain(); out.gain.value = 0.9; out.connect(c.destination); const step = cur.item.seq ? (cur.item.notes.length > 2 ? 0.38 : 0.7) : 0;
    cur.item.notes.forEach((n, i) => GVSynth.note(c, out, 'Piano', cur.root + n, 0.8, c.currentTime + 0.05 + i * step, cur.item.seq ? (cur.item.notes.length > 2 ? 0.45 : 0.9) : 1.8));
  }
  function showScore() { $('ecorrect').textContent = st.correct; $('etotal').textContent = st.total; $('estreak').textContent = st.streak; $('ebest').textContent = st.best; save(EKEY, st); }
  function renderAnswers() {
    const box = $('eans'); box.innerHTML = ''; MODES[$('emode').value].set().forEach((it) => { const b = document.createElement('button'); b.className = 'btn'; b.textContent = it.id; b.dataset.id = it.id; b.onclick = () => answer(it, b); box.appendChild(b); });
  }
  function next() {
    const items = MODES[$('emode').value].set(), item = items[Math.floor(Math.random() * items.length)], root = 48 + Math.floor(Math.random() * 13);
    cur = { item, root }; answered = false; renderAnswers(); $('eagain').disabled = false; $('efb').textContent = 'Listen, then pick the ' + MODES[$('emode').value].label + '.'; playCur();
  }
  function answer(it, btn) {
    if (!cur || answered) { if (answered) $('efb').textContent = 'Press "Play a new one" for the next question.'; return; } answered = true; st.total++;
    const ok = it.id === cur.item.id; if (ok) { st.correct++; st.streak++; st.best = Math.max(st.best, st.streak); } else st.streak = 0;
    btn.dataset.ok = ok ? '1' : '0'; if (!ok) $('eans').querySelector('[data-id="' + cur.item.id.replace(/"/g, '') + '"]').dataset.ok = '1';
    $('efb').textContent = ok ? 'Correct: ' + cur.item.id + '.' : 'Not quite. That was ' + cur.item.id + '. Press "Hear it again" to compare.'; showScore();
    if (st.total >= 20 && st.correct / st.total >= 0.8) markDone('ear');
  }
  $('enext').onclick = next; $('eagain').onclick = playCur; $('emode').onchange = () => { cur = null; answered = true; $('eagain').disabled = true; renderAnswers(); $('efb').textContent = 'Press "Play a new one".'; };
  renderAnswers(); showScore();
  if (/[?&]gvtest\b/.test(location.search)) window.__lm = { get cur() { return cur; }, QUIZ, st, next, answerWith: (id) => { const b = $('eans').querySelector('[data-id="' + id + '"]'); b && b.click(); } };
})();
