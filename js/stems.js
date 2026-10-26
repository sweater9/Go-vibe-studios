/* Go Vibe Studios — stem splitter UI (beta). Signal-processing based, not AI. See js/stems-worker.js. */
(() => {
  const A = window.GVAudio; if (!A) return;
  const { ctx, decks } = A, MAX_SECS = 300;
  const NAMES = [['vocals', 'Vocals'], ['drums', 'Drums'], ['bass', 'Bass'], ['music', 'Music']];

  function wav(buf) {
    const n = buf.length, ch = buf.numberOfChannels, d = [...Array(ch)].map((_, i) => buf.getChannelData(i)), v = new DataView(new ArrayBuffer(44 + n * ch * 2));
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + n * ch * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
    v.setUint32(24, buf.sampleRate, true); v.setUint32(28, buf.sampleRate * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * ch * 2, true);
    let o = 44; for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const s = Math.max(-1, Math.min(1, d[c][i])); v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2; }
    return new Blob([v], { type: 'audio/wav' });
  }
  const box = (d) => d.root.querySelector('[data-r="stembox"]');

  function render(d, msg) {
    const b = box(d); if (!b) return;
    b.innerHTML = '';
    const row = document.createElement('div'); row.className = 'row'; row.style.marginTop = '10px';
    const label = document.createElement('span'); label.className = 'time'; label.textContent = 'Stems (beta)'; row.appendChild(label);
    if (!d.stems) {
      const go = document.createElement('button'); go.className = 'btn'; go.textContent = 'Split stems'; go.disabled = !d.buf;
      go.title = 'Splits the loaded track into vocals, drums, bass and music. Uses signal processing, not AI, so expect some bleed.';
      go.onclick = () => split(d); row.appendChild(go);
    } else {
      NAMES.forEach(([k, nm]) => {
        const t = document.createElement('button'); t.className = 'btn stem'; t.textContent = nm; t.setAttribute('aria-pressed', d.sg[k].gain.value > 0.5 ? 'true' : 'false');
        t.onclick = () => { const on = d.sg[k].gain.value > 0.5; d.sg[k].gain.setTargetAtTime(on ? 0 : 1, ctx.currentTime, 0.015); t.setAttribute('aria-pressed', on ? 'false' : 'true'); };
        row.appendChild(t);
      });
      const dl = document.createElement('button'); dl.className = 'btn'; dl.textContent = 'Download stems'; dl.onclick = () => downloads(d, b); row.appendChild(dl);
    }
    b.appendChild(row);
    const st = document.createElement('p'); st.className = 'status'; st.setAttribute('role', 'status'); st.dataset.r = 'stemmsg'; st.textContent = msg || ''; b.appendChild(st);
  }
  function note(d, t) { const m = box(d) && box(d).querySelector('[data-r="stemmsg"]'); if (m) m.textContent = t; }

  function downloads(d, b) {
    let area = b.querySelector('.stemdl'); if (area) area.remove();
    area = document.createElement('div'); area.className = 'row stemdl'; area.style.marginTop = '8px';
    const base = (d.el.name.textContent || 'track').replace(/\.[^.]+$/, '');
    NAMES.forEach(([k, nm]) => { const a = document.createElement('a'); a.className = 'btn'; a.textContent = nm + ' .wav'; a.href = URL.createObjectURL(wav(d.stems[k])); a.download = base + '-' + k + '.wav'; area.appendChild(a); });
    b.appendChild(area);
  }

  let busy = false;
  function split(d) {
    return new Promise((resolve) => {
      if (busy) return resolve(false);
      if (!d.buf) return resolve(false);
      if (d.buf.duration > MAX_SECS) { note(d, 'Stem splitting supports tracks up to 5 minutes (it needs a lot of memory). Trim the track in the Audio Editor first.'); return resolve(false); }
      busy = true; const buf = d.buf, n = buf.length, L = new Float32Array(buf.getChannelData(0));
      const R = new Float32Array(buf.numberOfChannels > 1 ? buf.getChannelData(1) : buf.getChannelData(0));
      const was = d.playing, pos = d.position();
      note(d, 'Splitting… 0%'); const gb = box(d).querySelector('button'); if (gb) gb.disabled = true;
      let worker; try { worker = new Worker('js/stems-worker.js'); } catch (_) { busy = false; note(d, 'This browser could not start the splitter.'); return resolve(false); }
      worker.onerror = () => { busy = false; worker.terminate(); render(d, 'Splitting failed in this browser.'); resolve(false); };
      worker.onmessage = (e) => {
        const m = e.data;
        if (m.progress != null) return note(d, 'Splitting… ' + Math.round(m.progress * 100) + '%');
        if (!m.done || d.buf !== buf) { busy = false; worker.terminate(); if (d.buf !== buf) render(d); return resolve(false); }
        const o = m.out, mk = (arrs) => { const b2 = ctx.createBuffer(arrs.length, n, buf.sampleRate); arrs.forEach((a, i) => b2.copyToChannel(a, i)); return b2; };
        d.stems = { vocals: mk([o.vocals]), bass: mk([o.bass]), drums: mk([o.drumsL, o.drumsR]), music: mk([o.musicL, o.musicR]) };
        Object.values(d.sg).forEach((g) => (g.gain.value = 1));
        worker.terminate(); busy = false;
        if (was) d.seek(pos);
        render(d, m.mono ? 'Done. This track looks mono, so the vocals stem will contain most of the melody. Stereo recordings split better.' : 'Done. Tap a stem to mute or unmute it. Expect some bleed between stems.');
        resolve(true);
      };
      worker.postMessage({ L, R, sr: buf.sampleRate }, [L.buffer, R.buffer]);
    });
  }

  A.onLoad = (d) => render(d);
  decks.forEach((d) => render(d));
  if (/[?&]gvtest\b/.test(location.search)) window.__stems = { split: (i) => split(decks[i]), wav };   // test hook
})();
