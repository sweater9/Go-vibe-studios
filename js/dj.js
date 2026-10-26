/* Go Vibe Studios — two-deck DJ mixer (Web Audio API, no dependencies) */
(() => {
  const $ = (id) => document.getElementById(id);
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  const say = (t) => { $('status').textContent = t; };
  const fmt = (s) => { s = Math.max(0, s); const m = Math.floor(s / 60); return m + ':' + (s - m * 60).toFixed(1).padStart(4, '0'); };

  /* ---------- master chain ---------- */
  const master = ctx.createGain(); master.gain.value = 0.8;
  const recDest = ctx.createMediaStreamDestination();
  master.connect(ctx.destination); master.connect(recDest);

  /* ---------- BPM detection (onset autocorrelation) ---------- */
  function detectBPM(buf) {
    const sr = buf.sampleRate, ch = buf.getChannelData(0);
    const hop = Math.round(sr / 100);                       // 10 ms frames
    const span = Math.min(buf.length, sr * 90);
    const from = Math.floor((buf.length - span) / 2);
    const frames = Math.floor(span / hop);
    if (frames < 400) return null;
    const env = new Float32Array(frames);
    for (let f = 0; f < frames; f++) {
      let s = 0; const o = from + f * hop;
      for (let i = 0; i < hop; i++) { const v = ch[o + i]; s += v * v; }
      env[f] = Math.sqrt(s / hop);
    }
    const on = new Float32Array(frames);
    for (let f = 1; f < frames; f++) on[f] = Math.max(0, env[f] - env[f - 1]);
    const at = (x) => { const i = Math.floor(x), fr = x - i; return i + 1 < frames ? on[i] * (1 - fr) + on[i + 1] * fr : 0; };
    const ac = (lag) => { let s = 0; for (let i = 0; i + 2 * lag < frames; i++) s += on[i] * at(i + lag); return s; };
    let best = 0, bestBpm = null;
    for (let bpm = 75; bpm <= 175; bpm += 0.1) {
      const lag = 6000 / bpm, score = ac(lag) + 0.5 * ac(2 * lag);
      if (score > best) { best = score; bestBpm = bpm; }
    }
    return best > 0 ? bestBpm : null;
  }

  /* ---------- deck ---------- */
  class Deck {
    constructor(i, root) {
      this.i = i; this.root = root; this.name = i ? 'B' : 'A';
      this.buf = null; this.peaks = null; this.src = null;
      this.playing = false; this.startCtx = 0; this.startPos = 0; this.rate = 1;
      this.cue = 0; this.loop = null; this.bpm = null;
      // audio graph: eq -> volume -> crossfader gain -> master
      this.low = ctx.createBiquadFilter(); this.low.type = 'lowshelf'; this.low.frequency.value = 250;
      this.mid = ctx.createBiquadFilter(); this.mid.type = 'peaking'; this.mid.frequency.value = 1000; this.mid.Q.value = 0.7;
      this.high = ctx.createBiquadFilter(); this.high.type = 'highshelf'; this.high.frequency.value = 4000;
      this.vol = ctx.createGain(); this.xf = ctx.createGain();
      this.low.connect(this.mid); this.mid.connect(this.high); this.high.connect(this.vol); this.vol.connect(this.xf); this.xf.connect(master);
      this.build();
    }
    build() {
      const n = this.name;
      this.root.innerHTML = `
        <h2>Deck ${n} <span class="bpm" data-r="bpm">— BPM</span></h2>
        <div class="tname" data-r="name">No track loaded</div>
        <canvas class="wave" data-r="wave" role="img" aria-label="Deck ${n} waveform. Click to move the playhead."></canvas>
        <div class="row time" style="justify-content:space-between;margin-top:6px"><span data-r="pos">0:00.0</span><span data-r="dur">0:00.0</span></div>
        <div class="row" style="margin-top:8px">
          <button class="btn primary" data-r="play">▶ Play</button>
          <button class="btn" data-r="cue">Cue</button>
          <button class="btn" data-r="loop">Loop 4</button>
          <button class="btn" data-r="load">Load…</button>
          <input type="file" accept="audio/*" hidden data-r="file">
        </div>
        <div class="row" style="margin-top:10px;align-items:flex-end">
          <label class="ctl" style="flex:1">Tempo: <b data-r="tv">0.0%</b>
            <input type="range" min="-16" max="16" step="0.1" value="0" data-r="tempo">
          </label>
          <button class="btn" data-r="reset">Reset</button>
        </div>
        <div class="eq">
          <label class="ctl">Low<input type="range" min="-26" max="6" value="0" data-r="low"></label>
          <label class="ctl">Mid<input type="range" min="-26" max="6" value="0" data-r="mid"></label>
          <label class="ctl">High<input type="range" min="-26" max="6" value="0" data-r="high"></label>
          <label class="ctl">Vol<input type="range" min="0" max="100" value="90" data-r="vol"></label>
        </div>`;
      const q = (k) => this.root.querySelector('[data-r="' + k + '"]');
      this.el = {}; ['bpm', 'name', 'wave', 'pos', 'dur', 'play', 'cue', 'loop', 'load', 'file', 'tv', 'tempo', 'reset', 'low', 'mid', 'high', 'vol'].forEach((k) => (this.el[k] = q(k)));
      this.g = this.el.wave.getContext('2d');
      const e = this.el;
      e.load.onclick = () => e.file.click();
      e.file.onchange = () => e.file.files[0] && this.loadFile(e.file.files[0]);
      e.play.onclick = () => (this.playing ? this.pause() : this.play());
      e.cue.onclick = () => this.cueBtn();
      e.loop.onclick = () => this.toggleLoop();
      e.tempo.oninput = () => this.setTempoPct(+e.tempo.value);
      e.reset.onclick = () => { e.tempo.value = 0; this.setTempoPct(0); };
      e.low.oninput = () => (this.low.gain.value = +e.low.value);
      e.mid.oninput = () => (this.mid.gain.value = +e.mid.value);
      e.high.oninput = () => (this.high.gain.value = +e.high.value);
      e.vol.oninput = () => this.setVol();
      this.setVol();
      e.wave.addEventListener('pointerdown', (ev) => {
        if (!this.buf) return; const r = e.wave.getBoundingClientRect();
        this.seek(Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * this.buf.duration);
      });
    }
    setVol() { this.vol.gain.value = Math.pow(+this.el.vol.value / 100, 1.5); }
    async loadFile(file) {
      try {
        say('Decoding ' + file.name + '…');
        this.setBuffer(await ctx.decodeAudioData(await file.arrayBuffer()), file.name);
      } catch (_) { say('Could not read that file.'); }
    }
    setBuffer(buf, name) {
      this.stopSrc(); this.playing = false; this.buf = buf; this.startPos = 0; this.cue = 0; this.loop = null;
      this.el.loop.classList.remove('on'); this.el.play.textContent = '▶ Play';
      this.el.name.textContent = name; this.el.dur.textContent = fmt(buf.duration);
      this.computePeaks();
      this.bpm = detectBPM(buf);
      this.updateBpm(); say(this.bpm ? 'Deck ' + this.name + ' ready, about ' + this.bpm.toFixed(1) + ' BPM.' : 'Deck ' + this.name + ' ready (BPM not detected).');
    }
    computePeaks() {
      const bins = 1000, d = this.buf.getChannelData(0), step = Math.max(1, Math.floor(d.length / bins));
      this.peaks = new Float32Array(bins);
      for (let b = 0; b < bins; b++) {
        let m = 0; const a = b * step, z = Math.min(d.length, a + step), st = Math.max(1, Math.floor((z - a) / 48));
        for (let i = a; i < z; i += st) m = Math.max(m, Math.abs(d[i]));
        this.peaks[b] = m;
      }
    }
    get liveBpm() { return this.bpm ? this.bpm * this.rate : null; }
    updateBpm() { this.el.bpm.textContent = this.bpm ? this.liveBpm.toFixed(1) + ' BPM' : '— BPM'; }
    position() {
      if (!this.buf) return 0;
      let p = this.playing ? this.startPos + (ctx.currentTime - this.startCtx) * this.rate : this.startPos;
      if (this.loop && this.playing && p >= this.loop.end) p = this.loop.start + ((p - this.loop.start) % (this.loop.end - this.loop.start));
      return Math.min(p, this.buf.duration);
    }
    stopSrc() { if (this.src) { const s = this.src; this.src = null; s.onended = null; try { s.stop(); } catch (_) {} s.disconnect(); } }
    play() {
      if (!this.buf) return; ctx.resume(); this.stopSrc();
      if (this.startPos >= this.buf.duration - 0.05) this.startPos = 0;
      const s = ctx.createBufferSource(); s.buffer = this.buf; s.playbackRate.value = this.rate; s.connect(this.low);
      if (this.loop) { s.loop = true; s.loopStart = this.loop.start; s.loopEnd = this.loop.end; }
      s.onended = () => { if (this.src === s) { this.src = null; this.playing = false; this.startPos = 0; this.el.play.textContent = '▶ Play'; } };
      s.start(0, this.startPos); this.src = s; this.startCtx = ctx.currentTime; this.playing = true;
      this.el.play.textContent = '❚❚ Pause';
    }
    pause() { this.startPos = this.position(); this.stopSrc(); this.playing = false; this.el.play.textContent = '▶ Play'; }
    seek(t) { const was = this.playing; this.startPos = t; if (was) this.play(); }
    cueBtn() {
      if (!this.buf) return;
      if (this.playing) { this.pause(); this.startPos = this.cue; } else if (Math.abs(this.startPos - this.cue) < 0.02) this.play(); else this.cue = this.startPos;
    }
    setTempoPct(pct) {
      const r = 1 + pct / 100;
      if (this.playing) { this.startPos = this.position(); this.startCtx = ctx.currentTime; if (this.src) this.src.playbackRate.value = r; }
      this.rate = r; this.el.tv.textContent = (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%'; this.updateBpm();
    }
    toggleLoop() {
      if (!this.buf) return;
      if (this.loop) { const p = this.position(); this.loop = null; if (this.src) this.src.loop = false; this.startPos = p; this.startCtx = ctx.currentTime; this.el.loop.classList.remove('on'); return; }
      const beat = this.bpm ? 60 / this.bpm : 0.5, p = this.position(), end = Math.min(this.buf.duration, p + beat * 4);
      if (end - p < 0.1) return;
      this.loop = { start: p, end };
      if (this.playing) { this.startPos = p; this.startCtx = ctx.currentTime; this.play(); }
      this.el.loop.classList.add('on');
    }
    draw() {
      const c = this.el.wave, d = window.devicePixelRatio || 1, r = c.getBoundingClientRect();
      if (c.width !== Math.round(r.width * d)) { c.width = Math.round(r.width * d); c.height = Math.round(r.height * d); }
      const W = c.width, H = c.height, g = this.g; g.clearRect(0, 0, W, H);
      if (!this.buf) return;
      g.fillStyle = this.i ? '#22d3ee' : '#8b5cf6';
      for (let x = 0; x < W; x++) { const h = this.peaks[Math.floor(x / W * this.peaks.length)] * H * 0.95; g.fillRect(x, (H - h) / 2, 1, Math.max(1, h)); }
      if (this.loop) { g.fillStyle = 'rgba(52,211,153,.25)'; g.fillRect(this.loop.start / this.buf.duration * W, 0, (this.loop.end - this.loop.start) / this.buf.duration * W, H); }
      g.fillStyle = '#fbbf24'; g.fillRect(this.position() / this.buf.duration * W, 0, 2, H);
      g.fillStyle = '#fb7185'; g.fillRect(this.cue / this.buf.duration * W, 0, 2, H);
      this.el.pos.textContent = fmt(this.position());
    }
  }

  const decks = [new Deck(0, $('deck0')), new Deck(1, $('deck1'))];
  (function frame() { decks.forEach((d) => d.draw()); requestAnimationFrame(frame); })();

  /* ---------- mixer ---------- */
  function applyXf() {
    const x = $('xf').value / 100;                       // equal-power crossfade
    decks[0].xf.gain.value = Math.cos(x * Math.PI / 2);
    decks[1].xf.gain.value = Math.sin(x * Math.PI / 2);
  }
  $('xf').oninput = applyXf; applyXf();
  $('master').oninput = () => (master.gain.value = Math.pow($('master').value / 100, 1.5));
  function sync(from, to) {
    const a = decks[from], b = decks[to];
    if (!a.bpm || !b.bpm) return say('Both decks need a detected BPM to sync.');
    const target = b.liveBpm, pct = (target / a.bpm - 1) * 100;
    if (pct < -16 || pct > 16) return say('Those tempos are too far apart to sync within ±16%.');
    a.el.tempo.value = pct.toFixed(1); a.setTempoPct(+pct.toFixed(1));
    say('Deck ' + a.name + ' tempo matched to Deck ' + b.name + '.');
  }
  $('syncA').onclick = () => sync(0, 1); $('syncB').onclick = () => sync(1, 0);

  /* ---------- sampler pads (synthesized, no files) ---------- */
  function env(g, t, a, d, peak) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }
  function noise(len) { const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * len), ctx.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; const s = ctx.createBufferSource(); s.buffer = b; return s; }
  window.GVAudio = { ctx, master, env, noise };   // shared with js/beat.js
  const PADS = {
    Kick(t) { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.3); env(g, t, 0.005, 0.4, 1); o.connect(g).connect(master); o.start(t); o.stop(t + 0.5); },
    Clap(t) { const n = noise(0.3), f = ctx.createBiquadFilter(), g = ctx.createGain(); f.type = 'bandpass'; f.frequency.value = 1500; env(g, t, 0.003, 0.2, 0.9); n.connect(f).connect(g).connect(master); n.start(t); n.stop(t + 0.3); },
    Horn(t) { [440, 554, 659].forEach((fq) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sawtooth'; o.frequency.value = fq; env(g, t, 0.02, 0.8, 0.18); o.connect(g).connect(master); o.start(t); o.stop(t + 0.9); }); },
    Riser(t) { const n = noise(2), f = ctx.createBiquadFilter(), g = ctx.createGain(); f.type = 'bandpass'; f.Q.value = 3; f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(8000, t + 2); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.7, t + 1.9); g.gain.linearRampToValueAtTime(0.0001, t + 2.05); n.connect(f).connect(g).connect(master); n.start(t); n.stop(t + 2.1); }
  };
  Object.keys(PADS).forEach((k) => { const b = document.createElement('button'); b.className = 'pad'; b.textContent = k; b.onclick = () => { ctx.resume(); PADS[k](ctx.currentTime + 0.01); }; $('pads').appendChild(b); });

  window.GVAudio.decks = decks;

  /* ---------- record mix ---------- */
  let rec = null, chunks = [], recT0 = 0, recTimer = 0;
  $('rec').onclick = () => {
    if (rec) { rec.stop(); return; }
    if (!window.MediaRecorder) return say('Recording is not supported in this browser.');
    ctx.resume(); chunks = [];
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
    const mime = types.find((t) => MediaRecorder.isTypeSupported(t));
    rec = new MediaRecorder(recDest.stream, mime ? { mimeType: mime } : undefined);
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      clearInterval(recTimer);
      const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' }), ext = /mp4/.test(blob.type) ? 'm4a' : /ogg/.test(blob.type) ? 'ogg' : 'webm';
      const a = $('recdl'); a.href = URL.createObjectURL(blob); a.download = 'govibe-mix.' + ext; a.classList.remove('hidden');
      $('rec').textContent = '● Record mix'; $('rec').classList.remove('rec-on'); $('rectime').textContent = ''; say('Mix recorded. Use "Download mix".'); rec = null;
    };
    rec.start(); recT0 = Date.now(); $('recdl').classList.add('hidden');
    $('rec').textContent = '■ Stop recording'; $('rec').classList.add('rec-on');
    recTimer = setInterval(() => ($('rectime').textContent = fmt((Date.now() - recT0) / 1000)), 250);
  };

  if (/[?&]gvtest\b/.test(location.search)) window.__dj = { decks, detectBPM, ctx, sync, applyXf };   // test hook: only exposed with ?gvtest
})();
