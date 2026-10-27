import sys, subprocess, time
from playwright.sync_api import sync_playwright
from PIL import Image
"""Takes the product screenshots used on the home page (images/shot-*.webp).
Needs: pip install playwright pillow numpy, playwright install chromium, and ffmpeg.
Run from the repository root: python3 scripts/screens/make_screens.py [tool names]
The demo music and video are made on the fly and never shipped."""
import os, tempfile
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SP = tempfile.mkdtemp() + '/'
D = SP + 'demo/'; OUT = ROOT + '/images/'
os.makedirs(D, exist_ok=True)
subprocess.run(['python3', os.path.join(os.path.dirname(__file__), 'make_demo_audio.py')], cwd=D, check=True)
subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'gradients=size=1280x720:rate=30:speed=0.04:nb_colors=3:c0=0x1b1464:c1=0xff7a45:c2=0x35d0ff:seed=4', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=8', '-t', '8', '-vf', 'format=yuv420p', '-c:v', 'libvpx', '-b:v', '3M', '-c:a', 'libvorbis', D + 'clip1.webm'], check=True)
subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'gradients=size=1280x720:rate=30:speed=0.05:nb_colors=3:c0=0x2a0b4d:c1=0xff4f9a:c2=0xffd35c:seed=9', '-t', '6', '-vf', 'format=yuv420p', '-c:v', 'libvpx', '-b:v', '3M', D + 'clip2.webm'], check=True)
which = sys.argv[1:] or 'studio dj editor video master convert bpm keys samples record lessons learn'.split()
srv = subprocess.Popen(['python3', '-m', 'http.server', '8765'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1)
B = 'http://localhost:8765/'

def save(name, w=960):
    im = Image.open(SP + 's-' + name + '.png').convert('RGB'); im = im.resize((w, round(w * im.height / im.width)), Image.LANCZOS)
    im.save(OUT + 'shot-' + name + '.webp', 'WEBP', quality=84, method=6)

with sync_playwright() as p:
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'])
    def page(url, w, h):
        ctx = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=1.5, permissions=['microphone']); pg = ctx.new_page(); pg.goto(B + url); pg.wait_for_timeout(600); return pg
    def shot(pg, n):
        pg.screenshot(path=SP + 's-' + n + '.png'); save(n)
    def run(name, fn):
        if name in which:
            try: fn()
            except Exception as e: print('FAILED', name, str(e)[:200])
    def studio():
        pg = page('studio.html', 1360, 850); pg.set_input_files('#file', [D + 'night-drive.wav', D + 'sunrise.wav']); pg.wait_for_timeout(3000); shot(pg, 'studio')
    def dj():
        pg = page('dj.html', 1360, 850); pg.set_input_files('#deck0 [data-r=file]', D + 'night-drive.wav'); pg.set_input_files('#deck1 [data-r=file]', D + 'sunrise.wav'); pg.wait_for_timeout(3500); shot(pg, 'dj')
    def editor():
        pg = page('editor.html', 900, 562); pg.set_input_files('#file', D + 'night-drive.wav'); pg.wait_for_timeout(2500)
        bb = pg.locator('canvas').first.bounding_box(); y = bb['y'] + bb['height'] / 2
        pg.mouse.move(bb['x'] + bb['width'] * .3, y); pg.mouse.down(); pg.mouse.move(bb['x'] + bb['width'] * .62, y, steps=8); pg.mouse.up(); pg.wait_for_timeout(400); shot(pg, 'editor')
    def video():
        pg = page('video.html', 1360, 850); pg.set_input_files('#clipfile', [D + 'clip1.webm', D + 'clip2.webm']); pg.wait_for_timeout(3000)
        pg.set_input_files('#musicfile', D + 'night-drive.wav'); pg.wait_for_timeout(1500)
        pg.fill('#ttext', 'Summer 2026'); pg.click('#tadd'); pg.wait_for_timeout(600); pg.evaluate('window.scrollTo(0,0)'); pg.wait_for_timeout(600); shot(pg, 'video')
    def master():
        pg = page('master.html', 900, 562); pg.set_input_files('#file', D + 'night-drive.wav'); pg.wait_for_timeout(4000); pg.evaluate('window.scrollTo(0,150)'); pg.wait_for_timeout(300); shot(pg, 'master')
    def convert():
        pg = page('convert.html', 900, 562); pg.set_input_files('#file', [D + 'night-drive.wav', D + 'sunrise.wav']); pg.wait_for_timeout(1500)
        pg.get_by_role('button', name='Convert').click(); pg.wait_for_timeout(9000); pg.evaluate('window.scrollTo(0,170)'); pg.wait_for_timeout(300); shot(pg, 'convert')
    def bpm():
        pg = page('bpm.html', 900, 562); pg.set_input_files('#file', [D + 'night-drive.wav', D + 'sunrise.wav']); pg.wait_for_timeout(6000); pg.evaluate('window.scrollTo(0,160)'); pg.wait_for_timeout(300); shot(pg, 'bpm')
    def keys():
        pg = page('keys.html', 900, 562); pg.evaluate('window.scrollTo(0,90)'); pg.wait_for_timeout(300); shot(pg, 'keys')
    def samples():
        pg = page('samples.html', 1000, 625); pg.evaluate('window.scrollTo(0,170)'); pg.wait_for_timeout(300); shot(pg, 'samples')
    def record():
        pg = page('record.html', 900, 562)
        pg.click('text=Allow microphone'); pg.wait_for_timeout(1500); pg.click('#rec'); pg.wait_for_timeout(3500); pg.click('#rec'); pg.wait_for_timeout(1500); shot(pg, 'record')
    def lessons():
        pg = page('lessons.html', 1000, 625); pg.get_by_text('Phrase trainer').first.scroll_into_view_if_needed(); pg.evaluate('window.scrollBy(0,-80)'); pg.wait_for_timeout(400); shot(pg, 'lessons')
    def learn():
        pg = page('learn-music.html', 1000, 625); pg.get_by_role('heading', name='4. Ear training').scroll_into_view_if_needed(); pg.evaluate('window.scrollBy(0,-80)'); pg.wait_for_timeout(400); shot(pg, 'learn')
    for n, f in [('studio', studio), ('dj', dj), ('editor', editor), ('video', video), ('master', master), ('convert', convert), ('bpm', bpm), ('keys', keys), ('samples', samples), ('record', record), ('lessons', lessons), ('learn', learn)]:
        run(n, f)
    b.close()
srv.terminate()
