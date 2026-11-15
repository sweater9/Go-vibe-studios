#!/usr/bin/env python3
"""Opens every page in WebKit (the engine behind Safari on iPhone) at phone size and reports script errors,
failed requests and sideways scrolling. Added because /samples crashed on a real iPhone but not in Chromium.

Run:  python3 tests/webkit_smoke.py [page ...]
Needs:  playwright install webkit      (prints SKIPPED and exits 0 when WebKit is not installed)
Use --iphone to emulate an iPhone 13 (touch, Safari user agent) instead of a plain 390px window.
"""
import http.server, os, sys, threading
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k): super().__init__(*a, directory=ROOT, **k)
        def log_message(self, *a): pass
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{srv.server_address[1]}/"
    pages = args or sorted(f[:-5] for f in os.listdir(ROOT) if f.endswith(".html") and not f.startswith("diag"))
    bad = 0
    with sync_playwright() as p:
        try:
            b = p.webkit.launch()
        except Exception as e:
            print("WebKit: SKIPPED (run: playwright install webkit)", str(e).splitlines()[0][:100]); return
        kw = dict(p.devices["iPhone 13"]) if "--iphone" in sys.argv else {"viewport": {"width": 390, "height": 800}}
        for name in pages:
            ctx = b.new_context(**kw); pg = ctx.new_page(); errs = []
            pg.on("pageerror", lambda e: errs.append("script: " + str(e)[:140]))
            pg.on("crash", lambda: errs.append("PAGE CRASHED"))
            pg.on("response", lambda r: errs.append(f"http {r.status} {r.url[-50:]}") if r.status >= 400 else None)
            try:
                pg.goto(base + name + ".html", timeout=30000); pg.wait_for_timeout(1200)
                sw = pg.evaluate("document.documentElement.scrollWidth - innerWidth")
                if sw > 1: errs.append(f"sideways scroll {sw}px")
            except Exception as e:
                errs.append("load: " + str(e)[:120])
            if errs:
                bad += 1; print(name + ".html"); [print("   ", e) for e in errs]
            ctx.close()
        b.close()
    print(f"{len(pages)} pages in WebKit, {bad} with findings")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
