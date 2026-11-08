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
  /* Plain words people use for what they want, mapped to tools. Local only, no AI. */
  const INTENTS = [
    [['clearer', 'clear voice', 'clean voice', 'improve voice', 'better voice', 'sound better', 'sounds better', 'fix audio', 'clean up', 'cleanup', 'noise', 'hiss', 'hum', 'crackle', 'static', 'distortion'], ['audio.html', 'repair.html', 'editor.html']],
    [['combine', 'merge', 'join', 'two songs', 'blend', 'mashup', 'mix songs', 'crossfade', 'transition', 'make a mix', 'dj mix', 'playlist'], ['dj.html', 'cutter.html']],
    [['louder', 'too quiet', 'quiet', 'volume', 'boost', 'bass'], ['booster.html', 'master.html', 'audio.html']],
    [['podcast', 'voiceover', 'voice over', 'narration', 'interview', 'audiobook'], ['record.html', 'audio.html', 'master.html']],
    [['beat', 'drums', 'drum', 'loop', 'loops', 'instrumental', 'make music', 'compose', 'song'], ['samples.html', 'studio.html', 'looper.html']],
    [['speed up', 'slow down', 'slower', 'faster', 'nightcore', 'reverb', 'slowed'], ['slowed.html', 'pitch.html', 'practice.html']],
    [['change key', 'transpose', 'pitch', 'higher', 'lower'], ['pitch.html', 'keys.html']],
    [['bpm', 'tempo', 'what key', 'detect key', 'find key', 'camelot'], ['bpm.html', 'metronome.html']],
    [['convert', 'mp3', 'wav', 'format', 'm4a', 'flac', 'ogg'], ['convert.html']],
    [['cut', 'trim', 'chop', 'shorten', 'ringtone', 'snippet', 'split'], ['cutter.html', 'editor.html']],
    [['video', 'movie', 'clip', 'subtitle', 'subtitles', 'captions', 'tiktok', 'reels', 'shorts', 'vertical', 'screen record'], ['video.html', 'visualizer.html']],
    [['extract audio', 'video to mp3', 'audio from video', 'rip audio', 'sound from video'], ['video-to-audio.html']],
    [['tuner', 'tune my', 'guitar', 'ukulele', 'strings', 'out of tune'], ['tuner.html', 'chords.html']],
    [['chords', 'chord', 'scale', 'scales', 'theory', 'key of', 'circle of fifths', 'fretboard'], ['chords.html', 'keys.html', 'learn-music.html']],
    [['learn', 'lesson', 'lessons', 'tutorial', 'teach', 'beginner', 'how to dj', 'ear training'], ['lessons.html', 'learn-music.html', 'practice.html']],
    [['midi', 'sheet music', 'notes', 'transcribe', 'hum a'], ['tomidi.html']],
    [['master', 'mastering', 'loudness', 'lufs', 'spotify', 'streaming', 'release'], ['master.html', 'reference.html']],
    [['record', 'microphone', 'mic', 'voice memo', 'sing', 'singing', 'vocal', 'vocals'], ['record.html', 'vocals.html', 'looper.html']],
    [['mono', 'stereo', 'channels', 'mixdown'], ['mono.html']],
    [['silence', 'pauses', 'gaps', 'dead air', 'quiet parts'], ['silence.html']],
    [['test tone', 'frequency', 'sine wave', 'sine'], ['tone.html']],
    [['synth', 'synthesizer', 'keyboard', 'piano', 'play keys'], ['synth.html', 'keys.html']],
    [['rhythm', 'timing', 'on beat', 'keep time'], ['rhythm.html', 'metronome.html']],
    [['radio edit', 'extend', 'dj edit', 'longer version', 'shorter version'], ['djedit.html']],
    [['visualizer', 'visualiser', 'lyric video', 'waveform video', 'music video'], ['visualizer.html']],
    [['compare', 'reference', 'like another song', 'match another'], ['reference.html']],
    [['edit', 'editor', 'fade', 'normalize', 'normalise', 'eq'], ['editor.html']]
  ];
  const STOP = new Set(['a', 'an', 'the', 'my', 'me', 'to', 'of', 'i', 'it', 'is', 'in', 'on', 'for', 'and', 'or', 'how', 'do', 'can', 'want', 'need', 'with', 'some', 'your', 'please', 'make', 'get']);
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const INT = INTENTS.map(([phr, tools]) => [new RegExp('\\b(' + phr.map(esc).join('|') + ')\\b'), tools]);
  function intentHits(q) { const hit = new Set(); INT.forEach(([re, tools]) => { if (re.test(q)) tools.forEach((t) => hit.add(t)); }); return hit; }
  const items = [];
  document.querySelectorAll('section.grp').forEach((sec) => {
    const m = /\bg-(make|edit|dj|learn|quick)\b/.exec(sec.className); if (!m) return;
    sec.querySelectorAll('a.card.tool, ul.quick li').forEach((el) => {
      const a = el.matches('a') ? el : el.querySelector('a'); const href = a ? a.getAttribute('href') : '';
      items.push({ el, sec, g: m[1], href, text: (el.textContent + ' ' + (KEYS[href] || '')).toLowerCase() });
    });
  });
  const buttons = Array.from(document.querySelectorAll('.tfilter button'));
  let group = 'all';
  function run() {
    const q = input.value.trim().toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim(), all = q.split(' ').filter(Boolean);
    const toks = all.filter((t) => !STOP.has(t)), hits = intentHits(q); let shown = 0;
    const has = (it, t) => it.text.includes(t) || (t.length > 3 && t.endsWith('s') && it.text.includes(t.slice(0, -1)));
    const secs = new Map();
    items.forEach((it) => {
      const match = !all.length || hits.has(it.href) || (toks.length > 0 && toks.every((t) => has(it, t)));
      const ok = (group === 'all' || it.g === group) && match;
      const cell = it.el.closest('.tcell') || it.el; cell.hidden = !ok; it.el.hidden = !ok; if (ok) { shown++; secs.set(it.sec, true); }
    });
    document.querySelectorAll('section.grp').forEach((s) => { if (/\bg-(make|edit|dj|learn|quick)\b/.test(s.className)) { s.hidden = !secs.has(s); if (!s.hidden) s.classList.add('in'); } });
    const filtering = all.length || group !== 'all';
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
