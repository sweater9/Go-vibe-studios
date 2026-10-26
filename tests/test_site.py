#!/usr/bin/env python3
"""End-to-end checks for Go Vibe Studios.

Run:  pip install playwright && playwright install chromium && python tests/test_site.py
Optional accessibility audit: npm install --no-save axe-core   (skipped if axe-core is not installed)

The site is served locally with the exact headers from _headers, so a Content-Security-Policy
violation shows up as a console error and fails the run. Replicate is replaced by a mock.
Exit code is 0 only if every check passes.
"""
import glob, http.server, json, os, re, struct, sys, threading
from html.parser import HTMLParser
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGES = ["index", "editor", "video", "games", "create", "dj", "lessons", "privacy", "terms"]
FAILS, PASSES = [], 0


def check(name, ok, detail=""):
    global PASSES
    if ok:
        PASSES += 1
    else:
        FAILS.append(f"{name} {detail}".strip())
        print(f"  FAIL  {name} {detail}")


# ---------------------------------------------------------------- server with the repo's _headers
def load_headers():
    out, star = [], False
    for line in open(os.path.join(ROOT, "_headers")):
        if not line.strip():
            continue
        if not line.startswith((" ", "\t")):
            star = line.strip() == "/*"
            continue
        if star and ":" in line:
            k, v = line.strip().split(":", 1)
            out.append((k.strip(), v.strip()))
    return out


def start_server():
    hdrs = load_headers()

    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=ROOT, **k)

        def end_headers(self):
            for k, v in hdrs:
                self.send_header(k, v)
            super().end_headers()

        def log_message(self, *a):
            pass

    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f"http://127.0.0.1:{srv.server_address[1]}/"


def new_page(browser, errors, **kw):
    ctx = browser.new_context(**kw)
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    pg.on("console", lambda m: errors.append(f"console: {m.text}") if m.type == "error" else None)
    return ctx, pg


# ---------------------------------------------------------------- static checks
class Refs(HTMLParser):
    def __init__(self):
        super().__init__()
        self.refs, self.meta, self.links = [], {}, {}

    def handle_starttag(self, tag, a):
        a = dict(a)
        for k in ("href", "src"):
            if k in a:
                self.refs.append(a[k])
        if tag == "meta":
            self.meta[a.get("name") or a.get("property")] = a.get("content", "")
        if tag == "link":
            self.links[a.get("rel")] = a.get("href")


def test_static():
    print("static files")
    for f in PAGES:
        p = Refs()
        p.feed(open(f"{ROOT}/{f}.html").read())
        bad = [r for r in p.refs if not re.match(r"^(https?:|#|mailto:)", r) and not os.path.exists(os.path.join(ROOT, r.split("#")[0].split("?")[0]))]
        check(f"{f}.html has no broken local links", not bad, str(bad))
        for k in ("description", "og:title", "og:description", "og:image", "theme-color"):
            check(f"{f}.html has meta {k}", bool(p.meta.get(k)))
        check(f"{f}.html links manifest and icon", p.links.get("manifest") and p.links.get("icon"))
    m = json.load(open(f"{ROOT}/manifest.webmanifest"))
    check("manifest icons exist", all(os.path.exists(os.path.join(ROOT, i["src"])) for i in m["icons"]))
    sw = open(f"{ROOT}/sw.js").read()
    pre = re.findall(r"'([^']+\.(?:html|css|js|svg|png|webmanifest))'", sw.split("PRECACHE")[1].split("];")[0])
    check("service worker precache files all exist", pre and all(os.path.exists(os.path.join(ROOT, x)) for x in pre), str([x for x in pre if not os.path.exists(os.path.join(ROOT, x))]))
    check("og-image exists", os.path.exists(f"{ROOT}/icons/og-image.png"))


