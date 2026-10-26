/* Registers the offline service worker (https or localhost only; skipped in test mode). */
(() => {
  if (!('serviceWorker' in navigator)) return;
  if (/[?&]gvtest\b/.test(location.search)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
})();
