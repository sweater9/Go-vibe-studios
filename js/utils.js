/* GoVibe Mix — small audio utilities: silence remover, stereo and mono tools, tone generator, video to audio. One file, one page each (body data-tool). Everything runs on this device. */
(() => {
  const Q = window.GVQuick, $ = (id) => document.getElementById(id), say = (t) => { $('status').textContent = t; }, tool = document.body.dataset.tool;
  let buf = null, name = 'audio', src = null;
  const chansOf = (b) => [...Array(b.numberOfChannels)].map((_, i) => b.getChannelData(i));
  const finish = async (chs, rate, suffix) => { const f = $('ofmt').value, blob = await Q.encode(chs, rate, f, 192, (p) => say('Encoding MP3… ' + Math.round(p * 100) + '%')); Q.save(blob, name + suffix + '.' + f); return blob; };
  async function open(f) {
    try { say('Reading ' + f.name + '…'); buf = await Q.decode(f); } catch (_) { return say(tool === 'video' ? 'Could not read the sound of that file. Try an MP4, MOV, WebM or MKV that your browser can play.' : 'Could not read that file. Try an MP3, WAV, OGG or M4A.'); }
    name = Q.clean(f.name); $('main2').classList.remove('hidden'); $('drop').classList.add('hidden'); say(name + ' · ' + Q.fmt(buf.duration) + ', ' + buf.numberOfChannels + ' channel' + (buf.numberOfChannels > 1 ? 's' : '') + '.'); if (api.onOpen) api.onOpen();
  }
  const api = {};
  if ($('drop')) Q.hook($('drop'), open);
  if ($('again')) $('again').onclick = () => { buf = null; $('main2').classList.add('hidden'); $('drop').classList.remove('hidden'); say(''); };

  /* ---------- silence remover ---------- */
  if (tool === 'silence') {
    const P = () => ({ thr: +$('sthr').value, min: +$('smin').value, pad: +$('spad').value });
    const ro = () => { const p = P(); $('vthr').textContent = p.thr + ' dB'; $('vmin').textContent = p.min.toFixed(2) + ' s'; $('vpad').textContent = p.pad.toFixed(2) + ' s'; }; ['sthr', 'smin', 'spad'].forEach((i) => $(i).addEventListener('input', () => { ro(); if (buf) analyse(); })); ro();
    function regions(b, p) { // returns [start,end] sample ranges to KEEP
      const d = chansOf(b), r = b.sampleRate, w = Math.max(1, Math.round(r * 0.01)), n = Math.ceil(b.length / w), thr = Math.pow(10, p.thr / 20), quiet = new Uint8Array(n);
      for (let k = 0; k < n; k++) { let m = 0; for (const c of d) for (let i = k * w; i < Math.min(b.length, (k + 1) * w); i += 2) { const v = Math.abs(c[i]); if (v > m) m = v; } quiet[k] = m < thr ? 1 : 0; }
      const minW = Math.round(p.min * r / w), padW = Math.round(p.pad * r / w), cut = []; for (let k = 0; k < n;) { if (!quiet[k]) { k++; continue; } let e = k; while (e < n && quiet[e]) e++; if (e - k >= minW && e - k > 2 * padW) cut.push([k + padW, e - padW]); k = e; }
      const keep = []; let at = 0; cut.forEach(([a, e]) => { keep.push([at * w, a * w]); at = e; }); keep.push([at * w, b.length]); return { keep: keep.filter(([a, e]) => e > a), cuts: cut.length };
    }
    function build(b, k) { const len = k.reduce((s, [a, e]) => s + Math.min(e, b.length) - a, 0), out = chansOf(b).map((c) => { const o = new Float32Array(len); let p = 0; k.forEach(([a, e]) => { const s = c.subarray(a, Math.min(e, b.length)); o.set(s, p); p += s.length; }); return o; }); return out; }
    const analyse = () => { const r = regions(buf, P()), kept = r.keep.reduce((s, [a, e]) => s + Math.min(e, buf.length) - a, 0) / buf.sampleRate; $('sinfo').textContent = r.cuts + ' silent part' + (r.cuts === 1 ? '' : 's') + ' found. ' + Q.fmt(buf.duration) + ' becomes ' + Q.fmt(kept) + ' (' + (buf.duration - kept).toFixed(1) + ' s removed).'; return { ...r, kept }; };
    api.onOpen = analyse;
    $('go').onclick = async () => { const r = regions(buf, P()); if (!r.cuts) return say('No silence found at these settings. Try a higher threshold or a shorter length.'); $('go').disabled = true; try { await finish(build(buf, r.keep), buf.sampleRate, ' no silence'); say('Saved.'); } catch (e) { say('Could not save: ' + e.message); } $('go').disabled = false; };
    api.test = { open, analyse: () => analyse(), set: (t, m, p) => { $('sthr').value = t; $('smin').value = m; $('spad').value = p; ro(); }, run: async () => { const r = regions(buf, P()); return { cuts: r.cuts, dur: build(buf, r.keep)[0].length / buf.sampleRate }; } };
  }

  /* ---------- stereo and mono ---------- */
  if (tool === 'mono') {
    const proc = (b, mode) => { const [L, R] = b.numberOfChannels > 1 ? chansOf(b) : [b.getChannelData(0), b.getChannelData(0)], n = b.length, o = () => new Float32Array(n);
      if (mode === 'mix') { const m = o(); for (let i = 0; i < n; i++) m[i] = (L[i] + R[i]) / 2; return [m]; } if (mode === 'left') return [L.slice()]; if (mode === 'right') return [R.slice()];
      if (mode === 'swap') return [R.slice(), L.slice()]; if (mode === 'dual') { const m = o(); for (let i = 0; i < n; i++) m[i] = (L[i] + R[i]) / 2; return [m, m.slice()]; }
      if (mode === 'side') { const m = o(), s = o(); for (let i = 0; i < n; i++) { m[i] = (L[i] + R[i]) / 2; s[i] = (L[i] - R[i]) / 2; } return [s]; } return [L.slice(), R.slice()]; };
    const info = () => { const b = buf, [L, R] = b.numberOfChannels > 1 ? chansOf(b) : [b.getChannelData(0), b.getChannelData(0)]; let sm = 0, sl = 0, sr = 0, sd = 0; for (let i = 0; i < b.length; i += 7) { sl += L[i] * L[i]; sr += R[i] * R[i]; sd += (L[i] - R[i]) ** 2; } const w = sd / Math.max(1e-12, sl + sr); $('minfo').textContent = b.numberOfChannels === 1 ? 'This file is already mono.' : 'Stereo file. Width ' + (w < 0.02 ? 'almost mono already' : w < 0.4 ? 'moderate' : 'very wide') + '. Mixing to mono can thin out very wide recordings.'; };
    api.onOpen = info;
    $('go').onclick = async () => { $('go').disabled = true; try { const m = $('mmode').value; await finish(proc(buf, m), buf.sampleRate, ' ' + m); say('Saved.'); } catch (e) { say('Could not save: ' + e.message); } $('go').disabled = false; };
    api.test = { open, proc: (m) => proc(buf, m).map((c) => Array.from(c.slice(0, 4))) , info: () => { info(); return $('minfo').textContent; } };
  }

  /* ---------- tone generator ---------- */
  if (tool === 'tone') {
    const P = () => ({ f: +$('tf').value, f2: $('tsweep').checked ? +$('tf2').value : 0, wave: $('twave').value, dur: +$('tdur').value, vol: +$('tvol').value / 100 });
    const ro = () => { $('vvol').textContent = Math.round(P().vol * 100) + '%'; $('tf2w').classList.toggle('hidden', !$('tsweep').checked); }; ['tvol', 'tsweep'].forEach((i) => $(i).addEventListener('input', ro)); ro();
    function wire(c, out, p, at) { const o = c.createOscillator(), g = c.createGain(); o.type = p.wave; o.frequency.setValueAtTime(p.f, at); if (p.f2) o.frequency.exponentialRampToValueAtTime(Math.max(1, p.f2), at + p.dur); g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(p.vol, at + 0.01); g.gain.setValueAtTime(p.vol, at + Math.max(0.01, p.dur - 0.02)); g.gain.linearRampToValueAtTime(0, at + p.dur); o.connect(g); g.connect(out); o.start(at); o.stop(at + p.dur); return o; }
    const check = (p) => (p.f >= 1 && p.f <= 20000 && p.dur > 0 && p.dur <= 600 && (!p.f2 || (p.f2 >= 1 && p.f2 <= 20000)));
    $('tplay').onclick = () => { if (src) { try { src.stop(); } catch (_) { /* ended */ } src = null; $('tplay').textContent = '▶ Play'; return; } const p = P(); if (!check(p)) return say('Frequency must be 1 to 20000 Hz and length up to 600 seconds.'); const c = Q.AC(); c.resume(); src = wire(c, c.destination, p, c.currentTime); $('tplay').textContent = '❚❚ Stop'; src.onended = () => { src = null; $('tplay').textContent = '▶ Play'; }; };
    async function render() { const p = P(), r = 44100, oc = new OfflineAudioContext(1, Math.ceil(p.dur * r), r); wire(oc, oc.destination, p, 0); return oc.startRendering(); }
    $('go').onclick = async () => { const p = P(); if (!check(p)) return say('Frequency must be 1 to 20000 Hz and length up to 600 seconds.'); $('go').disabled = true; try { const out = await render(); name = 'tone ' + p.f + 'Hz'; await finish([out.getChannelData(0)], 44100, ''); say('Saved.'); } catch (e) { say('Could not save: ' + e.message); } $('go').disabled = false; };
    api.test = { render, set: (f, w, d, f2) => { $('tf').value = f; $('twave').value = w; $('tdur').value = d; $('tsweep').checked = !!f2; if (f2) $('tf2').value = f2; ro(); } };
  }

  /* ---------- video to audio ---------- */
  if (tool === 'video') {
    $('go').onclick = async () => { $('go').disabled = true; try { await finish(chansOf(buf).slice(0, 2), buf.sampleRate, ''); say('Saved the sound of ' + name + '.'); } catch (e) { say('Could not save: ' + e.message); } $('go').disabled = false; };
    api.test = { open, get buf() { return buf; } };
  }
  if (/[?&]gvtest\b/.test(location.search)) window.__util = api.test;
})();