# ---------------------------------------------------------------- pages, headers, hooks, phone layout
def test_pages(browser, base):
    print("pages")
    for name in PAGES:
        errs = []
        ctx, pg = new_page(browser, errs)
        resp = pg.goto(base + name + ".html")
        pg.wait_for_timeout(300)
        check(f"{name}: status 200", resp.status == 200)
        check(f"{name}: security headers", "default-src 'self'" in (resp.headers.get("content-security-policy") or "") and resp.headers.get("x-content-type-options") == "nosniff")
        check(f"{name}: no console or script errors", not errs, str(errs))
        check(f"{name}: skip link and main landmark", pg.locator("a.skip").count() == 1 and pg.locator("main#main").count() == 1)
        check(f"{name}: exactly one h1", pg.locator("h1").count() == 1)
        check(f"{name}: nav has 7 links", pg.locator("nav[aria-label=Main] a.link").count() == 7)
        ctx.close()
    for name, hook in [("editor", "__gv"), ("dj", "__dj"), ("video", "__ve"), ("lessons", "__lessons")]:
        ctx, pg = new_page(browser, [])
        pg.goto(base + name + ".html")
        a = pg.evaluate(f"typeof window.{hook}")
        pg.goto(base + name + ".html?gvtest")
        b = pg.evaluate(f"typeof window.{hook}")
        check(f"{name}: debug hook hidden without ?gvtest", a == "undefined" and b == "object", f"{a}/{b}")
        ctx.close()
    for name in PAGES:  # phone width
        ctx, pg = new_page(browser, [], viewport={"width": 390, "height": 844})
        pg.goto(base + name + ".html")
        pg.wait_for_timeout(200)
        ow = pg.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        check(f"{name}: no sideways scroll at 390px", ow <= 0, f"overflow {ow}px")
        ctx.close()


def test_a11y(browser, base):
    axe = os.environ.get("AXE_PATH") or os.path.join(ROOT, "node_modules/axe-core/axe.min.js")
    if not os.path.exists(axe):
        print("accessibility: SKIPPED (npm install --no-save axe-core to enable)")
        return
    print("accessibility (axe)")
    ctx = browser.new_context(bypass_csp=True)
    pg = ctx.new_page()
    js = "axe.run(document,{runOnly:['wcag2a','wcag2aa','wcag21a','wcag21aa','best-practice']}).then(r=>r.violations.map(v=>v.id+' x'+v.nodes.length+' '+v.nodes[0].target.join(' ')))"
    for name in PAGES:
        pg.goto(base + name + ".html")
        pg.add_script_tag(path=axe)
        check(f"{name}: no axe violations", not (v := pg.evaluate(js)), str(v))
    pg.goto(base + "create.html")
    pg.click("#keybtn")
    pg.add_script_tag(path=axe)
    check("create key dialog: no axe violations", not (v := pg.evaluate(js)), str(v))
    ctx.close()


# ---------------------------------------------------------------- audio editor + games
def test_editor_games(browser, base):
    print("audio editor and games")
    errs = []
    ctx, pg = new_page(browser, errs)
    pg.goto(base + "editor.html?gvtest")
    r = pg.evaluate("""() => { const sr = 8000, n = sr * 2, a = new Float32Array(n).map((_, i) => Math.sin(i / 20) * 0.5);
      __gv.loadBuffers([a], sr); const o = {};
      __gv.sel = [sr / 2, sr]; __gv.ops.trim(); o.trim = __gv.chans[0].length;
      __gv.sel = [0, 1000]; __gv.ops.cut(); o.cut = __gv.chans[0].length;
      __gv.sel = [0, 0]; __gv.ops.fadeout(); o.fadeEnd = Math.abs(__gv.chans[0].at(-1));
      __gv.ops.normalize(); o.peak = Math.max(...__gv.chans[0].map(Math.abs));
      document.getElementById('speed').value = 200; __gv.ops.speed(); o.speed = __gv.chans[0].length;
      o.wav = __gv.wavBlob(__gv.chans).size; return o; }""")
    check("editor trim to 0.5 s", r["trim"] == 4000, str(r))
    check("editor cut removes the selection", r["cut"] == 3000)
    check("editor fade-out reaches silence", r["fadeEnd"] < 0.01)
    check("editor normalize peaks at 0.98", abs(r["peak"] - 0.98) < 0.01)
    check("editor 2x speed halves the length", r["speed"] == 1500)
    check("editor WAV export size is header + samples", r["wav"] == 44 + 1500 * 2)
    check("editor: no errors", not errs, str(errs))
    ctx.close()

    errs = []
    ctx, pg = new_page(browser, errs)
    pg.goto(base + "games.html")
    for g in ["Snake", "Memory Match", "Breakout"]:
        pg.locator(".card", has_text=g).get_by_text("Play").click()
        pg.wait_for_timeout(350)
        check(f"game {g} opens", not pg.locator("#modal").evaluate("e => e.classList.contains('hidden')"))
        pg.keyboard.press("Escape")
        check(f"game {g} closes with Escape", pg.locator("#modal").evaluate("e => e.classList.contains('hidden')"))
    pg.fill("#gname", "Test")
    pg.fill("#gurl", "https://example.com/")
    pg.click("#gadd")
    check("embedded game can be added", pg.locator(".card").count() == 4)
    pg.reload()
    check("embedded game survives reload", pg.locator(".card").count() == 4)
    check("games: no errors", not errs, str(errs))
    ctx.close()


