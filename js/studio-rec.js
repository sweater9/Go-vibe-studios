/* GoVibe Mix — Studio recording: arm an audio track, record the microphone while the other tracks play, optional count in and punch in/out.
 * Capture runs in an AudioWorklet (js/rec-worklet.js) that starts and stops on exact frames of the audio clock. Audio never leaves the device. */
(() => {
  const S = () => window.GVStudio, $ = (id) => document.getElementById(id), Core = window.GVStudioCore;
  const MAX_SECONDS = 300, LAT_KEY = 'govibe.reclat';
  let armed = null, mic = null, rec = null, workletReady = null, raf = 0, testing = false;
  const say = (t) => S().say(t);

  const store = { get() { try { return localStorage.getItem(LAT_KEY); } catch (_) { return null; } }, set(v) { try { localStorage.setItem(LAT_KEY, v); } catch (_) { /* private mode */ } } };
  const latency = () => Math.max(0, Math.min(500, parseFloat($('reclat').value) || 0)) / 1000;
  const micError = (e) => e && (e.name === 'NotAllowedError' || e.name === 'SecurityError') ? 'The microphone is blocked. Allow it in the address bar, then press Record again.' : e && e.name === 'NotFoundError' ? 'No microphone was found.' : 'Could not open the microphone. ' + ((e && e.message) || '');

  /* ---------- microphone ---------- */
  async function openMic() {
    if (mic) return mic;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('This browser cannot record from a microphone here. Use a current Chrome, Edge or Firefox over a secure connection.');
    const proc = $('recproc').checked, id = $('recdev').value;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: id ? { exact: id } : undefined, echoCancellation: proc, noiseSuppression: proc, autoGainControl: proc, channelCount: 1 } });
    const ctx = S().ctx(); await ctx.resume();
    if (!workletReady) workletReady = ctx.audioWorklet.addModule('js/rec-worklet.js'); try { await workletReady; } catch (e) { workletReady = null; stream.getTracks().forEach((t) => t.stop()); throw e; }
    const src = ctx.createMediaStreamSource(stream), an = ctx.createAnalyser(), node = new AudioWorkletNode(ctx, 'gv-rec', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] }), mute = ctx.createGain(), mon = ctx.createGain();
    an.fftSize = 1024; mute.gain.value = 0; mon.gain.value = $('recmon').checked ? 1 : 0;
    src.connect(an); src.connect(node); node.connect(mute).connect(ctx.destination); src.connect(mon).connect(ctx.destination);
    mic = { ctx, stream, src, an, node, mute, mon };
    try { const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput'), cur = stream.getAudioTracks()[0].getSettings().deviceId, sel = $('recdev'); sel.innerHTML = ''; devs.forEach((d, i) => { const o = document.createElement('option'); o.value = d.deviceId; o.textContent = d.label || 'Microphone ' + (i + 1); if (d.deviceId === cur) o.selected = true; sel.appendChild(o); }); } catch (_) { /* the list stays as it was */ }
    if (store.get() == null) { const est = Math.round(((ctx.baseLatency || 0) + (ctx.outputLatency || 0)) * 1000); $('reclat').value = Math.min(500, est); }
    meter(); return mic;
  }
  function closeMic() {
    cancelAnimationFrame(raf); if (!mic) return;
    try { mic.src.disconnect(); mic.node.disconnect(); mic.node.port.onmessage = null; mic.mon.disconnect(); } catch (_) { /* already gone */ }
    mic.stream.getTracks().forEach((t) => t.stop()); mic = null; $('reclvl').style.width = '0';
  }
  function meter() {
    cancelAnimationFrame(raf); if (!mic) return; const buf = new Float32Array(mic.an.fftSize), bar = $('reclvl'); let hold = 0;
    const tick = () => { if (!mic) return; mic.an.getFloatTimeDomainData(buf); let pk = 0; for (let i = 0; i < buf.length; i++) pk = Math.max(pk, Math.abs(buf[i])); hold = Math.max(pk, hold * 0.95); const db = hold > 1e-5 ? 20 * Math.log10(hold) : -90; bar.style.width = Math.max(0, Math.min(100, (db + 60) / 60 * 100)) + '%'; bar.className = 'tlvlb' + (db > -1 ? ' clip' : ''); raf = requestAnimationFrame(tick); };
    tick();
  }

  /* ---------- arming ---------- */
  function toggleArm(id) { armed = armed === id ? null : id; const t = armed && S().trackOf(armed); say(t ? t.name + ' is armed. Press Record to start.' : 'Recording is disarmed.'); }

  /* ---------- recording ---------- */
  async function start() {
    const api = S(), P = api.P, track = armed && api.trackOf(armed);
    if (!track) return say('Arm an audio track first: press the R button on its header (add an audio track if there is none).');
    const punch = $('recpunch').checked;
    if (punch && !(P.loop.b > P.loop.a + 0.05)) return say('Punch needs a loop region. Shift and drag on the ruler to choose where recording starts and stops, then try again.');
    let m; try { m = await openMic(); } catch (e) { return say(micError(e)); }
    const recFrom = punch ? P.loop.a : api.playhead, recTo = punch ? P.loop.b : recFrom + MAX_SECONDS, from = punch ? Math.max(0, recFrom - 2) : recFrom;
    const barSec = Core.barBeats(P) * 60 / P.bpm, pulse = 60 / P.bpm * 4 / P.sig[1], delay = !punch && $('reccount').checked ? barSec : 0;
    const seg = api.startFrom(from, { delay, noLoop: true, until: recTo }); if (!seg) { if (!testing) closeMic(); return; }
    for (let i = 0; i < (delay ? P.sig[0] : 0); i++) { const g = api.graph; if (g) GVSynth.click(m.ctx, g.master, seg.when - delay + i * pulse, i === 0); }
    const at = Math.round((seg.when + (recFrom - from)) * m.ctx.sampleRate), lat = latency(), end = Math.round((seg.when + (recTo - from) + (punch ? lat : 0)) * m.ctx.sampleRate); /* a punch listens a little longer, because the first part of the take is trimmed to fix the latency */
    rec = { track: track.id, recFrom, recTo, punch, lat, l: [], total: 0, finishing: false };
    m.node.port.onmessage = (e) => { if (!rec) return; if (e.data.l) { rec.l.push(e.data.l); rec.total += e.data.l.length; } if (e.data.done) finish(); };
    m.node.port.postMessage({ cmd: 'arm', at, end });
    store.set(String(Math.round(latency() * 1000)));
    $('rec').setAttribute('aria-pressed', 'true'); $('rec').textContent = '■ Stop recording';
    say(punch ? 'Recording will start at ' + fmt(recFrom) + ' and stop at ' + fmt(recTo) + '.' : delay ? 'Count in, then recording.' : 'Recording…');
  }
  const fmt = (s) => { const m = Math.floor(s / 60); return m + ':' + (s - m * 60).toFixed(2).padStart(5, '0'); };
  /* the Studio stopped playing (the Stop button, space, the end of a punch, or the five minute limit) */
  function stopped() { if (!rec || rec.finishing) return; rec.finishing = true; if (mic) mic.node.port.postMessage('flush'); else finish(); }
  function monoWav(f, rate) {
    const n = f.length, v = new DataView(new ArrayBuffer(44 + n * 2)), w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
    for (let i = 0, o = 44; i < n; i++, o += 2) { const s = Math.max(-1, Math.min(1, f[i])); v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
    return new Blob([v], { type: 'audio/wav' });
  }
  /* remove everything between a and b from the audio clips of a track (punch in replaces what was there) */
  function cutRegion(t, a, b) {
    const out = []; let touched = 0;
    t.clips.forEach((c) => {
      const s = c.start, e = c.start + c.dur; if (e <= a + 1e-6 || s >= b - 1e-6) { out.push(c); return; } touched++;
      if (s < a - 1e-6) { const left = JSON.parse(JSON.stringify(c)); left.dur = a - s; left.fadeOut = 0; out.push(left); }
      if (e > b + 1e-6) { const right = JSON.parse(JSON.stringify(c)); right.id = Core.uid(); right.start = b; right.offset = (c.offset || 0) + (b - s); right.dur = e - b; right.fadeIn = 0; out.push(right); }
    });
    t.clips = out; return touched;
  }
  function finish() {
    const r = rec; if (!r) return; rec = null; const api = S(), ctx = api.ctx();
    $('rec').setAttribute('aria-pressed', 'false'); $('rec').textContent = '● Record'; if (!testing) closeMic();
    if (api.playing) api.stop();
    const rate = ctx.sampleRate, n = r.total; if (n < rate * 0.05) return say('Nothing was recorded.');
    const data = new Float32Array(n); let o = 0; r.l.forEach((c) => { data.set(c, o); o += c.length; });
    const lat = Math.min(r.lat, n / rate - 0.02), dur = n / rate - lat, buf = ctx.createBuffer(1, n, rate); buf.copyToChannel(data, 0);
    const P = api.P, takes = Object.values(P.assets).filter((a) => /^Take \d+/.test(a.name || '')).length + 1, aid = Core.uid(), name = 'Take ' + takes + '.wav';
    api.addAsset(aid, { id: aid, name, dur: n / rate }, buf, monoWav(data, rate));
    const clip = { id: Core.uid(), assetId: aid, start: r.recFrom, offset: lat, dur, gain: 1, fadeIn: 0, fadeOut: 0 };
    let note = '';
    api.edit('Record', () => {
      let t = api.trackOf(r.track);
      if (t && r.punch) { const k = cutRegion(t, r.recFrom, r.recFrom + dur); if (k) note = ' It replaced ' + k + ' clip' + (k > 1 ? 's' : '') + ' in that range. Undo brings them back.'; }
      else if (!t || t.clips.some((c) => c.start < r.recFrom + dur - 1e-6 && c.start + c.dur > r.recFrom + 1e-6)) { const base = t ? t.name : 'Audio'; t = Core.newTrack(P, 'audio'); t.name = (base + ' take').slice(0, 24); P.tracks.push(t); note = ' The take went on a new track because the armed one already has audio there.'; }
      t.clips.push(clip); api.select(t.id, clip.id);
    });
    say('Recorded ' + dur.toFixed(1) + ' seconds as ' + name + '.' + note);
  }
  function toggleRecord() { if (rec) { if (S().playing) S().stop(); else stopped(); } else start(); }

  /* ---------- controls ---------- */
  $('rec').onclick = toggleRecord;
  $('rectest').onclick = async () => { if (testing) { testing = false; if (!rec) closeMic(); $('rectest').textContent = 'Test microphone'; return say('Microphone off.'); } try { await openMic(); testing = true; $('rectest').textContent = 'Stop testing'; say('Microphone on. Make some sound and watch the level. Use headphones.'); } catch (e) { say(micError(e)); } };
  $('recmon').onchange = () => { if (mic) mic.mon.gain.value = $('recmon').checked ? 1 : 0; };
  $('reclat').onchange = () => store.set(String(Math.round(latency() * 1000)));
  { const v = store.get(); if (v != null) $('reclat').value = v; }
  window.addEventListener('beforeunload', () => { if (mic) closeMic(); });

  window.GVStudioRec = { active: () => !!rec, armed: () => armed, toggleArm, stopped, start, toggleRecord, cutRegion, get mic() { return !!mic; } };
  S().buildHeads();
})();
