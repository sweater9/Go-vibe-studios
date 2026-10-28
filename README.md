# GoVibe Mix

Free browser tools for music lovers, content creators, DJs and music makers. No signup, no payments, no server: everything runs in the user's browser.

## Phase 1 (this version)

- **Audio Editor** (`editor.html`): open a file, select on the waveform, trim, cut, silence, fade in/out, reverse, normalize, volume, speed, undo/redo, export WAV.

## Phase 2

- **DJ Mixer** (`dj.html`): two decks (four with *Show decks C and D*) with 3-band EQ, tempo (±16%), cue, 4-beat loop, BPM detection, tempo sync, equal-power crossfader, synthesized sampler pads and mix recording (WebM/Ogg). Load your own files; BPM detection is approximate (within about 1 BPM on clear beats) and sync matches tempo only, not beat phase.

## Phase 3

- **Learn to DJ** (`lessons.html`): ten short lessons (BPM with a tempo change calculator, beatmatching, phrasing with a phrase trainer, EQ blending, harmonic mixing with a key trainer, cue points and loops, filters and effects, transition styles, building a set, reviewing your mixes) with quizzes (`js/quiz.js`) with progress saved in the browser, a beatmatching ear-trainer that scores how close your tempo match is, and a Camelot-wheel helper showing which keys mix well.
- Not done: **stem separation**. It needs a hosted model and a way to upload a full-size song from the browser, so it is left out. Nothing in this project sends your files or input to another service.

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

- `_headers`: security headers applied by Cloudflare (Content-Security-Policy, nosniff, no referrer, camera and location disabled, microphone only for this site, no framing of the site). All scripts are same-origin with no inline scripts. Two deliberate looseness points: `style-src 'unsafe-inline'` (a few inline styles). Network connections are limited to the site itself (`connect-src 'self' blob: data:`), so nothing can be sent elsewhere.
- `.assetsignore`: keeps `worker` (now removed) and this README out of the published site.
- Test hooks (`window.__dj`, `__ve`, `__gv`, `__lessons`) exist only when the page URL contains `?gvtest`.

## Roadmap

- Later: stem separation (needs a verified model and file-upload route), key detection for tracks.
- Sharing and accounts (not started; not needed for the free tools).

## Notes

- The music generator keeps users' API keys in their browser only; the optional proxy does not store or log them.

## Beat maker

The DJ page has a 16-step, 6-track beat maker (kick, snare, clap, hats, bass) with presets, BPM, swing and volume. Beats can be saved by name (kept in this browser only), loaded, deleted, and exported as a WAV (1–16 bars, rendered offline) or sent to the Audio Editor. Sounds are synthesized in the browser and routed through the mixer, so they are included in mix recordings.

## Polish: branding, offline app, legal pages, accessibility, tests

- **Branding**: favicon, touch icons and a 1200×630 share image in `icons/`; every page has description, Open Graph and Twitter meta. The meta URLs use `https://go-vibe-studios.sweater-9arc.workers.dev/`. **If you add a custom domain, replace that base URL in every `*.html`, and in `manifest.webmanifest` if needed.**
- **Installable and offline**: `manifest.webmanifest`, `sw.js` (network-first with cache fallback, cache name `govibe-v1`; bump it when you change the precache list) and `js/pwa.js`. The service worker registers only on https or localhost.
- **Legal**: `privacy.html` and `terms.html` are plain-language drafts, not legal advice. Have them reviewed before relying on them. Contact is the GitHub Issues page.
- **Accessibility and phones**: skip link, landmarks, visible focus, reduced-motion support, labelled dialogs and canvases, AA contrast, no sideways scroll at 390 px.
- **Tests**: `python tests/test_site.py` (needs `pip install playwright && playwright install chromium`; optionally `npm install --no-save axe-core` for the accessibility audit). It serves the site with the real `_headers`, so CSP violations fail the run, and covers pages, editor, DJ, lessons, video export, offline mode and phone layout. GitHub Actions runs it on every push (`.github/workflows/test.yml`).

## DJ extras

