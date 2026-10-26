/* Go Vibe Studios — rotary knobs built on top of real <input type=range> (keyboard + screen-reader friendly).
   The input stays the source of truth; the knob is drawn from it and writes back to it. */
window.GVKnobs = (() => {
  const all = [];
  const NS = 'http://www.w3.org/2000/svg';
  const pt = (a, r) => { const t = (a - 90) * Math.PI / 180; return [24 + r * Math.cos(t), 24 + r * Math.sin(t)]; };
  const arc = (a0, a1, r) => { if (Math.abs(a1 - a0) < 0.5) return ''; const [x0, y0] = pt(a0, r), [x1, y1] = pt(a1, r); return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${Math.abs(a1 - a0) > 180 ? 1 : 0} ${a1 > a0 ? 1 : 0} ${x1.toFixed(2)} ${y1.toFixed(2)}`; };
  function upgrade(inp) {
    if (inp.dataset.knobDone) return; inp.dataset.knobDone = '1';
    const bip = inp.hasAttribute('data-bipolar'), lo = () => +inp.min, hi = () => +inp.max, def = inp.defaultValue;
    inp.classList.add('knobin');
    const k = document.createElement('span'); k.className = 'knob'; k.setAttribute('aria-hidden', 'true');
    k.innerHTML = `<svg viewBox="0 0 48 48"><path class="ktrack"/><path class="kval"/></svg><span class="kcap"><i></i></span>`;
    inp.after(k);
    const track = k.querySelector('.ktrack'), val = k.querySelector('.kval'), cap = k.querySelector('.kcap');
    track.setAttribute('d', arc(-135, 135, 20));
    const rec = { inp, last: null };
    const paint = () => {
      const f = (+inp.value - lo()) / (hi() - lo()), a = -135 + f * 270;
      val.setAttribute('d', bip ? arc(0, a, 20) : arc(-135, a, 20));
      cap.style.transform = `rotate(${a}deg)`; rec.last = inp.value;
      k.parentElement && k.parentElement.setAttribute('data-v', inp.value);
    };
    rec.paint = paint; all.push(rec);
    inp.addEventListener('input', paint);
    const set = (v) => { const step = +inp.step || 1; v = Math.max(lo(), Math.min(hi(), Math.round(v / step) * step)); if (String(v) !== inp.value) { inp.value = v; inp.dispatchEvent(new Event('input', { bubbles: true })); } };
    let y0 = 0, v0 = 0, drag = false;
    k.addEventListener('pointerdown', (e) => { e.preventDefault(); drag = true; y0 = e.clientY; v0 = +inp.value; k.setPointerCapture(e.pointerId); k.classList.add('drag'); inp.focus({ preventScroll: true }); });
    k.addEventListener('pointermove', (e) => { if (!drag) return; const range = hi() - lo(), px = e.shiftKey ? 700 : 170; set(v0 + (y0 - e.clientY) / px * range); });
    const end = () => { drag = false; k.classList.remove('drag'); };
    k.addEventListener('pointerup', end); k.addEventListener('pointercancel', end);
    k.addEventListener('dblclick', () => set(+def));
    k.addEventListener('wheel', (e) => { e.preventDefault(); set(+inp.value - Math.sign(e.deltaY) * (hi() - lo()) / 40); }, { passive: false });
    paint();
  }
  const upgradeAll = (root) => root.querySelectorAll('input[data-knob]').forEach(upgrade);
  const refresh = () => { for (const r of all) if (r.inp.value !== r.last) r.paint(); };   // picks up programmatic changes (MIDI, automix, tests)
  document.addEventListener('DOMContentLoaded', () => upgradeAll(document));
  if (document.readyState !== 'loading') upgradeAll(document);
  return { upgrade, upgradeAll, refresh };
})();
