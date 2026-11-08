/* GoVibeMix — DJ edit planning: turns a track map (js/trackmap.js) into a list of source ranges to join, so a track can be made longer (loop the opening, repeat the drop, loop the outro)
   or shorter (trim a long intro and outro, drop the quietest 8 bar sections). Every cut lands on a bar line so the beat stays in time. Pure functions, no audio. */
window.GVEditPlan = (() => {
  const barsOf = (m) => (m && m.grid && m.bars && m.bars.length >= 16 ? m.bars.length : 0);
  const secs = (segs) => segs.reduce((s, x) => s + (x.b - x.a), 0);
  const fmtBars = (n) => n + ' bar' + (n === 1 ? '' : 's');
  /* o: { mode: 'extend', intro (extra bars), drop (extra repeats), outro (extra bars) } or { mode: 'shorten', keepIntro, keepOutro, max (seconds, 0 for none) }
     returns { segs: [{ a, b }] (source seconds, in order), len, notes: [text], fadeOut (seconds at the end, 0 for none) } or { error } */
  function plan(m, o) {
    const nb = barsOf(m); if (!nb) return { error: 'This track needs a clear steady beat. Try a track with a regular tempo.' };
    const per = m.beat * 4, t0 = m.t0, T = (k) => t0 + k * per, bar = (t) => Math.round((t - t0) / per), notes = []; let segs = [], fadeOut = 0;
    if (o.mode === 'shorten') {
      const startBar = Math.max(0, (m.introBars || 0) - (o.keepIntro || 8)), outBar = Math.min(nb, Math.max(startBar + 8, bar(m.outro))), endBar = Math.min(nb, outBar + (o.keepOutro || 8));
      if (startBar > 0) notes.push('Starts at bar ' + (startBar + 1) + ' (cuts ' + fmtBars(startBar) + ' of intro).');
      if (endBar < nb) { notes.push('Ends ' + fmtBars(endBar - outBar) + ' into the outro with a fade (cuts ' + fmtBars(nb - endBar) + ').'); fadeOut = Math.min(3, (endBar - outBar) * per * 0.5); }
      let cuts = [];                                                          // 8 bar blocks to remove, quietest first, away from the drop
      if (o.max > 0) {
        const dbar = m.drop != null ? bar(m.drop) : -99, blocks = []; for (let b = Math.ceil((startBar + 8) / 8) * 8; b + 8 <= endBar - 8; b += 8) { if (b + 8 > dbar && b < dbar + 16) continue; let s = 0; for (let k = b; k < b + 8; k++) s += m.bars[k] || 0; blocks.push({ b, e: s / 8 }); }
        blocks.sort((x, y) => x.e - y.e); let len = (endBar < nb ? T(endBar) : m.dur) - (startBar > 0 ? T(startBar) : 0);
        for (const k of blocks) { if (len <= o.max) break; cuts.push(k.b); len -= 8 * per; }
        cuts.sort((x, y) => x - y); if (cuts.length) notes.push('Removes ' + cuts.length + ' quiet 8 bar section' + (cuts.length === 1 ? '' : 's') + ' (at bar' + (cuts.length === 1 ? ' ' : 's ') + cuts.map((c) => c + 1).join(', ') + ') to get under ' + Math.floor(o.max / 60) + ':' + String(Math.round(o.max % 60)).padStart(2, '0') + '.');
      }
      let cur = startBar > 0 ? T(startBar) : 0; const end = endBar < nb ? T(endBar) : m.dur;
      cuts.forEach((c) => { segs.push({ a: cur, b: T(c) }); cur = T(c + 8); }); segs.push({ a: cur, b: end });
    } else {
      const ins = [];
      const ib = nb >= 24 ? 8 : 4; if (o.intro > 0) { ins.push({ at: ib, from: 0, len: ib, times: Math.ceil(o.intro / ib) }); notes.push('Loops the opening ' + fmtBars(ib) + ' ' + Math.ceil(o.intro / ib) + ' more time' + (Math.ceil(o.intro / ib) === 1 ? '' : 's') + '.'); }
      if (o.drop > 0 && m.drop != null) { const d = bar(m.drop), l = d + 16 <= nb ? 16 : 8; if (d + l <= nb) { ins.push({ at: d + l, from: d, len: l, times: o.drop }); notes.push('Repeats the drop (' + fmtBars(l) + ') ' + o.drop + ' more time' + (o.drop === 1 ? '' : 's') + '.'); } }
      else if (o.drop > 0) notes.push('No clear drop found, so nothing was repeated there.');
      if (o.outro > 0) { let ob = bar(m.outro); if (ob + 8 > nb) ob = nb - 8; ob = Math.max(0, ob); ins.push({ at: ob + 8, from: ob, len: 8, times: Math.ceil(o.outro / 8) }); notes.push('Loops the outro 8 bars ' + Math.ceil(o.outro / 8) + ' more time' + (Math.ceil(o.outro / 8) === 1 ? '' : 's') + '.'); }
      ins.sort((x, y) => x.at - y.at); let cur = 0;
      ins.forEach((n) => { if (T(n.at) > cur) segs.push({ a: cur, b: T(n.at) }); for (let i = 0; i < n.times; i++) segs.push({ a: T(n.from), b: T(n.from + n.len) }); cur = Math.max(cur, T(n.at)); });
      segs.push({ a: cur, b: m.dur });
    }
    segs = segs.filter((s) => s.b - s.a > 0.01);
    return { segs, len: secs(segs), notes: notes.length ? notes : ['Nothing to change with these settings.'], fadeOut };
  }
  /* copy the ranges into new arrays with a few milliseconds of fade at every join so nothing clicks */
  function render(chs, rate, p, fadeMs = 3) {
    const f = Math.max(1, Math.round(rate * fadeMs / 1000)), lens = p.segs.map((s) => Math.max(0, Math.min(chs[0].length, Math.round(s.b * rate)) - Math.round(s.a * rate))), total = lens.reduce((a, b) => a + b, 0);
    return chs.map((c) => {
      const out = new Float32Array(total); let at = 0;
      p.segs.forEach((s, i) => {
        const a = Math.round(s.a * rate), n = lens[i]; out.set(c.subarray(a, a + n), at);
        if (i > 0) for (let k = 0; k < Math.min(f, n); k++) out[at + k] *= k / f;
        if (i < p.segs.length - 1) for (let k = 0; k < Math.min(f, n); k++) out[at + n - 1 - k] *= k / f;
        at += n;
      });
      const fo = Math.round((p.fadeOut || 0) * rate); for (let k = 0; k < Math.min(fo, total); k++) out[total - 1 - k] *= k / fo;
      return out;
    });
  }
  return { plan, render, secs, barsOf };
})();
