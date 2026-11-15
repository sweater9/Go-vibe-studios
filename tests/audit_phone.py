#!/usr/bin/env python3
"""Phone layout audit for GoVibeMix: tap target size and colour contrast at 390px wide.

Run:  python3 tests/audit_phone.py [--min 24] [page ...]
Needs playwright and axe-core (npm install --no-save axe-core, or set AXE_PATH).
Reports, per page, controls smaller than --min CSS pixels (WCAG 2.2 AA asks for 24, comfortable is 44)
and any colour contrast failures axe finds. Exit code 1 when something is reported.
"""
import http.server, os, sys, threading
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JS = """(min) => {
  const out = [], seen = new Set();
  const vis = (e) => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0'; };
  for (const e of document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, [role=button], summary')) {
    if (!vis(e) || e.disabled) continue;
    if (e.tagName === 'A' && e.closest('p, li, td, label, span.small') && getComputedStyle(e).display === 'inline') continue; /* inline text links are exempt */
    const r = e.getBoundingClientRect();
    if (r.width < min || r.height < min) { const k = e.tagName + '.' + (e.className || '') + '|' + Math.round(r.width) + 'x' + Math.round(r.height); if (!seen.has(k)) { seen.add(k); out.push(k + ' ' + (e.id ? '#' + e.id : '') + ' "' + (e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 24) + '"'); } }
  }
  return out;
}"""


def main():
    args = sys.argv[1:]
    mn = 24
    if "--min" in args:
        i = args.index("--min"); mn = int(args[i + 1]); del args[i:i + 2]
    axe = os.environ.get("AXE_PATH") or os.path.join(ROOT, "node_modules/axe-core/axe.min.js")
    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k): super().__init__(*a, directory=ROOT, **k)
        def log_message(self, *a): pass
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{srv.server_address[1]}/"
    pages = args or sorted(f[:-5] for f in os.listdir(ROOT) if f.endswith(".html") and not f.startswith("diag"))
    bad = 0
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={"width": 390, "height": 800}, bypass_csp=True, has_touch=True)
        pg = ctx.new_page()
        for name in pages:
            pg.goto(base + name + ".html?gvtest"); pg.wait_for_timeout(400)
            small = pg.evaluate(JS, mn)
            con = []
            if os.path.exists(axe):
                pg.add_script_tag(path=axe)
                con = pg.evaluate("axe.run(document,{runOnly:['color-contrast']}).then(r=>r.violations.flatMap(v=>v.nodes.map(n=>n.target.join(' ')+' '+(n.any[0]&&n.any[0].message||'').slice(0,90))))")
            if small or con:
                bad += 1
                print(f"{name}.html")
                for s in small: print("   small target:", s)
                for c in con[:6]: print("   contrast:", c)
        b.close()
    print(f"\n{len(pages)} pages, {bad} with findings (minimum target {mn}px)")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
