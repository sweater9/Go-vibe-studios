/* Go Vibe Studios — DJ library: tracks saved in this browser (IndexedDB) with BPM, key, beat grid and cue points */
(() => {
  const A = window.GVAudio; if (!A || !window.GVStore || !indexedDB) return;
  const { ctx, decks, detectBPM, detectGrid, detectKey, keysMatch } = A, $ = (id) => document.getElementById(id);
  const pane = $('pane-lib'), RK = 'govibe.libremember';
  const remember = () => { try { return localStorage.getItem(RK) !== '0'; } catch (_) { return true; } };
  let recs = [], sortBy = 'added', query = '', minRate = 0, tagF = '', busy = false;

  /* ---------- UI ---------- */
  pane.insertAdjacentHTML('beforeend', `
    <div class="row libbar" style="align-items:flex-end;margin:10px 0">
      <button class="btn primary" id="libadd">Add tracks…</button>
      <input type="file" id="libfile" accept="audio/*" multiple hidden aria-label="Add tracks to the library">
      <label class="ctl" style="min-width:160px">Search<input type="text" id="libq" placeholder="Title" autocomplete="off"></label>
      <label class="ctl" style="min-width:0">Sort by
        <select id="libsort" class="mini"><option value="added">Recently added</option><option value="played">Recently played</option><option value="name">Title</option><option value="bpm">BPM</option><option value="key">Key</option><option value="rating">Rating</option><option value="m0">Best match for deck A</option><option value="m1">Best match for deck B</option></select>
      </label>
      <label class="ctl" style="min-width:0">Rating
        <select id="libminrate" class="mini" aria-label="Minimum rating"><option value="0">Any</option><option value="3">3 ★ and up</option><option value="4">4 ★ and up</option><option value="5">5 ★ only</option></select>
      </label>
      <label class="ctl" style="min-width:0">Tag
        <select id="libtagf" class="mini" aria-label="Filter by tag"><option value="">All</option><option value="red">Red</option><option value="orange">Orange</option><option value="green">Green</option><option value="blue">Blue</option><option value="purple">Purple</option></select>
      </label>
      <label class="row time" style="gap:6px"><input type="checkbox" id="libkeep"> Remember tracks I load into a deck</label>
    </div>
    <div class="row" style="margin-bottom:8px" role="group" aria-label="Backup">
      <button class="btn mini" id="libexpzip">Export backup (.zip, with audio)</button>
      <button class="btn mini" id="libexpjson">Export data only (.json)</button>
      <button class="btn mini" id="libimp">Import backup…</button>
      <input type="file" id="libimpfile" accept=".zip,.json,application/zip,application/json" hidden aria-label="Import a library backup">
    </div>
    <p class="status" id="libstatus" role="status"></p>
    <div class="libwrap"><table class="libtbl" aria-label="Library tracks"><thead><tr><th scope="col">Title</th><th scope="col">BPM</th><th scope="col">Key</th><th scope="col">Length</th><th scope="col">Rating</th><th scope="col">Tag</th><th scope="col">Notes</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody id="libbody"></tbody></table></div>
    <p class="status" id="libstore"></p>`);
  $('libkeep').checked = remember();
  $('libkeep').onchange = () => { try { localStorage.setItem(RK, $('libkeep').checked ? '1' : '0'); } catch (_) {} };
  const say = (t) => { $('libstatus').textContent = t; };
  const mmss = (s) => Math.floor(s / 60) + ':' + String(Math.round(s % 60)).padStart(2, '0').replace(/^60$/, '59');

  const score = (r, d) => {                       // lower = better match for deck d
    const t = d.liveBpm; if (!t || !r.bpm) return 1e3;
    let ratio = r.bpm / t; ratio = Math.min(Math.abs(ratio - 1), Math.abs(ratio * 2 - 1), Math.abs(ratio / 2 - 1));
    const k = keysMatch(d.key, r.key); return ratio * 100 + (k === 'clash' ? 6 : k === null ? 3 : 0);
  };
  function visible() {
    const qq = query.toLowerCase(); let v = recs.filter((r) => (r.name.toLowerCase().includes(qq) || (r.notes || '').toLowerCase().includes(qq)) && (r.rating || 0) >= minRate && (!tagF || r.tag === tagF));
    const cmp = { added: (a, b) => b.added - a.added, played: (a, b) => (b.played || 0) - (a.played || 0), name: (a, b) => a.name.localeCompare(b.name), bpm: (a, b) => (a.bpm || 1e3) - (b.bpm || 1e3), rating: (a, b) => (b.rating || 0) - (a.rating || 0), key: (a, b) => (a.key || 'zz').localeCompare(b.key || 'zz', undefined, { numeric: true }) };
    if (sortBy === 'm0' || sortBy === 'm1') { const d = decks[+sortBy[1]]; v.sort((a, b) => score(a, d) - score(b, d)); } else v.sort(cmp[sortBy]);
    return v;
  }
  function render() {
    const tb = $('libbody'); tb.innerHTML = '';
    const list = visible();
    if (!list.length) { const tr = tb.insertRow(), td = tr.insertCell(); td.colSpan = 8; td.textContent = recs.length ? 'No tracks match your search.' : 'No tracks yet. Add some, or load a track into a deck with "Remember tracks" ticked.'; td.className = 'libempty'; }
    list.forEach((r) => {
      const tr = tb.insertRow(); tr.dataset.id = r.id; if (r.missing) tr.classList.add('libmissing');
      const c0 = tr.insertCell(); c0.className = 'libname'; c0.textContent = r.name;
      if (r.missing) { const m = document.createElement('span'); m.className = 'libmatch warn'; m.textContent = 'audio missing — add the file'; c0.appendChild(m); }
      const marks = decks.map((d, i) => (d.buf && score(r, d) < 6 ? 'A B'.split(' ')[i] : '')).filter(Boolean);
      if (marks.length) { const m = document.createElement('span'); m.className = 'libmatch'; m.textContent = 'fits ' + marks.join(' + '); m.title = 'Close in tempo and key to what is loaded on that deck'; c0.appendChild(m); }
      tr.insertCell().textContent = r.bpm ? r.bpm.toFixed(1) : '—';
      tr.insertCell().textContent = r.key || '—';
      tr.insertCell().textContent = mmss(r.dur);
      const cr = tr.insertCell(); cr.className = 'libstars'; cr.setAttribute('role', 'group'); cr.setAttribute('aria-label', 'Rating for ' + r.name);
      for (let s = 1; s <= 5; s++) { const b = document.createElement('button'); b.className = 'star'; b.textContent = '★'; b.setAttribute('aria-label', s + (s === 1 ? ' star' : ' stars')); b.setAttribute('aria-pressed', (r.rating || 0) >= s ? 'true' : 'false'); b.onclick = () => setRating(r, (r.rating || 0) === s ? 0 : s); cr.appendChild(b); }
      const ct = tr.insertCell(); const ts = document.createElement('select'); ts.className = 'mini libtag'; ts.setAttribute('aria-label', 'Tag colour for ' + r.name);
      [['', 'None'], ['red', 'Red'], ['orange', 'Orange'], ['green', 'Green'], ['blue', 'Blue'], ['purple', 'Purple']].forEach(([v, t]) => ts.add(new Option(t, v))); ts.value = r.tag || '';
      ts.onchange = async () => { r.tag = ts.value; try { await GVStore.lib.put(r); } catch (_) {} render(); }; ct.appendChild(ts);
      if (r.tag) tr.classList.add('tag-' + r.tag);
      const cn = tr.insertCell(); const ni = document.createElement('input'); ni.type = 'text'; ni.className = 'libnote'; ni.maxLength = 200; ni.value = r.notes || ''; ni.placeholder = 'Add a note'; ni.setAttribute('aria-label', 'Notes for ' + r.name);
      ni.onchange = async () => { r.notes = ni.value.trim(); try { await GVStore.lib.put(r); } catch (_) {} }; cn.appendChild(ni);
      const ac = tr.insertCell(); ac.className = 'libact';
      [['→ A', () => loadTo(0, r), 'Load "' + r.name + '" into deck A'], ['→ B', () => loadTo(1, r), 'Load "' + r.name + '" into deck B'], ['+ Queue', () => queueIt(r), 'Add "' + r.name + '" to the Automix queue'], ['✕', () => remove(r), 'Remove "' + r.name + '" from the library']].forEach(([t, fn, label]) => {
        const b = document.createElement('button'); b.className = 'btn mini'; b.textContent = t; b.setAttribute('aria-label', label); b.onclick = fn;
        if (r.missing && t !== '✕') { b.disabled = true; b.title = 'The audio is not in this browser. Add the file to restore it.'; } ac.appendChild(b);
      });
    });
    usage();
  }
  async function usage() {
    try { const e = await navigator.storage.estimate(), tot = recs.reduce((a, r) => a + r.size, 0); $('libstore').textContent = recs.length + ' track' + (recs.length === 1 ? '' : 's') + ', ' + (tot / 1048576).toFixed(1) + ' MB stored in this browser' + (e && e.quota ? ' (browser allows about ' + Math.round(e.quota / 1048576) + ' MB)' : '') + '.'; } catch (_) { $('libstore').textContent = ''; }
  }
  async function reload() { try { recs = await GVStore.lib.all(); } catch (_) { recs = []; say('Could not open the library in this browser.'); } render(); }

  /* ---------- data ---------- */
  const idOf = (f) => f.name + '|' + f.size;
  const bkey = (id) => 'lib:' + id;
  async function save(rec, blob) {
    if (blob) await GVStore.put(bkey(rec.id), blob);
    await GVStore.lib.put(rec);
    const i = recs.findIndex((r) => r.id === rec.id); if (i >= 0) recs[i] = rec; else recs.push(rec);
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (_) {}
  }
  async function addFiles(files) {
    if (busy) return say('Still analysing. Wait a moment.'); busy = true;
    let n = 0;
    for (const f of files) {
      try {
        const id = idOf(f), have = recs.find((r) => r.id === id);
        if (have && have.missing) { delete have.missing; await save(have, f); n++; render(); continue; }
        if (have) { say(f.name + ' is already in the library.'); continue; }
        say('Analysing ' + f.name + '…'); await new Promise((r) => setTimeout(r, 20));
        const buf = await ctx.decodeAudioData(await f.arrayBuffer()), b0 = detectBPM(buf), grid = b0 ? detectGrid(buf, b0) : null;
        await save({ id, name: f.name, size: f.size, dur: buf.duration, bpm: grid ? grid.bpm : b0, key: detectKey(buf), grid, cues: [null, null, null, null], rating: 0, tag: '', notes: '', added: Date.now(), played: 0 }, f);
        n++; render();
      } catch (_) { say('Could not read ' + f.name + '.'); }
    }
    busy = false; if (n) say('Added ' + n + ' track' + (n === 1 ? '' : 's') + '.'); render(); return n;
  }
  async function setRating(r, n) { r.rating = n; try { await GVStore.lib.put(r); } catch (_) {} render(); }
  async function decode(rec) { const blob = await GVStore.get(bkey(rec.id)); if (!blob) throw new Error('missing'); return ctx.decodeAudioData(await blob.arrayBuffer()); }
  async function loadTo(i, rec) {
    try {
      say('Loading ' + rec.name + '…'); const buf = await decode(rec), d = decks[i];
      d.setBuffer(buf, rec.name, { bpm: rec.bpm, key: rec.key, grid: rec.grid ? { ...rec.grid } : null });
      d.hot = (rec.cues || [null, null, null, null]).slice(); d.paintHot(); d.libId = rec.id; d.gridInfo();
      rec.played = Date.now(); GVStore.lib.put(rec); say('Loaded "' + rec.name + '" into deck ' + d.name + '.'); render();
    } catch (_) { say('Could not load that track. It may have been cleared from this browser.'); }
  }
  async function queueIt(rec) { try { const buf = await decode(rec); A.queueAdd(buf, rec.name, { bpm: rec.bpm, key: rec.key, grid: rec.grid }); say('Queued "' + rec.name + '".'); } catch (_) { say('Could not queue that track.'); } }
  async function remove(rec) { await GVStore.lib.del(rec.id); await GVStore.del(bkey(rec.id)); recs = recs.filter((r) => r.id !== rec.id); decks.forEach((d) => { if (d.libId === rec.id) d.libId = null; }); render(); say('Removed.'); }

  /* ---------- backup / restore ---------- */
  const meta = (r) => ({ id: r.id, name: r.name, size: r.size, dur: r.dur, bpm: r.bpm, key: r.key, grid: r.grid, cues: r.cues, rating: r.rating || 0, tag: r.tag || '', notes: r.notes || '', added: r.added, played: r.played || 0 });
  const exportData = () => ({ app: 'go-vibe-studios', version: 1, exported: new Date().toISOString(), tracks: recs.map(meta) });
  const jsonBlob = (o) => new Blob([JSON.stringify(o, null, 1)], { type: 'application/json' });
  async function exportZip() {
    const data = exportData(), entries = [];
    for (const [i, t] of data.tracks.entries()) {
      const r = recs.find((x) => x.id === t.id); if (r.missing) continue;
      const blob = await GVStore.get(bkey(r.id)); if (!blob) continue;
      t.file = 'audio/' + String(i + 1).padStart(3, '0') + '-' + r.name.replace(/[^\w.\- ]+/g, '_'); entries.push({ name: t.file, blob });
    }
    entries.unshift({ name: 'library.json', blob: jsonBlob(data) });
    return GVZip.write(entries);
  }
  function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
  const stamp = () => new Date().toISOString().slice(0, 10);
  async function importFile(file) {
    let data, files = {};
    if (/\.json$/i.test(file.name) || file.type === 'application/json') data = JSON.parse(await file.text());
    else { for (const e of await GVZip.read(file)) files[e.name] = e; if (!files['library.json']) throw new Error('library.json is missing'); data = JSON.parse(await (await files['library.json'].blob()).text()); }
    if (!data || data.app !== 'go-vibe-studios' || !Array.isArray(data.tracks)) throw new Error('This is not a Go Vibe Studios library backup');
    let withAudio = 0, metaOnly = 0, updated = 0;
    for (const t of data.tracks) {
      if (!t.id || !t.name) continue;
      const have = recs.find((r) => r.id === t.id), rec = { ...meta(t), cues: Array.isArray(t.cues) ? t.cues.slice(0, 4) : [null, null, null, null] };
      const entry = t.file && files[t.file];
      if (have && !have.missing) { Object.assign(have, rec, { missing: false }); delete have.missing; await GVStore.lib.put(have); updated++; continue; }
      if (entry) { await save(rec, await entry.blob()); withAudio++; } else { rec.missing = true; await save(rec, null); metaOnly++; }
    }
    render(); return { withAudio, metaOnly, updated };
  }
  $('libexpzip').onclick = async () => { if (!recs.length) return say('Nothing to export yet.'); say('Building the backup…'); try { download(await exportZip(), 'govibe-library-' + stamp() + '.zip'); say('Backup downloaded. Keep it somewhere safe; it contains your audio.'); } catch (e) { say('Could not build the backup: ' + e.message); } };
  $('libexpjson').onclick = () => { if (!recs.length) return say('Nothing to export yet.'); download(jsonBlob(exportData()), 'govibe-library-' + stamp() + '.json'); say('Saved BPM, keys, cues, ratings, tags and notes (no audio).'); };
  $('libimp').onclick = () => $('libimpfile').click();
  $('libimpfile').onchange = async () => {
    const f = $('libimpfile').files[0]; $('libimpfile').value = ''; if (!f) return;
    try { say('Importing…'); const r = await importFile(f); say('Imported: ' + r.withAudio + ' with audio, ' + r.updated + ' updated' + (r.metaOnly ? ', ' + r.metaOnly + ' waiting for their audio files (add the files to restore them)' : '') + '.'); } catch (e) { say('Could not import: ' + e.message); }
  };

  /* ---------- hooks from the decks ---------- */
  A.onFile = async (d, file) => {                                  // a file was loaded straight into a deck
    try {
      const id = idOf(file), have = recs.find((r) => r.id === id);
      if (have && have.missing) { delete have.missing; await save(have, file); }
      if (have) { d.libId = id; if (have.grid) { d.grid = { ...have.grid }; d.bpm = have.grid.bpm; d.updateBpm(); d.gridInfo(); } d.hot = (have.cues || [null, null, null, null]).slice(); d.paintHot(); have.played = Date.now(); GVStore.lib.put(have); render(); return; }
      if (!remember()) return;
      await save({ id, name: file.name, size: file.size, dur: d.buf.duration, bpm: d.bpm, key: d.key, grid: d.grid ? { ...d.grid } : null, cues: d.hot.slice(), rating: 0, tag: '', notes: '', added: Date.now(), played: Date.now() }, file);
      d.libId = id; render();
    } catch (_) { /* storage full or blocked: the track still plays */ }
  };
  const timers = {};
  A.onChange = (d) => {                                            // cues or grid edited: save them with the track
    if (!d.libId) return; clearTimeout(timers[d.libId]);
    timers[d.libId] = setTimeout(async () => { const r = recs.find((x) => x.id === d.libId); if (!r) return; r.cues = d.hot.slice(); r.grid = d.grid ? { ...d.grid } : null; try { await GVStore.lib.put(r); } catch (_) {} }, 250);
  };

  /* ---------- events ---------- */
  $('libadd').onclick = () => $('libfile').click();
  $('libfile').onchange = () => { const f = [...$('libfile').files]; $('libfile').value = ''; addFiles(f); };
  $('libq').oninput = () => { query = $('libq').value; render(); };
  $('libminrate').onchange = () => { minRate = +$('libminrate').value; render(); };
  $('libtagf').onchange = () => { tagF = $('libtagf').value; render(); };
  $('libsort').onchange = () => { sortBy = $('libsort').value; render(); };
  const audioOnly = (dt) => [...(dt.files || [])].filter((f) => f.type.startsWith('audio/') || /\.(mp3|wav|flac|ogg|m4a|aac|opus|webm)$/i.test(f.name));
  const prevent = (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); };
  decks.forEach((d) => {
    d.root.addEventListener('dragover', (e) => { prevent(e); d.root.classList.add('dropping'); });
    d.root.addEventListener('dragleave', () => d.root.classList.remove('dropping'));
    d.root.addEventListener('drop', (e) => { prevent(e); d.root.classList.remove('dropping'); const f = audioOnly(e.dataTransfer)[0]; if (f) d.loadFile(f); });
  });
  pane.addEventListener('dragover', prevent);
  pane.addEventListener('drop', (e) => { prevent(e); const f = audioOnly(e.dataTransfer); if (f.length) addFiles(f); });
  reload();
  if (/[?&]gvtest\b/.test(location.search)) window.__lib = { exportData, exportZip, importFile, addFiles, reload, get recs() { return recs; }, loadTo, render };   // test hook
})();
