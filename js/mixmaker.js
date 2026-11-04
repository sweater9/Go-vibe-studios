/* GoVibe Mix — queue ordering and mix maker: puts the Automix queue in the best order for key and tempo, then renders it into one continuous, beatmatched mix with a tracklist. Runs on your device. */
(() => {
  const A = window.GVAudio, P = window.GVMixPlan; if (!A || !A.amQueue || !P) return;
  const Q = A.amQueue, $ = (id) => document.getElementById(id), MAX_SECS = 30 * 60;
  const say = (t) => { $('mmstatus').textContent = t; };
  const mapOf = (q) => q.map || (q.map = GVTrackMap.analyze(q.buf, q.grid));
  const tracks = () => Q.map((q) => ({ name: q.name, duration: q.buf.duration, bpm: q.bpm, grid: q.grid, key: q.key, mixIn: q.mixIn, mixOut: q.mixOut, map: q.grid && window.GVTrackMap ? mapOf(q) : null }));
  /* styles for each transition when the Automatic option is on: the same chooser as the live Automix, seeded from the track names so a re-render gives the same mix */
  function seeded(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return () => { h = (h + 0x6D2B79F5) | 0; let t = Math.imul(h ^ (h >>> 15), 1 | h); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const MAPPED = { wash: 'echo', gate: 'blend' };
  let forced = null;
  function pickStyles(ts) {
    if (forced) return forced;
    if ($('mmstyle').value !== 'auto') return null;
    const rand = seeded(ts.map((t) => t.name).join('|')), out = []; let last = null;
    for (let j = 0; j < ts.length - 1; j++) {
      const a = ts[j], b = ts[j + 1], lo = Math.min(a.bpm || 1, b.bpm || 1), grids = !!(a.map && b.map && a.map.grid && b.map.grid && a.bpm && b.bpm);
      let st = P.chooseStyle({ grids, gap: a.bpm && b.bpm ? P.tempoGap(a.bpm, b.bpm) / lo : 0, kc: P.keyCost(a.key, b.key), outE: a.map ? a.map.outE : 0.5, inE: b.map ? b.map.inE : 0.5, hasDrop: !!(b.map && b.map.drop != null), dropE: b.map ? b.map.dropE : 0, intensity: $('amint') ? $('amint').value : 'club', last, rand });
      st = MAPPED[st] || st; out.push(st); last = st;
    }
    return out;
  }
  const makePlan = () => { const sel = $('mmtempo').value, ts = tracks(); return P.plan(ts, { target: sel === 'custom' ? +$('mmbpm').value || 120 : sel, beats: +$('mmlen').value, styles: pickStyles(ts) }); };

  /* ---------- ordering ---------- */
  $('amorder').onclick = () => {
    if (A.amState && A.amState.on) return ($('amstatus').textContent = 'Stop Automix before reordering the queue.');
    if (Q.length < 3) return ($('amstatus').textContent = 'Add at least three tracks to reorder them.');
    const items = Q.map((q) => ({ bpm: q.bpm, key: q.key })), before = P.pathCost(items, items.map((_, i) => i)), ord = P.order(items, $('amstart').value), after = P.pathCost(items, ord);
    const moved = ord.filter((o, i) => o !== i).length, copy = ord.map((i) => Q[i]); Q.splice(0, Q.length, ...copy); A.amPaint();
    $('amstatus').textContent = (moved ? 'Reordered ' + moved + ' of ' + Q.length + ' tracks. ' : 'The order was already the best I could find. ') + 'Key path: ' + Q.map((q) => q.key || '?').join(' → ') + '. Flow score ' + before.toFixed(1) + ' → ' + after.toFixed(1) + ' (lower is smoother).';
  };

  /* ---------- plan view ---------- */
  function showPlan(p) {
    const box = $('mmplan'); box.innerHTML = '';
    const tbl = document.createElement('table'); tbl.className = 'libtbl'; tbl.setAttribute('aria-label', 'Mix plan');
    tbl.innerHTML = '<thead><tr><th scope="col">#</th><th scope="col">Track</th><th scope="col">Original</th><th scope="col">Plays at</th><th scope="col">Starts</th><th scope="col">Mix into next</th></tr></thead>';
    const tb = document.createElement('tbody');
    p.items.forEach((it, i) => {
      const tr = document.createElement('tr'), pct = (it.rate - 1) * 100;
      [i + 1, P.cleanName(it.name), it.bpm ? it.bpm.toFixed(1) + ' BPM' + (it.played !== it.bpm ? ' (read as ' + it.played.toFixed(0) + ')' : '') : 'no tempo found', p.target.toFixed(1) + ' BPM (' + (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%)' + (it.synced ? '' : ', no beat sync'), P.stamp(i === 0 ? 0 : it.start), it.fadeOut && !it.fadeOut.final ? ({ blend: 'bass swap blend', sweep: 'filter sweep', echo: 'echo out', cut: 'quick cut', riser: 'riser into the drop', banger: 'loop build and drop' }[it.fadeOut.style] || 'blend') : 'end of the mix'].forEach((v) => { const td = document.createElement('td'); td.textContent = v; tr.appendChild(td); });
      tb.appendChild(tr);
    });
    tbl.appendChild(tb); box.appendChild(tbl); $('mmlist').value = P.tracklist(p);
  }

  /* ---------- rendering ---------- */
  let result = null, busy = false;
  const tick = () => new Promise((r) => setTimeout(r, 0));
  async function render() {
    if (busy) return null;
    if (Q.length < 2) { say('Add at least two tracks to the queue first.'); return null; }
    const p = makePlan(); showPlan(p);
    if (p.total > MAX_SECS) { say('This mix would be ' + P.stamp(p.total) + ' long. The limit is 30 minutes, so remove a few tracks.'); return null; }
    busy = true; $('mmgo').disabled = true; $('mmdl').disabled = true; $('mmprog').classList.remove('hidden'); $('mmprog').value = 0;
    const rate = A.ctx.sampleRate, total = Math.ceil(p.total * rate), L = new Int16Array(total), R = new Int16Array(total), W = 60, PRE = 1;
    try {
      for (let w0 = 0; w0 < p.total; w0 += W) {
        const w1 = Math.min(p.total, w0 + W), pre = w0 > 0 ? PRE : 0, a = w0 - pre, oc = new OfflineAudioContext(2, Math.ceil((w1 - a) * rate), rate);
        const comp = oc.createDynamicsCompressor(); comp.threshold.value = -3; comp.knee.value = 6; comp.ratio.value = 12; comp.attack.value = 0.003; comp.release.value = 0.15;
        const master = oc.createGain(); master.gain.value = 0.85; master.connect(comp); comp.connect(oc.destination);
        p.items.forEach((it, i) => {
          if (it.end <= a || it.start >= w1) return;
          const from = Math.max(it.start, a), to = Math.min(it.end, w1); if (to - from < 0.01) return;
          const fo = it.fadeOut, build = !!(fo && fo.pre > 0), banger = build && fo.style === 'banger', brake = build && fo.style === 'brake';
          const low = oc.createBiquadFilter(); low.type = 'lowshelf'; low.frequency.value = 250;
          const hp = oc.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 20; hp.Q.value = 0.7;
          const lp = oc.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 20000;
          const pre = oc.createGain(), g = oc.createGain(); low.connect(hp); hp.connect(lp); lp.connect(pre); pre.connect(g); g.connect(master);
          let wet = null;
          if (fo && (fo.style === 'echo' || build)) { const dl = oc.createDelay(2), fb = oc.createGain(); wet = oc.createGain(); dl.delayTime.value = Math.min(1.9, it.spb * 0.5); fb.gain.value = 0.5; pre.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(wet); wet.connect(master); }
          const n = Math.max(2, Math.ceil((to - from) * 100) + 1), gc = new Float32Array(n), lc = new Float32Array(n), hc = new Float32Array(n), pc = new Float32Array(n), wc = new Float32Array(n);
          for (let k = 0; k < n; k++) { const v = P.gains(it, from + k * (to - from) / (n - 1)); gc[k] = v.g; lc[k] = v.low; hc[k] = v.hp; pc[k] = v.lp; wc[k] = v.wet; }
          g.gain.setValueCurveAtTime(gc, from - a, to - from); low.gain.setValueCurveAtTime(lc, from - a, to - from); hp.frequency.setValueCurveAtTime(hc, from - a, to - from); lp.frequency.setValueCurveAtTime(pc, from - a, to - from);
          if (wet) wet.gain.setValueCurveAtTime(wc, from - a, to - from);
          const mk = (when, off, dur) => { const s = oc.createBufferSource(); s.buffer = Q[i].buf; s.playbackRate.value = it.rate; s.connect(low); s.start(when, off, dur); };
          let mainTo = to; if (banger) mainTo = Math.min(to, fo.t0 - 4 * it.spb); else if (build) mainTo = Math.min(to, brake ? fo.t0 - fo.gap - 2 * it.spb : fo.t0 - fo.gap);
          if (mainTo - from > 0.01) mk(from - a, it.srcStart + (from - it.start) * it.rate, (mainTo - from) * it.rate);
          if (brake) {                                   // spin down: the old track slows to a stop like a vinyl brake
            const L = 2 * it.spb, bs = fo.t0 - fo.gap - L;
            if (bs >= a && bs < w1) { const s = oc.createBufferSource(), cv = new Float32Array(48); s.buffer = Q[i].buf; for (let k = 0; k < 48; k++) { const q = k / 47; cv[k] = Math.max(0.02, it.rate * (1 - q * q)); } s.playbackRate.setValueCurveAtTime(cv, bs - a, L); s.connect(low); s.start(bs - a, it.srcStart + (bs - it.start) * it.rate); s.stop(bs - a + L); }
          }
          if (banger) {                                  // loop rolls: the same beat, shorter each time
            const at = it.srcStart + ((fo.t0 - 4 * it.spb) - it.start) * it.rate, S0 = it.g + Math.round((at - it.g) / it.per) * it.per;
            [[4, 2], [2, 1], [1, 0.5], [0.5, 0.25]].forEach(([before, len]) => { const t = fo.t0 - before * it.spb, end = fo.t0 - fo.gap; if (t >= from - 1e-6 && t < to && t < end) mk(t - a, S0, Math.min(len * it.per, (end - t) * it.rate)); });
          }
          if (build && fo.t0 >= a && fo.t0 < w1) {
            const Tb = fo.t0 - a, t0r = Math.max(0, Tb - fo.pre);
            if (!brake && Tb - t0r > 0.2) { GVDjFx.riser(oc, master, t0r, Tb - t0r); GVDjFx.snareRoll(oc, master, Math.max(0, Tb - 4 * it.spb), Math.max(0.01, Tb - fo.gap), it.spb); }
            GVDjFx.impact(oc, master, Tb);
          }
        });
        const out = await oc.startRendering(), cl = out.getChannelData(0), cr = out.getChannelData(1), off = Math.round(pre * rate), base = Math.round(w0 * rate), n = Math.min(cl.length - off, total - base);
        for (let k = 0; k < n; k++) { const x = Math.max(-1, Math.min(1, cl[off + k])), y = Math.max(-1, Math.min(1, cr[off + k])); L[base + k] = x < 0 ? x * 32768 : x * 32767; R[base + k] = y < 0 ? y * 32768 : y * 32767; }
        $('mmprog').value = Math.round(w1 / p.total * 100); say('Rendering… ' + Math.round(w1 / p.total * 100) + '%'); await tick();
      }
      result = { L, R, rate, plan: p, tracklist: P.tracklist(p) };
      $('mmdl').disabled = false; say('Mix ready: ' + P.stamp(p.total) + ' long, ' + Q.length + ' tracks at ' + p.target.toFixed(1) + ' BPM. Download it below.');
    } catch (e) { say('The mix could not be rendered (' + (e && e.message || e) + ').'); result = null; }
    busy = false; $('mmgo').disabled = false; $('mmprog').classList.add('hidden');
    return result;
  }
  function wavBlob(r) {
    const n = r.L.length, hdr = new DataView(new ArrayBuffer(44)), w = (o, s) => { for (let i = 0; i < s.length; i++) hdr.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); hdr.setUint32(4, 36 + n * 4, true); w(8, 'WAVEfmt '); hdr.setUint32(16, 16, true); hdr.setUint16(20, 1, true); hdr.setUint16(22, 2, true); hdr.setUint32(24, r.rate, true); hdr.setUint32(28, r.rate * 4, true); hdr.setUint16(32, 4, true); hdr.setUint16(34, 16, true); w(36, 'data'); hdr.setUint32(40, n * 4, true);
    const parts = [hdr.buffer], B = 1 << 17; for (let i = 0; i < n; i += B) { const m = Math.min(B, n - i), c = new Int16Array(m * 2); for (let k = 0; k < m; k++) { c[k * 2] = r.L[i + k]; c[k * 2 + 1] = r.R[i + k]; } parts.push(c.buffer); }
    return new Blob(parts, { type: 'audio/wav' });
  }
  const save = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 6000); };
  function download() {
    if (!result) return; const fmt = $('mmfmt').value;
    if (fmt === 'wav') return save(wavBlob(result), 'GoVibe mix.wav');
    if (![48000, 44100, 32000, 24000, 22050, 16000].includes(result.rate)) return say('MP3 does not support ' + result.rate + ' Hz here. Choose WAV.');
    say('Encoding MP3…'); $('mmdl').disabled = true; const w = new Worker('js/convert-worker.js');
    w.onmessage = (e) => { if (e.data.done) { save(e.data.done, 'GoVibe mix.mp3'); say('MP3 downloaded.'); w.terminate(); $('mmdl').disabled = false; } else if (e.data.error) { say('MP3 failed: ' + e.data.error); w.terminate(); $('mmdl').disabled = false; } else if (e.data.progress != null) say('Encoding MP3… ' + Math.round(e.data.progress * 100) + '%'); };
    const l = result.L.slice(), r = result.R.slice(); w.postMessage({ ch: [l, r], rate: result.rate, kbps: 192 }, [l.buffer, r.buffer]);
  }
  $('mmgo').onclick = render; $('mmdl').onclick = download;
  $('mmtempo').onchange = () => { $('mmbpm').parentElement.classList.toggle('hidden', $('mmtempo').value !== 'custom'); };
  $('mmcopy').onclick = async () => { const t = $('mmlist').value; if (!t) return say('Press Render mix first to build the tracklist.'); try { await navigator.clipboard.writeText(t); say('Tracklist copied.'); } catch (_) { $('mmlist').select(); say('Select the text and copy it with your keyboard.'); } };
  $('mmdlt').onclick = () => { const t = $('mmlist').value; if (!t) return say('Press Render mix first to build the tracklist.'); save(new Blob([t + '\n'], { type: 'text/plain' }), 'GoVibe mix tracklist.txt'); };
  $('mmplanbtn').onclick = () => { if (Q.length < 1) return say('Add tracks to the queue first.'); const p = makePlan(); showPlan(p); say('Plan ready: ' + P.stamp(p.total) + ' in total at ' + p.target.toFixed(1) + ' BPM.'); };

  if (/[?&]gvtest\b/.test(location.search)) window.__mm = { setStyles: (a) => { forced = a; }, makePlan, render, get result() { return result; }, wavBlob };
})();
