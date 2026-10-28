/* GoVibe Mix — the Audio page: one file, three ways to work. Auto listens to the file on this device and picks the steps. Guided lets you choose a job and the steps. Pro opens the full Audio Editor. Steps run in a fixed order and nothing leaves the device. */
(() => {
  const Q = window.GVQuick, M = window.GVMaster, $ = (id) => document.getElementById(id), say = (t) => { $('status').textContent = t; };
  let buf = null, name = 'audio', file = null, found = null, before = null, src = null; const result = { a: null, g: null };
  const STEPS = ['denoise', 'rumble', 'silence', 'trim', 'mono', 'tone', 'loud', 'fade'];
  const RECIPES = {
    podcast: { label: 'Podcast or voice cleanup', info: 'Removes background noise, cuts low rumble, trims long pauses, mixes to mono and levels the voice to about minus 16 LUFS.', on: { denoise: 1, rumble: 1, silence: 1, mono: 1, loud: 1 }, set: { dn: '0.8', hp: '80', sil: 'normal', loud: '-16' } },
    note: { label: 'Voice note or lecture', info: 'Trims the gaps, makes it louder and clearer, and saves a mono file.', on: { rumble: 1, silence: 1, mono: 1, loud: 1 }, set: { hp: '100', sil: 'tight', loud: '-16' } },
    music: { label: 'Release ready music', info: 'Adds a short fade and masters to minus 14 LUFS with a true peak limit, the level most streaming services use.', on: { loud: 1, fade: 1 }, set: { loud: '-14', fin: '0.05', fout: '2' } },
    ringtone: { label: 'Ringtone or sample', info: 'Takes a short piece from the start point you choose, fades it in and out and levels it.', on: { trim: 1, fade: 1, loud: 1 }, set: { tstart: '0', tlen: '30', fin: '0.3', fout: '1.5', loud: 'peak' } },
    quiet: { label: 'Fix a quiet recording', info: 'Cuts rumble, reduces noise and raises the level without clipping.', on: { denoise: 1, rumble: 1, loud: 1 }, set: { dn: '0.5', hp: '60', loud: 'peak' } },
    custom: { label: 'Choose my own steps', info: 'Tick any steps below. They always run in the order shown.', on: {}, set: {} },
  };
  /* ---------- the steps ---------- */
  function highpass(x, fs, f0) { const w = 2 * Math.PI * f0 / fs, cs = Math.cos(w), al = Math.sin(w) / (2 * 0.7071), a0 = 1 + al, b0 = (1 + cs) / 2 / a0, b1 = -(1 + cs) / a0, b2 = b0, a1 = -2 * cs / a0, a2 = (1 - al) / a0, y = new Float32Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0; for (let i = 0; i < x.length; i++) { const xi = x[i], yi = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = xi; y2 = y1; y1 = yi; y[i] = yi; } return y; }
  const SIL = { gentle: { thr: -50, min: 0.8, pad: 0.2 }, normal: { thr: -45, min: 0.5, pad: 0.12 }, tight: { thr: -40, min: 0.3, pad: 0.08 } };
  function removeSilence(chs, fs, p) {
    const n = chs[0].length, w = Math.max(1, Math.round(fs * 0.01)), k = Math.ceil(n / w), thr = Math.pow(10, p.thr / 20), quiet = new Uint8Array(k);
    for (let j = 0; j < k; j++) { let m = 0; for (const c of chs) for (let i = j * w; i < Math.min(n, (j + 1) * w); i += 2) { const v = Math.abs(c[i]); if (v > m) m = v; } quiet[j] = m < thr ? 1 : 0; }
    const minW = Math.round(p.min * fs / w), padW = Math.round(p.pad * fs / w), cuts = []; for (let j = 0; j < k;) { if (!quiet[j]) { j++; continue; } let e = j; while (e < k && quiet[e]) e++; if (e - j >= minW && e - j > 2 * padW) cuts.push([j + padW, e - padW]); j = e; }
    const keep = []; let at = 0; cuts.forEach(([a, e]) => { keep.push([at * w, a * w]); at = e; }); keep.push([at * w, n]);
    const kp = keep.filter(([a, e]) => e > a), len = kp.reduce((s, [a, e]) => s + Math.min(e, n) - a, 0);
    return { chs: chs.map((c) => { const o = new Float32Array(len); let q = 0; kp.forEach(([a, e]) => { const s = c.subarray(a, Math.min(e, n)); o.set(s, q); q += s.length; }); return o; }), cuts: cuts.length };
  }
  function levels(chs, fs) { // quiet and loud frame levels (peak, in dB) to match the silence step, ignoring digital silence
    const n = chs[0].length, w = Math.max(1, Math.round(fs * 0.01)), k = Math.floor(n / w), live = []; for (let j = 0; j < k; j++) { let m = 0; for (const d of chs) for (let i = j * w; i < (j + 1) * w; i += 2) { const v = Math.abs(d[i]); if (v > m) m = v; } const db = 20 * Math.log10(m + 1e-9); if (db > -70) live.push(db); }
    live.sort((a, b) => a - b); return live.length ? { floor: live[Math.floor(live.length * 0.1)], top: live[Math.min(live.length - 1, Math.floor(live.length * 0.95))] } : { floor: -100, top: -100 };
  }
  const defaults = () => ({ on: Object.fromEntries(STEPS.map((s) => [s, false])), dn: 0.8, hp: 80, sil: 'normal', tstart: 0, tlen: 0, bass: 0, treble: 0, loud: '-16', fin: 0, fout: 0 });
  const cfg = () => ({ on: Object.fromEntries(STEPS.map((s) => [s, $('on-' + s).checked])), dn: +$('dn').value, hp: +$('hp').value, sil: $('sil').value, tstart: +$('tstart').value || 0, tlen: +$('tlen').value || 0, bass: +$('bass').value, treble: +$('treble').value, loud: $('loud').value, fin: +$('fin').value || 0, fout: +$('fout').value || 0 });
  async function run(chs, fs, c, prog) {
    const notes = []; let x = chs.map((d) => d.slice());
    if (c.on.denoise) { prog('Reducing background noise…'); x = await GVDenoise.run(x, fs, c.dn, (p) => prog('Reducing background noise… ' + Math.round(p * 100) + '%')); notes.push('noise reduced'); }
    if (c.on.rumble) { prog('Cutting low rumble…'); x = x.map((d) => highpass(d, fs, c.hp)); notes.push('rumble cut below ' + c.hp + ' Hz'); }
    if (c.on.silence) { prog('Removing silence…'); const base = SIL[c.sil], lv = c.rel ? levels(x, fs) : null, p = lv && lv.top - lv.floor > 20 ? { ...base, thr: Math.min(base.thr + 12, Math.max(base.thr, lv.floor + 6)) } : base; const r = removeSilence(x, fs, p); x = r.chs; notes.push(r.cuts + ' silent gap' + (r.cuts === 1 ? '' : 's') + ' removed'); }
    if (c.on.trim) { const a = Math.min(x[0].length, Math.round(c.tstart * fs)), b = c.tlen > 0 ? Math.min(x[0].length, a + Math.round(c.tlen * fs)) : x[0].length; x = x.map((d) => d.slice(a, b)); notes.push('kept ' + ((b - a) / fs).toFixed(1) + ' s from ' + c.tstart + ' s'); }
    if (c.on.mono && x.length > 1) { const m = new Float32Array(x[0].length); for (let i = 0; i < m.length; i++) m[i] = (x[0][i] + x[1][i]) / 2; x = [m]; notes.push('mono'); }
    if (c.on.tone && (c.bass || c.treble)) { x = x.map((d) => M.shelf(M.shelf(d, fs, 'low', 100, c.bass), fs, 'high', 8000, c.treble)); notes.push('bass ' + c.bass + ' dB, treble ' + c.treble + ' dB'); }
    if (c.on.loud && x[0].length > fs * 0.2) {
      prog('Setting the level…');
      if (c.loud === 'peak') { const pk = M.samplePeak(x), k = pk > 1e-6 ? Math.pow(10, -1 / 20) / pk : 1; x = x.map((d) => { const o = new Float32Array(d.length); for (let i = 0; i < d.length; i++) o[i] = d[i] * k; return o; }); notes.push('peak set to −1 dB'); }
      else { await new Promise((r) => setTimeout(r, 20)); const r = M.master(x, fs, { targetLufs: +c.loud, ceiling: -1, glue: 0 }); x = r.chans; notes.push('leveled to ' + c.loud + ' LUFS'); }
    }
    if (c.on.fade && (c.fin || c.fout)) { const n = x[0].length, fi = Math.min(Math.round(c.fin * fs), n >> 1), fo = Math.min(Math.round(c.fout * fs), n >> 1); x.forEach((d) => { for (let i = 0; i < fi; i++) d[i] *= i / fi; for (let i = 0; i < fo; i++) d[n - 1 - i] *= i / fo; }); notes.push('fades added'); }
    return { chs: x, notes };
  }

  /* ---------- listening to the file (Auto) ---------- */
  const chansOf = (b) => [...Array(b.numberOfChannels)].map((_, i) => b.getChannelData(i));
  const meters = (chs, fs) => { const a = M.analyze(chs, fs); return { dur: a.seconds, lufs: isFinite(a.lufs) ? a.lufs : null, tp: isFinite(a.truePeakDb) ? a.truePeakDb : null, ch: chs.length }; };
  const pct = (arr, q) => { const s = Array.from(arr).sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
  function listen(chs, fs) {
    const n = chs[0].length, w = Math.max(1, Math.round(fs * 0.01)), k = Math.floor(n / w), db = new Float32Array(k);
    for (let j = 0; j < k; j++) { let s = 0, c = 0; for (let i = j * w; i < (j + 1) * w; i += 2) { let v = 0; for (const d of chs) v += d[i]; v /= chs.length; s += v * v; c++; } db[j] = 10 * Math.log10(s / c + 1e-12); }
    const live = Array.from(db).filter((v) => v > -70), floor = live.length ? pct(live, 0.1) : -100, top = live.length ? pct(live, 0.95) : -100, mean = live.reduce((a, b) => a + b, 0) / Math.max(1, live.length), sd = Math.sqrt(live.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, live.length));
    const quietFrac = Array.from(db).filter((v) => v < top - 25).length / Math.max(1, k);
    const noisy = live.length > 0 && floor > -52 && top - floor < 38, qthr = noisy ? floor + 8 : -45; // a noisy recording has no true silence, so judge pauses against its own background level
    let run = 0, longest = 0, silent = 0; for (let j = 0; j < k; j++) { if (db[j] < qthr) { run++; } else { if (run * 0.01 >= 0.5) silent += run; longest = Math.max(longest, run); run = 0; } } if (run * 0.01 >= 0.5) silent += run; longest = Math.max(longest, run);
    let clip = 0; for (const d of chs) for (let i = 0; i < n; i += 1) if (Math.abs(d[i]) > 0.999) clip++; const clipFrac = clip / (n * chs.length);
    let side = 0, tot = 0; if (chs.length > 1) for (let i = 0; i < n; i += 5) { const m = (chs[0][i] + chs[1][i]) / 2, s = (chs[0][i] - chs[1][i]) / 2; tot += m * m + s * s; side += s * s; }
    let lo = 0, all = 0, y = 0; const a = 1 - Math.exp(-2 * Math.PI * 60 / fs); for (let i = 0; i < n; i += 1) { const v = chs[0][i]; y += a * (v - y); lo += y * y; all += v * v; }
    const m = meters(chs, fs);
    return { lufs: m.lufs, tp: m.tp, dur: m.dur, ch: chs.length, floor, top, noisy, silentSec: silent * 0.01, longestSilence: longest * 0.01, silentFrac: silent / Math.max(1, k), clipFrac, nearMono: chs.length > 1 && tot > 0 && side / tot < 0.02, rumble: all > 0 && lo / all > 0.2, speechLike: quietFrac > 0.12 || sd > 9 };
  }
  function plan(f, kind) { // returns { cfg, why: [..] } for what Auto will do
    const c = defaults(), why = [], speech = kind === 'speech';
    if (f.noisy && speech) { c.on.denoise = true; c.dn = f.top - f.floor < 20 ? 1 : 0.8; why.push('Reduce the background noise (the quietest parts sit at ' + f.floor.toFixed(0) + ' dB, not near silence).'); }
    if (speech && f.rumble) { c.on.rumble = true; c.hp = 80; why.push('Cut the low rumble below 80 Hz.'); }
    if (f.silentFrac > 0.08 || f.longestSilence > 1.5) { if (speech) { c.on.silence = true; c.rel = f.noisy; c.sil = f.silentFrac > 0.3 ? 'tight' : 'normal'; why.push('Remove the long silences (' + f.silentSec.toFixed(1) + ' s of the file is quiet).'); } }
    if (f.ch > 1 && (f.nearMono || speech)) { c.on.mono = true; why.push(f.nearMono ? 'Save it as mono, since both sides are almost the same.' : 'Save it as mono, which suits a voice recording.'); }
    const target = speech ? -16 : -14;
    if (f.lufs != null && (Math.abs(f.lufs - target) > 1.5 || (f.tp != null && f.tp > -0.5))) { c.on.loud = true; c.loud = String(target); why.push('Set the loudness to ' + target + ' LUFS' + (f.lufs < target ? ' (it is ' + f.lufs.toFixed(1) + ' now, so it will be louder).' : ' (it is ' + f.lufs.toFixed(1) + ' now, so it will be turned down).')); }
    return { cfg: c, why };
  }
  const f1 = (v, u) => (v == null ? '—' : v.toFixed(1) + ' ' + u);
  function findings(f) {
    const rows = [['Sounds like', f.speechLike ? 'speech or a recording with pauses' : 'continuous music or sound'], ['Loudness', f1(f.lufs, 'LUFS')], ['Loudest peak', f1(f.tp, 'dBTP') + (f.tp != null && f.tp > -0.5 ? ' (very close to the top)' : '')], ['Background level', f.kind !== 'speech' ? 'not checked for music' : f.noisy ? 'noticeable (' + f.floor.toFixed(0) + ' dB)' : 'clean'], ['Silence', f.silentSec > 0 ? f.silentSec.toFixed(1) + ' s in gaps of half a second or more' : 'none long enough to matter'], ['Channels', f.ch > 1 ? (f.nearMono ? 'stereo, almost mono' : 'stereo') : 'mono']];
    if (f.clipFrac > 0.0005) rows.push(['Clipping', 'some peaks are flat at full level. This cannot be undone, only avoided from here on.']); return rows;
  }
  function showFindings() {
    const kind = $('akind').value === 'auto' ? (found.speechLike ? 'speech' : 'music') : $('akind').value; found.kind = kind; const p = plan(found, kind); found.plan = p;
    $('afind').innerHTML = findings(found).map(([k, v]) => '<tr><th scope="row">' + k + '</th><td>' + v + '</td></tr>').join('');
    const ul = $('aplan'); ul.innerHTML = ''; (p.why.length ? p.why : ['Nothing is needed. This file already looks good.']).forEach((t) => { const li = document.createElement('li'); li.textContent = t; ul.appendChild(li); });
    $('ago').disabled = !p.why.length; $('ago').textContent = p.why.length ? 'Make it better' : 'Nothing to do';
  }
  $('akind').addEventListener('change', () => { if (found) showFindings(); });

  /* ---------- shared: loading, results, saving ---------- */
  async function open(f) {
    try { say('Reading ' + f.name + '…'); stopPlay(); buf = await Q.decode(f); } catch (e) { return say('Could not read that file: ' + ((e && e.message) || 'unknown error') + ' Try an MP3 or WAV.'); }
    file = f; name = Q.clean(f.name); result.a = result.g = null; ['a', 'g'].forEach((p) => $(p + 'res').classList.add('hidden'));
    $('fname').textContent = name + ' · ' + Q.fmt(buf.duration) + ', ' + buf.numberOfChannels + (buf.numberOfChannels > 1 ? ' channels' : ' channel') + ', ' + buf.sampleRate + ' Hz'; $('rmain').classList.remove('hidden'); $('rdrop').classList.add('hidden');
    say('Listening to the file…'); setTimeout(() => { try { found = listen(chansOf(buf), buf.sampleRate); before = found; table('g', found, null); table('a', found, null); showFindings(); pick($('recipe').value); say('Ready. Auto has a suggestion, or switch tabs to choose for yourself.'); } catch (e) { say('The file opened, but listening to it failed: ' + ((e && e.message) || 'error') + ' Use the Guided or Pro tab instead.'); } }, 30);
  }
  Q.hook($('rdrop'), open);
  function table(p, b, a) { const row = (l, x, y) => '<tr><th scope="row">' + l + '</th><td>' + x + '</td><td>' + y + '</td></tr>'; $(p + 'cmp').innerHTML = '<thead><tr><th scope="col">Measure</th><th scope="col">Before</th><th scope="col">After</th></tr></thead><tbody>' + row('Length', Q.fmt(b.dur), a ? Q.fmt(a.dur) : '—') + row('Channels', b.ch, a ? a.ch : '—') + row('Loudness', f1(b.lufs, 'LUFS'), a ? f1(a.lufs, 'LUFS') : '—') + row('True peak', f1(b.tp, 'dBTP'), a ? f1(a.tp, 'dBTP') : '—') + '</tbody>'; }
  async function apply(p, c) {
    if (!buf) return null; const btn = p === 'a' ? $('ago') : $('rgo'); btn.disabled = true; stopPlay();
    try {
      const out = await run(chansOf(buf), buf.sampleRate, c, say); if (!out.chs[0].length) throw new Error('Nothing is left after those steps.');
      result[p] = { chs: out.chs, rate: buf.sampleRate, notes: out.notes, label: p === 'a' ? 'auto' : RECIPES[$('recipe').value].label.split(' ')[0].toLowerCase() }; table(p, before, meters(out.chs, buf.sampleRate)); $(p + 'res').classList.remove('hidden');
      $(p + 'done').textContent = out.notes.length ? 'Done: ' + out.notes.join(', ') + '.' : 'No steps were selected, so the file is unchanged.'; say('Done. Compare the numbers, preview it, then save.');
    } catch (e) { say('Could not finish: ' + e.message); }
    btn.disabled = false; return result[p];
  }
  $('ago').onclick = () => apply('a', found.plan.cfg); $('rgo').onclick = () => apply('g', cfg());
  function stopPlay() { try { src && src.stop(); } catch (_) { /* ended */ } src = null; ['a', 'g'].forEach((p) => ($(p + 'play').textContent = '▶ Preview result')); }
  function play(p, orig) {
    if (src) return stopPlay(); const c = Q.AC(); c.resume(); let b = buf, r = result[p]; if (!orig && r) { b = c.createBuffer(r.chs.length, r.chs[0].length, r.rate); r.chs.forEach((d, i) => b.copyToChannel(d, i)); }
    src = c.createBufferSource(); src.buffer = b; src.connect(c.destination); src.start(); $(p + 'play').textContent = '❚❚ Stop'; src.onended = () => { src = null; $(p + 'play').textContent = '▶ Preview result'; };
  }
  ['a', 'g'].forEach((p) => {
    $(p + 'play').onclick = () => play(p, false); $(p + 'playo').onclick = () => { stopPlay(); play(p, true); };
    $(p + 'save').onclick = async () => { const r = result[p]; if (!r) return; $(p + 'save').disabled = true; try { const f = $(p + 'fmt').value, blob = await Q.encode(r.chs, r.rate, f, 192, (x) => say('Encoding MP3… ' + Math.round(x * 100) + '%')); Q.save(blob, name + ' (' + r.label + ').' + f); say('Saved.'); } catch (e) { say('Could not save: ' + e.message); } $(p + 'save').disabled = false; };
  });
  $('again').onclick = () => { stopPlay(); buf = null; found = null; result.a = result.g = null; $('rmain').classList.add('hidden'); $('rdrop').classList.remove('hidden'); say(''); };

  /* ---------- Guided ---------- */
  function setSteps(c) { STEPS.forEach((s) => { $('on-' + s).checked = !!c.on[s]; }); $('dn').value = String(c.dn); $('hp').value = String(c.hp); $('sil').value = c.sil; $('tstart').value = c.tstart; $('tlen').value = c.tlen; $('bass').value = c.bass; $('treble').value = c.treble; $('loud').value = c.loud; $('fin').value = c.fin; $('fout').value = c.fout; }
  function pick(k) { const r = RECIPES[k], c = defaults(); Object.keys(r.on).forEach((s) => { c.on[s] = true; }); const S = r.set; if (S.dn) c.dn = +S.dn; if (S.hp) c.hp = +S.hp; if (S.sil) c.sil = S.sil; if (S.tstart != null) c.tstart = +S.tstart; if (S.tlen != null) c.tlen = +S.tlen; if (S.loud) c.loud = S.loud; if (S.fin != null) c.fin = +S.fin; if (S.fout != null) c.fout = +S.fout; $('rinfo').textContent = r.info; setSteps(c); }
  $('recipe').addEventListener('change', () => pick($('recipe').value));
  $('atoguided').onclick = () => { if (!found) return; setSteps(found.plan.cfg); $('recipe').value = 'custom'; $('rinfo').textContent = 'These are the steps Auto chose. Change anything you like.'; document.getElementById('tab-g').click(); };

  /* ---------- Pro ---------- */
  $('topro').onclick = async () => { if (!file) return; try { await GVStore.put('handoff', new Blob([file], { type: file.type || 'audio/wav' })); location.href = 'editor.html?from=audio&name=' + encodeURIComponent(name); } catch (_) { say('Could not hand the file over. Open the Audio Editor and choose the file there.'); } };
  if (/[?&]gvtest\b/.test(location.search)) window.__aud = { open, apply, run, listen, plan, removeSilence, cfg, pick, setSteps, get found() { return found; }, get result() { return result; }, get buf() { return buf; } };
})();
