/* GoVibeMix — colour themes for the whole site: Dark neon (the default), Light and High contrast.
   Loaded in <head> so the saved choice is applied before the first paint. The choice is kept in this browser only. The DJ page has its own Light/Dark button (js/view.js) that shares the same saved choice. */
(() => {
  const root = document.documentElement, KEY = 'govibe.theme', OLD = 'govibe.djtheme', ORDER = ['dark', 'light', 'contrast'], NAMES = { dark: 'Dark neon', light: 'Light', contrast: 'High contrast' };
  const get = () => { try { const v = localStorage.getItem(KEY) || (localStorage.getItem(OLD) === 'light' ? 'light' : ''); return ORDER.includes(v) ? v : 'dark'; } catch (_) { return 'dark'; } };
  const apply = (t) => { if (t === 'dark') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', t); const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = t === 'light' ? '#f4f3fa' : t === 'contrast' ? '#000000' : '#0b0b14'; };
  apply(get());
  document.addEventListener('DOMContentLoaded', () => {
    apply(get()); const nav = document.querySelector('.nav'); if (!nav || document.getElementById('themebtn')) return;   // the DJ page has its own button
    const b = document.createElement('button'); b.type = 'button'; b.className = 'link themebtn'; b.id = 'themebtn2';
    const paint = () => { const t = get(), n = ORDER[(ORDER.indexOf(t) + 1) % ORDER.length]; b.textContent = 'Theme: ' + NAMES[t]; b.setAttribute('aria-label', 'Colour theme: ' + NAMES[t] + '. Press to switch to ' + NAMES[n] + '.'); };
    b.onclick = () => { const t = ORDER[(ORDER.indexOf(get()) + 1) % ORDER.length]; try { localStorage.setItem(KEY, t); } catch (_) { /* no storage */ } apply(t); paint(); };
    paint(); nav.appendChild(b);
  });
})();

/* Coming back to a page with the Back button returns to the same place. The position is kept for this tab only, and applied once the page has finished building its content. */
(() => {
  const K = 'govibe.scroll:' + location.pathname; let t = 0;
  const save = () => { try { sessionStorage.setItem(K, String(Math.round(window.scrollY))); } catch (_) {} };
  window.addEventListener('scroll', () => { clearTimeout(t); t = setTimeout(save, 120); }, { passive: true });
  window.addEventListener('pagehide', save);
  try { if ('scrollRestoration' in history) history.scrollRestoration = 'manual'; } catch (_) {}
  let back = false; try { const n = performance.getEntriesByType('navigation')[0]; back = !!n && n.type === 'back_forward'; } catch (_) {}
  if (!back || location.hash) return;
  let y = 0; try { y = +sessionStorage.getItem(K) || 0; } catch (_) {}
  if (!y) return;
  const root = document.documentElement; let tries = 0;
  const go = () => {
    root.style.scrollBehavior = 'auto';
    const max = Math.max(0, root.scrollHeight - innerHeight);
    window.scrollTo(0, Math.min(y, max));
    if (Math.abs(window.scrollY - y) > 2 && ++tries < 30) setTimeout(go, 100); else root.style.scrollBehavior = '';
  };
  window.addEventListener('DOMContentLoaded', go); window.addEventListener('load', go);
})();
