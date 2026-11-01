/* GoVibe Mix: audio repair. Finds and removes clicks and pops, mains hum (50 or 60 Hz and its harmonics), clipped peaks and DC offset.
   Everything runs on this device. The repairs are signal processing, not AI, so a report says what was found before anything changes. */
(() => {
  const $ = (id) => document.getElementById(id), Q = window.GVQuick, say = (t) => { $('status').textContent = t; };
  const nap = () => new Promise((r) => setTimeout(r, 0)), db = (x) => 10 * Math.log10(Math.max(x, 1e-20));
  let ctx = null, orig = null, fixed = null, name = 'audio', rate = 44100, src = null, which = 'orig', playing = false, startedAt = 0, offset = 0, raf = 0, found = null;
  const AC = () => (ctx = ctx || Q.AC());

  /* ---------- clicks and pops ---------- */
  /* an impulse shows up as a large second difference compared with the local level. Returns regions [a, b] (inclusive) of 1 to 48 samples. */
  function findClicks(x, k) {
    const n = x.length, e = new Float32Array(n), B = 512, scale = new Float32Array(Math.ceil(n / B) + 1);
    for (let i = 1; i < n - 1; i++) e[i] = x[i] - (x[i - 1] + x[i + 1]) / 2;
    for (let b = 0; b * B < n; b++) { let s = 0, c = 0; for (let i = b * B; i < Math.min(n, (b + 1) * B); i++) { s += Math.abs(e[i]); c++; } scale[b] = s / Math.max(1, c); }
    const loc = (i) => { const b = Math.floor(i / B); return Math.max(scale[b], scale[Math.max(0, b - 1)] * 0.7, scale[b + 1] ? scale[b + 1] * 0.7 : 0, 0.002); };
    const out = []; let cur = null;
    for (let i = 1; i < n - 1; i++) {
      if (Math.abs(e[i]) > k * loc(i) && Math.abs(e[i]) > 0.03) { if (cur && i - cur.b <= 3) cur.b = i; else { if (cur) out.push(cur); cur = { a: i, b: i }; } }
    }
    if (cur) out.push(cur);
    return out.map((r) => ({ a: Math.max(1, r.a - 2), b: Math.min(n - 2, r.b + 2) })).filter((r) => r.b - r.a + 1 <= 48);
  }
  const hermite = (x, a, b, m0, m1) => { /* rebuild x[a..b] from the samples on each side with a cubic curve */
    const p0 = x[a - 1], p1 = x[b + 1], L = b - a + 2;
    for (let i = a; i <= b; i++) { const t = (i - a + 1) / L, t2 = t * t, t3 = t2 * t; x[i] = (2 * t3 - 3 * t2 + 1) * p0 + (t3 - 2 * t2 + t) * L * m0 + (-2 * t3 + 3 * t2) * p1 + (t3 - t2) * L * m1; }
  };
  function declick(x, regions) { regions.forEach((r) => { const a = r.a, b = r.b; const m0 = a >= 2 ? x[a - 1] - x[a - 2] : 0, m1 = b + 2 < x.length ? x[b + 2] - x[b + 1] : 0; hermite(x, a, b, m0, m1); }); return regions.length; }

  /* ---------- hum ---------- */
  function goertzel(x, from, len, f, fs) { const w = 2 * Math.PI * f / fs, c = 2 * Math.cos(w); let s1 = 0, s2 = 0; for (let i = from; i < from + len; i++) { const s = x[i] + c * s1 - s2; s2 = s1; s1 = s; } return (s1 * s1 + s2 * s2 - c * s1 * s2) / (len * len) * 4; }
  function findHum(x, fs) {
    const len = Math.min(x.length, Math.round(fs * 12)), from = Math.max(0, Math.floor((x.length - len) / 2)), res = {};
    [50, 60].forEach((f0) => {
      let score = 0, hits = 0; const h = [];
      for (let k = 1; k <= 6; k++) { const f = f0 * k; if (f > fs * 0.4) break; const p = goertzel(x, from, len, f, fs), nb = (goertzel(x, from, len, f - 6.5, fs) + goertzel(x, from, len, f + 6.5, fs) + goertzel(x, from, len, f - 11, fs) + goertzel(x, from, len, f + 11, fs)) / 4, d = db(p) - db(nb); h.push({ f, d }); if (d >= 12 && p > 1e-7) { hits++; score += d; } }
      res[f0] = { hits, score, h };
    });
    const best = res[50].score >= res[60].score ? 50 : 60, r = res[best], fund = r.h[0] ? r.h[0].d : 0;
    return { hz: (r.hits >= 2 || (r.hits >= 1 && fund >= 18)) ? best : 0, hits: r.hits, strength: r.score / Math.max(1, r.hits), detail: res };
  }
  function notch(x, f, fs, Q0) { /* RBJ notch biquad, run forward in place */
    const w = 2 * Math.PI * f / fs, al = Math.sin(w) / (2 * Q0), c = Math.cos(w), a0 = 1 + al, b0 = 1 / a0, b1 = -2 * c / a0, b2 = 1 / a0, a1 = -2 * c / a0, a2 = (1 - al) / a0;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0; for (let i = 0; i < x.length; i++) { const v = x[i], y = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = v; y2 = y1; y1 = y; x[i] = y; }
  }
  function dehum(x, fs, hz) { let n = 0; for (let k = 1; k <= 8; k++) { const f = hz * k; if (f > fs * 0.45 || f > 1500) break; notch(x, f, fs, 35); n++; } return n; }

  /* ---------- clipping ---------- */
  function findClips(x) {
    let pk = 0; for (let i = 0; i < x.length; i++) { const v = Math.abs(x[i]); if (v > pk) pk = v; }
    if (pk < 0.3) return { pk, runs: [] }; const thr = pk * 0.985, runs = []; let i = 0;
    while (i < x.length) { if (Math.abs(x[i]) >= thr) { const s = Math.sign(x[i]); let j = i; while (j + 1 < x.length && x[j + 1] * s >= thr) j++; if (j - i + 1 >= 3 && j - i + 1 <= 200 && i >= 2 && j < x.length - 3) runs.push({ a: i, b: j }); i = j + 1; } else i++; }
    return { pk, runs };
  }
  function declip(x, runs) {
    runs.forEach((r) => { const a = r.a, b = r.b, m0 = x[a - 1] - x[a - 2], m1 = x[b + 2] - x[b + 1]; hermite(x, a, b, m0, m1); });
    let pk = 0; for (let i = 0; i < x.length; i++) { const v = Math.abs(x[i]); if (v > pk) pk = v; } return pk;
  }
  const dc = (x) => { let s = 0; for (let i = 0; i < x.length; i++) s += x[i]; return s / Math.max(1, x.length); };

  /* ---------- analysis and repair of a whole file ---------- */
  async function analyse(chs, fs, opt) {
    opt = opt || {}; const k = opt.k || 9, r = { clicks: 0, clickRegions: [], hum: null, clips: 0, clipPeak: 0, dc: 0 };
    for (let c = 0; c < chs.length; c++) { const reg = findClicks(chs[c], k); r.clickRegions.push(reg); r.clicks += reg.length; await nap(); }
    const mono = chs[0]; r.hum = findHum(mono, fs); await nap();
    r.clipRuns = chs.map((c) => findClips(c)); r.clips = r.clipRuns.reduce((s, x) => s + x.runs.length, 0); r.clipPeak = Math.max(...r.clipRuns.map((x) => x.pk)); await nap();
    r.dc = Math.max(...chs.map((c) => Math.abs(dc(c)))); return r;
  }
  async function repair(chs, fs, f, o) {
    const out = chs.map((c) => new Float32Array(c)), log = [];
    if (o.dc && f.dc > 0.002) { out.forEach((x) => { const m = dc(x); for (let i = 0; i < x.length; i++) x[i] -= m; }); log.push('Removed a DC offset of ' + f.dc.toFixed(3) + '.'); await nap(); }
    if (o.clicks && f.clicks) { let n = 0; out.forEach((x, c) => { n += declick(x, f.clickRegions[c]); }); log.push('Repaired ' + n + ' click' + (n === 1 ? '' : 's') + ' and pops.'); await nap(); }
    if (o.hum && o.hum > 0) { let n = 0; out.forEach((x) => { n = dehum(x, fs, o.hum); }); log.push('Removed ' + o.hum + ' Hz hum and ' + (n - 1) + ' harmonics.'); await nap(); }
    if (o.clip && f.clips) { let pk = 0, n = 0; out.forEach((x, c) => { const runs = findClips(x).runs; n += runs.length; pk = Math.max(pk, declip(x, runs)); }); let g = 1; if (pk > 0.97) { g = 0.97 / pk; out.forEach((x) => { for (let i = 0; i < x.length; i++) x[i] *= g; }); } log.push('Rebuilt ' + n + ' clipped peak' + (n === 1 ? '' : 's') + (g < 1 ? ' and lowered the level by ' + (-20 * Math.log10(g)).toFixed(1) + ' dB so they fit.' : '.')); await nap(); }
    if (!log.length) log.push('Nothing was changed.'); return { chs: out, log };
  }

  /* ---------- the page ---------- */
  const row = (a, b) => { const tr = document.createElement('tr'), th = document.createElement('th'), td = document.createElement('td'); th.scope = 'row'; th.textContent = a; td.textContent = b; tr.append(th, td); return tr; };
  function report(f) {
    const tb = $('found'); tb.replaceChildren();
    tb.appendChild(row('Clicks and pops', f.clicks ? f.clicks + ' found' : 'none found'));
    tb.appendChild(row('Mains hum', f.hum.hz ? f.hum.hz + ' Hz, about ' + f.hum.strength.toFixed(0) + ' dB above its surroundings' : 'none found'));
    tb.appendChild(row('Clipped peaks', f.clips ? f.clips + ' found (peak level ' + f.clipPeak.toFixed(2) + ')' : 'none found'));
    tb.appendChild(row('DC offset', f.dc > 0.002 ? f.dc.toFixed(3) + ' (the signal sits off centre)' : 'none'));
    $('ck-clicks').checked = f.clicks > 0; $('ck-hum').checked = !!f.hum.hz; $('ck-clip').checked = f.clips > 0; $('ck-dc').checked = f.dc > 0.002; $('humhz').value = f.hum.hz ? String(f.hum.hz) : '50';
    $('results').hidden = false; $('fix').disabled = false;
  }
  async function load(f) {
    try {
      say('Reading ' + f.name + '…'); const b = await Q.decode(f); if (b.duration > 600) return say('Please use a file under ten minutes.');
      stop(); orig = { chs: Array.from({ length: Math.min(2, b.numberOfChannels) }, (_, i) => new Float32Array(b.getChannelData(i))), rate: b.sampleRate }; rate = b.sampleRate; name = Q.clean(f.name); fixed = null; $('fname').textContent = f.name + ' · ' + Q.fmt(b.duration);
      $('after').hidden = true; $('fixlog').replaceChildren(); say('Listening for problems…'); found = await analyse(orig.chs, rate, { k: +$('sens').value }); report(found); say('Check the findings, then press Repair.'); controls();
    } catch (e) { say('Could not read that file: ' + ((e && e.message) || 'unknown error')); }
  }
  Q.hook($('drop'), load);
  $('sens').onchange = async () => { if (!orig) return; found = await analyse(orig.chs, rate, { k: +$('sens').value }); report(found); };
  $('fix').onclick = async () => {
    if (!orig || !found) return; $('fix').disabled = true; say('Repairing…');
    try { const r = await repair(orig.chs, rate, found, { dc: $('ck-dc').checked, clicks: $('ck-clicks').checked, hum: $('ck-hum').checked ? +$('humhz').value : 0, clip: $('ck-clip').checked }); fixed = { chs: r.chs, rate }; const ul = $('fixlog'); ul.replaceChildren(); r.log.forEach((t) => { const li = document.createElement('li'); li.textContent = t; ul.appendChild(li); }); $('after').hidden = false; say('Done. Compare the original and the repaired version below.'); controls(); }
    catch (e) { say('Repair failed: ' + e.message); } finally { $('fix').disabled = false; }
  };
  /* A/B */
  const cur = () => (which === 'fixed' && fixed ? fixed : orig);
  function controls() { const ok = !!orig; $('play').disabled = !ok; $('horig').disabled = !ok; $('hfix').disabled = !fixed; $('horig').setAttribute('aria-pressed', which === 'orig'); $('hfix').setAttribute('aria-pressed', which === 'fixed'); $('savewav').disabled = !fixed; $('toeditor').disabled = !fixed; }
  function start() { const c = AC(), t = cur(), b = c.createBuffer(t.chs.length, t.chs[0].length, t.rate); t.chs.forEach((x, i) => b.copyToChannel(x, i)); src = c.createBufferSource(); src.buffer = b; src.connect(c.destination); src.onended = () => { if (playing) stop(true); }; src.start(0, offset); startedAt = c.currentTime - offset; playing = true; $('play').textContent = 'Stop'; tick(); }
  function stopSrc() { if (src) { try { src.onended = null; src.stop(); } catch (_) { /* done */ } src.disconnect(); src = null; } }
  function stop(end) { if (playing && !end && ctx) offset = ctx.currentTime - startedAt; if (end) offset = 0; stopSrc(); playing = false; cancelAnimationFrame(raf); $('play').textContent = 'Play'; }
  const tick = () => { if (!playing) return; $('clock').textContent = Q.fmt(ctx.currentTime - startedAt); raf = requestAnimationFrame(tick); };
  $('play').onclick = async () => { if (playing) return stop(); const c = AC(); if (c.state === 'suspended') await c.resume(); start(); };
  const pick = (k) => { if (which === k || (k === 'fixed' && !fixed)) return; const was = playing; if (was) { offset = ctx.currentTime - startedAt; stopSrc(); } which = k; controls(); if (was) start(); };
  $('horig').onclick = () => pick('orig'); $('hfix').onclick = () => pick('fixed');
  const blob = () => Q.wav(fixed.chs, fixed.rate);
  $('savewav').onclick = () => { Q.save(blob(), name + ' repaired.wav'); say('Saved ' + name + ' repaired.wav.'); };
  $('toeditor').onclick = async () => { try { await GVStore.put('handoff', blob()); location.href = 'editor.html?from=audio&name=' + encodeURIComponent(name + ' repaired'); } catch (e) { say('Could not hand it to the editor. Save the file instead.'); } };
  controls(); window.addEventListener('pagehide', () => stop());
  if (/[?&]gvtest\b/.test(location.search)) window.__rep = { findClicks, declick, findHum, dehum, findClips, declip, analyse, repair, load, goertzel, get fixed() { return fixed; }, get found() { return found; }, setSource(chs, r) { orig = { chs, rate: r }; rate = r; fixed = null; controls(); } };
})();
