#!/usr/bin/env python3
"""Draws the original illustrations used on the home page (images/tool-*.svg). Run: python3 scripts/make_tool_images.py"""
import math, os
OUT = os.path.join(os.path.dirname(__file__), '..', 'images')
V, C, P, G, A = '#b9a3ff', '#4fe0f5', '#ff8fc3', '#ffc94d', '#ffb23e'
W, H = 640, 400

def rng(seed):
    s = [seed * 7919 + 13]
    def r():
        s[0] = (s[0] * 1664525 + 1013904223) % 4294967296
        return s[0] / 4294967296
    return r

def frame(name, col, body, glow=(0.72, 0.18)):
    gx, gy = glow
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" role="presentation" focusable="false">
<defs><radialGradient id="g" cx="{gx}" cy="{gy}" r="0.75"><stop offset="0" stop-color="{col}" stop-opacity=".42"/><stop offset="1" stop-color="{col}" stop-opacity="0"/></radialGradient>
<linearGradient id="f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#171a38"/><stop offset="1" stop-color="#0d0f24"/></linearGradient>
<pattern id="d" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1.5" cy="1.5" r="1" fill="#fff" fill-opacity=".07"/></pattern></defs>
<rect width="{W}" height="{H}" fill="url(#f)"/><rect width="{W}" height="{H}" fill="url(#d)"/><rect width="{W}" height="{H}" fill="url(#g)"/>
{body}
</svg>'''
    open(os.path.join(OUT, f'tool-{name}.svg'), 'w').write(svg)

def bars(x0, x1, cy, amp, seed, col, step=6, w=3.2, op=1, env=None):
    r = rng(seed); out = []; n = int((x1 - x0) / step)
    for i in range(n):
        t = i / max(1, n - 1); e = env(t) if env else 1
        h = (0.18 + 0.82 * r() ** 1.3) * amp * e
        out.append(f'<rect x="{x0 + i * step:.1f}" y="{cy - h:.1f}" width="{w}" height="{2 * h:.1f}" rx="{w / 2}" fill="{col}" fill-opacity="{op}"/>')
    return ''.join(out)

def card(x, y, w, h, fill='#1d2145', stroke='#ffffff', so=.10, rx=14):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" stroke="{stroke}" stroke-opacity="{so}"/>'

# 1 Studio: timeline with clips and playhead
b = card(36, 44, 568, 312)
b += '<g stroke="#fff" stroke-opacity=".08">' + ''.join(f'<line x1="{x}" y1="64" x2="{x}" y2="340"/>' for x in range(120, 600, 60)) + '</g>'
tracks = [(V, [(52, 170), (230, 130), (368, 150)], 1), (C, [(52, 80), (140, 210), (358, 160)], 2), (P, [(100, 140), (248, 110), (366, 152)], 3), (G, [(52, 300), (360, 158)], 4)]
for k, (col, clips, sd) in enumerate(tracks):
    y = 74 + k * 66
    b += f'<rect x="52" y="{y}" width="48" height="52" rx="8" fill="{col}" fill-opacity=".16"/><circle cx="76" cy="{y + 26}" r="7" fill="{col}"/>'
    for (cx, cw) in clips:
        b += f'<rect x="{cx + 60}" y="{y}" width="{cw}" height="52" rx="8" fill="{col}" fill-opacity=".20" stroke="{col}" stroke-opacity=".8"/>'
        b += bars(cx + 68, cx + 60 + cw - 8, y + 26, 18, sd * 31 + cx, col, step=5, w=2.6, op=.9)
b += f'<rect x="318" y="58" width="2.4" height="286" fill="#fff"/><path d="M311 54h17l-8.5 11z" fill="#fff"/>'
frame('studio', V, b)

# 2 Loop maker: step pads
b = card(36, 44, 568, 312)
cols = [V, C, G, P]
r = rng(5)
for row in range(4):
    for i in range(16):
        on = (row == 0 and i in (0, 5, 8, 13)) or (row == 1 and i in (4, 12)) or (row == 2 and i % 2 == 0) or (row == 3 and i in (6, 14))
        x = 60 + i * 32.5; y = 82 + row * 62
        if on:
            b += f'<rect x="{x}" y="{y}" width="26" height="50" rx="7" fill="{cols[row]}"/><rect x="{x}" y="{y}" width="26" height="50" rx="7" fill="{cols[row]}" opacity=".5" filter="url(#bl)"/>'
        else:
            b += f'<rect x="{x}" y="{y}" width="26" height="50" rx="7" fill="#fff" fill-opacity="{.09 if i % 4 == 0 else .05}"/>'
b += '<rect x="60" y="74" width="26" height="268" rx="9" fill="none" stroke="#fff" stroke-opacity=".9" stroke-width="2" transform="translate(162 0)"/>'
frame('loops', V, b.replace('filter="url(#bl)"', ''), (0.3, 0.9))

# 3 Voice recorder
b = card(36, 44, 568, 312)
b += bars(70, 570, 200, 70, 9, R if False else P, step=7, w=3.6, env=lambda t: math.sin(t * math.pi) ** 0.7)
b += f'<circle cx="320" cy="200" r="54" fill="#0d0f24" stroke="{P}" stroke-width="3"/><rect x="304" y="164" width="32" height="54" rx="16" fill="{P}"/><path d="M296 202a24 24 0 0048 0M320 226v16M304 242h32" stroke="{P}" stroke-width="4" fill="none" stroke-linecap="round"/>'
b += f'<circle cx="82" cy="76" r="8" fill="#ff5470"/><rect x="100" y="70" width="64" height="12" rx="6" fill="#fff" fill-opacity=".25"/>'
b += ''.join(f'<rect x="{90 + i * 74}" y="318" width="56" height="10" rx="5" fill="{P if i < 3 else "#fff"}" fill-opacity="{.8 if i < 3 else .15}"/>' for i in range(7))
frame('record', P, b, (0.5, 0.5))

# 4 Keys: piano with highlighted chord
b = card(36, 44, 568, 312)
wk = 12; kw = 568 / wk - 8
whites = list(range(wk)); chord = {0, 2, 4, 7, 9}
for i in whites:
    x = 52 + i * (kw + 6.4)
    on = i in (0, 2, 4)
    b += f'<rect x="{x:.1f}" y="130" width="{kw:.1f}" height="206" rx="7" fill="{V if on else "#ecebff"}" fill-opacity="{1 if on else .92}"/>'
for i in (0, 1, 3, 4, 5, 7, 8, 10):
    x = 52 + (i + 1) * (kw + 6.4) - 13
    b += f'<rect x="{x:.1f}" y="130" width="26" height="124" rx="5" fill="#0b0c1c"/>'
b += ''.join(f'<rect x="{60 + i * 92}" y="68" width="76" height="34" rx="17" fill="{c}" fill-opacity="{o}"/>' for i, (c, o) in enumerate([(V, .9), (C, .5), (G, .5), (P, .5), (V, .3), (C, .3)]))
frame('keys', V, b, (0.2, 0.2))

# 5 Audio editor: big waveform with selection
b = card(36, 44, 568, 312)
b += bars(56, 584, 190, 108, 21, C, step=5, w=3, op=.85, env=lambda t: .35 + .65 * abs(math.sin(t * 9)) ** .8)
b += f'<rect x="250" y="62" width="190" height="256" fill="{C}" fill-opacity=".16"/><rect x="249" y="62" width="3" height="256" fill="{C}"/><rect x="438" y="62" width="3" height="256" fill="{C}"/>'
b += f'<rect x="240" y="300" width="22" height="24" rx="6" fill="{C}"/><rect x="428" y="300" width="22" height="24" rx="6" fill="{C}"/>'
b += '<g stroke="#fff" stroke-opacity=".14"><line x1="56" y1="190" x2="584" y2="190"/></g>'
b += f'<path d="M56 334h528" stroke="#fff" stroke-opacity=".12"/>' + ''.join(f'<rect x="{56 + i * 88}" y="338" width="2" height="8" fill="#fff" fill-opacity=".3"/>' for i in range(7))
frame('editor', C, b)

# 6 Video editor: preview frame + filmstrip
b = card(36, 44, 568, 312)
b += f'<rect x="64" y="66" width="512" height="190" rx="12" fill="#0a0b19"/><rect x="64" y="66" width="512" height="190" rx="12" fill="{C}" fill-opacity=".10"/>'
b += f'<path d="M0 0" /><path d="M64 214c90-70 150-20 230-52s150 40 282-26v120H64z" fill="{C}" fill-opacity=".22"/><path d="M64 236c110-48 190 4 280-22s150 20 232-6v48H64z" fill="{V}" fill-opacity=".32"/>'
b += f'<circle cx="320" cy="161" r="32" fill="#fff" fill-opacity=".95"/><path d="M312 145l26 16-26 16z" fill="#0b0c1c"/>'
b += f'<rect x="84" y="86" width="120" height="14" rx="7" fill="#fff" fill-opacity=".9"/>'
for i in range(8):
    x = 64 + i * 65
    b += f'<rect x="{x}" y="272" width="58" height="62" rx="7" fill="{[V, C, P, G][i % 4]}" fill-opacity="{.22 + .05 * (i % 3)}" stroke="#fff" stroke-opacity=".12"/>'
b += f'<rect x="{64 + 3 * 65 - 3}" y="266" width="3" height="74" fill="#fff"/><rect x="64" y="338" width="{3 * 65}" height="4" rx="2" fill="{C}"/>'
frame('video', C, b, (0.8, 0.1))

# 7 Mastering: loudness meters
b = card(36, 44, 568, 312)
r = rng(3)
for i in range(30):
    x = 70 + i * 17; h = 40 + 150 * abs(math.sin(i * .5 + .6)) ** .8 * (.5 + r() * .5)
    for j in range(int(h // 10)):
        col = '#ff5470' if j > 15 else (A if j > 11 else C)
        b += f'<rect x="{x}" y="{330 - j * 10 - 7:.0f}" width="12" height="7" rx="2" fill="{col}" fill-opacity=".9"/>'
b += f'<path d="M70 150H584" stroke="#fff" stroke-opacity=".5" stroke-dasharray="6 6"/><rect x="474" y="62" width="110" height="44" rx="22" fill="#0d0f24" stroke="{C}" stroke-width="2"/><text x="529" y="92" text-anchor="middle" font-family="system-ui,sans-serif" font-size="22" font-weight="700" fill="#fff">-14 LUFS</text>'
frame('master', C, b, (0.85, 0.15))

# 8 Converter: file cards
b = card(36, 44, 568, 312)
def file(x, y, label, col):
    return f'<rect x="{x}" y="{y}" width="150" height="190" rx="14" fill="#0d0f24" stroke="{col}" stroke-width="2.5"/>' + bars(x + 18, x + 132, y + 76, 36, sum(map(ord, label)) % 90, col, step=7, w=3.4) + f'<rect x="{x + 18}" y="{y + 134}" width="{114}" height="34" rx="17" fill="{col}"/><text x="{x + 75}" y="{y + 157}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="20" font-weight="800" fill="#0b0c1c">{label}</text>'
b += file(88, 100, 'WAV', V) + file(402, 100, 'MP3', C)
b += f'<path d="M262 196h112" stroke="#fff" stroke-width="5" stroke-linecap="round"/><path d="M350 172l28 24-28 24" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
frame('convert', C, b, (0.5, 0.9))

# 9 DJ: decks
b = card(36, 44, 568, 312)
for cx, col in ((178, P), (462, C)):
    b += f'<circle cx="{cx}" cy="186" r="102" fill="#0b0c1c" stroke="{col}" stroke-opacity=".6" stroke-width="2"/>'
    b += ''.join(f'<circle cx="{cx}" cy="186" r="{r_}" fill="none" stroke="#fff" stroke-opacity=".07"/>' for r_ in (84, 68, 52))
    b += f'<circle cx="{cx}" cy="186" r="30" fill="{col}"/><circle cx="{cx}" cy="186" r="5" fill="#0b0c1c"/><path d="M{cx} 96A90 90 0 0 1 {cx + 78} 141" stroke="{col}" stroke-width="5" fill="none" stroke-linecap="round"/>'
b += bars(60, 260, 322, 14, 31, P, step=5, w=2.6) + bars(380, 580, 322, 14, 32, C, step=5, w=2.6)
b += f'<rect x="272" y="96" width="96" height="190" rx="12" fill="#0d0f24" stroke="#fff" stroke-opacity=".14"/>' + ''.join(f'<rect x="{286 + i * 24}" y="{112 + (i * 37) % 60}" width="10" height="{120 - (i * 37) % 60}" rx="5" fill="#fff" fill-opacity=".12"/><rect x="{282 + i * 24}" y="{150 + (i * 53) % 70}" width="18" height="12" rx="4" fill="{[P, A, C][i % 3]}"/>' for i in range(3))
b += f'<rect x="288" y="300" width="64" height="12" rx="6" fill="#fff" fill-opacity=".14"/><rect x="306" y="296" width="20" height="20" rx="5" fill="#fff"/>'
frame('dj', P, b, (0.5, 0.1))

# 10 BPM and key
b = card(36, 44, 568, 312)
b += f'<circle cx="230" cy="200" r="104" fill="none" stroke="{P}" stroke-opacity=".25" stroke-width="3"/><circle cx="230" cy="200" r="84" fill="none" stroke="{P}" stroke-opacity=".45" stroke-width="3"/><circle cx="230" cy="200" r="64" fill="#0d0f24" stroke="{P}" stroke-width="4"/>'
b += f'<text x="230" y="212" text-anchor="middle" font-family="system-ui,sans-serif" font-size="46" font-weight="800" fill="#fff">128</text><text x="230" y="238" text-anchor="middle" font-family="system-ui,sans-serif" font-size="16" fill="#fff" fill-opacity=".7">BPM</text>'
for k, (lab, col) in enumerate([('8A', C), ('9A', P), ('7A', G)]):
    b += f'<rect x="394" y="{100 + k * 76}" width="150" height="58" rx="29" fill="{col}" fill-opacity="{1 if k == 0 else .22}" stroke="{col}"/><text x="469" y="{138 + k * 76}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="28" font-weight="800" fill="{"#0b0c1c" if k == 0 else "#fff"}">{lab}</text>'
b += ''.join(f'<rect x="{100 + i * 28}" y="326" width="14" height="{6 + (12 if i % 4 == 0 else 0)}" rx="3" fill="{P}" fill-opacity="{1 if i % 4 == 0 else .5}"/>' for i in range(10))
frame('bpm', P, b, (0.3, 0.3))

# 11 Learn to DJ: two waves aligning
b = card(36, 44, 568, 312)
b += bars(64, 576, 140, 44, 41, P, step=6, w=3.2, op=.95) + bars(64, 576, 260, 44, 41, C, step=6, w=3.2, op=.95)
b += f'<g stroke="#fff" stroke-opacity=".5" stroke-dasharray="4 6">' + ''.join(f'<line x1="{x}" y1="80" x2="{x}" y2="320"/>' for x in (160, 288, 416, 544)) + '</g>'
b += f'<rect x="258" y="190" width="124" height="40" rx="20" fill="{G}"/><text x="320" y="217" text-anchor="middle" font-family="system-ui,sans-serif" font-size="20" font-weight="800" fill="#0b0c1c">In sync</text>'
frame('lessons', G, b, (0.5, 0.5))

# 12 Learn music: staff and notes
b = card(36, 44, 568, 312)
b += ''.join(f'<line x1="70" y1="{110 + i * 22}" x2="570" y2="{110 + i * 22}" stroke="#fff" stroke-opacity=".5" stroke-width="2"/>' for i in range(5))
b += f'<rect x="72" y="110" width="4" height="88" fill="{G}"/><text x="96" y="150" font-family="system-ui,sans-serif" font-size="44" font-weight="800" fill="{G}">4</text><text x="96" y="196" font-family="system-ui,sans-serif" font-size="44" font-weight="800" fill="{G}">4</text>'
for i, (x, y) in enumerate([(220, 176), (290, 154), (360, 132), (430, 154), (500, 110)]):
    b += f'<ellipse cx="{x}" cy="{y}" rx="13" ry="10" transform="rotate(-20 {x} {y})" fill="{G}"/><rect x="{x + 11}" y="{y - 52}" width="3" height="52" fill="{G}"/>'
b += ''.join(f'<rect x="{70 + i * 62}" y="290" width="48" height="30" rx="8" fill="{G}" fill-opacity="{.9 if i in (0, 2, 4) else .2}"/>' for i in range(8))
frame('learn', G, b, (0.85, 0.85))
print('ok')
