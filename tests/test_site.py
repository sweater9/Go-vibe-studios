#!/usr/bin/env python3
"""End-to-end checks for GoVibe Mix.

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
PAGES = ["index", "editor", "video", "create", "dj", "lessons", "privacy", "terms"]
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
        check(f"{name}: nav has 6 links", pg.locator("nav[aria-label=Main] a.link").count() == 6)
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


# ---------------------------------------------------------------- audio editor
def test_editor(browser, base):
    print("audio editor")
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
    pg.click("#tab-beat")
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
    pg.click("#tab-beat")
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
    pg.click("#tab-beat")
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


def test_dj_extras(browser, base):
    print("dj effects, hot cues, key detection, automix")
    errs = []
    ctx, pg = new_page(browser, errs)
    pg.goto(base + "dj.html?gvtest")
    r = pg.evaluate("""async () => { const { decks, ctx, detectKey, keysMatch } = __dj, o = {};
      const chord = (freqs, secs = 12, sr = 22050) => { const b = ctx.createBuffer(1, sr * secs, sr), d = b.getChannelData(0);
        for (let i = 0; i < d.length; i++) { let v = 0; for (const f of freqs) v += Math.sin(2 * Math.PI * f * i / sr) + 0.3 * Math.sin(2 * Math.PI * 2 * f * i / sr); d[i] = v / freqs.length * 0.5; } return b; };
      o.cmaj = detectKey(chord([261.63, 329.63, 392.0, 130.81]));
      o.fsmaj = detectKey(chord([369.99, 466.16, 554.37, 185.0]));
      o.silent = detectKey(ctx.createBuffer(1, 22050 * 12, 22050));
      o.match = [keysMatch('8A', '8B'), keysMatch('8A', '9A'), keysMatch('8A', '2B'), keysMatch('8A', '8A')];
      const mk = (bpm, sr = 22050, secs = 30) => { const b = ctx.createBuffer(1, sr * secs, sr), d = b.getChannelData(0), beat = Math.round(sr * 60 / bpm);
        for (let i = 0; i < d.length; i += beat) for (let k = 0; k < 400 && i + k < d.length; k++) d[i + k] = Math.sin(k / 6) * Math.exp(-k / 80); return b; };
      const A = decks[0]; A.setBuffer(mk(120), 'a.wav');
      // loop sizes
      A.el.lbeats.value = '8'; A.el.lbeats.onchange(); A.toggleLoop(); o.loop8 = A.loop.end - A.loop.start; A.toggleLoop();
      // hot cues
      A.seek(5); A.hotCue(0); A.seek(9); A.hotCue(0); o.hotJump = A.position(); o.hotOn = A.el.hot1.classList.contains('on');
      A.el.hotclr.click(); o.hotCleared = A.hot[0] === null;
      // effects
      A.el.filt.value = -100; A.el.filt.oninput(); A.el.echo.value = 60; A.el.echo.oninput(); A.el.rev.value = 50; A.el.rev.oninput();
      await new Promise((r) => setTimeout(r, 300));
      o.lp = A.lp.frequency.value; o.hp = A.hp.frequency.value; o.echo = A.echoWet.gain.value; o.rev = A.revWet.gain.value; o.dly = A.dly.delayTime.value;
      A.el.filt.value = 100; A.el.filt.oninput(); await new Promise((r) => setTimeout(r, 300)); o.hpUp = A.hp.frequency.value; o.lpUp = A.lp.frequency.value;
      return o; }""")
    check("key detection finds C major (8B) and F# major (2B)", r["cmaj"] in ("8B", "8A") and r["fsmaj"] in ("2B", "2A") and r["cmaj"][-1] == "B" and r["fsmaj"][-1] == "B", str((r["cmaj"], r["fsmaj"])))
    check("key detection returns nothing for silence", r["silent"] is None)
    check("key compatibility rules", r["match"] == ["compatible", "compatible", "clash", "same key"], str(r["match"]))
    check("loop length follows the beat selector (8 beats = 4 s)", abs(r["loop8"] - 4) < 0.05, str(r["loop8"]))
    check("hot cue sets, jumps back and clears", abs(r["hotJump"] - 5) < 0.2 and r["hotOn"] and r["hotCleared"], str(r))
    check("filter, echo and reverb move their nodes", r["lp"] < 400 and r["hp"] < 30 and r["echo"] > 0.1 and r["rev"] > 0.1 and abs(r["dly"] - 0.25) < 0.01 and r["hpUp"] > 5000 and r["lpUp"] > 19000, str(r))

    # automix: two short tracks at 120 and 124 BPM, 4 s transition
    pg.goto(base + "dj.html?gvtest")
    pg.click("#tab-am")
    pg.select_option("#amlen", "4")
    pg.evaluate("""async () => { const { ctx } = __dj;
      const mk = (bpm, secs, sr = 22050) => { const b = ctx.createBuffer(1, sr * secs, sr), d = b.getChannelData(0), beat = Math.round(sr * 60 / bpm);
        for (let i = 0; i < d.length; i += beat) for (let k = 0; k < 400 && i + k < d.length; k++) d[i + k] = Math.sin(k / 6) * Math.exp(-k / 80); return b; };
      await __am.addBuffer(mk(120, 14), 'one.wav'); await __am.addBuffer(mk(124, 14), 'two.wav'); }""")
    check("queue lists both tracks with BPM", pg.locator("#amlist li").count() == 2 and "BPM" in pg.inner_text("#amlist"))
    pg.click("#amgo")
    check("automix starts deck A", pg.evaluate("__dj.decks[0].playing") and pg.inner_text("#amgo").startswith("■"))
    pg.wait_for_function("() => __am.S.tr !== null", timeout=20000)
    mid = pg.evaluate("({ b: __dj.decks[1].playing, name: __dj.decks[1].el.name.textContent, bpm: __dj.decks[1].liveBpm })")
    check("transition starts deck B with the next track, tempo matched", mid["b"] and mid["name"] == "two.wav" and abs(mid["bpm"] - 120) < 1.5, str(mid))
    al = pg.evaluate("(() => { const a = __dj.decks[0].beatFrac(), b = __dj.decks[1].beatFrac(); let d = a - b; d -= Math.round(d); return Math.abs(d); })()")
    check("incoming track starts on the same point in the beat", al < 0.15, str(al))
    pg.wait_for_function("() => __am.S.tr === null && __am.S.idx === 1", timeout=15000)
    end = pg.evaluate("({ a: __dj.decks[0].playing, xf: +document.getElementById('xf').value, low: __dj.decks[1].low.gain.value })")
    check("after the transition A stops, crossfader is on B, bass restored", end["a"] is False and end["xf"] == 100 and end["low"] == 0, str(end))
    pg.click("#amgo")
    check("automix can be stopped", pg.inner_text("#amgo").startswith("▶"))
    check("dj extras: no errors", not errs, str(errs))
    ctx.close()


def test_stems(browser, base):
    print("stem splitter")
    errs = []
    ctx, pg = new_page(browser, errs)
    pg.goto(base + "dj.html?gvtest")
    r = pg.evaluate("""async () => { const { decks, ctx } = __dj, sr = 22050, n = sr * 8, o = {};
      const b = ctx.createBuffer(2, n, sr), L = b.getChannelData(0), R = b.getChannelData(1);
      let seed = 1; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
      for (let i = 0; i < n; i++) {
        const t = i / sr, bass = 0.4 * Math.sin(2 * Math.PI * 60 * t), voc = 0.25 * (Math.sin(2 * Math.PI * 1000 * t) + 0.5 * Math.sin(2 * Math.PI * 2000 * t)), gtr = 0.3 * Math.sin(2 * Math.PI * 330 * t);
        const hit = (i % (sr / 2)) < sr * 0.02 ? 0.8 * rnd() : 0;
        L[i] = bass + voc + gtr + hit; R[i] = bass + voc + hit;
      }
      decks[0].setBuffer(b, 'synthetic.wav', { bpm: null, key: null });
      const t0 = performance.now(); const ok = await __stems.split(0); o.ok = ok; o.ms = performance.now() - t0;
      const S = decks[0].stems; if (!S) return o;
      const en = (buf, f) => { const d = buf.getChannelData(0); let re = 0, im = 0; for (let i = 2000; i < n - 2000; i++) { const a = 2 * Math.PI * f * i / sr; re += d[i] * Math.cos(a); im += d[i] * Math.sin(a); } return (re * re + im * im) / n; };
      o.e60 = ['bass', 'vocals', 'drums', 'music'].map((k) => en(S[k], 60)); o.e1000 = ['bass', 'vocals', 'drums', 'music'].map((k) => en(S[k], 1000)); o.e330 = ['bass', 'vocals', 'drums', 'music'].map((k) => en(S[k], 330));
      let err = 0, ref = 0; const sum = (i, c) => ['bass', 'vocals', 'drums', 'music'].reduce((a, k) => a + S[k].getChannelData(Math.min(c, S[k].numberOfChannels - 1))[i], 0);
      for (let i = 2000; i < n - 2000; i++) { const e = sum(i, 0) - L[i]; err += e * e; ref += L[i] * L[i]; }
      o.recon = Math.sqrt(err / ref);
      const d = decks[0]; d.play(); await new Promise((r) => setTimeout(r, 400)); o.srcs = 1 + d.extra.length; o.playing = d.playing;
      d.sg.vocals.gain.value = 0; o.pos = d.position(); d.pause();
      o.channels = ['vocals', 'bass', 'drums', 'music'].map((k) => S[k].numberOfChannels);
      return o; }""")
    check("stem splitter finishes", r["ok"] is True, str(r))
    if r.get("ok"):
        e60, e1k, e330 = r["e60"], r["e1000"], r["e330"]   # order: bass, vocals, drums, music
        check("bass stem holds the 60 Hz tone", e60[0] > 5 * max(e60[1], e60[2], e60[3]), str(e60))
        check("vocals stem holds the centred 1 kHz tone, not music", e1k[1] > 3 * e1k[3] and e1k[1] > 3 * e1k[2], str(e1k))
        check("music stem holds the left-only 330 Hz tone, not vocals", e330[3] > 3 * e330[1], str(e330))
        check("stems add back up to the original (error < 2%)", r["recon"] < 0.02, str(r["recon"]))
        check("playback uses 4 synced sources and keeps running", r["srcs"] == 4 and r["playing"] and 0.2 < r["pos"] < 1.5, str(r))
        check("stem channel layout (mono vocals/bass, stereo drums/music)", r["channels"] == [1, 1, 2, 2], str(r["channels"]))
    pg.goto(base + "dj.html?gvtest")
    check("stem buttons absent until split, split button present", pg.locator("[data-r=stembox] button").count() == 2)
    check("stems: no errors", not errs, str(errs))
    ctx.close()


def test_grid(browser, base):
    print("beat grid, zoom waveform, jump, phase sync")
    errs = []
    ctx, pg = new_page(browser, errs)
    pg.goto(base + "dj.html?gvtest")
    r = pg.evaluate("""async () => { const { decks, ctx, detectGrid, detectBPM } = __dj, o = {};
      const mk = (bpm, off, secs, sr = 22050) => { const b = ctx.createBuffer(1, Math.round(sr * secs), sr), d = b.getChannelData(0), beat = sr * 60 / bpm;
        for (let t = off * sr; t < d.length; t += beat) { const i0 = Math.round(t); for (let k = 0; k < 400 && i0 + k < d.length; k++) d[i0 + k] += Math.sin(k / 6) * Math.exp(-k / 80); } return b; };
      const dev = (g, truth, off) => { const per = 60 / truth, x = ((g.t0 - off) / per); return Math.abs(x - Math.round(x)) * per; };
      const cases = [[120, 0.13, 40], [128, 0.2, 40], [126.37, 0.31, 150]];
      o.grid = cases.map(([bpm, off, secs]) => { const b = mk(bpm, off, secs), g = detectGrid(b, detectBPM(b)); return { bpmErr: Math.abs(g.bpm - bpm), phaseErr: dev(g, bpm, off) }; });
      const A = decks[0], B = decks[1];
      A.setBuffer(mk(120, 0, 40), 'a'); B.setBuffer(mk(124, 0.2, 40), 'b');
      o.info = A.el.ginfo.textContent;
      // snap + jump + nudge
      A.seek(5.2); A.hotCue(0); o.snapped = A.hot[0]; A.hot[0] = null;
      A.el.snap.checked = false; A.seek(5.2); A.hotCue(1); o.unsnapped = A.hot[1]; A.el.snap.checked = true;
      A.seek(10); A.el.jp4.click(); o.jumped = A.position(); A.el.jm1.click(); o.jumpedBack = A.position();
      const t0 = A.grid.t0; A.el.gp.click(); o.nudge = A.grid.t0 - t0; A.el.gm.click();
      A.seek(3.1); A.el.gh.click(); o.beat1 = A.grid.t0; A.grid.t0 = t0;
      // phase sync: A follows B while both play
      A.seek(3.1); B.seek(10); A.play(); B.play(); await new Promise((r) => setTimeout(r, 200));
      __dj.sync(0, 1); await new Promise((r) => setTimeout(r, 150));
      let d = A.beatFrac() - B.beatFrac(); d -= Math.round(d); o.phase = Math.abs(d); o.tempo = [A.liveBpm, B.liveBpm];
      A.pause(); B.pause();
      // zoom canvas has colour in it
      A.seek(5); await new Promise((r) => setTimeout(r, 200));
      const c = A.el.zoom, px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let lit = 0; for (let i = 3; i < px.length; i += 4) if (px[i] > 0) lit++;
      o.lit = lit; o.zoomSize = [c.width, c.height];
      return o; }""")
    for (bpm, off, secs), g in zip([(120, .13, 40), (128, .2, 40), (126.37, .31, 150)], r["grid"]):
        check(f"grid for {bpm} BPM (offset {off}s, {secs}s long): tempo within 0.05, first beat within 12 ms", g["bpmErr"] < 0.05 and g["phaseErr"] < 0.012, str(g))
    check("grid info shown", "BPM, beat 1 at" in r["info"], r["info"])
    check("hot cue snaps to the beat, and not when Snap is off", abs(r["snapped"] - 5.0) < 0.02 and abs(r["unsnapped"] - 5.2) < 0.05, f"{r['snapped']} / {r['unsnapped']}")
    check("beat jump +4 / -1", abs(r["jumped"] - 12) < 0.05 and abs(r["jumpedBack"] - 11.5) < 0.05, f"{r['jumped']} {r['jumpedBack']}")
    check("grid nudge and 'Beat 1 here'", abs(r["nudge"] - 0.01) < 1e-6 and abs(r["beat1"] - 3.1) < 0.05, f"{r['nudge']} {r['beat1']}")
    check("sync lines up the beats (within 8% of a beat) and matches tempo", r["phase"] < 0.08 and abs(r["tempo"][0] - r["tempo"][1]) < 0.05, str((r["phase"], r["tempo"])))
    check("zoomed waveform is drawn", r["lit"] > 2000, str((r["lit"], r["zoomSize"])))
    check("grid: no errors", not errs, str(errs))
    ctx.close()


def test_controls(browser, base):
    print("keyboard, MIDI, meters, limiter")
    errs = []
    ctx, pg = new_page(browser, errs)
    pg.goto(base + "dj.html?gvtest")
    pg.evaluate("""() => { const { decks, ctx } = __dj, sr = 22050, mk = (amp) => { const b = ctx.createBuffer(2, sr * 20, sr);
      for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] = amp * Math.sin(2 * Math.PI * 440 * i / sr); } return b; };
      window.__mk = mk; decks[0].setBuffer(mk(0.3), 'a.wav', { bpm: null, key: null }); decks[1].setBuffer(mk(0.3), 'b.wav', { bpm: null, key: null }); }""")
    pg.keyboard.press("q")
    check("Q plays deck A", pg.evaluate("__dj.decks[0].playing"))
    pg.keyboard.press("q")
    check("Q again pauses deck A", pg.evaluate("__dj.decks[0].playing") is False)
    pg.keyboard.press("p")
    check("P plays deck B", pg.evaluate("__dj.decks[1].playing"))
    pg.keyboard.press("p")
    pg.evaluate("__dj.decks[0].seek(4)")
    pg.keyboard.press("1")
    check("1 sets hot cue 1 on deck A", pg.evaluate("__dj.decks[0].hot[0] !== null"))
    pg.keyboard.press("]"); pg.keyboard.press("]")
    check("] moves the crossfader towards B", pg.input_value("#xf") == "60")
    pg.keyboard.press("\\")
    check("backslash centres the crossfader", pg.input_value("#xf") == "50")
    pg.click("#tab-beat")
    pg.fill("#bname", "qpe")
    check("typing in a text box does not trigger shortcuts", pg.evaluate("!__dj.decks[0].playing && !__dj.decks[1].playing") and pg.input_value("#bname") == "qpe")
    pg.keyboard.press("?")
    pg.locator("#bname").blur()
    pg.keyboard.press("?")
    check("? opens the shortcut list and focuses Close", not pg.locator("#helpmodal").evaluate("e => e.classList.contains('hidden')") and pg.evaluate("document.activeElement.id") == "helpclose")
    pg.keyboard.press("q")
    check("shortcuts are paused while the dialog is open", pg.evaluate("!__dj.decks[0].playing"))
    pg.keyboard.press("Escape")
    check("Escape closes the list", pg.locator("#helpmodal").evaluate("e => e.classList.contains('hidden')"))
    # MIDI
    pg.evaluate("__ctl.learn('xf')"); pg.evaluate("__ctl.handle([0xB0, 21, 10])")
    pg.evaluate("__ctl.learn('a.play')"); pg.evaluate("__ctl.handle([0x90, 36, 100])")
    pg.evaluate("__ctl.learn('b.tempo')"); pg.evaluate("__ctl.handle([0xB1, 5, 64])")
    pg.evaluate("__ctl.handle([0xB0, 21, 127])")
    check("MIDI knob moves the crossfader", pg.input_value("#xf") == "100")
    pg.evaluate("__ctl.handle([0xB0, 21, 0])")
    check("MIDI knob at 0 moves it back", pg.input_value("#xf") == "0")
    pg.evaluate("__ctl.handle([0x90, 36, 100])")
    check("MIDI note presses play on deck A", pg.evaluate("__dj.decks[0].playing"))
    pg.evaluate("__ctl.handle([0x80, 36, 0])"); pg.evaluate("__ctl.handle([0x90, 36, 0])")
    check("note-off does nothing", pg.evaluate("__dj.decks[0].playing"))
    pg.evaluate("__ctl.handle([0x90, 36, 90])")
    pg.evaluate("__ctl.handle([0xB1, 5, 127])")
    check("MIDI tempo fader on channel 2 reaches +16%", pg.evaluate("document.querySelectorAll('[data-r=tempo]')[1].value") == "16")
    pg.reload()
    check("MIDI mapping survives a reload", len(pg.evaluate("Object.keys(JSON.parse(localStorage.getItem('govibe.midimap')))")) == 3)
    pg.goto(base + "dj.html?gvtest")
    pg.click("#midibtn")
    pg.wait_for_timeout(500)
    check("Connect MIDI gives a clear message either way", len(pg.inner_text("#midistatus")) > 10, pg.inner_text("#midistatus"))
    # meters + limiter
    pg.evaluate("""() => { const d = __dj.decks[0]; const sr = 22050, b = __dj.ctx.createBuffer(2, sr * 20, sr); for (let c = 0; c < 2; c++) { const x = b.getChannelData(c); for (let i = 0; i < x.length; i++) x[i] = 4 * Math.sin(2 * Math.PI * 440 * i / sr); } d.setBuffer(b, 'loud.wav', { bpm: null, key: null }); document.getElementById('xf').value = 0; __dj.applyXf(); d.play(); }""")
    pg.wait_for_timeout(500)
    on = pg.evaluate("__ctl.peak()")
    pg.uncheck("#lim"); pg.wait_for_timeout(300)
    off = pg.evaluate("__ctl.peak()")
    pg.check("#lim"); pg.wait_for_timeout(300)
    lit = pg.evaluate("(() => { const c = document.getElementById('mmeter'), p = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < p.length; i += 4) if (p[i] > 150 || p[i + 1] > 150) n++; return n; })()")
    check("limiter keeps a +12 dB signal below full scale", max(on) < 0.95, str(on))
    check("with the limiter off the same signal goes over full scale", max(off) > 1.5, str(off))
    check("the master meter draws", lit > 300, str(lit))
    check("limiter note appears while limiting", "limiting" in pg.inner_text("#limred"), pg.inner_text("#limred"))
    check("controls: no errors", not errs, str(errs))
    ctx.close()


def make_wav(path, bpm, secs=24, sr=22050, tone=220.0):
    import math, wave
    n = int(sr * secs); beat = sr * 60 / bpm; frames = bytearray()
    for i in range(n):
        ph = (i % beat) / sr
        v = 0.25 * math.sin(2 * math.pi * tone * i / sr) + 0.6 * math.exp(-ph * 20) * math.sin(2 * math.pi * (60 + 100 * math.exp(-ph * 30)) * ph)
        frames += struct.pack("<h", int(max(-1, min(1, v)) * 30000))
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes(bytes(frames))


def test_console(browser, base):
    print("console: knobs, tabs, jog, bend, WAV recording, library")
    import tempfile
    errs = []
    ctx, pg = new_page(browser, errs, viewport={"width": 1400, "height": 1000})
    pg.goto(base + "dj.html?gvtest")
    # knobs and faders
    k = pg.locator("#strip0 .knob").first; box = k.bounding_box()
    pg.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2); pg.mouse.down(); pg.mouse.move(box["x"] + box["width"] / 2, box["y"] - 20, steps=5); pg.mouse.up()
    up = pg.evaluate("+document.querySelector('#strip0 [data-r=high]').value")
    check("dragging a knob up raises its value and the EQ", up > 0 and pg.evaluate("__dj.decks[0].high.gain.value") == up, str(up))
    k.dblclick()
    check("double-click resets a knob", pg.evaluate("+document.querySelector('#strip0 [data-r=high]').value") == 0)
    pg.evaluate("document.querySelector('#strip0 [data-r=high]').focus()"); pg.keyboard.press("ArrowDown")
    check("knobs work from the keyboard", pg.evaluate("+document.querySelector('#strip0 [data-r=high]').value") < 0)
    d0 = pg.evaluate("document.querySelector('#deck1 .fxrow .kn:nth-child(2) .kval').getAttribute('d')")
    pg.evaluate("document.querySelector('#deck1 [data-r=echo]').value = 70"); pg.wait_for_timeout(200)
    d1 = pg.evaluate("document.querySelector('#deck1 .fxrow .kn:nth-child(2) .kval').getAttribute('d')")
    check("knob redraws when its value is set from code (MIDI, automix)", d0 != d1, f"{d0!r} {d1!r}")
    # tabs
    pg.focus("#tab-lib"); pg.keyboard.press("ArrowRight")
    check("arrow keys move between tabs", pg.get_attribute("#tab-hist", "aria-selected") == "true" and pg.locator("#pane-hist").is_visible() and not pg.locator("#pane-lib").is_visible())
    pg.click("#tab-lib")
    # jog scratch + bend
    pg.evaluate("""() => { const { decks, ctx } = __dj, sr = 22050, b = ctx.createBuffer(2, sr * 30, sr); for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] = 0.3 * Math.sin(2 * Math.PI * 330 * i / sr); }
      decks[0].setBuffer(b, 'tone.wav', { bpm: null, key: null }); decks[0].seek(5); }""")
    pg.evaluate("window.scrollTo(0, 400)"); pg.wait_for_timeout(100)
    jb = pg.locator("#deck0 [data-r=jog]").bounding_box(); cx, cy, R = jb["x"] + jb["width"] / 2, jb["y"] + jb["height"] / 2, jb["width"] / 2
    import math
    pg.mouse.move(cx + R * 0.8, cy); pg.mouse.down()
    mid = pg.evaluate("[__dj.decks[0].scratching, __dj.decks[0].playing]")
    for a in range(0, 91, 10):
        pg.mouse.move(cx + R * 0.8 * math.cos(math.radians(a)), cy + R * 0.8 * math.sin(math.radians(a))); pg.wait_for_timeout(30)
    pg.mouse.up()
    pos = pg.evaluate("__dj.decks[0].position()")
    check("scratch: dragging a quarter turn clockwise moves 1/4 of a revolution (0.45 s) forward", mid == [True, False] and abs(pos - 5.45) < 0.12 and pg.evaluate("__dj.decks[0].scratching") is False, str((mid, pos)))
    pg.mouse.move(cx + R * 0.8, cy); pg.mouse.down()
    for a in range(0, -91, -10):
        pg.mouse.move(cx + R * 0.8 * math.cos(math.radians(a)), cy + R * 0.8 * math.sin(math.radians(a))); pg.wait_for_timeout(30)
    pg.mouse.up()
    check("scratch: dragging anticlockwise goes backwards", abs(pg.evaluate("__dj.decks[0].position()") - 5.0) < 0.12, str(pg.evaluate("__dj.decks[0].position()")))
    pg.evaluate("__dj.decks[0].play()")
    pg.mouse.move(cx + R * 0.8, cy); pg.mouse.down(); pg.mouse.move(cx, cy + R * 0.8, steps=6); pg.mouse.up()
    check("deck resumes playing after a scratch if it was playing", pg.evaluate("__dj.decks[0].playing"))
    pg.locator("#deck0 [data-r=nudgep]").scroll_into_view_if_needed(); pg.locator("#deck0 [data-r=nudgep]").hover(); pg.mouse.down(); pg.wait_for_timeout(120)
    held = pg.evaluate("[__dj.decks[0].bendF, __dj.decks[0].src.playbackRate.value]")
    pg.mouse.up(); pg.wait_for_timeout(120)
    check("holding Bend speeds the deck up by 6% and release restores it", abs(held[0] - 1.06) < 1e-6 and abs(held[1] - 1.06) < 0.001 and pg.evaluate("__dj.decks[0].bendF") == 1 and abs(pg.evaluate("__dj.decks[0].src.playbackRate.value") - 1) < 0.001, str(held))
    pg.evaluate("__dj.decks[0].pause()")
    # WAV recording
    pg.evaluate("document.querySelectorAll('#pads .pad')[0].click()")
    pg.click("#rec"); pg.wait_for_timeout(300)
    for _ in range(3):
        pg.click("#pads .pad >> nth=0"); pg.wait_for_timeout(450)
    pg.click("#rec"); pg.wait_for_selector("#recdl:not(.hidden)", timeout=8000)
    w = pg.evaluate("""async () => { const a = document.getElementById('recdl'), u = new Uint8Array(await (await fetch(a.href)).arrayBuffer()), v = new DataView(u.buffer);
      let pk = 0; for (let i = 44; i < u.length; i += 2) pk = Math.max(pk, Math.abs(v.getInt16(i, true)));
      return { name: a.download, riff: String.fromCharCode(...u.slice(0, 4)), ch: v.getUint16(22, true), sr: v.getUint32(24, true), bits: v.getUint16(34, true), secs: v.getUint32(40, true) / 4 / v.getUint32(24, true), pk }; }""")
    check("WAV recording: valid 16-bit stereo file with the mix in it", w["name"] == "govibe-mix.wav" and w["riff"] == "RIFF" and w["ch"] == 2 and w["bits"] == 16 and 1.3 < w["secs"] < 3.5 and w["pk"] > 2000, str(w))
    pg.select_option("#recfmt", "webm"); pg.click("#rec"); pg.wait_for_timeout(300); pg.click("#pads .pad >> nth=0"); pg.wait_for_timeout(500); pg.click("#rec")
    pg.wait_for_function("() => document.getElementById('recdl').download.endsWith('webm')", timeout=8000) if False else pg.wait_for_timeout(800)
    check("compressed recording still works", (pg.get_attribute("#recdl", "download") or "").endswith((".webm", ".ogg", ".m4a")), str(pg.get_attribute("#recdl", "download")))
    # library
    tmp = tempfile.mkdtemp(); f1, f2 = tmp + "/Click 120.wav", tmp + "/Other 128.wav"
    make_wav(f1, 120); make_wav(f2, 128, tone=330.0)
    pg.set_input_files("#libfile", [f1, f2])
    pg.wait_for_function("() => document.querySelectorAll('#libbody tr[data-id]').length === 2", timeout=30000)
    rows = pg.evaluate("[...document.querySelectorAll('#libbody tr[data-id]')].map((r) => [r.cells[0].textContent.replace(/fits.*/, ''), r.cells[1].textContent])")
    check("library lists added tracks with detected BPM", sorted(x[0] for x in rows) == ["Click 120.wav", "Other 128.wav"] and all(abs(float(x[1]) - (120 if "120" in x[0] else 128)) < 0.5 for x in rows), str(rows))
    pg.reload(); pg.wait_for_function("() => document.querySelectorAll('#libbody tr[data-id]').length === 2", timeout=10000)
    check("library survives a reload", True)
    pg.fill("#libq", "click")
    check("library search filters", pg.locator("#libbody tr[data-id]").count() == 1)
    pg.fill("#libq", "")
    pg.select_option("#libsort", "bpm")
    check("library sorts by BPM", pg.locator("#libbody tr[data-id] td:nth-child(2)").first.inner_text().startswith("120"))
    pg.locator("#libbody tr[data-id]", has_text="Click 120").get_by_role("button", name=re.compile("into deck B")).click()
    pg.wait_for_function("() => __dj.decks[1].buf !== null", timeout=10000)
    check("library loads a track into a deck with its saved analysis", pg.inner_text("#deck1 [data-r=name]") == "Click 120.wav" and abs(pg.evaluate("__dj.decks[1].bpm") - 120) < 0.5)
    pg.evaluate("__dj.decks[1].seek(6.0)"); pg.click("#deck1 [data-r=hot1]"); pg.wait_for_timeout(600)
    pg.reload(); pg.wait_for_function("() => document.querySelectorAll('#libbody tr[data-id]').length === 2", timeout=10000)
    pg.locator("#libbody tr[data-id]", has_text="Click 120").get_by_role("button", name=re.compile("into deck B")).click()
    pg.wait_for_function("() => __dj.decks[1].buf !== null", timeout=10000)
    check("hot cues are remembered with the track", abs((pg.evaluate("__dj.decks[1].hot[0]") or -1) - 6.0) < 0.3, str(pg.evaluate("__dj.decks[1].hot")))
    pg.locator("#libbody tr[data-id]", has_text="Other 128").get_by_role("button", name=re.compile("Automix queue")).click()
    pg.wait_for_function("() => __am.queue.length === 1", timeout=10000)
    check("library can queue a track for Automix", True)
    f3 = tmp + "/Direct 100.wav"; make_wav(f3, 100)
    pg.set_input_files("#deck0 [data-r=file]", f3)
    pg.wait_for_function("() => document.querySelectorAll('#libbody tr[data-id]').length === 3", timeout=30000)
    check("a file loaded into a deck is remembered in the library", pg.evaluate("__dj.decks[0].libId") is not None)
    pg.click("#deck0 [data-r=hot2]"); pg.wait_for_timeout(500)
    pg.set_input_files("#deck0 [data-r=file]", f3); pg.wait_for_timeout(1500)
    check("reloading the same file restores its saved cues", pg.evaluate("__dj.decks[0].hot[1]") is not None)
    pg.locator("#libbody tr[data-id]", has_text="Direct 100").get_by_role("button", name=re.compile("^Remove")).click()
    pg.wait_for_function("() => document.querySelectorAll('#libbody tr[data-id]').length === 2", timeout=10000)
    check("library tracks can be removed", True)
    check("console: no errors", not [e for e in errs if "Failed to load resource" not in e], str(errs))
    ctx.close()


def test_backup_history(browser, base):
    print("library backup, tags, set history")
    import tempfile, zipfile, base64, io
    errs = []
    ctx, pg = new_page(browser, errs, viewport={"width": 1400, "height": 1000})
    pg.goto(base + "dj.html?gvtest&gvlog=2")
    tmp = tempfile.mkdtemp(); f1, f2 = tmp + "/Click 120.wav", tmp + "/Other 128.wav"
    make_wav(f1, 120); make_wav(f2, 128, tone=330.0)
    pg.set_input_files("#libfile", [f1, f2])
    pg.wait_for_function("() => document.querySelectorAll('#libbody tr[data-id]').length === 2", timeout=30000)
    row = lambda n: pg.locator("#libbody tr[data-id]", has_text=n)
    row("Click 120").locator(".libtag").select_option("red")
    pg.wait_for_timeout(400)
    check("a track can be given a colour tag", "tag-red" in (row("Click 120").get_attribute("class") or ""))
    pg.select_option("#libtagf", "red"); pg.wait_for_timeout(200)
    check("tag filter shows only matching tracks", pg.locator("#libbody tr[data-id]").count() == 1)
    pg.select_option("#libtagf", ""); pg.wait_for_timeout(200)
    row("Other 128").locator("input[type=text], textarea").first.fill("fav") if row("Other 128").locator("input[type=text], textarea").count() else None
    # zip backup
    b64 = pg.evaluate("""async () => { const b = await __lib.exportZip(), u = new Uint8Array(await b.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode(...u.subarray(i, i + 8192)); return btoa(s); }""")
    z = zipfile.ZipFile(io.BytesIO(base64.b64decode(b64)))
    names = z.namelist(); lib = json.loads(z.read("library.json"))
    check("backup zip is valid, has library.json and one audio file per track", z.testzip() is None and "library.json" in names and len([n for n in names if n.startswith("audio/")]) == 2 and len(lib["tracks"]) == 2, str(names))
    check("backup keeps tags", any(t.get("tag") == "red" for t in lib["tracks"]))
    zp = tmp + "/backup.zip"; open(zp, "wb").write(base64.b64decode(b64))
    jp = tmp + "/backup.json"; json.dump(lib, open(jp, "w"))
    # clear and restore from zip
    for _ in range(2):
        pg.locator("#libbody tr[data-id]").first.get_by_role("button", name=re.compile("^Remove")).click(); pg.wait_for_timeout(300)
    check("library emptied", pg.locator("#libbody tr[data-id]").count() == 0)
    pg.set_input_files("#libimpfile", zp)
    pg.wait_for_function("() => document.querySelectorAll('#libbody tr[data-id]').length === 2", timeout=20000)
    check("zip import restores tracks and tags", "tag-red" in (row("Click 120").get_attribute("class") or "") and pg.locator("#libbody tr.libmissing").count() == 0)
    row("Click 120").get_by_role("button", name=re.compile("into deck A")).click()
    pg.wait_for_function("() => __dj.decks[0].buf !== null", timeout=15000)
    check("restored audio loads into a deck", abs(pg.evaluate("__dj.decks[0].bpm") - 120) < 0.5)
    # json-only import -> placeholders
    for _ in range(2):
        pg.locator("#libbody tr[data-id]").first.get_by_role("button", name=re.compile("^Remove")).click(); pg.wait_for_timeout(300)
    pg.set_input_files("#libimpfile", jp)
    pg.wait_for_function("() => document.querySelectorAll('#libbody tr.libmissing').length === 2", timeout=20000)
    check("json import makes 'audio missing' placeholders with load disabled", row("Click 120").get_by_role("button", name=re.compile("into deck A")).is_disabled())
    pg.set_input_files("#libfile", [f1]); pg.wait_for_timeout(2500)
    check("adding the file fills the placeholder and keeps its tag", pg.locator("#libbody tr.libmissing").count() == 1 and "tag-red" in (row("Click 120").get_attribute("class") or "") and pg.locator("#libbody tr[data-id]").count() == 2)
    pg.set_input_files("#libimpfile", f1); pg.wait_for_timeout(500)
    check("importing a non-backup file is refused without crashing", pg.locator("#libbody tr[data-id]").count() == 2)
    # history
    pg.evaluate("""() => { const b = __dj.ctx.createBuffer(2, 22050 * 20, 22050); for (let c = 0; c < 2; c++) b.getChannelData(c).fill(0.05); __dj.decks[0].setBuffer(b, 'Hist One.wav', { bpm: 123, key: '8A' }); __dj.decks[0].play(); }""")
    pg.wait_for_function("() => __hist.log.length === 1", timeout=8000)
    pg.wait_for_timeout(2500)
    check("a track is logged once after the threshold, not repeatedly", pg.evaluate("__hist.log.length") == 1)
    pg.click("#tab-hist")
    check("history table lists it", "Hist One" in pg.inner_text("#hbody") and "123.0" in pg.inner_text("#hbody"))
    pg.click("#hnew"); pg.evaluate("__dj.decks[0].pause(); __dj.decks[0].seek(0); __dj.decks[0].play()")
    pg.wait_for_function("() => __hist.log.length === 3", timeout=8000)
    check("new-set marker adds a break and the same track logs again", "New set" in pg.inner_text("#hbody") and pg.evaluate("__hist.log[1].brk") is True)
    csv = pg.evaluate("__hist.csv()"); txt = pg.evaluate("__hist.text()")
    check("CSV and text set list export", csv.splitlines()[0].startswith("Date,Time,Title") and len(csv.strip().splitlines()) == 3 and "1. Hist One" in txt and "New set" in txt, csv + txt)
    # recording tracklist
    pg.click("#tab-lib"); pg.click("#rec"); pg.wait_for_timeout(600)
    pg.evaluate("__dj.decks[0].pause(); __dj.decks[0].seek(0); __dj.decks[0].setBuffer(__dj.ctx.createBuffer(2, 22050 * 20, 22050), 'Hist Two.wav', { bpm: 100, key: null }); __dj.decks[0].play()")
    pg.wait_for_function("() => __hist.log.length === 4", timeout=8000)
    pg.click("#rec"); pg.wait_for_selector("#recdl:not(.hidden)", timeout=8000)
    pg.click("#tab-hist")
    check("tracklist button enables after a recording", not pg.locator("#hrec").is_disabled())
    pg.click("#hrec"); out = pg.input_value("#hout")
    check("tracklist has timecodes relative to the recording", re.search(r"^00:0\d  Hist Two \(100 BPM\)$", out, re.M) is not None, out)
    pg.reload(); pg.click("#tab-hist")
    check("history survives a reload", pg.locator("#hbody tr").count() >= 4)
    pg.once("dialog", lambda d: d.accept()); pg.click("#hclear")
    check("history can be cleared", "Nothing played yet" in pg.inner_text("#hbody"))
    # a11y + phone
    axe = os.environ.get("AXE_PATH") or os.path.join(ROOT, "node_modules/axe-core/axe.min.js")
    if os.path.exists(axe):
        js = "axe.run(document,{runOnly:['wcag2a','wcag2aa','wcag21a','wcag21aa','best-practice']}).then(r=>r.violations.map(v=>v.id+' x'+v.nodes.length+' '+v.nodes[0].target.join(' ')))"
        c2 = browser.new_context(bypass_csp=True); p2 = c2.new_page()
        for theme in ("dark", "light"):
            p2.goto(base + "dj.html"); p2.evaluate(f"localStorage.setItem('govibe.djtheme', '{theme}')"); p2.reload()
            p2.add_script_tag(path=axe)
            check(f"history tab ({theme}): no axe violations", not (v := (p2.click("#tab-hist"), p2.evaluate(js))[1]), str(v))
            check(f"library backup row ({theme}): no axe violations", not (v := (p2.click("#tab-lib"), p2.evaluate(js))[1]), str(v))
        c2.close()
    pg.set_viewport_size({"width": 390, "height": 800}); pg.wait_for_timeout(200)
    check("no horizontal overflow at 390px with the new tabs", pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"))
    check("backup/history: no errors", not [e for e in errs if "Failed to load resource" not in e and "not a GoVibe Mix" not in e], str(errs))
    ctx.close()


def test_views(browser, base):
    print("performance view, light theme, ratings and notes")
    import tempfile
    errs = []
    ctx, pg = new_page(browser, errs, viewport={"width": 1400, "height": 1000})
    pg.goto(base + "dj.html?gvtest")
    check("starts in the dark console with the nav visible", pg.evaluate("document.documentElement.getAttribute('data-theme')") is None and pg.locator(".nav").is_visible())
    pg.click("#perfbtn")
    check("full view hides the nav, tabs and footer", pg.evaluate("document.documentElement.classList.contains('perf')") and not pg.locator(".nav").is_visible() and not pg.locator(".tools").is_visible() and pg.get_attribute("#perfbtn", "aria-pressed") == "true")
    pg.keyboard.press("Escape")
    check("Escape leaves full view", not pg.evaluate("document.documentElement.classList.contains('perf')") and pg.locator(".nav").is_visible())
    pg.keyboard.press("f"); pg.keyboard.press("f")
    check("F toggles full view", not pg.evaluate("document.documentElement.classList.contains('perf')"))
    pg.click("#themebtn")
    check("light theme applies and is remembered", pg.evaluate("document.documentElement.getAttribute('data-theme')") == "light" and pg.inner_text("#themebtn").endswith("Dark"))
    pg.reload()
    check("theme survives a reload (applied before first paint)", pg.evaluate("document.documentElement.getAttribute('data-theme')") == "light")
    axe = os.environ.get("AXE_PATH") or os.path.join(ROOT, "node_modules/axe-core/axe.min.js")
    if os.path.exists(axe):
        ctx2 = browser.new_context(bypass_csp=True, viewport={"width": 1400, "height": 1000}); p2 = ctx2.new_page()
        p2.goto(base + "dj.html"); p2.evaluate("localStorage.setItem('govibe.djtheme', 'light')"); p2.reload()
        p2.add_script_tag(path=axe)
        js = "axe.run(document,{runOnly:['wcag2a','wcag2aa','wcag21a','wcag21aa','best-practice']}).then(r=>r.violations.map(v=>v.id+' x'+v.nodes.length+' '+v.nodes[0].target.join(' ')))"
        check("light theme: no axe violations", not (v := p2.evaluate(js)), str(v))
        p2.click("#tab-beat")
        check("light theme, beat tab: no axe violations", not (v := p2.evaluate(js)), str(v))
        ctx2.close()
    pg.click("#themebtn")
    # ratings and notes
    tmp = tempfile.mkdtemp(); f1, f2 = tmp + "/Alpha.wav", tmp + "/Beta.wav"; make_wav(f1, 120, 12); make_wav(f2, 126, 12, tone=300.0)
    pg.set_input_files("#libfile", [f1, f2])
    pg.wait_for_function("() => document.querySelectorAll('#libbody tr[data-id]').length === 2", timeout=30000)
    row = pg.locator("#libbody tr[data-id]", has_text="Alpha")
    row.get_by_role("button", name="4 stars").click()
    pg.locator("#libbody tr[data-id]", has_text="Alpha").locator(".libnote").fill("great opener, 8A"); pg.locator("#libbody tr[data-id]", has_text="Alpha").locator(".libnote").dispatch_event("change")
    pg.wait_for_timeout(300)
    pg.reload(); pg.wait_for_function("() => document.querySelectorAll('#libbody tr[data-id]').length === 2", timeout=10000)
    st = pg.evaluate("[...document.querySelectorAll('#libbody tr[data-id]')].map((r) => [r.cells[0].textContent.replace(/fits.*/, ''), [...r.querySelectorAll('.star')].filter((b) => b.getAttribute('aria-pressed') === 'true').length, r.querySelector('.libnote').value])")
    check("rating and note are saved with the track", sorted(st) == [["Alpha.wav", 4, "great opener, 8A"], ["Beta.wav", 0, ""]], str(st))
    pg.select_option("#libminrate", "4")
    check("minimum-rating filter", pg.locator("#libbody tr[data-id]").count() == 1)
    pg.select_option("#libminrate", "0"); pg.fill("#libq", "opener")
    check("search also looks in notes", pg.locator("#libbody tr[data-id]").count() == 1)
    pg.fill("#libq", ""); pg.select_option("#libsort", "rating")
    check("sort by rating puts the best first", pg.locator("#libbody tr[data-id]").first.inner_text().startswith("Alpha"))
    row = pg.locator("#libbody tr[data-id]", has_text="Alpha"); row.get_by_role("button", name="4 stars").click()
    check("clicking the same star again clears the rating", pg.evaluate("__lib.recs.find((r) => r.name === 'Alpha.wav').rating") == 0)
    check("views: no errors", not [e for e in errs if "Failed to load resource" not in e], str(errs))
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
        for t in (test_pages, test_a11y, test_editor, test_create, test_dj, test_dj_extras, test_stems, test_grid, test_controls, test_console, test_backup_history, test_views, test_lessons, test_video, test_offline):
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
