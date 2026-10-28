/* GoVibe Mix — mix planning: harmonic and tempo ordering of a queue, and a beatmatched timeline with bass swap crossfades. Pure functions, no audio objects, so they can be tested exactly. */
window.GVMixPlan = (() => {
  /* ---------- ordering ---------- */
  function keyCost(a, b) { // Camelot wheel distance, 0 is the best match
    if (!a || !b) return 2.5;
    const na = +a.slice(0, -1), nb = +b.slice(0, -1), la = a.slice(-1), lb = b.slice(-1), d = Math.min((na - nb + 12) % 12, (nb - na + 12) % 12);
    if (la === lb) return [0, 1, 3, 5, 6, 7, 8][d];
    return d === 0 ? 1 : d === 1 ? 3 : 4 + d;
  }
  function tempoGap(a, b) { // BPM apart, allowing for half and double time
    if (!a || !b) return 4;
    return Math.min(Math.abs(a - b), Math.abs(a - 2 * b), Math.abs(2 * a - b));
  }
  const stepCost = (x, y) => keyCost(x.key, y.key) + 0.35 * tempoGap(x.bpm, y.bpm);
  function pathCost(items, order) { let c = 0; for (let i = 1; i < order.length; i++) c += stepCost(items[order[i - 1]], items[order[i]]); return c; }
  /* startBy: 'first' keeps the first track first, 'lowest' starts at the slowest track */
  function order(items, startBy = 'first') {
    const n = items.length; if (n < 3) return items.map((_, i) => i);
    let start = 0; if (startBy === 'lowest') { let best = Infinity; items.forEach((t, i) => { const b = t.bpm || 999; if (b < best) { best = b; start = i; } }); }
    const left = new Set(items.map((_, i) => i)); left.delete(start); const path = [start];
    while (left.size) { let bi = -1, bc = Infinity; for (const j of left) { const c = stepCost(items[path[path.length - 1]], items[j]); if (c < bc) { bc = c; bi = j; } } path.push(bi); left.delete(bi); }
    // improve with 2-opt (the first track stays put)
    let improved = true, guard = 0;
    while (improved && guard++ < 50) {
      improved = false;
      for (let i = 1; i < n - 1; i++) for (let j = i + 1; j < n; j++) {
        const cand = path.slice(0, i).concat(path.slice(i, j + 1).reverse(), path.slice(j + 1));
        if (pathCost(items, cand) < pathCost(items, path) - 1e-9) { path.splice(0, n, ...cand); improved = true; }
      }
    }
    return path;
  }

  /* ---------- timeline ---------- */
  const smooth = (x, a, b) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  function effBpm(bpm, target) { // treat a track as double or half time when that is closer to the target
    let best = bpm, d = Math.abs(bpm / target - 1);
    for (const c of [bpm * 2, bpm / 2]) { const e = Math.abs(c / target - 1); if (e < d - 1e-9) { d = e; best = c; } }
    return best;
  }
  /* tracks: [{ name, duration, bpm, grid:{t0,period}|null, key }]
     opts: { target: number | 'avg' | 'first', beats: 8|16|32, tail: seconds kept at the end of a track before it is fully out } */
  function plan(tracks, opts = {}) {
    if (!tracks.length) return null;
    const known = tracks.filter((t) => t.bpm), sorted = known.map((t) => t.bpm).sort((a, b) => a - b), med = sorted.length ? sorted[sorted.length >> 1] : 120;
    const avg = known.length ? known.reduce((a, t) => a + effBpm(t.bpm, med), 0) / known.length : 120; // half and double time tracks are folded in first
    let target = typeof opts.target === 'number' ? opts.target : opts.target === 'first' && tracks[0].bpm ? tracks[0].bpm : avg;
    target = Math.max(60, Math.min(200, target));
    const beats = opts.beats || 16, tail = opts.tail == null ? 1 : opts.tail, spb = 60 / target;
    const items = tracks.map((t) => {
      const synced = !!(t.bpm && t.grid), c = synced ? effBpm(t.bpm, target) : target, per = 60 / c, r = target / c;
      let g = synced ? ((t.grid.t0 % per) + per) % per : 0;
      return { name: t.name, key: t.key, bpm: t.bpm, played: c, rate: r, per, g, dur: t.duration, synced, srcStart: g, start: 0, end: 0, fadeIn: null, fadeOut: null };
    });
    items[0].start = 0;
    for (let j = 0; j < items.length - 1; j++) {
      const a = items[j], b = items[j + 1];
      let F = beats * spb;
      F = Math.min(F, 0.35 * (b.dur - b.srcStart) / b.rate, 0.6 * (a.dur - a.srcStart) / a.rate);
      F = Math.max(1, F);
      // latest beat (a whole bar from where this track began) where the fade can start and still end before the tail
      const room = a.dur - tail - F * a.rate - a.srcStart; let k = Math.max(0, Math.floor(room / a.per));
      const bar = k - (k % 4); if (bar >= 4 && a.synced) k = bar;
      const kmin = a.fadeIn ? Math.ceil((a.fadeIn.t1 - a.fadeIn.t0) * a.rate / a.per) : 0; k = Math.max(kmin, k); // this track must be fully in before it starts to fade out
      const p = a.srcStart + k * a.per, Tb = a.start + (p - a.srcStart) / a.rate;
      F = Math.max(0.5, Math.min(F, (a.dur - p) / a.rate));
      a.fadeOut = { t0: Tb, t1: Tb + F }; a.end = Tb + F; b.start = Tb; b.fadeIn = { t0: Tb, t1: Tb + F };
    }
    const last = items[items.length - 1]; last.end = last.start + (last.dur - last.srcStart) / last.rate; const lf = Math.min(3, (last.end - last.start) * 0.2); last.fadeOut = { t0: last.end - lf, t1: last.end, final: true };
    return { target, items, total: last.end, beats, spb };
  }
  /* gain curves for one item at output time t */
  function gains(it, t) {
    let g = 1, low = 0;
    if (it.fadeIn) { const x = Math.min(1, Math.max(0, (t - it.fadeIn.t0) / (it.fadeIn.t1 - it.fadeIn.t0))); g *= Math.sin(x * Math.PI / 2); low = -26 * (1 - smooth(x, 0.1, 0.5)); }
    if (it.fadeOut) { const x = Math.min(1, Math.max(0, (t - it.fadeOut.t0) / (it.fadeOut.t1 - it.fadeOut.t0))); g *= it.fadeOut.final ? 1 - x : Math.cos(x * Math.PI / 2); if (!it.fadeOut.final) low = Math.min(low, -26 * smooth(x, 0.35, 0.7)); }
    return { g, low };
  }
  const stamp = (s) => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : String(m).padStart(2, '0')) + ':' + String(x).padStart(2, '0'); };
  const cleanName = (n) => n.replace(/\.[a-z0-9]{2,4}$/i, '').replace(/_/g, ' ').trim();
  function tracklist(p) { return p.items.map((it, i) => stamp(i === 0 ? 0 : it.start) + '  ' + cleanName(it.name) + (it.bpm ? '  (' + Math.round(it.bpm) + ' BPM' + (it.key ? ', ' + it.key : '') + ')' : it.key ? '  (' + it.key + ')' : '')).join('\n'); }
  return { keyCost, tempoGap, order, pathCost, plan, gains, effBpm, stamp, tracklist, cleanName };
})();
