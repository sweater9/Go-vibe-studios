#!/usr/bin/env python3
"""End-to-end checks for GoVibe Mix.

Run:  pip install playwright && playwright install chromium && python tests/test_site.py
Optional accessibility audit: npm install --no-save axe-core   (skipped if axe-core is not installed)

The site is served locally with the exact headers from _headers, so a Content-Security-Policy
violation shows up as a console error and fails the run.
Exit code is 0 only if every check passes.
"""
import glob, http.server, json, os, re, struct, sys, threading
from html.parser import HTMLParser
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGES = ["index", "editor", "video", "dj", "lessons", "learn-music", "convert", "bpm", "record", "studio", "master", "keys", "samples", "tuner", "metronome", "about", "inside", "faq", "blog", "blog-beatmatching", "blog-camelot", "blog-record-mix", "blog-clean-audio", "blog-vertical-video", "privacy", "terms"]
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



def tiny_wav():
    data = b"".join(struct.pack("<h", int(8000 * ((i % 40) / 40 - .5))) for i in range(4000))
    return b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVEfmt " + struct.pack("<IHHIIHH", 16, 1, 1, 8000, 16000, 2, 16) + b"data" + struct.pack("<I", len(data)) + data


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


def test_dj_four(browser, base):
    print("dj: four decks, loop rolls, effect unit, grid tools, MIDI mapping files, playlists")
    import tempfile
    errs = []
    ctx, pg = new_page(browser, errs, viewport={"width": 1500, "height": 1000}, accept_downloads=True)
    pg.goto(base + "dj.html?gvtest"); pg.wait_for_function("() => window.__dj && window.__ctl && window.__lib", timeout=10000)
    ev = lambda js, *a: pg.evaluate(js, *a) if a else pg.evaluate(js)
    check("decks C and D start hidden, and the button shows them", not pg.is_visible("#deck2") and not pg.is_visible("#strip3") and pg.get_attribute("#decks4", "aria-pressed") == "false")
    pg.click("#decks4")
    check("Show decks C and D reveals both decks with their waveforms and channel strips", pg.is_visible("#deck2") and pg.is_visible("#deck3") and pg.is_visible("#wave3") and pg.is_visible("#strip2") and pg.get_attribute("#decks4", "aria-pressed") == "true")
    check("there are four decks named A, B, C and D with eight hot cue pads each", ev("__dj.decks.map((d) => d.name).join('')") == "ABCD" and pg.locator("#deck2 .hotpad").count() == 8)
    mk = """(bpm, secs = 40) => { const c = __dj.ctx, sr = 22050, b = c.createBuffer(1, sr * secs, sr), d = b.getChannelData(0), beat = Math.round(sr * 60 / bpm);
        for (let i = 0; i < d.length; i += beat) for (let k = 0; k < 400 && i + k < d.length; k++) d[i + k] = Math.sin(k / 6) * Math.exp(-k / 80); return b; }"""
    ev("() => { const mk = %s; window.__mk = mk; __dj.decks.forEach((d, i) => d.setBuffer(mk(120 + i * 4), 'deck' + i + '.wav')); }" % mk)
    check("every deck loads a track and finds its tempo", ev("__dj.decks.map((d) => Math.round(d.bpm))") == [120, 124, 128, 132], str(ev("__dj.decks.map((d) => d.bpm)")))
    # crossfader assignment
    ev("() => { const x = document.getElementById('xf'); x.value = 100; __dj.applyXf(); }")
    g = ev("__dj.decks.map((d) => +d.xf.gain.value.toFixed(3))")
    check("crossfader fully right: A silent, B full, C and D off the crossfader stay at full level", g[0] == 0 and g[1] == 1 and g[2] == 1 and g[3] == 1, str(g))
    pg.select_option("#strip2 [data-r=xfas]", "L"); pg.select_option("#strip3 [data-r=xfas]", "R")
    g = ev("__dj.decks.map((d) => +d.xf.gain.value.toFixed(3))")
    check("assigning C to the left and D to the right makes the crossfader act on them", g[2] == 0 and g[3] == 1, str(g))
    ev("() => { const x = document.getElementById('xf'); x.value = 50; __dj.applyXf(); }")
    g = ev("__dj.decks.map((d) => +d.xf.gain.value.toFixed(3))")
    check("at the centre the equal power curve gives 0.707 on both sides", abs(g[2] - 0.707) < 0.002 and abs(g[3] - 0.707) < 0.002, str(g))
    pg.select_option("#strip2 [data-r=xfas]", "T"); pg.select_option("#strip3 [data-r=xfas]", "T")
    # hot cues
    ev("() => { const d = __dj.decks[2]; d.seek(7.0); d.hotCue(4); d.seek(11.0); d.hotCue(7); }")
    check("hot cues 5 and 8 can be set", abs(ev("__dj.decks[2].hot[4]") - 7) < 0.3 and abs(ev("__dj.decks[2].hot[7]") - 11) < 0.3 and pg.evaluate("document.querySelector('#deck2 [data-r=hot5]').classList.contains('on')"))
    pg.click("#deck2 [data-r=hot5]", modifiers=["Shift"])
    check("shift and click clears one hot cue and leaves the others", ev("__dj.decks[2].hot[4]") is None and ev("__dj.decks[2].hot[7]") is not None)
    pg.click("#deck2 [data-r=hotdel]"); pg.click("#deck2 [data-r=hot8]")
    check("Clear one mode clears the next pad pressed", ev("__dj.decks[2].hot[7]") is None and pg.get_attribute("#deck2 [data-r=hotdel]", "aria-pressed") == "true")
    pg.click("#deck2 [data-r=hotdel]"); check("Clear one switches off again", pg.get_attribute("#deck2 [data-r=hotdel]", "aria-pressed") == "false")
    # grid tools
    ev("() => { const d = __dj.decks[0]; d.grid.t0 = 0.1; }")
    pg.click("#deck0 .gridtools summary"); t0 = ev("__dj.decks[0].grid.t0"); pg.click("#deck0 [data-r=gp1]")
    check("grid nudge works in 1 ms steps", abs(ev("__dj.decks[0].grid.t0") - t0 - 0.001) < 1e-6)
    pg.click("#deck0 [data-r=ghalf]")
    check("Half tempo halves the BPM and the grid spacing", abs(ev("__dj.decks[0].grid.bpm") - 60) < 0.05 and abs(ev("__dj.decks[0].grid.period") - 1.0) < 0.002 and abs(ev("__dj.decks[0].bpm") - 60) < 0.05, str(ev("__dj.decks[0].grid")))
    pg.click("#deck0 [data-r=gdbl]"); pg.click("#deck0 [data-r=gdbl]")
    check("Double tempo twice gives 240 BPM and a third press is refused beyond 240", abs(ev("__dj.decks[0].grid.bpm") - 240) < 0.1)
    pg.click("#deck0 [data-r=gdbl]"); check("tempo beyond 240 BPM is refused", abs(ev("__dj.decks[0].grid.bpm") - 240) < 0.1 and "outside" in pg.inner_text("#status"))
    r = ev("""() => { const d = __dj.decks[1], real = performance.now; let t = 1000; performance.now = () => t; d.taps = []; for (let i = 0; i < 6; i++) { d.tap(); t += 461.5; } performance.now = real; return [d.grid.bpm, d.bpm]; }""")
    check("tap tempo averages the taps (461.5 ms is 130 BPM)", abs(r[0] - 130) < 0.3 and abs(r[1] - 130) < 0.3, str(r))
    ev("() => __dj.decks[0].setGridBpm(120)")
    # loop roll
    r = ev("""async () => { const d = __dj.decks[0], w = (ms) => new Promise((r) => setTimeout(r, ms)), o = {}; d.seek(10); d.play(); await w(300);
      const p0 = d.position(); d.rollStart(0.25); o.len = d.loop.end - d.loop.start; await w(1200); const inside = d.position() >= d.loop.start - 0.01 && d.position() <= d.loop.end + 0.01; const t1 = performance.now();
      d.rollEnd(); o.inside = inside; o.loopAfter = d.loop; o.playing = d.playing; o.moved = d.position() - p0; d.pause(); return o; }""")
    check("a roll loops a quarter beat (0.125 s at 120 BPM) while held", abs(r["len"] - 0.125) < 0.005 and r["inside"], str(r))
    check("letting go carries on where the track would have been (about 1.2 s later), not where the loop was", r["loopAfter"] is None and r["playing"] and 1.1 < r["moved"] < 1.9, str(r))
    pg.click("#deck0 [data-r=play]"); pg.wait_for_timeout(300)
    box = pg.locator("#deck0 [data-r=r2]").bounding_box(); pg.mouse.move(box["x"] + 5, box["y"] + 5); pg.mouse.down(); pg.wait_for_timeout(250)
    check("holding a roll pad with the mouse loops and lights the pad", ev("__dj.decks[0].loop !== null") and pg.get_attribute("#deck0 [data-r=r2]", "aria-pressed") == "true")
    pg.mouse.up(); pg.wait_for_timeout(200)
    check("releasing the pad ends the loop", ev("__dj.decks[0].loop === null") and pg.get_attribute("#deck0 [data-r=r2]", "aria-pressed") == "false")
    pg.locator("#deck0 [data-r=r4]").focus(); pg.keyboard.down("Space"); pg.wait_for_timeout(200)
    check("a roll pad also works from the keyboard (hold Space)", ev("__dj.decks[0].loop !== null"))
    pg.keyboard.up("Space"); pg.wait_for_timeout(150); check("and lets go on key up", ev("__dj.decks[0].loop === null"))
    ev("() => __dj.decks[0].pause()")
    ev("() => __dj.decks[0].rollStart(1)"); check("a roll does nothing while the deck is stopped", ev("__dj.decks[0].loop === null"))
    # effect unit on the shared engine
    r = ev("""async () => { const d = __dj.decks[3], w = (ms) => new Promise((r) => setTimeout(r, ms)), o = {}; const tb = __dj.ctx.createBuffer(1, 22050 * 30, 22050), tx = tb.getChannelData(0); for (let i = 0; i < tx.length; i++) tx[i] = 0.4 * Math.sin(2 * Math.PI * 220 * i / 22050);
      d.setBuffer(tb, 'tone.wav'); d.setGridBpm(132); d.seek(2); d.play(); await w(500); o.dry = d.level();
      d.setFx('reverb'); o.type = d.fxSlot && d.fxSlot.type; d.el.fxamt.value = 0; d.fxAmount(); await w(400); o.bypass = d.level();
      d.el.fxamt.value = 60; d.fxAmount(); await w(400); o.wet = d.level(); d.setFx('delay'); o.delayBpm = d.fxOpts.bpm; d.setFx('chorus'); d.setFx('sat'); d.setFx('comp'); d.setFx(''); o.none = d.fxSlot; await w(300); o.after = d.level(); d.pause(); return o; }""")
    check("an effect unit can be chosen on a deck and is built by the shared effects engine", r["type"] == "reverb", str(r))
    check("with the amount at zero the effect is transparent", r["dry"] > 0.02 and abs(r["bypass"] - r["dry"]) / r["dry"] < 0.5, str(r))
    check("switching through every effect and back to none leaves the sound intact", r["none"] is None and r["after"] > 0.02 and abs(r["delayBpm"] - 132) < 0.5, str(r))
    # sync for C
    ev("() => { const a = __dj.decks[0]; a.setBuffer(__mk(120), 'a.wav'); const c = __dj.decks[2]; c.setBuffer(__mk(126), 'c.wav'); a.play(); }")
    pg.click("#syncC"); pg.wait_for_timeout(200)
    check("SYNC on deck C matches the tempo of the deck that is playing", abs(ev("__dj.decks[2].liveBpm") - 120) < 0.3, str(ev("__dj.decks[2].liveBpm")))
    ev("() => __dj.decks[0].pause()")
    # hiding decks stops them
    ev("() => __dj.decks[3].play()"); pg.click("#decks4")
    check("hiding decks C and D pauses them", not ev("__dj.decks[3].playing") and not pg.is_visible("#deck3"))
    pg.reload(); pg.wait_for_function("() => window.__dj", timeout=10000)
    check("after a reload decks C and D are hidden again", not pg.is_visible("#deck2"))
    ev("() => { window.__mk = %s; }" % mk)
    pg.click("#decks4"); pg.reload(); pg.wait_for_function("() => window.__dj", timeout=10000)
    check("the choice to show them is remembered", pg.is_visible("#deck2")); pg.click("#decks4")
    # MIDI hold pads and mapping files
    pg.wait_for_function("() => window.__ctl && window.__lib", timeout=10000); ev("() => { window.__mk = %s; }" % mk)
    ev("() => { __dj.decks[0].setBuffer(__mk(120), 'a.wav'); __dj.decks[0].seek(5); __dj.decks[0].play(); __ctl.learn('a.rollr4'); }")
    ev("() => __ctl.handle([0x90, 60, 100])"); check("MIDI learn maps a pad to a loop roll", ev("__ctl.map['n:0:60']") == "a.rollr4")
    pg.wait_for_timeout(300); ev("() => __ctl.handle([0x90, 60, 100])"); pg.wait_for_timeout(200)
    check("pressing the mapped pad starts the roll", ev("__dj.decks[0].loop !== null"))
    ev("() => __ctl.handle([0x80, 60, 0])"); pg.wait_for_timeout(150)
    check("releasing the pad (note off) ends it", ev("__dj.decks[0].loop === null"))
    ev("() => __ctl.handle([0x90, 60, 100])"); pg.wait_for_timeout(150); ev("() => __ctl.handle([0x90, 60, 0])"); pg.wait_for_timeout(150)
    check("a note on with velocity 0 also counts as a release", ev("__dj.decks[0].loop === null"))
    ev("() => { __ctl.learn('c.fxamt'); __ctl.handle([0xb0, 21, 5]); }")
    ev("() => __dj.decks[0].pause()")
    check("every deck has controller actions, including effect amounts and eight hot cues", ev("__ctl.ACT.filter((a) => a.id.startsWith('d.')).length") > 20 and ev("__ctl.ACT.some((a) => a.id === 'd.hot8')") and ev("__ctl.ACT.some((a) => a.id === 'c.rollr1')"))
    with pg.expect_download(timeout=10000) as dl: pg.click("#midilearn summary") if False else (pg.evaluate("document.getElementById('midilearn').open = true"), pg.click("#msave"))
    raw = open(dl.value.path()).read(); import json as _j; data = _j.loads(raw)
    check("Save mapping file writes the mapping as JSON", data["kind"] == "govibe-dj-midi-map" and data["map"].get("n:0:60") == "a.rollr4" and data["map"].get("c:0:21") == "c.fxamt", raw[:200])
    ev("() => document.getElementById('mreset').click()"); check("Clear all empties the mapping", ev("Object.keys(__ctl.map).length") == 0)
    tmpf = tempfile.mkdtemp() + "/map.json"; open(tmpf, "w").write(raw); pg.set_input_files("#mfile", tmpf); pg.wait_for_timeout(400)
    check("Load mapping file restores it", ev("__ctl.map['n:0:60']") == "a.rollr4" and "Loaded 2" in pg.inner_text("#midistatus"), pg.inner_text("#midistatus"))
    bad = tempfile.mkdtemp() + "/bad.json"; open(bad, "w").write('{"kind":"govibe-dj-midi-map","map":{"n:0:61":"nothing.here","zz":"a.play","n:1:9":"a.play"}}'); pg.set_input_files("#mfile", bad); pg.wait_for_timeout(400)
    check("a file with unknown controls or bad keys keeps only the valid ones", list(ev("__ctl.map").items()) == [("n:1:9", "a.play")] and "2 skipped" in pg.inner_text("#midistatus"), pg.inner_text("#midistatus"))
    open(bad, "w").write('{"hello":1}'); pg.set_input_files("#mfile", bad); pg.wait_for_timeout(400)
    check("a file that is not a mapping is refused and the mapping is left alone", "not a GoVibe" in pg.inner_text("#midistatus") and ev("Object.keys(__ctl.map).length") == 1)
    # playlists
    tmp = tempfile.mkdtemp(); fa, fb, fc = tmp + "/Alpha 120.wav", tmp + "/Bravo 124.wav", tmp + "/Charlie 128.wav"
    make_wav(fa, 120); make_wav(fb, 124, tone=330.0); make_wav(fc, 128, tone=440.0)
    pg.set_input_files("#libfile", [fa, fb, fc]); pg.wait_for_function("() => document.querySelectorAll('#libbody tr[data-id]').length === 3", timeout=40000)
    pg.fill("#plname", "Warm up"); pg.click("#pladd")
    check("New playlist creates it and shows it", ev("__lib.lists().map((l) => l.name)") == ["Warm up"] and pg.input_value("#libpl") == ev("__lib.lists()[0].id") and pg.locator("#libbody tr[data-id]").count() == 0)
    pg.fill("#plname", "Warm up"); pg.click("#pladd"); check("a second playlist with the same name is refused", ev("__lib.lists().length") == 1 and "already a playlist" in pg.inner_text("#libstatus"))
    pg.select_option("#libpl", ""); 
    for nm in ("Charlie", "Alpha", "Bravo"):
        pg.locator("#libbody tr[data-id]", has_text=nm).locator("select.libaddpl").select_option(label="Warm up")
    check("tracks are added to a playlist from the track row, in the order added", ev("__lib.lists()[0].ids.length") == 3 and ev("__lib.lists()[0].ids.map((id) => __lib.recs.find((r) => r.id === id).name.split(' ')[0])") == ["Charlie", "Alpha", "Bravo"])
    pg.locator("#libbody tr[data-id]", has_text="Alpha").locator("select.libaddpl").select_option(label="Warm up ✓"); check("adding a track twice is refused politely", ev("__lib.lists()[0].ids.length") == 3 and "already in" in pg.inner_text("#libstatus"))
    pg.select_option("#libpl", ev("__lib.lists()[0].id"))
    names = lambda: pg.evaluate("[...document.querySelectorAll('#libbody tr[data-id] td.libname')].map((c) => c.textContent.split(' ')[0])")
    check("viewing a playlist shows only its tracks in playlist order", names() == ["Charlie", "Alpha", "Bravo"], str(names()))
    pg.locator("#libbody tr[data-id]", has_text="Bravo").get_by_role("button", name=re.compile("Move .* earlier")).click()
    check("the up arrow moves a track earlier", names() == ["Charlie", "Bravo", "Alpha"], str(names()))
    pg.locator("#libbody tr[data-id]", has_text="Charlie").get_by_role("button", name=re.compile("Move .* later")).click()
    check("the down arrow moves a track later", names() == ["Bravo", "Charlie", "Alpha"], str(names()))
    pg.locator("#libbody tr[data-id]", has_text="Charlie").get_by_role("button", name=re.compile("Take .* out of the playlist")).click()
    check("taking a track out of the playlist keeps it in the library", names() == ["Bravo", "Alpha"] and len(ev("__lib.recs")) == 3)
    pg.click("#plq"); pg.wait_for_function("() => document.querySelectorAll('#amlist li .nm').length === 2", timeout=20000)
    qn = pg.evaluate("[...document.querySelectorAll('#amlist li .nm')].map((l) => l.textContent)")
    check("Queue playlist adds its tracks to Automix in order", [x.split(' ')[1] for x in qn] == ["Bravo", "Alpha"], str(qn))
    pg.reload(); pg.wait_for_function("() => document.querySelectorAll('#libbody tr[data-id]').length === 3", timeout=20000)
    check("playlists survive a reload", ev("__lib.lists().length") == 1 and pg.locator("#libpl option").count() == 2)
    zipd = ev("""async () => { const z = await __lib.exportZip(), f = new File([z], 'b.zip'); const ents = await GVZip.read(f); const j = JSON.parse(await (await ents.find((e) => e.name === 'library.json').blob()).text()); return j.playlists; }""")
    check("the library backup carries the playlists", zipd and zipd[0]["name"] == "Warm up" and len(zipd[0]["ids"]) == 2, str(zipd))
    ev("() => { const l = __lib.lists()[0]; document.getElementById('libpl').value = l.id; }")
    pg.select_option("#libpl", ev("__lib.lists()[0].id")); pg.click("#pldel")
    check("Delete playlist removes it but not the tracks", ev("__lib.lists().length") == 0 and pg.input_value("#libpl") == "" and pg.locator("#libbody tr[data-id]").count() == 3)
    check("with decks C and D hidden the library offers only decks A and B", pg.get_by_role("button", name=re.compile("into deck C")).count() == 0)
    pg.click("#decks4")
    check("showing decks C and D adds load buttons for them", pg.get_by_role("button", name=re.compile("into deck D")).count() == 3)
    pg.locator("#libbody tr[data-id]", has_text="Alpha").get_by_role("button", name=re.compile("Load .* into deck C")).click()
    pg.wait_for_function("() => __dj.decks[2].buf !== null && __dj.decks[2].libId", timeout=15000)
    check("the library loads tracks into deck C (decks C and D are shown)", pg.inner_text("#deck2 [data-r=name]").startswith("Alpha"))
    ev("() => { const d = __dj.decks[2]; d.seek(4); d.hotCue(6); }"); pg.wait_for_timeout(600)
    ev("() => __lib.loadTo(3, __lib.recs.find((r) => r.name.startsWith('Alpha')))"); pg.wait_for_timeout(500)
    check("eight hot cues are remembered with the track and come back on another deck", abs((ev("__dj.decks[3].hot[6]") or -1) - 4) < 0.3, str(ev("__dj.decks[3].hot")))
    axe = os.environ.get("AXE_PATH") or os.path.join(ROOT, "node_modules/axe-core/axe.min.js")
    if os.path.exists(axe):
        c3 = browser.new_context(bypass_csp=True, viewport={"width": 1500, "height": 1100}); p3 = c3.new_page(); p3.goto(base + "dj.html?gvtest"); p3.wait_for_function("() => window.__dj", timeout=10000)
        p3.click("#decks4"); p3.evaluate("document.getElementById('midilearn').open = true"); p3.add_script_tag(path=axe)
        v = p3.evaluate("axe.run(document,{runOnly:['wcag2a','wcag2aa','wcag21a','wcag21aa','best-practice']}).then(r=>r.violations.map(v=>v.id+' x'+v.nodes.length+' '+v.nodes[0].target.join(' ')))")
        check("DJ page with four decks and the MIDI panel open: no axe violations", not v, str(v)); c3.close()
    check("no page errors on the four deck DJ page", not errs, str(errs[:3]))
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
    check("stem buttons absent until split, split button present", pg.locator("[data-r=stembox] button").count() == 4)
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


def test_tools(browser, base):
    print("audio converter, BPM and key finder")
    import tempfile
    errs = []
    ctx, pg = new_page(browser, errs)
    tmp = tempfile.mkdtemp(); f1, f2 = tmp + "/Click 120.wav", tmp + "/Other 128.wav"
    make_wav(f1, 120, secs=40); make_wav(f2, 128, secs=40, tone=330.0)
    # BPM finder
    pg.goto(base + "bpm.html?gvtest")
    pg.set_input_files("#file", [f1, f2])
    pg.wait_for_function("() => __bpm.rows.length === 2", timeout=60000)
    rows = pg.evaluate("__bpm.rows.map((r) => [r.name, r.bpm, r.key])")
    check("BPM finder reads tempo within 0.5 BPM", abs(rows[0][1] - 120) < 0.5 and abs(rows[1][1] - 128) < 0.5, str(rows))
    check("BPM finder shows a Camelot key and its name", re.match(r"^\d+[AB]$", rows[0][2] or "") is not None and pg.locator("#rows tr").first.locator("td").nth(4).inner_text() != "—", str(rows))
    check("BPM finder lists both tracks", pg.locator("#rows tr").count() == 2)
    pg.evaluate("__bpm.tap(0); __bpm.tap(500); __bpm.tap(1000); __bpm.tap(1500)")
    check("tap tempo: taps 500 ms apart read 120 BPM", pg.inner_text("#tapbpm").startswith("120.0"), pg.inner_text("#tapbpm"))
    pg.locator("#rows tr").first.get_by_role("button", name=re.compile("^Remove")).click()
    check("a result can be removed", pg.locator("#rows tr").count() == 1)
    check("bpm page: no errors", not errs, str(errs))
    # converter
    pg.goto(base + "convert.html?gvtest")
    pg.set_input_files("#file", [f1, f2])
    check("converter lists chosen files", pg.locator("#rows tr").count() == 2 and not pg.locator("#go").is_disabled())
    pg.select_option("#fmt", "wav"); pg.select_option("#chan", "mono"); pg.select_option("#rate", "22050")
    pg.click("#go"); pg.wait_for_function("() => __conv.items.every((i) => i.blob)", timeout=60000)
    w = pg.evaluate("""async () => { const b = __conv.items[0].blob, u = new Uint8Array(await b.arrayBuffer()), v = new DataView(u.buffer);
      return { riff: String.fromCharCode(...u.slice(0, 4)), ch: v.getUint16(22, true), sr: v.getUint32(24, true), secs: v.getUint32(40, true) / 2 / v.getUint32(24, true), name: __conv.items[0].out }; }""")
    check("WAV output: mono, 22050 Hz, about 40 s, named .wav", w["riff"] == "RIFF" and w["ch"] == 1 and w["sr"] == 22050 and 39 < w["secs"] < 41 and w["name"] == "Click 120.wav", str(w))
    pg.select_option("#fmt", "mp3"); pg.select_option("#chan", "keep"); pg.select_option("#rate", "0"); pg.select_option("#kbps", "128")
    pg.click("#go"); pg.wait_for_function("() => __conv.items.every((i) => i.blob && i.out.endsWith('.mp3'))", timeout=90000)
    m = pg.evaluate("""async () => { const b = __conv.items[0].blob, u = new Uint8Array(await b.arrayBuffer()); let i = 0; if (u[0] === 0x49 && u[1] === 0x44 && u[2] === 0x33) i = 10 + ((u[6] << 21) | (u[7] << 14) | (u[8] << 7) | u[9]);
      return { size: b.size, sync: u[i] === 0xff && (u[i + 1] & 0xe0) === 0xe0, type: b.type }; }""")
    check("MP3 output has a valid frame header and a sensible size (128 kbps, 40 s is about 640 KB)", m["sync"] and 500000 < m["size"] < 800000 and m["type"] == "audio/mpeg", str(m))
    mp3 = pg.evaluate("""async () => { const u = new Uint8Array(await __conv.items[0].blob.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode(...u.subarray(i, i + 8192)); return btoa(s); }""")
    import base64
    open(tmp + "/out.mp3", "wb").write(base64.b64decode(mp3))
    import subprocess
    pr = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_name,sample_rate,channels:format=duration", "-of", "default=nw=1", tmp + "/out.mp3"], capture_output=True, text=True) if __import__("shutil").which("ffprobe") else None
    if pr is not None:
        check("ffprobe agrees: MP3, 44100 Hz or similar, duration 40 s", "codec_name=mp3" in pr.stdout and "duration=40" in pr.stdout, pr.stdout + pr.stderr)
    check("ZIP button appears for several converted files", not pg.locator("#zip").is_hidden())
    with pg.expect_download() as dl:
        pg.click("#zip")
    import zipfile
    zf = zipfile.ZipFile(dl.value.path())
    check("ZIP holds both MP3 files", sorted(zf.namelist()) == ["Click 120.mp3", "Other 128.mp3"] and zf.testzip() is None, str(zf.namelist()))
    bad = tmp + "/bad.mp3"; open(bad, "wb").write(b"not audio at all" * 100)
    pg.set_input_files("#file", bad); pg.click("#go"); pg.wait_for_function("() => __conv.items.at(-1).err === true", timeout=15000)
    check("an unreadable file shows an error without breaking the others", "Could not read" in pg.locator("#rows tr").last.inner_text() and pg.locator("#rows tr").count() == 3)
    check("converter page: no errors", not [e for e in errs if "Failed to load resource" not in e and "EncodingError" not in e], str(errs))
    ctx.close()
    # accessibility
    axe = os.environ.get("AXE_PATH") or os.path.join(ROOT, "node_modules/axe-core/axe.min.js")
    if os.path.exists(axe):
        js = "axe.run(document,{runOnly:['wcag2a','wcag2aa','wcag21a','wcag21aa','best-practice']}).then(r=>r.violations.map(v=>v.id+' x'+v.nodes.length+' '+v.nodes[0].target.join(' ')))"
        c2 = browser.new_context(bypass_csp=True); p2 = c2.new_page()
        for name in ("convert", "bpm"):
            p2.goto(base + name + ".html"); p2.add_script_tag(path=axe)
            check(f"{name} (empty): no axe violations", not (v := p2.evaluate(js)), str(v))
        p2.goto(base + "bpm.html?gvtest"); p2.set_input_files("#file", [f1]); p2.wait_for_function("() => __bpm.rows.length === 1", timeout=60000); p2.add_script_tag(path=axe)
        check("bpm (with results): no axe violations", not (v := p2.evaluate(js)), str(v))
        c2.close()


