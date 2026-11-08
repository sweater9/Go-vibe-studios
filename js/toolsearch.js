/* GoVibe Mix home page: search and filter the tool list. Runs only in this browser, no network. */
(() => {
  const input = document.getElementById('tsq'); if (!input) return;
  const count = document.getElementById('tcount'), empty = document.getElementById('tnone');
  const KEYS = {
    'studio.html': 'daw multitrack record mix timeline piano roll drums midi beat', 'samples.html': 'loops drums bass chords beats beat maker',
    'record.html': 'microphone voice takes vocal', 'keys.html': 'scales chords key camelot keyboard theory', 'audio.html': 'auto fix clean loudness',
    'slowed.html': 'nightcore reverb sped up slow tiktok', 'pitch.html': 'key change transpose tempo speed', 'practice.html': 'learn play along loop slow down',
    'vocals.html': 'singing takes comp', 'synth.html': 'synthesizer sound keyboard', 'cutter.html': 'trim split join merge cut', 'booster.html': 'louder volume bass normalize',
    'visualizer.html': 'video mp4 waveform spectrum', 'metronome.html': 'click tempo tap bpm beat', 'tuner.html': 'guitar ukulele pitch note', 'looper.html': 'overdub layers loop pedal',
    'chords.html': 'guitar ukulele fretboard circle of fifths', 'video.html': 'clip movie subtitles trim greenscreen screen record', 'editor.html': 'wav mp3 fade noise waveform trim',
    'master.html': 'lufs loudness limiter streaming', 'reference.html': 'compare mix eq', 'repair.html': 'clicks hum clipping noise fix', 'rhythm.html': 'timing taps trainer',
    'convert.html': 'mp3 wav format', 'tomidi.html': 'notes melody hum transcribe', 'dj.html': 'mix automix decks turntable crossfade transitions set', 'bpm.html': 'tempo key camelot detect',
    'lessons.html': 'learn dj beatmatching tutorial', 'learn-music.html': 'learn theory ear training production tutorial', 'djedit.html': 'extend radio edit loop',
    'silence.html': 'gaps quiet trim', 'mono.html': 'stereo channels mixdown', 'tone.html': 'sine square sweep frequency', 'video-to-audio.html': 'extract mp3 wav sound from video'
  };
  const items = [];
  document.querySelectorAll('section.grp').forEach((sec) => {
    const m = /\bg-(make|edit|dj|learn|quick)\b/.exec(sec.className); if (!m) return;
    sec.querySelectorAll('a.card.tool, ul.quick li').forEach((el) => {
      const a = el.matches('a') ? el : el.querySelector('a'); const href = a ? a.getAttribute('href') : '';
      items.push({ el, sec, g: m[1], text: (el.textContent + ' ' + (KEYS[href] || '')).toLowerCase() });
    });
  });
  const buttons = Array.from(document.querySelectorAll('.tfilter button'));
  let group = 'all';
  function run() {
    const q = input.value.trim().toLowerCase(), toks = q.split(/\s+/).filter(Boolean); let shown = 0;
    const secs = new Map();
    items.forEach((it) => {
      const ok = (group === 'all' || it.g === group) && toks.every((t) => it.text.includes(t));
      it.el.hidden = !ok; if (ok) { shown++; secs.set(it.sec, true); }
    });
    document.querySelectorAll('section.grp').forEach((s) => { if (/\bg-(make|edit|dj|learn|quick)\b/.test(s.className)) { s.hidden = !secs.has(s); if (!s.hidden) s.classList.add('in'); } });
    const filtering = toks.length || group !== 'all';
    count.textContent = filtering ? (shown + (shown === 1 ? ' tool' : ' tools') + ' found') : '';
    if (empty) empty.hidden = shown > 0;
    const ws = document.getElementById('workspace'); if (ws && filtering) ws.dataset.dim = '1'; else if (ws) delete ws.dataset.dim;
  }
  input.addEventListener('input', run);
  buttons.forEach((b) => b.addEventListener('click', () => { group = b.dataset.g; buttons.forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false')); run(); }));
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || ''))) { e.preventDefault(); input.focus(); input.scrollIntoView({ block: 'center' }); }
    if (e.key === 'Escape' && document.activeElement === input) { input.value = ''; run(); }
  });
  const q0 = new URLSearchParams(location.search).get('q'); if (q0) { input.value = q0.slice(0, 60); run(); }
})();
