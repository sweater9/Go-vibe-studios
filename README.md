# Go Vibe Studios

Free browser tools for music makers, DJs and gamers. No sign-up, no payments, no server: everything runs in the user's browser.

## Phase 1 (this version)

- **Audio Editor** (`editor.html`): open a file, select on the waveform, trim, cut, silence, fade in/out, reverse, normalize, volume, speed, undo/redo, export WAV.
- **Play** (`games.html`): built-in Snake, Memory Match and Breakout, plus user-added embedded HTML5 games (https only, sandboxed iframe, saved in the browser).

## Phase 2 (in progress)

- **Create** (`create.html`): AI music from a prompt using the visitor's own Replicate key (Stable Audio 2.5 and MusicGen). The key is stored only in the visitor's browser. Generated tracks can be downloaded or opened in the Audio Editor.
- **Proxy** (`worker/`): optional Cloudflare Worker for when the browser blocks direct calls to Replicate (CORS). It does not store or log keys. See `worker/README.md`.
- Still to come in Phase 2: the DJ mixer.

## Run locally

It is a static site with no build step. Open `index.html`, or serve the folder:

```
python3 -m http.server 8000
```

## Deploy free

Push to GitHub, then connect the repo to Cloudflare Pages, GitHub Pages or Vercel. No build command; the output directory is the repo root.

## Roadmap

- Phase 2: two-deck DJ mixer (the generator is done).
- Phase 3: stem separation, sound effects, DJ lessons.
- Phase 4: basic video editor, sharing.

## Notes

- Only add embedded games whose owners allow embedding, and check their terms.
- The music generator will keep users' API keys in their browser only and never store or log them.
