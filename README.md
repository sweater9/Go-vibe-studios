# Go Vibe Studios

Free browser tools for music makers, DJs and gamers. No sign-up, no payments, no server: everything runs in the user's browser.

## Phase 1 (this version)

- **Audio Editor** (`editor.html`): open a file, select on the waveform, trim, cut, silence, fade in/out, reverse, normalize, volume, speed, undo/redo, export WAV.
- **Play** (`games.html`): built-in Snake, Memory Match and Breakout, plus user-added embedded HTML5 games (https only, sandboxed iframe, saved in the browser).

## Phase 2

- **Create** (`create.html`): AI music from a prompt using the visitor's own Replicate key (Stable Audio 2.5 and MusicGen). The key is stored only in the visitor's browser. Generated tracks can be downloaded or opened in the Audio Editor.
- **Proxy** (`worker/`): optional Cloudflare Worker for when the browser blocks direct calls to Replicate (CORS). It does not store or log keys. See `worker/README.md`.
- **DJ Mixer** (`dj.html`): two decks with 3-band EQ, tempo (±16%), cue, 4-beat loop, BPM detection, tempo sync, equal-power crossfader, synthesized sampler pads and mix recording (WebM/Ogg). Load your own files; BPM detection is approximate (within about 1 BPM on clear beats) and sync matches tempo only, not beat phase.

## Phase 3

- **Sound effects and game loops** (on the Create page): pick a type. Sound effects use Stable Audio 2.5 with 1-15 s lengths. Game loops use 10-60 s lengths and add a "seamless loop, instrumental" hint to the prompt; the model does not guarantee a perfect loop, so trim the result in the Audio Editor if needed.
- **Learn to DJ** (`lessons.html`): five short lessons (BPM, beatmatching, phrasing, EQ blending, harmonic mixing) with progress saved in the browser, a beatmatching ear-trainer that scores how close your tempo match is, and a Camelot-wheel helper showing which keys mix well.
- Not done: **stem separation**. It needs a hosted model and a way to upload a full-size song from the browser, and the Replicate model and upload details could not be verified, so it is left out rather than shipped untested.

## Phase 4

- **Video Editor** (`video.html`): add several clips, trim in/out points, reorder, add timed text overlays (position, size, colour), add one music track with volume and original-sound volume, pick 16:9, 9:16 or 1:1, preview, and export. No libraries.
- How export works: the preview is recorded in real time with the browser's MediaRecorder, so a 1-minute video takes about a minute and the tab must stay open. The file is MP4 (H.264/AAC) only if the browser can record it, otherwise WebM (VP9/Opus). WebM files from MediaRecorder carry no duration in their header, so some players cannot seek in them; the site's own editors handle this.
- Not included: transitions, multiple tracks, filters, fades, music offset, MP4 conversion for browsers that only record WebM. The MP4 path was not tested here (the test browser has no H.264); the WebM path was tested end to end.

## Run locally

It is a static site with no build step. Open `index.html`, or serve the folder:

```
python3 -m http.server 8000
```

## Deploy free

Push to GitHub, then connect the repo to Cloudflare Pages, GitHub Pages or Vercel. No build command; the output directory is the repo root.

## Security and deployment files

- `_headers`: security headers applied by Cloudflare (Content-Security-Policy, nosniff, no referrer, camera/microphone/location disabled, no framing of the site). All scripts are same-origin with no inline scripts. Two deliberate looseness points: `style-src 'unsafe-inline'` (a few inline styles) and `connect-src https:` (visitors can enter their own proxy URL on the Create page).
- `.assetsignore`: keeps `worker/` and this README out of the published site.
- Test hooks (`window.__dj`, `__ve`, `__gv`, `__lessons`) exist only when the page URL contains `?gvtest`.

## Roadmap

- Later: stem separation (needs a verified model and file-upload route), key detection for tracks.
- Sharing and accounts (not started; not needed for the free tools).

## Notes

- Only add embedded games whose owners allow embedding, and check their terms.
- The music generator keeps users' API keys in their browser only; the optional proxy does not store or log them.

## Beat maker

The DJ page has a 16-step, 6-track beat maker (kick, snare, clap, hats, bass) with presets, BPM, swing and volume. Beats can be saved by name (kept in this browser only), loaded, deleted, and exported as a WAV (1–16 bars, rendered offline) or sent to the Audio Editor. Sounds are synthesized in the browser and routed through the mixer, so they are included in mix recordings.

## Polish: branding, offline app, legal pages, accessibility, tests

- **Branding**: favicon, touch icons and a 1200×630 share image in `icons/`; every page has description, Open Graph and Twitter meta. The meta URLs use `https://go-vibe-studios.sweater-9arc.workers.dev/`. **If you add a custom domain, replace that base URL in every `*.html`, and in `manifest.webmanifest` if needed.**
- **Installable and offline**: `manifest.webmanifest`, `sw.js` (network-first with cache fallback, cache name `govibe-v1`; bump it when you change the precache list) and `js/pwa.js`. The service worker registers only on https or localhost.
- **Legal**: `privacy.html` and `terms.html` are plain-language drafts, not legal advice. Have them reviewed before relying on them. Contact is the GitHub Issues page.
- **Accessibility and phones**: skip link, landmarks, visible focus, reduced-motion support, labelled dialogs and canvases, AA contrast, no sideways scroll at 390 px.
- **Tests**: `python tests/test_site.py` (needs `pip install playwright && playwright install chromium`; optionally `npm install --no-save axe-core` for the accessibility audit). It serves the site with the real `_headers`, so CSP violations fail the run, mocks Replicate, and covers pages, editor, games, Create modes, DJ, lessons, video export, offline mode and phone layout. GitHub Actions runs it on every push (`.github/workflows/test.yml`).

## DJ extras

Per deck: filter (sweep low-pass / high-pass, double-click to reset), echo (synced to the deck's tempo), reverb, 4 hot cues, loop lengths of 1–16 beats, and musical-key detection (Camelot notation, with a "keys work together / clash" hint between the decks). Queue & Automix plays a list of tracks in turn, matching tempo (within ±8%), swapping the bass and crossfading. Key detection is an estimate and can be off on dense or atypical music. There is no beat grid, because the BPM detector finds tempo but not where the beats fall.
