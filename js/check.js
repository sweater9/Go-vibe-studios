/* GoVibeMix — audio quality checker: bandwidth cutoff, clipping, hidden mono, DC offset, loudness and silence at the ends. Runs on this device. */
(() => {
  const Q = window.GVQuick, S = window.GVSpec, $ = (id) => document.getElementById(id), say = (t) => { $('status').textContent = t; };
  const db = (x) => (x > 1e-9 ? 20 * Math.log10(x) : -180);

  /* where does the sound stop at the top? */
  function bandwidth(chans, rate) {
    const cols = Math.max(8, Math.min(240, Math.floor(chans[0].length / 4096))), spec = S.compute(chans, rate, cols, 4096), bins = spec.bins, hzPer = rate / 2 / bins;
    const avg = new Float64Array(bins), loud = [];
    for (let c = 0; c < cols; c++) { let m = 0; for (let b = 8; b < bins; b++) m += Math.pow(10, spec.db[c * bins + b] / 10); loud.push([m, c]); }
    loud.sort((a, b) => b[0] - a[0]);
    const use = loud.slice(0, Math.max(3, Math.ceil(cols / 2)));          // the louder half of the file
    for (const [, c] of use) for (let b = 0; b < bins; b++) avg[b] += Math.pow(10, spec.db[c * bins + b] / 10) / use.length;
    const lvl = new Float64Array(bins), w = Math.max(2, Math.round(150 / hzPer));   // smooth about 300 Hz wide
    for (let b = 0; b < bins; b++) { let s = 0, n = 0; for (let k = Math.max(0, b - w); k <= Math.min(bins - 1, b + w); k++) { s += avg[k]; n++; } lvl[b] = 10 * Math.log10(s / n + 1e-18); }
    const r0 = Math.round(1000 / hzPer), r1 = Math.round(4000 / hzPer); let ref = -180; for (let b = r0; b < r1 && b < bins; b++) ref = Math.max(ref, lvl[b]);
    const thr = Math.max(ref - 55, S.FLOOR + 6); let top = bins - 1; while (top > r1 && lvl[top] < thr) top--;
    const cut = Math.min(rate / 2, (top + 1) * hzPer), step = Math.round(1000 / hzPer);
    const drop = top + step < bins ? lvl[Math.max(0, top - step)] - lvl[Math.min(bins - 1, top + step)] : 0;
    return { cutoff: cut, nyquist: rate / 2, sharp: drop > 25, drop, ref, spec };
  }

  function guess(cut, nyq, sharp) {
    if (cut >= nyq * 0.94 || cut >= 21000) return { kind: 'full', text: 'The sound reaches all the way to the top of what this sample rate can hold, so nothing was cut off.' };
    if (!sharp) return { kind: 'soft', text: 'The top fades away gradually around ' + (cut / 1000).toFixed(1) + ' kHz. That is typical of an older recording or a gentle filter, not a lossy cutoff.' };
    if (cut >= 19500) return { kind: 'high', text: 'A sharp cut near ' + (cut / 1000).toFixed(1) + ' kHz. Likely a high bitrate lossy source (about 256 to 320 kbps MP3 or AAC). Fine for listening.' };
    if (cut >= 18200) return { kind: 'mid', text: 'A sharp cut near ' + (cut / 1000).toFixed(1) + ' kHz. Likely a lossy source around 192 kbps.' };
    if (cut >= 15600) return { kind: 'low', text: 'A sharp cut near ' + (cut / 1000).toFixed(1) + ' kHz. Likely a 128 to 160 kbps lossy source. If this was sold as lossless, it was probably converted from an MP3.' };
    return { kind: 'poor', text: 'A sharp cut near ' + (cut / 1000).toFixed(1) + ' kHz. Likely a low bitrate source (about 96 kbps or less) or a low quality recording.' };
  }

  function basics(chans, rate) {
    const n = chans[0].length, out = { peak: 0, clipped: 0, runs: 0, dc: 0, rms: 0, lead: 0, trail: 0, same: false, silentCh: [] };
    let sq = 0, tot = 0;
    chans.forEach((d, ci) => {
      let sum = 0, pk = 0, run = 0;
      for (let i = 0; i < n; i++) { const v = d[i], a = Math.abs(v); sum += v; sq += v * v; if (a > pk) pk = a; if (a >= 0.999) { out.clipped++; run++; if (run === 3) out.runs++; } else run = 0; }
      tot += n; out.peak = Math.max(out.peak, pk); out.dc = Math.max(out.dc, Math.abs(sum / n)); if (pk < 1e-4) out.silentCh.push(ci);
    });
    out.rms = Math.sqrt(sq / tot); out.clipPct = out.clipped / tot * 100;
    const thr = Math.pow(10, -60 / 20), loudAt = (i) => { for (const d of chans) if (Math.abs(d[i]) > thr) return true; return false; };
    let a = 0; while (a < n && !loudAt(a)) a++; let b = n - 1; while (b > a && !loudAt(b)) b--;
    out.lead = a / rate; out.trail = (n - 1 - b) / rate;
    if (chans.length === 2) { let diff = 0; for (let i = 0; i < n; i++) diff = Math.max(diff, Math.abs(chans[0][i] - chans[1][i])); out.same = diff < 1e-4; }
    return out;
  }

  function analyse(buf) {
    const chans = [...Array(buf.numberOfChannels)].map((_, i) => buf.getChannelData(i)), rate = buf.sampleRate;
    const bw = bandwidth(chans, rate), b = basics(chans, rate), g = guess(bw.cutoff, bw.nyquist, bw.sharp), items = [];
    items.push({ ok: ['full', 'high', 'soft'].includes(g.kind), title: 'Top end: ' + (bw.cutoff / 1000).toFixed(1) + ' kHz of ' + (bw.nyquist / 1000).toFixed(1) + ' kHz', text: g.text });
    if (b.clipped === 0) items.push({ ok: true, title: 'No clipping', text: 'The loudest peak is ' + db(b.peak).toFixed(1) + ' dB below full scale, so nothing is flattened off.' });
    else items.push({ ok: b.clipPct < 0.01 && b.runs < 4, title: 'Clipping: ' + b.runs + ' flat run' + (b.runs === 1 ? '' : 's') + ' (' + b.clipPct.toFixed(3) + '% of samples)', text: b.runs < 4 ? 'A few samples touch full scale. This is rarely audible.' : 'Several stretches hit the ceiling and are flattened, which can sound harsh. Lower the volume before the loudest parts, or repair it in the Audio Editor.' });
    if (chans.length === 2) {
      if (b.same) items.push({ ok: false, title: 'Mono hiding in a stereo file', text: 'Left and right are identical. You can halve the file size with the Stereo to mono tool.' });
      else if (b.silentCh.length) items.push({ ok: false, title: 'One side is silent', text: (b.silentCh[0] === 0 ? 'The left' : 'The right') + ' channel has no sound at all. Use the Stereo to mono tool to keep the other side in both ears.' });
      else items.push({ ok: true, title: 'Real stereo', text: 'Left and right carry different sound.' });
    } else items.push({ ok: true, title: chans.length === 1 ? 'Mono file' : chans.length + ' channels', text: 'Nothing to flag about the channel layout.' });
    items.push({ ok: b.dc < 0.005, title: 'DC offset: ' + (b.dc * 100).toFixed(2) + '%', text: b.dc < 0.005 ? 'The wave is centred, as it should be.' : 'The wave sits off centre, which wastes headroom and can click when cutting. The Audio Editor can remove it.' });
    items.push({ ok: true, title: 'Level: peak ' + db(b.peak).toFixed(1) + ' dB, average ' + db(b.rms).toFixed(1) + ' dB', text: 'Measured against full scale (0 dB). The Mastering tool can set loudness for streaming.' });
    const edge = b.lead > 1.5 || b.trail > 3;
    items.push({ ok: !edge, title: 'Silence at the ends: ' + b.lead.toFixed(1) + ' s at the start, ' + b.trail.toFixed(1) + ' s at the end', text: edge ? 'Long quiet stretches at the ends. The Silence remover or the Audio Editor can trim them.' : 'The ends are tight.' });
    const bad = items.filter((i) => !i.ok).length;
    return { rate, channels: buf.numberOfChannels, seconds: buf.duration, cutoff: bw.cutoff, sharp: bw.sharp, kind: g.kind, peakDb: db(b.peak), clipRuns: b.runs, dc: b.dc, mono: b.same, lead: b.lead, trail: b.trail, items, bad, spec: bw.spec };
  }

  function show(r, name) {
    const v = $('verdict'); v.className = 'verdict ' + (r.bad ? 'warn' : 'good');
    $('vhead').textContent = r.bad ? r.bad + (r.bad === 1 ? ' thing' : ' things') + ' worth a look' : 'Looks healthy';
    $('vtext').textContent = r.items[0].text;
    const list = $('list'); list.textContent = '';
    for (const it of r.items) { const li = document.createElement('li'); li.className = it.ok ? 'ok' : 'warn'; const t = document.createElement('span'); t.className = 'tag'; t.textContent = it.ok ? 'OK' : 'Check'; const b = document.createElement('b'); b.append(t, it.title); const d = document.createElement('span'); d.className = 'd'; d.textContent = it.text; li.append(b, d); list.append(li); }
    $('sinfo').textContent = name + ' · ' + Q.fmt(r.seconds) + ', ' + r.channels + ' channel' + (r.channels > 1 ? 's' : '') + ', ' + r.rate + ' Hz.';
    const c = $('spec'), W = 900, H = 340; c.width = W; c.height = H; const g = c.getContext('2d'), opts = { fmax: r.rate / 2 };
    g.drawImage(S.image(r.spec, W, H, opts), 0, 0); S.axis(g, W, H, opts, r.rate, 1.3);
    if (r.sharp && r.kind !== 'full') { const y = Math.round((1 - r.cutoff / (r.rate / 2)) * H); g.fillStyle = '#22d3ee'; g.fillRect(0, y, W, 2); }
  }

  let last = null;
  async function open(f) {
    let buf; try { say('Reading ' + f.name + '…'); buf = await Q.decode(f); } catch (e) { return say('Could not read that file: ' + ((e && e.message) || 'unknown error')); }
    say('Checking…'); await new Promise((r) => setTimeout(r, 30));
    last = analyse(buf); $('drop').classList.add('hidden'); $('main2').classList.remove('hidden'); show(last, Q.clean(f.name)); say('');
  }
  Q.hook($('drop'), open);
  $('again').onclick = () => { $('main2').classList.add('hidden'); $('drop').classList.remove('hidden'); say(''); };
  if (/[?&]gvtest\b/.test(location.search)) window.__util = { open, analyse, bandwidth, last: () => last };
})();
