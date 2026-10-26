/* GoVibe Mix — DJ page view options: light/dark chassis and full performance view.
   Loaded in <head> so the saved theme is applied before the first paint. */
(() => {
  const root = document.documentElement, TK = 'govibe.djtheme';
  const get = () => { try { return localStorage.getItem(TK) === 'light' ? 'light' : 'dark'; } catch (_) { return 'dark'; } };
  const apply = (t) => { if (t === 'light') root.setAttribute('data-theme', 'light'); else root.removeAttribute('data-theme'); };
  apply(get());
  document.addEventListener('DOMContentLoaded', () => {
    const $ = (id) => document.getElementById(id), tb = $('themebtn'), pb = $('perfbtn'); if (!tb || !pb) return;
    const paintT = () => { const l = get() === 'light'; tb.textContent = l ? '☾ Dark' : '☀ Light'; tb.setAttribute('aria-label', l ? 'Switch to the dark console' : 'Switch to the light console'); };
    tb.onclick = () => { const n = get() === 'light' ? 'dark' : 'light'; try { localStorage.setItem(TK, n); } catch (_) {} apply(n); paintT(); };
    paintT();
    function setPerf(on) {
      root.classList.toggle('perf', on); pb.setAttribute('aria-pressed', on ? 'true' : 'false'); pb.textContent = on ? '⤡ Exit full view' : '⤢ Full view';
      try { if (on && root.requestFullscreen && !document.fullscreenElement) root.requestFullscreen().catch(() => {}); else if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {}); } catch (_) {}
      window.dispatchEvent(new Event('resize'));
    }
    pb.onclick = () => setPerf(!root.classList.contains('perf'));
    document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && root.classList.contains('perf')) setPerf(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && root.classList.contains('perf') && document.getElementById('helpmodal').classList.contains('hidden')) setPerf(false); });
  });
})();
