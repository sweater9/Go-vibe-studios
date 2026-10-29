/* GoVibe Mix: a small shared "session" (tempo, key and mode) kept in this browser, so the tools can start from the same musical setting.
   Nothing is sent anywhere. Pages call GVSession.bind() with the inputs they have. */
window.GVSession = (() => {
  const K = 'govibe.session', NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  const get = () => { try { const v = JSON.parse(localStorage.getItem(K)); return v && typeof v === 'object' ? v : {}; } catch (_) { return {}; } };
  const clean = (p) => { const o = {}; if (p.bpm != null && isFinite(p.bpm)) o.bpm = Math.round(Math.min(300, Math.max(20, +p.bpm)) * 10) / 10; if (p.root != null && p.root >= 0 && p.root < 12) o.root = Math.round(+p.root); if (typeof p.minor === 'boolean') o.minor = p.minor; return o; };
  const set = (patch) => { try { const n = { ...get(), ...clean(patch), ts: Date.now() }; localStorage.setItem(K, JSON.stringify(n)); } catch (_) { /* private mode: not remembered */ } note(); };
  const clear = () => { try { localStorage.removeItem(K); } catch (_) { /* nothing to clear */ } note(); };
  const label = (s = get()) => { const p = []; if (s.bpm) p.push(s.bpm + ' BPM'); if (s.root != null) p.push(NAMES[s.root] + (s.minor ? ' minor' : s.minor === false ? ' major' : '')); return p.join(', '); };
  function note() {
    const lead = document.querySelector('main p.lead'); if (!lead || !document.querySelector('[data-sess]')) return;
    let n = document.getElementById('sessnote'); const t = label();
    if (!t) { if (n) n.remove(); return; }
    if (!n) { n = document.createElement('p'); n.id = 'sessnote'; n.className = 'status'; n.setAttribute('role', 'status'); lead.after(n); }
    n.textContent = 'Your session: ' + t + '. The tools start from it, and changing it here updates it for the others.';
  }
  const fire = (el) => { el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
  /* map: { bpm: input, root: select, minor: { el, read(): boolean|null, write(bool) } }; elements are tagged so the note shows */
  function bind(map) {
    const s = get(), tag = (e) => e && e.setAttribute('data-sess', '1');
    if (map.bpm) {
      const e = map.bpm; tag(e); const lo = +e.min || 20, hi = +e.max || 300;
      if (s.bpm) { e.value = Math.round(Math.min(hi, Math.max(lo, s.bpm))); fire(e); }
      e.addEventListener('change', () => { const v = +e.value; if (v >= lo && v <= hi) set({ bpm: v }); });
    }
    if (map.root) {
      const e = map.root; tag(e); if (s.root != null) { e.value = String(s.root); fire(e); }
      e.addEventListener('change', () => set({ root: +e.value }));
    }
    if (map.minor) {
      const m = map.minor; tag(m.el); if (s.minor != null) { m.write(s.minor); fire(m.el); }
      m.el.addEventListener('change', () => { const v = m.read(); if (v != null) set({ minor: v }); });
    }
    note();
  }
  return { get, set, clear, label, bind, NAMES };
})();
