/* Tempo converter: note lengths in ms and Hz for a BPM. Pure arithmetic, nothing leaves the browser. */
(() => {
  const $ = (id) => document.getElementById(id);
  const NOTES = [['1/1 (whole)', 1], ['1/2', 2], ['1/4', 4], ['1/8', 8], ['1/16', 16], ['1/32', 32], ['1/64', 64]];
  const fmt = (v) => String(parseFloat(v.toFixed(v >= 100 ? 1 : 2)));
  const clamp = (v) => Math.min(400, Math.max(20, v));
  const lengths = (bpm, n) => { const straight = 240000 / (bpm * n); return { straight, dotted: straight * 1.5, triplet: straight * 2 / 3 }; };
  function bpmNow() { const v = parseFloat($('bpm').value); return isFinite(v) && v > 0 ? clamp(v) : 120; }
  function render() {
    const bpm = bpmNow(), tb = $('rows'); tb.textContent = '';
    NOTES.forEach(([name, n]) => {
      const l = lengths(bpm, n), tr = document.createElement('tr');
      [name, fmt(l.straight), fmt(l.dotted), fmt(l.triplet), fmt(1000 / l.straight)].forEach((t, i) => { const c = document.createElement(i ? 'td' : 'th'); if (!i) c.scope = 'row'; c.textContent = t; tr.appendChild(c); });
      tb.appendChild(tr);
    });
    $('info').textContent = 'At ' + fmt(bpm) + ' BPM one beat lasts ' + fmt(60000 / bpm) + ' ms and one bar of 4/4 lasts ' + fmt(240000 / bpm) + ' ms.';
  }
  function setBpm(v) { $('bpm').value = String(Math.round(clamp(v) * 10) / 10); render(); }
  $('bpm').addEventListener('input', render);
  $('bpm').addEventListener('change', () => setBpm(bpmNow()));
  $('half').addEventListener('click', () => setBpm(bpmNow() / 2));
  $('double').addEventListener('click', () => setBpm(bpmNow() * 2));
  let taps = [];
  $('tap').addEventListener('click', () => {
    const t = performance.now();
    if (taps.length && t - taps[taps.length - 1] > 2000) taps = [];
    taps.push(t); taps = taps.slice(-8);
    if (taps.length >= 2) setBpm(60000 / ((taps[taps.length - 1] - taps[0]) / (taps.length - 1)));
  });
  $('copy').addEventListener('click', () => {
    const bpm = bpmNow(), lines = ['Note\tStraight ms\tDotted ms\tTriplet ms\tStraight Hz'];
    NOTES.forEach(([name, n]) => { const l = lengths(bpm, n); lines.push([name, fmt(l.straight), fmt(l.dotted), fmt(l.triplet), fmt(1000 / l.straight)].join('\t')); });
    const done = () => { $('info').textContent = 'Table copied.'; };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(lines.join('\n')).then(done, () => { $('info').textContent = 'Could not copy. Select the table and copy it by hand.'; });
    else $('info').textContent = 'Copying is not available here. Select the table and copy it by hand.';
  });
  window.__tempo = { lengths, fmt };
  render();
})();