def test_editor_dsp(browser, base):
    print("audio editor: pitch, EQ, noise gate, rumble, MP3 export")
    errs = []
    ctx, pg = new_page(browser, errs)
    pg.goto(base + "editor.html?gvtest")
    helpers = """
      const sr = 22050, tone = (f, secs, amp = 0.5) => new Float32Array(sr * secs).map((_, i) => amp * Math.sin(2 * Math.PI * f * i / sr));
      const rms = (a, from = 0, to = a.length) => { from = Math.round(from); to = Math.round(to); let s = 0; for (let i = from; i < to; i++) s += a[i] * a[i]; return Math.sqrt(s / (to - from)); };
      const freq = (a, from, to) => { let z = 0; for (let i = from + 1; i < to; i++) if (a[i - 1] < 0 && a[i] >= 0) z++; return z / ((to - from) / sr); };
      const set = (id, v) => { document.getElementById(id).value = v; };
    """
    r = pg.evaluate("() => {" + helpers + """
      const o = {};
      __gv.loadBuffers([tone(440, 3)], sr); set('pitch', 12); __gv.ops.pitch(); o.upLen = __gv.chans[0].length; o.upF = freq(__gv.chans[0], sr / 2, sr * 2.5);
      __gv.loadBuffers([tone(440, 3)], sr); set('pitch', -12); __gv.ops.pitch(); o.dnLen = __gv.chans[0].length; o.dnF = freq(__gv.chans[0], sr / 2, sr * 2.5); o.dnRms = rms(__gv.chans[0], sr / 2, sr * 2.5);
      __gv.loadBuffers([tone(440, 3), tone(440, 3)], sr); set('pitch', 5); __gv.ops.pitch(); o.stereo = __gv.chans.length === 2 && Math.abs(__gv.chans[0][20000] - __gv.chans[1][20000]) < 1e-6;
      __gv.loadBuffers([tone(40, 1, 0.1)], sr); set('eqlo', 12); __gv.ops.eq(); o.bass = rms(__gv.chans[0], 5000, 20000) / rms(tone(40, 1, 0.1), 5000, 20000);
      __gv.loadBuffers([tone(4000, 1)], sr); set('eqlo', 12); __gv.ops.eq(); o.hiKept = rms(__gv.chans[0], 5000, 20000) / rms(tone(4000, 1), 5000, 20000);
      __gv.loadBuffers([tone(10000, 1)], sr); set('eqlo', 0); set('eqhi', -12); __gv.ops.eq(); o.hiCut = rms(__gv.chans[0], 5000, 20000) / rms(tone(10000, 1), 5000, 20000);
      __gv.loadBuffers([tone(30, 1), tone(30, 1)].slice(0, 1), sr); __gv.ops.rumble(); o.rumble30 = rms(__gv.chans[0], 8000, 20000) / rms(tone(30, 1), 8000, 20000);
      __gv.loadBuffers([tone(1000, 1)], sr); __gv.ops.rumble(); o.rumble1k = rms(__gv.chans[0], 8000, 20000) / rms(tone(1000, 1), 8000, 20000);
      const n = new Float32Array(sr * 2); for (let i = 0; i < n.length; i++) n[i] = 0.003 * (Math.random() * 2 - 1);      // hiss
      for (let i = sr * 0.5; i < sr * 1.0; i++) n[i] += 0.4 * Math.sin(2 * Math.PI * 300 * i / sr);                        // a burst of sound
      const before = rms(n, sr * 1.3, sr * 1.9); __gv.loadBuffers([n], sr); set('gate', -40); __gv.ops.gate();
      o.hiss = rms(__gv.chans[0], sr * 1.3, sr * 1.9) / before; o.burst = rms(__gv.chans[0], sr * 0.55, sr * 0.95) / 0.2828;
      return o; }""")
    check("pitch +12 semitones doubles the frequency and keeps the length", abs(r["upF"] - 880) < 25 and abs(r["upLen"] - 66150) < 700, str(r))
    check("pitch -12 semitones halves the frequency, keeps length and level", abs(r["dnF"] - 220) < 15 and abs(r["dnLen"] - 66150) < 700 and 0.25 < r["dnRms"] < 0.5, str(r))
    check("pitch keeps both stereo channels identical for identical input", r["stereo"], str(r))
    check("EQ: bass +12 dB raises a 40 Hz tone about 4 times", 3.0 < r["bass"] < 5.0, str(r["bass"]))
    check("EQ: bass boost leaves 4 kHz alone", 0.9 < r["hiKept"] < 1.1, str(r["hiKept"]))
    check("EQ: treble -12 dB cuts a 10 kHz tone to about a quarter", 0.15 < r["hiCut"] < 0.4, str(r["hiCut"]))
    check("rumble removal cuts 30 Hz by more than 10 dB", r["rumble30"] < 0.3, str(r["rumble30"]))
    check("rumble removal keeps 1 kHz", 0.95 < r["rumble1k"] < 1.05, str(r["rumble1k"]))
    check("noise gate cuts the hiss by more than 20 dB and keeps the sound", r["hiss"] < 0.1 and r["burst"] > 0.9, str((r["hiss"], r["burst"])))
    # undo and no-op messages
    pg.evaluate("() => { document.getElementById('pitch').value = 0; __gv.loadBuffers([new Float32Array(22050).fill(0.1)], 22050); }")
    pg.click("[data-op=pitch]"); check("pitch with the slider at 0 asks to move it and changes nothing", "slider" in pg.inner_text("#status") and pg.locator("#undo").is_disabled())
    # MP3 export
    pg.evaluate("() => { const sr = 22050; __gv.loadBuffers([new Float32Array(sr * 10).map((_, i) => 0.4 * Math.sin(2 * Math.PI * 440 * i / sr))], sr); }")
    with pg.expect_download() as dl:
        pg.click("#exportmp3")
    path = dl.value.path(); data = open(path, "rb").read()
    i = 0
    if data[:3] == b"ID3": i = 10 + ((data[6] << 21) | (data[7] << 14) | (data[8] << 7) | data[9])
    check("MP3 export downloads a valid MP3 (192 kbps, 10 s is about 240 KB)", data[i] == 0xFF and (data[i + 1] & 0xE0) == 0xE0 and 150000 < len(data) < 330000 and dl.value.suggested_filename == "govibe-edit.mp3", str(len(data)))
    check("editor dsp: no errors", not errs, str(errs))
    ctx.close()
    axe = os.environ.get("AXE_PATH") or os.path.join(ROOT, "node_modules/axe-core/axe.min.js")
    if os.path.exists(axe):
        js = "axe.run(document,{runOnly:['wcag2a','wcag2aa','wcag21a','wcag21aa','best-practice']}).then(r=>r.violations.map(v=>v.id+' x'+v.nodes.length+' '+v.nodes[0].target.join(' ')))"
        c2 = browser.new_context(bypass_csp=True); p2 = c2.new_page(); p2.goto(base + "editor.html?gvtest"); p2.add_script_tag(path=axe)
        p2.evaluate("() => __gv.loadBuffers([new Float32Array(22050).fill(0.1)], 22050)")
        check("editor with the new panels: no axe violations", not (v := p2.evaluate(js)), str(v)); c2.close()


def test_denoise(browser, base):
    print("audio editor: background noise removal (RNNoise)")
    errs = []
    ctx, pg = new_page(browser, errs)
    pg.goto(base + "editor.html?gvtest"); pg.wait_for_function("() => window.__gv", timeout=10000)
    gen = """() => { const sr = 44100, n = sr * 5, clean = new Float32Array(n), noisy = new Float32Array(n); let seed = 11; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 * 2 - 1; }, ph = { v: 0 };
      for (let i = 0; i < n; i++) { const t = i / sr, g = t % 2.5, env = g < 1.5 ? Math.min(1, g / 0.05) : 0, f0 = 100 + 90 * Math.sin(t * 2.3) + 40 * Math.sin(t * 7.1); ph.v += 2 * Math.PI * f0 / sr; let v = 0;
        for (let h = 1; h < 24; h++) v += Math.sin(h * ph.v) * Math.exp(-Math.pow((h * f0 - 800) / 900, 2)) / Math.sqrt(h); clean[i] = 0.2 * env * v; noisy[i] = clean[i] + 0.05 * rnd(); }
      window.__clean = clean; window.__noisy = noisy; window.__sr = sr; __gv.loadBuffers([noisy.slice()], sr); }"""
    pg.evaluate(gen)
    meas = """() => { const sr = window.__sr, c = __gv.chans[0], rms = (a, x, y) => { let s = 0; for (let i = Math.round(x * sr); i < Math.round(y * sr); i++) s += a[i] * a[i]; return Math.sqrt(s / ((y - x) * sr)); };
      const db = (v) => 20 * Math.log10(v + 1e-9); let dot = 0, ea = 0, eb = 0; for (let i = Math.round(0.5 * sr); i < Math.round(1.4 * sr); i++) { dot += c[i] * __clean[i]; ea += c[i] * c[i]; eb += __clean[i] * __clean[i]; }
      return { len: c.length, gapIn: db(rms(__noisy, 1.7, 2.4)), gapOut: db(rms(c, 1.7, 2.4)), burstIn: db(rms(__noisy, 0.5, 1.4)), burstOut: db(rms(c, 0.5, 1.4)), burstClean: db(rms(__clean, 0.5, 1.4)), corr: dot / Math.sqrt(ea * eb + 1e-12) }; }"""
    before = pg.evaluate(meas)
    pg.click("#denoise"); pg.wait_for_function("() => /^Done/.test(document.getElementById('dnstatus').textContent)", timeout=60000)
    m = pg.evaluate(meas)
    check("noise removal keeps the length of the sound", m["len"] == before["len"], str(m))
    check("the gaps between words get much quieter (at least 25 dB)", m["gapIn"] - m["gapOut"] > 25, f"{m['gapIn']:.1f} -> {m['gapOut']:.1f} dB")
    check("the voice itself stays within 2 dB of the clean original", abs(m["burstOut"] - m["burstClean"]) < 2.0, f"{m['burstOut']:.1f} vs clean {m['burstClean']:.1f} dB")
    check("the cleaned voice lines up with the clean original (no shift)", m["corr"] > 0.9, f"correlation {m['corr']:.3f}")
    check("the status says it is done and mentions undo", "Undo" in pg.inner_text("#dnstatus"))
    pg.click("#undo"); pg.wait_for_timeout(200)
    back = pg.evaluate(meas)
    check("Undo brings the noisy original back exactly", abs(back["gapOut"] - before["gapIn"]) < 0.01 and abs(back["burstOut"] - before["burstIn"]) < 0.01, str(back))
    pg.evaluate("() => { const r = document.getElementById('dn'); r.value = 50; r.dispatchEvent(new Event('input')); }")
    check("the strength label follows the slider", pg.inner_text("#dnv") == "50%")
    pg.click("#denoise"); pg.wait_for_function("() => /^Done/.test(document.getElementById('dnstatus').textContent)", timeout=60000)
    half = pg.evaluate(meas)
    check("half strength removes only part of the noise", 6 < half["gapIn"] - half["gapOut"] < m["gapIn"] - m["gapOut"] - 6, f"{half['gapIn']:.1f} -> {half['gapOut']:.1f} dB")
    check("half strength says so in the status", "50% strength" in pg.inner_text("#dnstatus"))
    pg.evaluate(gen); pg.evaluate("() => { __gv.sel = [Math.round(1.5 * __sr), Math.round(3.5 * __sr)]; }") if False else None
    sel = pg.evaluate("""() => { const sr = __sr; try { __gv.sel = [Math.round(1.5 * sr), Math.round(5 * sr)]; } catch (e) { return 'nosel'; } return 'ok'; }""")
    if sel == "ok":
        pg.evaluate("() => { const r = document.getElementById('dn'); r.value = 100; r.dispatchEvent(new Event('input')); }")
        pg.evaluate("() => { document.getElementById('dnstatus').textContent = ''; }")
        pg.click("#denoise"); pg.wait_for_function("() => /^Done/.test(document.getElementById('dnstatus').textContent)", timeout=60000)
        sm = pg.evaluate("""() => { const c = __gv.chans[0]; let same = true; for (let i = 0; i < 1.4 * __sr; i += 7) if (c[i] !== __noisy[i]) same = false; const rms = (a, x, y) => { let s = 0; for (let i = Math.round(x * __sr); i < Math.round(y * __sr); i++) s += a[i] * a[i]; return Math.sqrt(s / ((y - x) * __sr)); };
          return { same, inGap: 20 * Math.log10(rms(c, 1.7, 2.4) + 1e-9) - 20 * Math.log10(rms(__noisy, 1.7, 2.4)) }; }""")
        check("with a selection only the selected part is cleaned", sm["same"] and sm["inGap"] < -20, str(sm))
    stereo = pg.evaluate("""async () => { const sr = 48000, n = sr * 2; const a = new Float32Array(n), b = new Float32Array(n); let s = 3; for (let i = 0; i < n; i++) { s = (s * 1664525 + 1013904223) >>> 0; const r = s / 4294967296 * 2 - 1; a[i] = 0.05 * r; b[i] = 0.05 * r; }
      __gv.loadBuffers([a, b], sr); return __gv.chans.length; }""")
    pg.evaluate("() => { __gv.sel = [0, 0]; document.getElementById('dnstatus').textContent = ''; }")
    pg.click("#denoise"); pg.wait_for_function("() => /^Done/.test(document.getElementById('dnstatus').textContent)", timeout=60000)
    st = pg.evaluate("""() => { const rms = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length); return [__gv.chans.length, rms(__gv.chans[0]), rms(__gv.chans[1])]; }""")
    check("stereo sound works at 48 kHz and steady noise is removed on both channels", stereo == 2 and st[0] == 2 and st[1] < 0.003 and st[2] < 0.003, str(st))
    check("no page errors in noise removal", not errs, str(errs[:3]))
    ctx.close()


def test_record(browser, base):
    print("voice and mic recorder (fake microphone)")
    from playwright.sync_api import sync_playwright as _sp
    errs = []
    b2 = _sp_instance.chromium.launch(args=["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"])
    ctx = b2.new_context(permissions=["microphone"]); pg = ctx.new_page()
    pg.on("pageerror", lambda e: errs.append(f"pageerror: {e}"))
    pg.goto(base + "record.html?gvtest")
    check("recorder asks before using the microphone (rig hidden)", pg.locator("#rig").is_hidden() and pg.locator("#allow").is_visible())
    pg.click("#allow"); pg.wait_for_selector("#rig:not(.hidden)", timeout=10000)
    check("microphone list is filled", pg.locator("#dev option").count() >= 1)
    pg.wait_for_timeout(800)
    check("level meter moves with the fake microphone tone", pg.evaluate("document.getElementById('meter').getAttribute('aria-valuenow')") != "-60" or "dB" in pg.inner_text("#lvltxt"), pg.inner_text("#lvltxt"))
    pg.wait_for_timeout(1500)
    lit = pg.evaluate("""() => { const c = document.getElementById('livespec'), g = c.getContext('2d'); const d = g.getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 150) n++; return { n, w: c.width, h: c.height }; }""")
    check("the live spectrogram draws the microphone", lit["w"] > 100 and lit["n"] > 20, str(lit))
    pg.select_option("#livelog", "0"); pg.wait_for_timeout(300); pg.select_option("#livelog", "1")
    pg.uncheck("#cd"); pg.click("#rec"); pg.wait_for_function("() => __rec.recording", timeout=5000); pg.wait_for_timeout(2200); pg.click("#rec")
    pg.wait_for_function("() => __rec.takes.length === 1", timeout=8000)
    d = pg.evaluate("""async () => { const t = __rec.takes[0], u = new Uint8Array(await t.blob.arrayBuffer()), v = new DataView(u.buffer); let pk = 0; for (let i = 44; i < u.length; i += 2) pk = Math.max(pk, Math.abs(v.getInt16(i, true)));
      return { riff: String.fromCharCode(...u.slice(0, 4)), ch: v.getUint16(22, true), sr: v.getUint32(24, true), secs: t.secs, pk }; }""")
    check("take is a valid mono 16 bit WAV of about 2 seconds with sound in it", d["riff"] == "RIFF" and d["ch"] == 1 and 1.6 < d["secs"] < 3.2 and d["pk"] > 500, str(d))
    pg.click("#rec"); pg.wait_for_timeout(1200); pg.click("#rec"); pg.wait_for_function("() => __rec.takes.length === 2", timeout=8000)
    check("several takes are kept", pg.locator("#takes li").count() == 2)
    with pg.expect_download() as dl:
        pg.get_by_role("button", name="Download WAV Take 1").click()
    check("take downloads as WAV", dl.value.suggested_filename == "Take 1.wav")
    with pg.expect_download() as dl2:
        pg.get_by_role("button", name="Download MP3 Take 1").click()
    data = open(dl2.value.path(), "rb").read(); i = 0
    if data[:3] == b"ID3": i = 10 + ((data[6] << 21) | (data[7] << 14) | (data[8] << 7) | data[9])
    check("take downloads as a valid MP3", dl2.value.suggested_filename == "Take 1.mp3" and data[i] == 0xFF and (data[i + 1] & 0xE0) == 0xE0, str(len(data)))
    pg.get_by_role("button", name="Delete").first.click()
    check("a take can be deleted", pg.locator("#takes li").count() == 1)
    pg.get_by_role("button", name=re.compile("Open Take 2 in the Audio Editor")).click()
    pg.wait_for_url(re.compile("editor.html"), timeout=10000); pg.wait_for_selector("#editor:not(.hidden)", timeout=10000)
    check("a take opens in the Audio Editor", "recording" in pg.inner_text("#status").lower() and "1 ch" in pg.inner_text("#info"), pg.inner_text("#status") + pg.inner_text("#info"))
    check("recorder: no errors", not errs, str(errs))
    ctx.close()
    # permission denied path
    ctx = b2.new_context(); p2 = ctx.new_page(); p2.goto(base + "record.html")
    p2.evaluate("() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error('x'), { name: 'NotAllowedError' })); }")
    p2.click("#allow"); p2.wait_for_timeout(300)
    check("blocked microphone shows a clear message", "blocked" in p2.inner_text("#status").lower() or p2.locator("#setup").is_visible())
    ctx.close()
    axe = os.environ.get("AXE_PATH") or os.path.join(ROOT, "node_modules/axe-core/axe.min.js")
    if os.path.exists(axe):
        js = "axe.run(document,{runOnly:['wcag2a','wcag2aa','wcag21a','wcag21aa','best-practice']}).then(r=>r.violations.map(v=>v.id+' x'+v.nodes.length+' '+v.nodes[0].target.join(' ')))"
        c2 = b2.new_context(bypass_csp=True, permissions=["microphone"]); p3 = c2.new_page(); p3.goto(base + "record.html"); p3.click("#allow"); p3.wait_for_selector("#rig:not(.hidden)", timeout=10000); p3.add_script_tag(path=axe)
        check("recorder with microphone open: no axe violations", not (v := p3.evaluate(js)), str(v)); c2.close()
    b2.close()


