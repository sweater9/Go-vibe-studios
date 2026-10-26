/* Go Vibe Studios service worker: lets the site open offline after the first visit.
 * Network first (so a new deploy shows up right away), cached copy as the fallback.
 * Only same-origin GET requests are handled; API calls and downloads are never touched. */
const CACHE = 'govibe-v7';
const PRECACHE = [
  'index.html', 'editor.html', 'video.html', 'games.html', 'create.html', 'dj.html', 'lessons.html', 'privacy.html', 'terms.html',
  'css/style.css',
  'js/store.js', 'js/editor.js', 'js/video.js', 'js/games.js', 'js/create.js', 'js/dj.js','js/beat.js','js/automix.js','js/stems.js','js/controls.js','js/stems-worker.js', 'js/lessons.js', 'js/pwa.js',
  'icons/favicon.svg', 'icons/icon-192.png', 'manifest.webmanifest'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || req.headers.has('range')) return;
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || (req.mode === 'navigate' ? caches.match('index.html') : Response.error())))
  );
});
