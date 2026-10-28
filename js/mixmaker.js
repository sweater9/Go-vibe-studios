/* GoVibe Mix — queue ordering and mix maker: puts the Automix queue in the best order for key and tempo, then renders it into one continuous, beatmatched mix with a tracklist. Runs on your device. */
(() => {
  const A = window.GVAudio, P = window.GVMixPlan; if (!A || !A.amQueue || !P) return;
  const Q = A.amQueue, $ = (id) => document.getElementById(id), MAX_SECS = 30 * 60;
  const say = (t) => { $('mmstatus').textContent = t; };
  const tracks = () => Q.map((q) => ({ name: q.name, duration: q.buf.duration, bpm: q.bpm, grid: q.grid, key: q.key }));
  const makePlan = () => { const sel = $('mmtempo').value; return P.plan(tracks(), { target: sel === 'custom' ? +$('mmbpm').value || 120 : sel, beats: +$('mmlen').value }); };

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
    tbl.innerHTML = '<thead><tr><th scope="col">#</th><th scope="col">Track</th><th scope="col">Original</th><th scope="col">Plays at</th><th scope="col">Starts</th></tr></thead>';
    const tb = document.createElement('tbody');
    p.items.forEach((it, i) => {
      const tr = document.createElement('tr'), pct = (it.rate - 1) * 100;
      [i + 1, P.cleanName(it.name), it.bpm ? it.bpm.toFixed(1) + ' BPM' + (it.played !== it.bpm ? ' (read as ' + it.played.toFixed(0) + ')' : '') : 'no tempo found', p.target.toFixed(1) + ' BPM (' + (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%)' + (it.synced ? '' : ', no beat sync'), P.stamp(i === 0 ? 0 : it.start)].forEach((v) => { const td = document.createElement('td'); td.textContent = v; tr.appendChild(td); });
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
          const s = oc.createBufferSource(); s.buffer = Q[i].buf; s.playbackRate.value = it.rate;
          const low = oc.createBiquadFilter(); low.type = 'lowshelf'; low.frequency.value = 250; const g = oc.createGain(); s.connect(low); low.connect(g); g.connect(master);
          const n = Math.max(2, Math.ceil((to - from) * 100) + 1), gc = new Float32Array(n), lc = new Float32Array(n);
          for (let k = 0; k < n; k++) { const v = P.gains(it, from + k * (to - from) / (n - 1)); gc[k] = v.g; lc[k] = v.low; }
          g.gain.setValueCurveAtTime(gc, from - a, to - from); low.gain.setValueCurveAtTime(lc, from - a, to - from);
          s.start(from - a, it.srcStart + (from - it.start) * it.rate, (to - from) * it.rate);
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

  if (/[?&]gvtest\b/.test(location.search)) window.__mm = { makePlan, render, get result() { return result; }, wavBlob };
})();
