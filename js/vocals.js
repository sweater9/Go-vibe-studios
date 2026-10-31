/* GoVibe Mix: vocal studio. Record several takes against a backing track, build one best take from the good parts (comping),
   correct the pitch note by note, add a vocal effects chain and send the result to the Studio. Everything stays on this device. */
(() => {
  const $ = (id) => document.getElementById(id), Q = window.GVQuick, P = window.GVPitch, S = window.GVStretch;
  const say = (t) => { $('status').textContent = t; }, nap = () => new Promise((r) => setTimeout(r, 0)), clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const SCALES = { Major: [0, 2, 4, 5, 7, 9, 11], 'Natural minor': [0, 2, 3, 5, 7, 8, 10], Chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 'Major pentatonic': [0, 2, 4, 7, 9], 'Minor pentatonic': [0, 3, 5, 7, 10] };
  const PRESETS = {
    Natural: { hpf: 80, presence: 1, air: 1, thr: -18, ratio: 2, makeup: 2, rev: 8, size: 1.4, dly: 0, dtime: 280, dbl: 0 },
    Pop: { hpf: 100, presence: 3, air: 4, thr: -24, ratio: 4, makeup: 5, rev: 14, size: 1.6, dly: 8, dtime: 320, dbl: 20 },
    Warm: { hpf: 70, presence: -1, air: 2, thr: -20, ratio: 3, makeup: 3, rev: 12, size: 1.8, dly: 0, dtime: 300, dbl: 0 },
    Radio: { hpf: 300, presence: 6, air: 0, thr: -26, ratio: 6, makeup: 6, rev: 4, size: 0.8, dly: 0, dtime: 200, dbl: 10 },
    Dry: { hpf: 20, presence: 0, air: 0, thr: 0, ratio: 1, makeup: 0, rev: 0, size: 1, dly: 0, dtime: 250, dbl: 0 }
  };
  let ac = null, takes = [], nextId = 1, comp = [], backing = null, fixed = null, playing = null, recState = null, stream = null, node = null, busy = false;
  const AC = () => (ac = ac || Q.AC());
  const sr = () => AC().sampleRate;

  /* ---------- takes ---------- */
  function addTake(chan, rate, name, offset) {
    const t = { id: nextId++, name: name || 'Take ' + nextId, ch: chan, rate, offset: offset || 0, gain: 1 }; takes.push(t); fixed = null; renderTakes(); drawComp(); return t;
  }
  const takeEnd = (t) => t.offset + t.ch.length / t.rate;
  const length = () => Math.max(1, backing ? backing.duration : 0, ...takes.map(takeEnd));
  function takeAt(t, rate) { /* resample a take to the working rate with its offset and gain applied, returns Float32Array of length() seconds */
    const n = Math.ceil(length() * rate), out = new Float32Array(n), o0 = Math.round(t.offset * rate), k = t.rate / rate;
    for (let i = Math.max(0, o0); i < n; i++) { const x = (i - o0) * k, i0 = Math.floor(x); if (i0 >= t.ch.length) break; const f = x - i0, a = t.ch[i0], b = t.ch[Math.min(t.ch.length - 1, i0 + 1)]; out[i] = (a + (b - a) * f) * t.gain; }
    return out;
  }
  function buildComp(rate) {
    const n = Math.ceil(length() * rate), out = new Float32Array(n), segs = [...comp].sort((a, b) => a.a - b.a), xf = Math.round(0.008 * rate);
    segs.forEach((sg) => {
      const t = takes.find((x) => x.id === sg.take); if (!t) return; const src = takeAt(t, rate), a = Math.max(0, Math.round(sg.a * rate)), b = Math.min(n, Math.round(sg.b * rate));
      for (let i = a; i < b; i++) { const fi = Math.min(1, (i - a) / xf), fo = Math.min(1, (b - i) / xf); out[i] = src[i] * Math.sin(fi * Math.PI / 2) * Math.sin(fo * Math.PI / 2); }
    });
    return out;
  }
  function setSegment(takeId, a, b) {
    if (b - a < 0.05) return; comp = comp.flatMap((sg) => { if (sg.b <= a || sg.a >= b) return [sg]; const out = []; if (sg.a < a) out.push({ ...sg, b: a }); if (sg.b > b) out.push({ ...sg, a: b }); return out; });
    comp.push({ take: takeId, a, b }); comp.sort((x, y) => x.a - y.a); fixed = null; renderComp(); drawComp();
  }
  const useWhole = (t) => { comp = []; setSegment(t.id, Math.max(0, t.offset), takeEnd(t)); };

  /* ---------- pitch correction, note by note ---------- */
  async function findNotes(chan, rate, onP) {
    const f = Math.max(1, Math.round(rate / 16000)), r16 = rate / f, n = Math.floor(chan.length / f), d = new Float32Array(n);
    for (let i = 0; i < n; i++) { let s = 0; for (let k = 0; k < f; k++) s += chan[i * f + k]; d[i] = s / f; }
    const win = 1024, hop = 320, frames = Math.max(0, Math.floor((n - win) / hop)), lv = new Float32Array(frames), pit = new Array(frames).fill(null);
    for (let i = 0; i < frames; i++) lv[i] = P.rms(d.subarray(i * hop, i * hop + win));
    const top = [...lv].sort((a, b) => a - b)[Math.floor(frames * 0.95)] || 0, gate = Math.max(0.004, top * 0.1);
    for (let i = 0; i < frames; i++) { if (lv[i] >= gate) { const y = P.yin(d.subarray(i * hop, i * hop + win), r16, 70, 1000, 0.15); if (y && y.clarity >= 0.75) pit[i] = P.toMidi(y.hz); } if (i % 200 === 0) { if (onP) onP(i / frames); await nap(); } }
    const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1], out = [], minF = Math.max(2, Math.round(0.08 * r16 / hop)); let cur = null, gap = 0;
    const close = () => { if (cur && cur.ps.length >= minF) out.push({ s: cur.a * hop / r16, e: (cur.last + 1) * hop / r16 + win / r16 * 0.5, m: med(cur.ps) }); cur = null; gap = 0; };
    for (let i = 0; i < frames; i++) { const m = pit[i]; if (m == null) { if (cur && ++gap > 2) close(); continue; } if (cur && Math.abs(m - med(cur.ps)) > 0.8) close(); if (!cur) cur = { a: i, ps: [], last: i }; cur.ps.push(m); cur.last = i; gap = 0; }
    close(); return out;
  }
  const nearestIn = (m, root, scale) => { const set = SCALES[scale] || SCALES.Chromatic; let best = null, bd = 99; for (let k = Math.floor(m) - 2; k <= Math.ceil(m) + 2; k++) { if (set.includes(((k - root) % 12 + 12) % 12) && Math.abs(k - m) < bd) { bd = Math.abs(k - m); best = k; } } return best == null ? Math.round(m) : best; };
  async function pitchCorrect(chan, rate, opt) {
    const notes = await findNotes(chan, rate, opt.onProgress), out = new Float32Array(chan), pad = Math.round(0.02 * rate), k = clamp(opt.strength, 0, 1); let fixedN = 0;
    for (const nt of notes) {
      const target = nearestIn(nt.m, opt.root, opt.scale), sh = (target - nt.m) * k; if (Math.abs(sh) < 0.04) continue;
      const a = Math.max(0, Math.round(nt.s * rate) - pad), b = Math.min(chan.length, Math.round(nt.e * rate) + pad), seg = S.pitchShift([chan.subarray(a, b)], sh)[0];
      for (let i = 0; i < seg.length && a + i < chan.length; i++) { const fi = Math.min(1, i / pad), fo = Math.min(1, (seg.length - i) / pad), w = Math.min(fi, fo); out[a + i] = chan[a + i] * (1 - w) + seg[i] * w; }
      fixedN++; await nap();
    }
    return { out, notes: notes.length, fixed: fixedN };
  }

  /* ---------- effects chain (works in a live or an offline context) ---------- */
  function impulse(c, secs, rate) { const n = Math.round(secs * rate), b = c.createBuffer(2, n, rate); for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.5); } return b; }
  function chain(c, p) {
    const inp = c.createGain(), out = c.createGain(), db = (x) => Math.pow(10, x / 20);
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = clamp(p.hpf, 20, 600); hp.Q.value = 0.7;
    const pr = c.createBiquadFilter(); pr.type = 'peaking'; pr.frequency.value = 3500; pr.Q.value = 0.9; pr.gain.value = p.presence;
    const ds = c.createBiquadFilter(); ds.type = 'peaking'; ds.frequency.value = 6800; ds.Q.value = 2; ds.gain.value = p.presence > 2 ? -2 : 0;
    const ar = c.createBiquadFilter(); ar.type = 'highshelf'; ar.frequency.value = 10000; ar.gain.value = p.air;
    const cp = c.createDynamicsCompressor(); cp.threshold.value = p.thr; cp.ratio.value = p.ratio; cp.knee.value = 8; cp.attack.value = 0.008; cp.release.value = 0.16; const mk = c.createGain(); mk.gain.value = db(p.makeup);
    inp.connect(hp).connect(pr).connect(ds).connect(ar).connect(cp).connect(mk); mk.connect(out);
    if (p.rev > 0) { const cv = c.createConvolver(); cv.buffer = impulse(c, p.size, c.sampleRate); const g = c.createGain(); g.gain.value = p.rev / 100 * 1.6; mk.connect(cv).connect(g).connect(out); }
    if (p.dly > 0) { const d = c.createDelay(2), fb = c.createGain(), g = c.createGain(); d.delayTime.value = p.dtime / 1000; fb.gain.value = 0.35; g.gain.value = p.dly / 100; mk.connect(d); d.connect(fb).connect(d); d.connect(g).connect(out); }
    if (p.dbl > 0) { [[0.019, -0.7], [0.031, 0.7]].forEach(([t, pan]) => { const d = c.createDelay(0.2), g = c.createGain(), st = c.createStereoPanner(); d.delayTime.value = t; g.gain.value = p.dbl / 100 * 0.8; st.pan.value = pan; mk.connect(d).connect(g).connect(st).connect(out); }); }
    return { input: inp, output: out, tail: Math.max(p.rev > 0 ? p.size : 0, p.dly > 0 ? 1.5 : 0) + 0.3 };
  }
  const params = () => { const g = (id) => +$(id).value; return { hpf: g('p-hpf'), presence: g('p-pres'), air: g('p-air'), thr: g('p-thr'), ratio: g('p-ratio'), makeup: g('p-mk'), rev: g('p-rev'), size: g('p-size'), dly: g('p-dly'), dtime: g('p-dt'), dbl: g('p-dbl') }; };
  const setParams = (p) => { const m = { hpf: 'p-hpf', presence: 'p-pres', air: 'p-air', thr: 'p-thr', ratio: 'p-ratio', makeup: 'p-mk', rev: 'p-rev', size: 'p-size', dly: 'p-dly', dtime: 'p-dt', dbl: 'p-dbl' }; Object.entries(m).forEach(([k, id]) => { $(id).value = p[k]; $(id).dispatchEvent(new Event('input')); }); };
  const source = () => (fixed && $('usefix').checked ? fixed : buildComp(sr()));
  async function renderVocal(withBacking) {
    const rate = sr(), dry = source(), p = params(), tmp = new OfflineAudioContext(2, 1, rate), ch = chain(tmp, p), n = dry.length + Math.ceil(ch.tail * rate);
    const oc = new OfflineAudioContext(2, n, rate), cc = chain(oc, p), b = oc.createBuffer(1, dry.length, rate); b.copyToChannel(dry, 0);
    const s = oc.createBufferSource(); s.buffer = b; s.connect(cc.input); cc.output.connect(oc.destination); s.start();
    if (withBacking && backing) { const bs = oc.createBufferSource(), g = oc.createGain(); bs.buffer = backing; g.gain.value = +$('bvol').value / 100; bs.connect(g).connect(oc.destination); bs.start(); }
    const r = await oc.startRendering(); return { chs: [r.getChannelData(0), r.getChannelData(1)], rate };
  }

  /* ---------- recording ---------- */
  async function startRecording() {
    if (recState || busy) return; const c = AC(); if (c.state === 'suspended') await c.resume();
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }); } catch (e) { return say(e && e.name === 'NotAllowedError' ? 'Microphone access was blocked. Allow it in your browser settings and try again.' : 'No microphone was found.'); }
    await c.audioWorklet.addModule('js/rec-worklet.js'); node = new AudioWorkletNode(c, 'gv-rec', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] }); const mute = c.createGain(); mute.gain.value = 0; const src = c.createMediaStreamSource(stream); src.connect(node); node.connect(mute).connect(c.destination);
    const bpm = clamp(+$('tempo').value || 100, 30, 300), beat = 60 / bpm, count = $('count').checked ? clamp(+$('beats').value || 4, 1, 8) : 0, t0 = c.currentTime + 0.12, start = t0 + count * beat; const chunks = [];
    node.port.onmessage = (e) => { if (e.data.l) chunks.push(e.data.l); else if (e.data.done) finishRecording(chunks, c); };
    node.port.postMessage({ cmd: 'arm', at: Math.round(start * c.sampleRate) });
    for (let i = 0; i < count; i++) tick(t0 + i * beat, i === 0);
    let bs = null; if (backing) { bs = c.createBufferSource(); const g = c.createGain(); g.gain.value = +$('bvol').value / 100; bs.buffer = backing; bs.connect(g).connect(c.destination); bs.start(start); }
    recState = { src, bs, t0: start, mute }; $('rec').textContent = '■ Stop'; $('rec').classList.add('rec-on'); say(count ? 'Count in…' : 'Recording…'); recState.timer = setInterval(() => { const s = c.currentTime - start; say(s < 0 ? 'Count in…' : 'Recording ' + Q.fmt(s)); }, 200);
  }
  const tick = (t, acc) => { const c = AC(), o = c.createOscillator(), g = c.createGain(); o.frequency.value = acc ? 1500 : 1000; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.4, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05); o.connect(g).connect(c.destination); o.start(t); o.stop(t + 0.06); };
  function stopRecording() { if (!recState) return; clearInterval(recState.timer); try { recState.bs && recState.bs.stop(); } catch (_) { /* ended */ } node.port.postMessage('flush'); }
  function finishRecording(chunks, c) {
    const n = chunks.reduce((s, x) => s + x.length, 0), all = new Float32Array(n); let o = 0; chunks.forEach((x) => { all.set(x, o); o += x.length; });
    try { recState.src.disconnect(); node.disconnect(); } catch (_) { /* gone */ } stream.getTracks().forEach((t) => t.stop()); stream = null; node = null; recState = null; $('rec').textContent = '● Record a take'; $('rec').classList.remove('rec-on');
    if (n < c.sampleRate * 0.3) return say('That take was too short to keep.');
    const lat = clamp(-((c.baseLatency || 0) + (c.outputLatency || 0)), -0.3, 0), t = addTake(all, c.sampleRate, 'Take ' + nextId, lat); say('Saved ' + t.name + '. Listen to it, then record another or build your best take below.');
  }
  $('rec').onclick = () => (recState ? stopRecording() : startRecording());

  /* ---------- playback ---------- */
  function stopPlay() { if (playing) { playing.srcs.forEach((s) => { try { s.stop(); } catch (_) { /* done */ } }); cancelAnimationFrame(playing.raf); playing = null; } document.querySelectorAll('[data-play]').forEach((b) => { b.textContent = b.dataset.label || '▶ Play'; }); $('playall').textContent = '▶ Hear it'; }
  async function playBuffers(chs, rate, withBacking, btn) {
    if (playing) { stopPlay(); return; } const c = AC(); if (c.state === 'suspended') await c.resume(); const b = c.createBuffer(chs.length, chs[0].length, rate); chs.forEach((x, i) => b.copyToChannel(x, i)); const s = c.createBufferSource(); s.buffer = b; s.connect(c.destination); const srcs = [s];
    if (withBacking && backing) { const bs = c.createBufferSource(), g = c.createGain(); g.gain.value = +$('bvol').value / 100; bs.buffer = backing; bs.connect(g).connect(c.destination); bs.start(c.currentTime + 0.05); srcs.push(bs); }
    s.start(c.currentTime + 0.05); s.onended = () => { if (playing && playing.srcs[0] === s) stopPlay(); }; playing = { srcs }; if (btn) { btn.dataset.label = btn.dataset.label || btn.textContent; btn.textContent = '■ Stop'; }
  }
  $('playall').onclick = async () => { if (playing) return stopPlay(); if (!takes.length) return say('Record or add a take first.'); if (!comp.length && !(fixed && $('usefix').checked)) return say('Choose the parts you like first, or press Use whole take on a take.'); busy = true; say('Preparing…'); try { const r = await renderVocal(true); await playBuffers(r.chs, r.rate, true, $('playall')); say(''); } finally { busy = false; } };

  /* ---------- the takes and the comp, drawn ---------- */
  function renderTakes() {
    const box = $('takes'); box.replaceChildren(); if (!takes.length) { const p = document.createElement('p'); p.className = 'status'; p.textContent = 'No takes yet. Record one, or add a recording you already have.'; box.appendChild(p); }
    takes.forEach((t) => {
      const row = document.createElement('div'); row.className = 'rstep'; const nm = document.createElement('strong'); nm.textContent = t.name + ' · ' + Q.fmt(t.ch.length / t.rate); row.appendChild(nm); const g = document.createElement('div'); g.className = 'row';
      const mkb = (txt, fn, aria) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn mini'; b.textContent = txt; b.setAttribute('aria-label', aria || txt + ' ' + t.name); b.onclick = fn; g.appendChild(b); return b; };
      const pb = mkb('▶ Play', async () => { if (playing) return stopPlay(); await playBuffers([takeAt(t, sr())], sr(), $('bwith').checked, pb); }, 'Play ' + t.name); pb.dataset.play = '1';
      mkb('Use whole take', () => useWhole(t)); mkb('Delete', () => { takes = takes.filter((x) => x !== t); comp = comp.filter((sg) => sg.take !== t.id); fixed = null; renderTakes(); renderComp(); drawComp(); });
      const lab = document.createElement('label'); lab.className = 'ctl'; lab.style.minWidth = '110px'; lab.append(document.createTextNode('Timing (ms) '), Object.assign(document.createElement('input'), { type: 'number', min: -500, max: 500, step: 5, value: Math.round(t.offset * 1000), onchange(e) { t.offset = clamp(+e.target.value || 0, -500, 500) / 1000; fixed = null; drawComp(); } })); g.appendChild(lab);
      const lg = document.createElement('label'); lg.className = 'ctl'; lg.style.minWidth = '110px'; lg.append(document.createTextNode('Volume '), Object.assign(document.createElement('input'), { type: 'range', min: 20, max: 200, value: Math.round(t.gain * 100), oninput(e) { t.gain = e.target.value / 100; fixed = null; }, onchange() { drawComp(); } })); g.appendChild(lg);
      row.appendChild(g); box.appendChild(row);
    });
    const sel = $('segtake'); sel.replaceChildren(...takes.map((t) => Object.assign(document.createElement('option'), { value: t.id, textContent: t.name })));
  }
  function renderComp() {
    const b = $('segs'); b.replaceChildren(); if (!comp.length) { const tr = document.createElement('tr'), td = document.createElement('td'); td.colSpan = 4; td.textContent = 'Nothing chosen yet.'; tr.appendChild(td); b.appendChild(tr); return; }
    comp.forEach((sg) => { const t = takes.find((x) => x.id === sg.take), tr = document.createElement('tr'); [t ? t.name : '?', Q.fmt(sg.a), Q.fmt(sg.b)].forEach((x) => { const td = document.createElement('td'); td.textContent = x; tr.appendChild(td); }); const td = document.createElement('td'), d = document.createElement('button'); d.type = 'button'; d.className = 'btn mini'; d.textContent = 'Remove'; d.setAttribute('aria-label', 'Remove the part from ' + (t ? t.name : 'a take') + ' at ' + Q.fmt(sg.a)); d.onclick = () => { comp = comp.filter((x) => x !== sg); fixed = null; renderComp(); drawComp(); }; td.appendChild(d); tr.appendChild(td); b.appendChild(tr); });
  }
  function drawComp() {
    const cv = $('compcv'); if (!cv) return; const g = cv.getContext('2d'), W = cv.width, L = length(), rows = takes.length + 1, H = Math.max(60, rows * 54); cv.height = H; g.fillStyle = '#0d0e16'; g.fillRect(0, 0, W, H);
    const peaksOf = (arr, rate, off) => { const out = new Float32Array(W); const step = (arr.length / rate) / W * rate; for (let x = 0; x < W; x++) { const tt = x / W * L - off; if (tt < 0) continue; const a = Math.floor(tt * rate), b = Math.min(arr.length, Math.floor(a + Math.max(1, (L / W) * rate))); let m = 0; for (let i = a; i < b; i += Math.max(1, Math.floor((b - a) / 8))) m = Math.max(m, Math.abs(arr[i] || 0)); out[x] = m; } return out; };
    takes.forEach((t, r) => { const y0 = r * 54, pk = peaksOf(t.ch, t.rate, t.offset); g.fillStyle = '#ffffff10'; g.fillRect(0, y0 + 53, W, 1); g.fillStyle = '#4c4c70'; for (let x = 0; x < W; x++) { const h = Math.min(1, pk[x] * t.gain) * 24; g.fillRect(x, y0 + 27 - h, 1, Math.max(1, h * 2)); }
      comp.filter((sg) => sg.take === t.id).forEach((sg) => { g.fillStyle = '#8b5cf655'; g.fillRect(sg.a / L * W, y0, (sg.b - sg.a) / L * W, 53); g.strokeStyle = '#a78bfa'; g.strokeRect(sg.a / L * W, y0 + 0.5, (sg.b - sg.a) / L * W, 52); });
      g.fillStyle = '#c9c9e8'; g.font = '12px sans-serif'; g.fillText(t.name, 6, y0 + 14); });
    const cy = takes.length * 54; g.fillStyle = '#9a9ab8'; g.fillText('Your best take', 6, cy + 14); comp.forEach((sg) => { g.fillStyle = '#22d3ee'; g.fillRect(sg.a / L * W, cy + 22, (sg.b - sg.a) / L * W, 18); });
    if (drag) { g.fillStyle = '#22d3ee33'; g.fillRect(Math.min(drag.x0, drag.x1), drag.row * 54, Math.abs(drag.x1 - drag.x0), 53); }
  }
  let drag = null; const cx = (e) => { const cv = $('compcv'), r = cv.getBoundingClientRect(); return clamp((e.clientX - r.left) * (cv.width / r.width), 0, cv.width); };
  $('compcv').addEventListener('pointerdown', (e) => { const cv = $('compcv'), r = cv.getBoundingClientRect(), y = (e.clientY - r.top) * (cv.height / r.height), row = Math.floor(y / 54); if (row >= takes.length) return; cv.setPointerCapture(e.pointerId); drag = { row, x0: cx(e), x1: cx(e) }; });
  $('compcv').addEventListener('pointermove', (e) => { if (!drag) return; drag.x1 = cx(e); drawComp(); });
  $('compcv').addEventListener('pointerup', () => { if (!drag) return; const d = drag; drag = null; const W = $('compcv').width, L = length(), a = Math.min(d.x0, d.x1) / W * L, b = Math.max(d.x0, d.x1) / W * L; if (takes[d.row]) setSegment(takes[d.row].id, a, b); drawComp(); });
  $('segadd').onclick = () => { const id = +$('segtake').value, a = +$('sega').value || 0, b = +$('segb').value || 0; if (!takes.find((t) => t.id === id)) return say('Add a take first.'); if (b <= a) return say('The end must be later than the start.'); setSegment(id, a, b); };

  /* ---------- pitch ---------- */
  $('fixgo').onclick = async () => {
    if (busy || !comp.length) return say(comp.length ? 'Please wait.' : 'Choose the parts you like first.'); busy = true; $('fixgo').disabled = true;
    try { const rate = sr(), src = buildComp(rate), r = await pitchCorrect(src, rate, { root: +$('proot').value, scale: $('pscale').value, strength: +$('pstr').value / 100, onProgress: (x) => say('Listening to the notes… ' + Math.round(x * 100) + '%') }); fixed = r.out; $('usefix').checked = true; $('usefix').disabled = false; say(r.notes ? 'Found ' + r.notes + ' notes and corrected ' + r.fixed + '. Turn Use corrected pitch off to compare.' : 'No clear notes were found. Try a take with one voice and little noise.'); }
    catch (e) { say('Pitch correction failed: ' + e.message); } finally { busy = false; $('fixgo').disabled = false; }
  };
  /* ---------- save and send ---------- */
  async function final() { if (!takes.length || (!comp.length && !(fixed && $('usefix').checked))) { say('Choose the parts you like first.'); return null; } busy = true; say('Rendering…'); try { return await renderVocal($('bwith2').checked); } finally { busy = false; } }
  $('savewav').onclick = async () => { const r = await final(); if (!r) return; Q.save(Q.wav(r.chs, r.rate), 'vocal.wav'); say('Saved vocal.wav.'); };
  $('tostudio').onclick = async () => { const r = await final(); if (!r) return; try { await GVStore.put('studio-import', Q.wav(r.chs, r.rate)); location.href = 'studio.html?from=record'; } catch (e) { say('Could not hand it to the Studio: ' + e.message); } };
  $('preset').onchange = () => { const p = PRESETS[$('preset').value]; if (p) setParams(p); };
  document.querySelectorAll('#chain input[type=range]').forEach((i) => { const o = document.getElementById('o-' + i.id); i.addEventListener('input', () => { if (o) o.textContent = i.value; }); });
  ['p-hpf', 'p-pres', 'p-air', 'p-thr', 'p-ratio', 'p-mk', 'p-rev', 'p-size', 'p-dly', 'p-dt', 'p-dbl'].forEach((id) => $(id).addEventListener('change', () => { if ($('preset').value !== 'Custom') $('preset').value = 'Custom'; }));
  /* backing and files */
  async function loadFile(f, asBacking) { try { const b = await Q.decode(f); if (asBacking) { backing = b; $('bname').textContent = f.name; drawComp(); say('Backing track ready.'); } else { addTake(new Float32Array(b.getChannelData(0)), b.sampleRate, Q.clean(f.name), 0); say('Added ' + f.name + ' as a take.'); } } catch (e) { say('Could not read that file: ' + ((e && e.message) || 'unknown error')); } }
  $('addbacking').onclick = () => $('bfile').click(); $('bfile').onchange = () => { const f = $('bfile').files[0]; $('bfile').value = ''; if (f) loadFile(f, true); };
  $('addtake').onclick = () => $('tfile').click(); $('tfile').onchange = () => { const f = $('tfile').files[0]; $('tfile').value = ''; if (f) loadFile(f, false); };
  $('proot').replaceChildren(...P.NAMES.map((n, i) => Object.assign(document.createElement('option'), { value: i, textContent: n }))); $('pscale').replaceChildren(...Object.keys(SCALES).map((n) => Object.assign(document.createElement('option'), { value: n, textContent: n })));
  if (window.GVSession) GVSession.bind({ bpm: $('tempo'), root: $('proot'), minor: { el: $('pscale'), read: () => ($('pscale').value === 'Natural minor' ? true : $('pscale').value === 'Major' ? false : null), write: (m) => { $('pscale').value = m ? 'Natural minor' : 'Major'; } } });
  setParams(PRESETS.Natural); renderTakes(); renderComp(); drawComp(); window.addEventListener('pagehide', () => { stopPlay(); if (stream) stream.getTracks().forEach((t) => t.stop()); });
  if (/[?&]gvtest\b/.test(location.search)) window.__voc = { addTake, setSegment, buildComp, findNotes, pitchCorrect, renderVocal, chain, params, PRESETS, SCALES, get takes() { return takes; }, get comp() { return comp; }, get fixed() { return fixed; }, setBacking(b) { backing = b; } };
})();
