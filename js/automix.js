/* GoVibe Mix — track queue + Automix (tempo match, bass swap, crossfade) */
(() => {
  const A = window.GVAudio; if (!A) return;
  const { ctx, decks, detectBPM, detectGrid, detectKey, applyXf, fmt } = A, $ = (id) => document.getElementById(id);
  const say = (t) => { $('amstatus').textContent = t; };
  const queue = [];                       // { name, buf, bpm, key }
  const S = { on: false, idx: -1, active: 0, tr: null, timer: 0 };   // idx = queue index playing on deck S.active
  const smooth = (x, a, b) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const xf = $('xf');

  function paint() {
    const ol = $('amlist'); ol.innerHTML = '';
    queue.forEach((q, i) => {
      const li = document.createElement('li'); if (S.on && i === S.idx) li.className = 'now';
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = (i + 1) + '. ' + q.name;
      const meta = document.createElement('span'); meta.className = 'meta'; meta.textContent = (q.bpm ? q.bpm.toFixed(0) + ' BPM' : '— BPM') + (q.key ? ' · ' + q.key : '') + (q.map && q.map.grid && q.map.drop != null ? ' · drop ' + fmt(q.map.drop) : '') + (q.map && q.map.grid ? ' · outro ' + fmt(q.map.outro) : '');
      const rm = document.createElement('button'); rm.className = 'btn'; rm.textContent = '✕'; rm.setAttribute('aria-label', 'Remove ' + q.name);
      rm.onclick = () => { if (S.on) return say('Stop Automix before removing tracks.'); queue.splice(i, 1); paint(); };
      li.append(nm, meta);
      { const mk = (key, lab, tip) => { const w = document.createElement('label'); w.className = 'ammp'; w.append(lab + ' '); const inp = document.createElement('input'); inp.type = 'text'; inp.size = 5; inp.placeholder = 'auto'; inp.title = tip; inp.setAttribute('aria-label', lab + ' point for ' + q.name + ', minutes and seconds, blank for automatic'); inp.value = q[key] != null ? fmt(q[key]) : '';
          inp.onchange = () => { const v = GVMixPlan.parseTime(inp.value); q[key] = v; if (inp.value.trim() && v == null) say('Type a time like 1:30, or leave it empty for automatic.'); inp.value = v != null ? fmt(v) : ''; saveMix(q); S.plan = null; }; w.appendChild(inp); return w; };
        li.append(mk('mixIn', 'Mix in', 'Where this track should start when it is mixed in (leave empty for automatic)'), mk('mixOut', 'Mix out', 'Where the mix out of this track should happen (leave empty for automatic)')); }
      if (i + 1 < queue.length) { const pv = document.createElement('button'); pv.className = 'btn'; pv.textContent = '▶ Preview mix'; pv.setAttribute('aria-label', 'Preview the mix from ' + q.name + ' into ' + queue[i + 1].name); pv.onclick = () => preview(i); li.append(pv, rm); } else li.append(rm);
      ol.appendChild(li);
    });
    if (!queue.length) { const li = document.createElement('li'); li.textContent = 'No tracks yet.'; ol.appendChild(li); }
    drawMap();
  }
  /* the set map: one block per track, as wide as the track is long, filled with its energy through the track and coloured by its place on the Camelot wheel */
  function drawMap() {
    const cv = $('ammap'); if (!cv) return; cv.classList.toggle('hidden', queue.length < 2); $('ammaptxt').textContent = '';
    if (queue.length < 2) return;
    const g = cv.getContext('2d'), W = cv.width, H = cv.height, tot = queue.reduce((s, q) => s + (q.buf ? q.buf.duration : q.map ? q.map.dur : 200), 0) || 1; let x = 0; g.clearRect(0, 0, W, H); g.fillStyle = '#0b0b14'; g.fillRect(0, 0, W, H);
    const parts = [];
    queue.forEach((q, i) => {
      const dur = q.buf ? q.buf.duration : q.map ? q.map.dur : 200, w = Math.max(6, Math.round(W * dur / tot)), m = q.map || {}, num = q.key ? parseInt(q.key, 10) : NaN, hue = isNaN(num) ? 220 : num * 30, minor = q.key && /A$/.test(q.key);
      const bars = m.bars && m.bars.length ? m.bars : null;
      for (let px = 0; px < w - 2; px++) {
        const e = bars ? bars[Math.min(bars.length - 1, Math.floor(px / (w - 2) * bars.length))] : (m.inE != null ? m.inE + (m.outE - m.inE) * px / (w - 2) : q.energy != null ? q.energy : 0.5), h = Math.max(3, e * (H - 30));
        g.fillStyle = 'hsl(' + hue + ',' + (isNaN(num) ? 10 : minor ? 60 : 78) + '%,' + (S.on && i === S.idx ? 62 : 48) + '%)'; g.fillRect(x + px, H - 16 - h, 1, h);
      }
      g.fillStyle = '#ecebff'; g.font = '11px sans-serif'; g.fillText((i + 1) + (q.key ? ' ' + q.key : '') + (q.bpm ? ' · ' + Math.round(q.bpm) : ''), x + 3, H - 3);
      if (i > 0) { g.fillStyle = '#22d3ee'; g.fillRect(x - 1, 4, 2, H - 20); }
      parts.push((i + 1) + ': ' + (q.key || 'no key') + ', ' + (q.bpm ? Math.round(q.bpm) + ' BPM' : 'no tempo')); x += w;
    });
    const clash = []; for (let i = 1; i < queue.length; i++) { const k = GVMixPlan.keyCost(queue[i - 1].key, queue[i].key); if (k >= 5) clash.push(i + ' to ' + (i + 1)); }
    cv.setAttribute('aria-label', 'Set map. ' + parts.join('; ') + '.');
    $('ammaptxt').textContent = 'Set map: block width is track length, height is energy, colour is the key. ' + (clash.length ? 'Keys clash between tracks ' + clash.join(', ') + '; the Mix maker\'s "Order for the best flow" can fix that.' : 'The keys flow well from track to track.');
  }
  paint();

  const mixKey = (q) => 'govibe.mix.' + q.name + '|' + Math.round(q.buf ? q.buf.duration : 0);
  function saveMix(q) { try { const o = {}; if (q.mixIn != null) o.i = q.mixIn; if (q.mixOut != null) o.o = q.mixOut; if (o.i != null || o.o != null) localStorage.setItem(mixKey(q), JSON.stringify(o)); else localStorage.removeItem(mixKey(q)); } catch (_) { /* no storage */ } }
  async function addBuffer(buf, name, pre) {
    if (pre) queue.push({ name, buf, bpm: pre.bpm, key: pre.key, grid: pre.grid ? { ...pre.grid } : null, id: pre.id });
    else { const b0 = detectBPM(buf), grid = b0 ? detectGrid(buf, b0) : null; queue.push({ name, buf, bpm: grid ? grid.bpm : b0, key: detectKey(buf), grid }); }
    const nq = queue[queue.length - 1]; nq.energy = pre && pre.energy != null ? pre.energy : window.GVTrackMap ? GVTrackMap.energy(buf) : undefined;
    try { const o = JSON.parse(localStorage.getItem(mixKey(nq)) || 'null'); if (o) { if (typeof o.i === 'number') nq.mixIn = o.i; if (typeof o.o === 'number') nq.mixOut = o.o; } } catch (_) { /* no storage */ }
    mapOf(nq); paint();
  }
  A.queueAdd = (buf, name, pre) => { addBuffer(buf, name, pre); say(queue.length + ' track' + (queue.length === 1 ? '' : 's') + ' in the queue.'); };
  $('amadd').onclick = () => $('amfile').click();
  $('amdemo').onclick = async () => {
    if (S.on) return say('Stop Automix before adding tracks.'); const b = $('amdemo'); b.disabled = true;
    try { for (let i = 0; i < GVDemo.count; i++) { say('Making demo track ' + (i + 1) + ' of ' + GVDemo.count + '…'); const d = await GVDemo.make(i); await addBuffer(d.buf, d.name, d.pre); }
      say('Three demo tracks are in the queue. Press Start Automix and listen to how it mixes them: they are made on your device, not recordings.'); }
    catch (e) { say('Could not make the demo tracks: ' + e.message); }
    b.disabled = false;
  };
  $('amfile').onchange = async () => {
    const files = [...$('amfile').files]; $('amfile').value = '';
    for (const f of files) {
      try { say('Analysing ' + f.name + '…'); await addBuffer(await ctx.decodeAudioData(await f.arrayBuffer()), f.name); }
      catch (_) { say('Could not read ' + f.name + '.'); }
    }
    say(queue.length + ' track' + (queue.length === 1 ? '' : 's') + ' in the queue.');
  };
  $('amclear').onclick = () => { stop(); queue.length = 0; paint(); say('Queue cleared.'); };

  /* ---------- pick tracks from the library by itself ---------- */
  const auto = () => !!$('amauto') && $('amauto').checked, used = new Set(); let fetching = false, failed = false;
  try { if (localStorage.getItem('govibe.amauto') === '1') $('amauto').checked = true; } catch (_) { /* no storage */ }
  ['amint', 'amstyle', 'amshape', 'amplay'].forEach((id) => { try { const v = localStorage.getItem('govibe.' + id); if (v && $(id) && [...$(id).options].some((o) => o.value === v)) $(id).value = v; } catch (_) { /* no storage */ } if ($(id)) $(id).addEventListener('change', () => { try { localStorage.setItem('govibe.' + id, $(id).value); } catch (_) { /* ignore */ } }); });
  try { if (localStorage.getItem('govibe.amlive') === '0' && $('amlive')) $('amlive').checked = false; } catch (_) { /* no storage */ }
  if ($('amlive')) $('amlive').onchange = () => { try { localStorage.setItem('govibe.amlive', $('amlive').checked ? '1' : '0'); } catch (_) { /* ignore */ } };
  $('amauto').onchange = () => { try { localStorage.setItem('govibe.amauto', auto() ? '1' : '0'); } catch (_) { /* ignore */ } };
  async function pickFrom(cur, opt) {
    const recs = A.libRecs ? A.libRecs() : []; queue.forEach((q) => { if (q.id) used.add(q.id); });
    const sh = GVMixPlan.shape($('amshape') ? $('amshape').value : 'steady', queue.length), o2 = { used, drift: sh.drift, lift: sh.lift, edrift: sh.edrift, ...opt };
    let i = GVMixPlan.pickNext(cur, recs, o2); if (i < 0 && recs.length > 1) { used.clear(); queue.slice(-1).forEach((q) => { if (q.id) used.add(q.id); }); i = GVMixPlan.pickNext(cur, recs, o2); }
    if (i < 0) return null; const f = await A.libFetch(recs[i]); used.add(f.pre.id);
    return { name: f.name, buf: f.buf, bpm: f.pre.bpm, key: f.pre.key, energy: f.pre.energy, grid: f.pre.grid, id: f.pre.id };
  }
  async function autoPick(cur) {
    if (fetching || failed) return; fetching = true;
    try { const q = await pickFrom(cur); if (!S.on) return; if (!q) { failed = true; return say('Your library has no other tracks to pick from. Add more tracks in the Library tab.'); } queue.push(q); mapOf(q); queue.forEach((x, i) => { if (i < S.idx - 1) x.buf = null; }); paint(); say('Next up, picked from your library: "' + q.name + '"' + (cur && cur.bpm && q.bpm ? ' (' + (q.bpm - cur.bpm >= 0 ? '+' : '') + (q.bpm - cur.bpm).toFixed(0) + ' BPM' + (q.key ? ', ' + q.key : '') + ')' : '') + '.'); }
    catch (_) { failed = true; say('Could not load the next track from the library.'); } finally { fetching = false; }
  }
  async function seedFromLibrary() {
    if ((A.libRecs ? A.libRecs() : []).length < 2) { say('Add at least two tracks to your library first (Library tab), then Automix can choose by itself.'); return false; }
    say('Choosing the first track…'); try { const q = await pickFrom(null, { variety: 1.5 }); if (!q) return false; queue.push(q); paint(); return true; } catch (_) { say('Could not load a track from the library.'); return false; }
  }

  /* ---------- playback control ---------- */
  /* use the rest of the console: level matching on the TRIM knob, and hot cues placed on the intro, drop, outro and peak */
  function prepDeck(d, q) {
    const m = q.buf ? mapOf(q) : null; if (!m) return;
    if (S.ref == null && m.lvl > 0.003) S.ref = m.lvl;
    const db = S.ref && m.lvl > 0.003 ? Math.max(-9, Math.min(9, Math.round(20 * Math.log10(S.ref / m.lvl) * 2) / 2)) : 0;
    d.el.trim.value = db; d.trim.gain.value = Math.pow(10, db / 20);
    if (m.grid) [m.t0, m.drop, m.outro, m.peak].forEach((t, i) => { if (t != null && t > 0.05 && t < m.dur - 2 && d.hot[i] == null) d.hot[i] = t; d.paintHot(); });
  }
  function load(deckIdx, qi, matchTo) {
    const d = decks[deckIdx], q = queue[qi];
    d.setBuffer(q.buf, q.name, { bpm: q.bpm, key: q.key, grid: q.grid });
    d.el.low.value = 0; d.low.gain.value = 0;
    let pct = 0;
    if (matchTo && matchTo.liveBpm && q.bpm) { const p = (matchTo.liveBpm / q.bpm - 1) * 100; if (Math.abs(p) <= 8) pct = +p.toFixed(1); }
    d.el.tempo.value = pct; d.setTempoPct(pct);
    prepDeck(d, q);
  }
  function start(idx = 0, pv = false) {
    if (!queue.length) return say('Add some tracks first.');
    if (!pv) for (let i = queue.length - 1; i >= 0; i--) if (!queue[i].buf) queue.splice(i, 1);
    failed = false; used.clear(); if (!queue.length) return say('Add some tracks first.');
    S.kl = []; if (!$('amkl') || $('amkl').checked) decks.slice(0, 2).forEach((d) => { if (!d.klock) { S.kl.push(d); d.setKeyLock(true); } });
    ctx.resume(); S.on = true; S.preview = pv ? {} : null; S.idx = idx; S.active = 0; S.tr = null; S.plan = null; S.last = null; S.ramp = null; S.inAt = 0; S.ref = null; S.jumped = -1;
    decks.forEach((d) => d.pause());
    load(0, idx, null); xf.value = 0; applyXf(); decks[0].seek(0); decks[0].play();
    if (!pv) noteTrack(queue[0], Date.now()); $('amgo').textContent = '■ Stop Automix'; paint(); say(pv ? 'Preview: finding the mix into "' + queue[idx + 1].name + '"…' : 'Playing "' + queue[0].name + '".');
    clearInterval(S.timer); S.timer = setInterval(tick, 40);
  }
  function preview(i) {
    if (!queue[i] || !queue[i + 1]) return;
    if (!queue[i].buf || !queue[i + 1].buf) return say('Those tracks were already played and cleared from memory. Add them again to preview.');
    if (S.on) stop();
    start(i, true);
  }
  function stop() {
    clearInterval(S.timer); S.preview = null; const was = S.tr; S.on = false; S.tr = null; S.plan = null; $('amgo').textContent = '▶ Start Automix'; killFx(); cancelMove(); endRec(); (S.kl || []).forEach((d) => d.setKeyLock(false)); S.kl = []; if (was && was.vol0) { decks[was.from].el.vol.value = was.vol0[0]; decks[was.from].setVol(); decks[was.to].el.vol.value = was.vol0[1]; decks[was.to].setVol(); } showProg('', 0);
    decks.forEach((d) => { d.low.gain.value = 0; d.el.low.value = 0; if (was) { d.pre.gain.cancelScheduledValues(0); d.pre.gain.value = 1; if (d.loop) { d.loop = null; d.eachSrc((x) => (x.loop = false)); } } }); paint();
  }
  /* record the set: Automix starts the mix recorder, notes when each track enters, and builds a tracklist when it stops */
  const recBtn = () => $('rec'), recOn = () => !!recBtn() && recBtn().classList.contains('rec-on'), stamp = (s) => GVMixPlan.stamp(s);
  function startRec() {
    if (!$('amrec') || !$('amrec').checked || !recBtn() || recOn()) return Promise.resolve();
    return new Promise((res) => { const h = (e) => { if (e.detail.state !== 'start') return; window.removeEventListener('gv-rec', h); S.rec = { t0: e.detail.t, items: [] }; S.recOwn = true; res(); }; window.addEventListener('gv-rec', h); recBtn().click(); setTimeout(() => { window.removeEventListener('gv-rec', h); res(); }, 4000); });
  }
  function noteTrack(q, at) { if (S.rec) S.rec.items.push({ t: (at || Date.now()) - S.rec.t0, name: q.name, bpm: q.bpm, key: q.key }); }
  function endRec() {
    if (!S.recOwn) return; S.recOwn = false; const rec = S.rec; S.rec = null;
    const onStop = (e) => { if (e.detail.state !== 'stop') return; window.removeEventListener('gv-rec', onStop); showRecList(rec); };
    window.addEventListener('gv-rec', onStop); if (recOn()) recBtn().click(); else window.removeEventListener('gv-rec', onStop);
  }
  function showRecList(rec) {
    if (!rec || !rec.items.length) return; const txt = rec.items.map((it, i) => stamp(i === 0 ? 0 : it.t / 1000) + '  ' + GVMixPlan.cleanName(it.name) + (it.bpm ? '  (' + Math.round(it.bpm) + ' BPM' + (it.key ? ', ' + it.key : '') + ')' : it.key ? '  (' + it.key + ')' : '')).join('\n');
    $('amreclist').value = txt; $('amrecbox').classList.remove('hidden'); say('Set recorded. Download it from Record mix at the top, and copy the tracklist below.');
  }
  if ($('amreccopy')) $('amreccopy').onclick = async () => { try { await navigator.clipboard.writeText($('amreclist').value); say('Tracklist copied.'); } catch (_) { $('amreclist').select(); say('Select the text and copy it.'); } };
  $('amgo').onclick = async () => { if (S.on) { stop(); return say('Automix stopped. The decks keep their current state.'); } if (!queue.length && auto() && !(await seedFromLibrary())) return; await startRec(); start(); };

  /* ---------- smart transitions: track maps, a style for each pair, builds and drops ---------- */
  const smart = () => !!$('amsmart') && $('amsmart').checked, style = () => ($('amstyle') ? $('amstyle').value : 'blend'), intensity = () => ($('amint') ? $('amint').value : 'club');
  const mapOf = (q) => q.map || (q.map = window.GVTrackMap ? GVTrackMap.analyze(q.buf, q.grid) : { grid: false, dur: q.buf.duration, drop: null, outro: q.buf.duration - 30, inE: 0.5, outE: 0.5 });
  const NAMES = { blend: 'a bass swap blend', sweep: 'a filter sweep', echo: 'an echo out', cut: 'a quick cut', wash: 'a reverb wash', gate: 'a tremolo gate', riser: 'a riser into the drop', banger: 'a loop build and drop', brake: 'a spin down and drop' };
  const BEATS = { blend: 32, sweep: 32, wash: 24, gate: 16, echo: 16, cut: 2 }, BUILD = { riser: 8, banger: 8, brake: 4 };
  /* the latest 16 beat phrase start (in the track's own seconds) from which a transition of len seconds still finishes before the track ends */
  function phraseStart(d, len, late) {
    if (!d.grid || !d.buf) return null; const p = d.grid.period, ph = 16 * p, lenSrc = len * (d.rate || 1), k = Math.floor((d.buf.duration - 0.7 - lenSrc - d.grid.t0) / ph);
    if (k < 1) return null; const b = d.grid.t0 + k * ph; return b < d.position() - (late == null ? 0.05 : late) ? null : b;
  }
  const resetFx = (d) => {
    d.el.filt.value = 0; d.setFilter(0); d.el.echo.value = 0; d.echoWet.gain.value = 0; d.el.rev.value = 0; d.revWet.gain.value = 0;
    d.pre.gain.cancelScheduledValues(0); d.pre.gain.value = 1; if (d.loop) { d.loop = null; d.eachSrc((x) => (x.loop = false)); }
  };
  const curve = (st, p) => (st === 'cut' ? smooth(p, 0.45, 0.55) : st === 'echo' ? smooth(p, 0.25, 0.6) : p);

  /* synthesised risers and impacts (js/djfx.js, nothing is loaded from anywhere) */
  const nodes = new Set(), track = (list) => list.forEach((x) => { nodes.add(x); x.onended = () => nodes.delete(x); });
  const riser = (t, dur) => track(GVDjFx.riser(ctx, A.master, t, dur)), impact = (t) => track(GVDjFx.impact(ctx, A.master, t)), snareRoll = (t0, tB, bs) => track(GVDjFx.snareRoll(ctx, A.master, t0, tB, bs));
  const killFx = () => { nodes.forEach((x) => { try { x.stop(); } catch (_) { /* done */ } }); nodes.clear(); };

  /* work out how the next transition will go: which style, where to leave the outgoing track, where to come in on the next one */
  function makePlan(mode) {                           // mode: 'auto' (wait for the right moment), 'now' (next phrase), 'skip' (immediately)
    const oq = queue[S.idx], nq = queue[S.idx + 1], out = decks[S.active]; if (!oq || !nq || !nq.buf || !out.buf) return null;
    const om = oq.grid && out.grid ? mapOf(oq) : null, im = nq.grid ? mapOf(nq) : null, grids = !!(om && im && om.grid && im.grid), lo = Math.min(oq.bpm || 1, nq.bpm || 1);
    let st = style();
    if (st === 'auto') st = GVMixPlan.chooseStyle({ grids, gap: oq.bpm && nq.bpm ? GVMixPlan.tempoGap(oq.bpm, nq.bpm) / lo : 0, kc: GVMixPlan.keyCost(oq.key, nq.key), outE: om ? om.outE : 0.5, inE: im ? im.inE : 0.5, hasDrop: !!(im && im.drop != null), dropE: im ? im.dropE : 0, intensity: intensity(), last: S.last });
    if (!grids && BUILD[st]) st = 'sweep';
    if (mode === 'skip' && BUILD[st]) st = 'blend';
    const rate = out.rate || 1, bs = grids ? out.grid.period / rate : 0.5, pre = BUILD[st] || 0, preSec = pre * bs, pos = out.position(), dur = out.buf.duration;
    let len;
    if (BUILD[st]) len = Math.max(0.8, 2 * bs);
    else {
      const am = $('amlen').value, roomy = grids && st === 'blend' && (dur - om.outro) / bs >= 32 && (im.intro - im.t0) / bs >= 32, want = am === 'auto' ? (grids ? (roomy ? 48 : BEATS[st]) * bs : 14) : +am;
      len = Math.max(2, Math.min(want, (dur - pos) / rate - 0.5, nq.buf.duration * 0.5)); if (st === 'cut') len = Math.min(len, Math.max(1, 2 * bs));
    }
    const base = S.inAt || 0, pf = $('amplay') ? $('amplay').value : 'auto', outro = om ? om.outro : dur - 30;
    let tgt = oq.mixOut != null && oq.mixOut > base && oq.mixOut < dur - 1 ? oq.mixOut : pf === 'outro' ? outro : pf === 'auto' ? Math.min(outro, base + 0.68 * (dur - base)) : base + (+pf);
    if (mode === 'auto' && tgt > dur - 1) tgt = null;
    const plan = { for: S.idx, tgt, next: nq, st, pre, preSec, len, bs, B: null, free: false, now: mode === 'now', skip: mode === 'skip', inStart: 0 };
    if (BUILD[st] && im) plan.inStart = nq.mixIn != null && nq.mixIn < nq.buf.duration - 2 ? nq.mixIn : im.drop != null ? im.drop : im.t0;
    if (mode !== 'skip' && grids && smart()) {
      const per = out.grid.period, ph = 16 * per, t0 = out.grid.t0, tail = BUILD[st] ? 3 * per : len * rate + 0.7;
      const minB = pos + preSec * rate + (mode === 'now' ? 0.4 : -0.05), kLo = Math.max(1, Math.ceil((minB - t0) / ph)), kHi = Math.floor((dur - tail - 0.3 - t0) / ph);
      if (kHi >= kLo) {
        let best = kHi; if (mode !== 'now') { let bd = Infinity; for (let k = kLo; k <= kHi; k++) { const dd = Math.abs(t0 + k * ph - (tgt == null ? om.outro : tgt)); if (dd < bd) { bd = dd; best = k; } } } else best = kLo;
        plan.B = t0 + best * ph;
      } else if (mode === 'now') {                      // too close to the end for a phrase: use the next beat
        const kb = Math.ceil((minB - t0) / per); if (t0 + kb * per + tail + 0.3 <= dur) plan.B = t0 + kb * per;
      }
      if (plan.B == null && BUILD[st]) { st = 'sweep'; plan.st = st; plan.pre = plan.preSec = 0; plan.inStart = 0; plan.len = Math.max(2, Math.min(+($('amlen').value === 'auto' ? 12 : $('amlen').value), (dur - pos) / rate - 0.5, nq.buf.duration * 0.5)); }
    } else if (BUILD[st]) plan.free = true;
    return plan;
  }

  /* loop roll on the outgoing deck: the loop always restarts at the same beat, getting shorter each time */
  function roll(T, out, beats) {
    const g = out.grid; if (!g || !out.playing || !out.buf) return;
    if (T.loopStart == null) T.loopStart = g.t0 + Math.floor((out.position() - g.t0) / g.period + 0.03) * g.period;
    if (T.loopStart + beats * g.period > out.buf.duration - 0.05) return;
    out.loop = { start: T.loopStart, end: T.loopStart + beats * g.period }; out.startPos = T.loopStart; out.startCtx = ctx.currentTime; out.play();
  }
  function drop(T, out, inc) {
    out.loop = null; if (out.playing) out.pause(); out.el.rev.value = 55; out.revWet.gain.value = Math.pow(0.55, 1.3) * 1.1;
    inc.el.low.value = 0; inc.low.gain.value = 0; inc.startPos = T.inStart; inc.play(); impact(ctx.currentTime); T.dropped = true;
  }

  /* ---------- live moves while a track plays: echo throws, filter sweeps, bass drops, gates and loop rolls, on the beat ---------- */
  try { if (localStorage.getItem('govibe.amkl') === '0' && $('amkl')) $('amkl').checked = false; } catch (_) { /* no storage */ }
  if ($('amkl')) $('amkl').onchange = () => { try { localStorage.setItem('govibe.amkl', $('amkl').checked ? '1' : '0'); } catch (_) { /* ignore */ } };
  const liveOn = () => !$('amlive') || $('amlive').checked;
  const MOVES = {
    echo: { beats: 4, name: 'an echo throw', step: (d, p) => { const e = Math.round(75 * (p < 0.5 ? 1 : 1 - (p - 0.5) * 2)); d.el.echo.value = e; d.echoWet.gain.value = Math.pow(e / 100, 1.3) * 0.9; } },
    sweep: { beats: 8, name: 'a filter sweep', step: (d, p) => { const v = Math.round(70 * Math.sin(Math.PI * p)); d.el.filt.value = v; d.setFilter(v); } },
    dip: { beats: 4, name: 'a low pass dip', step: (d, p) => { const v = -Math.round(80 * Math.sin(Math.PI * p)); d.el.filt.value = v; d.setFilter(v); } },
    reverb: { beats: 6, name: 'a reverb throw', step: (d, p) => { const r = Math.round(60 * (p < 0.33 ? p / 0.33 : 1 - (p - 0.33) / 0.67)); d.el.rev.value = r; d.revWet.gain.value = Math.pow(r / 100, 1.3) * 1.1; } },
    bass: { beats: 4, name: 'a bass drop out', step: (d, p) => { const v = -26 * smooth(p, 0, 0.06) * (1 - smooth(p, 0.94, 1)); d.low.gain.value = v; d.el.low.value = v; } },
    gate: { beats: 2, name: 'a stutter gate' },
    chop: { beats: 2, name: 'a fader chop', step: (d, p, m) => { const on = Math.floor(p * 8) % 2 === 0; if (m.last !== on) { m.last = on; d.el.vol.value = on ? m.vol0 : Math.round(m.vol0 * 0.08); d.setVol(); } } },
    unit: { beats: 8, name: 'an effect unit swell', step: (d, p) => { d.el.fxamt.value = Math.round(80 * Math.sin(Math.PI * p)); d.fxAmount(); } },
    cuejump: { beats: 1, name: 'a hot cue jump back to the drop' },
    sampler: { beats: 4, name: 'a sampler pad fill' },
    roll: { beats: 4.3, name: 'a loop roll' },
  };
  const WEIGHT = { smooth: { echo: 3, sweep: 3, dip: 2 }, club: { echo: 3, sweep: 3, dip: 2, reverb: 2, bass: 2, gate: 1, chop: 1, unit: 2, sampler: 1 }, banger: { echo: 2, sweep: 3, dip: 2, reverb: 2, bass: 2, gate: 2, roll: 4, chop: 2, unit: 2, sampler: 3, cuejump: 1.5 } }, PROB = { smooth: 0.12, club: 0.3, banger: 0.5 };
  function cancelMove() {
    const m = S.mv; if (!m) return; S.mv = null; const d = m.d;
    d.el.filt.value = 0; d.setFilter(0); d.el.echo.value = 0; d.echoWet.gain.value = 0; d.el.rev.value = 0; d.revWet.gain.value = 0; d.low.gain.value = 0; d.el.low.value = 0;
    d.pre.gain.cancelScheduledValues(0); d.pre.gain.value = 1; if (d.slip) d.rollEnd();
    if (m.vol0 != null) { d.el.vol.value = m.vol0; d.setVol(); }
    if (m.unit) { d.el.fxamt.value = 0; d.fxAmount(); d.el.fxtype.value = ''; d.setFx(''); }
  }
  function padHit(name) { const b = [...($('pads') ? $('pads').children : [])].find((x) => x.textContent === name); if (!b) return; b.click(); b.classList.add('on'); setTimeout(() => b.classList.remove('on'), 160); }
  function rollPad(d, beats) {
    const b = d.el[{ 1: 'r1', 0.5: 'r2', 0.25: 'r4' }[beats]]; if (d.rollBtn && d.rollBtn !== b) { d.rollBtn.classList.remove('on'); d.rollBtn.setAttribute('aria-pressed', 'false'); }
    d.rollStart(beats, b);
  }
  function startMove(d, key) {
    cancelMove(); const M = MOVES[key], bs = d.grid.period / (d.rate || 1), now = ctx.currentTime, m = S.mv = { key, d, t0: now, dur: M.beats * bs, ev: [], bs }; S.moves = (S.moves || 0) + 1; S.mvLast = key;
    if (key === 'gate') { const g = d.pre.gain, step = bs / 4, N = Math.round(2 * bs / step); g.cancelScheduledValues(now); for (let k = 0; k < N; k++) { const t = now + k * step; g.setValueAtTime(1, t); g.setValueAtTime(0.12, t + step / 2); } g.setValueAtTime(1, now + N * step); }
    if (key === 'roll') m.ev.push({ at: now, fn: () => rollPad(d, 1) }, { at: now + 2 * bs, fn: () => rollPad(d, 0.5) }, { at: now + 3 * bs, fn: () => rollPad(d, 0.25) }, { at: now + 4 * bs, fn: () => d.rollEnd() });
    if (key === 'chop') m.vol0 = +d.el.vol.value;
    if (key === 'unit') { m.unit = true; const t = ['chorus', 'delay', 'sat', 'reverb'][Math.floor(Math.random() * 4)]; d.el.fxtype.value = t; d.setFx(t); d.el.fxamt.value = 0; d.fxAmount(); }
    if (key === 'cuejump') { m.ev.push({ at: now, fn: () => d.hotCue(1) }); S.jumped = S.idx; }
    if (key === 'sampler') { const horn = Math.random() < 0.35; if (horn) m.ev.push({ at: now, fn: () => padHit('Horn') }); else [1, 3].forEach((k) => m.ev.push({ at: now + k * bs, fn: () => padHit('Clap') })); }
    say('Live move: ' + M.name + '.');
  }
  function stepMove() {
    const m = S.mv, now = ctx.currentTime; while (m.ev.length && m.ev[0].at <= now + 0.02) m.ev.shift().fn();
    const p = (now - m.t0) / m.dur; if (p >= 1) return cancelMove(); const M = MOVES[m.key]; if (M.step) M.step(m.d, p, m);
  }
  function liveStep(d, plan) {
    if (S.mv) return stepMove();
    if (!liveOn() || !d.playing || !d.grid || !d.buf) return;
    const g = d.grid, rate = d.rate || 1, bs = g.period / rate, pos = d.position(), x = (pos - g.t0) / g.period, bi = Math.floor(x + 0.02);
    if (bi < 16 || bi % 8 !== 0 || bi === S.mvBeat) return; S.mvBeat = bi; if (x - bi > 0.3) return;
    const left = plan && plan.B != null ? (plan.B - plan.preSec * rate - pos) / rate : plan && plan.tgt != null ? (plan.tgt - pos) / rate : (d.buf.duration - pos) / rate - 20;
    if (left < 14 * bs) return;
    const lvl = intensity(), w = WEIGHT[lvl] || WEIGHT.club; if (Math.random() > (S.mvProb != null ? S.mvProb : /[?&]gvtest\b/.test(location.search) ? 0 : PROB[lvl] || 0.3)) return;
    const keys = Object.keys(w), tot = keys.reduce((a, k) => a + w[k] * (k === S.mvLast ? 0.2 : 1), 0); let r = Math.random() * tot, pick = keys[0];
    for (const k of keys) { r -= w[k] * (k === S.mvLast ? 0.2 : 1); if (r <= 0) { pick = k; break; } }
    if (pick === 'cuejump') { const m0 = q0map(); if (!(d.hot[1] != null && S.jumped !== S.idx && m0 && pos - d.hot[1] >= 32 * g.period)) pick = 'echo'; }
    startMove(d, pick);
  }
  const q0map = () => (queue[S.idx] && queue[S.idx].buf ? mapOf(queue[S.idx]) : null);

  function beginTransition(plan) {
    cancelMove();
    const out = decks[S.active], inc = decks[1 - S.active], ni = S.idx + 1, st = plan.st, now = ctx.currentTime;
    load(1 - S.active, ni, out);
    const T = { t0: now, len: plan.len, from: S.active, to: 1 - S.active, ni, st, ev: [], bs: plan.bs, pre: plan.preSec };
    if (BUILD[st]) {
      const toB = plan.B != null ? Math.max(0.05, (plan.B - out.position()) / (out.rate || 1)) : plan.preSec;
      T.tB = now + toB; T.t0 = T.tB; T.build = true; T.inStart = plan.inStart; T.inAt = plan.inStart; T.preSec = Math.min(plan.preSec, toB);
      if (st !== 'brake') { riser(now, toB); snareRoll(now + Math.max(0, toB - 4 * plan.bs), T.tB - 0.35 * plan.bs, plan.bs); }
      T.ev.push({ at: T.tB, fn: () => drop(T, out, inc) });
      if (st === 'banger') [[4, 2], [2, 1], [1, 0.5], [0.5, 0.25]].forEach(([before, len]) => { if (before * plan.bs <= toB) T.ev.push({ at: T.tB - before * plan.bs, fn: () => roll(T, out, len) }); });
      if (st !== 'brake' && 0.35 * plan.bs < toB) T.ev.push({ at: T.tB - 0.35 * plan.bs, fn: () => { out.loop = null; out.pause(); } });   // a breath of near silence before the drop
      if (st === 'brake') T.brake = Math.min(toB, 1.6 * plan.bs);
      T.ev.sort((a, b) => a.at - b.at);
    } else {
      let s0 = queue[ni].mixIn != null && queue[ni].mixIn < inc.buf.duration - 2 ? queue[ni].mixIn : 0; if (out.grid && inc.grid) s0 = (queue[ni].mixIn != null ? inc.grid.t0 + Math.round((s0 - inc.grid.t0) / inc.grid.period) * inc.grid.period : inc.grid.t0) + out.beatFrac() * inc.grid.period;   // start on the same point in the beat
      inc.seek(s0); inc.play(); T.inAt = s0;
      if (st === 'gate') {                                                // a volume gate chopping the outgoing track, getting deeper
        const g = out.pre.gain, step = plan.bs / 2, N = Math.floor(T.len / step); g.cancelScheduledValues(now);
        for (let k = 0; k < N; k++) { const t = now + k * step; g.setValueAtTime(1, t); g.setValueAtTime(Math.max(0.08, 1 - 0.95 * (k / N)), t + step / 2); }
        g.setValueAtTime(1, now + T.len + 0.05);
      }
    }
    T.vol0 = [+out.el.vol.value, +inc.el.vol.value];
    noteTrack(queue[ni], Date.now() + (BUILD[st] ? (T.tB - now) * 1000 : 0));
    S.tr = T; S.last = st; S.plan = null; S.ramp = null;
    say('Mixing into "' + queue[ni].name + '" with ' + NAMES[st] + (BUILD[st] ? ' (dropping on its ' + (plan.inStart > 1 ? 'drop' : 'first beat') + ')' : '') + '…');
  }
  function endTransition(T, out, inc) {
    out.pause(); resetFx(inc); const quiet = T.build || T.st === 'echo' || T.st === 'wash';
    setTimeout(() => resetFx(out), quiet ? 2500 : 0);
    if (T.vol0) { out.el.vol.value = T.vol0[0]; out.setVol(); inc.el.vol.value = T.vol0[1]; inc.setVol(); }
    [out, inc].forEach((d) => { d.low.gain.value = 0; d.el.low.value = 0; d.mid.gain.value = 0; d.el.mid.value = 0; d.high.gain.value = 0; d.el.high.value = 0; });
    const pct = +inc.el.tempo.value; S.ramp = Math.abs(pct) > 0.3 && T.bs ? { deck: inc, from: pct, t0: ctx.currentTime, dur: Math.max(4, 16 * T.bs) } : null;   // ease the new track back to its own tempo
    if (S.preview) S.preview.endAt = ctx.currentTime + 6;
    S.active = T.to; S.idx = T.ni; S.tr = null; S.inAt = T.inAt || 0; paint(); say('Playing "' + queue[S.idx].name + '".');
  }
  function stepBuild(T, now, out, inc) {
    if (now < T.tB) {                                                      // the build: filter rising, echo and bass cut, loops rolling
      const pb = Math.min(1, Math.max(0, 1 - (T.tB - now) / T.preSec)), hp = Math.round(65 * smooth(pb, 0, 1)), e = Math.round(70 * smooth(pb, 0.45, 1)), lw = -26 * smooth(pb, 0.55, 0.8);
      if (T.brake && now > T.tB - T.brake) { const q = (now - (T.tB - T.brake)) / T.brake; out.el.tempo.value = -Math.round(96 * q * q); out.setTempoPct(-96 * q * q); }
      out.el.filt.value = hp; out.setFilter(hp); out.el.echo.value = e; out.echoWet.gain.value = Math.pow(e / 100, 1.3) * 0.9; out.low.gain.value = lw; out.el.low.value = lw; return;
    }
    if (!T.dropped) drop(T, out, inc);
    const p = Math.min(1, (now - T.tB) / T.len), x = smooth(p, 0, 0.85); xf.value = Math.round((T.to === 1 ? x : 1 - x) * 100); applyXf();
    out.el.echo.value = 100; out.echoWet.gain.value = 0.9;
    if (p >= 1) endTransition(T, out, inc);
  }
  function stepTransition() {
    const T = S.tr, now = ctx.currentTime, out = decks[T.from], inc = decks[T.to];
    while (T.ev.length && T.ev[0].at <= now + 0.02) T.ev.shift().fn();
    if (T.build) return stepBuild(T, now, out, inc);
    const p = Math.min(1, (now - T.t0) / T.len), pc = curve(T.st, p), x = T.to === 1 ? pc : 1 - pc;
    xf.value = Math.round(x * 100); applyXf();
    const outLow = -26 * smooth(p, 0.35, 0.7), inLow = -26 * (1 - smooth(p, 0.1, 0.5));
    if (T.st === 'sweep') { const fo = Math.round(100 * smooth(p, 0.1, 0.9)), fi = -Math.round(100 * (1 - smooth(p, 0, 0.7))); out.el.filt.value = fo; out.setFilter(fo); inc.el.filt.value = fi; inc.setFilter(fi); }
    else if (T.st === 'echo') { const e = Math.round(85 * smooth(p, 0.05, 0.3)); out.el.echo.value = e; out.echoWet.gain.value = Math.pow(e / 100, 1.3) * 0.9; }
    else if (T.st === 'wash') {
      const r = Math.round(90 * smooth(p, 0.05, 0.5)), lpv = -Math.round(85 * smooth(p, 0.15, 0.95)); out.el.rev.value = r; out.revWet.gain.value = Math.pow(r / 100, 1.3) * 1.1; out.el.filt.value = lpv; out.setFilter(lpv);
      const fi = -Math.round(60 * (1 - smooth(p, 0, 0.6))); inc.el.filt.value = fi; inc.setFilter(fi);
    }
    out.low.gain.value = outLow; out.el.low.value = outLow; inc.low.gain.value = inLow; inc.el.low.value = inLow;
    if (T.vol0 && (T.st === 'blend' || T.st === 'gate' || T.st === 'wash' || T.st === 'sweep')) {   // ride the channel faders: the new one comes up, the old one is pulled down at the end
      const vo = Math.round(T.vol0[0] * (1 - smooth(p, 0.8, 1))), vi = Math.round(T.vol0[1] * (0.7 + 0.3 * smooth(p, 0, 0.5)));
      out.el.vol.value = vo; out.setVol(); inc.el.vol.value = vi; inc.setVol();
    }
    if (T.st === 'blend' || T.st === 'gate') { const oh = -16 * smooth(p, 0.5, 0.95), om = -8 * smooth(p, 0.6, 0.95), ih = -14 * (1 - smooth(p, 0.05, 0.45)); out.high.gain.value = oh; out.el.high.value = oh; out.mid.gain.value = om; out.el.mid.value = om; inc.high.gain.value = ih; inc.el.high.value = ih; }
    if (p >= 1) endTransition(T, out, inc);
  }
  let lastTxt = '';
  function showProg(txt, pct) { const el = $('amcount'), pr = $('amprog'); if (el && txt !== lastTxt) { el.textContent = txt; lastTxt = txt; } if (pr) pr.value = pct; }
  function tick() {
    if (!S.on) return showProg('', 0);
    if (S.preview && S.preview.endAt && ctx.currentTime >= S.preview.endAt) { stop(); return say('Preview finished. Press it again to hear another take.'); }
    if (S.tr) { const T = S.tr, now = ctx.currentTime, tot = (T.build ? T.preSec : 0) + T.len, el = now - (T.build ? T.tB - T.preSec : T.t0); showProg('Mixing into "' + queue[T.ni].name + '" · ' + NAMES[T.st] + ' · ' + Math.max(0, Math.min(100, Math.round(100 * el / tot))) + '%', Math.max(0, Math.min(100, 100 * el / tot))); return stepTransition(); }
    if (S.ramp) { const R = S.ramp, p = Math.min(1, (ctx.currentTime - R.t0) / R.dur), v = +(R.from * (1 - smooth(p, 0, 1))).toFixed(2); R.deck.el.tempo.value = v; R.deck.setTempoPct(v); if (p >= 1) { S.ramp = null; S.plan = null; } }
    const d = decks[S.active], rem = d.buf.duration - d.position() * 1;
    const remReal = rem / d.rate;
    if (S.idx + 1 >= queue.length && auto() && !failed && !S.preview) { autoPick(queue[queue.length - 1]); return; }
    if (S.idx + 1 >= queue.length) { if (!d.playing && d.position() < 0.1) { stop(); say('Automix finished.'); } return; }
    let plan = S.plan; if (!plan || plan.for !== S.idx || plan.next !== queue[S.idx + 1]) { plan = S.plan = makePlan('auto'); if (plan) say('Next: ' + NAMES[plan.st] + ' into "' + queue[S.idx + 1].name + '".'); }
    if (!plan) return;
    if (S.preview && !S.preview.seeked && d.playing) {   // jump to a few bars before the mix so the preview is short
      S.preview.seeked = true; const r = d.rate || 1;
      const to = Math.max(0, plan.B != null ? plan.B - (plan.preSec + 8) * r : plan.tgt != null ? plan.tgt - 8 * r : d.buf.duration - (plan.len + 8) * r);
      d.seek(to); say('Preview: ' + NAMES[plan.st] + ' into "' + queue[S.idx + 1].name + '".'); return;
    }
    if (!S.preview) liveStep(d, plan);
    { const pos0 = d.position(), left = plan.B != null ? (plan.B - plan.preSec * (d.rate || 1) - pos0) / (d.rate || 1) : plan.tgt != null ? (plan.tgt - pos0) / (d.rate || 1) : remReal - plan.len; showProg('Now playing "' + queue[S.idx].name + '" · next mix in ' + fmt(Math.max(0, left)) + ' (' + NAMES[plan.st] + ')', 0); }
    if (plan.B != null && d.playing && d.grid) {
      const at = plan.B - plan.preSec * (d.rate || 1), pos = d.position();
      if (pos > plan.B + 3 && !plan.now) { S.plan = null; return; }                                  // jumped past it: plan again
      if (pos >= at - 0.05) beginTransition(plan);
      return;
    }
    if (plan.now && plan.B == null && !BUILD[plan.st]) return beginTransition(plan);
    if (plan.B == null && plan.tgt != null && !plan.free && d.playing && d.position() >= plan.tgt && !BUILD[plan.st]) return beginTransition(plan);
    const need = BUILD[plan.st] ? plan.preSec + 3 * plan.bs + 0.8 : plan.len + 0.6;
    if (remReal <= need || !d.playing) beginTransition(plan);
  }
  $('amskip').onclick = () => {
    if (!S.on) return say('Start Automix first.');
    if (S.tr) return; if (S.idx + 1 >= queue.length) return say(auto() ? 'Picking the next track. Try again in a moment.' : 'This is the last track.');
    const plan = makePlan('skip'); if (plan) { plan.len = Math.min(plan.len, 8); beginTransition(plan); }
  };
  if ($('ammix')) $('ammix').onclick = () => {
    if (!S.on) return say('Start Automix first.');
    if (S.tr) return; if (S.idx + 1 >= queue.length) return say(auto() ? 'Picking the next track. Try again in a moment.' : 'This is the last track.');
    const plan = makePlan('now'); if (!plan) return; S.plan = plan;
    say(plan.B != null ? 'Mixing at the next phrase with ' + NAMES[plan.st] + '.' : 'Mixing now with ' + NAMES[plan.st] + '.');
  };

  A.amQueue = queue; A.amPaint = paint; A.amState = S;
  if (/[?&]gvtest\b/.test(location.search)) window.__am = { queue, S, addBuffer, used, phraseStart, makePlan, mapOf, roll, startMove, MOVES, stepMove, prepDeck };   // test hook
})();
