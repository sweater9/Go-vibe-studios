/* GoVibe Mix: synthesizer and sampler. Two oscillators, a sub oscillator and noise (or your own sample) go through a filter and an
   amp, each with an envelope, plus an LFO, echo and reverb. Play it with the keyboard, the mouse, touch or a MIDI keyboard,
   record a riff, then save it as MIDI or audio. The same voice code renders offline, so what you hear is what you save. */
(() => {
  const $ = (id) => document.getElementById(id), Q = window.GVQuick, clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const say = (t) => { $('status').textContent = t; };
  const WAVES = ['sawtooth', 'square', 'triangle', 'sine'];
  const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'], noteName = (m) => NAMES[m % 12] + (Math.floor(m / 12) - 1);
  const BASE = { mode: 'synth', w1: 'sawtooth', o1: 0, d1: -6, w2: 'sawtooth', o2: 0, d2: 6, mix: 0.6, sub: 0, noise: 0, ftype: 'lowpass', cut: 4000, res: 1, fenv: 0, fa: 0.01, fd: 0.3, fs: 0.5, fr: 0.3, a: 0.01, d: 0.2, s: 0.7, r: 0.25, lfoRate: 5, lfoDepth: 0, lfoTo: 'pitch', vol: 70, dly: 0, dtime: 300, rev: 0, root: 60, loop: false };
  const PRESETS = {
    'Warm pad': { ...BASE, w1: 'sawtooth', w2: 'triangle', d1: -9, d2: 9, mix: 0.7, cut: 1800, a: 0.6, d: 0.5, s: 0.8, r: 1.2, fenv: 1, fa: 0.8, fd: 1, fs: 0.4, lfoDepth: 12, lfoRate: 0.4, rev: 30 },
    'Saw lead': { ...BASE, w1: 'sawtooth', w2: 'square', d2: 7, mix: 0.4, cut: 3500, res: 4, a: 0.01, s: 0.8, r: 0.2, lfoDepth: 8, lfoRate: 5.5, dly: 22, dtime: 340, rev: 12 },
    Pluck: { ...BASE, w1: 'square', w2: 'sawtooth', mix: 0.5, cut: 700, res: 3, fenv: 3, fa: 0.002, fd: 0.18, fs: 0, a: 0.002, d: 0.35, s: 0, r: 0.2, dly: 12, rev: 14 },
    'Sub bass': { ...BASE, w1: 'sawtooth', o1: -1, w2: 'square', o2: -1, mix: 0.3, sub: 0.7, cut: 500, res: 2, fenv: 2, fd: 0.2, fs: 0.2, a: 0.005, d: 0.2, s: 0.8, r: 0.1 },
    Organ: { ...BASE, w1: 'sine', w2: 'sine', o2: 1, d1: 0, d2: 0, mix: 0.6, sub: 0.5, cut: 8000, a: 0.01, d: 0.01, s: 1, r: 0.08, lfoTo: 'amp', lfoDepth: 10, lfoRate: 6, rev: 18 },
    Strings: { ...BASE, w1: 'sawtooth', w2: 'sawtooth', d1: -12, d2: 12, mix: 0.9, cut: 2600, a: 0.35, d: 0.3, s: 0.9, r: 0.6, lfoDepth: 6, lfoRate: 5, rev: 24 },
    'Soft keys': { ...BASE, w1: 'triangle', w2: 'sine', o2: 1, d1: 0, d2: 3, mix: 0.35, cut: 2200, fenv: 1, fd: 0.4, fs: 0.2, a: 0.004, d: 0.9, s: 0.15, r: 0.4, rev: 16 },
    Noise: { ...BASE, mix: 0, noise: 0.8, w1: 'sine', cut: 1200, res: 6, fenv: 2, fa: 1.2, fd: 1, fs: 0.2, a: 0.8, d: 0.4, s: 0.7, r: 1.2, rev: 30 }
  };
  const SPEC = [
    ['Oscillator 1', [['w1', 'Wave', WAVES], ['o1', 'Octave', -2, 2, 1], ['d1', 'Detune (cents)', -50, 50, 1]]],
    ['Oscillator 2', [['w2', 'Wave', WAVES], ['o2', 'Octave', -2, 2, 1], ['d2', 'Detune (cents)', -50, 50, 1], ['mix', 'Level', 0, 1, 0.05]]],
    ['Sub and noise', [['sub', 'Sub oscillator', 0, 1, 0.05], ['noise', 'Noise', 0, 1, 0.05]]],
    ['Filter', [['ftype', 'Type', ['lowpass', 'highpass', 'bandpass']], ['cut', 'Cutoff (Hz)', 60, 16000, 10], ['res', 'Resonance', 0.1, 18, 0.1], ['fenv', 'Envelope amount', -4, 4, 0.1]]],
    ['Filter envelope', [['fa', 'Attack (s)', 0, 3, 0.01], ['fd', 'Decay (s)', 0.01, 3, 0.01], ['fs', 'Sustain', 0, 1, 0.05], ['fr', 'Release (s)', 0.01, 4, 0.01]]],
    ['Amp envelope', [['a', 'Attack (s)', 0, 3, 0.01], ['d', 'Decay (s)', 0.01, 3, 0.01], ['s', 'Sustain', 0, 1, 0.05], ['r', 'Release (s)', 0.01, 4, 0.01]]],
    ['LFO', [['lfoTo', 'Moves', ['pitch', 'filter', 'amp']], ['lfoRate', 'Rate (Hz)', 0.1, 20, 0.1], ['lfoDepth', 'Depth', 0, 100, 1]]],
    ['Echo, reverb and volume', [['dly', 'Echo (%)', 0, 60, 1], ['dtime', 'Echo time (ms)', 60, 800, 10], ['rev', 'Reverb (%)', 0, 80, 1], ['vol', 'Volume', 0, 100, 1]]]
  ];
  let P = { ...BASE }, ac = null, bus = null, sample = null, sampleName = '', octave = 4, held = new Map(), rec = null, riff = [], playing = [], midiOn = false;
  const AC = () => (ac = ac || Q.AC());
  const noiseBuf = (() => { const m = new WeakMap(); return (c) => { let b = m.get(c); if (!b) { b = c.createBuffer(1, c.sampleRate * 2, c.sampleRate); const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; m.set(c, b); } return b; }; })();
  const impulse = (c, secs) => { const n = Math.round(secs * c.sampleRate), b = c.createBuffer(2, n, c.sampleRate); for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.4); } return b; };

  /* ---------- the sound engine ---------- */
  function makeBus(c, p) {
    const input = c.createGain(), master = c.createGain(), comp = c.createDynamicsCompressor(), d = c.createDelay(2), fb = c.createGain(), dg = c.createGain(), cv = c.createConvolver(), rg = c.createGain();
    cv.buffer = impulse(c, 2.2); fb.gain.value = 0.38; comp.threshold.value = -10; comp.ratio.value = 4; comp.knee.value = 12;
    input.connect(master); input.connect(d); d.connect(fb).connect(d); d.connect(dg).connect(master); input.connect(cv).connect(rg).connect(master); master.connect(comp).connect(c.destination);
    const update = (q) => { master.gain.value = q.vol / 100 * 0.8; d.delayTime.value = q.dtime / 1000; dg.gain.value = q.dly / 100; rg.gain.value = q.rev / 100 * 1.4; };
    update(p); return { input, update };
  }
  /* start one note; returns { release(t) }. Pass `end` when the length is known (offline rendering) */
  function voice(c, dest, p, midi, vel, t0, end) {
    const freq = 440 * Math.pow(2, (midi - 69) / 12), peak = Math.max(0.05, vel / 127) * 0.5, srcs = [], amp = c.createGain(), flt = c.createBiquadFilter(), mixg = c.createGain();
    flt.type = p.ftype; flt.frequency.value = clamp(p.cut, 20, 18000); flt.Q.value = p.res; mixg.gain.value = 1; mixg.connect(flt).connect(amp).connect(dest);
    const tone = (type, hz, cents, level) => { const o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.value = hz; o.detune.value = cents; g.gain.value = level; o.connect(g).connect(mixg); o.start(t0); srcs.push(o); return o; };
    const pitchMods = [];
    if (p.mode === 'sampler' && sample) {
      const s = c.createBufferSource(), g = c.createGain(); s.buffer = sample; s.playbackRate.value = Math.pow(2, (midi - p.root) / 12); if (p.loop) { s.loop = true; s.loopStart = sample.duration * 0.1; s.loopEnd = sample.duration * 0.9; } s.connect(g).connect(mixg); g.gain.value = 1; s.start(t0); srcs.push(s); pitchMods.push(s.detune);
    } else {
      pitchMods.push(tone(p.w1, freq * Math.pow(2, p.o1), p.d1, 1 - p.mix * 0.5).detune, tone(p.w2, freq * Math.pow(2, p.o2), p.d2, p.mix).detune);
      if (p.sub > 0) pitchMods.push(tone('sine', freq / 2, 0, p.sub).detune);
      if (p.noise > 0) { const n = c.createBufferSource(), g = c.createGain(); n.buffer = noiseBuf(c); n.loop = true; g.gain.value = p.noise * 0.6; n.connect(g).connect(mixg); n.start(t0); srcs.push(n); }
    }
    mixg.gain.value = 0.55;
    if (p.fenv) { const top = p.fenv * 1200; flt.detune.setValueAtTime(0, t0); flt.detune.linearRampToValueAtTime(top, t0 + Math.max(0.001, p.fa)); flt.detune.linearRampToValueAtTime(top * p.fs, t0 + p.fa + Math.max(0.01, p.fd)); }
    amp.gain.setValueAtTime(0.0001, t0); amp.gain.linearRampToValueAtTime(peak, t0 + Math.max(0.002, p.a)); amp.gain.linearRampToValueAtTime(Math.max(0.0001, peak * p.s), t0 + Math.max(0.002, p.a) + Math.max(0.01, p.d));
    if (p.lfoDepth > 0) {
      const l = c.createOscillator(), g = c.createGain(); l.frequency.value = p.lfoRate; l.start(t0); srcs.push(l);
      if (p.lfoTo === 'pitch') { g.gain.value = p.lfoDepth * 2; pitchMods.forEach((m) => g.connect(m)); } else if (p.lfoTo === 'filter') { g.gain.value = p.lfoDepth * 24; g.connect(flt.detune); } else { g.gain.value = p.lfoDepth / 100 * peak * 0.8; g.connect(amp.gain); }
      l.connect(g);
    }
    let done = false;
    const release = (t) => {
      if (done) return; done = true; t = Math.max(t, t0 + 0.005); const r = Math.max(0.02, p.r);
      if (amp.gain.cancelAndHoldAtTime) amp.gain.cancelAndHoldAtTime(t); else amp.gain.cancelScheduledValues(t);
      amp.gain.setTargetAtTime(0.0001, t, r / 3.5); if (p.fenv) { if (flt.detune.cancelAndHoldAtTime) flt.detune.cancelAndHoldAtTime(t); flt.detune.setTargetAtTime(0, t, Math.max(0.02, p.fr) / 3.5); }
      srcs.forEach((s) => { try { s.stop(t + r * 1.4 + 0.1); } catch (_) { /* stopped */ } });
    };
    if (end != null) release(end); return { release, t0 };
  }
  async function render(notes, p, bpm) {
    const rate = 44100, spb = 60 / bpm, last = notes.reduce((m, n) => Math.max(m, (n.t + n.d) * spb), 0), tail = p.r + (p.rev > 0 ? 2.2 : 0) + (p.dly > 0 ? 1.8 : 0) + 0.3;
    const oc = new OfflineAudioContext(2, Math.ceil((last + tail) * rate), rate), b = makeBus(oc, p);
    notes.forEach((n) => voice(oc, b.input, p, n.p, n.v || 100, n.t * spb, (n.t + n.d) * spb)); const r = await oc.startRendering(); return { chs: [r.getChannelData(0), r.getChannelData(1)], rate };
  }

  /* ---------- playing ---------- */
  async function noteOn(m, vel = 100) {
    if (held.has(m)) return; const c = AC(); if (c.state === 'suspended') await c.resume(); if (!bus) bus = makeBus(c, P);
    if (held.has(m)) return; held.set(m, voice(c, bus.input, P, m, vel, c.currentTime + 0.005)); mark(m, true); if (rec) rec.open.set(m, { t: c.currentTime - rec.t0, v: vel });
  }
  function noteOff(m) {
    const v = held.get(m); if (!v) return; v.release(AC().currentTime); held.delete(m); mark(m, false);
    if (rec && rec.open.has(m)) { const o = rec.open.get(m); rec.open.delete(m); riff.push({ s: o.t, d: Math.max(0.05, AC().currentTime - rec.t0 - o.t), p: m, v: o.v }); showRiff(); }
  }
  const allOff = () => [...held.keys()].forEach(noteOff);
  const keyEls = new Map();
  function mark(m, on) { const e = keyEls.get(m); if (e) { e.classList.toggle('on', on); e.setAttribute('aria-pressed', on ? 'true' : 'false'); } }
  function buildKeys() {
    const kb = $('kb'); kb.replaceChildren(); keyEls.clear(); const lo = (octave + 1) * 12, hi = lo + 24, WH = [0, 2, 4, 5, 7, 9, 11], W = 38, pos = {}; let x = 0;
    for (let m = lo; m <= hi; m++) if (WH.includes(m % 12)) { pos[m] = x; x += W; }
    const inner = document.createElement('div'); inner.className = 'kbin'; inner.style.width = x + 'px'; kb.appendChild(inner);
    for (let m = lo; m <= hi; m++) {
      const white = WH.includes(m % 12), b = document.createElement('button'); b.type = 'button'; b.className = white ? 'wk' : 'bk'; b.dataset.midi = m; b.setAttribute('aria-pressed', 'false'); b.setAttribute('aria-label', noteName(m));
      b.style.left = (white ? pos[m] : pos[m - 1] + W - 12) + 'px'; b.style.width = (white ? W : 24) + 'px';
      const down = (e) => { e.preventDefault(); noteOn(m, 100); }, up = () => noteOff(m);
      b.addEventListener('pointerdown', down); b.addEventListener('pointerup', up); b.addEventListener('pointerleave', up); b.addEventListener('pointercancel', up);
      b.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (!e.repeat) noteOn(m, 100); } }); b.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') noteOff(m); }); b.addEventListener('blur', up);
      inner.appendChild(b); keyEls.set(m, b);
    }
    $('octlabel').textContent = 'Octave ' + octave;
  }
  const KEYMAP = 'awsedftgyhujkolp;'.split('');
  document.addEventListener('keydown', (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return; const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON')) return;
    const i = KEYMAP.indexOf(e.key.toLowerCase()); if (i >= 0) { e.preventDefault(); noteOn((octave + 1) * 12 + i, 100); } else if (e.key === 'z') { octave = Math.max(0, octave - 1); buildKeys(); } else if (e.key === 'x') { octave = Math.min(8, octave + 1); buildKeys(); }
  });
  document.addEventListener('keyup', (e) => { const i = KEYMAP.indexOf(e.key.toLowerCase()); if (i >= 0) noteOff((octave + 1) * 12 + i); });
  $('octdn').onclick = () => { octave = Math.max(0, octave - 1); buildKeys(); }; $('octup').onclick = () => { octave = Math.min(8, octave + 1); buildKeys(); };
  $('panic').onclick = allOff; window.addEventListener('blur', allOff);

  /* ---------- controls ---------- */
  const ctl = {};
  function buildControls() {
    const box = $('ctls'); box.replaceChildren();
    SPEC.forEach(([title, items]) => {
      const f = document.createElement('fieldset'); f.className = 'fs'; const lg = document.createElement('legend'); lg.textContent = title; f.appendChild(lg); const g = document.createElement('div'); g.className = 'mini';
      items.forEach(([k, label, a, b, st]) => {
        const l = document.createElement('label'); l.className = 'ctl'; let el;
        if (Array.isArray(a)) { el = document.createElement('select'); a.forEach((o) => el.appendChild(Object.assign(document.createElement('option'), { value: o, textContent: o }))); l.append(document.createTextNode(label), el); el.onchange = () => { P[k] = el.value; custom(); push(); }; }
        else { el = document.createElement('input'); el.type = 'range'; el.min = a; el.max = b; el.step = st; const o = document.createElement('output'); l.append(document.createTextNode(label + ' '), o, el); el.oninput = () => { P[k] = +el.value; o.textContent = el.value; if (k === 'vol' || k === 'dly' || k === 'dtime' || k === 'rev') push(); }; el.onchange = () => { custom(); }; el._o = o; }
        el.id = 's-' + k; ctl[k] = el; g.appendChild(l);
      });
      f.appendChild(g); box.appendChild(f);
    });
  }
  const push = () => { if (bus) bus.update(P); };
  const custom = () => { if ($('preset').value !== 'Custom') $('preset').value = 'Custom'; };
  function apply(p) { P = { ...BASE, ...p }; Object.keys(ctl).forEach((k) => { ctl[k].value = P[k]; if (ctl[k]._o) ctl[k]._o.textContent = P[k]; }); $('mode').value = P.mode; $('root').value = P.root; $('loop').checked = !!P.loop; modeUI(); push(); }
  function modeUI() { const s = P.mode === 'sampler'; $('samplebox').hidden = !s; ['Oscillator 1', 'Oscillator 2', 'Sub and noise'].forEach(() => { }); document.querySelectorAll('#ctls fieldset').forEach((f, i) => { if (i < 3) f.hidden = s; }); }
  $('mode').onchange = () => { P.mode = $('mode').value; modeUI(); custom(); };
  $('preset').onchange = () => { const v = $('preset').value; const saved = loadSaved(); if (PRESETS[v]) apply(PRESETS[v]); else if (saved[v]) apply(saved[v]); };

  /* ---------- your own patches, saved only in this browser ---------- */
  const SK = 'govibe.synth.patches';
  const loadSaved = () => { try { return JSON.parse(localStorage.getItem(SK) || '{}') || {}; } catch (_) { return {}; } };
  function listPresets() { const sel = $('preset'), cur = sel.value; sel.replaceChildren(); Object.keys(PRESETS).forEach((n) => sel.appendChild(Object.assign(document.createElement('option'), { value: n, textContent: n }))); const sv = loadSaved(); Object.keys(sv).forEach((n) => sel.appendChild(Object.assign(document.createElement('option'), { value: n, textContent: n + ' (mine)' }))); sel.appendChild(Object.assign(document.createElement('option'), { value: 'Custom', textContent: 'Custom' })); if ([...sel.options].some((o) => o.value === cur)) sel.value = cur; }
  $('psave').onclick = () => { const n = $('pname').value.trim().slice(0, 40); if (!n) return say('Type a name for your sound first.'); if (PRESETS[n]) return say('That name is used by a built in sound. Choose another.'); const sv = loadSaved(); sv[n] = { ...P }; try { localStorage.setItem(SK, JSON.stringify(sv)); } catch (_) { return say('This browser would not save it. You can still export the sound as a file.'); } listPresets(); $('preset').value = n; say('Saved "' + n + '" in this browser.'); };
  $('pdel').onclick = () => { const v = $('preset').value, sv = loadSaved(); if (!sv[v]) return say('Only your own sounds can be deleted.'); delete sv[v]; try { localStorage.setItem(SK, JSON.stringify(sv)); } catch (_) { /* ignore */ } listPresets(); say('Deleted "' + v + '".'); };
  $('pexp').onclick = () => { Q.save(new Blob([JSON.stringify(P, null, 1)], { type: 'application/json' }), 'sound.json'); say('Saved sound.json.'); };
  $('pimp').onclick = () => $('pfile').click(); $('pfile').onchange = async () => { const f = $('pfile').files[0]; $('pfile').value = ''; if (!f) return; try { const j = JSON.parse(await f.text()); if (!j || typeof j !== 'object' || !WAVES.includes(j.w1 || 'sawtooth')) throw new Error('not a sound file'); const q = {}; Object.keys(BASE).forEach((k) => { if (j[k] != null && typeof j[k] === typeof BASE[k]) q[k] = j[k]; }); apply(q); custom(); say('Loaded the sound.'); } catch (e) { say('That is not a GoVibe sound file.'); } };

  /* ---------- sampler ---------- */
  $('sload').onclick = () => $('sfile').click(); $('sfile').onchange = async () => { const f = $('sfile').files[0]; $('sfile').value = ''; if (!f) return; try { const b = await Q.decode(f); if (b.duration > 30) return say('Please choose a sample under 30 seconds.'); sample = b; sampleName = f.name; $('sname').textContent = f.name + ' · ' + Q.fmt(b.duration); P.mode = 'sampler'; $('mode').value = 'sampler'; modeUI(); say('Sample ready. Play the keyboard.'); } catch (e) { say('Could not read that file.'); } };
  $('root').replaceChildren(...Array.from({ length: 49 }, (_, i) => 36 + i).map((m) => Object.assign(document.createElement('option'), { value: m, textContent: noteName(m) }))); $('root').value = 60;
  $('root').onchange = () => { P.root = +$('root').value; }; $('loop').onchange = () => { P.loop = $('loop').checked; };

  /* ---------- riff: record, play, save ---------- */
  const bpm = () => clamp(+$('tempo').value || 100, 30, 300);
  function showRiff() { $('riffinfo').textContent = riff.length ? riff.length + ' notes recorded, ' + Q.fmt(Math.max(...riff.map((n) => n.s + n.d))) + ' long.' : 'Nothing recorded yet.'; ['rplay', 'rmidi', 'rwav', 'rstudio', 'rclear'].forEach((id) => { $(id).disabled = !riff.length; }); }
  const notesBeats = () => { const spb = 60 / bpm(), t0 = Math.min(...riff.map((n) => n.s)); return riff.map((n) => ({ t: (n.s - t0) / spb, d: n.d / spb, p: n.p, v: n.v })); };
  $('rrec').onclick = async () => { if (rec) { allOff(); rec = null; $('rrec').textContent = '● Record a riff'; $('rrec').classList.remove('rec-on'); say(riff.length ? 'Riff recorded.' : 'No notes were played.'); showRiff(); return; } const c = AC(); if (c.state === 'suspended') await c.resume(); riff = []; rec = { t0: c.currentTime, open: new Map() }; $('rrec').textContent = '■ Stop recording'; $('rrec').classList.add('rec-on'); say('Recording. Play some notes.'); showRiff(); };
  $('rplay').onclick = async () => { if (playing.length) { playing.forEach((v) => v.release(AC().currentTime)); playing = []; $('rplay').textContent = '▶ Play riff'; return; } const c = AC(); if (c.state === 'suspended') await c.resume(); if (!bus) bus = makeBus(c, P); const t = c.currentTime + 0.1, spb = 60 / bpm(); notesBeats().forEach((n) => playing.push(voice(c, bus.input, P, n.p, n.v, t + n.t * spb, t + (n.t + n.d) * spb))); $('rplay').textContent = '■ Stop'; const len = Math.max(...notesBeats().map((n) => (n.t + n.d) * spb)); setTimeout(() => { if (playing.length) { playing = []; $('rplay').textContent = '▶ Play riff'; } }, (len + 0.3) * 1000); };
  $('rclear').onclick = () => { riff = []; showRiff(); say('Cleared.'); };
  const midiBytes = (ns, b) => GVMidi.write({ bpm: b, sig: [4, 4], markers: [], tracks: [{ type: 'midi', name: 'Synth', inst: 'Synth lead', clips: [{ start: 0, dur: Math.max(1, ns.reduce((m, n) => Math.max(m, n.t + n.d), 0)), notes: ns }] }] });
  $('rmidi').onclick = () => { Q.save(new Blob([midiBytes(notesBeats(), bpm())], { type: 'audio/midi' }), 'riff.mid'); say('Saved riff.mid.'); };
  async function wavOf() { say('Rendering…'); const r = await render(notesBeats(), P, bpm()); return Q.wav(r.chs, r.rate); }
  $('rwav').onclick = async () => { Q.save(await wavOf(), 'riff.wav'); say('Saved riff.wav.'); };
  $('rstudio').onclick = async () => { try { await GVStore.put('studio-import', await wavOf()); location.href = 'studio.html?from=record'; } catch (e) { say('Could not hand it to the Studio: ' + e.message); } };

  /* ---------- a MIDI keyboard, if you have one (stays on this device) ---------- */
  $('midiin').onclick = async () => {
    if (!navigator.requestMIDIAccess) return say('This browser cannot read MIDI keyboards. Chrome and Edge can.');
    try { const a = await navigator.requestMIDIAccess(); const hook = () => a.inputs.forEach((i) => { i.onmidimessage = (e) => { const [s, n, v] = e.data, c = s & 0xf0; if (c === 0x90 && v > 0) noteOn(n, v); else if (c === 0x80 || (c === 0x90 && v === 0)) noteOff(n); }; }); hook(); a.onstatechange = hook; midiOn = true; say(a.inputs.size ? 'MIDI keyboard connected.' : 'No MIDI keyboard found yet. Plug one in and it will connect.'); }
    catch (e) { say('MIDI access was blocked.'); }
  };

  buildControls(); listPresets(); apply(PRESETS['Warm pad']); $('preset').value = 'Warm pad'; buildKeys(); showRiff();
  window.addEventListener('pagehide', () => { allOff(); if (ac) ac.close && ac.close().catch(() => { }); });
  if (/[?&]gvtest\b/.test(location.search)) window.__syn = { voice, render, makeBus, PRESETS, BASE, apply, noteOn, noteOff, midiBytes, setSample(b) { sample = b; }, get patch() { return P; }, get riff() { return riff; }, get held() { return held; }, get octave() { return octave; } };
})();
