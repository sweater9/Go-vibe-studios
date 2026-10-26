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

## Run locally

It is a static site with no build step. Open `index.html`, or serve the folder:

```
python3 -m http.server 8000
```

## Deploy free

Push to GitHub, then connect the repo to Cloudflare Pages, GitHub Pages or Vercel. No build command; the output directory is the repo root.

## Roadmap

- Later: stem separation (needs a verified model and file-upload route), key detection for tracks.
- Phase 4: basic video editor, sharing.

## Notes

- Only add embedded games whose owners allow embedding, and check their terms.
- The music generator will keep users' API keys in their browser only and never store or log them.
