/* GoVibe Mix — audio recipes: pick a job (podcast cleanup, release ready music, ringtone and so on), tick the steps you want, and one pass runs them in a fixed order. Shows loudness and peak before and after. Everything runs on this device. */
(() => {
  const Q = window.GVQuick, M = window.GVMaster, $ = (id) => document.getElementById(id), say = (t) => { $('status').textContent = t; };
  let buf = null, name = 'audio', result = null, src = null;
  const STEPS = ['denoise', 'rumble', 'silence', 'trim', 'mono', 'tone', 'loud', 'fade'];
  const RECIPES = {
    podcast: { label: 'Podcast or voice cleanup', info: 'Removes background noise, cuts low rumble, trims long pauses, mixes to mono and levels the voice to about minus 16 LUFS.', on: { denoise: 1, rumble: 1, silence: 1, mono: 1, loud: 1 }, set: { dn: '0.8', hp: '80', sil: 'normal', loud: '-16', mono: 1 } },
    note: { label: 'Voice note or lecture', info: 'Trims the gaps, makes it louder and clearer, and saves a mono file.', on: { rumble: 1, silence: 1, mono: 1, loud: 1 }, set: { hp: '100', sil: 'tight', loud: '-16', mono: 1 } },
    music: { label: 'Release ready music', info: 'Trims the ends, adds a fade and masters to minus 14 LUFS with a true peak limit, the level most streaming services use.', on: { loud: 1, fade: 1 }, set: { loud: '-14', fin: '0.05', fout: '2' } },
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
  const cfg = () => ({ on: Object.fromEntries(STEPS.map((s) => [s, $('on-' + s).checked])), dn: +$('dn').value, hp: +$('hp').value, sil: $('sil').value, tstart: +$('tstart').value || 0, tlen: +$('tlen').value || 0, bass: +$('bass').value, treble: +$('treble').value, loud: $('loud').value, fin: +$('fin').value || 0, fout: +$('fout').value || 0 });
  async function run(chs, fs, c, prog) {
    const notes = []; let x = chs.map((d) => d.slice());
    if (c.on.denoise) { prog('Reducing background noise…'); x = await GVDenoise.run(x, fs, c.dn, (p) => prog('Reducing background noise… ' + Math.round(p * 100) + '%')); notes.push('noise reduced'); }
    if (c.on.rumble) { prog('Cutting low rumble…'); x = x.map((d) => highpass(d, fs, c.hp)); notes.push('rumble cut below ' + c.hp + ' Hz'); }
    if (c.on.silence) { prog('Removing silence…'); const r = removeSilence(x, fs, SIL[c.sil]); x = r.chs; notes.push(r.cuts + ' silent gap' + (r.cuts === 1 ? '' : 's') + ' removed'); }
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
  /* ---------- page ---------- */
  const meters = (chs, fs) => { const a = M.analyze(chs, fs); return { dur: a.seconds, lufs: isFinite(a.lufs) ? a.lufs : null, tp: isFinite(a.truePeakDb) ? a.truePeakDb : null, ch: chs.length }; };
  const f1 = (v, u) => (v == null ? '—' : v.toFixed(1) + ' ' + u);
  function table(b, a) { const row = (l, x, y) => '<tr><th scope="row">' + l + '</th><td>' + x + '</td><td>' + y + '</td></tr>'; $('cmp').innerHTML = '<thead><tr><th scope="col">Measure</th><th scope="col">Before</th><th scope="col">After</th></tr></thead><tbody>' + row('Length', Q.fmt(b.dur), a ? Q.fmt(a.dur) : '—') + row('Channels', b.ch, a ? a.ch : '—') + row('Loudness', f1(b.lufs, 'LUFS'), a ? f1(a.lufs, 'LUFS') : '—') + row('True peak', f1(b.tp, 'dBTP'), a ? f1(a.tp, 'dBTP') : '—') + '</tbody>'; }
  let before = null;
  async function open(f) {
    try { say('Reading ' + f.name + '…'); stopPlay(); buf = await Q.decode(f); } catch (_) { return say('Could not read that file. Try an MP3, WAV, OGG or M4A.'); }
    name = Q.clean(f.name); result = null; before = meters(chansOf(buf), buf.sampleRate); table(before, null); $('rmain').classList.remove('hidden'); $('rdrop').classList.add('hidden'); $('rres').classList.add('hidden'); say(name + ' · ' + Q.fmt(buf.duration) + '. Pick a job below.'); pick($('recipe').value);
  }
  const chansOf = (b) => [...Array(b.numberOfChannels)].map((_, i) => b.getChannelData(i));
  Q.hook($('rdrop'), open);
  function pick(k) {
    const r = RECIPES[k]; $('rinfo').textContent = r.info; STEPS.forEach((s) => { $('on-' + s).checked = !!r.on[s]; });
    const S = r.set, v = (id, val) => { if (val != null) $(id).value = val; }; v('dn', S.dn); v('hp', S.hp); v('sil', S.sil); v('tstart', S.tstart); v('tlen', S.tlen); v('loud', S.loud); v('fin', S.fin); v('fout', S.fout); if (k !== 'custom') { v('bass', 0); v('treble', 0); }
    if (S.tstart == null) { $('tstart').value = 0; $('tlen').value = 0; } if (S.fin == null) { $('fin').value = 0; $('fout').value = 0; }
  }
  $('recipe').addEventListener('change', () => pick($('recipe').value));
  async function apply() {
    if (!buf) return; $('rgo').disabled = true; stopPlay();
    try {
      const out = await run(chansOf(buf), buf.sampleRate, cfg(), say); if (!out.chs[0].length) throw new Error('Nothing is left after those steps.');
      result = { chs: out.chs, rate: buf.sampleRate, notes: out.notes }; table(before, meters(out.chs, buf.sampleRate)); $('rres').classList.remove('hidden');
      $('rdone').textContent = out.notes.length ? 'Done: ' + out.notes.join(', ') + '.' : 'No steps were selected, so the file is unchanged.'; say('Done. Compare the numbers, preview it, then save.');
    } catch (e) { say('Could not finish: ' + e.message); }
    $('rgo').disabled = false; return result;
  }
  $('rgo').onclick = apply;
  function stopPlay() { try { src && src.stop(); } catch (_) { /* ended */ } src = null; $('rplay').textContent = '▶ Preview result'; }
  function play(orig) {
    if (src) return stopPlay(); const c = Q.AC(); c.resume(); let b = buf; if (!orig && result) { b = c.createBuffer(result.chs.length, result.chs[0].length, result.rate); result.chs.forEach((d, i) => b.copyToChannel(d, i)); }
    src = c.createBufferSource(); src.buffer = b; src.connect(c.destination); src.start(); $('rplay').textContent = '❚❚ Stop'; src.onended = () => { src = null; $('rplay').textContent = '▶ Preview result'; };
  }
  $('rplay').onclick = () => play(false); $('rplayo').onclick = () => { stopPlay(); play(true); };
  $('rsave').onclick = async () => { if (!result) return; $('rsave').disabled = true; try { const f = $('rfmt').value, blob = await Q.encode(result.chs, result.rate, f, 192, (p) => say('Encoding MP3… ' + Math.round(p * 100) + '%')); Q.save(blob, name + ' (' + RECIPES[$('recipe').value].label.split(' ')[0].toLowerCase() + ').' + f); say('Saved.'); } catch (e) { say('Could not save: ' + e.message); } $('rsave').disabled = false; };
  $('ragain').onclick = () => { stopPlay(); buf = null; result = null; $('rmain').classList.add('hidden'); $('rdrop').classList.remove('hidden'); say(''); };
  if (/[?&]gvtest\b/.test(location.search)) window.__rec = { open, apply, run, removeSilence, cfg, pick, get result() { return result; }, get before() { return before; } };
})();
