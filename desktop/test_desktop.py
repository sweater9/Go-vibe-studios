"""Smoke test for the desktop shell. Run: xvfb-run -a python3 desktop/test_desktop.py   (needs `npm install` in desktop/ and Python playwright)."""
import os, subprocess, sys, time
from playwright.sync_api import sync_playwright
D = os.path.dirname(os.path.abspath(__file__)); exe = D + '/node_modules/electron/dist/electron'
subprocess.run(['node', D + '/scripts/copy-site.js'], check=True, stdout=subprocess.DEVNULL)
res = []
def check(name, ok, info=''): res.append(bool(ok)); print(('  ok    ' if ok else '  FAIL  ') + name + ('' if ok else ' ' + str(info)))
proc = subprocess.Popen([exe, D, '--no-sandbox', '--remote-debugging-port=9334', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    import urllib.request
    for _ in range(60):
        try: urllib.request.urlopen('http://127.0.0.1:9334/json/version', timeout=1); break
        except Exception: time.sleep(0.5)
    time.sleep(1)
    with sync_playwright() as p:
        b = p.chromium.connect_over_cdp('http://127.0.0.1:9334'); pg = b.contexts[0].pages[0]; errs = []; pg.on('pageerror', lambda e: errs.append(str(e))); pg.wait_for_load_state()
        check('the app opens the home page from the bundled files', pg.url == 'govibe://app/index.html' and 'GoVibe Mix' in pg.title(), pg.url)
        check('home page shows all tool cards', pg.evaluate("document.querySelectorAll('.card').length") >= 12, pg.evaluate("document.querySelectorAll('.card').length"))
        o = pg.evaluate("[location.origin, window.isSecureContext, typeof AudioWorkletNode, typeof Worker]"); check('private origin is a secure context with AudioWorklet and workers', o == ['govibe://app', True, 'function', 'function'], o)
        pg.goto('govibe://app/studio.html?gvtest'); pg.wait_for_function("() => window.__st", timeout=10000); check('the Studio loads', pg.evaluate("__st.P.tracks.length") == 0)
        pg.evaluate("__st.addTrack('midi')"); check('Studio works inside the app', pg.evaluate("__st.P.tracks.length") == 1)
        pg.goto('govibe://app/record.html'); pg.click('#allow'); pg.wait_for_selector('#rig:not(.hidden)', timeout=8000); check('microphone permission is granted to the app pages', True)
        pg.goto('govibe://app/master.html'); check('Mastering page loads and its worker file is reachable', pg.evaluate("fetch('js/master-worker.js').then(r => r.status)") == 200)
        check('a path outside the site folder is refused', pg.evaluate("fetch('govibe://app/../package.json').then(r => r.status)") == 404 and pg.evaluate("fetch('govibe://app/%2e%2e/main.js').then(r => r.status)") == 404)
        check('the content security policy header is applied', 'script-src \'self\'' in pg.evaluate("fetch('index.html').then(r => r.headers.get('content-security-policy'))"))
        check('no script errors', not errs, errs)
finally:
    proc.terminate()
print(f"{sum(res)} passed, {len(res) - sum(res)} failed"); sys.exit(0 if all(res) else 1)
