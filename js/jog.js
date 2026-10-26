/* Go Vibe Studios — jog wheel: drag to scratch (forward and backward), hold Bend buttons to nudge pitch */
(() => {
  const A = window.GVAudio; if (!A) return;
  const { ctx, decks } = A, REV = 1.8;                       // seconds of audio per full turn of the platter (33⅓ rpm)

  function grain(d, from, trackLen, realLen, dir) {            // play a short slice forwards or backwards, stretched to realLen
    const b = d.buf, sr = b.sampleRate, n = Math.max(8, Math.floor(trackLen * sr)); if (n < 8) return;
    let a = Math.floor((dir > 0 ? from : from - trackLen) * sr); a = Math.max(0, Math.min(b.length - n, a));
    const g = ctx.createBuffer(b.numberOfChannels, n, sr), fade = Math.min(Math.floor(0.004 * sr), n >> 2);
    for (let c = 0; c < b.numberOfChannels; c++) {
      const src = b.getChannelData(c), dst = g.getChannelData(c);
      for (let i = 0; i < n; i++) { let v = src[dir > 0 ? a + i : a + n - 1 - i]; if (i < fade) v *= i / fade; else if (i > n - fade) v *= (n - i) / fade; dst[i] = v; }
    }
    const s = ctx.createBufferSource(); s.buffer = g; s.playbackRate.value = Math.min(8, Math.max(0.05, (n / sr) / realLen));
    s.connect(d.low); s.start(); s.onended = () => s.disconnect();
  }

  decks.forEach((d) => {
    const jog = d.el.jog; let id = null, last = 0, lastT = 0, was = false, cx = 0, cy = 0, ang = 0, pos = 0;
    const angleOf = (e) => Math.atan2(e.clientY - cy, e.clientX - cx);
    jog.addEventListener('pointerdown', (e) => {
      if (!d.buf || id !== null) return; e.preventDefault();
      const r = jog.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2;
      id = e.pointerId; jog.setPointerCapture(id); jog.classList.add('grab');
      was = d.playing; pos = d.position(); d.pause(); d.scratching = true; d.startPos = pos;
      ang = angleOf(e); lastT = performance.now();
    });
    const move = (e, sound) => {
      const now = performance.now(), dtReal = Math.max(0.001, (now - lastT) / 1000);
      let da = angleOf(e) - ang; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI;
      const np = Math.max(0, Math.min(d.buf.duration - 0.05, pos + da / (2 * Math.PI) * REV)), moved = np - pos;
      if (sound && Math.abs(moved) > 1e-4) grain(d, pos, Math.min(0.25, Math.max(0.02, Math.abs(moved) * 1.15)), Math.min(0.14, Math.max(0.025, dtReal * 1.15)), moved > 0 ? 1 : -1);
      pos = np; d.startPos = np; ang = angleOf(e); lastT = now;
      d.el.platter.style.transform = 'rotate(' + ((np * 200) % 360).toFixed(1) + 'deg)';
    };
    jog.addEventListener('pointermove', (e) => { if (e.pointerId === id && performance.now() - lastT >= 12) move(e, true); });
    const end = (e) => {
      if (e.pointerId !== id) return; move(e, false); id = null; jog.classList.remove('grab'); d.scratching = false;
      d.startPos = pos; if (was) d.play();
    };
    jog.addEventListener('pointerup', end); jog.addEventListener('pointercancel', end);
    // pitch bend: hold to nudge ±6%
    [['nudgem', 0.94], ['nudgep', 1.06]].forEach(([k, f]) => {
      const b = d.el[k]; let on = false;
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); on = true; b.setPointerCapture(e.pointerId); d.bend(f); });
      const off = () => { if (on) { on = false; d.bend(1); } };
      b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('lostpointercapture', off);
      b.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !on) { on = true; d.bend(f); } });
      b.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') off(); });
    });
  });
  if (/[?&]gvtest\b/.test(location.search)) window.__jog = { REV };
})();
