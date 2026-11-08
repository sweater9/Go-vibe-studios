/* GoVibeMix: rhythm trainer. A practice tool, not a game: it plays a click, you tap a rhythm on a key, the screen or a button, and it
   measures how early or late each tap was, how steady you are and whether your tempo drifts. No scores, no levels. Everything stays on this device. */
(() => {
  const $ = (id) => document.getElementById(id), Q = window.GVQuick, say = (t) => { $('status').textContent = t; };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  /* what you tap, as positions inside a bar in beats (for a bar of n beats) */
  const TAPS = {
    beat: (n) => Array.from({ length: n }, (_, i) => i), half: (n) => Array.from({ length: n }, (_, i) => i).filter((i) => i % 2 === 0), back: (n) => Array.from({ length: n }, (_, i) => i).filter((i) => i % 2 === 1),
    off: (n) => Array.from({ length: n }, (_, i) => i + 0.5), eighth: (n) => Array.from({ length: n * 2 }, (_, i) => i / 2), one: () => [0],
    triplet: (n) => Array.from({ length: n * 3 }, (_, i) => i / 3), sixteenth: (n) => Array.from({ length: n * 4 }, (_, i) => i / 4)
  };
  const LABEL = { beat: 'every beat', half: 'beats 1 and 3', back: 'the backbeat (2 and 4)', off: 'the off beats (the "and" of each beat)', eighth: 'eighth notes', one: 'beat 1 only', triplet: 'triplets', sixteenth: 'sixteenth notes' };
  /* times in seconds, counted from the first beat after the count in */
  function targets(o) { const spb = 60 / o.bpm, out = []; for (let b = 0; b < o.bars; b++) TAPS[o.tap](o.beats).forEach((p) => out.push((b * o.beats + p) * spb)); return out; }
  function clickBeats(o) { /* beats the click plays, as { t, strong } in seconds from the first beat, honouring the click setting */
    const spb = 60 / o.bpm, out = [];
    for (let b = 0; b < o.bars; b++) {
      const gap = o.mute === 'gaps' && Math.floor(b / 2) % 2 === 1; if (gap) continue;
      for (let i = 0; i < o.beats; i++) { if (o.click === 'one' && i) continue; if (o.click === 'none') continue; out.push({ t: (b * o.beats + i) * spb, strong: i === 0 }); }
    }
    return out;
  }
  /* match every tap to the nearest target within half the gap to its neighbours; returns per target error in ms (null = missed) and the extra taps */
  function match(tg, taps) {
    const used = new Set(), res = tg.map(() => null), extra = [];
    taps.slice().sort((a, b) => a - b).forEach((t) => {
      let bi = -1, bd = Infinity; tg.forEach((x, i) => { const d = Math.abs(t - x); if (d < bd) { bd = d; bi = i; } });
      if (bi < 0) return extra.push(t); const lo = bi > 0 ? (tg[bi] - tg[bi - 1]) / 2 : Infinity, hi = bi < tg.length - 1 ? (tg[bi + 1] - tg[bi]) / 2 : Infinity, win = Math.min(0.35, lo, hi);
      if (bd > win || used.has(bi)) return extra.push(t);
      used.add(bi); res[bi] = (t - tg[bi]) * 1000;
    });
    return { errors: res, extra: extra.length };
  }
  function stats(errors, extra) {
    const e = errors.filter((x) => x != null), n = e.length; if (!n) return null; const mean = e.reduce((a, b) => a + b, 0) / n, sd = Math.sqrt(e.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
    const within = (ms) => e.filter((x) => Math.abs(x) <= ms).length / errors.length;
    let slope = 0; { const xs = [], ys = []; errors.forEach((v, i) => { if (v != null) { xs.push(i); ys.push(v); } }); const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = mean; let nu = 0, de = 0; xs.forEach((x, i) => { nu += (x - mx) * (ys[i] - my); de += (x - mx) ** 2; }); slope = de ? nu / de * errors.length : 0; }
    return { n, total: errors.length, missed: errors.length - n, extra: extra || 0, mean, sd, w30: within(30), w60: within(60), drift: slope };
  }
  const f0 = (v) => Math.round(v);
  function advice(s, tapName) {
    if (!s) return ['No taps were matched to the pattern. Check that you are tapping ' + tapName + ' and try again.'];
    const out = [];
    if (Math.abs(s.mean) >= 8) out.push('You tend to play ' + f0(Math.abs(s.mean)) + ' ms ' + (s.mean < 0 ? 'ahead of' : 'behind') + ' the click. ' + (Math.abs(s.mean) > 60 ? 'That much is often device delay. Try Calibrate below.' : (s.mean < 0 ? 'Rushing a little is common. Try to wait for the click.' : 'Try to anticipate the click slightly.')));
    else out.push('Your average timing sits right on the click (' + (s.mean >= 0 ? '+' : '') + f0(s.mean) + ' ms).');
    out.push(s.sd <= 15 ? 'Your timing is very steady (spread of ' + f0(s.sd) + ' ms).' : s.sd <= 30 ? 'Your timing is fairly steady (spread of ' + f0(s.sd) + ' ms). It is the spread, not the average, that makes playing sound tight.' : 'Your taps vary quite a lot (spread of ' + f0(s.sd) + ' ms). Try a slower tempo until the spread comes down.');
    if (Math.abs(s.drift) >= 25) out.push('Your timing ' + (s.drift < 0 ? 'drifted ahead' : 'drifted behind') + ' by about ' + f0(Math.abs(s.drift)) + ' ms over the run, which means you gradually ' + (s.drift < 0 ? 'sped up' : 'slowed down') + '.');
    if (s.missed > s.total * 0.15) out.push('You missed ' + s.missed + ' of ' + s.total + ' notes. Slow the tempo down or tap a simpler pattern first.');
    if (s.extra > 2) out.push(s.extra + ' taps did not line up with the pattern.');
    return out;
  }

  /* ---------- playing ---------- */
  let ctx = null, running = null, last = null, latency = 0, calib = null;
  const AC = () => (ctx = ctx || Q.AC());
  const opts = () => ({ bpm: clamp(+$('bpm').value || 100, 40, 200), beats: clamp(+$('beats').value || 4, 2, 7), bars: +$('bars').value, tap: $('tap').value, click: $('click').value, mute: $('mute').value, count: clamp(+$('count').value, 1, 2) });
  function tick(t, strong) { const c = AC(), o = c.createOscillator(), g = c.createGain(); o.frequency.value = strong ? 1500 : 1000; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05); o.connect(g).connect(c.destination); o.start(t); o.stop(t + 0.06); return o; }
  async function begin(o, cal) {
    const c = AC(); if (c.state === 'suspended') await c.resume(); const spb = 60 / o.bpm, nCount = o.count * o.beats, t0 = c.currentTime + 0.3, first = t0 + nCount * spb, oscs = [];
    for (let i = 0; i < nCount; i++) oscs.push(tick(t0 + i * spb, i % o.beats === 0));
    const tg = cal ? Array.from({ length: 8 }, (_, i) => i * spb) : targets(o);
    (cal ? tg.map((t, i) => ({ t, strong: i % 4 === 0 })) : clickBeats(o)).forEach((b) => oscs.push(tick(first + b.t, b.strong)));
    const end = first + (cal ? 8 * spb : o.bars * o.beats * spb) + 0.6; running = { o, first, tg, taps: [], oscs, cal: !!cal, end };
    $('go').textContent = 'Stop'; $('tapbtn').disabled = false; $('tapbtn').focus(); say(cal ? 'Calibrating. Tap on every click for eight beats.' : 'Count in, then tap ' + LABEL[o.tap] + '.'); $('live').textContent = '';
    running.timer = setInterval(() => { if (c.currentTime > running.end) finish(); else if (c.currentTime < first) $('live').textContent = 'Count in…'; else $('live').textContent = 'Bar ' + (Math.floor((c.currentTime - first) / (spb * o.beats)) + 1) + ' of ' + (cal ? '–' : o.bars); }, 100);
  }
  function mapTime(ts) { const c = AC(); let o = null; try { o = c.getOutputTimestamp(); } catch (_) { /* old browser */ } if (o && o.performanceTime) return o.contextTime + (ts - o.performanceTime) / 1000; return c.currentTime - (performance.now() - ts) / 1000; }
  function tap(ts) {
    if (!running) return; const t = mapTime(ts == null ? performance.now() : ts) - running.first - latency / 1000; running.taps.push(t);
    const nearest = running.tg.reduce((b, x) => (Math.abs(x - t) < Math.abs(b - t) ? x : b), Infinity); const d = (t - nearest) * 1000; if (Math.abs(d) < 350) $('live').textContent = (d < 0 ? 'Early ' : 'Late ') + Math.abs(Math.round(d)) + ' ms'; $('tapbtn').classList.add('hit'); setTimeout(() => $('tapbtn').classList.remove('hit'), 80);
  }
  function stopAll() { if (!running) return; clearInterval(running.timer); running.oscs.forEach((o) => { try { o.stop(); } catch (_) { /* ended */ } }); }
  function finish() {
    const r = running; if (!r) return; stopAll(); running = null; $('go').textContent = 'Start'; $('tapbtn').disabled = true; const m = match(r.tg, r.taps), s = stats(m.errors, m.extra);
    if (r.cal) { if (s && s.n >= 4) { latency = Math.round(-s.mean + latency); latency = clamp(latency, -200, 300); $('lat').value = latency; $('latout').textContent = latency + ' ms'; say('Calibrated. Your taps are shifted by ' + latency + ' ms from now on.'); } else say('Too few taps to calibrate. Tap on every click and try again.'); return; }
    last = { m, s, o: r.o }; show(); say(s ? 'Done. Here is how it went.' : 'No taps were matched.');
  }
  $('go').onclick = () => { if (running) { stopAll(); running = null; $('go').textContent = 'Start'; $('tapbtn').disabled = true; $('live').textContent = ''; say('Stopped.'); } else begin(opts()); };
  $('calib').onclick = () => { if (running) return; const o = opts(); o.click = 'beat'; o.mute = 'always'; begin(o, true); };
  $('lat').oninput = () => { latency = +$('lat').value; $('latout').textContent = latency + ' ms'; };
  const down = (e) => { if (e.button != null && e.button > 0) return; e.preventDefault(); tap(e.timeStamp); };
  $('tapbtn').addEventListener('pointerdown', down);
  document.addEventListener('keydown', (e) => { if (!running || e.repeat) return; const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return; if (e.key === ' ' || e.key === 'Enter' || e.key.length === 1) { e.preventDefault(); tap(e.timeStamp); } });
  /* ---------- results ---------- */
  function show() {
    const { m, s, o } = last, box = $('res'); box.hidden = false; const tb = $('tbl'); tb.replaceChildren();
    const row = (a, b) => { const tr = document.createElement('tr'), th = document.createElement('th'), td = document.createElement('td'); th.scope = 'row'; th.textContent = a; td.textContent = b; tr.append(th, td); tb.appendChild(tr); };
    if (s) { row('Notes matched', s.n + ' of ' + s.total); row('Average timing', (s.mean >= 0 ? '+' : '') + f0(s.mean) + ' ms (' + (Math.abs(s.mean) < 8 ? 'on the click' : s.mean < 0 ? 'ahead' : 'behind') + ')'); row('Steadiness (spread)', f0(s.sd) + ' ms'); row('Within 30 ms', Math.round(s.w30 * 100) + '%'); row('Within 60 ms', Math.round(s.w60 * 100) + '%'); row('Drift over the run', (s.drift >= 0 ? '+' : '') + f0(s.drift) + ' ms'); row('Extra taps', String(s.extra)); }
    const ul = $('adv'); ul.replaceChildren(); advice(s, LABEL[o.tap]).forEach((t) => { const li = document.createElement('li'); li.textContent = t; ul.appendChild(li); }); draw(m.errors);
  }
  function draw(errs) {
    const cv = $('chart'), g = cv.getContext('2d'), W = cv.width, H = cv.height, mid = H / 2, R = 100, n = errs.length, bw = Math.max(2, Math.min(24, (W - 60) / n - 2));
    g.fillStyle = '#0d0e16'; g.fillRect(0, 0, W, H); g.font = '11px sans-serif'; g.fillStyle = '#9a9ab8'; g.fillText('late', 6, 14); g.fillText('early', 6, H - 6); g.fillStyle = '#ffffff12'; g.fillRect(40, mid - 30 / R * (mid - 16), W - 50, 60 / R * (mid - 16)); g.fillStyle = '#ffffff30'; g.fillRect(40, mid - 0.5, W - 50, 1);
    errs.forEach((v, i) => { const x = 46 + i * (W - 60) / n; if (v == null) { g.fillStyle = '#f87171'; g.fillRect(x, mid - 2, bw, 4); return; } const h = clamp(v, -R, R) / R * (mid - 16); g.fillStyle = Math.abs(v) <= 30 ? '#22d3ee' : Math.abs(v) <= 60 ? '#fbbf24' : '#fb7185'; if (h >= 0) g.fillRect(x, mid - h, bw, Math.max(1, h)); else g.fillRect(x, mid, bw, -h); });
  }
  if (window.GVSession) GVSession.bind({ bpm: $('bpm') });
  $('tapbtn').disabled = true; window.addEventListener('pagehide', () => { stopAll(); });
  if (/[?&]gvtest\b/.test(location.search)) window.__rhy = { targets, clickBeats, match, stats, advice, TAPS, tapNow: (t) => tap(t), get running() { return running; }, get last() { return last; }, setLatency(v) { latency = v; } };
})();