# ---------------------------------------------------------------- Create page against a mock Replicate
def tiny_wav():
    data = b"".join(struct.pack("<h", int(8000 * ((i % 40) / 40 - .5))) for i in range(4000))
    return b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVEfmt " + struct.pack("<IHHIIHH", 16, 1, 1, 8000, 16000, 2, 16) + b"data" + struct.pack("<I", len(data)) + data


def test_create(browser, base):
    print("create page (mock Replicate)")
    errs, bodies, auth = [], [], []
    ctx, pg = new_page(browser, errs)
    H = {"access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*"}
    mode = {"v": "ok"}

    def api(route, req):
        if req.method == "OPTIONS":
            return route.fulfill(status=204, headers=H)
        if mode["v"] == "401":
            return route.fulfill(status=401, headers=H, content_type="application/json", body="{}")
        if mode["v"] == "block":
            return route.abort()
        if req.method == "POST":
            bodies.append((req.url.split("/models/")[1], json.loads(req.post_data)))
            auth.append(req.headers.get("authorization"))
            return route.fulfill(status=201, headers=H, content_type="application/json", body=json.dumps({"id": "z", "status": "processing"}))
        return route.fulfill(headers=H, content_type="application/json", body=json.dumps({"id": "z", "status": "succeeded", "output": "https://replicate.delivery/o.wav"}))

    pg.route("https://api.replicate.com/**", api)
    pg.route("https://replicate.delivery/**", lambda r, q: r.fulfill(headers={"access-control-allow-origin": "*"}, content_type="audio/wav", body=tiny_wav()))
    pg.goto(base + "create.html")
    pg.fill("#prompt", "lofi beat")
    pg.click("#gen")
    check("generating without a key opens the key dialog", not pg.locator("#keymodal").evaluate("e => e.classList.contains('hidden')"))
    pg.keyboard.press("Escape")
    check("Escape closes the key dialog", pg.locator("#keymodal").evaluate("e => e.classList.contains('hidden')"))
    pg.click("#keybtn")
    pg.fill("#key", "r8_test")
    pg.click("#keysave")
    pg.click("#gen")
    pg.wait_for_selector("#result:not(.hidden)", timeout=20000)
    check("music request uses the right model, body and key", bodies[-1] == ("stability-ai/stable-audio-2.5/predictions", {"input": {"prompt": "lofi beat", "duration": 30}}) and auth[-1] == "Bearer r8_test", str(bodies[-1]))
    for typ, prompt, dur, suffix in [("sfx", "door creak", 4, ""), ("loop", "forest theme", 30, ", instrumental, seamless loop, no fade in or out")]:
        pg.select_option("#type", typ)
        pg.fill("#prompt", prompt)
        pg.click("#gen")
        pg.locator("#status", has_text=re.compile("^Done")).wait_for(timeout=20000)
        check(f"{typ} request", bodies[-1][1]["input"] == {"prompt": prompt + suffix, "duration": dur}, str(bodies[-1]))
    pg.select_option("#type", "music")
    pg.select_option("#model", "meta/musicgen")
    check("MusicGen caps length at 30 s", pg.evaluate("document.getElementById('dur').max") == "30")
    pg.click("#toedit")
    pg.wait_for_url("**/editor.html?from=create")
    pg.wait_for_selector("#editor:not(.hidden)", timeout=10000)
    check("generated track opens in the editor", "0:00.50" in pg.inner_text("#info"), pg.inner_text("#info"))
    pg.goto(base + "create.html")
    mode["v"] = "401"
    pg.fill("#prompt", "x")
    pg.click("#gen")
    pg.locator("#status", has_text="rejected").wait_for(timeout=10000)
    check("bad key shows a clear message", True)
    mode["v"] = "block"
    pg.click("#gen")
    pg.locator("#status", has_text="CORS").wait_for(timeout=10000)
    check("blocked call explains the proxy", True)
    pg.click("#keybtn")
    pg.click("#keyremove")
    check("Remove key clears storage and closes the dialog", pg.evaluate("localStorage.getItem('govibe.rkey')") is None and pg.locator("#keymodal").evaluate("e => e.classList.contains('hidden')"))
    real = [e for e in errs if "Failed to load resource" not in e]  # the 401 / aborted calls above are deliberate
    check("create: no script or policy errors", not real, str(real))
    ctx.close()


