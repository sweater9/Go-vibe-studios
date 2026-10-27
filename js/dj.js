/* GoVibe Mix — four deck DJ mixer (Web Audio API, no dependencies). Decks C and D are shown on request. */
(() => {
  const $ = (id) => document.getElementById(id);
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  const say = (t) => { $('status').textContent = t; };
  const fmt = (s) => { s = Math.max(0, s); const m = Math.floor(s / 60); return m + ':' + (s - m * 60).toFixed(1).padStart(4, '0'); };

  /* ---------- master chain ---------- */
  const master = ctx.createGain(); master.gain.value = 0.8;
  const recDest = ctx.createMediaStreamDestination();
  // master -> (limiter: compressor + soft clipper) -> outBus -> speakers, recorder, meters
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -1.5; comp.knee.value = 3; comp.ratio.value = 20; comp.attack.value = 0.002; comp.release.value = 0.12;
  const shaper = ctx.createWaveShaper(), curve = new Float32Array(4097);
  for (let i = 0; i < curve.length; i++) { const x = i / 2048 - 1, a = Math.abs(x); curve[i] = Math.sign(x) * (a <= 0.7 ? a : 0.7 + 0.28 * Math.tanh((a - 0.7) / 0.28)); }
  shaper.curve = curve; shaper.oversample = '2x';
  const outBus = ctx.createGain();
  comp.connect(shaper); shaper.connect(outBus); outBus.connect(ctx.destination); outBus.connect(recDest);
  const split = ctx.createChannelSplitter(2), anL = ctx.createAnalyser(), anR = ctx.createAnalyser(); anL.fftSize = anR.fftSize = 1024;
  outBus.connect(split); split.connect(anL, 0); split.connect(anR, 1);
  function setLimiter(on) { master.disconnect(); master.connect(on ? comp : outBus); }
  setLimiter(true);

  const { detectBPM, detectGrid, detectKey, keysMatch } = window.GVAnalyze;

  let _imp = null;
  function impulse() { if (_imp) return _imp; const len = Math.floor(ctx.sampleRate * 1.8); _imp = ctx.createBuffer(2, len, ctx.sampleRate); for (let c = 0; c < 2; c++) { const d = _imp.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5); } return _imp; }

  const CUES = 8, TAP_GAP = 2200;
  const FX_CHOICES = [['', 'No effect'], ['chorus', 'Chorus'], ['delay', 'Delay (beat synced)'], ['reverb', 'Reverb'], ['sat', 'Saturation'], ['comp', 'Compressor']];

  /* ---------- deck ---------- */
  class Deck {
    constructor(i, roots) {
      this.i = i; this.roots = roots; this.root = roots.deck; this.name = 'ABCD'[i]; this.color = ['#ff7a45', '#2bb7ff', '#34d399', '#c084fc'][i]; this.xfAssign = ['L', 'R', 'T', 'T'][i]; this.slip = null; this.taps = []; this.fxSlot = null; this.fxType = ''; this.fxOpts = { bpm: 120, on: false };
      this.buf = null; this.peaks = null; this.bands = null; this.grid = null; this.src = null;
      this.playing = false; this.startCtx = 0; this.startPos = 0; this.rate = 1;
      this.cue = 0; this.loop = null; this.bpm = null;
      // audio graph: eq -> volume -> crossfader gain -> master
      this.low = ctx.createBiquadFilter(); this.low.type = 'lowshelf'; this.low.frequency.value = 250;
      this.mid = ctx.createBiquadFilter(); this.mid.type = 'peaking'; this.mid.frequency.value = 1000; this.mid.Q.value = 0.7;
      this.high = ctx.createBiquadFilter(); this.high.type = 'highshelf'; this.high.frequency.value = 4000;
      this.vol = ctx.createGain(); this.xf = ctx.createGain();
      this.hp = ctx.createBiquadFilter(); this.hp.type = 'highpass'; this.hp.frequency.value = 20;
      this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 20000;
      this.dly = ctx.createDelay(2); this.fb = ctx.createGain(); this.fb.gain.value = 0.45; this.echoWet = ctx.createGain(); this.echoWet.gain.value = 0;
      this.conv = ctx.createConvolver(); this.conv.buffer = impulse(); this.revWet = ctx.createGain(); this.revWet.gain.value = 0;
      this.low.connect(this.mid); this.mid.connect(this.high); this.high.connect(this.hp); this.hp.connect(this.lp); this.pre = ctx.createGain(); this.lp.connect(this.pre); this.pre.connect(this.vol);
      this.pre.connect(this.dly); this.dly.connect(this.fb); this.fb.connect(this.dly); this.dly.connect(this.echoWet); this.echoWet.connect(this.vol);
      this.pre.connect(this.conv); this.conv.connect(this.revWet); this.revWet.connect(this.vol);
      this.vol.connect(this.xf); this.xf.connect(master);
      this.an = ctx.createAnalyser(); this.an.fftSize = 512; this.vol.connect(this.an); this._lv = new Float32Array(512);
      this.stems = null; this.extra = []; this.sg = {};
      ['vocals', 'drums', 'bass', 'music'].forEach((k) => { const g = ctx.createGain(); g.connect(this.low); this.sg[k] = g; });
      this.loopBeats = 4; this.bendF = 1; this.scratching = false; this.hot = new Array(CUES).fill(null); this.key = null;
      this.build();
    }
    build() {
      const n = this.name, ln = n.toLowerCase();
      const knob = (k, label, min, max, val, extra = '') => `<label class="kn"><input type="range" data-knob ${extra} min="${min}" max="${max}" value="${val}" data-r="${k}" aria-label="Deck ${n} ${label.toLowerCase()}"><span class="klabel">${label}</span></label>`;
      this.roots.wave.innerHTML = `
        <div class="wbadge" aria-hidden="true">${n}</div>
        <div class="wcol">
          <canvas class="zoom" data-r="zoom" role="img" aria-label="Deck ${n} zoomed waveform with beat grid. Click to jump."></canvas>
          <canvas class="wave" data-r="wave" role="img" aria-label="Deck ${n} full-track overview. Click to move the playhead."></canvas>
        </div>
        <select data-r="zspan" aria-label="Deck ${n} zoom window" class="mini zsel"><option value="4">4 s</option><option value="8" selected>8 s</option><option value="16">16 s</option></select>`;
      this.roots.deck.innerHTML = `
        <div class="dhead">
          <span class="dbadge" aria-hidden="true">${n}</span>
          <div class="dtitle"><div class="tname" data-r="name">No track loaded</div>
            <div class="dmeta"><span class="bpm" data-r="bpm">— BPM</span><span class="keychip" data-r="key" title="Musical key (Camelot)"></span><span class="ginfo" data-r="ginfo" role="status"></span></div></div>
          <button class="btn" data-r="load">Load…</button>
          <input type="file" accept="audio/*" hidden data-r="file" aria-label="Load a track into deck ${n}">
        </div>
        <div class="jogrow">
          <div class="jog" data-r="jog" role="group" aria-label="Deck ${n} jog wheel. Drag to scratch.">
            <div class="platter" data-r="platter"><i class="pmark"></i><i class="pdot"></i></div>
            <div class="jogcenter"><span class="jpos" data-r="pos">0:00.0</span><span class="jdur" data-r="dur">0:00.0</span></div>
          </div>
          <div class="pitch">
            <span class="klabel">TEMPO</span>
            <input type="range" class="fader pfader" orient="vertical" min="-16" max="16" step="0.1" value="0" data-r="tempo" aria-label="Deck ${n} tempo">
            <b class="tv" data-r="tv">0.0%</b>
            <button class="btn mini" data-r="reset">Reset</button>
          </div>
        </div>
        <div class="transport">
          <button class="tbtn cue" data-r="cue">CUE</button>
          <button class="tbtn play" data-r="play">▶ Play</button>
          <button class="tbtn sync" id="sync${n}">SYNC</button>
          <button class="tbtn loop" data-r="loop">LOOP</button>
          <select data-r="lbeats" aria-label="Deck ${n} loop length in beats" class="mini"><option value="1">1</option><option value="2">2</option><option value="4" selected>4</option><option value="8">8</option><option value="16">16</option></select>
        </div>
        <div class="nudgerow" role="group" aria-label="Deck ${n} beat jump and pitch bend">
          <button class="btn mini" data-r="nudgem" aria-label="Pitch bend down (hold)">◀ Bend</button>
          <button class="btn mini" data-r="jm4" aria-label="Back 4 beats">−4</button><button class="btn mini" data-r="jm1" aria-label="Back 1 beat">−1</button>
          <button class="btn mini" data-r="jp1" aria-label="Forward 1 beat">+1</button><button class="btn mini" data-r="jp4" aria-label="Forward 4 beats">+4</button>
          <button class="btn mini" data-r="nudgep" aria-label="Pitch bend up (hold)">Bend ▶</button>
          <label class="snap"><input type="checkbox" data-r="snap" checked> Snap</label>
        </div>
        <div class="hotrow" role="group" aria-label="Deck ${n} hot cues">
          ${[1, 2, 3, 4, 5, 6, 7, 8].map((k) => `<button class="hotpad h${k}" data-r="hot${k}" aria-label="Hot cue ${k}">${k}</button>`).join('')}
          <button class="btn mini" data-r="hotdel" aria-pressed="false" title="While on, pressing a hot cue clears it. Shift and click does the same.">Clear one</button>
          <button class="btn mini" data-r="hotclr" title="Clear all hot cues">Clear all</button>
        </div>
        <div class="rollrow" role="group" aria-label="Deck ${n} loop rolls. Hold a pad to loop, let go to carry on where the track would have been.">
          <span class="klabel">ROLL</span>
          ${[['r8', '1/8', 0.125], ['r4', '1/4', 0.25], ['r2', '1/2', 0.5], ['r1', '1', 1]].map(([k, t, b]) => `<button class="btn mini rollpad" data-r="${k}" data-beats="${b}" aria-pressed="false" aria-label="Roll ${t} beat (hold)">${t}</button>`).join('')}
        </div>
        <div class="fxrow" role="group" aria-label="Deck ${n} effects">
          ${knob('filt', 'FILTER', -100, 100, 0, 'data-bipolar')}${knob('echo', 'ECHO', 0, 100, 0)}${knob('rev', 'REVERB', 0, 100, 0)}
        </div>
        <div class="fxunit row" role="group" aria-label="Deck ${n} effect unit">
          <select data-r="fxtype" class="mini" aria-label="Deck ${n} effect">${FX_CHOICES.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select>
          ${knob('fxamt', 'FX AMT', 0, 100, 0)}
        </div>
        <details class="gridtools"><summary>Beat grid</summary>
          <div class="row" style="margin-top:6px;align-items:center">
            <button class="btn mini" data-r="gm1">−1 ms</button><button class="btn mini" data-r="gm">−10 ms</button><button class="btn mini" data-r="gp">+10 ms</button><button class="btn mini" data-r="gp1">+1 ms</button>
            <button class="btn mini" data-r="gh" title="Make the playhead position beat 1">Beat 1 here</button>
          </div>
          <div class="row" style="margin-top:6px;align-items:center">
            <button class="btn mini" data-r="ghalf" title="Use when the detected tempo is double the real one">Half tempo</button><button class="btn mini" data-r="gdbl" title="Use when the detected tempo is half the real one">Double tempo</button>
            <button class="btn mini" data-r="gtap" title="Tap along with the beat, four or more times">Tap tempo</button>
          </div>
        </details>
        <div class="stembox" data-r="stembox"></div>`;
      this.roots.strip.innerHTML = `
        <div class="sname" aria-hidden="true">CH ${n}</div>
        ${knob('high', 'HIGH', -26, 6, 0)}${knob('mid', 'MID', -26, 6, 0)}${knob('low', 'LOW', -26, 6, 0)}
        <select data-r="xfas" class="mini xfas" aria-label="Deck ${n} crossfader assign"><option value="L">XF left</option><option value="R">XF right</option><option value="T">XF off</option></select>
        <div class="faderrow">
          <canvas class="vmeter" data-r="meter" aria-hidden="true"></canvas>
          <input type="range" class="fader" orient="vertical" min="0" max="100" value="90" data-r="vol" aria-label="Deck ${n} channel volume">
        </div>`;
      const q = (k) => [this.roots.deck, this.roots.wave, this.roots.strip].map((r) => r.querySelector('[data-r="' + k + '"]')).find(Boolean) || null;
      this.q = q;
      if (window.GVKnobs) [this.roots.deck, this.roots.strip].forEach((r) => GVKnobs.upgradeAll(r));
      this.el = {}; ['bpm', 'key', 'meter', 'zoom', 'jog', 'platter', 'nudgem', 'nudgep', 'jm4', 'jm1', 'jp1', 'jp4', 'zspan', 'snap', 'gm', 'gp', 'gm1', 'gp1', 'gh', 'ghalf', 'gdbl', 'gtap', 'hotdel', 'r8', 'r4', 'r2', 'r1', 'fxtype', 'fxamt', 'xfas', 'hot5', 'hot6', 'hot7', 'hot8', 'ginfo', 'lbeats', 'hot1', 'hot2', 'hot3', 'hot4', 'hotclr', 'filt', 'echo', 'rev', 'name', 'wave', 'pos', 'dur', 'play', 'cue', 'loop', 'load', 'file', 'tv', 'tempo', 'reset', 'low', 'mid', 'high', 'vol'].forEach((k) => (this.el[k] = q(k)));
      this.g = this.el.wave.getContext('2d'); this.gz = this.el.zoom.getContext('2d');
      const e = this.el;
      e.load.onclick = () => e.file.click();
      e.file.onchange = () => e.file.files[0] && this.loadFile(e.file.files[0]);
      e.play.onclick = () => (this.playing ? this.pause() : this.play());
      e.cue.onclick = () => this.cueBtn();
      e.loop.onclick = () => this.toggleLoop();
      e.tempo.oninput = () => this.setTempoPct(+e.tempo.value);
      e.jm4.onclick = () => this.jump(-4); e.jm1.onclick = () => this.jump(-1); e.jp1.onclick = () => this.jump(1); e.jp4.onclick = () => this.jump(4);
      e.gm.onclick = () => this.nudgeGrid(-0.01); e.gp.onclick = () => this.nudgeGrid(0.01); e.gm1.onclick = () => this.nudgeGrid(-0.001); e.gp1.onclick = () => this.nudgeGrid(0.001);
      e.ghalf.onclick = () => this.scaleGrid(0.5); e.gdbl.onclick = () => this.scaleGrid(2); e.gtap.onclick = () => this.tap();
      e.xfas.value = this.xfAssign; e.xfas.onchange = () => { this.xfAssign = e.xfas.value; applyXf(); };
      e.fxtype.onchange = () => this.setFx(e.fxtype.value); e.fxamt.oninput = () => this.fxAmount();
      [e.r8, e.r4, e.r2, e.r1].forEach((b) => {
        const down = (ev) => { if (ev.type === 'keydown' && (ev.repeat || (ev.key !== ' ' && ev.key !== 'Enter'))) return; if (ev.type === 'keydown') ev.preventDefault(); this.rollStart(+b.dataset.beats, b); };
        const up = (ev) => { if (ev.type === 'keyup' && ev.key !== ' ' && ev.key !== 'Enter') return; this.rollEnd(b); };
        b.addEventListener('pointerdown', (ev) => { ev.preventDefault(); try { b.setPointerCapture(ev.pointerId); } catch (_) { /* no capture */ } down(ev); });
        b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('keydown', down); b.addEventListener('keyup', up); b.addEventListener('blur', () => this.rollEnd(b));
      });
      e.gh.onclick = () => { if (!this.buf || !this.grid) return; this.grid.t0 = this.position(); this.gridInfo(); this.changed(); };
      e.zoom.addEventListener('pointerdown', (ev) => { if (!this.buf) return; const r = e.zoom.getBoundingClientRect(); this.seek(Math.max(0, Math.min(this.buf.duration, this.position() + ((ev.clientX - r.left) / r.width - 0.5) * +e.zspan.value))); });
      e.lbeats.onchange = () => { this.loopBeats = +e.lbeats.value; if (this.loop) { this.toggleLoop(); this.toggleLoop(); } };
      for (let k = 1; k <= CUES; k++) e['hot' + k].onclick = (ev) => this.hotCue(k - 1, ev && ev.shiftKey);
      e.hotdel.onclick = () => { this.delMode = !this.delMode; e.hotdel.setAttribute('aria-pressed', this.delMode ? 'true' : 'false'); e.hotdel.classList.toggle('on', this.delMode); };
      e.hotclr.onclick = () => { this.hot = new Array(CUES).fill(null); this.paintHot(); this.changed(); };
      e.filt.oninput = () => this.setFilter(+e.filt.value);
      e.echo.oninput = () => (this.echoWet.gain.value = Math.pow(e.echo.value / 100, 1.3) * 0.9);
      e.rev.oninput = () => (this.revWet.gain.value = Math.pow(e.rev.value / 100, 1.3) * 1.1);
      e.filt.ondblclick = () => { e.filt.value = 0; this.setFilter(0); };
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
        if (window.GVAudio && GVAudio.onFile) GVAudio.onFile(this, file);
      } catch (_) { say('Could not read that file.'); }
    }
    setBuffer(buf, name, pre) {
      this.stopSrc(); this.playing = false; this.slip = null; this.buf = buf; this.stems = null; this.libId = null; Object.values(this.sg).forEach((g) => (g.gain.value = 1)); this.startPos = 0; this.cue = 0; this.loop = null; this.hot = new Array(CUES).fill(null); this.paintHot();
      this.el.loop.classList.remove('on'); this.el.play.textContent = '▶ Play'; this.el.play.classList.remove('on');
      this.el.name.textContent = name; this.el.dur.textContent = fmt(buf.duration);
      this.computePeaks(); this.computeBands();
      this.bpm = pre && 'bpm' in pre ? pre.bpm : detectBPM(buf);
      this.grid = pre && 'grid' in pre ? pre.grid : detectGrid(buf, this.bpm);
      if (this.grid && !(pre && 'bpm' in pre)) this.bpm = this.grid.bpm;
      this.gridInfo();
      this.key = pre && 'key' in pre ? pre.key : detectKey(buf);
      this.el.key.textContent = this.key || ''; refreshMatch();
      this.updateBpm(); if (window.GVAudio && GVAudio.onLoad) GVAudio.onLoad(this); say(this.bpm ? 'Deck ' + this.name + ' ready, about ' + this.bpm.toFixed(1) + ' BPM.' : 'Deck ' + this.name + ' ready (BPM not detected).');
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
    level() { this.an.getFloatTimeDomainData(this._lv); let m = 0; for (let i = 0; i < this._lv.length; i++) { const v = Math.abs(this._lv[i]); if (v > m) m = v; } return m; }
    beatFrac(t) { if (!this.grid) return null; const x = ((t == null ? this.position() : t) - this.grid.t0) / this.grid.period; return ((x % 1) + 1) % 1; }
    snapTime(t) { if (!this.grid || !this.el.snap.checked) return t; const k = Math.round((t - this.grid.t0) / this.grid.period); return Math.max(0, Math.min(this.buf.duration, this.grid.t0 + k * this.grid.period)); }
    jump(n) { if (!this.buf) return; const per = this.grid ? this.grid.period : (this.bpm ? 60 / this.bpm : 0.5); this.seek(Math.max(0, Math.min(this.buf.duration - 0.05, this.position() + n * per))); }
    nudgeGrid(dt) { if (!this.grid) return; this.grid.t0 += dt; this.gridInfo(); this.changed(); }
    changed() { if (window.GVAudio && GVAudio.onChange) GVAudio.onChange(this); }
    gridInfo() { this.el.ginfo.textContent = this.grid ? this.grid.bpm.toFixed(2) + ' BPM, beat 1 at ' + this.grid.t0.toFixed(3) + ' s' : 'No grid (BPM not detected)'; }
    setFilter(v) {
      const t = ctx.currentTime;
      this.lp.frequency.setTargetAtTime(v < 0 ? 20000 * Math.pow(200 / 20000, -v / 100) : 20000, t, 0.02);
      this.hp.frequency.setTargetAtTime(v > 0 ? 20 * Math.pow(8000 / 20, v / 100) : 20, t, 0.02);
    }
    syncFx() { this.dly.delayTime.value = Math.min(1.9, 60 / (this.liveBpm || 120) * 0.5); }
    hotCue(i, clear) {
      if (!this.buf) return;
      if (clear || this.delMode) { if (this.hot[i] != null) { this.hot[i] = null; this.changed(); } this.paintHot(); return; }
      if (this.hot[i] == null) { this.hot[i] = this.snapTime(this.position()); this.changed(); } else this.seek(this.hot[i]);
      this.paintHot();
    }
    paintHot() { this.hot.forEach((v, i) => { const b = this.el['hot' + (i + 1)]; if (!b) return; b.classList.toggle('on', v != null); b.title = v != null ? 'Jump to ' + fmt(v) + ' (shift and click clears it)' : 'Set hot cue here'; }); }
    /* ---------- beat grid tools ---------- */
    setGridBpm(b) {
      if (!this.buf || !(b >= 40 && b <= 240)) return false;
      if (!this.grid) this.grid = { t0: this.position(), period: 60 / b, bpm: b }; else { this.grid.bpm = b; this.grid.period = 60 / b; }
      this.bpm = b; this.updateBpm(); this.gridInfo(); this.changed(); return true;
    }
    scaleGrid(f) {
      if (!this.buf || !this.grid) return say('Deck ' + this.name + ' has no beat grid to change yet.');
      const b = this.grid.bpm * f; if (!this.setGridBpm(b)) return say('That tempo is outside 40 to 240 BPM.');
      say('Deck ' + this.name + ' tempo is now ' + b.toFixed(1) + ' BPM.');
    }
    tap() {
      if (!this.buf) return; const now = performance.now();
      if (this.taps.length && now - this.taps[this.taps.length - 1] > TAP_GAP) this.taps = [];
      this.taps.push(now); if (this.taps.length > 12) this.taps.shift();
      if (this.taps.length < 4) return say('Keep tapping… ' + this.taps.length + ' of 4.');
      const gaps = this.taps.slice(1).map((t, i) => t - this.taps[i]), avg = gaps.reduce((a, b) => a + b, 0) / gaps.length, b = 60000 / avg;
      if (this.setGridBpm(b)) say('Tapped tempo: ' + b.toFixed(1) + ' BPM. Use Beat 1 here to place the first beat.');
    }
    /* ---------- loop roll: loop while a pad is held, then carry on where the track would have been ---------- */
    rollStart(beats, btn) {
      if (!this.buf || !this.playing) return say('Play deck ' + this.name + ' first, then hold a roll pad.');
      const per = this.grid ? this.grid.period : this.bpm ? 60 / this.bpm : 0.5, p = this.position(), len = Math.max(0.02, per * beats);
      if (p + len > this.buf.duration) return;
      if (!this.slip) this.slip = { pos: p, at: ctx.currentTime, loop: this.loop };
      this.loop = { start: p, end: p + len }; this.startPos = p; this.startCtx = ctx.currentTime; this.play();
      this.rollBtn = btn || null; if (btn) { btn.classList.add('on'); btn.setAttribute('aria-pressed', 'true'); }
    }
    rollEnd(btn) {
      const s = this.slip; if (btn && this.rollBtn && btn !== this.rollBtn) return;
      if (this.rollBtn) { this.rollBtn.classList.remove('on'); this.rollBtn.setAttribute('aria-pressed', 'false'); this.rollBtn = null; }
      if (!s) return; this.slip = null;
      let t = s.pos + (ctx.currentTime - s.at) * this.rate * this.bendF;
      if (s.loop && t >= s.loop.end) t = s.loop.start + ((t - s.loop.start) % (s.loop.end - s.loop.start));
      this.loop = s.loop; this.seek(Math.max(0, Math.min(this.buf.duration - 0.06, t)));
    }
    /* ---------- effect unit built on the shared effects engine (js/fx.js) ---------- */
    setFx(type) {
      if (this.fxSlot) { try { this.lp.disconnect(this.fxSlot.in); } catch (_) { /* gone */ } try { this.fxSlot.out.disconnect(); } catch (_) { /* gone */ } this.fxSlot.stop(); this.fxSlot = null; }
      this.fxType = type || '';
      if (!type || !window.GVFx || !GVFx.DEFS[type]) { this.fxType = ''; this.lp.connect(this.pre); return; }
      this.fxOpts.bpm = this.liveBpm || 120; this.fxOpts.on = this.amt() > 0;
      this.fxSlot = GVFx.make(ctx, type, this.fxParams(), this.fxOpts);
      try { this.lp.disconnect(this.pre); } catch (_) { /* already apart */ } this.lp.connect(this.fxSlot.in); this.fxSlot.out.connect(this.pre);
    }
    amt() { return +this.el.fxamt.value / 100; }
    fxParams() {
      const p = GVFx.defaults(this.fxType), a = this.amt();
      if ('mix' in p) p.mix = a; if (this.fxType === 'delay') p.sync = 0.75; if (this.fxType === 'sat') p.drive = 0.15 + a * 0.6; if (this.fxType === 'comp') { p.thresh = -8 - a * 30; p.ratio = 6; }
      return p;
    }
    fxAmount() { if (!this.fxSlot) return; this.fxOpts.bpm = this.liveBpm || 120; this.fxSlot.set(this.fxParams(), false); this.fxSlot.setOn(this.amt() > 0, false); }
    computeBands() {
      const d = this.buf.getChannelData(0), sr = this.buf.sampleRate, hop = Math.max(1, Math.round(sr * 0.005)), n = Math.floor(d.length / hop);
      const lo = new Float32Array(n), md = new Float32Array(n), hi = new Float32Array(n), ka = 1 - Math.exp(-2 * Math.PI * 200 / sr), kb = 1 - Math.exp(-2 * Math.PI * 2500 / sr);
      let a = 0, b = 0, ml = 1e-9, mm = 1e-9, mh = 1e-9;
      for (let h = 0; h < n; h++) {
        let pl = 0, pm = 0, ph = 0; const o = h * hop;
        for (let i = 0; i < hop; i++) { const x = d[o + i]; a += ka * (x - a); b += kb * (x - b); const l = Math.abs(a), m = Math.abs(b - a), hh = Math.abs(x - b); if (l > pl) pl = l; if (m > pm) pm = m; if (hh > ph) ph = hh; }
        lo[h] = pl; md[h] = pm; hi[h] = ph; if (pl > ml) ml = pl; if (pm > mm) mm = pm; if (ph > mh) mh = ph;
      }
      for (let h = 0; h < n; h++) { lo[h] = Math.pow(lo[h] / ml, 0.7); md[h] = Math.pow(md[h] / mm, 0.7); hi[h] = Math.pow(hi[h] / mh, 0.7); }
      this.bands = { lo, md, hi, hop: hop / sr };
    }
    drawZoom() {
      const c = this.el.zoom, dpr = window.devicePixelRatio || 1, r = c.getBoundingClientRect();
      if (c.width !== Math.round(r.width * dpr)) { c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr); }
      const W = c.width, H = c.height, g = this.gz; g.clearRect(0, 0, W, H);
      if (!this.buf || !this.bands) return;
      const span = +this.el.zspan.value, pos = this.position(), t0 = pos - span / 2, B = this.bands, nb = B.lo.length;
      for (let x = 0; x < W; x++) {
        const i0 = Math.floor((t0 + x / W * span) / B.hop), i1 = Math.floor((t0 + (x + 1) / W * span) / B.hop);
        if (i1 < 0 || i0 >= nb) continue;
        let l = 0, m = 0, h = 0; for (let i = Math.max(0, i0); i <= Math.min(nb - 1, Math.max(i0, i1)); i++) { if (B.lo[i] > l) l = B.lo[i]; if (B.md[i] > m) m = B.md[i]; if (B.hi[i] > h) h = B.hi[i]; }
        g.fillStyle = '#6d4de0'; g.fillRect(x, H * (1 - l * 0.95) / 2, 1, Math.max(1, H * l * 0.95));
        g.fillStyle = '#22d3ee'; g.fillRect(x, H * (1 - m * 0.8) / 2, 1, Math.max(1, H * m * 0.8));
        g.fillStyle = '#e8e8f5'; g.fillRect(x, H * (1 - h * 0.55) / 2, 1, Math.max(1, H * h * 0.55));
      }
      if (this.loop) { g.fillStyle = 'rgba(52,211,153,.22)'; const x0 = (this.loop.start - t0) / span * W, x1 = (this.loop.end - t0) / span * W; g.fillRect(x0, 0, x1 - x0, H); }
      if (this.grid) {
        const k0 = Math.ceil((t0 - this.grid.t0) / this.grid.period);
        for (let k = k0; this.grid.t0 + k * this.grid.period <= t0 + span; k++) {
          const x = (this.grid.t0 + k * this.grid.period - t0) / span * W, bar = ((k % 4) + 4) % 4 === 0;
          g.fillStyle = bar ? 'rgba(255,255,255,.85)' : 'rgba(255,255,255,.3)'; g.fillRect(Math.round(x), bar ? 0 : H * 0.7, bar ? 2 : 1, bar ? H : H * 0.3);
        }
      }
      this.hot.forEach((v, i) => { if (v == null) return; const x = (v - t0) / span * W; if (x < 0 || x > W) return; g.fillStyle = '#fb7185'; g.fillRect(x, 0, 2, H); g.font = (11 * dpr) + 'px system-ui'; g.fillText(String(i + 1), x + 4, 12 * dpr); });
      g.fillStyle = '#fbbf24'; g.fillRect(W / 2 - 1, 0, 2, H);
    }
    get liveBpm() { return this.bpm ? this.bpm * this.rate : null; }
    updateBpm() { this.el.bpm.textContent = this.bpm ? this.liveBpm.toFixed(1) + ' BPM' : '— BPM'; this.syncFx(); this.fxAmount(); }
    position() {
      if (!this.buf) return 0;
      let p = this.playing ? this.startPos + (ctx.currentTime - this.startCtx) * this.rate * this.bendF : this.startPos;
      if (this.loop && this.playing && p >= this.loop.end) p = this.loop.start + ((p - this.loop.start) % (this.loop.end - this.loop.start));
      return Math.min(p, this.buf.duration);
    }
    bend(f) {                                  // temporary pitch bend (nudge) while a button is held
      if (this.playing) { this.startPos = this.position(); this.startCtx = ctx.currentTime; }
      this.bendF = f; this.eachSrc((x) => (x.playbackRate.value = this.rate * f));
    }
    eachSrc(fn) { if (this.src) fn(this.src); this.extra.forEach(fn); }
    stopSrc() { const all = [this.src, ...this.extra].filter(Boolean); this.src = null; this.extra = []; all.forEach((s) => { s.onended = null; try { s.stop(); } catch (_) {} s.disconnect(); }); }
    play() {
      if (!this.buf) return; ctx.resume(); this.stopSrc();
      if (this.startPos >= this.buf.duration - 0.05) this.startPos = 0;
      const list = this.stems ? Object.keys(this.sg).map((k) => [this.stems[k], this.sg[k]]) : [[this.buf, this.low]];
      const t0 = ctx.currentTime + (this.stems ? 0.03 : 0);
      const srcs = list.map(([b, dst]) => {
        const s = ctx.createBufferSource(); s.buffer = b; s.playbackRate.value = this.rate * this.bendF; s.connect(dst);
        if (this.loop) { s.loop = true; s.loopStart = this.loop.start; s.loopEnd = this.loop.end; }
        return s;
      });
      const s = srcs[0];
      s.onended = () => { if (this.src === s) { this.stopSrc(); this.playing = false; this.startPos = 0; this.el.play.textContent = '▶ Play'; this.el.play.classList.remove('on'); } };
      srcs.forEach((x) => x.start(t0, this.startPos));
      this.src = s; this.extra = srcs.slice(1); this.startCtx = t0; this.playing = true;
      this.el.play.textContent = '❚❚ Pause'; this.el.play.classList.add('on');
    }
    pause() { this.startPos = this.position(); this.stopSrc(); this.playing = false; this.el.play.textContent = '▶ Play'; this.el.play.classList.remove('on'); }
    seek(t) { const was = this.playing; this.startPos = t; if (was) this.play(); }
    cueBtn() {
      if (!this.buf) return;
      if (this.playing) { this.pause(); this.startPos = this.cue; } else if (Math.abs(this.startPos - this.cue) < 0.02) this.play(); else this.cue = this.startPos;
    }
    setTempoPct(pct) {
      const r = 1 + pct / 100;
      if (this.playing) { this.startPos = this.position(); this.startCtx = ctx.currentTime; this.eachSrc((x) => (x.playbackRate.value = r * this.bendF)); }
      this.rate = r; this.el.tv.textContent = (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%'; this.updateBpm();
    }
    toggleLoop() {
      if (!this.buf) return;
      if (this.loop) { const p = this.position(); this.loop = null; this.eachSrc((x) => (x.loop = false)); this.startPos = p; this.startCtx = ctx.currentTime; this.el.loop.classList.remove('on'); return; }
      const beat = this.grid ? this.grid.period : this.bpm ? 60 / this.bpm : 0.5, p = this.snapTime(this.position()), end = Math.min(this.buf.duration, p + beat * this.loopBeats);
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
      g.fillStyle = this.color;
      for (let x = 0; x < W; x++) { const h = this.peaks[Math.floor(x / W * this.peaks.length)] * H * 0.95; g.fillRect(x, (H - h) / 2, 1, Math.max(1, h)); }
      if (this.loop) { g.fillStyle = 'rgba(52,211,153,.25)'; g.fillRect(this.loop.start / this.buf.duration * W, 0, (this.loop.end - this.loop.start) / this.buf.duration * W, H); }
      g.fillStyle = '#fbbf24'; g.fillRect(this.position() / this.buf.duration * W, 0, 2, H);
      g.fillStyle = '#fb7185'; g.fillRect(this.cue / this.buf.duration * W, 0, 2, H);
      this.el.pos.textContent = fmt(this.position());
      if (!this.scratching) this.el.platter.style.transform = 'rotate(' + ((this.position() * 200) % 360).toFixed(1) + 'deg)';
    }
  }

  const decks = [0, 1, 2, 3].map((i) => new Deck(i, { deck: $('deck' + i), wave: $('wave' + i), strip: $('strip' + i) }));
  function refreshMatch() {
    const m = keysMatch(decks[0].key, decks[1].key), el = $('keymatch'); if (!el) return;
    el.textContent = m ? (m === 'clash' ? 'Keys clash (' + decks[0].key + ' / ' + decks[1].key + ')' : 'Keys ' + (m === 'same key' ? 'match' : 'work together') + ' (' + decks[0].key + ' / ' + decks[1].key + ')') : '';
    el.className = 'status km ' + (m || '');
  }
  (function frame() { if (window.GVKnobs) GVKnobs.refresh(); decks.forEach((d) => { d.draw(); d.drawZoom(); }); requestAnimationFrame(frame); })();

  /* ---------- mixer ---------- */
  function applyXf() {
    const x = $('xf').value / 100;                       // equal-power crossfade
    decks.forEach((d) => { d.xf.gain.value = d.xfAssign === 'T' ? 1 : d.xfAssign === 'L' ? Math.cos(x * Math.PI / 2) : Math.sin(x * Math.PI / 2); });
  }
  $('xf').oninput = applyXf; applyXf();
  $('master').oninput = () => (master.gain.value = Math.pow($('master').value / 100, 1.5));
  function sync(from, to) {
    const a = decks[from], b = decks[to];
    if (!a.bpm || !b.bpm) return say('Both decks need a detected BPM to sync.');
    const target = b.liveBpm, pct = (target / a.bpm - 1) * 100;
    if (pct < -16 || pct > 16) return say('Those tempos are too far apart to sync within ±16%.');
    a.el.tempo.value = pct.toFixed(1); a.setTempoPct(pct);
    if (a.grid && b.grid && a.playing && b.playing) {
      let d = b.beatFrac() - a.beatFrac(); d -= Math.round(d);
      a.seek(Math.max(0, Math.min(a.buf.duration - 0.05, a.position() + d * a.grid.period)));
      say('Deck ' + a.name + ' tempo and beats matched to Deck ' + b.name + '.');
    } else say('Deck ' + a.name + ' tempo matched to Deck ' + b.name + (a.grid && b.grid ? '. Play both decks to line up the beats too.' : '.'));
  }
  /* a deck syncs to the deck that is playing (the lowest letter first), or else to the first other deck that has a tempo */
  function syncTarget(i) { const o = decks.filter((d) => d.i !== i && d.buf && d.bpm); return (o.find((d) => d.playing) || o[0] || {}).i; }
  decks.forEach((d) => { $('sync' + d.name).onclick = () => { const t = syncTarget(d.i); if (t == null) return say('Load a track with a tempo on another deck first.'); sync(d.i, t); }; });

  /* decks C and D are shown on request, so the page stays simple for most people */
  const four = (on) => {
    document.querySelectorAll('[data-deck34]').forEach((el) => el.classList.toggle('hidden', !on));
    if (!on) { decks[2].pause(); decks[3].pause(); decks[2].rollEnd(); decks[3].rollEnd(); }
    const b = $('decks4'); b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.textContent = on ? 'Hide decks C and D' : 'Show decks C and D';
    try { localStorage.setItem('govibe.dj4', on ? '1' : '0'); } catch (_) { /* private mode */ }
  };
  $('decks4').onclick = () => four($('decks4').getAttribute('aria-pressed') !== 'true');
  try { four(localStorage.getItem('govibe.dj4') === '1'); } catch (_) { four(false); }

  /* ---------- sampler pads (synthesized, no files) ---------- */
  function env(g, t, a, d, peak) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }
  function noise(len) { const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * len), ctx.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; const s = ctx.createBufferSource(); s.buffer = b; return s; }
  window.GVAudio = { ctx, master, env, noise, recDest, anL, anR, comp, setLimiter, outBus };   // shared with js/beat.js
  const PADS = {
    Kick(t) { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.3); env(g, t, 0.005, 0.4, 1); o.connect(g).connect(master); o.start(t); o.stop(t + 0.5); },
    Clap(t) { const n = noise(0.3), f = ctx.createBiquadFilter(), g = ctx.createGain(); f.type = 'bandpass'; f.frequency.value = 1500; env(g, t, 0.003, 0.2, 0.9); n.connect(f).connect(g).connect(master); n.start(t); n.stop(t + 0.3); },
    Horn(t) { [440, 554, 659].forEach((fq) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sawtooth'; o.frequency.value = fq; env(g, t, 0.02, 0.8, 0.18); o.connect(g).connect(master); o.start(t); o.stop(t + 0.9); }); },
    Riser(t) { const n = noise(2), f = ctx.createBiquadFilter(), g = ctx.createGain(); f.type = 'bandpass'; f.Q.value = 3; f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(8000, t + 2); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.7, t + 1.9); g.gain.linearRampToValueAtTime(0.0001, t + 2.05); n.connect(f).connect(g).connect(master); n.start(t); n.stop(t + 2.1); }
  };
  Object.keys(PADS).forEach((k) => { const b = document.createElement('button'); b.className = 'pad'; b.textContent = k; b.onclick = () => { ctx.resume(); PADS[k](ctx.currentTime + 0.01); }; $('pads').appendChild(b); });

  window.GVAudio.decks = decks; Object.assign(window.GVAudio, { CUES, FX_CHOICES, showFour: four, keysMatch, detectGrid, detectBPM, detectKey, applyXf, say, fmt });

  if (/[?&]gvtest\b/.test(location.search)) window.__dj = { decks, detectGrid, detectBPM, detectKey, keysMatch, ctx, sync, applyXf };   // test hook: only exposed with ?gvtest
})();
