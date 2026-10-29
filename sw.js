/* GoVibe Mix service worker: lets the site open offline after the first visit.
 * Network first (so a new deploy shows up right away), cached copy as the fallback.
 * Only same-origin GET requests are handled; API calls and downloads are never touched. */
const CACHE = 'govibe-v51';
const PRECACHE = [
  'index.html', 'editor.html', 'video.html', 'dj.html', 'lessons.html', 'privacy.html', 'convert.html', 'record.html', 'metronome.html', 'looper.html', 'js/looper.js', 'chords.html', 'js/chords.js', 'js/chordspage.js', 'js/metronome.js', 'js/spectrum.js', 'visualizer.html', 'cutter.html', 'booster.html', 'slowed.html', 'pitch.html', 'js/slowed.js', 'js/pitch.js', 'js/stretch.js', 'silence.html', 'mono.html', 'tone.html', 'video-to-audio.html', 'js/utils.js', 'audio.html', 'js/audio.js', 'js/quick.js', 'js/cutter.js', 'js/boost.js', 'js/visualizer.js', 'studio.html', 'bpm.html', 'about.html', 'inside.html', 'faq.html', 'blog.html', 'blog-beatmatching.html', 'blog-camelot.html', 'blog-record-mix.html', 'blog-slowed-reverb.html', 'blog-change-key.html', 'blog-cut-mp3.html', 'blog-louder.html', 'blog-clean-audio.html', 'blog-vertical-video.html', 'terms.html',
  'css/style.css',
  'js/store.js', 'js/denoise.js', 'images/shot-studio.webp', 'images/shot-metronome.webp', 'images/shot-looper.webp', 'images/shot-chords.webp', 'images/shot-samples.webp', 'images/shot-record.webp', 'images/shot-keys.webp', 'images/shot-editor.webp', 'images/shot-video.webp', 'images/shot-master.webp', 'images/shot-convert.webp', 'images/shot-dj.webp', 'images/shot-bpm.webp', 'images/shot-lessons.webp', 'images/shot-learn.webp', 'js/editor.js', 'js/video.js', 'js/dj.js','js/beat.js','js/automix.js','js/mixplan.js','js/mixmaker.js','js/stems.js','js/knobs.js','js/view.js','js/library.js','js/djimport.js','js/zip.js','js/record.js','master.html','js/master.js','learn-music.html','js/learn.js','css/home.css','js/home.js','fonts/bricolage-grotesque.woff2','js/quiz.js','keys.html','samples.html','js/keys.js','js/samples.js','js/theory.js','js/master-dsp.js','js/master-worker.js','js/synth.js','js/fx.js','js/midi.js','js/studio-mixer.js','js/studio-rec.js','js/studio-core.js','js/studio-io.js','js/studio.js','js/studio-roll.js','css/studio.css','js/analyze.js','js/convert.js','js/convert-worker.js','js/vendor/lame.min.js','js/rnnoise-worker.js','js/vendor/rnnoise-sync.js','js/vendor/mp4-muxer.js','js/vendor/webm-muxer.js', 'js/vendor/gifenc.js','js/bpm.js','js/history.js','js/recorder.js','js/rec-worklet.js','js/jog.js','js/tabs.js','css/console.css','js/controls.js','js/stems-worker.js', 'js/lessons.js', 'js/pwa.js',
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