# ---------------------------------------------------------------- DJ mixer
def test_dj(browser, base):
    print("dj mixer")
    errs = []
    ctx, pg = new_page(browser, errs, permissions=[])
    pg.goto(base + "dj.html?gvtest")
    r = pg.evaluate("""async () => { const { decks, ctx, detectBPM } = __dj, o = {};
      const mk = (bpm, sr = 22050, secs = 40) => { const b = ctx.createBuffer(1, sr * secs, sr), d = b.getChannelData(0), beat = Math.round(sr * 60 / bpm);
        for (let i = 0; i < d.length; i += beat) for (let k = 0; k < 400 && i + k < d.length; k++) d[i + k] = Math.sin(k / 6) * Math.exp(-k / 80); return b; };
      o.bpm = [98, 120, 140].map((x) => detectBPM(mk(x)));
      decks[0].setBuffer(mk(120), 'a.wav'); decks[1].setBuffer(mk(126), 'b.wav');
      const xf = document.getElementById('xf'); xf.value = 0; __dj.applyXf(); o.xf0 = [decks[0].xf.gain.value, decks[1].xf.gain.value];
      xf.value = 50; __dj.applyXf(); o.xf50 = decks[0].xf.gain.value;
      __dj.sync(0, 1); o.sync = [decks[0].liveBpm, decks[1].liveBpm];
      const d = decks[0]; d.play(); await new Promise((r) => setTimeout(r, 500)); o.playing = d.playing;
      d.seek(10); await new Promise((r) => setTimeout(r, 300)); o.seek = d.position();
      d.toggleLoop(); const L = d.loop; o.loopLen = L.end - L.start;
      await new Promise((r) => setTimeout(r, 3200)); const p = d.position(); o.inLoop = p >= L.start - 0.01 && p <= L.end + 0.01;
      d.toggleLoop(); d.pause(); o.paused = !d.playing; return o; }""")
    for want, got in zip([98, 120, 140], r["bpm"]):
        check(f"BPM detection for {want} BPM", abs(got - want) < 1, f"got {got:.2f}")
    check("crossfader fully left / centre gains", r["xf0"][0] == 1 and r["xf0"][1] == 0 and abs(r["xf50"] - 0.7071) < 0.001)
    check("tempo sync matches the other deck", abs(r["sync"][0] - r["sync"][1]) < 0.5, str(r["sync"]))
    check("play, seek, loop of 4 beats, pause", r["playing"] and 10 <= r["seek"] < 11 and abs(r["loopLen"] - 2) < 0.05 and r["inLoop"] and r["paused"], str(r))
    # beat maker
    pg.goto(base + "dj.html?gvtest")
    check("beat grid has 6 rows x 16 steps", pg.locator(".bstep").count() == 96)
    pg.click("#bclear")
    pg.locator(".brow").nth(0).locator(".bstep").nth(2).click()
    check("clicking a step turns it on", pg.evaluate("__beat.pat[0][2]") is True and pg.get_attribute(".brow:nth-child(1) .bstep:nth-of-type(3)", "aria-pressed") == "true")
    pg.click("#bpresets .btn >> nth=1")
    check("preset loads a pattern", pg.evaluate("__beat.pat[0].filter(Boolean).length") == 3)
    pg.fill("#bbpm", "100"); pg.dispatch_event("#bbpm", "change")
    pg.click("#bplay")
    pg.wait_for_timeout(1500)
    check("beat plays and highlights a step", pg.evaluate("__beat.playing") and pg.locator(".bstep.now").count() == 6 and pg.evaluate("__beat.bpm") == 100)
    pg.click("#bplay")
    check("beat stops", pg.evaluate("__beat.playing") is False and pg.locator(".bstep.now").count() == 0)
    # save / load / export
    pg.click("#bclear")
    pg.locator(".brow").nth(1).locator(".bstep").nth(4).click()
    pg.fill("#bname", "Test beat"); pg.click("#bsave")
    pg.reload()
    pg.select_option("#bsaved", "Test beat"); pg.click("#bload")
    check("saved beat survives reload and loads", pg.evaluate("__beat.pat[1][4]") is True and pg.evaluate("__beat.pat[0].some(Boolean)") is False and pg.input_value("#bname") == "Test beat")
    pg.click("#bdel")
    check("saved beat can be deleted", pg.locator("#bsaved option").inner_text() == "No saved beats")
    pg.click("#bpresets .btn >> nth=0"); pg.fill("#bbpm", "120"); pg.dispatch_event("#bbpm", "change"); pg.select_option("#bbars", "2")
    pg.click("#bexport"); pg.wait_for_selector("#bdl:not(.hidden)", timeout=20000)
    wl = pg.evaluate("""async () => { const b = __beat.lastBlob, u = new Uint8Array(await b.arrayBuffer()), v = new DataView(u.buffer);
      let pk = 0; for (let i = 44; i < u.length; i += 2) pk = Math.max(pk, Math.abs(v.getInt16(i, true)));
      return { size: b.size, riff: String.fromCharCode(...u.slice(0, 4)), secs: (v.getUint32(40, true) / 4) / v.getUint32(24, true), pk }; }""")
    check("exported beat is a WAV of 2 bars at 120 BPM (~4 s + tail)", wl["riff"] == "RIFF" and abs(wl["secs"] - 5.0) < 0.1 and wl["pk"] > 3000, str(wl))
    check("export download name", pg.get_attribute("#bdl", "download") == "govibe-beat-120bpm.wav")
    pg.click("#btoedit"); pg.wait_for_url("**/editor.html?from=create"); pg.wait_for_selector("#editor:not(.hidden)", timeout=10000)
    check("exported beat opens in the editor", "0:05" in pg.inner_text("#info") or "0:04" in pg.inner_text("#info"), pg.inner_text("#info"))
    pg.goto(base + "dj.html?gvtest")
    pg.click("#rec")
    pg.click("#bplay")
    pg.click(".pad >> nth=0")
    pg.wait_for_timeout(1000)
    pg.click("#rec")
    pg.click("#bplay")
    pg.wait_for_selector("#recdl:not(.hidden)", timeout=6000)
    check("mix recording produces a download", (pg.get_attribute("#recdl", "download") or "").startswith("govibe-mix."))
    check("dj: no errors", not errs, str(errs))
    ctx.close()