Per deck: filter (sweep low-pass / high-pass, double-click to reset), echo (synced to the deck's tempo), reverb, 8 hot cues (shift and click, or *Clear one*, removes one), loop lengths of 1–16 beats, loop rolls of 1/8, 1/4, 1/2 and 1 beat (hold a pad to loop, let go and the track carries on where it would have been), an effect unit built on the same engine as the Studio mixer (chorus, beat synced delay, reverb, saturation, compressor, with one amount knob), a crossfader assign switch per channel (left, right or off), beat grid tools (1 ms nudges, half and double tempo, tap tempo), and musical-key detection (Camelot notation, with a "keys work together / clash" hint between the decks). Queue & Automix plays a list of tracks in turn, matching tempo (within ±8%), swapping the bass and crossfading. Key detection is an estimate and can be off on dense or atypical music. There is no beat grid, because the BPM detector finds tempo but not where the beats fall.

## Stem splitter (beta)

Each deck has **Split stems**. It separates the loaded track into vocals, drums, bass and music, which you can mute or unmute live and download as WAV. This is classic signal processing in a Web Worker, **not an AI model**: bass by frequency, drums by harmonic/percussive median filtering, vocals as the centre-panned harmonic part. The four stems add back up to the original, but expect bleed (kick in the vocals, guitars in the vocals, and so on). Mono recordings split poorly. Limit: tracks up to 5 minutes (memory); a 4-minute track takes about 20 s on a desktop. Real AI separation would need a model download or a paid API.

## Beat grid and zoomed waveform

Each deck refines its BPM to 0.01 and finds where beat 1 falls (checked on synthetic tracks: tempo within 0.05 BPM, first beat within about 12 ms). That powers: a zoomed, frequency-coloured waveform (bass purple, mids cyan, highs white) with beat and bar lines; beat jump (±1, ±4); Snap (hot cues and loops land on the beat); a grid editor (±10 ms nudge and "Beat 1 here"); **Sync** that matches tempo and, when both decks play, lines up the beats; and Automix that starts the next track on the same point in the beat. The detector assumes a steady tempo, so live-drummer or tempo-changing tracks may drift. If the grid is off, use the nudge or "Beat 1 here". It does not find bars (which beat is the "one") or handle half/double-time.

## Shortcuts, MIDI, meters and limiter

- **Keyboard** (press `?` on the DJ page for the full list): Q/P play, A/L cue, Z/M sync, E/I loop, 1–4 and 7–0 hot cues, `[` `]` `\` crossfader, B beat maker, R record, X/C/V/N pads. Shortcuts pause while you type in a text box.
- **MIDI**: Chrome and Edge on a computer (Web MIDI). Click *Connect MIDI*, pick a control under *MIDI mapping*, press *Learn*, then move or press the control on your device. Any knob, fader or button can be mapped to crossfader, volumes, EQs, filters, effects, tempo, transport, hot cues, jumps, beat maker and record. Mappings are stored in this browser. Tested with simulated MIDI messages only, not with physical hardware.
- **Meters and limiter**: master L/R meter with peak hold, a level strip on each deck, and a master limiter (compressor + soft clipper) that keeps the output, and recordings, below full scale. Switch it off with the *Limiter* checkbox.

## Console redesign, jog wheels, library and WAV recording

- **Look**: a DJ-console layout: stacked waveforms on top, two decks with jog wheels and vertical tempo faders, a centre mixer with rotary EQ knobs, channel faders with LED meters, a crossfader, master knob and sampler pads, and tabs underneath (Library, Automix, Beat maker). Knobs are real range inputs underneath (keyboard and screen-reader friendly): drag up/down, mouse wheel, double-click to reset, hold Shift to fine-tune.
- **Jog wheel**: drag to scratch (forwards and backwards; one full turn is 1.8 s of audio). If the deck was playing it resumes on release. *Bend* buttons nudge pitch by 6% while held. Scratching is a granular approximation, not a vinyl simulation, and needs the full mix (not stems).
- **Library**: tracks you add, or load into a deck with "Remember tracks I load" ticked, are stored in this browser (IndexedDB) with BPM, key, beat grid and hot cues. Search, sort (including best match for each deck), load to a deck, queue for Automix, remove. Reloading the same file restores its cues. Drag audio files onto a deck or the Library. Browsers can clear site storage; nothing is uploaded.
- **WAV recording**: *Record mix* captures the master output (after the limiter) as 16-bit stereo WAV via an AudioWorklet, or compressed audio if you choose it (or if the browser lacks AudioWorklet). WAV recording stops at 30 minutes (memory).

## Full view, light console, ratings and notes

- **Full view** (button, or `F`): hides the site navigation, tabs and footer, enlarges the waveforms and uses the browser's full screen where available. `Esc` leaves it.
- **Light / dark console** (button, or `T`): a light chassis with dark screens, knobs and buttons, like real hardware. It is remembered in this browser and only affects the DJ page. Both themes pass the automated accessibility scan.
- **Ratings and notes** in the Library: 1–5 stars and a short note per track, saved with the track. Filter by minimum rating, sort by rating, and search also looks in notes.

## Library backup, colour tags and set history
- **Backup**: Library → Export backup (.zip with audio, or .json metadata only). Import restores both; tracks imported without audio show as "audio missing" and fill in when you add the file again (notes, ratings, tags and cues are kept).
- **Tags**: five colours per track, with a filter.
- **History tab**: tracks played 20 s or more are logged locally; export CSV or a text set list, or build a timecoded tracklist for your last recording. Start a new set to separate sessions (gaps over 3 h also separate automatically).

## Audio converter and BPM and key finder
- **Converter** (`convert.html`): decode, optionally resample or mix to mono, write WAV (16 bit) or MP3 (lamejs, LGPL, shipped unmodified in `js/vendor/` with `NOTICE.txt`; encoding runs in `js/convert-worker.js`). Batch conversion with a ZIP download. MP3 supports sample rates up to 48000 Hz.
- **Voice recorder** (`record.html`, `js/record.js`, `js/rec-worklet.js`): microphone capture through an AudioWorklet, level meter, countdown, takes with WAV or MP3 download, hand-off to the editor or the Studio. The microphone permission is granted to this origin only (`Permissions-Policy: microphone=(self)`).
- **Multitrack Studio** (`studio.html`): `js/studio-core.js` (project model, scheduling, offline render, WAV and MP3 writers), `js/synth.js` (built in instruments and drums), `js/studio.js` (timeline, transport, projects), `js/studio-roll.js` (piano roll and step grid), `js/fx.js` (shared effects engine: EQ, compressor, saturation, chorus, delay, reverb as Web Audio graphs that run live and offline, so exports match playback; written to be reused by the DJ and Video tools), `js/studio-mixer.js` (channel strips, sends, shared reverb and delay returns, master chain, effect editor), `js/studio-rec.js` (arm a track and record the microphone onto it with count in, punch in and out and a latency fix; capture runs in `js/rec-worklet.js`, which starts and stops on exact frames of the audio clock), `js/midi.js` (Standard MIDI File reader and writer: import keys and drum tracks, export the project), `js/studio-io.js` (autosave to IndexedDB and ZIP backup). Time signatures 2/4 to 12/8, markers, and MIDI import and export. Recording is limited to five minutes per take. Every channel is stereo from its first node, so adding an effect never changes the level. Exports render a 150 ms lead in that is cut off afterwards, because the browser's limiter fades in over its first ~100 ms and would otherwise crush a hit on the very first beat. Projects are stored in the browser; use the backup ZIP to move them.
- **Mastering** (`master.html`, `js/master-dsp.js`, `js/master-worker.js`): ITU BS.1770 K weighted loudness with gating, 4 times oversampled true peak, shelves, glue compressor, stereo width and a look ahead limiter, run in a worker. Verified against pyloudnorm in the tests.
- **Video editor** upgrades: per clip fade in and out, and transitions into a clip (crossfade, dip to black, wipe, slide) built from the last frame of the previous clip. Export is still real time through MediaRecorder.
- **Loop maker** (`samples.html`, `js/samples.js`): drum, bass, chord and melody loops from the Studio instruments in a chosen key and tempo, rendered offline with the tail folded back so they repeat cleanly. WAV, MIDI (format 0) and hand-off to the Studio as an editable track.
- **Music visualizer** (`visualizer.html`, `js/visualizer.js`): own FFT (`GVSpec`), bars, mirror, circle and waveform styles, cover image, title text, exports MP4 or WebM through WebCodecs and the vendored muxers, with a MediaRecorder fallback.
- **Metronome** (`metronome.html`, `js/metronome.js`): lookahead scheduling on the audio clock, accents, subdivisions, swing, tap tempo, tempo trainer.
- **Chord and fretboard tools** (`chords.html`, `js/chords.js`, `js/chordspage.js`): chord identification, a voicing search that works from the tuning (guitar, bass, ukulele, mandolin), key aware note spelling, circle of fifths and a chord chart transposer.
- **Looper** (`looper.html`, `js/looper.js`): loop station that arms the recorder worklet at exact audio clock frames, so overdubs stay in time; latency fix, per layer volume and mute, WAV mix export.
- **Spectrogram** (`js/spectrum.js`): our own FFT and colour map, used by the Audio Editor view and the live view in the Voice recorder.
- **Key and scale helper** (`keys.html`, `js/keys.js`, `js/theory.js`): scales and modes, chords and progressions in a key, Camelot codes and compatible keys, scale finder, playable keyboard.
- **Desktop app** (`desktop/`): an Electron shell that bundles the site and runs it offline from a private secure `govibe://` address. See `desktop/README.md`. Tested with `desktop/test_desktop.py`; installers are not built in this repo.
- **BPM and key finder** (`bpm.html`): uses `js/analyze.js`, the same detection code as the DJ console (tempo, beat grid refinement, key with Camelot code), with CSV export and tap tempo. Estimates only.

## Audio Editor upgrades
Pitch shift that keeps the length (WSOLA time stretch plus resampling; good for small shifts, artefacts grow past a few semitones), 3 band EQ (RBJ shelves and peak at 120 Hz, 1 kHz, 8 kHz), noise gate (quietens parts under a threshold; it is not noise removal), low rumble removal (80 Hz high pass) and MP3 export through `js/convert-worker.js`. A 3 minute stereo pitch shift takes about 3.5 s and freezes the page meanwhile. Background noise removal uses RNNoise (BSD 3 clause, compiled to WebAssembly, packaged by Jitsi under Apache 2.0): it runs in a worker on your device, needs no download and works on the selection or the whole sound at an adjustable strength. It is tuned for speech, so music may lose some detail.

### DJ: four decks, playlists and controller files
- **Decks C and D** are hidden until you press *Show decks C and D* (the choice is remembered). SYNC on any deck matches the deck that is playing. Everything goes through the same master, limiter and mix recorder.
- **Mix maker** (`js/mixplan.js`, `js/mixmaker.js`, Automix tab): *Order for the best flow* sorts the queue by Camelot key distance and tempo (nearest neighbour plus 2-opt, half and double time aware). *Render mix* brings every track to one tempo, starts each incoming track on a beat of the outgoing one, swaps the bass and crossfades, then renders in 60 second windows through OfflineAudioContext (so memory stays flat) to a stereo 16 bit WAV or a 192 kbps MP3 with a timestamped tracklist. Limit 30 minutes. Beat jump has ±1, ±4 and ±8.
- **Playlists** live in the Library tab: create one, add tracks from a track's row, reorder with the arrows, queue a whole playlist in Automix. They are saved in this browser and included in the library backup.
- **MIDI**: any control, including each deck's effect amount, the eight hot cues and the hold pads for loop rolls, can be learned from a controller. *Save mapping file* and *Load mapping file* move a mapping between browsers. Controller support is tested with simulated messages, not with every physical device.

### Video editor upgrades
- **Per clip**: speed from 0.25x to 4x with a speed ramp (a straight line from the start speed to the end speed, with exact timeline length), colour grading (brightness, contrast, saturation, hue, sepia and seven looks), zoom and pan from the start to the end of the clip, green screen (chroma key with tolerance, edge softness, a background colour or picture, and a light despill) and stabilisation (it measures camera shake between sampled frames, smooths the path and crops in about 10%).
- **Text and subtitles**: four fonts, outline, shadow or box styles, fade, rise or typewriter animations, edit an existing layer, import SRT or VTT, export all text as SRT.
- **Sound**: the music can duck (dip by 3 to 24 dB) while the video has sound. **Record screen** adds a screen recording (optionally with its sound) as a clip, and **Record camera** adds a webcam take. **Record voiceover** records the microphone while the video plays and places it where the recording began; it is mixed into the export with its own volume. Each clip also has a volume and mute control.
- **Picture**: per clip crop (up to 45% a side), rotate (90, 180, 270) and flip, plus **Pictures and stickers**: timed picture, logo and emoji overlays with position, size and opacity.
- **Clean the sound**: per clip background noise removal with the same RNNoise engine as the Audio Editor (`js/denoise.js`, `js/rnnoise-worker.js`), at an adjustable strength. The cleaned copy plays instead of the video's own sound, in the preview and the export. It needs a steady clip speed.
- **Draw on the video**: pen, arrow, box and circle drawings with colour, thickness and start and end times, drawn straight on the preview.
- **More export choices**: a 4K size (3840 by 2160, when the device can encode it) and an animated GIF (no sound, up to 60 s, 15 frames a second at most, 640 pixels on the long side), made with gifenc (`js/vendor/gifenc.js`, MIT).
- **Remove silence**: per clip, finds pauses below a chosen level (with a minimum length and 0.12 s of padding kept each side) and splits the clip into the parts with sound. Clips with a speed change must be reset first. The camera needs the `camera=(self)` Permissions Policy in `_headers`.
- **Export**: size (480p, 720p, 1080p), frame rate (24, 30, 60), quality, format (automatic, WebM, MP4 when the browser can write it, or audio only WAV) and method. *Fast* export uses WebCodecs with the MIT licensed mp4-muxer and webm-muxer (`js/vendor/`, loaded only when used): it seeks to every frame and encodes without waiting for playback. Footage with few keyframes (screen recordings, clips made by this editor) seeks slowly, so fast export can be about as slow as real time for those; normal camera footage is usually faster. Clips with a speed change use *Real time* (MediaRecorder), because fast export does not change pitch correctly yet.
- Limits: colour grading needs canvas filters (Chrome, Edge, Firefox). Stabilisation only looks at global shake. Fast export needs a recent Chrome or Edge. Screen recording was tested with a stand in for the browser's screen picker. Subtitles are not made automatically yet; that comes with the local speech to text model.
