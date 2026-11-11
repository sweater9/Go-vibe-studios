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
  const STEPS = [
    ['load store.js', script('js/store.js')], ['load synth.js', script('js/synth.js')], ['load theory.js', script('js/theory.js')], ['load fx.js', script('js/fx.js')],
    ['load studio-core.js', script('js/studio-core.js')], ['load session.js', script('js/session.js')], ['load samples.js (builds the page)', script('js/samples.js')],
    ['start the audio engine', async () => { const C = window.AudioContext || window.webkitAudioContext; window.__dctx = new C(); await window.__dctx.resume(); return 'state ' + window.__dctx.state + ', ' + window.__dctx.sampleRate + ' Hz'; }],
    ['make one drum loop (offline render)', async () => { const t = performance.now(), it = window.__sm; if (!it) throw new Error('debug hook missing'); const r = await it.render(it.CATALOG[0], it.params()); return Math.round(performance.now() - t) + ' ms, ' + r.buf.length + ' samples'; }],
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