# ---------------------------------------------------------------- lessons
def test_lessons(browser, base):
    print("lessons")
    errs = []
    ctx, pg = new_page(browser, errs)
    pg.goto(base + "lessons.html?gvtest")
    c = pg.evaluate("[__lessons.compatible('8A'), __lessons.compatible('1B'), __lessons.compatible('12A'), [0.1, 0.5, 2, 3].map(__lessons.scoreFor)]")
    check("Camelot 8A neighbours", sorted(c[0]) == sorted(["8A", "9A", "7A", "8B"]))
    check("Camelot wraps 1B and 12A", sorted(c[1]) == sorted(["1B", "2B", "12B", "1A"]) and sorted(c[2]) == sorted(["12A", "1A", "11A", "12B"]))
    check("trainer star thresholds", c[3] == [3, 2, 1, 0])
    pg.check('[data-done="bpm"]')
    pg.check('[data-done="eq"]')
    pg.reload()
    check("lesson progress survives reload", pg.inner_text("#ptext").startswith("2 of 5") and pg.is_checked('[data-done="bpm"]'))
    pg.click("#tstart")
    pg.wait_for_timeout(500)
    best = pg.evaluate("""() => { const s = document.getElementById('padj'); let best = null;
      for (let v = -10; v <= 10.0001; v += 0.1) { s.value = v.toFixed(1); s.oninput(); document.getElementById('tcheck').click();
        const e = parseFloat(document.getElementById('tmsg').textContent.match(/off by ([0-9.]+)/)[1]), st = document.getElementById('stars').textContent;
        if (!best || e < best.e) best = { e, st }; document.getElementById('tstart').click(); } return best; }""")
    check("trainer can be won with a perfect adjustment", best["st"] == "★★★" and best["e"] < 0.3, str(best))
    check("lessons: no errors", not errs, str(errs))
    ctx.close()