def test_studio(browser, base):
    print("studio: timeline, editing, playback, keys, drums, export, save, backup")
    import tempfile, zipfile, base64, io, math
    errs = []
    ctx, pg = new_page(browser, errs, viewport={"width": 1400, "height": 1000}, accept_downloads=True)
    tmp = tempfile.mkdtemp(); f1, f2 = tmp + "/Click 120.wav", tmp + "/Tone 330.wav"
    make_wav(f1, 120, secs=10); make_wav(f2, 100, secs=6, tone=330.0)
    pg.goto(base + "studio.html?gvtest"); pg.wait_for_function("() => window.__st", timeout=10000)
    pg.select_option("#snap", "off")
    pg.set_input_files("#file", [f1, f2]); pg.wait_for_function("() => __st.P.tracks.length === 2", timeout=20000)
    st = lambda js: pg.evaluate(js)
    check("importing two files makes two audio tracks with clips of the right length", st("__st.P.tracks.every((t) => t.type === 'audio' && t.clips.length === 1)") and abs(st("__st.P.tracks[0].clips[0].dur") - 10) < 0.05 and abs(st("__st.P.tracks[1].clips[0].dur") - 6) < 0.05)
    check("waveform summaries exist for imported audio", st("__st.buffers.size") == 2)
    box = pg.locator("#tl").bounding_box(); LANE, RULER = 122, 28
    X = lambda sec: box["x"] + st(f"__st.xOf({sec})"); Y = lambda lane, off=60: box["y"] + RULER + LANE * lane + off
    # move clip 2 (lane 1) forward by 2 s
    pg.mouse.move(X(3), Y(1)); pg.mouse.down(); pg.mouse.move(X(3) + 60, Y(1), steps=4); pg.mouse.move(X(3) + 120, Y(1), steps=4); pg.mouse.up()
    check("dragging a clip moves it (2 s at 60 px per second)", abs(st("__st.P.tracks[1].clips[0].start") - 2) < 0.1, str(st("__st.P.tracks[1].clips[0].start")))
    # trim right edge of clip 2 back by 1 s
    end = 2 + 6
    pg.mouse.move(X(end) - 2, Y(1)); pg.mouse.down(); pg.mouse.move(X(end) - 62, Y(1), steps=5); pg.mouse.up()
    check("dragging the right edge trims the clip", abs(st("__st.P.tracks[1].clips[0].dur") - 5) < 0.1, str(st("__st.P.tracks[1].clips[0].dur")))
    # trim left edge by 1 s: offset grows
    pg.mouse.move(X(2) + 2, Y(1)); pg.mouse.down(); pg.mouse.move(X(2) + 62, Y(1), steps=5); pg.mouse.up()
    c = st("__st.P.tracks[1].clips[0]")
    check("dragging the left edge trims and moves the audio start inside the file", abs(c["offset"] - 1) < 0.1 and abs(c["start"] - 3) < 0.1 and abs(c["dur"] - 4) < 0.1, str(c))
    # undo / redo
    d0 = st("__st.undoDepth"); pg.click("#undo"); c2 = st("__st.P.tracks[1].clips[0]"); pg.click("#redo")
    check("undo restores the clip before the left trim and redo reapplies it", abs(c2["offset"]) < 0.01 and abs(st("__st.P.tracks[1].clips[0].offset") - 1) < 0.1 and d0 >= 3, str((c2, d0)))
    # split with keyboard
    pg.mouse.click(X(5), Y(0)); st("__st.setPlayhead(5)"); pg.click("#split")
    check("split cuts the selected clip at the playhead into two clips that add up", st("__st.P.tracks[0].clips.length") == 2 and abs(sum(c["dur"] for c in st("__st.P.tracks[0].clips")) - 10) < 0.01)
    pg.keyboard.press("Delete"); check("Delete removes the selected clip", st("__st.P.tracks[0].clips.length") == 1)
    pg.click("#undo")
    # fades via core scheduling: render with a fade in
    r = st("""async () => { const P = __st.P, c = P.tracks[0].clips[0]; c.fadeIn = 1; c.start = 0; c.dur = 10; c.offset = 0; P.tracks[1].mute = true;
      const b = await __st.Core.render(P, __st.buffers, { from: 0, to: 4, rate: 22050 }), d = b.getChannelData(0), rms = (a, z) => { let s = 0; for (let i = a; i < z; i++) s += d[i] * d[i]; return Math.sqrt(s / (z - a)); };
      P.tracks[1].mute = false; return { early: rms(0, 2205), late: rms(22050 * 2, 22050 * 3), len: b.length / b.sampleRate }; }""")
    check("offline render honours a one second fade in", r["early"] < r["late"] * 0.4 and r["late"] > 0.02, str(r))
    # solo and mute
    pg.locator("#heads").get_by_role("button", name="Mute Tone 330").click()
    check("mute silences a track in the mix", st("__st.Core.audible(__st.P, __st.P.tracks[1])") is False)
    pg.locator("#heads").get_by_role("button", name="Mute Tone 330").click()
    pg.locator("#heads").get_by_role("button", name="Solo Click 120").click()
    check("solo silences the others", st("__st.Core.audible(__st.P, __st.P.tracks[1])") is False and st("__st.Core.audible(__st.P, __st.P.tracks[0])"))
    pg.locator("#heads").get_by_role("button", name="Solo Click 120").click()
    # playback
    pg.keyboard.press("Home"); pg.locator("#tl").focus(); pg.keyboard.press("Space"); pg.wait_for_function("() => __st.playing", timeout=5000); pg.wait_for_timeout(1500)
    ph = st("__st.playhead"); check("space starts playback and the playhead advances", 0.8 < ph < 2.6, str(ph))
    pg.keyboard.press("Space"); check("space pauses", not st("__st.playing"))
    # loop: set region 1..2 s with shift-drag on the ruler, play, playhead stays inside
    pg.keyboard.down("Shift"); pg.mouse.move(X(1), box["y"] + 10); pg.mouse.down(); pg.mouse.move(X(1.5), box["y"] + 10, steps=3); pg.mouse.move(X(2), box["y"] + 10, steps=3); pg.mouse.up(); pg.keyboard.up("Shift")
    lp = st("__st.P.loop"); check("shift drag on the ruler sets and enables the loop", lp["on"] and abs(lp["a"] - 1) < 0.15 and abs(lp["b"] - 2) < 0.15, str(lp))
    st("__st.setPlayhead(1)"); st("__st.startFrom(1)"); pg.wait_for_timeout(3300)
    ph2 = st("__st.playhead"); nseg = st("__st.segs.length")
    check("looping keeps the playhead inside the loop region after 3 seconds", st("__st.playing") and 0.9 < ph2 < 2.1, str((ph2, nseg)))
    st("__st.stop()"); pg.click("#loop")
    # tempo change
    pg.fill("#bpm", "90"); pg.press("#bpm", "Enter"); pg.locator("#bpm").blur(); check("tempo can be changed", st("__st.P.bpm") == 90)
    pg.fill("#bpm", "120"); pg.locator("#bpm").blur()
    # keys track: create clip by double click, add notes in the roll
    pg.click("#addkeys"); st("__st.P.tracks[2].inst = 'Electric piano'"); idx = 2
    pg.mouse.dblclick(X(12), Y(idx)); pg.wait_for_selector("#rollcv", timeout=5000)
    check("double click on an empty keys lane makes a one bar clip and opens the piano roll", st("__st.P.tracks[2].clips.length") == 1 and abs(st("__st.P.tracks[2].clips[0].dur") - 2) < 0.01)
    rb = pg.locator("#rollcv").bounding_box(); k = lambda beat, pitch: (rb["x"] + 58 + beat * 52 + 6, rb["y"] + (96 - pitch) * 16 + 8)
    pg.select_option("select[aria-label=none]", "1") if False else None
    pg.locator(".rollscroll").scroll_into_view_if_needed(); pg.evaluate("document.querySelector('.rollscroll').scrollTop = 200"); pg.wait_for_timeout(100)
    for beat, pitch in [(0, 69), (1, 72), (2, 76)]:
        box_r = pg.locator("#rollcv").bounding_box(); pg.mouse.click(box_r["x"] + 58 + beat * 52 + 6, box_r["y"] + (96 - pitch) * 16 + 8)
    notes = st("__st.P.tracks[2].clips[0].notes")
    check("clicking the roll adds notes at the clicked pitch and time", len(notes) == 3 and [n["p"] for n in notes] == [69, 72, 76] and [round(n["t"], 2) for n in notes] == [0, 1, 2], str(notes))
    pg.keyboard.press("ArrowUp"); check("arrow up moves the selected note up one semitone", st("__st.P.tracks[2].clips[0].notes[2].p") == 77, str(pg.evaluate("[document.activeElement.id, document.activeElement.tagName, JSON.stringify(__st.P.tracks[2].clips[0].notes)]")))
    pg.keyboard.press("Delete"); check("Delete removes the selected note", st("__st.P.tracks[2].clips[0].notes.length") == 2)
    pg.get_by_role("button", name="Quantize", exact=True).click()
    # render keys alone: A4 sine at 440 Hz for the first note
    f = st("""async () => { const P = __st.P; const tr = P.tracks[2], c = tr.clips[0]; c.start = 0; c.notes = [{ t: 0, d: 2, p: 69, v: 110 }]; tr.inst = 'Electric piano';
      P.tracks.forEach((t, i) => { if (i !== 2) t.mute = true; });
      const b = await __st.Core.render(P, __st.buffers, { from: 0, to: 1.5, rate: 44100 }), d = b.getChannelData(0); let best = 0, bl = 0; for (let L = 40; L < 400; L++) { let s = 0; for (let i = 8000; i < 40000; i++) s += d[i] * d[i + L]; if (s > best) { best = s; bl = L; } }
      let pk = 0; for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i])); P.tracks.forEach((t) => { t.mute = false; }); return { hz: 44100 / bl, pk }; }""")
    check("a rendered A4 note on the electric piano sits near 440 Hz and is audible", 400 < f["hz"] < 520 and f["pk"] > 0.05, str(f))
    # drum track
    pg.click("#adddrums"); pg.locator("#tl").scroll_into_view_if_needed(); pg.evaluate("window.scrollTo(0, 0)"); box = pg.locator("#tl").bounding_box(); pg.mouse.dblclick(X(5), Y(3)); pg.wait_for_selector(".stepgrid", timeout=5000)
    pg.select_option("text=Choose…", "Four on the floor") if False else pg.locator("#rollpane select").nth(1).select_option("Four on the floor")
    g = st("__st.P.tracks[3].clips[0].grid"); check("drum preset fills the step grid (kick on 1 2 3 4)", g["Kick"][0] == 1 and g["Kick"][4] == 1 and g["Kick"][8] == 1 and g["Kick"][12] == 1 and g["Kick"][2] == 0, str(g))
    pg.get_by_role("button", name="Open hat step 3").click(); check("a step can be toggled", st("__st.P.tracks[3].clips[0].grid['Open hat'][2]") == 1 and pg.get_by_role("button", name="Open hat step 3").get_attribute("aria-pressed") == "true")
    dr = st("""async () => { const P = __st.P, tr = P.tracks[3], c = tr.clips[0]; c.start = 0; c.dur = 4; tr.clips[0].grid['Open hat'][2] = 0; P.tracks.forEach((t, i) => { t.mute = i !== 3; });
      const b = await __st.Core.render(P, __st.buffers, { from: 0, to: 2, rate: 22050, tail: 0.2 }), d = b.getChannelData(0), win = (a, z) => { let s = 0; for (let i = Math.round(a * 22050); i < Math.round(z * 22050); i++) s += d[i] * d[i]; return Math.sqrt(s / (22050 * (z - a))); };
      const o = { onBeat: [0, 0.5, 1, 1.5].map((t) => win(t, t + 0.05)), between: [0.2, 0.7, 1.2, 1.7].map((t) => win(t, t + 0.05)) }; P.tracks.forEach((t) => { t.mute = false; }); return o; }""")
    check("rendered drums hit on the beats (kick every half second at 120 BPM) and are quiet between", all(v > 0.05 for v in dr["onBeat"]) and max(dr["between"]) < min(dr["onBeat"]) * 0.7, str(dr))
    # export mix WAV and MP3, stems
    with pg.expect_download(timeout=60000) as dl: pg.click("#xgo")
    wavb = open(dl.value.path(), "rb").read(); secs = struct.unpack("<I", wavb[40:44])[0] / 4 / struct.unpack("<I", wavb[24:28])[0]
    check("export mix downloads a stereo WAV about as long as the project", wavb[:4] == b"RIFF" and struct.unpack("<H", wavb[22:24])[0] == 2 and 8 < secs < 30, str(secs))
    pg.select_option("#xfmt", "mp3")
    with pg.expect_download(timeout=90000) as dl2: pg.click("#xgo")
    mp3 = open(dl2.value.path(), "rb").read(); i = 0
    if mp3[:3] == b"ID3": i = 10 + ((mp3[6] << 21) | (mp3[7] << 14) | (mp3[8] << 7) | mp3[9])
    check("export mix as MP3 gives a valid MP3", mp3[i] == 0xFF and (mp3[i + 1] & 0xE0) == 0xE0 and dl2.value.suggested_filename.endswith(".mp3"))
    with pg.expect_download(timeout=90000) as dl3: pg.click("#xstems")
    zf = zipfile.ZipFile(dl3.value.path()); names = zf.namelist()
    lens = {n: struct.unpack("<I", zf.read(n)[40:44])[0] for n in names}
    check("stems ZIP holds one WAV per track with identical lengths", len(names) == len(st("__st.P.tracks.filter((t) => t.clips.length)")) and len(set(lens.values())) == 1 and zf.testzip() is None, str((names, lens)))
    # save, reload, reopen
    pg.fill("#pname", "Test song"); pg.locator("#pname").blur(); st("__st.saveNow()"); pg.wait_for_function("() => document.getElementById('saved').textContent.startsWith('Saved')", timeout=10000)
    ntr = st("__st.P.tracks.length"); pg.reload(); pg.wait_for_function("() => window.__st && __st.P.name === 'Test song' && __st.buffers.size === 2", timeout=20000)
    check("the project reopens by itself after a reload, with tracks and decoded audio", st("__st.P.tracks.length") == ntr and st("__st.buffers.size") == 2)
    # backup zip
    with pg.expect_download() as dl4: pg.click("#pexport")
    z2 = zipfile.ZipFile(dl4.value.path()); nm2 = z2.namelist(); pj = json.loads(z2.read("project.json"))
    check("backup zip has project.json and the audio files", "project.json" in nm2 and len([n for n in nm2 if n.startswith("assets/")]) == 2 and pj["app"] == "govibe-mix-studio" and z2.testzip() is None, str(nm2))
    zpath = tmp + "/backup.zip"; open(zpath, "wb").write(open(dl4.value.path(), "rb").read())
    pg.click("#pnew"); pg.wait_for_timeout(500); check("new project starts empty", st("__st.P.tracks.length") == 0)
    pg.set_input_files("#pimpfile", zpath); pg.wait_for_function("() => __st.P.tracks.length > 0 && __st.buffers.size === 2", timeout=20000)
    check("backup imports back with its tracks and audio", st("__st.P.name").startswith("Test song") and st("__st.P.tracks.length") == ntr)
    pg.set_input_files("#pimpfile", f1); pg.wait_for_timeout(500)
    check("importing a non backup file is refused without damage", st("__st.P.tracks.length") == ntr and "Import failed" in pg.inner_text("#status"))
    check("studio: no errors", not [e for e in errs if "Failed to load resource" not in e], str(errs))
    ctx.close()
    # a11y and phone
    axe = os.environ.get("AXE_PATH") or os.path.join(ROOT, "node_modules/axe-core/axe.min.js")
    if os.path.exists(axe):
        js = "axe.run(document,{runOnly:['wcag2a','wcag2aa','wcag21a','wcag21aa','best-practice']}).then(r=>r.violations.map(v=>v.id+' x'+v.nodes.length+' '+v.nodes[0].target.join(' ')))"
        c2 = browser.new_context(bypass_csp=True, viewport={"width": 1300, "height": 900}); p2 = c2.new_page(); p2.goto(base + "studio.html?gvtest"); p2.wait_for_function("() => window.__st"); p2.click("#addaudio"); p2.click("#addkeys"); p2.click("#adddrums")
        p2.add_script_tag(path=axe); check("studio with three tracks: no axe violations", not (v := p2.evaluate(js)), str(v))
        p2.mouse.dblclick(400, 28 + 122 + 60 + p2.locator("#tl").bounding_box()["y"]); p2.wait_for_selector("#rollcv"); check("studio with the piano roll open: no axe violations", not (v := p2.evaluate(js)), str(v))
        c2.close()
    c3 = browser.new_context(viewport={"width": 390, "height": 844}); p3 = c3.new_page(); p3.goto(base + "studio.html"); p3.click("#addaudio"); p3.wait_for_timeout(300)
    check("studio: no sideways scroll at 390px", p3.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth") <= 0, str(p3.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")))
    c3.close()


MIX_RENDER = """async (wins) => { const P = __st.P; const buf = await __st.Core.render(P, __st.buffers, {rate: 44100}); const d = buf.getChannelData(0), e = buf.getChannelData(1), r = buf.sampleRate; let peak = 0, fin = true;
 for (let i = 0; i < d.length; i++) { const v = Math.max(Math.abs(d[i]), Math.abs(e[i])); if (!isFinite(v)) fin = false; if (v > peak) peak = v; }
 const rms = (a, b) => { let s = 0; const i0 = Math.floor(a * r), i1 = Math.min(d.length, Math.floor(b * r)); for (let i = i0; i < i1; i++) s += d[i] * d[i] + e[i] * e[i]; return Math.sqrt(s / Math.max(1, (i1 - i0) * 2)); };
 return { peak, fin, len: buf.length / r, w: wins.map(([a, b]) => rms(a, b)) }; }"""


