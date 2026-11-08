/* GoVibeMix: reference mix analyzer. Load your mix and a track you like, compare loudness, tone balance, stereo width and dynamics,
   read plain advice, and flip between the two at matched loudness. Everything is measured on this device. */
(() => {
  const $ = (id) => document.getElementById(id), Q = window.GVQuick;
  const say = (t) => { $('status').textContent = t; };
  const BANDS = [['Sub', 20, 60], ['Bass', 60, 150], ['Low mids', 150, 400], ['Mids', 400, 1000], ['Upper mids', 1000, 3000], ['Presence', 3000, 6000], ['Brilliance', 6000, 12000], ['Air', 12000, 20000]];
  const KEYS = ['mine', 'ref'], T = { mine: null, ref: null };
  let ctx = null, src = null, which = 'mine', playing = false, startedAt = 0, offset = 0, raf = 0;
  const getCtx = () => (ctx = ctx || Q.AC());
  const nap = () => new Promise((r) => setTimeout(r, 0));
  const db10 = (x) => 10 * Math.log10(Math.max(x, 1e-20)), db20 = (x) => 20 * Math.log10(Math.max(x, 1e-10));

  /* ---------- a small FFT ---------- */
  function fft(re, im) {
    const n = re.length; for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let len = 2; len <= n; len <<= 1) { const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a); for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) { const u = i + k, v = u + len / 2, xr = re[v] * cr - im[v] * ci, xi = re[v] * ci + im[v] * cr; re[v] = re[u] - xr; im[v] = im[u] - xi; re[u] += xr; im[u] += xi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } } }
  }
  /* ---------- measurements ---------- */
  async function bands(chans, rate) {
    const N = 4096, n = chans[0].length, mono = new Float32Array(n), nc = chans.length;
    for (let i = 0; i < n; i++) { let s = 0; for (let c = 0; c < nc; c++) s += chans[c][i]; mono[i] = s / nc; }
    const hop = Math.max(N, Math.floor((n - N) / 360)), win = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N)), acc = new Float64Array(BANDS.length), re = new Float64Array(N), im = new Float64Array(N);
    const edges = BANDS.map(([, lo, hi]) => [Math.max(1, Math.round(lo * N / rate)), Math.min(N / 2 - 1, Math.round(hi * N / rate))]); let frames = 0;
    for (let s = 0; s + N <= n; s += hop) {
      let e = 0; for (let i = 0; i < N; i++) { const v = mono[s + i]; e += v * v; } if (e / N < 1e-9) continue;   // skip silence
      for (let i = 0; i < N; i++) { re[i] = mono[s + i] * win[i]; im[i] = 0; } fft(re, im);
      edges.forEach(([a, b], k) => { let p = 0; for (let j = a; j <= b; j++) p += re[j] * re[j] + im[j] * im[j]; acc[k] += p; }); frames++;
      if (frames % 40 === 0) await nap();
    }
    const tot = acc.reduce((a, b) => a + b, 0) || 1e-20; return Array.from(acc, (p) => db10(p / tot));
  }
  function stereo(chans) {
    if (chans.length < 2) return { width: null, corr: null }; const L = chans[0], R = chans[1]; let m = 0, s = 0, ll = 0, rr = 0, lr = 0;
    for (let i = 0; i < L.length; i++) { const a = L[i], b = R[i], mm = (a + b) / 2, ss = (a - b) / 2; m += mm * mm; s += ss * ss; ll += a * a; rr += b * b; lr += a * b; }
    return { width: Math.max(-60, db10(s / (m || 1e-20))), corr: ll && rr ? lr / Math.sqrt(ll * rr) : 1 };
  }
  function levels(chans) { let pk = 0, sum = 0, n = 0; chans.forEach((c) => { for (let i = 0; i < c.length; i++) { const v = Math.abs(c[i]); if (v > pk) pk = v; sum += v * v; } n += c.length; }); const rms = db20(Math.sqrt(sum / Math.max(1, n))); return { peakDb: db20(pk), rmsDb: rms, crest: db20(pk) - rms }; }
  function call(msg) { return new Promise((res, rej) => { const w = new Worker('js/master-worker.js'); w.onmessage = (e) => { w.terminate(); e.data.error ? rej(new Error(e.data.error)) : res(e.data); }; w.onerror = (e) => { w.terminate(); rej(new Error(e.message || 'Worker failed')); }; w.postMessage(msg); }); }
  async function analyse(chans, rate, withLoud = true) {
    const out = { ...levels(chans), ...stereo(chans), bands: await bands(chans, rate) };
    if (withLoud) { const r = (await call({ op: 'analyze', chans: chans.map((c) => new Float32Array(c)), rate })).result; out.lufs = r.lufs; out.lra = r.lra; out.tp = r.truePeakDb; }
    return out;
  }
  /* ---------- advice ---------- */
  const f1 = (v) => (isFinite(v) ? v.toFixed(1) : '–');
  const FIX = { Sub: 'a gentle low shelf or high pass below 40 Hz', Bass: 'a wide cut or boost around 100 Hz', 'Low mids': 'a cut or boost around 250 Hz to clear or add body', Mids: 'a gentle move around 700 Hz', 'Upper mids': 'a move around 2 kHz, where voices and snares speak', Presence: 'a move around 4 kHz for clarity or to soften harshness', Brilliance: 'a high shelf around 8 kHz', Air: 'a soft high shelf above 12 kHz' };
  function advise(a, b) {
    const out = [], d = (x, y) => x - y;
    if (isFinite(a.lufs) && isFinite(b.lufs)) { const x = d(a.lufs, b.lufs); if (Math.abs(x) >= 1) out.push('Your mix is ' + f1(Math.abs(x)) + ' LU ' + (x < 0 ? 'quieter' : 'louder') + ' than the reference. ' + (x < 0 ? 'Raise the overall level or use a limiter, and mind the true peak.' : 'You have headroom to turn it down if it sounds squashed.')); }
    BANDS.map(([n, lo, hi], i) => ({ n, lo, hi, x: d(a.bands[i], b.bands[i]) })).filter((r) => Math.abs(r.x) >= 2.5).sort((p, q) => Math.abs(q.x) - Math.abs(p.x)).slice(0, 3).forEach((r) => out.push('Your ' + r.n.toLowerCase() + ' (' + (r.lo >= 1000 ? r.lo / 1000 + ' to ' + r.hi / 1000 + ' kHz' : r.lo + ' to ' + r.hi + ' Hz') + ') are ' + f1(Math.abs(r.x)) + ' dB ' + (r.x > 0 ? 'stronger' : 'weaker') + ' than the reference. Try ' + FIX[r.n] + (r.x > 0 ? ' to bring it down.' : ' to bring it up.')));
    if (a.width != null && b.width != null) { const x = d(a.width, b.width); if (Math.abs(x) >= 3) out.push('Your mix is ' + (x < 0 ? 'narrower' : 'wider') + ' than the reference by about ' + f1(Math.abs(x)) + ' dB of side level. ' + (x < 0 ? 'Widen pads, doubles or reverbs, and keep bass and vocals in the centre.' : 'Check it in mono. Very wide mixes can lose power on a phone speaker.')); }
    if (a.corr != null && a.corr < 0.2) out.push('The left and right channels of your mix are only weakly related (correlation ' + f1(a.corr) + '). Play it in mono to check nothing disappears.');
    { const x = d(a.crest, b.crest); if (Math.abs(x) >= 2) out.push('Your mix is ' + (x > 0 ? 'more dynamic' : 'more compressed') + ' than the reference (crest ' + f1(a.crest) + ' dB against ' + f1(b.crest) + ' dB). ' + (x > 0 ? 'More compression or limiting would make it feel denser.' : 'Back off the compression or limiting to let the hits breathe.')); }
    if (!out.length) out.push('Your mix is close to the reference on every measure. Trust your ears from here.');
    return out;
  }
  /* ---------- the page ---------- */
  function show() {
    const a = T.mine && T.mine.res, b = T.ref && T.ref.res; $('results').hidden = !(a && b); if (!(a && b)) return;
    const rows = [['Loudness (LUFS)', a.lufs, b.lufs], ['Loudness range (LU)', a.lra, b.lra], ['True peak (dBTP)', a.tp, b.tp], ['Crest factor (dB)', a.crest, b.crest], ['Stereo width (dB side to mid)', a.width, b.width], ['Channel correlation', a.corr, b.corr]]
      .concat(BANDS.map(([n, lo, hi], i) => ['Balance, ' + n.toLowerCase() + ' (' + (lo >= 1000 ? lo / 1000 + ' to ' + hi / 1000 + ' kHz' : lo + ' to ' + hi + ' Hz') + ')', a.bands[i], b.bands[i]]));
    const tb = $('rows'); tb.replaceChildren(); rows.forEach(([n, x, y]) => { const tr = document.createElement('tr'); const dv = x != null && y != null && isFinite(x) && isFinite(y) ? x - y : null; [n, x == null ? 'mono' : f1(x), y == null ? 'mono' : f1(y), dv == null ? '–' : (dv > 0 ? '+' : '') + f1(dv)].forEach((t, i) => { const c = document.createElement(i === 0 ? 'th' : 'td'); if (i === 0) c.scope = 'row'; c.textContent = t; tr.appendChild(c); }); tb.appendChild(tr); });
    const ul = $('advice'); ul.replaceChildren(); advise(a, b).forEach((t) => { const li = document.createElement('li'); li.textContent = t; ul.appendChild(li); }); draw(a, b);
  }
  function draw(a, b) {
    const cv = $('chart'), g = cv.getContext('2d'), W = cv.width, H = cv.height, P = 36, lo = -45, hi = -5, X = (i) => P + (W - P - 10) * i / (BANDS.length - 1), Y = (v) => 10 + (H - 40) * (1 - (Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo));
    g.fillStyle = '#0d0e16'; g.fillRect(0, 0, W, H); g.font = '11px sans-serif'; g.fillStyle = '#9a9ab8'; g.strokeStyle = '#ffffff18';
    for (let v = lo; v <= hi; v += 10) { g.beginPath(); g.moveTo(P, Y(v)); g.lineTo(W - 10, Y(v)); g.stroke(); g.fillText(v + '', 4, Y(v) + 4); } BANDS.forEach(([n], i) => g.fillText(n, X(i) - 16, H - 8));
    const line = (arr, col) => { g.strokeStyle = col; g.lineWidth = 3; g.beginPath(); arr.forEach((v, i) => (i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v)))); g.stroke(); g.fillStyle = col; arr.forEach((v, i) => { g.beginPath(); g.arc(X(i), Y(v), 4, 0, 7); g.fill(); }); };
    line(b.bands, '#fbbf24'); line(a.bands, '#22d3ee'); g.fillStyle = '#22d3ee'; g.fillText('Your mix', W - 150, 20); g.fillStyle = '#fbbf24'; g.fillText('Reference', W - 80, 20);
  }
  async function setTrack(k, chans, rate, name) {
    const buf = getCtx().createBuffer(chans.length, chans[0].length, rate); chans.forEach((c, i) => buf.copyToChannel(c, i)); stop(); T[k] = null; $(k + 'name').textContent = name + ' · analysing…'; say('Measuring ' + name + '…');
    try { const res = await analyse(chans, rate); T[k] = { buf, res, name }; $(k + 'name').textContent = name + ' · ' + Q.fmt(buf.duration) + (isFinite(res.lufs) ? ' · ' + f1(res.lufs) + ' LUFS' : ''); say(T.mine && T.ref ? 'Compared. See the results below.' : 'Now load the ' + (k === 'mine' ? 'reference track' : 'mix you want to check') + '.'); }
    catch (e) { $(k + 'name').textContent = ''; say('Could not measure that file: ' + e.message); }
    show(); controls();
  }
  async function loadFile(k, f) { try { say('Reading ' + f.name + '…'); const b = await Q.decode(f); if (b.duration > 600) return say('Please use a track under ten minutes.'); await setTrack(k, Array.from({ length: b.numberOfChannels }, (_, c) => new Float32Array(b.getChannelData(c))), b.sampleRate, Q.clean(f.name)); } catch (e) { say('Could not read that file.'); } }
  KEYS.forEach((k) => { Q.hook($(k + 'drop'), (f) => loadFile(k, f)); });
  /* ---------- A/B listening ---------- */
  const controls = () => { const both = T.mine && T.ref; ['play', 'hmine', 'href'].forEach((id) => { $(id).disabled = !both; }); $('hmine').setAttribute('aria-pressed', which === 'mine'); $('href').setAttribute('aria-pressed', which === 'ref'); };
  const gainFor = (k) => ($('match').checked && isFinite(T[k].res.lufs) ? Math.pow(10, (-18 - T[k].res.lufs) / 20) : 1);
  function start() { const c = getCtx(), t = T[which]; src = c.createBufferSource(); src.buffer = t.buf; const g = c.createGain(); g.gain.value = gainFor(which); src.connect(g).connect(c.destination); const off = Math.min(offset, t.buf.duration - 0.05); src.start(0, off); startedAt = c.currentTime - off; src.onended = () => { if (playing && src && src.buffer === t.buf && c.currentTime - startedAt >= t.buf.duration - 0.2) stop(true); }; playing = true; $('play').textContent = 'Stop'; tick(); }
  function stopSrc() { if (src) { try { src.onended = null; src.stop(); } catch (_) { /* done */ } src.disconnect(); src = null; } }
  function stop(end) { if (playing && !end) offset = Math.min(T[which].buf.duration, getCtx().currentTime - startedAt); if (end) offset = 0; stopSrc(); playing = false; $('play').textContent = 'Play'; cancelAnimationFrame(raf); }
  function tick() { if (!playing) return; $('clock').textContent = Q.fmt(getCtx().currentTime - startedAt); raf = requestAnimationFrame(tick); }
  $('play').onclick = async () => { if (playing) return stop(); const c = getCtx(); if (c.state === 'suspended') await c.resume(); start(); };
  const pick = (k) => { if (!T.mine || !T.ref || which === k) return; const was = playing; if (was) { offset = getCtx().currentTime - startedAt; stopSrc(); } which = k; controls(); if (was) start(); say('Listening to ' + (k === 'mine' ? 'your mix' : 'the reference') + (T[k] && $('match').checked ? ' at matched loudness.' : '.')); };
  $('hmine').onclick = () => pick('mine'); $('href').onclick = () => pick('ref'); $('match').onchange = () => { if (playing) { const o = getCtx().currentTime - startedAt; stopSrc(); offset = o; start(); } };
  controls();
  window.addEventListener('pagehide', () => { stop(); });
  if (/[?&]gvtest\b/.test(location.search)) window.__ref = { analyse, advise, setTrack, BANDS, get T() { return T; }, get which() { return which; } };
})();