# ---------------------------------------------------------------- video editor
def test_video(browser, base):
    print("video editor")
    errs = []
    ctx, pg = new_page(browser, errs)
    pg.goto(base + "video.html?gvtest")
    mk = """async ([color, secs]) => { const c = document.createElement('canvas'); c.width = 320; c.height = 180; const g = c.getContext('2d');
      const ac = new AudioContext(), dest = ac.createMediaStreamDestination(), o = ac.createOscillator(); o.connect(dest); o.start();
      const s = c.captureStream(30); dest.stream.getAudioTracks().forEach((t) => s.addTrack(t));
      const rec = new MediaRecorder(s, { mimeType: 'video/webm;codecs=vp8,opus' }), ch = []; rec.ondataavailable = (e) => ch.push(e.data);
      const done = new Promise((r) => (rec.onstop = r)); rec.start(100); const t0 = performance.now();
      await new Promise((res) => { (function f() { const t = (performance.now() - t0) / 1000; g.fillStyle = color; g.fillRect(0, 0, 320, 180); g.fillStyle = '#fff'; g.fillRect((t * 100) % 300, 80, 20, 20); t < secs ? requestAnimationFrame(f) : res(); })(); });
      rec.stop(); await done; o.stop(); await __ve.addFile(new File([new Blob(ch, { type: 'video/webm' })], color + '.webm')); }"""
    pg.evaluate(mk, ["#c0392b", 2.2])
    pg.evaluate(mk, ["#2471a3", 2.2])
    st = pg.evaluate("__ve.state")
    check("two clips with finite durations", len(st["clips"]) == 2 and all(1.5 < c["dur"] < 3 for c in st["clips"]), str(st["clips"]))
    nums = pg.locator("#cliplist input[type=number]")
    nums.nth(0).fill("0.5"); nums.nth(0).dispatch_event("change")
    nums.nth(3).fill("1.7"); nums.nth(3).dispatch_event("change")
    st = pg.evaluate("__ve.state")
    want = (st["clips"][0]["dur"] - 0.5) + 1.7
    check("trim in/out changes the timeline length", abs(st["total"] - want) < 0.02, f"{st['total']} vs {want}")
    pg.fill("#ttext", "Hello Vibe"); pg.fill("#tstart", "0"); pg.fill("#tend", "10"); pg.select_option("#tpos", "middle"); pg.click("#tadd")
    pg.evaluate("__ve.seek(0.5)")
    pg.wait_for_timeout(500)
    px = pg.evaluate("""(() => { const c = document.getElementById('cv'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let w = 0, r = 0;
      for (let i = 0; i < d.length; i += 4) { if (d[i] > 240 && d[i + 1] > 240 && d[i + 2] > 240) w++; if (d[i] > 150 && d[i + 1] < 80) r++; } return { w, r }; })()""")
    check("preview shows the red clip with white text", px["r"] > 400000 and px["w"] > 3000, str(px))
    pg.select_option("#aspect", "9:16")
    pg.wait_for_timeout(200)
    check("vertical aspect resizes the canvas", pg.evaluate("[cv.width, cv.height]") == [720, 1280])
    pg.select_option("#aspect", "16:9")
    pg.evaluate("""async () => { const sr = 8000, n = sr * 4, b = new ArrayBuffer(44 + n * 2), v = new DataView(b), w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
      w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
      for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.sin(i / 9) * 8000, true); await __ve.loadMusic(new File([b], 'tone.wav')); }""")
    check("music track loads", pg.inner_text("#mname") == "tone.wav")
    out = pg.evaluate("""async () => { const b = await __ve.exportVideo(); if (!b) return null; await __ve.addFile(new File([b], 'out.webm', { type: b.type }));
      const s = __ve.state; return { type: b.type, size: b.size, dur: s.clips.at(-1).dur }; }""")
    check("export produces a video file", out and out["type"].startswith("video/") and out["size"] > 20000, str(out))
    check("exported length is close to the timeline", out and abs(out["dur"] - want) < 1.0, f"{out and out['dur']} vs {want}")
    check("video: no errors", not errs, str(errs))
    ctx.close()


# ---------------------------------------------------------------- offline support
def test_offline(browser, base):
    print("offline support")
    errs = []
    ctx, pg = new_page(browser, errs)
    pg.goto(base + "index.html")
    ready = pg.evaluate("navigator.serviceWorker.ready.then(() => true)")
    pg.wait_for_timeout(500)
    check("service worker registers", ready is True)
    ctx.set_offline(True)
    pg.goto(base + "editor.html")
    check("a cached page opens while offline", pg.inner_text("h1").replace("\n", " ") == "Audio Editor")
    ctx.set_offline(False)
    ctx.close()


def main():
    srv, base = start_server()
    test_static()
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
        for t in (test_pages, test_a11y, test_editor_games, test_create, test_dj, test_lessons, test_video, test_offline):
            try:
                t(browser, base)
            except Exception as e:  # a crashed suite is a failure, not a skip
                check(f"{t.__name__} ran to completion", False, repr(e)[:300])
        browser.close()
    srv.shutdown()
    print(f"\n{PASSES} checks passed, {len(FAILS)} failed")
    for f in FAILS:
        print("  -", f)
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
