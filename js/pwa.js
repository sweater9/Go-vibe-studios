/* Remembers which tools were opened last, only in this browser, so the home page can offer them again. */
(() => {
  const T = { 'studio.html': 'Studio', 'editor.html': 'Audio editor', 'video.html': 'Video editor', 'dj.html': 'DJ console', 'slowed.html': 'Slowed and reverb', 'pitch.html': 'Pitch and speed', 'cutter.html': 'Audio cutter', 'booster.html': 'Volume booster', 'audio.html': 'Audio cleanup', 'convert.html': 'Converter', 'visualizer.html': 'Visualizer', 'master.html': 'Mastering', 'looper.html': 'Loop station', 'metronome.html': 'Metronome', 'bpm.html': 'BPM and key', 'record.html': 'Recorder', 'samples.html': 'Samples', 'keys.html': 'Keys', 'chords.html': 'Chords', 'silence.html': 'Silence remover', 'mono.html': 'Stereo to mono', 'tone.html': 'Tone generator', 'video-to-audio.html': 'Video to audio' };
  const f = (location.pathname.split('/').pop() || '').toLowerCase();
  if (!T[f] || /[?&]gvtest\b/.test(location.search)) return;
  try {
    const a = (JSON.parse(localStorage.getItem('govibe.recent')) || []).filter((x) => x && x.h !== f);
    a.unshift({ h: f, t: T[f], ts: Date.now() }); localStorage.setItem('govibe.recent', JSON.stringify(a.slice(0, 8)));
  } catch (_) { /* private mode: nothing is remembered */ }
})();
/* Registers the offline service worker (https or localhost only; skipped in test mode). */
(() => {
  if (!('serviceWorker' in navigator)) return;
  if (/[?&]gvtest\b/.test(location.search)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
})();
