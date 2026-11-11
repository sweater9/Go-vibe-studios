/* Remembers which tools were opened last, only in this browser, so the home page can offer them again. */
(() => {
  const T = { 'studio.html': 'Studio', 'editor.html': 'Audio editor', 'video.html': 'Video editor', 'dj.html': 'DJ console', 'slowed.html': 'Slowed and reverb', 'pitch.html': 'Pitch and speed', 'cutter.html': 'Audio cutter', 'booster.html': 'Volume booster', 'audio.html': 'Audio cleanup', 'convert.html': 'Converter', 'visualizer.html': 'Visualizer', 'master.html': 'Mastering', 'looper.html': 'Loop station', 'metronome.html': 'Metronome', 'bpm.html': 'BPM and key', 'record.html': 'Recorder', 'samples.html': 'Samples', 'keys.html': 'Keys', 'chords.html': 'Chords', 'silence.html': 'Silence remover', 'mono.html': 'Stereo to mono', 'tone.html': 'Tone generator', 'tempo.html': 'Tempo converter', 'video-to-audio.html': 'Video to audio' };
  const f = (location.pathname.split('/').pop() || '').toLowerCase();
  if (!T[f] || /[?&]gvtest\b/.test(location.search)) return;
  try {
    const a = (JSON.parse(localStorage.getItem('govibe.recent')) || []).filter((x) => x && x.h !== f);
    const prev = a[0];
    if (prev && T[prev.h] && !/[?&]gvtest\b/.test(location.search)) window.addEventListener('DOMContentLoaded', () => {
      const h1 = document.querySelector('main h1'); if (!h1 || !h1.parentNode) return;
      const l = document.createElement('a'); l.href = prev.h; l.textContent = '\u2190 Back to ' + T[prev.h]; l.style.cssText = 'display:inline-block;margin-bottom:6px;font-size:13px;color:var(--muted)';
      h1.parentNode.insertBefore(l, h1);
    });
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
/* iPhone and iPad: a one line hint, shown once on the home page, about adding the site to the Home Screen. Local only. */
(() => {
  if (/[?&]gvtest\b/.test(location.search)) return;
  const f = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  if (f !== 'index.html' && f !== '') return;
  const ua = navigator.userAgent || '', ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!ios || navigator.standalone || (window.matchMedia && matchMedia('(display-mode: standalone)').matches)) return;
  try { if (localStorage.getItem('govibe.a2hs')) return; } catch (_) { return; }
  const main = document.getElementById('main'); if (!main) return;
  const box = document.createElement('div'); box.setAttribute('role', 'note');
  box.style.cssText = 'display:flex;gap:10px;align-items:center;justify-content:space-between;margin:12px 0;padding:10px 14px;background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);font-size:14px;color:var(--muted)';
  const t = document.createElement('span'); t.textContent = 'Tip: tap the Share button in Safari, then Add to Home Screen, to open GoVibeMix like an app. It also works offline after your first visit.';
  const b = document.createElement('button'); b.className = 'btn'; b.textContent = 'Got it'; b.setAttribute('aria-label', 'Dismiss the Home Screen tip');
  b.addEventListener('click', () => { try { localStorage.setItem('govibe.a2hs', '1'); } catch (_) {} box.remove(); });
  box.append(t, b); main.insertBefore(box, main.firstChild);
})();
