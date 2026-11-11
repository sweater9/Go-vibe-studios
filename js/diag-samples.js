/* Step by step loader for the loop maker, to find what stops it on a phone. The log is kept in this browser only. */
(() => {
  const $ = (id) => document.getElementById(id), K = 'govibe.diag';
  const read = () => { try { return JSON.parse(localStorage.getItem(K)) || []; } catch (_) { return []; } };
  const save = (a) => { try { localStorage.setItem(K, JSON.stringify(a.slice(-40))); } catch (_) {} };
  let log = read(); const show = () => { $('log').textContent = log.join('\n') || 'Nothing yet.'; };
  const note = (t) => { log.push(t); save(log); show(); };
  const ua = navigator.userAgent.replace(/\s+/g, ' ');
  if (log.length && /^TRY /.test(log[log.length - 1])) { log.push('THE PAGE STOPPED during: ' + log[log.length - 1].slice(4)); save(log); }
  show();
  const script = (src) => () => new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = () => ok(); s.onerror = () => no(new Error('could not load ' + src)); document.body.appendChild(s); });
  const off = async (secs, build, extra) => { const oc = new OfflineAudioContext(2, Math.ceil(secs * 44100), 44100); build(oc, oc.destination); if (extra) await extra(oc); const t = performance.now(), r = await oc.startRendering(); return Math.round(performance.now() - t) + ' ms, ' + r.length + ' samples'; };
  const STEPS = [
    ['load store.js', script('js/store.js')], ['load synth.js', script('js/synth.js')], ['load theory.js', script('js/theory.js')], ['load fx.js', script('js/fx.js')],
    ['load studio-core.js', script('js/studio-core.js')], ['load session.js', script('js/session.js')], ['load samples.js (builds the page)', () => { try { history.replaceState(null, '', location.pathname + '?gvtest'); } catch (_) {} return script('js/samples.js')(); }],
    ['start the audio engine', async () => { const C = window.AudioContext || window.webkitAudioContext; window.__dctx = new C(); await window.__dctx.resume(); return 'state ' + window.__dctx.state + ', ' + window.__dctx.sampleRate + ' Hz'; }],
    ['render 1 second of silence offline', () => off(1, () => {})], 
    ['render a tone offline', () => off(1, (c, d) => { const o = c.createOscillator(), g = c.createGain(); g.gain.value = 0.1; o.connect(g).connect(d); o.start(0); o.stop(0.5); })],
    ['render with a limiter offline', () => off(1, (c, d) => { const l = c.createDynamicsCompressor(); l.threshold.value = -1.5; l.knee.value = 0; l.ratio.value = 20; l.connect(d); const o = c.createOscillator(); o.connect(l); o.start(0); o.stop(0.5); })],
    ['render noise and a filter offline', () => off(1, (c, d) => { const b = c.createBuffer(1, c.sampleRate, c.sampleRate), a = b.getChannelData(0); for (let k = 0; k < a.length; k++) a[k] = Math.random() * 2 - 1; const sr = c.createBufferSource(); sr.buffer = b; sr.loop = true; const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000; sr.connect(f).connect(d); sr.start(0); sr.stop(0.4); })],
    ['pause and resume the offline render once', () => off(2, (c, d) => { const o = c.createOscillator(); o.connect(d); o.start(0); o.stop(1.5); }, (c) => { c.suspend(0.5).then(() => c.resume()); })],
    ['pause and resume three times (10 s render)', () => off(10, (c, d) => { const o = c.createOscillator(); o.connect(d); o.start(0); o.stop(9); }, (c) => { [3.98, 7.98].forEach((t) => c.suspend(t).then(() => c.resume())); })],
    ['render a stereo panner offline', () => off(1, (c, d) => { const o = c.createOscillator(), pn = c.createStereoPanner(); pn.pan.value = 0.3; o.connect(pn).connect(d); o.start(0); o.stop(0.5); })],
    ['render a reverb (convolver) offline', () => off(2, (c, d) => { const len = Math.floor(1.2 * c.sampleRate), b = c.createBuffer(2, len, c.sampleRate); for (let ch = 0; ch < 2; ch++) { const a = b.getChannelData(ch); for (let k = 0; k < len; k++) a[k] = (Math.random() * 2 - 1) * Math.exp(-6.9 * k / len); } const cv = c.createConvolver(); cv.buffer = b; const o = c.createOscillator(), g = c.createGain(); g.gain.value = 0.1; o.connect(g).connect(cv).connect(d); o.start(0); o.stop(0.2); })],
    ['render a feedback delay offline', () => off(2, (c, d) => { const dl = c.createDelay(3), fb = c.createGain(), o = c.createOscillator(); dl.delayTime.value = 0.3; fb.gain.value = 0.35; o.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(d); o.start(0); o.stop(0.1); })],
    ['render an empty project with the loop maker engine', async () => { const C = window.GVStudioCore, pr = C.newProject('x'), t = performance.now(), r = await C.render(pr, {}, { from: 0, to: 1, rate: 44100, tail: 0.3 }); return Math.round(performance.now() - t) + ' ms, ' + r.length + ' samples'; }],
    ['make one drum loop with the loop maker code', async () => { const t = performance.now(), it = window.__sm; if (!it) throw new Error('debug hook missing'); const r = await it.render(it.CATALOG[0], it.params()); return Math.round(performance.now() - t) + ' ms, ' + r.buf.length + ' samples'; }],
    ['play a tone through the audio element', async () => { const c = window.__dctx, d = c.createMediaStreamDestination(), a = new Audio(); a.srcObject = d.stream; const o = c.createOscillator(), g = c.createGain(); g.gain.value = 0.05; o.connect(g); g.connect(d); o.start(); await a.play(); setTimeout(() => { o.stop(); a.pause(); }, 600); return 'playing'; }]
  ];
  let i = 0;
  $('now').textContent = 'Device: ' + ua;
  $('next').addEventListener('click', async () => {
    if (i >= STEPS.length) { $('now').textContent = 'All steps finished without a problem.'; return; }
    const [name, fn] = STEPS[i]; $('next').disabled = true; note('TRY ' + name);
    try {
      const r = await fn(); log.pop(); note('OK ' + name + (r ? ' => ' + r : '')); i++;
      $('now').textContent = i < STEPS.length ? 'Done. Next: ' + STEPS[i][0] : 'All steps finished without a problem.';
    } catch (e) { log.pop(); note('ERROR ' + name + ': ' + (e && e.message || e)); $('now').textContent = 'That step failed, see the log.'; }
    $('next').disabled = false;
  });
  $('reset').addEventListener('click', () => { log = []; save(log); i = 0; show(); $('now').textContent = 'Log cleared. Device: ' + ua; });
})();