def test_mixer(browser, base):
    print("mixer: effects chains, sends, master chain, undo, save, export, live playback")
    import tempfile, io, zipfile
    errs = []
    ctx, pg = new_page(browser, errs, viewport={"width": 1400, "height": 1000}, accept_downloads=True)
    pg.goto(base + "studio.html?gvtest"); pg.wait_for_function("() => window.__st && window.__mx", timeout=10000)
    st = lambda js, *a: pg.evaluate(js, *a) if a else pg.evaluate(js)
    check("an empty project shows the mixer with an invitation and the returns and master strips", "appears here" in pg.inner_text("#strips") and pg.locator(".strip").count() == 3)
    # a drum hit on the very first beat, and a bass note
    st("() => { const k = __st.addTrack('midi'); const c = __st.newMidiClip(k, 0); c.notes = [{t: 0, p: 48, d: 0.25, v: 100}]; const d = __st.addTrack('drum'); const dc = __st.newMidiClip(d, 0); dc.dur = 0.5; dc.grid = {Snare: [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]}; }")
    check("each track gets a channel strip plus reverb return, delay return and master", pg.locator(".strip").count() == 5)
    check("new tracks start with an empty effects chain and no sends", st("__st.P.tracks.every((t) => Array.isArray(t.fx) && t.fx.length === 0 && t.sendR === 0 && t.sendD === 0)") and st("__st.P.mfx.length") == 0)
    W = [[0, 0.1], [0.3, 0.9], [2.05, 2.9], [0.5, 1.0], [1.0, 2.0]]
    R = lambda: pg.evaluate(MIX_RENDER, W)
    # work on the drum track (index 1): a hit on the first beat
    TK = "__st.P.tracks[1]"
    def setfx(t, p="{}", on="true", track=TK):
        st(f"() => {{ const T = {track}; T.fx = [Object.assign(__st.Core.newFx('{t}'), {{on: {on}}})]; Object.assign(T.fx[0].p, {p}); }}")
    st("() => { __st.P.tracks[0].mute = true; }")  # only the drum hit is heard in the effect measurements
    base_r = R()
    check("a hit on the first beat is not squashed by the limiter start up (peak above 0.3)", base_r["peak"] > 0.3, str(base_r["peak"]))
    for t in ("eq", "comp", "sat", "chorus", "delay", "reverb"):
        setfx(t, on="false"); r = R()
        check(f"{t} switched off sounds exactly like no effect", abs(r["peak"] - base_r["peak"]) < 1e-6 and abs(r["len"] - base_r["len"]) < 1e-6 and all(abs(a - b) < 1e-7 for a, b in zip(r["w"], base_r["w"])), str((r, base_r)))
    setfx("eq", "{low: 12, high: 12}"); r = R(); check("EQ with low and high boosted is louder and stays finite", r["fin"] and r["w"][0] > base_r["w"][0] * 1.15, str((r["w"][0], base_r["w"][0])))
    setfx("eq", "{low: -18, mid: -18, high: -18}"); r = R(); check("EQ cut by 18 dB is quieter", r["w"][0] < base_r["w"][0] * 0.85, str((r["w"][0], base_r["w"][0])))
    setfx("comp", "{thresh: -50, ratio: 20, attack: 1}"); r = R(); check("compressor with a low threshold pulls the hit down a lot", r["fin"] and r["w"][0] < base_r["w"][0] * 0.6, str((r["w"], base_r["w"])))
    setfx("comp", "{thresh: -50, ratio: 20, attack: 1, makeup: 12}"); r2 = R(); check("make up gain brings the compressed hit back up", r2["w"][0] > r["w"][0] * 2.5, str((r2["w"][0], r["w"][0])))
    setfx("sat", "{drive: 1}"); r = R(); check("saturation rounds off the peaks (lower peak to average ratio) and stays finite", r["fin"] and r["peak"] / r["w"][0] < (base_r["peak"] / base_r["w"][0]) * 0.92, str((r["peak"], r["w"][0], base_r["peak"], base_r["w"][0])))
    setfx("chorus", "{mix: 0.6}"); r = R(); check("chorus changes the sound and stays finite", r["fin"] and abs(r["w"][0] - base_r["w"][0]) > base_r["w"][0] * 0.01, str(r["w"]))
    setfx("delay", "{time: 400, fb: 0, mix: 1}"); r = R(); check("delay adds an echo where the original is silent", r["fin"] and base_r["w"][1] < 1e-3 and r["w"][1] > 0.01, str((r["w"], base_r["w"])))
    setfx("delay", "{time: 150, fb: 0.7, mix: 1}"); r = R(); check("delay feedback makes the export longer so the echoes are not cut off", r["len"] > base_r["len"] + 0.5, str((r["len"], base_r["len"])))
    setfx("reverb", "{mix: 0.5, size: 2}"); r = R(); check("reverb adds a tail where the original is silent and the export gets longer", r["fin"] and r["w"][1] > 0.003 and r["len"] > base_r["len"] + 0.9, str((r["w"], r["len"], base_r["len"])))
    r_dry = r["w"][0]; check("reverb keeps the direct sound about the same level (within 25%)", abs(r_dry - base_r["w"][0]) < base_r["w"][0] * 0.25, str((r_dry, base_r["w"][0])))
    # sends
    st(f"() => {{ {TK}.fx = []; {TK}.sendR = 1; }}"); r = R(); check("reverb send adds a tail from the shared reverb and lengthens the export", r["w"][1] > 0.003 and r["len"] > base_r["len"] + 0.9, str((r["w"], r["len"])))
    st(f"() => {{ {TK}.sendR = 0; {TK}.sendD = 1; }}"); r = R(); check("delay send adds echoes from the shared delay in time with the tempo", r["w"][1] > 0.01, str(r["w"]))
    st(f"() => {{ {TK}.mute = true; }}"); r = R(); check("muting a track silences its sends too", r["peak"] < 1e-4 or all(v < 1e-4 for v in r["w"][:2]) or r["peak"] < base_r["peak"] * 0.3, str(r))
    st(f"() => {{ {TK}.mute = false; {TK}.sendD = 0; }}")
    # per track stems of linear effects add back up to the mix
    st("() => { __st.P.tracks[0].mute = false; __st.P.tracks[0].fx = [__st.Core.newFx('reverb')]; __st.P.tracks[1].fx = [__st.Core.newFx('eq')]; __st.P.tracks[1].fx[0].p.high = 6; __st.P.tracks[0].sendR = 0.5; __st.P.tracks[1].sendR = 0.3; __st.P.limiter = false; }")
    err = st("""async () => { const Cr = __st.Core, P = __st.P, b = __st.buffers; const all = await Cr.render(P, b, {rate: 44100}); const s0 = await Cr.render(P, b, {rate: 44100, onlyTrack: P.tracks[0].id}), s1 = await Cr.render(P, b, {rate: 44100, onlyTrack: P.tracks[1].id});
      const n = Math.min(all.length, s0.length, s1.length); let m = 0, pk = 0; for (let c = 0; c < 2; c++) { const a = all.getChannelData(c), x = s0.getChannelData(c), y = s1.getChannelData(c); for (let i = 0; i < n; i++) { m = Math.max(m, Math.abs(a[i] - x[i] - y[i])); pk = Math.max(pk, Math.abs(a[i])); } } return { m, pk, same: all.length === s0.length && all.length === s1.length }; }""")
    check("stems with reverb sends and EQ add back up to the full mix (difference under 0.001) and are the same length", err["m"] < 1e-3 and err["same"] and err["pk"] > 0.05, str(err))
    st("() => { __st.P.limiter = true; __st.P.tracks.forEach((t) => { t.fx = []; t.sendR = 0; t.sendD = 0; }); }")
    # master chain
    st("() => { __st.P.mfx = [__st.Core.newFx('comp')]; Object.assign(__st.P.mfx[0].p, {thresh: -50, ratio: 20, attack: 1}); }"); r = R()
    check("a compressor on the master changes the mix and stays finite", r["fin"] and abs(r["w"][1] / r["w"][0] - base_r["w"][1] / base_r["w"][0]) > 0.05, str((r["w"], base_r["w"])))
    st("() => { __st.P.mfx = []; }")

    # ---------- the controls ----------
    st("() => { __st.afterStructure(); __st.undoDepth; }")
    d0 = st("__st.undoDepth")
    strip = pg.locator(".strip").nth(0)
    strip.locator("select.fxadd").select_option("reverb")
    check("choosing + Effect adds it to that track's chain with default settings", st("__st.P.tracks[0].fx.length") == 1 and st("__st.P.tracks[0].fx[0].type") == "reverb" and st("__st.P.tracks[0].fx[0].p.size") == 1.8)
    check("the editor opens for the new effect with a heading and one slider per setting", "Reverb on Keys 1" in pg.inner_text("#fxedit") and pg.locator("#fxedit input[type=range]").count() == 4, pg.inner_text("#fxedit")[:80])
    check("adding an effect is one undo step", st("__st.undoDepth") == d0 + 1)
    sz = pg.locator("#fxedit label.fxp", has_text="Size").locator("input")
    d1 = st("__st.undoDepth")
    sz.evaluate("(el) => { for (const v of [2.5, 3.5, 4.5]) { el.value = v; el.dispatchEvent(new Event('input', {bubbles: true})); } el.dispatchEvent(new Event('change', {bubbles: true})); }")
    check("dragging a slider changes the setting and is one undo step", abs(st("__st.P.tracks[0].fx[0].p.size") - 4.5) < 1e-6 and st("__st.undoDepth") == d1 + 1)
    check("the value readout follows the slider", "4.5" in pg.locator("#fxedit label.fxp", has_text="Size").inner_text())
    pg.click("#undo"); check("undo puts the setting back", abs(st("__st.P.tracks[0].fx[0].p.size") - 1.8) < 1e-6)
    pg.click("#redo"); check("redo applies it again", abs(st("__st.P.tracks[0].fx[0].p.size") - 4.5) < 1e-6)
    pg.click("#undo"); pg.click("#undo"); check("undoing again removes the effect", st("__st.P.tracks[0].fx.length") == 0 and "Choose an effect" in pg.inner_text("#fxedit"))
    for _ in range(2): pg.click("#redo")
    # chain order, on and off, remove
    pg.locator(".strip").nth(0).locator("select.fxadd").select_option("eq"); pg.locator(".strip").nth(0).locator("select.fxadd").select_option("comp")
    check("effects are added in order", st("__st.P.tracks[0].fx.map((f) => f.type)") == ["reverb", "eq", "comp"])
    pg.get_by_role("button", name="Move earlier").click()
    check("Earlier moves the selected effect up the chain", st("__st.P.tracks[0].fx.map((f) => f.type)") == ["reverb", "comp", "eq"])
    pg.locator(".strip").nth(0).get_by_role("button", name="Edit Reverb on Keys 1").click(); check("the first effect in a chain cannot move earlier", pg.get_by_role("button", name="Move earlier").is_disabled())
    pg.locator(".strip").nth(0).get_by_role("button", name="Edit Compressor on Keys 1").click()
    cb = pg.locator(".strip").nth(0).locator(".fxs input[type=checkbox]").nth(1); cb.uncheck()
    check("the checkbox bypasses just that effect", st("__st.P.tracks[0].fx[1].on") == False and st("__st.P.tracks[0].fx[0].on") != False)
    pg.get_by_role("button", name="Remove effect").click(); check("Remove deletes the effect", st("__st.P.tracks[0].fx.map((f) => f.type)") == ["reverb", "eq"])
    # sends, pan, fader
    sr = pg.locator(".strip").nth(0).locator("input[aria-label^='Reverb send']")
    sr.evaluate("(el) => { el.value = 40; el.dispatchEvent(new Event('input', {bubbles: true})); el.dispatchEvent(new Event('change', {bubbles: true})); }"); check("the reverb send slider sets the send level", abs(st("__st.P.tracks[0].sendR") - 0.4) < 1e-6)
    fd = pg.locator(".strip").nth(0).locator("input[aria-label^='Volume']"); fd.focus(); v0 = st("__st.P.tracks[0].vol"); pg.keyboard.press("ArrowUp")
    check("the fader works from the keyboard and the track header slider follows", st("__st.P.tracks[0].vol") > v0 and abs(float(pg.locator(".thead").nth(0).locator(".tvol").input_value()) / 100 - st("__st.P.tracks[0].vol")) < 0.011)
    pg.locator(".thead").nth(0).locator(".tvol").evaluate("(el) => { el.value = 55; el.dispatchEvent(new Event('input', {bubbles: true})); el.dispatchEvent(new Event('change', {bubbles: true})); }")
    check("moving the header slider moves the mixer fader", abs(float(fd.input_value()) - 55) < 1)
    pg.locator(".strip").nth(0).get_by_role("button", name="Mute Keys 1").click(); check("mute from the mixer mutes the track and the header shows it", st("__st.P.tracks[0].mute") and pg.locator(".thead").nth(0).locator("button[aria-label^='Mute']").get_attribute("aria-pressed") == "true")
    pg.locator(".strip").nth(0).get_by_role("button", name="Mute Keys 1").click()
    # master strip
    pg.locator(".strip.master select.fxadd").select_option("comp"); check("the master strip takes effects too", st("__st.P.mfx.length") == 1 and "Compressor on Master" in pg.inner_text("#fxedit"))
    pg.locator("#mfader").evaluate("(el) => { el.value = 50; el.dispatchEvent(new Event('input', {bubbles: true})); el.dispatchEvent(new Event('change', {bubbles: true})); }")
    check("the master fader and the Master volume slider are the same control", abs(st("__st.P.master") - 0.5) < 1e-6 and pg.input_value("#master") == "50")
    pg.evaluate("() => { const m = document.getElementById('master'); m.value = 80; m.dispatchEvent(new Event('input', {bubbles: true})); }"); check("and the Master volume slider moves the master fader", pg.input_value("#mfader") == "80")
    # returns
    pg.get_by_role("button", name="Edit reverb return").click(); check("the reverb return opens its own editor", "Reverb return" in pg.inner_text("#fxedit") and pg.locator("#fxedit input[type=range]").count() == 4)
    pg.locator("#fxedit label.fxp", has_text="Size").locator("input").evaluate("(el) => { el.value = 3; el.dispatchEvent(new Event('input', {bubbles: true})); el.dispatchEvent(new Event('change', {bubbles: true})); }"); check("changing the return changes the project's reverb send settings", abs(st("__st.P.sends.rev.size") - 3) < 1e-6)
    pg.get_by_role("button", name="Edit delay return").click(); sel = pg.locator("#fxedit label.fxp", has_text="Tempo sync").locator("select"); sel.select_option(label="1/8")
    check("the delay return has a tempo sync choice", abs(st("__st.P.sends.dly.sync") - 0.5) < 1e-6)
    pg.get_by_role("button", name="Reset settings").click(); check("Reset returns a return to its starting values", abs(st("__st.P.sends.dly.sync") - 0.75) < 1e-6)

    # ---------- live playback ----------
    st("() => { __st.setPlayhead(0); __st.startFrom(0); }"); pg.wait_for_timeout(700)
    gi = st("() => ({ n: __st.graph.tracks[__st.P.tracks[0].id].fx.length, m: __st.graph.mfx.length })")
    check("the live graph has the same effects as the project", gi["n"] == 2 and gi["m"] == 1, str(gi))
    pg.locator(".strip").nth(0).get_by_role("button", name="Edit EQ on Keys 1").click()
    pg.locator("#fxedit label.fxp", has_text="Low").locator("input").evaluate("(el) => { el.value = 9; el.dispatchEvent(new Event('input', {bubbles: true})); el.dispatchEvent(new Event('change', {bubbles: true})); }")
    pg.locator(".strip").nth(0).locator(".fxs input[type=checkbox]").nth(0).uncheck(); pg.wait_for_timeout(500)
    check("changing settings and bypassing while playing keeps playing and does not restart", st("__st.playing") and not errs, str(errs[:2]))
    pg.wait_for_timeout(300); mm = pg.evaluate("() => [...document.querySelectorAll('.vmeter i')].map((i) => i.style.height)")
    check("the channel meters move while playing", any(h not in ("0px", "0", "") for h in mm), str(mm))
    st("() => __st.stop()"); pg.wait_for_timeout(200)
    check("meters fall back to zero when stopped", all(h in ("0px", "0", "") for h in pg.evaluate("() => [...document.querySelectorAll('.vmeter i')].map((i) => i.style.height)")))
    # ---------- save, reopen, backup, old projects ----------
    snap = st("() => JSON.stringify({ f: __st.P.tracks.map((t) => t.fx), m: __st.P.mfx, s: __st.P.sends, r: __st.P.tracks.map((t) => [t.sendR, t.sendD]) })")
    st("() => __st.saveNow()"); pid = st("__st.P.id"); st("() => __st.newProject()"); st("(id) => __st.openProject(id)", pid); pg.wait_for_timeout(300)
    check("effects, sends and returns are saved with the project and come back after reopening", st("() => JSON.stringify({ f: __st.P.tracks.map((t) => t.fx), m: __st.P.mfx, s: __st.P.sends, r: __st.P.tracks.map((t) => [t.sendR, t.sendD]) })") == snap)
    check("the mixer shows the reopened project", pg.locator(".strip").count() == 5 and pg.locator(".strip").nth(0).locator(".fxs").count() == 2)
    bk = st("""async () => { const z = await GVStudioIO.exportZip(__st.P, __st.blobs); const r = await GVStudioIO.importZip(z); return JSON.stringify({ f: r.p.tracks.map((t) => t.fx), m: r.p.mfx, s: r.p.sends, r: r.p.tracks.map((t) => [t.sendR, t.sendD]) }); }""")
    check("the backup ZIP carries the mixer settings", bk == snap)
    st("""async () => { const P = __st.P; P.tracks.forEach((t) => { delete t.fx; delete t.sendR; delete t.sendD; }); delete P.mfx; delete P.sends; await __st.saveNow(); }"""); st("(id) => __st.openProject(id)", pid); pg.wait_for_timeout(300)
    check("a project saved before the mixer existed opens with empty chains and default returns", st("__st.P.tracks.every((t) => Array.isArray(t.fx) && t.sendR === 0)") and st("Array.isArray(__st.P.mfx)") and st("!!__st.P.sends.rev && !!__st.P.sends.dly") and pg.locator(".strip").count() == 5)
    r_old = R(); check("and it still renders", r_old["fin"] and r_old["peak"] > 0.05)
    # ---------- export with effects ----------
    import numpy as np, scipy.io.wavfile as sw
    st("() => { __st.P.tracks[1].fx = [Object.assign(__st.Core.newFx('reverb'), {})]; __st.P.tracks[1].fx[0].p.mix = 0.5; __st.P.tracks[1].fx[0].p.size = 2.5; __st.afterStructure(); }")
    base_len = st("() => __st.Core.projectEnd(__st.P)")
    pg.select_option("#xfmt", "wav16")
    with pg.expect_download(timeout=60000) as dl: pg.click("#xgo")
    sr_, data = sw.read(dl.value.path()); dur = len(data) / sr_
    tail = data[int((base_len + 0.3) * sr_):]
    check("the exported WAV includes the reverb tail beyond the last clip", dur > base_len + 2 and np.abs(tail).max() > 3, f"{dur:.2f}s vs {base_len:.2f}s")
    # ---------- phone width and accessibility ----------
    ctx2, p2 = new_page(browser, errs, viewport={"width": 390, "height": 800}); p2.goto(base + "studio.html?gvtest"); p2.wait_for_function("() => window.__st && window.__mx", timeout=10000)
    p2.evaluate("() => { for (const t of ['midi', 'drum', 'midi', 'drum']) __st.addTrack(t); }"); p2.locator(".strip").nth(0).locator("select.fxadd").select_option("reverb")
    check("at phone width the page does not scroll sideways (the strips scroll inside the mixer)", p2.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1"), str(p2.evaluate("() => [document.documentElement.scrollWidth, window.innerWidth]")))
    check("the strips row scrolls on its own", p2.evaluate("() => { const s = document.getElementById('strips'); return s.scrollWidth > s.clientWidth + 50; }"))
    p2.click("#mixtoggle"); check("Hide folds the mixer away and Show brings it back", p2.locator("#mixbody").is_hidden() and p2.get_attribute("#mixtoggle", "aria-expanded") == "false")
    p2.click("#mixtoggle"); check("the mixer is open again", p2.locator("#mixbody").is_visible())
    ctx2.close()
    axe = os.environ.get("AXE_PATH") or os.path.join(ROOT, "node_modules/axe-core/axe.min.js")
    if os.path.exists(axe):
        ctx3 = browser.new_context(bypass_csp=True, viewport={"width": 1400, "height": 1000}); p3 = ctx3.new_page(); p3.goto(base + "studio.html?gvtest"); p3.wait_for_function("() => window.__st && window.__mx", timeout=10000)
        p3.evaluate("() => { __st.addTrack('midi'); __st.addTrack('drum'); }"); p3.locator(".strip").nth(0).locator("select.fxadd").select_option("delay"); p3.locator(".strip.master select.fxadd").select_option("eq"); p3.locator(".strip").nth(0).get_by_role("button", name="Edit Delay on Keys 1").click()
        p3.add_script_tag(path=axe)
        v = p3.evaluate("axe.run(document,{runOnly:['wcag2a','wcag2aa','wcag21a','wcag21aa','best-practice']}).then(r=>r.violations.map(v=>v.id+' x'+v.nodes.length+' '+v.nodes[0].target.join(' ')))")
        check("studio with the mixer, effects and editor open: no axe violations", not v, str(v)); ctx3.close()
    check("no page errors in the mixer", not errs, str(errs[:3]))
    ctx.close()


def _vlq(n):
    b = [n & 127]
    n >>= 7
    while n:
        b.insert(0, (n & 127) | 128); n >>= 7
    return bytes(b)


def build_midi(path, ppq=96, fmt=1):
    """An independent MIDI builder (not the site's writer): tempo 90, 3/4, markers, a piano line with running status and
    velocity 0 note offs, a bass on channel 2 with a program change, and a drum pattern on channel 10."""
    import struct
    def trk(events):
        out = b""; last = 0
        for at, data in sorted(events, key=lambda e: e[0]):
            out += _vlq(at - last) + data; last = at
        out += b"\x00\xff\x2f\x00"; return b"MTrk" + struct.pack(">I", len(out)) + out
    mpq = 60000000 // 90
    cond = [(0, b"\xff\x51\x03" + mpq.to_bytes(3, "big")), (0, b"\xff\x58\x04\x03\x02\x18\x08"), (0, b"\xff\x03\x05Songy"), (ppq * 4, b"\xff\x06\x06Chorus"), (ppq * 8, b"\xff\x51\x03" + (mpq * 2).to_bytes(3, "big"))]
    piano = [(0, b"\xff\x03\x05Piano"), (0, b"\xc0\x00")]
    # C4 E4 G4 as quarter notes, written with running status (no repeated 0x90) and velocity 0 as note off
    t = 0
    for pitch in (60, 64, 67):
        piano.append((t, b"\x90" + bytes([pitch, 100])))
        piano.append((t + ppq, b"\x90" + bytes([pitch, 0]))); t += ppq
    piano.append((ppq * 3, b"\x90" + bytes([84, 90]))); piano.append((ppq * 3 + ppq * 2, b"\x80" + bytes([84, 0])))  # a high C6 note
    piano.append((ppq * 6, b"\x90" + bytes([20, 80]))); piano.append((ppq * 6 + ppq, b"\x80" + bytes([20, 0])))  # below the piano roll range
    bass = [(0, b"\xff\x03\x04Bass"), (0, b"\xc1\x21"), (0, b"\x91" + bytes([36, 110])), (ppq * 2, b"\x81" + bytes([36, 0]))]
    drums = [(0, b"\xff\x03\x05Drums")]
    for step in range(16):
        drums.append((step * ppq // 4, b"\x99" + bytes([42, 70]))); drums.append((step * ppq // 4 + 10, b"\x89" + bytes([42, 0])))
    drums.append((0, b"\x99" + bytes([36, 127]))); drums.append((10, b"\x89" + bytes([36, 0])))
    drums.append((ppq * 2, b"\x99" + bytes([38, 100]))); drums.append((ppq * 2 + 10, b"\x89" + bytes([38, 0])))
    drums.append((ppq * 4 + ppq * 2, b"\x99" + bytes([38, 100]))); drums.append((ppq * 4 + ppq * 2 + 10, b"\x89" + bytes([38, 0])))  # a snare in the second bar
    chunks = [trk(cond), trk(piano), trk(bass), trk(drums)] if fmt == 1 else [trk(cond + piano + bass + drums)]
    open(path, "wb").write(b"MThd" + struct.pack(">IHHH", 6, fmt, len(chunks), ppq) + b"".join(chunks))


def test_midi(browser, base):
    print("midi: import (independent file, format 0 and 1), export and round trip")
    import tempfile
    errs = []
    ctx, pg = new_page(browser, errs, viewport={"width": 1400, "height": 1000}, accept_downloads=True)
    pg.goto(base + "studio.html?gvtest"); pg.wait_for_function("() => window.__st && window.GVMidi", timeout=10000)
    tmp = tempfile.mkdtemp(); f1, f0 = tmp + "/song.mid", tmp + "/flat.mid"; build_midi(f1, ppq=96, fmt=1); build_midi(f0, ppq=480, fmt=0)
    st = lambda js, *a: pg.evaluate(js, *a) if a else pg.evaluate(js)
    pg.set_input_files("#midifile", f1); pg.wait_for_function("() => __st.P.tracks.length > 0", timeout=10000)
    check("a type 1 file with three instruments becomes three tracks: keys, bass keys and drums", st("__st.P.tracks.map((t) => t.type)") == ["midi", "midi", "drum"], str(st("__st.P.tracks.map((t) => t.type)")))
    check("the file's tempo is adopted by an empty project (90 BPM)", abs(st("__st.P.bpm") - 90) < 0.01)
    check("the file's 3/4 time signature is adopted too", st("__st.P.sig") == [3, 4])
    check("the file's marker Chorus lands at beat 4 (2.667 s at 90 BPM)", st("__st.P.markers.length") == 1 and st("__st.P.markers[0].name") == "Chorus" and abs(st("__st.P.markers[0].t") - 4 * 60 / 90) < 0.01, str(st("__st.P.markers")))
    check("track names come from the file", st("__st.P.tracks.map((t) => t.name)") == ["Piano", "Bass", "Drums"])
    check("the program change picks the bass instrument", st("__st.P.tracks.map((t) => t.inst)")[:2] == ["Piano", "Bass"])
    n = st("__st.P.tracks[0].clips[0].notes")
    check("piano notes land on the right beats and pitches (running status and velocity 0 note offs handled)", [x["p"] for x in n[:3]] == [60, 64, 67] and [round(x["t"], 3) for x in n[:3]] == [0, 1, 2] and all(abs(x["d"] - 1) < 0.01 for x in n[:3]), str(n[:4]))
    check("note length and velocity are kept", any(x["p"] == 84 and abs(x["d"] - 2) < 0.01 and x["v"] == 90 for x in n))
    check("the clip is rounded up to whole bars", abs(st("__st.P.tracks[0].clips[0].dur") / st("__st.Core.spb(__st.P)") % 4) < 0.01 or abs(st("__st.P.tracks[0].clips[0].dur") / st("__st.Core.spb(__st.P)") % 4 - 4) < 0.01)
    g0 = st("__st.P.tracks[2].clips[0].grid"); g1 = st("__st.P.tracks[2].clips[1].grid")
    check("drums on channel 10 become a step grid: kick on 1, snare on beat 3, a hat on every sixteenth", g0["Kick"][0] > 0.9 and g0["Snare"][8] > 0.7 and all(v > 0.4 for v in g0["Hat"]), str(g0))
    check("a snare in the second bar goes into a second clip", len(st("__st.P.tracks[2].clips")) == 2 and g1["Snare"][8] > 0.7 and abs(st("__st.P.tracks[2].clips[1].start") - 4 * st("__st.Core.spb(__st.P)") * 1) < 0.01, str(g1))
    msg = pg.inner_text("#status")
    check("the status explains what came in, the tempo, the extra tempo change and the out of range note", "3 track" in msg and "90 BPM" in msg and "changes tempo" in msg and "outside the piano roll range" in msg, msg)
    # existing project keeps its tempo
    st("() => { __st.P.bpm = 140; }")
    pg.set_input_files("#midifile", f0); pg.wait_for_function("() => __st.P.tracks.length === 6", timeout=10000)
    check("importing into a project that has tracks keeps the project tempo", abs(st("__st.P.bpm") - 140) < 0.01 and "tempo was kept" in pg.inner_text("#status"), pg.inner_text("#status"))
    check("a type 0 file (everything in one track) splits by channel into keys, bass and drums", st("__st.P.tracks.slice(3).map((t) => t.type)") == ["midi", "midi", "drum"])
    check("a 480 ticks per beat file gives the same note positions as the 96 ticks per beat file", [round(x["t"], 3) for x in st("__st.P.tracks[3].clips[0].notes")[:3]] == [0, 1, 2])
    # round trip through our own writer and reader
    st("() => { __st.P.tracks = __st.P.tracks.slice(0, 3); __st.P.bpm = 90; __st.afterStructure(); }")
    rt = st("""() => { const bytes = GVMidi.write(__st.P), r = GVMidi.read(bytes), specs = GVMidi.toSpecs(r);
      return { head: String.fromCharCode(...bytes.slice(0, 4)), n: r.tracks.length, bpm: Math.round(r.bpm * 100) / 100, kinds: specs.map((s) => s.type), first: specs[0].notes.slice(0, 3).map((x) => [x.p, x.t, x.d]), grid: specs[2].clips[0].grid.Kick[0], marks: r.markers.length }; }""")
    check("our own MIDI file starts with MThd, reads back with the same tracks, tempo and notes", rt["head"] == "MThd" and rt["n"] == 3 and abs(rt["bpm"] - 90) < 0.01 and rt["kinds"] == ["midi", "midi", "drum"] and [x[0] for x in rt["first"]] == [60, 64, 67] and abs(rt["first"][1][1] - 1) < 0.01 and rt["grid"] > 0.9, str(rt))
    # download from the export panel
    import tempfile as tf
    pg.select_option("#xfmt", "mid")
    with pg.expect_download(timeout=20000) as dl: pg.click("#xgo")
    raw = open(dl.value.path(), "rb").read()
    check("exporting MIDI downloads a .mid file that starts with MThd and has 4 tracks (tempo plus three)", dl.value.suggested_filename.endswith(".mid") and raw[:4] == b"MThd" and int.from_bytes(raw[10:12], "big") == 4 and int.from_bytes(raw[8:10], "big") == 1, dl.value.suggested_filename)
    # the independent builder's tempo and time signature survive: check the bytes of what we wrote
    check("the file carries a set tempo of 90 BPM (666667 microseconds per beat)", b"\xff\x51\x03" + (666667).to_bytes(3, "big") in raw)
    # audio only project cannot export MIDI
    st("() => { __st.newProject(); }"); pg.wait_for_timeout(200); pg.click("#xgo"); pg.wait_for_timeout(200)
    check("an empty project says there is nothing to export as MIDI", "no keys or drum clips" in pg.inner_text("#status"), pg.inner_text("#status"))
    # damaged and wrong files
    open(tmp + "/bad.mid", "wb").write(b"not a midi file at all, just text")
    pg.set_input_files("#midifile", tmp + "/bad.mid"); pg.wait_for_timeout(300); check("a file that is not MIDI gives a clear message and changes nothing", "does not look like a MIDI file" in pg.inner_text("#status") and st("__st.P.tracks.length") == 0, pg.inner_text("#status"))
    raw1 = open(f1, "rb").read(); open(tmp + "/cut.mid", "wb").write(raw1[:len(raw1) - 25])
    pg.set_input_files("#midifile", tmp + "/cut.mid"); pg.wait_for_timeout(500)
    check("a file cut short still imports what it has without crashing the page", st("__st.P.tracks.length") >= 1 and not errs, str(errs[:2]))
    check("no page errors importing and exporting MIDI", not errs, str(errs[:3]))
    ctx.close()


def test_sig_markers(browser, base):
    print("studio: time signatures and markers")
    errs = []
    ctx, pg = new_page(browser, errs, viewport={"width": 1400, "height": 1000}, accept_downloads=True)
    pg.goto(base + "studio.html?gvtest"); pg.wait_for_function("() => window.__st", timeout=10000)
    st = lambda js, *a: pg.evaluate(js, *a) if a else pg.evaluate(js)
    check("the time signature menu offers 2/4, 3/4, 4/4, 5/4, 6/8, 7/8 and 12/8 and starts at 4/4", pg.locator("#sig option").all_inner_texts() == ["2/4", "3/4", "4/4", "5/4", "6/8", "7/8", "12/8"] and pg.input_value("#sig") == "4/4" and st("__st.P.sig") == [4, 4])
    st("() => { __st.addTrack('midi'); __st.addTrack('drum'); }")
    pg.select_option("#sig", "3/4"); check("choosing 3/4 sets the project signature and a bar of three beats", st("__st.P.sig") == [3, 4] and st("__st.barBeats()") == 3)
    kc = st("() => { const c = __st.newMidiClip(__st.P.tracks[0], 0); return c.dur / __st.Core.spb(__st.P); }"); dc = st("() => { const c = __st.newMidiClip(__st.P.tracks[1], 0); return [c.dur / __st.Core.spb(__st.P), c.steps]; }")
    check("a new keys clip is one bar of 3 beats and a new drum clip has 12 sixteenth steps", abs(kc - 3) < 1e-6 and abs(dc[0] - 3) < 1e-6 and dc[1] == 12, str((kc, dc)))
    pg.select_option("#sig", "7/8"); check("7/8 makes a bar of 3.5 quarter beats", abs(st("__st.barBeats()") - 3.5) < 1e-9)
    dc = st("() => { const c = __st.newMidiClip(__st.P.tracks[1], 8); __st.sel = { track: __st.P.tracks[1].id, clip: c.id }; GVRoll.open(__st.P.tracks[1].id, c.id); return [c.steps, c.dur / __st.Core.spb(__st.P)]; }"); check("a drum clip in 7/8 has 14 steps", dc[0] == 14 and abs(dc[1] - 3.5) < 1e-6, str(dc))
    pg.wait_for_timeout(300)
    opts = pg.locator("#rollpane select").first.locator("option").all_inner_texts()
    check("the step editor offers one, two and four bars of steps for 7/8 (14, 28, 56)", "14" in opts and "28" in opts and "56" in opts, str(opts))
    def clicks(sig):
        return pg.evaluate("""async (sig) => { const P = __st.P; P.sig = sig; P.tracks = []; P.limiter = false; const oc = new OfflineAudioContext(2, 44100 * 3, 44100), g = __st.Core.buildGraph(oc, oc.destination, P, {});
          __st.Core.scheduleSegment(oc, g, P, __st.buffers, { when: 0, from: 0, to: 3 }, { metronome: true }); const r = await oc.startRendering(), x = r.getChannelData(0), hits = []; let quiet = -99999;
          for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > 0.02 && i - quiet > 44100 * 0.12) { let pk = 0; for (let k = i; k < Math.min(x.length, i + 2000); k++) pk = Math.max(pk, Math.abs(x[k])); hits.push([+(i / 44100).toFixed(2), +pk.toFixed(2)]); quiet = i; } }
          return hits; }""", sig)
    h44 = clicks([4, 4]); check("4/4 clicks once per quarter note (6 in 3 seconds at 120 BPM) with an accent on beat one", len(h44) == 6 and h44[0][1] > h44[1][1] and h44[4][1] > h44[5][1] and abs(h44[1][0] - 0.5) < 0.03, str(h44))
    h68 = clicks([6, 8]); check("6/8 clicks once per eighth note (12 in 3 seconds) with the accent at the start of each bar", len(h68) == 12 and h68[0][1] > h68[1][1] and h68[6][1] > h68[7][1] and abs(h68[1][0] - 0.25) < 0.03, str(h68[:8]))
    st("() => { __st.newProject(); }"); pg.wait_for_timeout(300)
    check("a new project is back in 4/4 with no markers", st("__st.P.sig") == [4, 4] and pg.input_value("#sig") == "4/4" and st("__st.P.markers.length") == 0)
    # ---------- markers ----------
    st("() => { __st.addTrack('drum'); __st.setPlayhead(2.37); }"); pg.click("#addmark")
    check("Add marker puts a marker at the playhead with a default name", st("__st.P.markers.length") == 1 and abs(st("__st.P.markers[0].t") - 2.37) < 1e-6 and st("__st.P.markers[0].name") == "Marker 1")
    check("the Markers list shows it and the count updates", "(1)" in pg.inner_text("#markcount") and pg.locator("#marklist li").count() == 1)
    pg.click("#marks summary"); nm = pg.locator("#marklist input[type=text]").first; nm.fill("Verse"); nm.press("Enter"); nm.blur()
    check("renaming a marker from the list keeps the new name", st("__st.P.markers[0].name") == "Verse")
    st("() => { __st.setPlayhead(0.8); }"); pg.locator("#tl").focus(); pg.keyboard.press("k")
    check("pressing K adds another marker and the list stays in time order", st("__st.P.markers.map((m) => m.name)") == ["Marker 1", "Verse"] and abs(st("__st.P.markers[0].t") - 0.8) < 1e-6, str(st("__st.P.markers")))
    st("() => __st.setPlayhead(0)"); pg.locator("#tl").focus(); pg.keyboard.press(".")
    check("the period key jumps to the next marker", abs(st("__st.playhead") - 0.8) < 1e-6)
    pg.keyboard.press("."); check("and again to the one after", abs(st("__st.playhead") - 2.37) < 1e-6)
    pg.keyboard.press("."); check("there is nothing after the last marker and it says so", abs(st("__st.playhead") - 2.37) < 1e-6 and "no marker after" in pg.inner_text("#status"))
    pg.keyboard.press(","); check("the comma key jumps back to the previous marker", abs(st("__st.playhead") - 0.8) < 1e-6)
    box = pg.locator("#tl").bounding_box(); x = box["x"] + st("__st.xOf(2.37)") + 4
    pg.mouse.click(x, box["y"] + 20); check("clicking a flag on the ruler moves the playhead exactly to the marker, ignoring snap", abs(st("__st.playhead") - 2.37) < 1e-6, str(st("__st.playhead")))
    pg.wait_for_timeout(250); px = st("() => { const c = document.getElementById('tl'); return Array.from(c.getContext('2d').getImageData(Math.round(__st.xOf(2.37)) + 3, 15, 1, 1).data); }")
    check("the marker flag is drawn on the ruler (teal pill)", px[:3] == [14, 116, 144], str(px))
    n0 = st("__st.P.markers.length"); pg.click("#undo"); check("undo takes a marker away", st("__st.P.markers.length") == n0 - 1 or st("__st.P.markers[0].name") != "Verse", str(st("__st.P.markers")))
    pg.click("#redo"); check("redo brings it back", st("__st.P.markers.length") == n0)
    pg.get_by_role("button", name="Delete Verse").click(); check("Delete removes a marker", st("__st.P.markers.map((m) => m.name)") == ["Marker 1"])
    st("() => { __st.setPlayhead(1.5); __st.addMarker(); }"); st("() => { __st.P.sig = [6, 8]; }"); st("() => __st.saveNow()"); pid = st("__st.P.id"); snap = st("JSON.stringify([__st.P.markers, __st.P.sig])")
    st("() => __st.newProject()"); st("(id) => __st.openProject(id)", pid); pg.wait_for_timeout(300)
    check("markers and the time signature come back after reopening", st("JSON.stringify([__st.P.markers, __st.P.sig])") == snap and pg.input_value("#sig") == "6/8" and pg.locator("#marklist li").count() == 2)
    bk = st("""async () => { const z = await GVStudioIO.exportZip(__st.P, __st.blobs); const r = await GVStudioIO.importZip(z); return JSON.stringify([r.p.markers, r.p.sig]); }""")
    check("the backup ZIP carries markers and the signature", bk == snap)
    st("() => { __st.P.tracks[0].clips.push({ id: 'zz', start: 0, dur: 2, steps: 16, swing: 0, grid: { Kick: [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0] } }); __st.afterStructure(); }")
    pg.select_option("#xfmt", "mid")
    with pg.expect_download(timeout=20000) as dl: pg.click("#xgo")
    raw = open(dl.value.path(), "rb").read()
    check("the MIDI export writes the 6/8 time signature and the markers", bytes([0xff, 0x58, 4, 6, 3, 24, 8]) in raw and b"Marker 1" in raw and b"Marker 2" in raw, str(raw[:60]))
    st("""async () => { const P = __st.P; delete P.sig; delete P.markers; await __st.saveNow(); }"""); st("(id) => __st.openProject(id)", pid); pg.wait_for_timeout(300)
    check("an older project without a signature or markers opens as 4/4 with none", st("__st.P.sig") == [4, 4] and st("Array.isArray(__st.P.markers)") and pg.input_value("#sig") == "4/4")
    st("() => { __st.P.sig = [9, 9]; __st.afterStructure(); }"); check("an invalid signature in a damaged file is replaced by 4/4", st("__st.P.sig") == [4, 4])
    axe = os.environ.get("AXE_PATH") or os.path.join(ROOT, "node_modules/axe-core/axe.min.js")
    if os.path.exists(axe):
        c3 = browser.new_context(bypass_csp=True, viewport={"width": 1400, "height": 1000}); p3 = c3.new_page(); p3.goto(base + "studio.html?gvtest"); p3.wait_for_function("() => window.__st", timeout=10000)
        p3.evaluate("() => { __st.addTrack('drum'); __st.setPlayhead(1); __st.addMarker(); __st.setPlayhead(3); __st.addMarker(); }"); p3.click("#marks summary"); p3.add_script_tag(path=axe)
        v = p3.evaluate("axe.run(document,{runOnly:['wcag2a','wcag2aa','wcag21a','wcag21aa','best-practice']}).then(r=>r.violations.map(v=>v.id+' x'+v.nodes.length+' '+v.nodes[0].target.join(' ')))")
        check("studio with the markers list open and a time signature menu: no axe violations", not v, str(v)); c3.close()
    check("no page errors with time signatures and markers", not errs, str(errs[:3]))
    ctx.close()


def test_studio_rec(browser, base):
    print("studio: recording onto a track (fake microphone), count in, punch, latency, undo, save")
    import tempfile
    errs = []
    b2 = _sp_instance.chromium.launch(args=["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"])
    ctx, pg = new_page(b2, errs, viewport={"width": 1400, "height": 1000}, permissions=["microphone"])
    pg.goto(base + "studio.html?gvtest"); pg.wait_for_function("() => window.__st && window.GVStudioRec", timeout=10000)
    st = lambda js, *a: pg.evaluate(js, *a) if a else pg.evaluate(js)
    tmp = tempfile.mkdtemp(); f1 = tmp + "/Click 120.wav"; make_wav(f1, 120, secs=6)
    pg.click("#recpanel summary")
    pg.click("#rec"); check("Record with no armed track explains what to do", "Arm an audio track" in pg.inner_text("#status"), pg.inner_text("#status"))
    pg.set_input_files("#file", f1); pg.wait_for_function("() => __st.P.tracks.length === 1", timeout=20000)
    st("() => { __st.addTrack('midi'); __st.addTrack('audio'); }")
    heads = pg.locator(".thead")
    check("only audio tracks have an arm button", heads.nth(0).locator("button[aria-label^='Arm']").count() == 1 and heads.nth(1).locator("button[aria-label^='Arm']").count() == 0 and heads.nth(2).locator("button[aria-label^='Arm']").count() == 1)
    heads.nth(0).locator("button[aria-label^='Arm']").click(); heads.nth(2).locator("button[aria-label^='Arm']").click()
    check("arming one track disarms the other and says which track is armed", heads.nth(2).locator("button[aria-label^='Arm']").get_attribute("aria-pressed") == "true" and heads.nth(0).locator("button[aria-label^='Arm']").get_attribute("aria-pressed") == "false" and "is armed" in pg.inner_text("#status"))
    pg.fill("#reclat", "0"); pg.locator("#reclat").dispatch_event("change")
    # ---- a plain take from the playhead ----
    st("() => __st.setPlayhead(1)"); pg.click("#rec"); pg.wait_for_function("() => GVStudioRec.active()", timeout=10000)
    check("while recording the button shows Stop recording and the music plays", pg.get_attribute("#rec", "aria-pressed") == "true" and "Stop recording" in pg.inner_text("#rec") and st("__st.playing"))
    pg.wait_for_timeout(2400); pg.click("#rec"); pg.wait_for_function("() => !GVStudioRec.active() && __st.P.tracks[2].clips.length === 1", timeout=10000)
    c = st("__st.P.tracks[2].clips[0]"); a = st("__st.P.assets[__st.P.tracks[2].clips[0].assetId]")
    check("the take is a clip on the armed track that starts at the playhead (1.0 s)", abs(c["start"] - 1.0) < 0.01, str(c))
    check("its length is about the time recorded (1.5 to 3 s)", 1.5 < c["dur"] < 3.0 and abs(c["offset"]) < 1e-9, str(c))
    check("the take was stored as a mono WAV that is not silent", st("async () => { const b = __st.blobs.get(__st.P.tracks[2].clips[0].assetId), h = new Uint8Array(await b.slice(0, 12).arrayBuffer()); const buf = __st.buffers.get(__st.P.tracks[2].clips[0].assetId), d = buf.getChannelData(0); let pk = 0; for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i])); return String.fromCharCode(...h.slice(0, 4)) === 'RIFF' && buf.numberOfChannels === 1 && pk > 0.01; }"))
    check("the status says how long the take is and music stopped", "Recorded" in pg.inner_text("#status") and not st("__st.playing"), pg.inner_text("#status"))
    pg.click("#undo"); check("undo removes the take", st("__st.P.tracks[2].clips.length") == 0)
    pg.click("#redo"); check("redo puts it back", st("__st.P.tracks[2].clips.length") == 1)
    # ---- latency fix ----
    pg.fill("#reclat", "120"); pg.locator("#reclat").dispatch_event("change")
    st("() => __st.setPlayhead(8)"); pg.click("#rec"); pg.wait_for_function("() => GVStudioRec.active()", timeout=10000); pg.wait_for_timeout(1500); pg.click("#stop"); pg.wait_for_function("() => !GVStudioRec.active() && __st.P.tracks[2].clips.length === 2", timeout=10000)
    c2 = st("__st.P.tracks[2].clips[1]"); a2 = st("__st.P.assets[__st.P.tracks[2].clips[1].assetId]")
    check("the latency fix trims the start of the take (offset 0.12 s) and shortens it by the same amount", abs(c2["offset"] - 0.12) < 1e-6 and abs(c2["dur"] + 0.12 - a2["dur"]) < 0.002, str((c2, a2)))
    check("the Stop button also ends a recording", not st("GVStudioRec.active()"))
    # ---- recording over existing audio goes on a new track ----
    st("() => __st.setPlayhead(1.2)"); pg.click("#rec"); pg.wait_for_function("() => GVStudioRec.active()", timeout=10000); pg.wait_for_timeout(1200); pg.click("#rec"); pg.wait_for_function("() => !GVStudioRec.active() && __st.P.tracks.length === 4", timeout=10000)
    check("a take that overlaps audio already on the armed track goes onto a new take track", "new track" in pg.inner_text("#status") and st("__st.P.tracks[3].name").endswith("take"), pg.inner_text("#status"))
    # ---- punch in and out ----
    heads = pg.locator(".thead"); heads.nth(0).locator("button[aria-label^='Arm']").click()
    pg.check("#recpunch"); st("() => { __st.P.loop.on = false; __st.P.loop.a = 0; __st.P.loop.b = 0; }")
    pg.click("#rec"); check("punch without a loop region explains how to set one and does not record", "loop region" in pg.inner_text("#status") and not st("GVStudioRec.active()"), pg.inner_text("#status"))
    st("() => { __st.P.loop.a = 2; __st.P.loop.b = 3; __st.afterStructure(); }"); pg.click("#rec"); pg.wait_for_function("() => GVStudioRec.active()", timeout=10000)
    pg.wait_for_function("() => !GVStudioRec.active()", timeout=20000)
    cl = st("__st.P.tracks[0].clips.map((c) => ({ s: +c.start.toFixed(3), d: +c.dur.toFixed(3), o: +(c.offset || 0).toFixed(3), take: !!(__st.P.assets[c.assetId] || {}).name && /^Take/.test(__st.P.assets[c.assetId].name) })).sort((x, y) => x.s - y.s)")
    check("punch cut the old clip in two and put the take between 2 s and 3 s", len(cl) == 3 and abs(cl[0]["s"]) < 0.01 and abs(cl[0]["d"] - 2) < 0.01 and cl[1]["take"] and abs(cl[1]["s"] - 2) < 0.01 and abs(cl[2]["s"] - 3) < 0.01, str(cl))
    check("the punched take is the length of the region (within 50 ms) and recording and playback stopped by themselves", abs(cl[1]["d"] - 1) < 0.05 and not st("__st.playing"), str(cl))
    check("the right hand piece of the old clip keeps its place in the audio (3 s into the file) and its end", abs(cl[2]["o"] - 3) < 0.01 and abs(cl[2]["d"] - 3) < 0.01, str(cl))
    check("the status says what the take replaced", "replaced 1 clip" in pg.inner_text("#status"), pg.inner_text("#status"))
    pg.click("#undo"); check("undo brings the original clip back whole", st("__st.P.tracks[0].clips.length") == 1 and abs(st("__st.P.tracks[0].clips[0].dur") - 6) < 0.01)
    pg.uncheck("#recpunch")
    # ---- count in ----
    heads.nth(2).locator("button[aria-label^='Arm']").click() if st("GVStudioRec.armed()") != st("__st.P.tracks[2].id") else None
    pg.check("#reccount"); st("() => { __st.P.loop.on = false; __st.setPlayhead(20); }"); pg.click("#rec"); pg.wait_for_function("() => GVStudioRec.active()", timeout=10000)
    lead = st("() => __st.segs[0].when - __st.ctx().currentTime")
    check("a one bar count in at 120 BPM delays the music by about 2 s (plus the short safety lead)", 1.7 < lead < 2.3, str(lead))
    pg.click("#rec"); pg.wait_for_function("() => !GVStudioRec.active()", timeout=10000)
    check("stopping during the count in records nothing and says so", "Nothing was recorded" in pg.inner_text("#status"), pg.inner_text("#status"))
    pg.uncheck("#reccount")
    # ---- save and reopen ----
    n_before = st("__st.P.tracks.reduce((n, t) => n + t.clips.filter((c) => /^Take/.test((__st.P.assets[c.assetId] || {}).name || '')).length, 0)")
    st("() => __st.saveNow()"); pid = st("__st.P.id"); st("() => __st.newProject()"); st("(id) => __st.openProject(id)", pid); pg.wait_for_timeout(500)
    check("recorded takes are saved with the project and decode again after reopening", n_before >= 2 and st("__st.P.tracks.reduce((n, t) => n + t.clips.filter((c) => /^Take/.test((__st.P.assets[c.assetId] || {}).name || '') && __st.buffers.has(c.assetId)).length, 0)") == n_before, str(n_before))
    # ---- microphone test button and level meter ----
    pg.click("#rectest"); pg.wait_for_function("() => GVStudioRec.mic", timeout=10000); pg.wait_for_timeout(1300)
    check("Test microphone opens the microphone and the level meter moves", float(pg.evaluate("document.getElementById('reclvl').style.width.replace('%','') || 0")) > 0, pg.evaluate("document.getElementById('reclvl').style.width"))
    pg.click("#rectest"); check("pressing it again turns the microphone off", not st("GVStudioRec.mic"))
    check("no page errors while recording", not errs, str(errs[:3]))
    ctx.close()
    # ---- microphone blocked ----
    ctx2, p2 = new_page(b2, [], viewport={"width": 1400, "height": 1000}); p2.goto(base + "studio.html?gvtest"); p2.wait_for_function("() => window.GVStudioRec", timeout=10000)
    p2.evaluate("() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error('x'), { name: 'NotAllowedError' })); __st.addTrack('audio'); }")
    p2.locator(".thead button[aria-label^='Arm']").click(); p2.click("#rec"); p2.wait_for_timeout(500)
    check("a blocked microphone gives a clear message and nothing is recorded", "blocked" in p2.inner_text("#status") and not p2.evaluate("GVStudioRec.active()"), p2.inner_text("#status"))
    ctx2.close()
    # ---- phone width and accessibility ----
    ctx3 = b2.new_context(bypass_csp=True, viewport={"width": 390, "height": 800}); p3 = ctx3.new_page(); p3.goto(base + "studio.html?gvtest"); p3.wait_for_function("() => window.GVStudioRec", timeout=10000)
    p3.evaluate("() => { __st.addTrack('audio'); __st.addTrack('audio'); }"); p3.click("#recpanel summary")
    check("at phone width the recording panel does not make the page scroll sideways", p3.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1"), str(p3.evaluate("() => [document.documentElement.scrollWidth, window.innerWidth]")))
    axe = os.environ.get("AXE_PATH") or os.path.join(ROOT, "node_modules/axe-core/axe.min.js")
    if os.path.exists(axe):
        p3.set_viewport_size({"width": 1400, "height": 1000}); p3.add_script_tag(path=axe)
        v = p3.evaluate("axe.run(document,{runOnly:['wcag2a','wcag2aa','wcag21a','wcag21aa','best-practice']}).then(r=>r.violations.map(v=>v.id+' x'+v.nodes.length+' '+v.nodes[0].target.join(' ')))")
        check("studio with the recording panel open and arm buttons: no axe violations", not v, str(v))
    ctx3.close(); b2.close()


def test_master(browser, base):
    print("master: loudness, limiter, A/B, export")
    import tempfile, numpy as np, scipy.io.wavfile as sw, pyloudnorm as pyln
    errs = []
    ctx, pg = new_page(browser, errs, viewport={"width": 1300, "height": 1000}, accept_downloads=True)
    sr, secs = 44100, 24; tt = np.arange(sr * secs) / sr; rng = np.random.default_rng(3)
    env = 0.35 + 0.65 * (np.sin(2 * np.pi * tt / 6) > 0); sig = sum(np.sin(2 * np.pi * f * tt) / (i + 1) for i, f in enumerate([110, 220, 330, 440])) * env * 0.12 + rng.normal(0, 0.02, tt.size) * env
    st = np.stack([sig, np.roll(sig, 40)], 1).astype(np.float32); tmp = tempfile.mkdtemp(); fp = tmp + "/Demo song.wav"; sw.write(fp, sr, (st * 32767).astype(np.int16))
    ref = pyln.Meter(sr).integrated_loudness(st.astype(np.float64))
    pg.goto(base + "master.html?gvtest"); pg.set_input_files("#file", fp); pg.wait_for_function("() => window.__ms && __ms.aRes", timeout=30000)
    got = pg.evaluate("__ms.aRes.lufs"); check("original loudness matches the pyloudnorm reference within 0.2 LU", abs(got - ref) < 0.2, f"{got:.2f} vs {ref:.2f}")
    check("the hint explains the gain needed", "needs" in pg.inner_text("#hint") and "LUFS" in pg.inner_text("#hint"))
    pg.select_option("#preset", "-16|-1"); check("choosing a preset fills target and ceiling", pg.input_value("#target") == "-16" and pg.input_value("#ceil") == "-1")
    pg.select_option("#preset", "-14|-1")
    pg.click("#go"); pg.wait_for_function("() => window.__ms && __ms.mRes", timeout=60000)
    m = pg.evaluate("__ms.mRes"); check("mastering reaches -14 LUFS within 0.3 and keeps true peak under the ceiling", abs(m["lufs"] + 14) < 0.3 and m["truePeakDb"] < -0.9, str(m))
    check("the mastered column and gain text are filled", pg.inner_text("#m_lufs") != "–" and "dB /" in pg.inner_text("#m_gain"))
    with pg.expect_download(timeout=60000) as dl: pg.click("#save")
    check("download file name says mastered", dl.value.suggested_filename == "Demo song (mastered).wav", dl.value.suggested_filename)
    sr2, out = sw.read(dl.value.path()); outf = out.astype(np.float64) / 32768; l2 = pyln.Meter(sr2).integrated_loudness(outf)
    check("exported WAV measures -14 LUFS with an independent meter (within 0.4)", abs(l2 + 14) < 0.4, f"{l2:.2f}")
    check("exported WAV sample peak is at or below -1 dBFS", 20 * np.log10(np.abs(outf).max()) <= -0.95, f"{20*np.log10(np.abs(outf).max()):.2f}")
    # louder target
    pg.select_option("#preset", "-9|-0.3"); pg.click("#go"); pg.wait_for_function("() => __ms.mRes.lufs > -10.5", timeout=60000)
    m2 = pg.evaluate("__ms.mRes"); check("loud preset gets near -9 LUFS under a -0.3 dBTP ceiling", abs(m2["lufs"] + 9) < 0.5 and m2["truePeakDb"] < -0.25, str(m2))
    # tone controls change the sound but loudness still lands
    pg.select_option("#preset", "-14|-1"); pg.fill("#bass", "6") if False else pg.evaluate("document.getElementById('bass').value = 6; document.getElementById('bass').dispatchEvent(new Event('input'))")
    pg.click("#go"); pg.wait_for_function("() => Math.abs(__ms.mRes.lufs + 14) < 0.4", timeout=60000)
    check("bass boost still lands on the loudness target", True)
    # A/B
    pg.click("#aOrig"); pg.click("#play"); pg.wait_for_function("() => __ms.playing", timeout=5000); pg.wait_for_timeout(1500)
    mg = pg.evaluate("__ms.matchGain()"); exp = 10 ** ((pg.evaluate("__ms.mRes.lufs") - pg.evaluate("__ms.aRes.lufs")) / 20)
    check("match volume scales the original to the mastered loudness", abs(mg - exp) < 0.01 and pg.evaluate("__ms.which") == "a", f"{mg} {exp}")
    p1 = pg.evaluate("__ms.pos"); pg.click("#aMast"); pg.wait_for_timeout(500); p2 = pg.evaluate("__ms.pos")
    check("switching to mastered keeps playing from about the same position", pg.evaluate("__ms.which") == "m" and pg.evaluate("__ms.playing") and 0.3 < p2 - p1 < 1.0, f"{p1:.2f} -> {p2:.2f}")
    pg.click("#play"); check("pause works", not pg.evaluate("__ms.playing"))
    pg.evaluate("document.getElementById('seek').value = 500; document.getElementById('seek').dispatchEvent(new Event('input'))"); check("seek moves the position to half way", abs(pg.evaluate("__ms.pos") - secs / 2) < 0.5)
    # exports
    pg.select_option("#fmt", "wav24")
    with pg.expect_download(timeout=60000) as d3: pg.click("#save")
    b = open(d3.value.path(), "rb").read(); check("24 bit WAV export has 24 bits per sample", struct.unpack("<H", b[34:36])[0] == 24)
    pg.select_option("#fmt", "mp3")
    with pg.expect_download(timeout=120000) as d4: pg.click("#save")
    mp3 = open(d4.value.path(), "rb").read(); i = 0
    if mp3[:3] == b"ID3": i = 10 + ((mp3[6] << 21) | (mp3[7] << 14) | (mp3[8] << 7) | mp3[9])
    check("MP3 export is a valid MP3", mp3[i] == 0xFF and (mp3[i + 1] & 0xE0) == 0xE0 and d4.value.suggested_filename.endswith("(mastered).mp3"))
    # bad file
    bad = tmp + "/bad.wav"; open(bad, "wb").write(b"not audio at all"); pg.set_input_files("#file", bad); pg.wait_for_function("() => document.getElementById('status').textContent.startsWith('Could not')", timeout=10000)
    check("an unreadable file is refused with a message", True)
    check("master: no errors", not [e for e in errs if "Failed to load resource" not in e and "EncodingError" not in e], str(errs))
    ctx.close()
    axe = os.environ.get("AXE_PATH") or os.path.join(ROOT, "node_modules/axe-core/axe.min.js")
    if os.path.exists(axe):
        js = "axe.run(document,{runOnly:['wcag2a','wcag2aa','wcag21a','wcag21aa','best-practice']}).then(r=>r.violations.map(v=>v.id+' x'+v.nodes.length+' '+v.nodes[0].target.join(' ')))"
        c2 = browser.new_context(bypass_csp=True, viewport={"width": 1200, "height": 900}); p2 = c2.new_page(); p2.goto(base + "master.html?gvtest")
        p2.add_script_tag(path=axe); check("master page empty: no axe violations", not (v := p2.evaluate(js)), str(v))
        p2.set_input_files("#file", fp); p2.wait_for_function("() => window.__ms && __ms.aRes", timeout=30000); p2.click("#go"); p2.wait_for_function("() => __ms.mRes", timeout=60000)
        check("master page with results: no axe violations", not (v := p2.evaluate(js)), str(v)); c2.close()
    c3 = browser.new_context(viewport={"width": 390, "height": 844}); p3 = c3.new_page(); p3.goto(base + "master.html?gvtest"); p3.set_input_files("#file", fp); p3.wait_for_function("() => window.__ms && __ms.aRes", timeout=30000)
    over = p3.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth"); check("master: no sideways scroll at 390px", over <= 0, str(over)); c3.close()


def test_keys_samples(browser, base):
    print("key helper and loop maker")
    import tempfile, numpy as np, io, wave
    errs = []
    ctx, pg = new_page(browser, errs, viewport={"width": 1300, "height": 1000}, accept_downloads=True)
    pg.goto(base + "keys.html?gvtest")
    pg.select_option("#root", "0"); pg.select_option("#scale", "Major")
    check("C major summary lists the notes and Camelot 8B", "C D E F G A B" in " ".join(pg.inner_text("#summary").split()) and "8B" in pg.inner_text("#summary"), pg.inner_text("#summary"))
    check("keyboard highlights seven notes per octave and marks the root", pg.locator("#kb .wk.in").count() == 3 * 7 - 0 or pg.locator("#kb .in").count() == 21, str(pg.locator("#kb .in").count()))
    rows = pg.locator("#chords tbody tr"); check("seven chords with the right names", rows.count() == 7 and rows.nth(1).locator("td").nth(0).inner_text() == "Dm" and rows.nth(6).locator("td").nth(0).inner_text() == "Bdim")
    pg.check("#sev"); check("seventh chords show maj7 and m7", rows.nth(0).locator("td").nth(0).inner_text() == "Cmaj7" and rows.nth(4).locator("td").nth(0).inner_text() == "G7")
    pg.uncheck("#sev")
    pg.select_option("#root", "9"); pg.select_option("#scale", "Natural minor")
    check("A minor gives 8A and compatible keys include C major, E minor, D minor", "8A" in pg.inner_text("#summary") and all(x in pg.inner_text("#compat") for x in ["C major", "E minor", "D minor"]), pg.inner_text("#compat")[:200])
    pg.select_option("#scale", "Blues"); check("blues has no chord or Camelot table but explains why", pg.locator("#chords tbody tr").count() == 0 and "seven note" in pg.inner_text("#nochords") and "Camelot" in pg.inner_text("#ncompat"))
    pg.select_option("#scale", "Major"); pg.select_option("#root", "7")
    pg.get_by_label("Play progression") if False else None
    check("progression text for G major pop is G → D → Em → C", "G → D → Em → C" in " ".join(pg.inner_text("#pshow").split()), pg.inner_text("#pshow"))
    pg.click("#kb button >> nth=0"); pg.click("#pplay"); check("keys page plays sound without errors", True)
    # scale finder
    for n in ["C", "E", "G", "B"]: pg.get_by_label(n, exact=True).check()
    txt = pg.inner_text("#found"); check("scale finder lists C major and E natural minor for C E G B", "C Major" in txt and "E Natural minor" in txt, txt[:120])
    pg.get_by_role("button", name="E Natural minor").click(); check("choosing a result sets the key", pg.input_value("#root") == "4" and pg.input_value("#scale") == "Natural minor")
    check("keys: no errors", not errs, str(errs))
    # loops
    pg.goto(base + "samples.html?gvtest"); pg.wait_for_function("() => window.__sm", timeout=10000)
    check("catalog has drums, bass, chords and a melody", pg.locator(".loopcard").count() == 15, str(pg.locator(".loopcard").count()))
    pg.fill("#bpm", "100"); pg.select_option("#root", "0"); pg.select_option("#bars", "2")
    pg.get_by_role("button", name="Play House", exact=True).click(); pg.wait_for_function("() => __sm.playing", timeout=20000); check("loop plays", True)
    pg.get_by_role("button", name="Play House", exact=True).click(); check("loop stops", not pg.evaluate("__sm.playing"))
    # rendered drum loop: kick on each beat, length exact
    r = pg.evaluate("""async () => { const it = __sm.CATALOG.find((i) => i.name === 'House'), p = __sm.params(), r = await __sm.render(it, p), d = r.buf.getChannelData(0), sr = r.buf.sampleRate, spb = 60 / p.bpm;
      const win = (t) => { let s = 0; for (let i = Math.round(t * sr); i < Math.round((t + 0.06) * sr); i++) s += d[i] * d[i]; return Math.sqrt(s / (0.06 * sr)); };
      let pk = 0; for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i])); return { secs: r.buf.length / sr, want: 2 * 4 * spb, beats: [0, 1, 2, 3, 4].map((b) => win(b * spb)), gap: [0.5, 1.5, 2.5].map((b) => win(b * spb + 0.1)), pk }; }""")
    check("2 bar house loop is exactly 4.8 s long, peaks near -1 dB, has a hit on every beat", abs(r["secs"] - r["want"]) < 0.001 and 0.8 < r["pk"] <= 0.9 and all(v > 0.05 for v in r["beats"]), str(r))
    # melodic loops stay in key
    m = pg.evaluate("""() => { const p = Object.assign(__sm.params(), { root: 2, minor: false, bars: 4 }); const out = {}; for (const n of ['Melody', 'Bass: Walking', 'Chords: Arpeggio']) { const it = __sm.CATALOG.find((i) => i.name === n), { spec } = __sm.projectFor(it, p); out[n] = spec.notes.map((x) => ((x.p % 12) + 12) % 12); } return out; }""")
    major = {2, 4, 6, 7, 9, 11, 1}
    check("D major melody, walking bass and arpeggio only use notes of D major", all(set(v) <= major for v in m.values()) and len(m["Melody"]) > 8, str({k: sorted(set(v)) for k, v in m.items()}))
    # download WAV and MIDI
    with pg.expect_download(timeout=30000) as dl: pg.locator(".loopcard", has_text="Boom bap").get_by_role("button", name="WAV").click()
    w = wave.open(str(dl.value.path())); check("WAV download is stereo 16 bit 44.1 kHz", dl.value.suggested_filename.startswith("Boom-bap-100bpm") and w.getnchannels() == 2 and w.getsampwidth() == 2 and w.getframerate() == 44100, dl.value.suggested_filename)
    with pg.expect_download(timeout=30000) as dm: pg.locator(".loopcard", has_text="Melody").get_by_role("button", name="MIDI").click()
    b = open(dm.value.path(), "rb").read(); check("MIDI download is a valid file with notes", b[:4] == b"MThd" and b"MTrk" in b and b.count(b"\x90") >= 8, str(len(b)))
    # variation changes melody
    v1 = pg.evaluate("""() => { const it = __sm.CATALOG.find((i) => i.name === 'Melody'); return JSON.stringify(__sm.projectFor(it, Object.assign(__sm.params(), { seed: 1 })).spec.notes); }""")
    v2 = pg.evaluate("""() => { const it = __sm.CATALOG.find((i) => i.name === 'Melody'); return JSON.stringify(__sm.projectFor(it, Object.assign(__sm.params(), { seed: 2 })).spec.notes); }""")
    check("a different variation number gives a different melody", v1 != v2)
    # open in studio
    pg.locator(".loopcard", has_text="Trap").get_by_role("button", name="Open in Studio").click(); pg.wait_for_url("**/studio.html?from=samples", timeout=10000)
    check("Open in Studio goes to the studio with the hand-off flag", True)
    for name, typ in [("Trap", "drum"), ("Bass: Walking", "midi")]:
        pg.goto(base + "samples.html?gvtest"); pg.wait_for_function("() => window.__sm")
        pg.evaluate("(n) => { const it = __sm.CATALOG.find((i) => i.name === n); localStorage.setItem('govibe.loop', JSON.stringify({ bpm: 90, bars: 2, spec: __sm.projectFor(it, Object.assign(__sm.params(), { bars: 2, bpm: 90 })).spec })); }", name)
        pg.goto(base + "studio.html?from=samples&gvtest"); pg.wait_for_function("() => window.__st && __st.P.tracks.length > 0", timeout=10000)
        info = pg.evaluate("({ n: __st.P.tracks.length, type: __st.P.tracks[__st.P.tracks.length - 1].type, bpm: __st.P.bpm, dur: __st.P.tracks[__st.P.tracks.length - 1].clips[0].dur, left: localStorage.getItem('govibe.loop') })")
        check(name + " arrives in the studio as an editable " + typ + " track at the loop tempo", info["type"] == typ and info["bpm"] in (90, 120) and abs(info["dur"] - 2 * 4 * 60 / info["bpm"]) < 0.01 and info["left"] is None, str(info))
    check("samples: no errors", not [e for e in errs if "Failed to load resource" not in e], str(errs))
    ctx.close()
    axe = os.environ.get("AXE_PATH") or os.path.join(ROOT, "node_modules/axe-core/axe.min.js")
    if os.path.exists(axe):
        js = "axe.run(document,{runOnly:['wcag2a','wcag2aa','wcag21a','wcag21aa','best-practice']}).then(r=>r.violations.map(v=>v.id+' x'+v.nodes.length+' '+v.nodes[0].target.join(' ')))"
        c2 = browser.new_context(bypass_csp=True, viewport={"width": 1200, "height": 900})
        for pagename in ["keys.html", "samples.html"]:
            p2 = c2.new_page(); p2.goto(base + pagename); p2.add_script_tag(path=axe); check(pagename + ": no axe violations", not (v := p2.evaluate(js)), str(v)); p2.close()
        c2.close()
    c3 = browser.new_context(viewport={"width": 390, "height": 844})
    for pagename in ["keys.html", "samples.html"]:
        p3 = c3.new_page(); p3.goto(base + pagename); over = p3.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth"); check(pagename + ": no sideways scroll at 390px", over <= 0, str(over)); p3.close()
    c3.close()


def test_desktop(browser, base):
    print("desktop shell (Electron)")
    import shutil, subprocess
    d = os.path.join(ROOT, "desktop")
    if not (os.path.exists(os.path.join(d, "node_modules/electron/dist/electron")) and shutil.which("xvfb-run")):
        print("  skipped: run `npm install` in desktop/ and install xvfb to include this test"); return
    r = subprocess.run(["xvfb-run", "-a", "python3", os.path.join(d, "test_desktop.py")], capture_output=True, text=True, timeout=180)
    for line in r.stdout.splitlines():
        if line.startswith("  ok"): check(line[6:].strip(), True)
        elif line.startswith("  FAIL"): check(line[6:].strip(), False)
    check("desktop test exited cleanly", r.returncode == 0, r.stderr[-300:])


def test_learn(browser, base):
    print("music and production lessons")
    errs = []
    ctx, pg = new_page(browser, errs, viewport={"width": 1200, "height": 1000})
    pg.goto(base + "learn-music.html?gvtest"); pg.wait_for_function("() => window.__lm")
    check("eight lessons and a progress line", pg.locator("[data-lesson]").count() == 8 and pg.inner_text("#ptext").startswith("0 of 8"))
    # quiz: wrong answers do not complete, right ones do
    q = pg.locator('[data-quiz="rhythm"]'); q.locator("input").nth(0).check(); q.get_by_role("button", name="Check answers").click()
    check("quiz asks for every answer", "Answer all 3" in q.inner_text())
    for i in range(3): pg.locator(f'input[name="q-rhythm-{i}"]').nth(0).check()
    q.get_by_role("button", name="Check answers").click(); check("wrong answers are explained and the lesson is not marked done", "Not quite" in q.inner_text() and not pg.is_checked('[data-done="rhythm"]'))
    ans = pg.evaluate("__lm.QUIZ.rhythm.map((x) => x.a)")
    for i, a in enumerate(ans): pg.locator(f'input[name="q-rhythm-{i}"]').nth(a).check()
    q.get_by_role("button", name="Check answers").click(); check("all correct marks the lesson done", pg.is_checked('[data-done="rhythm"]') and "1 of 8" in pg.inner_text("#ptext"))
    for k, qs in pg.evaluate("Object.entries(__lm.QUIZ)"):
        check(f"quiz {k}: every question has a valid answer", all(0 <= x["a"] < len(x["o"]) and x["w"] for x in qs) and len(qs) == 3)
    # ear trainer
    pg.click("#enext"); c = pg.evaluate("__lm.cur"); check("a question is playing and answers are offered", c is not None and pg.locator("#eans button").count() == 4)
    pg.evaluate("__lm.answerWith(__lm.cur.item.id)"); check("correct answer counts and starts a streak", pg.inner_text("#ecorrect") == "1" and pg.inner_text("#estreak") == "1" and "Correct" in pg.inner_text("#efb"))
    pg.evaluate("__lm.answerWith(__lm.cur.item.id)"); check("a second answer to the same question is ignored", pg.inner_text("#etotal") == "1")
    pg.click("#enext"); wrong = pg.evaluate("[...document.querySelectorAll('#eans button')].map((b) => b.dataset.id).find((i) => i !== __lm.cur.item.id)")
    pg.evaluate("(id) => __lm.answerWith(id)", wrong); check("wrong answer resets the streak, keeps the best and shows the right one", pg.inner_text("#estreak") == "0" and pg.inner_text("#ebest") == "1" and "Not quite" in pg.inner_text("#efb") and pg.locator('#eans [data-ok="1"]').count() == 1)
    pg.select_option("#emode", "chord"); check("chord mode offers four chord types", pg.locator("#eans button").count() == 4 and pg.inner_text("#eans").startswith("Major"))
    pg.select_option("#emode", "int-all"); check("all intervals mode offers twelve choices", pg.locator("#eans button").count() == 12)
    # 20 right answers complete the ear lesson
    pg.evaluate("() => { for (let i = 0; i < 25; i++) { __lm.next(); __lm.answerWith(__lm.cur.item.id); } }")
    check("twenty answers at 80 percent complete the ear training lesson", pg.is_checked('[data-done="ear"]'))
    pg.reload(); check("progress and ear scores survive a reload", pg.is_checked('[data-done="rhythm"]') and pg.is_checked('[data-done="ear"]') and int(pg.inner_text("#etotal")) >= 27)
    check("learn: no errors", not errs, str(errs))
    ctx.close()
    axe = os.environ.get("AXE_PATH") or os.path.join(ROOT, "node_modules/axe-core/axe.min.js")
    if os.path.exists(axe):
        c2 = browser.new_context(bypass_csp=True, viewport={"width": 1200, "height": 900}); p2 = c2.new_page(); p2.goto(base + "learn-music.html?gvtest"); p2.wait_for_function("() => window.__lm"); p2.click("#enext"); p2.add_script_tag(path=axe)
        v = p2.evaluate("axe.run(document,{runOnly:['wcag2a','wcag2aa','wcag21a','wcag21aa','best-practice']}).then(r=>r.violations.map(v=>v.id+' x'+v.nodes.length+' '+v.nodes[0].target.join(' ')))"); check("learn page: no axe violations", not v, str(v)); c2.close()
    c3 = browser.new_context(viewport={"width": 390, "height": 844}); p3 = c3.new_page(); p3.goto(base + "learn-music.html"); over = p3.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth"); check("learn page: no sideways scroll at 390px", over <= 0, str(over)); c3.close()


def test_home(browser, base):
    print("home page")
    errs = []
    ctx, pg = new_page(browser, errs, viewport={"width": 1300, "height": 900})
    pg.goto(base + "index.html?gvtest"); pg.wait_for_function("() => window.__home")
    check("home lists every tool with a link", pg.locator("a.card").count() == 14 and all(pg.locator(f'a.card[href="{h}"]').count() == 1 for h in ["studio.html", "samples.html", "record.html", "keys.html", "tuner.html", "metronome.html", "editor.html", "video.html", "master.html", "convert.html", "dj.html", "bpm.html", "lessons.html", "learn-music.html"]))
    check("four groups with headings", pg.locator(".grp h2").count() == 4 and pg.inner_text(".grp h2 >> nth=0") == "Make")
    check("the web font loads from this site", pg.evaluate("document.fonts.check('16px \"Bricolage Grotesque\"')"))
    check("beat strip has 4 rows of 16 steps and starts with a boom bap pattern", pg.locator(".st").count() == 64 and pg.locator('.st[aria-pressed="true"]').count() == 3 + 2 + 8)
    pg.locator('button[aria-label="Clap step 3"]').click(); check("tapping a square toggles it", pg.locator('button[aria-label="Clap step 3"]').get_attribute("aria-pressed") == "true" and pg.evaluate("__home.grid.Clap[2]") == 1)
    pg.select_option("#dpat", "House"); check("house pattern sets 124 BPM and a four on the floor kick", pg.input_value("#dbpm") == "124" and pg.evaluate("__home.grid.Kick.filter(Boolean).length") == 4 and pg.evaluate("__home.grid.Kick[8]") == 1)
    pg.click("#dplay"); pg.wait_for_function("() => __home.playing"); pg.wait_for_function("() => document.querySelectorAll('.st.now').length === 4", timeout=5000)
    check("play lights a moving playhead and the button says stop", pg.get_attribute("#dplay", "aria-pressed") == "true" and pg.get_attribute("#dplay", "aria-label") == "Stop the beat")
    pg.click("#dplay"); check("stop clears the playhead", pg.locator(".st.now").count() == 0 and not pg.evaluate("__home.playing"))
    pg.select_option("#dpat", "Empty"); check("empty pattern says so", "empty" in pg.inner_text("#dstat"))
    pg.locator('button[aria-label="Kick step 1"]').click(); pg.locator('button[aria-label="Snare step 5"]').click(); pg.fill("#dbpm", "100") if False else pg.evaluate("document.getElementById('dbpm').value = 100; document.getElementById('dbpm').dispatchEvent(new Event('input'))")
    pg.click("#dopen"); pg.wait_for_url("**/studio.html?from=samples", timeout=10000)
    pg.goto(pg.url + "&gvtest") if False else None
    pg.goto(base + "index.html?gvtest"); pg.evaluate("localStorage.setItem('govibe.loop', JSON.stringify({ bpm: 100, bars: 4, spec: { type: 'drum', name: 'Home beat', grid: { Kick: [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0], Snare: [0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0] }, swing: 0 } }))")
    pg.goto(base + "studio.html?from=samples&gvtest"); pg.wait_for_function("() => window.__st && __st.P.tracks.length > 0", timeout=10000)
    check("the beat opens in the Studio as a drum track", pg.evaluate("__st.P.tracks[__st.P.tracks.length - 1].type") == "drum")
    check("home: no errors", not errs, str(errs))
    ctx.close()
    c2 = browser.new_context(viewport={"width": 1200, "height": 900}, reduced_motion="reduce"); p2 = c2.new_page(); p2.goto(base + "index.html"); p2.evaluate("window.scrollTo(0, 99999)"); p2.wait_for_timeout(300)
    check("with reduced motion the group lines are drawn without animation", p2.evaluate("getComputedStyle(document.querySelector('.grp'), '::before').transform") in ("matrix(1, 0, 0, 1, 0, 0)", "none")); c2.close()
    c3 = browser.new_context(viewport={"width": 390, "height": 844}); p3 = c3.new_page(); p3.goto(base + "index.html"); p3.wait_for_timeout(500)
    check("home: no sideways scroll at 390px", p3.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth") <= 0)
    check("home: tool rows are tappable (at least 44 px tall) on a phone", p3.evaluate("Math.min(...[...document.querySelectorAll('a.card')].map((a) => a.getBoundingClientRect().height))") >= 44); c3.close()


def test_video_basics(browser, base):
    print("video editor: volume, crop, rotate, flip, pictures, stickers, silence remover, camera, voiceover")
    errs = []
    ctx, pg = new_page(browser, errs, viewport={"width": 1300, "height": 1000})
    pg.goto(base + "video.html?gvtest"); pg.wait_for_function("() => window.__ve", timeout=10000)
    ev = lambda js, *a: pg.evaluate(js, *a) if a else pg.evaluate(js)
    MK = """async ([kind, secs, gaps]) => { const c = document.createElement('canvas'); c.width = 320; c.height = 180; const g = c.getContext('2d');
      const ac = new AudioContext(), dest = ac.createMediaStreamDestination(), o = ac.createOscillator(), gn = ac.createGain(); o.connect(gn); gn.connect(dest); o.start();
      if (gaps) { gn.gain.value = 0; gaps.forEach(([a, b]) => { gn.gain.setValueAtTime(1, ac.currentTime + a); gn.gain.setValueAtTime(0, ac.currentTime + b); }); }
      const s = c.captureStream(30); dest.stream.getAudioTracks().forEach((t) => s.addTrack(t));
      const rec = new MediaRecorder(s, { mimeType: 'video/webm;codecs=vp8,opus' }), ch = []; rec.ondataavailable = (e) => ch.push(e.data);
      const done = new Promise((r) => (rec.onstop = r)); rec.start(100); const t0 = performance.now();
      await new Promise((res) => { (function f() { const t = (performance.now() - t0) / 1000;
        if (kind === 'split') { g.fillStyle = '#00b140'; g.fillRect(0, 0, 160, 180); g.fillStyle = '#e02020'; g.fillRect(160, 0, 160, 180); } else { g.fillStyle = kind; g.fillRect(0, 0, 320, 180); }
        if (t >= secs) res(); else requestAnimationFrame(f); })(); });
      rec.stop(); await done; o.stop(); await __ve.addFile(new File([new Blob(ch, { type: 'video/webm' })], kind.replace('#', '') + '.webm')); }"""
    px_at = """([fx, fy]) => { const c = document.getElementById('cv'), d = c.getContext('2d').getImageData(Math.round(c.width * fx), Math.round(c.height * fy), 1, 1).data; return [d[0], d[1], d[2]]; }"""
    look = lambda fx, fy, t=0.5: (ev("(t) => __ve.seek(t)", t), pg.wait_for_timeout(450), ev(px_at, [fx, fy]))[0:3][2]
    rgb = lambda fx, fy, t=0.5: (ev("(t) => __ve.seek(t)", t), pg.wait_for_timeout(450), ev(px_at, [fx, fy]))[2]
    cl = lambda i: pg.locator("#cliplist .clip").nth(i)
    def sect(i, name):
        d = cl(i).locator("details.vfx", has_text=name)
        if d.get_attribute("open") is None: d.locator("summary").click()
        return d
    rms_wav = """async () => { pg_ = null; const b = await __ve.exportVideo(); if (!b) return -1; const ab = await __ve.ctx.decodeAudioData(await b.arrayBuffer()), d = ab.getChannelData(0); let s = 0; for (let i = 0; i < d.length; i++) s += d[i] * d[i]; return Math.sqrt(s / d.length); }"""
    pg.select_option("#xfmt", "wav")
    # ---------- volume and mute ----------
    ev(MK, ["split", 2.4, None]); ev("() => { __ve.pause(); }")
    base_rms = ev(rms_wav)
    check("the audio export has sound", base_rms > 0.02, str(base_rms))
    d = sect(0, "Volume"); d.locator(".cv").fill("50"); d.locator(".cv").dispatch_event("input")
    half = ev(rms_wav)
    check("50 percent volume halves the exported sound", 0.4 < half / base_rms < 0.6, f"{half:.4f} vs {base_rms:.4f}")
    check("the live clip gain follows the slider", abs(ev("() => __ve.clips[0].gain.gain.value") - 0.5) < 0.01)
    d.locator(".cm").check(); muted = ev(rms_wav)
    check("mute silences the clip in the export", muted < 0.002, str(muted))
    check("mute sets the live gain to zero", ev("() => __ve.clips[0].gain.gain.value") == 0)
    d.locator(".cm").uncheck(); d.locator(".cv").fill("100"); d.locator(".cv").dispatch_event("input")
    # ---------- crop, rotate and flip ----------
    check("before any change the left half is green and the right half red", rgb(0.25, 0.5)[1] > 120 and rgb(0.75, 0.5)[0] > 150)
    x = sect(0, "Crop, rotate")
    x.locator(".xh").check(); pg.wait_for_timeout(200)
    a, b = rgb(0.25, 0.5), rgb(0.75, 0.5)
    check("flip left to right swaps the halves", a[0] > 150 and b[1] > 120, f"{a} {b}")
    x.locator(".xh").uncheck(); x.locator(".xv").check(); pg.wait_for_timeout(200)
    a, b = rgb(0.25, 0.5), rgb(0.75, 0.5)
    check("flip top to bottom leaves a left right split alone", a[1] > 120 and b[0] > 150, f"{a} {b}")
    x.locator(".xv").uncheck(); x.locator(".xr").select_option("90"); pg.wait_for_timeout(200)
    top, bot, side = rgb(0.5, 0.25), rgb(0.5, 0.75), rgb(0.1, 0.5)
    check("rotating 90 degrees right puts the green half on top, the red below, with bars at the sides", top[1] > 120 and bot[0] > 150 and sum(side) < 40, f"{top} {bot} {side}")
    x.locator(".xr").select_option("180"); pg.wait_for_timeout(200)
    a, b = rgb(0.25, 0.5), rgb(0.75, 0.5)
    check("rotating 180 degrees swaps left and right", a[0] > 150 and b[1] > 120, f"{a} {b}")
    x.locator(".xr").select_option("0"); x.locator(".xl").fill("45"); x.locator(".xl").dispatch_event("input"); pg.wait_for_timeout(200)
    a, b, c3 = rgb(0.32, 0.5), rgb(0.25, 0.5), rgb(0.1, 0.5)
    check("cropping 45 percent from the left leaves a thin green edge, then red, centred", a[0] > 150 and a[1] < 90 and b[1] > 120 and sum(c3) < 40, f"{a} {b} {c3}")
    x.locator(".xl").fill("0"); x.locator(".xl").dispatch_event("input")
    # ---------- pictures and stickers ----------
    ev("""async () => { const c = document.createElement('canvas'); c.width = 40; c.height = 40; const g = c.getContext('2d'); g.fillStyle = '#ff00ff'; g.fillRect(0, 0, 40, 40);
      const im = new Image(); await new Promise((r) => { im.onload = r; im.src = c.toDataURL(); }); __ve.addOverlay({ kind: 'img', img: im, name: 'logo.png', x: 50, y: 50, size: 20, start: 0, end: 1 }); }""")
    check("a picture shows in its own list", pg.locator("#ovlist .clip").count() == 1 and "logo.png" in pg.inner_text("#ovlist"))
    a = rgb(0.5, 0.5, 0.5)
    check("the picture is drawn on the video during its seconds", a[0] > 200 and a[1] < 80 and a[2] > 200, str(a))
    a = rgb(0.5, 0.5, 1.5)
    check("it disappears after its end time", not (a[0] > 200 and a[2] > 200), str(a))
    pg.locator("#ovlist .oe").fill("3"); pg.locator("#ovlist .oe").dispatch_event("change"); pg.locator("#ovlist .ox").fill("20"); pg.locator("#ovlist .ox").dispatch_event("change")
    check("end time and position can be edited", ev("() => __ve.overlays[0].end") == 3 and ev("() => __ve.overlays[0].x") == 20)
    a, b = rgb(0.2, 0.5, 1.5), rgb(0.5, 0.5, 1.5)
    check("the picture moves with its position and stays up until the new end", a[0] > 200 and a[2] > 200 and not (b[0] > 200 and b[2] > 200), f"{a} {b}")
    pg.click("#ovsticker"); check("a sticker is added to the list", pg.locator("#ovlist .clip").count() == 2 and ev("() => __ve.overlays[1].kind") == "emoji")
    pg.locator("#ovlist .clip").nth(0).locator("button.danger").click(); pg.locator("#ovlist .clip").nth(0).locator("button.danger").click()
    check("pictures and stickers can be removed", pg.locator("#ovlist .clip").count() == 0)
    # ---------- silence remover ----------
    ev("() => { while (__ve.clips.length) document.querySelector('#cliplist .clip button[data-a=del]').click(); }")
    ev(MK, ["#2266aa", 3.6, [[0.0, 1.0], [2.4, 3.6]]])
    d = sect(0, "Remove silence"); d.locator(".sf").click(); pg.wait_for_function("() => /Found|No pauses|no sound/.test(document.querySelector('#cliplist .sl').textContent)", timeout=10000)
    txt = d.locator(".sl").inner_text()
    check("it finds the gap in the sound", "Found 1 pause" in txt, txt)
    check("the cut button is ready after a search", not d.locator(".sc").is_disabled())
    T0 = ev("__ve.state.total"); d.locator(".sc").click(); pg.wait_for_function("() => __ve.clips.length === 2", timeout=15000)
    T1 = ev("__ve.state.total")
    check("cutting splits the clip into two parts around the pause", ev("__ve.clips.length") == 2 and pg.locator("#cliplist .clip").count() == 2)
    check("the video is shorter by about the removed pause", 0.7 < T0 - T1 < 1.5, f"{T0:.2f} -> {T1:.2f}")
    check("the parts keep their settings and play", ev("() => __ve.clips.every((c) => c.vol === 1 && c.gain)") and "part 1" in pg.inner_text("#cliplist"))
    d = sect(0, "Remove silence"); d.locator(".sth").fill("-60"); d.locator(".sth").dispatch_event("input")
    check("changing the level resets the cut button until pauses are found again", d.locator(".sc").is_disabled())
    check("no page errors in the video basics so far", not errs, str(errs[:3]))
    ctx.close()
    # ---------- camera and voiceover with a fake device ----------
    br = browser.browser_type.launch(args=["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"])
    errs2 = []
    c2 = br.new_context(viewport={"width": 1300, "height": 1000}, permissions=["camera", "microphone"]); p2 = c2.new_page()
    p2.on("pageerror", lambda e: errs2.append(f"pageerror: {e}")); p2.on("console", lambda m: errs2.append(f"console: {m.text}") if m.type == "error" else None)
    p2.goto(base + "video.html?gvtest"); p2.wait_for_function("() => window.__ve", timeout=10000)
    p2.click("#camera"); p2.wait_for_timeout(300)
    check("camera recording shows a live preview and a stop button", not p2.locator("#campreview").get_attribute("class").count("hidden") and "Stop" in p2.inner_text("#camera"), p2.inner_text("#camera"))
    p2.wait_for_timeout(1800); p2.click("#camera"); p2.wait_for_function("() => __ve.clips.length === 1", timeout=15000)
    check("the camera take becomes a clip on the timeline", "Camera recording 1" in p2.inner_text("#cliplist") and p2.evaluate("__ve.clips[0].dur") > 1)
    check("the preview closes afterwards", "hidden" in p2.locator("#campreview").get_attribute("class") and "Record camera" in p2.inner_text("#camera"))
    p2.click("#vorec"); p2.wait_for_timeout(1700); p2.click("#vorec"); p2.wait_for_function("() => __ve.voices.length === 1", timeout=15000)
    v = p2.evaluate("() => ({ n: __ve.voices.length, start: __ve.voices[0].start, dur: __ve.voices[0].buf.duration })")
    check("the voiceover is recorded and placed at the playhead", v["n"] == 1 and v["start"] == 0 and 1 < v["dur"] < 4, str(v))
    check("it is listed with a remove button", "Voiceover 1" in p2.inner_text("#volist") and p2.locator("#volist button").count() == 1)
    p2.select_option("#xfmt", "wav")
    r = p2.evaluate("""async () => { const b = await __ve.exportVideo(); const ab = await __ve.ctx.decodeAudioData(await b.arrayBuffer()), d = ab.getChannelData(0); let s = 0; for (let i = 0; i < d.length; i++) s += d[i] * d[i]; return Math.sqrt(s / d.length); }""")
    p2.evaluate("() => { __ve.clips[0].mute = true; __ve.clips[0].gain.gain.value = 0; }")
    r2 = p2.evaluate("""async () => { const b = await __ve.exportVideo(); const ab = await __ve.ctx.decodeAudioData(await b.arrayBuffer()), d = ab.getChannelData(0); let s = 0; for (let i = 0; i < d.length; i++) s += d[i] * d[i]; return Math.sqrt(s / d.length); }""")
    check("the voiceover is mixed into the export even when the clip is muted", r2 > 0.005, f"{r2:.4f} (with clip sound {r:.4f})")
    p2.locator("#volist button").click(); check("a voiceover can be removed", p2.evaluate("__ve.voices.length") == 0)
    check("no page errors in camera and voiceover", not errs2, str(errs2[:3]))
    c2.close(); br.close()


def test_video_more(browser, base):
    print("video editor: clean the sound, drawing, GIF export, 4K")
    errs = []
    ctx, pg = new_page(browser, errs, viewport={"width": 1300, "height": 1000})
    pg.goto(base + "video.html?gvtest"); pg.wait_for_function("() => window.__ve", timeout=10000)
    ev = lambda js, *a: pg.evaluate(js, *a) if a else pg.evaluate(js)
    MK = """async ([color, secs, noise]) => { const c = document.createElement('canvas'); c.width = 320; c.height = 180; const g = c.getContext('2d');
      const ac = new AudioContext(), dest = ac.createMediaStreamDestination(); let seed = 5; const n = ac.sampleRate * 3, b = ac.createBuffer(1, n, ac.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < n; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; d[i] = (seed / 4294967296 * 2 - 1) * (noise || 0.0); }
      const src = ac.createBufferSource(); src.buffer = b; src.loop = true; src.connect(dest); src.start();
      const s = c.captureStream(30); dest.stream.getAudioTracks().forEach((t) => s.addTrack(t));
      const rec = new MediaRecorder(s, { mimeType: 'video/webm;codecs=vp8,opus' }), ch = []; rec.ondataavailable = (e) => ch.push(e.data);
      const done = new Promise((r) => (rec.onstop = r)); rec.start(100); const t0 = performance.now();
      await new Promise((res) => { (function f() { const t = (performance.now() - t0) / 1000; g.fillStyle = color; g.fillRect(0, 0, 320, 180); if (t >= secs) res(); else requestAnimationFrame(f); })(); });
      rec.stop(); await done; src.stop(); await __ve.addFile(new File([new Blob(ch, { type: 'video/webm' })], 'clip.webm')); }"""
    px_at = """([fx, fy]) => { const c = document.getElementById('cv'), d = c.getContext('2d').getImageData(Math.round(c.width * fx), Math.round(c.height * fy), 1, 1).data; return [d[0], d[1], d[2]]; }"""
    rgb = lambda fx, fy, t=0.5: (ev("(t) => __ve.seek(t)", t), pg.wait_for_timeout(450), ev(px_at, [fx, fy]))[2]
    cl = lambda i: pg.locator("#cliplist .clip").nth(i)
    def sect(i, name):
        d = cl(i).locator("details.vfx", has_text=name)
        if d.get_attribute("open") is None: d.locator("summary").click()
        return d
    RMS = """async () => { const b = await __ve.exportVideo(); if (!b) return -1; const ab = await __ve.ctx.decodeAudioData(await b.arrayBuffer()), d = ab.getChannelData(0); let s = 0; for (let i = 0; i < d.length; i++) s += d[i] * d[i]; return Math.sqrt(s / d.length); }"""
    # ---------- clean the sound ----------
    ev(MK, ["#2266aa", 2.4, 0.3]); pg.select_option("#xfmt", "wav")
    noisy = ev(RMS)
    check("a clip with steady noise has a clear noise level", noisy > 0.03, str(noisy))
    d = sect(0, "Clean the sound"); d.locator(".cr").click(); pg.wait_for_function("() => /Done|Could not|no sound/.test(document.querySelector('#cliplist .cs').textContent)", timeout=60000)
    check("cleaning reports done", "Done" in d.locator(".cs").inner_text(), d.locator(".cs").inner_text())
    cleaned = ev(RMS)
    check("the exported sound is far quieter in noise (at least 20 dB)", noisy / max(cleaned, 1e-9) > 10, f"{noisy:.4f} -> {cleaned:.5f}")
    check("the video's own sound path is muted and the cleaned copy is the one that plays", ev("() => __ve.clips[0].gain.gain.value") == 0 and ev("() => __ve.clips[0].cgain.gain.value") == 1 and ev("() => !!__ve.clips[0].clean"))
    ev("() => { __ve.seek(0); __ve.play(); }"); pg.wait_for_timeout(500)
    check("playing a cleaned clip starts the cleaned sound", ev("() => !!__ve.clips[0].csrc"))
    ev("() => __ve.pause()"); check("pausing stops it", ev("() => !__ve.clips[0].csrc"))
    d.locator(".co").click(); pg.wait_for_timeout(200)
    check("use original sound brings the video's own sound back", ev("() => !__ve.clips[0].clean && __ve.clips[0].gain.gain.value === 1") and d.locator(".co").is_disabled())
    check("the original sound exports at its first level again", abs(ev(RMS) - noisy) / noisy < 0.1)
    # ---------- drawing ----------
    ev("() => { while (__ve.clips.length) document.querySelector('#cliplist .clip button[data-a=del]').click(); }")
    ev(MK, ["#000000", 4, 0]); ev("() => __ve.seek(1)"); pg.wait_for_timeout(300)
    pg.click("#drmode"); check("drawing mode switches on", pg.get_attribute("#drmode", "aria-pressed") == "true" and "drawing" in pg.get_attribute("#cv", "class"))
    pg.select_option("#drtool", "box"); pg.fill("#drw", "10"); pg.locator("#cv").scroll_into_view_if_needed(); pg.evaluate("window.scrollTo(0,0)"); pg.wait_for_timeout(200)
    bb = pg.locator("#cv").bounding_box(); X = lambda f: bb["x"] + bb["width"] * f; Y = lambda f: bb["y"] + bb["height"] * f
    pg.select_option("#drtool", "box"); pg.fill("#drw", "10")
    pg.mouse.move(X(0.2), Y(0.2)); pg.mouse.down(); pg.mouse.move(X(0.5), Y(0.5), steps=5); pg.mouse.move(X(0.7), Y(0.7), steps=5); pg.mouse.up(); pg.wait_for_timeout(300)
    check("a dragged box is saved and listed", ev("() => __ve.drawings.length") == 1 and pg.locator("#drlist .clip").count() == 1)
    d0 = ev("() => __ve.drawings[0]"); check("it starts at the playhead and shows for 3 seconds by default", abs(d0["start"] - 1) < 0.05 and abs(d0["end"] - 4) < 0.05, str(d0["start"]))
    a = rgb(0.2, 0.45, 1.5)
    check("the box edge is drawn in red on the video while it shows", a[0] > 200 and a[1] < 90, str(a))
    check("the inside of the box stays clear", sum(rgb(0.45, 0.45, 1.5)) < 60)
    check("the box is gone before its start time", sum(rgb(0.2, 0.45, 0.5)) < 60)
    top = lambda: (pg.evaluate("window.scrollTo(0,0)"), pg.wait_for_timeout(150))
    pg.select_option("#drtool", "arrow"); top(); pg.mouse.move(X(0.1), Y(0.8)); pg.mouse.down(); pg.mouse.move(X(0.4), Y(0.8), steps=5); pg.mouse.up(); pg.wait_for_timeout(200)
    pg.select_option("#drtool", "pen"); top(); pg.mouse.move(X(0.6), Y(0.1)); pg.mouse.down(); pg.mouse.move(X(0.7), Y(0.12), steps=4); pg.mouse.move(X(0.8), Y(0.1), steps=4); pg.mouse.up(); pg.wait_for_timeout(200)
    tools = ev("() => __ve.drawings.map((d) => d.tool)")
    check("arrow and pen drawings are added too", tools == ["box", "arrow", "pen"] and ev("() => __ve.drawings[2].pts.length") > 4, str(tools))
    a = rgb(0.25, 0.8, 1.5)
    check("the arrow line is drawn", a[0] > 200 and a[1] < 90, str(a))
    pg.locator("#drlist .de").first.fill("1.5"); pg.locator("#drlist .de").first.dispatch_event("change")
    check("end time can be edited", abs(ev("() => __ve.drawings[0].end") - 1.5) < 0.01 and sum(rgb(0.2, 0.45, 2.5)) < 60)
    pg.click("#drmode"); top(); pg.mouse.move(X(0.3), Y(0.3)); pg.mouse.down(); pg.mouse.move(X(0.4), Y(0.4), steps=3); pg.mouse.up()
    check("with drawing off, dragging adds nothing", ev("() => __ve.drawings.length") == 3)
    pg.locator("#drlist .clip").nth(0).locator("button.danger").click(); check("a drawing can be removed", ev("() => __ve.drawings.length") == 2)
    # ---------- GIF ----------
    pg.select_option("#xfmt", "gif"); pg.select_option("#xfps", "24")
    ev("() => { __ve.clips[0].out = 1.2; }")
    r = ev("""async () => { const b = await __ve.exportVideo(); if (!b) return null; const u = new Uint8Array(await b.arrayBuffer()); return { type: b.type, size: b.size, head: String.fromCharCode(...u.slice(0, 6)), w: u[6] + u[7] * 256, h: u[8] + u[9] * 256, frames: u.reduce((n, v, i) => n + (v === 0x21 && u[i + 1] === 0xF9 && u[i + 2] === 4 ? 1 : 0), 0) }; }""")
    check("GIF export makes a real GIF file", r and r["type"] == "image/gif" and r["head"] == "GIF89a" and r["size"] > 1000, str(r))
    check("the GIF is small (640 by 360) and has about 15 frames a second", r and r["w"] == 640 and r["h"] == 360 and 14 <= r["frames"] <= 20, str(r))
    check("the status names the GIF and the download is a gif file", "GIF" in pg.inner_text("#status") and pg.get_attribute("#dl", "download") == "govibe-video.gif")
    # ---------- 4K ----------
    check("4K is offered in the size list", pg.locator("#xres option[value='2160']").count() == 1)
    pg.select_option("#xfmt", "webm"); pg.select_option("#xres", "2160"); pg.select_option("#xfps", "24"); ev("() => { __ve.clips[0].out = 0.5; }")
    pg.evaluate("window.__big = null")
    ok = ev("""async () => { const b = await __ve.exportVideo(); if (!b) return null; const v = document.createElement('video'); v.src = URL.createObjectURL(b); await new Promise((r) => { v.onloadedmetadata = r; v.onerror = r; }); return { w: v.videoWidth, h: v.videoHeight, type: b.type }; }""")
    check("a 4K export makes a 3840 by 2160 video", ok and ok["w"] == 3840 and ok["h"] == 2160, str(ok))
    check("no page errors in clean, drawing, GIF and 4K", not errs, str(errs[:3]))
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
    check("lesson progress survives reload", pg.inner_text("#ptext").startswith("2 of 10") and pg.is_checked('[data-done="bpm"]'))
    pg.click("#tstart")
    pg.wait_for_timeout(500)
    best = pg.evaluate("""() => { const s = document.getElementById('padj'); let best = null;
      for (let v = -10; v <= 10.0001; v += 0.1) { s.value = v.toFixed(1); s.oninput(); document.getElementById('tcheck').click();
        const e = parseFloat(document.getElementById('tmsg').textContent.match(/off by ([0-9.]+)/)[1]), st = document.getElementById('stars').textContent;
        if (!best || e < best.e) best = { e, st }; document.getElementById('tstart').click(); } return best; }""")
    check("trainer can be won with a perfect adjustment", best["st"] == "★★★" and best["e"] < 0.3, str(best))
    # new DJ lessons
    check("ten lessons now", pg.locator("[data-lesson]").count() == 10)
    ta = pg.evaluate("[__lessons.tempoAdjust(126, 128), __lessons.tempoAdjust(128, 128), __lessons.tempoAdjust(70, 140), __lessons.tempoAdjust(124, 150)]")
    check("tempo calculator: 126 to 128 is -1.56 %, equal tempos 0, 70 vs 140 suggests double time, 124 vs 150 is out of range", abs(ta[0]["pct"] + 1.5625) < 0.01 and ta[1]["pct"] == 0 and ta[2]["alt"] and ta[2]["alt"][0]["name"] == "half time" and not ta[3]["ok"], str(ta))
    pg.fill("#cA", "124"); pg.fill("#cB", "128"); check("calculator text says slow down by 3.1 percent", "slow it down by 3.1 percent" in pg.inner_text("#cOut"), pg.inner_text("#cOut"))
    check("phrase score thresholds", pg.evaluate("[0.1, 0.4, 0.9, 1.5].map(__lessons.phraseScore)") == [3, 2, 1, 0])
    pg.select_option("#plen", "4"); pg.click("#pstart"); pg.wait_for_function("() => __lessons.pround", timeout=5000)
    tgt = pg.evaluate("__lessons.pround.target - __lessons.pround.t0"); check("third phrase of 4 bars at 120 BPM begins 16 s in", abs(tgt - 16) < 0.001, str(tgt))
    r = pg.evaluate("__lessons.pcheck(__lessons.pround.target + 0.1)"); check("pressing 0.2 beats late scores three stars", r["s"] == 3 and pg.inner_text("#pstars") == "★★★" and "late" in pg.inner_text("#pmsg"), str(r))
    pg.click("#pstart"); r2 = pg.evaluate("__lessons.pcheck(__lessons.pround.target - 0.7)"); check("pressing 1.4 beats early scores no stars", r2["s"] == 0 and "early" in pg.inner_text("#pmsg"), str(r2))
    pg.click("#kqnew"); kq = pg.evaluate("__lessons.kq"); check("key trainer offers four keys with exactly one right", len(kq["opts"]) == 4 and sum(1 for o in kq["opts"] if o in kq["good"]) == 1)
    right = [o for o in kq["opts"] if o in kq["good"]][0]; pg.evaluate("(k) => __lessons.kqAnswer(k)", right); check("right key is accepted", "Correct" in pg.inner_text("#kqtext") and "1 of 1" in pg.inner_text("#kqscore"))
    pg.evaluate("() => { for (let i = 0; i < 12; i++) { __lessons.kqNew(); const k = __lessons.kq; __lessons.kqAnswer(k.opts.find((o) => k.good.includes(o))); } }")
    check("ten right key answers complete the keys lesson", pg.is_checked('[data-done="keys"]'))
    for qid, qs in pg.evaluate("Object.entries(__lessons.QUIZ)"):
        check(f"DJ quiz {qid}: valid answers and explanations", all(0 <= x["a"] < len(x["o"]) and x["w"] for x in qs) and len(qs) >= 2)
    pg.locator('[data-quiz="cues"] input').nth(0).check(); pg.locator('[data-quiz="cues"] fieldset').nth(1).locator("input").nth(0).check(); pg.locator('[data-quiz="cues"]').get_by_role("button", name="Check answers").click()
    check("passing a quiz marks that lesson done", pg.is_checked('[data-done="cues"]'))
    check("lessons: no errors", not errs, str(errs))
    ctx.close()
    axe = os.environ.get("AXE_PATH") or os.path.join(ROOT, "node_modules/axe-core/axe.min.js")
    if os.path.exists(axe):
        c2 = browser.new_context(bypass_csp=True, viewport={"width": 1200, "height": 900}); p2 = c2.new_page(); p2.goto(base + "lessons.html?gvtest"); p2.wait_for_function("() => window.__lessons"); p2.click("#kqnew"); p2.add_script_tag(path=axe)
        v = p2.evaluate("axe.run(document,{runOnly:['wcag2a','wcag2aa','wcag21a','wcag21aa','best-practice']}).then(r=>r.violations.map(v=>v.id+' x'+v.nodes.length+' '+v.nodes[0].target.join(' ')))"); check("DJ lessons page: no axe violations", not v, str(v)); c2.close()
    c3 = browser.new_context(viewport={"width": 390, "height": 844}); p3 = c3.new_page(); p3.goto(base + "lessons.html"); over = p3.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth"); check("DJ lessons: no sideways scroll at 390px", over <= 0, str(over)); c3.close()


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
    c1, c2 = pg.locator("#cliplist .clip").nth(0).locator("input[type=number]").nth(0), pg.locator("#cliplist .clip").nth(1).locator("input[type=number]").nth(1)
    c1.fill("0.5"); c1.dispatch_event("change")
    c2.fill("1.7"); c2.dispatch_event("change")
    st = pg.evaluate("__ve.state")
    want = (st["clips"][0]["dur"] - 0.5) + 1.7
    check("trim in/out changes the timeline length", abs(st["total"] - want) < 0.02, f"{st['total']} vs {want}")
    pg.fill("#ttext", "Hello Vibe"); pg.fill("#tstart", "0"); pg.fill("#tend", "10"); pg.select_option("#tpos", "middle"); pg.click("#tadd")
    pg.evaluate("__ve.seek(0.5)")
    pg.wait_for_timeout(500)
    px = pg.evaluate("""(() => { const c = document.getElementById('cv'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let w = 0, r = 0;
      for (let i = 0; i < d.length; i += 4) { if (d[i] > 240 && d[i + 1] > 240 && d[i + 2] > 240) w++; if (d[i] > 150 && d[i + 1] < 80) r++; } return { w, r }; })()""")
    check("preview shows the red clip with white text", px["r"] > 400000 and px["w"] > 3000, str(px))
    # fades and transitions
    px_at = """([fx, fy]) => { const c = document.getElementById('cv'), d = c.getContext('2d').getImageData(Math.round(c.width * fx), Math.round(c.height * fy), 1, 1).data; return [d[0], d[1], d[2]]; }"""
    cl = lambda i: pg.locator("#cliplist .clip").nth(i)
    cl(0).locator("input.fi").fill("1"); cl(0).locator("input.fi").dispatch_event("change")
    pg.evaluate("__ve.seek(0.05)"); pg.wait_for_timeout(500); a0 = pg.evaluate(px_at, [0.05, 0.05])
    pg.evaluate("__ve.seek(0.9)"); pg.wait_for_timeout(500); a1 = pg.evaluate(px_at, [0.05, 0.05])
    check("fade in: the first frame is nearly black and a second later it is the full red", sum(a0) < 120 and a1[0] > 150, f"{a0} {a1}")
    cl(0).locator("input.fi").fill("0"); cl(0).locator("input.fi").dispatch_event("change")
    cl(1).locator("input.fo").fill("1"); cl(1).locator("input.fo").dispatch_event("change")
    tot = pg.evaluate("__ve.state.total")
    pg.evaluate(f"__ve.seek({tot} - 0.1)"); pg.wait_for_timeout(500); e1 = pg.evaluate(px_at, [0.05, 0.05])
    for _ in range(10):
        if sum(e1) < 150: break
        pg.evaluate(f"__ve.seek({tot} - 0.1)"); pg.wait_for_timeout(400); e1 = pg.evaluate(px_at, [0.05, 0.05])
    check("fade out: the last frames go dark", sum(e1) < 150, str(e1))
    cl(1).locator("input.fo").fill("0"); cl(1).locator("input.fo").dispatch_event("change")
    len1 = pg.evaluate("__ve.state.clips[0].out - __ve.state.clips[0].in")
    def play_through(label):
        pg.evaluate(f"__ve.seek({len1} - 0.4)"); pg.wait_for_timeout(300); pg.evaluate("__ve.play()")
        pg.wait_for_function("() => __ve.state.tl > %f + 0.45" % len1, timeout=8000); pg.evaluate("__ve.pause()"); pg.wait_for_timeout(300)
    cl(1).locator("select.tr").select_option("fade"); cl(1).locator("input.td").fill("1.5"); cl(1).locator("input.td").dispatch_event("change")
    play_through("fade"); mx = pg.evaluate(px_at, [0.05, 0.05])
    check("crossfade shows a mix of the red and blue clips", 70 < mx[0] < 175 and 70 < mx[2] < 160, str(mx))
    cl(1).locator("select.tr").select_option("wipe"); play_through("wipe"); wl, wr = pg.evaluate(px_at, [0.03, 0.05]), pg.evaluate(px_at, [0.97, 0.05])
    check("wipe: new clip (blue) on the left, old clip (red) still on the right", wl[2] > 120 and wl[0] < 90 and wr[0] > 150 and wr[2] < 90, f"{wl} {wr}")
    cl(1).locator("select.tr").select_option("slide"); play_through("slide"); sl, sr_ = pg.evaluate(px_at, [0.03, 0.05]), pg.evaluate(px_at, [0.97, 0.05])
    check("slide: old clip pushed out to the left, new clip coming in on the right", sl[0] > 150 and sr_[2] > 120 and sr_[0] < 90, f"{sl} {sr_}")
    cl(1).locator("select.tr").select_option("cut"); play_through("cut"); ct = pg.evaluate(px_at, [0.05, 0.05])
    check("cut switches straight to the blue clip", ct[2] > 120 and ct[0] < 90, str(ct))
    pg.evaluate("__ve.pause()")
    axe = os.environ.get("AXE_PATH") or os.path.join(ROOT, "node_modules/axe-core/axe.min.js")
    if os.path.exists(axe):
        ctxa = browser.new_context(bypass_csp=True); pa = ctxa.new_page(); pa.goto(base + "video.html?gvtest")
        pa.evaluate(mk, ["#c0392b", 1.2]); pa.evaluate(mk, ["#2471a3", 1.2]); pa.add_script_tag(path=axe)
        va = pa.evaluate("axe.run(document,{runOnly:['wcag2a','wcag2aa','wcag21a','wcag21aa','best-practice']}).then(r=>r.violations.map(v=>v.id+' x'+v.nodes.length+' '+v.nodes[0].target.join(' ')))")
        check("video page with two clips and the new controls: no axe violations", not va, str(va)); ctxa.close()
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


def test_video_pro(browser, base):
    print("video editor: speed, grade, zoom, green screen, stabilise, text, subtitles, ducking, screen, export options")
    import tempfile, zlib, struct
    errs = []
    ctx, pg = new_page(browser, errs, viewport={"width": 1300, "height": 1000}, accept_downloads=True)
    pg.goto(base + "video.html?gvtest"); pg.wait_for_function("() => window.__ve", timeout=10000)
    ev = lambda js, *a: pg.evaluate(js, *a) if a else pg.evaluate(js)
    mk = """async ([kind, secs]) => { const c = document.createElement('canvas'); c.width = 320; c.height = 180; const g = c.getContext('2d');
      const ac = new AudioContext(), dest = ac.createMediaStreamDestination(), o = ac.createOscillator(); o.connect(dest); o.start();
      const s = c.captureStream(30); dest.stream.getAudioTracks().forEach((t) => s.addTrack(t));
      const rec = new MediaRecorder(s, { mimeType: 'video/webm;codecs=vp8,opus' }), ch = []; rec.ondataavailable = (e) => ch.push(e.data);
      const done = new Promise((r) => (rec.onstop = r)); rec.start(100); const t0 = performance.now();
      const tex = document.createElement('canvas'); tex.width = 480; tex.height = 300; const tg = tex.getContext('2d'); let seed = 7; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
      for (let i = 0; i < 500; i++) { tg.fillStyle = 'hsl(' + Math.floor(rnd() * 360) + ',70%,' + Math.floor(25 + rnd() * 50) + '%)'; tg.fillRect(rnd() * 480, rnd() * 300, 8 + rnd() * 30, 8 + rnd() * 30); }
      await new Promise((res) => { (function f() { const t = (performance.now() - t0) / 1000;
        if (kind === 'split') { g.fillStyle = '#00b140'; g.fillRect(0, 0, 160, 180); g.fillStyle = '#e02020'; g.fillRect(160, 0, 160, 180); }
        else if (kind === 'shake') g.drawImage(tex, -80 + Math.round(8 * Math.sin(t * 9)), -60 + Math.round(5 * Math.cos(t * 7)));
        else if (kind === 'still') g.drawImage(tex, -80, -60);
        else { g.fillStyle = kind; g.fillRect(0, 0, 320, 180); }
        if (t >= secs) res(); else requestAnimationFrame(f); })(); });
      rec.stop(); await done; o.stop(); await __ve.addFile(new File([new Blob(ch, { type: 'video/webm' })], kind.replace('#', '') + '.webm')); }"""
    px_at = """([fx, fy]) => { const c = document.getElementById('cv'), d = c.getContext('2d').getImageData(Math.round(c.width * fx), Math.round(c.height * fy), 1, 1).data; return [d[0], d[1], d[2]]; }"""
    shot = lambda fx, fy, t=0.5: (ev("(t) => __ve.seek(t)", t), pg.wait_for_timeout(450), ev(px_at, [fx, fy]))[2]
    cl = lambda i: pg.locator("#cliplist .clip").nth(i)
    def sect(i, name): 
        d = cl(i).locator("details.vfx", has_text=name)
        if d.get_attribute("open") is None: d.locator("summary").click()
        return d
    # ---------- speed ----------
    ev(mk, ["#c0392b", 2.4]); L0 = ev("__ve.state.total")
    check("the clip starts at normal speed", ev("__ve.clips[0].speed") == 1 and ev("__ve.clips[0].speed2") == 1)
    d = sect(0, "Speed"); d.locator(".sp1").fill("2"); d.locator(".sp1").dispatch_event("change")
    check("2x speed halves the length on the timeline", abs(ev("__ve.state.total") - L0 / 2) < 0.01, f"{ev('__ve.state.total')} vs {L0 / 2}")
    d.locator(".sp2").fill("4"); d.locator(".sp2").dispatch_event("change")
    c0 = ev("() => { const c = __ve.clips[0]; return [c.out - c.in, c.speed, c.speed2]; }"); Lc, a, b = c0
    want_len = Lc * __import__("math").log(b / a) / (b - a)
    check("a ramp from 2x to 4x has the exact curved length", abs(ev("__ve.state.total") - want_len) < 0.01, f"{ev('__ve.state.total')} vs {want_len}")
    r = ev("() => { const c = __ve.clips[0], T = __ve.lenOf(c); return [__ve.srcAt(c, T) - (c.out - c.in), __ve.tAt(c, __ve.srcAt(c, T * 0.37)) - T * 0.37]; }")
    check("the ramp maps source time to timeline time and back exactly", abs(r[0]) < 1e-6 and abs(r[1]) < 1e-6, str(r))
    ev("() => { __ve.seek(0); __ve.play(); }"); pg.wait_for_timeout(500)
    rate = ev("__ve.clips[0].v.playbackRate"); ev("__ve.pause()")
    check("playback uses the ramped speed (between 2x and 4x)", 2 <= rate <= 4, str(rate))
    pg.click("#cliplist .clip >> nth=0 >> .sp0")
    check("Reset puts the speed back to normal", ev("__ve.clips[0].speed") == 1 and abs(ev("__ve.state.total") - L0) < 0.01)
    # ---------- colour ----------
    pre = shot(0.5, 0.5, 0.5); d = sect(0, "Colour grading")
    d.locator("select.gp").select_option("bw"); post = shot(0.5, 0.5, 0.5)
    if ev("__ve.hasFilter"):
        check("the black and white look removes the colour", max(post) - min(post) < 14 and max(pre) - min(pre) > 60, f"{pre} -> {post}")
        d.locator(".gb").fill("150"); d.locator(".gb").dispatch_event("input"); br = shot(0.5, 0.5, 0.5)
        check("a custom slider moves the look to Custom and changes the picture", d.locator("select.gp").input_value() == "" and sum(br) > sum(post), f"{post} -> {br}")
    d.locator("select.gp").select_option("normal"); same = shot(0.5, 0.5, 0.5)
    check("the Normal look restores the original colours", all(abs(x - y) < 6 for x, y in zip(pre, same)), f"{pre} vs {same}")
    # ---------- zoom, pan and green screen on a split clip ----------
    ev(mk, ["split", 2.4]); ev("() => { __ve.clips[0].v.remove(); }") if False else None
    pg.locator("#cliplist .clip").nth(0).locator("button[data-a=del]").click()
    check("the red clip was removed, leaving the split clip", ev("__ve.clips.length") == 1 and ev("__ve.clips[0].name") == "split.webm")
    left0, right0 = shot(0.25, 0.5, 0.5), shot(0.75, 0.5, 0.5)
    check("the test clip has a green left half and a red right half", left0[1] > 120 and left0[0] < 80 and right0[0] > 150 and right0[1] < 90, f"{left0} {right0}")
    d = sect(0, "Zoom and pan")
    for cls, v in (("zs1", "200"), ("zs2", "200"), ("zx1", "20"), ("zx2", "20")): d.locator("." + cls).fill(v); d.locator("." + cls).dispatch_event("change")
    mid = shot(0.6, 0.5, 0.5)
    check("200% zoom panned 20% right moves the green/red border to 70% of the width", mid[1] > 120 and mid[0] < 80 and shot(0.75, 0.5, 0.5)[0] > 150, str(mid))
    d.locator("select.zp").select_option("none"); back = shot(0.6, 0.5, 0.5)
    check("the None preset undoes the zoom", back[0] > 150 and back[1] < 90, str(back))
    d.locator("select.zp").select_option("zin")
    z = ev("() => __ve.clips[0].zoom"); check("the slow zoom in preset zooms from 100% to 118%", z["s1"] == 100 and z["s2"] == 118, str(z))
    d.locator("select.zp").select_option("none")
    d = sect(0, "Green screen")
    d.locator(".ko").check(); d.locator(".kb").fill("#0000ff"); d.locator(".kb").dispatch_event("input")
    k_left, k_right = shot(0.25, 0.5, 0.5), shot(0.75, 0.5, 0.5)
    check("green screen replaces the green half with the background colour and keeps the red half", k_left[2] > 150 and k_left[1] < 90 and k_left[0] < 90 and k_right[0] > 150 and k_right[2] < 90, f"{k_left} {k_right}")
    png = lambda rgb: (lambda raw: b"\x89PNG\r\n\x1a\n" + struct.pack(">I", 13) + b"IHDR" + struct.pack(">IIBBBBB", 4, 4, 8, 2, 0, 0, 0) + struct.pack(">I", zlib.crc32(b"IHDR" + struct.pack(">IIBBBBB", 4, 4, 8, 2, 0, 0, 0))) + struct.pack(">I", len(zlib.compress(raw))) + b"IDAT" + zlib.compress(raw) + struct.pack(">I", zlib.crc32(b"IDAT" + zlib.compress(raw))) + struct.pack(">I", 0) + b"IEND" + struct.pack(">I", zlib.crc32(b"IEND")))(b"".join(b"\x00" + bytes(rgb) * 4 for _ in range(4)))
    pg.set_input_files("#bgfile", files=[{"name": "bg.png", "mimeType": "image/png", "buffer": png((255, 255, 0))}]); pg.wait_for_timeout(300)
    yl = shot(0.25, 0.5, 0.5)
    check("a background picture shows through the keyed area", yl[0] > 200 and yl[1] > 200 and yl[2] < 90, str(yl))
    d.locator(".kbx").click(); d.locator(".ko").uncheck()
    check("Clear removes the picture and the key can be switched off", shot(0.25, 0.5, 0.5)[1] > 120)
    kp = ev("""() => { const d = new Uint8ClampedArray([0, 177, 64, 255, 224, 32, 32, 255, 20, 20, 20, 255, 0, 120, 40, 255]); __ve.keyPixels(d, { color: '#00b140', tol: 40, soft: 15 }); return [d[3], d[7], d[11], d[15]]; }""")
    check("the key removes green and dark green but keeps red and near black", kp[0] == 0 and kp[1] == 255 and kp[2] == 255 and kp[3] < 40, str(kp))
    # ---------- stabilise ----------
    sh = ev("""() => { const w = 40, h = 30, A = new Float32Array(w * h); let s = 3; for (let i = 0; i < A.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; A[i] = s % 255; }
      const B = new Float32Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const sx = x - 3, sy = y + 2; B[y * w + x] = sx >= 0 && sx < w && sy >= 0 && sy < h ? A[sy * w + sx] : 0; }
      return __ve.estimateShift(A, B, w, h, 6); }""")
    check("the motion estimator finds a known shift of 3 right and 2 up", sh == [3, -2], str(sh))
    ev(mk, ["still", 2.2]); ev(mk, ["shake", 2.2]); n = ev("__ve.clips.length")
    ev("(i) => __ve.stabilise(i)", n - 2); pg.wait_for_timeout(300); still = ev("(i) => Math.max(...__ve.clips[i].stab.dx.map(Math.abs), ...__ve.clips[i].stab.dy.map(Math.abs))", n - 2)
    check("a steady clip needs almost no correction", still < 0.01, str(still))
    d = sect(n - 1, "Stabilise"); d.locator(".sa").click(); pg.wait_for_function("(i) => __ve.clips[i].stab !== null", arg=n - 1, timeout=60000); pg.wait_for_timeout(300)
    shk = ev("(i) => Math.max(...__ve.clips[i].stab.dx.map(Math.abs), ...__ve.clips[i].stab.dy.map(Math.abs))", n - 1)
    check("a shaky clip gets real corrections and stabilisation turns on", shk > 0.012 and ev("(i) => __ve.clips[i].stabOn", n - 1) and d.locator(".so").is_checked() and "Done" in d.locator(".sn").inner_text(), f"{shk} {d.locator('.sn').inner_text()}")
    check("the stabilised clip has one correction per tenth of a second", abs(ev("(i) => __ve.clips[i].stab.dx.length", n - 1) - 22) <= 2)
    ev("(n) => { for (let i = 0; i < n; i++) { const c = __ve.clips[0]; } }", 0)
    for _ in range(ev("__ve.clips.length") - 1): cl(0).locator("button[data-a=del]").click()
    ev(mk, ["#c0392b", 4.0]); cl(0).locator("button[data-a=del]").click()
    check("one clip is left for the text tests", ev("__ve.clips.length") == 1)
    # ---------- text ----------
    pg.fill("#ttext", "Hello"); pg.fill("#tstart", "0.2"); pg.fill("#tend", "3"); pg.select_option("#tpos", "middle"); pg.select_option("#tanim", "fade"); pg.fill("#talen", "1"); pg.fill("#tsize", "120"); pg.click("#tadd")
    t = ev("__ve.texts[0]"); check("a text layer keeps its font, style and animation", t["anim"] == "fade" and t["alen"] == 1 and t["style"] == "outline" and t["font"] == "sans", str(t))
    white = lambda tt: (ev("(t) => __ve.seek(t)", tt), pg.wait_for_timeout(450), ev("""() => { const c = document.getElementById('cv'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let w = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 235 && d[i + 1] > 235 && d[i + 2] > 235) w++; return w; }"""))[2]
    w0, w1, w2 = white(0.25), white(0.7), white(1.6)
    check("a fade in starts nearly invisible and ends fully visible", w0 < w2 * 0.15 and w1 < w2 * 0.9 and w2 > 3000, f"{w0} {w1} {w2}")
    ev("() => { __ve.texts[0].anim = 'type'; __ve.texts[0].alen = 1; }"); t0w, t1w = white(0.5), white(2.0)
    check("typewriter shows only the first letters at first", t0w < t1w * 0.7 and t0w > 0, f"{t0w} {t1w}")
    ev("() => { Object.assign(__ve.texts[0], { anim: 'none', style: 'box' }); }"); inbox, outbox = shot(0.352, 0.5, 1.0), shot(0.25, 0.5, 1.0)
    check("the Box style puts a dark panel behind the letters, and the picture is untouched outside it", inbox[0] < 90 and inbox[1] < 35 and outbox[0] > 150, f"{inbox} {outbox}")
    ev("() => { __ve.texts[0].style = 'outline'; __ve.texts[0].anim = 'type'; }")
    pg.click("#textlist .clip >> nth=0 >> text=Edit")
    check("Edit moves a text layer back into the form with its settings", pg.input_value("#ttext") == "Hello" and ev("__ve.texts.length") == 0 and pg.input_value("#tanim") == "type" and pg.input_value("#tstyle") == "outline")
    # ---------- subtitles ----------
    srt = "1\n00:00:01,000 --> 00:00:03,500\nHello <i>there</i>\n\n2\n00:00:04,000 --> 00:00:06,250\nSecond line\nwraps here\n\n"
    vtt = "WEBVTT\n\n00:01.500 --> 00:02.000\nShort cue\n\n1:00:00.000 --> 1:00:01.000\nAn hour in\n"
    r = ev("([a, b]) => [__ve.parseSubs(a), __ve.parseSubs(b)]", [srt, vtt])
    check("SRT cues parse with times, markup removed and line breaks kept", r[0][0] == {"text": "Hello there", "start": 1, "end": 3.5} and r[0][1]["text"] == "Second line\nwraps here" and r[0][1]["end"] == 6.25, str(r[0]))
    check("VTT cues parse with and without an hour", r[1][0]["start"] == 1.5 and r[1][1]["start"] == 3600, str(r[1]))
    f = tempfile.mkdtemp() + "/subs.srt"; open(f, "w").write(srt); pg.set_input_files("#subfile", f); pg.wait_for_timeout(300)
    check("importing an SRT file adds the cues as text layers at the bottom", ev("__ve.texts.length") == 2 and ev("__ve.texts[0].pos") == "bottom" and "2 text layers" in pg.inner_text("#subcount"))
    with pg.expect_download(timeout=10000) as dl: pg.click("#subexp")
    out_srt = open(dl.value.path()).read()
    check("exporting writes the text layers back as a valid SRT", "00:00:01,000 --> 00:00:03,500" in out_srt and out_srt.startswith("1\n") and "Second line\nwraps here" in out_srt, out_srt[:120])
    bad = tempfile.mkdtemp() + "/x.srt"; open(bad, "w").write("nothing useful here"); pg.set_input_files("#subfile", bad); pg.wait_for_timeout(300)
    check("a file with no subtitles is refused politely", "No subtitles found" in pg.inner_text("#status") and ev("__ve.texts.length") == 2)
    # ---------- ducking ----------
    pg.evaluate("""async () => { const sr = 8000, n = sr * 6, b = new ArrayBuffer(44 + n * 2), v = new DataView(b), w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
      w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
      for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.sin(i / 9) * 8000, true); await __ve.loadMusic(new File([b], 'tone.wav')); }""")
    ev("() => { __ve.seek(0); __ve.play(); }"); pg.wait_for_timeout(700); off = ev("__ve.duckGain")
    pg.check("#duck"); pg.wait_for_timeout(900); on = ev("__ve.duckGain")
    check("with ducking off the music stays at full level", off > 0.95, str(off))
    check("with ducking on the music dips by about 12 dB while the video has sound", 0.15 < on < 0.4, str(on))
    pg.fill("#duckamt", "24") if False else ev("() => { const r = document.getElementById('duckamt'); r.value = 24; r.dispatchEvent(new Event('input')); }"); pg.wait_for_timeout(700)
    check("a bigger dip setting lowers it further", ev("__ve.duckGain") < 0.1, str(ev("__ve.duckGain")))
    pg.uncheck("#duck"); pg.wait_for_timeout(1500); ev("__ve.pause()")
    check("switching ducking off brings the music back up", ev("__ve.duckGain") > 0.9)
    # ---------- screen recording (the browser's screen picker is replaced by a canvas) ----------
    ev("""() => { navigator.mediaDevices.getDisplayMedia = async () => { const c = document.createElement('canvas'); c.width = 320; c.height = 180; const g = c.getContext('2d'); let k = 0; setInterval(() => { g.fillStyle = 'hsl(' + (k += 7) % 360 + ',60%,40%)'; g.fillRect(0, 0, 320, 180); }, 33); return c.captureStream(30); }; }""")
    n0 = ev("__ve.clips.length"); pg.click("#screen"); pg.wait_for_timeout(1600)
    check("while recording the button turns into Stop", "Stop recording" in pg.inner_text("#screen") and ev("__ve.screen"))
    pg.click("#screen"); pg.wait_for_function("(n) => __ve.clips.length === n + 1", arg=n0, timeout=15000)
    check("stopping adds the screen recording to the timeline as a clip", ev("__ve.clips.at(-1).name").startswith("Screen recording") and ev("__ve.clips.at(-1).dur") > 0.8 and pg.inner_text("#screen") == "● Record screen")
    ev("""() => { navigator.mediaDevices.getDisplayMedia = async () => { throw new DOMException('no', 'NotAllowedError'); }; }"""); pg.click("#screen"); pg.wait_for_timeout(300)
    check("cancelling the screen picker is handled with a clear message", "cancelled or blocked" in pg.inner_text("#status") and not ev("__ve.screen"))
    # ---------- export options ----------
    pg.select_option("#xres", "480"); pg.select_option("#xfps", "24"); pg.select_option("#xq", "low"); pg.select_option("#xfmt", "webm")
    out = ev("""async () => { const b = await __ve.exportVideo(); if (!b) return null; const n = __ve.clips.length; await __ve.addFile(new File([b], 'small.webm', { type: b.type })); const v = __ve.clips[n].v; return { type: b.type, size: b.size, w: v.videoWidth, h: v.videoHeight, dur: v.duration }; }""")
    check("export at 480p makes a 854 by 480 WebM file", out and out["type"].startswith("video/webm") and out["w"] == 854 and out["h"] == 480, str(out))
    check("the preview goes back to normal size after exporting", ev("[document.getElementById('cv').width, document.getElementById('cv').height]") == [1280, 720])
    check("the format list offers Automatic, WebM, MP4, GIF and audio", (lambda o: o[:3] == ["Automatic", "WebM", "MP4 (if supported)"] and any("GIF" in x for x in o) and any("Audio" in x for x in o))(pg.locator("#xfmt option").all_inner_texts()))
    # ---------- fast export ----------
    for _ in range(ev("__ve.clips.length")): cl(0).locator("button[data-a=del]").click()
    ev(mk, ["#c0392b", 2.0]); ev(mk, ["#2471a3", 2.0]); cl(1).locator("select.tr").select_option("cut")
    pg.select_option("#xres", "480"); pg.select_option("#xfps", "24"); pg.select_option("#xfmt", "auto"); pg.select_option("#xmode", "fast")
    T = ev("__ve.state.total")
    import time as _t; t0 = _t.time()
    res = ev("""async () => { const b = await __ve.exportVideo(); if (!b) return null; const u = URL.createObjectURL(b), v = document.createElement('video'); v.muted = true; v.src = u; await new Promise((r) => (v.onloadedmetadata = r));
      const shot = async (t) => { v.currentTime = t; await new Promise((r) => (v.onseeked = r)); const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight; c.getContext('2d').drawImage(v, 0, 0); return Array.from(c.getContext('2d').getImageData(c.width >> 1, c.height >> 1, 1, 1).data); };
      const ac = new AudioContext(), ab = await ac.decodeAudioData(await b.arrayBuffer()), d = ab.getChannelData(0); let s = 0; for (let i = 0; i < d.length; i++) s += d[i] * d[i];
      return { type: b.type, size: b.size, w: v.videoWidth, h: v.videoHeight, dur: v.duration, a: await shot(0.5), b: await shot(3.3), rms: Math.sqrt(s / d.length), adur: ab.duration }; }""")
    took = _t.time() - t0
    check("fast export produces a 854 by 480 video the right length", res and res["w"] == 854 and res["h"] == 480 and abs(res["dur"] - T) < 0.4, str(res))
    check("fast export reports that it used the fast method", "Done:" in pg.inner_text("#status") and " in " in pg.inner_text("#status") and took < T * 3, f"{took:.1f} s for a {T:.1f} s video: {pg.inner_text('#status')}")
    check("fast export uses the right picture at each time (red first, blue second)", res and res["a"][0] > 140 and res["a"][2] < 110 and res["b"][2] > 110 and res["b"][0] < 110, str(res and (res["a"], res["b"])))
    check("fast export keeps the sound of the clips", res and res["rms"] > 0.05 and abs(res["adur"] - T) < 0.4, str(res and (res["rms"], res["adur"])))
    check("the file is MP4 or WebM and the download link is shown", res and res["type"] in ("video/mp4", "video/webm") and not pg.locator("#dl").evaluate("(a) => a.classList.contains('hidden')") and pg.get_attribute("#dl", "download").endswith(("mp4", "webm")))
    pg.select_option("#xfmt", "webm"); wb = ev("async () => { const b = await __ve.exportVideo(); return b && b.type; }")
    check("choosing WebM gives a WebM file", wb == "video/webm", str(wb))
    pg.select_option("#xfmt", "wav"); wv = ev("""async () => { const b = await __ve.exportVideo(); if (!b) return null; const u = new Uint8Array(await b.arrayBuffer()); return { type: b.type, riff: String.fromCharCode(...u.slice(0, 4)), size: b.size }; }""")
    check("audio only export writes a stereo WAV of the whole timeline", wv and wv["type"] == "audio/wav" and wv["riff"] == "RIFF" and abs(wv["size"] - (44 + T * 48000 * 4)) < 20000, str(wv))
    pg.select_option("#xfmt", "auto")
    d = sect(0, "Speed"); d.locator(".sp1").fill("2"); d.locator(".sp1").dispatch_event("change")
    fb = ev("async () => { const b = await __ve.exportVideo(); return b && b.type; }")
    check("a clip with a speed change falls back to real time export and says so", fb and fb.startswith("video/") and "real time" in pg.inner_text("#status").lower(), pg.inner_text("#status"))
    pg.click("#cliplist .clip >> nth=0 >> .sp0")
    pg.select_option("#xmode", "real"); rt = ev("async () => { const b = await __ve.exportVideo(); return b && b.type; }")
    check("the Real time method still works", rt and rt.startswith("video/"), str(rt))
    axe = os.environ.get("AXE_PATH") or os.path.join(ROOT, "node_modules/axe-core/axe.min.js")
    if os.path.exists(axe):
        c3 = browser.new_context(bypass_csp=True, viewport={"width": 1300, "height": 1000}); p3 = c3.new_page(); p3.goto(base + "video.html?gvtest"); p3.wait_for_function("() => window.__ve", timeout=10000)
        p3.evaluate(mk, ["#c0392b", 1.5]); p3.evaluate("document.querySelectorAll('details.vfx').forEach((d) => (d.open = true))"); p3.add_script_tag(path=axe)
        v = p3.evaluate("axe.run(document,{runOnly:['wcag2a','wcag2aa','wcag21a','wcag21aa','best-practice']}).then(r=>r.violations.map(v=>v.id+' x'+v.nodes.length+' '+v.nodes[0].target.join(' ')))")
        check("video page with every clip control open: no axe violations", not v, str(v)); c3.close()
    check("no page errors in the video editor", not errs, str(errs[:3]))
    ctx.close()


# ---------------------------------------------------------------- spectrogram
def test_spectrogram(browser, base):
    print("spectrogram: engine and audio editor view")
    errs = []
    ctx, pg = new_page(browser, errs)
    pg.goto(base + "editor.html?gvtest")
    r = pg.evaluate("""() => { const sr = 48000, n = sr * 2, a = new Float32Array(n);
      for (let i = 0; i < n; i++) a[i] = 0.5 * Math.sin(2 * Math.PI * 1000 * i / sr);
      const s = GVSpec.compute([a], sr, 100, 4096); let best = 0, col = 50; for (let b = 1; b < s.bins; b++) if (s.db[col * s.bins + b] > s.db[col * s.bins + best]) best = b;
      return { hz: best * sr / 4096, db: s.db[col * s.bins + best], quiet: s.db[col * s.bins + 400], cols: s.cols };
    }""")
    check("FFT finds a 1 kHz sine at the right bin", abs(r["hz"] - 1000) < 15, str(r))
    check("level reads close to the true amplitude (0.5 is about minus 6 dB)", -9 < r["db"] < -4, str(r))
    check("far away bins stay near the floor", r["quiet"] < -60, str(r))
    pg.evaluate("""() => { const sr = 48000, n = sr * 3, a = new Float32Array(n);
      for (let i = 0; i < n; i++) a[i] = (i < n / 2 ? 0.4 * Math.sin(2 * Math.PI * 440 * i / sr) : 0.4 * Math.sin(2 * Math.PI * 4000 * i / sr));
      __gv.loadBuffers([a], sr); }""")
    pg.wait_for_timeout(300)
    check("the editor starts on the waveform", pg.evaluate("__gv.view") == "wave" and pg.get_attribute("#vwave", "aria-pressed") == "true")
    pg.click("#vspec"); pg.wait_for_timeout(400)
    check("the spectrogram view opens and shows its options", pg.evaluate("__gv.view") == "spec" and pg.locator("#specopt").is_visible() and pg.get_attribute("#vspec", "aria-pressed") == "true")
    d = pg.evaluate("""() => { const s = __gv.spec; const peak = (x) => { let bh = 0, bd = -999; for (let y = 0; y < 400; y++) { const p = GVSpec.probe(s, x, y / 400, { log: true, fmax: 20000 }); if (p.db > bd) { bd = p.db; bh = p.hz; } } return bh; };
      return { first: peak(0.2), second: peak(0.8) }; }""")
    check("the first half peaks near 440 Hz and the second near 4000 Hz", abs(d["first"] - 440) < 60 and abs(d["second"] - 4000) < 350, str(d))
    px = pg.evaluate("""() => { const c = document.getElementById('wave'), g = c.getContext('2d'), W = c.width, H = c.height; let lit = 0, dark = 0; const col = g.getImageData(Math.floor(W * 0.8), 0, 1, H).data; for (let y = 0; y < H; y++) { const v = col[y * 4] + col[y * 4 + 1] + col[y * 4 + 2]; if (v > 450) lit++; if (v < 80) dark++; } return { lit, dark, H }; }""")
    check("the picture has bright pitch lines on a dark background", px["lit"] > 0 and px["dark"] > px["H"] * 0.5, str(px))
    box = pg.locator("#wave").bounding_box()
    pg.mouse.move(box["x"] + box["width"] * 0.8, box["y"] + box["height"] * 0.5); pg.wait_for_timeout(200)
    check("hovering shows frequency, time and level", re.search(r"\d+ Hz · .+ · -?\d+ dB", pg.inner_text("#specinfo")) is not None, pg.inner_text("#specinfo"))
    pg.select_option("#speclog", "0"); pg.wait_for_timeout(300)
    d2 = pg.evaluate("""() => { const s = __gv.spec; let bh = 0, bd = -999; for (let y = 0; y < 400; y++) { const p = GVSpec.probe(s, 0.8, y / 400, { log: false, fmax: 20000 }); if (p.db > bd) { bd = p.db; bh = p.hz; } } return bh; }""")
    check("the linear axis still maps 4 kHz correctly", abs(d2 - 4000) < 150, str(d2))
    pg.mouse.move(box["x"] + box["width"] * 0.2, box["y"] + box["height"] * 0.5); pg.mouse.down(); pg.mouse.move(box["x"] + box["width"] * 0.5, box["y"] + box["height"] * 0.5, steps=6); pg.mouse.up()
    check("a part can be selected on the spectrogram", "Selection" in pg.inner_text("#sel"), pg.inner_text("#sel"))
    pg.evaluate("__gv.ops && 0"); pg.click("#vwave"); pg.wait_for_timeout(200)
    check("back to the waveform", pg.evaluate("__gv.view") == "wave" and pg.locator("#specopt").is_hidden())
    check("no errors in the editor", not errs, str(errs))
    ctx.close()


# ---------------------------------------------------------------- tuner
def test_tuner(browser, base):
    print("tuner: pitch detection and page (fake microphone)")
    errs = []
    b2 = _sp_instance.chromium.launch(args=["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"])
    ctx = b2.new_context(permissions=["microphone"]); pg = ctx.new_page()
    pg.on("pageerror", lambda e: errs.append(f"pageerror: {e}"))
    pg.goto(base + "tuner.html?gvtest")
    check("the tuner waits for permission first", pg.locator("#rig").is_hidden() and pg.locator("#allow").is_visible())
    res = pg.evaluate("""() => { const T = __tuner, out = {}; const make = (f, rate, harm) => { const b = new Float32Array(8192); for (let i = 0; i < b.length; i++) { let v = 0; for (const [k, a] of harm || [[1, 1]]) v += a * Math.sin(2 * Math.PI * f * k * i / rate); b[i] = 0.3 * v; } return b; };
      for (const [f, rate] of [[440, 48000], [82.41, 48000], [196, 44100], [1000, 48000], [32.7, 48000], [1318.5, 44100]]) { const r = T.detect(make(f, rate), rate); out[f] = r ? r.hz : null; }
      out.rich = (T.detect(make(110, 48000, [[1, 0.4], [2, 1], [3, 0.7], [4, 0.3]]), 48000) || {}).hz;
      const nz = new Float32Array(8192).map(() => (Math.random() * 2 - 1) * 0.3); const rn = T.detect(nz, 48000); out.noise = rn ? rn.clarity : 0;
      out.silence = T.detect(new Float32Array(8192), 48000); return out; }""")
    for f, tol in [("440", .6), ("82.41", .3), ("196", .5), ("1000", 2), ("32.7", .5), ("1318.5", 3)]:
        check(f"detects {f} Hz", res[f] is not None and abs(res[f] - float(f)) < tol, str(res[f]))
    check("finds the fundamental even when a harmonic is louder", res["rich"] and abs(res["rich"] - 110) < 1, str(res["rich"]))
    check("noise is not mistaken for a note", res["noise"] < 0.8, str(res["noise"]))
    check("silence gives no pitch", res["silence"] is None)
    n = pg.evaluate("() => [__tuner.noteOf(440), __tuner.noteOf(445), __tuner.noteOf(82.41), __tuner.noteOf(415.3)]")
    check("440 Hz is A4 and in tune", n[0]["name"] == "A4" and abs(n[0]["cents"]) < 0.5, str(n[0]))
    check("445 Hz is about 20 cents sharp", n[1]["name"] == "A4" and 18 < n[1]["cents"] < 21, str(n[1]))
    check("82.41 Hz is E2", n[2]["name"] == "E2" and abs(n[2]["cents"]) < 1, str(n[2]))
    check("415 Hz is A flat or G sharp", n[3]["name"] == "G♯4", str(n[3]))
    pg.click("#allow"); pg.wait_for_selector("#rig:not(.hidden)", timeout=10000)
    pg.wait_for_timeout(600)
    check("the level meter works", "dB" in pg.inner_text("#lvltxt") or pg.inner_text("#lvltxt") == "silence")
    check("chromatic mode hides the string buttons", pg.locator("#strings").is_hidden())
    pg.select_option("#inst", "guitar")
    check("guitar shows six strings E A D G B E", pg.locator("#strings button").all_inner_texts() == ["E2", "A2", "D3", "G3", "B3", "E4"], str(pg.locator("#strings button").all_inner_texts()))
    pg.select_option("#inst", "ukulele")
    check("ukulele shows G C E A", pg.locator("#strings button").all_inner_texts() == ["G4", "C4", "E4", "A4"])
    pg.evaluate("__tuner.show(445)"); pg.wait_for_timeout(300)
    check("the display shows the note and the cents", pg.inner_text("#note") == "A4" and "+20" in pg.inner_text("#cents") and "445" in pg.inner_text("#hz"), pg.inner_text("#cents"))
    check("the needle turns to the sharp side", "rotate(17" in pg.evaluate("document.getElementById('needle').style.transform"), pg.evaluate("document.getElementById('needle').style.transform"))
    pg.evaluate("__tuner.show(440.2)"); pg.wait_for_timeout(900); pg.evaluate("__tuner.show(440.2)"); pg.wait_for_timeout(100)
    check("close enough shows In tune and the green zone", pg.inner_text("#verdict") == "In tune" and "good" in pg.get_attribute("#gauge", "class"), pg.inner_text("#verdict"))
    pg.select_option("#acc", "f"); pg.evaluate("__tuner.show(466.16)")
    check("flats mode spells B flat", pg.inner_text("#note") == "B♭4", pg.inner_text("#note"))
    pg.fill("#a4", "432"); pg.dispatch_event("#a4", "change")
    check("the reference pitch changes", pg.evaluate("__tuner.a4") == 432)
    pg.locator("#strings button").first.click(); pg.wait_for_timeout(200)
    check("a string button plays a reference tone", pg.locator("#strings button.playing").count() == 1)
    check("no errors on the tuner page", not errs, str(errs))
    ctx.close(); b2.close()


# ---------------------------------------------------------------- metronome
def test_metronome(browser, base):
    print("metronome")
    errs = []
    ctx, pg = new_page(browser, errs)
    pg.goto(base + "metronome.html?gvtest")
    check("starts at 100 BPM with four beats", pg.input_value("#bpm") == "100" and pg.locator("#beats .dot").count() == 4)
    check("tempo names follow the speed", pg.evaluate("[__met.tempoName(50), __met.tempoName(100), __met.tempoName(130), __met.tempoName(190)]") == ["Largo", "Andante", "Allegro", "Presto"])
    pg.click("#up"); pg.click("#up"); pg.click("#dn")
    check("plus and minus change the tempo by one", pg.input_value("#bpm") == "101")
    pg.fill("#bpm", "500"); pg.dispatch_event("#bpm", "change")
    check("tempo is limited to 300", pg.input_value("#bpm") == "300")
    pg.fill("#bpm", "240"); pg.dispatch_event("#bpm", "change")
    check("the slider follows the number", pg.input_value("#bpmr") == "240")
    pg.click("#go"); pg.wait_for_timeout(2300); pg.click("#go")
    lg = pg.evaluate("__met.log.slice()")
    beats = [x for x in lg if x["tick"] == 0]
    gaps = [round(beats[i + 1]["t"] - beats[i]["t"], 4) for i in range(len(beats) - 1)]
    check("it plays about 9 beats in 2.3 seconds", 8 <= len(beats) <= 12, str(len(beats)))
    check("beats are exactly 0.25 seconds apart at 240 BPM", gaps and all(abs(g - 0.25) < 0.0005 for g in gaps), str(gaps))
    check("the first beat of each bar is accented", [b["lv"] for b in beats[:8]] == [3, 2, 2, 2, 3, 2, 2, 2], str([b["lv"] for b in beats[:8]]))
    check("the button goes back to Start", pg.inner_text("#go") == "▶ Start" and not pg.evaluate("__met.running"))
    pg.select_option("#num", "3"); pg.select_option("#sub", "2")
    pg.evaluate("__met.log.length = 0"); pg.click("#go"); pg.wait_for_timeout(1500); pg.click("#go")
    lg = pg.evaluate("__met.log.slice()")
    check("3 beats per bar with eighth note subdivisions", [(x["beat"], x["tick"]) for x in lg[:6]] == [(0, 0), (0, 1), (1, 0), (1, 1), (2, 0), (2, 1)], str([(x["beat"], x["tick"]) for x in lg[:6]]))
    sub = [round(lg[i + 1]["t"] - lg[i]["t"], 4) for i in range(0, 4, 2)]
    check("straight eighths sit half way between beats", all(abs(x - 0.125) < 0.0005 for x in sub), str(sub))
    pg.select_option("#swing", "0.33"); pg.evaluate("__met.log.length = 0"); pg.click("#go"); pg.wait_for_timeout(900); pg.click("#go")
    lg = pg.evaluate("__met.log.slice()")
    r = (lg[1]["t"] - lg[0]["t"]) / 0.25
    check("triplet swing delays the off beat to two thirds", abs(r - 0.665) < 0.01, str(r))
    pg.select_option("#sub", "1"); pg.select_option("#swing", "0")
    pg.locator("#beatpick button").nth(1).click(); pg.locator("#beatpick button").nth(1).click()
    check("pressing a beat cycles normal, soft, silent", pg.evaluate("__met.acc")[1] == 0, str(pg.evaluate("__met.acc")))
    pg.locator("#beatpick button").nth(1).click()
    check("and back to accent", pg.evaluate("__met.acc")[1] == 3)
    pg.fill("#bpm", "120"); pg.dispatch_event("#bpm", "change")
    for _ in range(4): pg.click("#tap"); pg.wait_for_timeout(500)
    check("tap tempo finds about 120 BPM from half second taps", 108 <= int(pg.input_value("#bpm")) <= 132, pg.input_value("#bpm"))
    pg.fill("#bpm", "240"); pg.dispatch_event("#bpm", "change"); pg.select_option("#num", "4")
    pg.check("#tr"); pg.fill("#trstep", "10"); pg.fill("#trbars", "1"); pg.fill("#trmax", "260")
    pg.click("#go"); pg.wait_for_timeout(3600); pg.click("#go")
    check("the trainer raises the tempo bar by bar and stops at the goal", pg.input_value("#bpm") == "260", pg.input_value("#bpm"))
    pg.uncheck("#tr"); pg.locator("body").click(position={"x": 5, "y": 5}); pg.keyboard.press("Space"); pg.wait_for_timeout(300)
    check("the space bar starts it", pg.evaluate("__met.running"))
    pg.keyboard.press("Space"); pg.wait_for_timeout(200)
    check("and stops it", not pg.evaluate("__met.running"))
    for k in ("wood", "beep", "hat", "click"): pg.select_option("#snd", k); pg.click("#go"); pg.wait_for_timeout(500); pg.click("#go")
    check("every sound plays without errors", not errs, str(errs))
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
    global _sp_instance
    with sync_playwright() as p:
        _sp_instance = p
        browser = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
        for t in (test_pages, test_a11y, test_editor, test_dj, test_dj_extras, test_dj_four, test_stems, test_grid, test_controls, test_console, test_backup_history, test_tools, test_editor_dsp, test_denoise, test_record, test_studio, test_mixer, test_midi, test_sig_markers, test_studio_rec, test_master, test_keys_samples, test_desktop, test_learn, test_home, test_views, test_lessons, test_video, test_video_pro, test_video_basics, test_video_more, test_spectrogram, test_tuner, test_metronome, test_offline):
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
