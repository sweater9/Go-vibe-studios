/* GoVibe Mix — Studio storage: projects live in this browser (IndexedDB for the data, localStorage for the list); backups are ZIP files you keep. */
window.GVStudioIO = (() => {
  const IK = 'govibe.sprojects';
  const readIndex = () => { try { return JSON.parse(localStorage.getItem(IK)) || []; } catch (_) { return []; } };
  const writeIndex = (a) => { try { localStorage.setItem(IK, JSON.stringify(a)); } catch (_) { /* storage full or blocked: projects still open from IndexedDB */ } };
  const SK = 'govibe.ssnaps', MAXV = 20;
  const readSnaps = () => { try { return JSON.parse(localStorage.getItem(SK)) || []; } catch (_) { return []; } };
  const writeSnaps = (a) => { try { localStorage.setItem(SK, JSON.stringify(a)); } catch (_) { /* storage full or blocked */ } };
  const snapsOf = (pid) => readSnaps().filter((x) => x.pid === pid).sort((a, b) => b.ts - a.ts);
  const pkey = (id) => 'sproj:' + id, akey = (id, a) => 'sasset:' + id + ':' + a;
  const list = () => readIndex().sort((a, b) => b.updated - a.updated);
  async function save(p, blobs) {
    const ids = new Set(); p.tracks.forEach((t) => t.clips.forEach((c) => c.assetId && ids.add(c.assetId)));
    const old = (await GVStore.get(pkey(p.id)).then((b) => b && b.text()).then((t) => t && JSON.parse(t)).catch(() => null)) || { assets: {} };
    for (const a of Object.keys(p.assets)) if (!ids.has(a)) delete p.assets[a];
    const held = new Set(); snapsOf(p.id).forEach((s) => (s.assets || []).forEach((a) => held.add(a)));   // sound a saved version still needs
    for (const a of Object.keys(old.assets || {})) if (!p.assets[a] && !held.has(a)) await GVStore.del(akey(p.id, a)).catch(() => {});
    for (const a of ids) if (blobs.has(a) && !(old.assets && old.assets[a])) await GVStore.put(akey(p.id, a), blobs.get(a));
    await GVStore.put(pkey(p.id), new Blob([JSON.stringify(p)], { type: 'application/json' }));
    const idx = readIndex().filter((x) => x.id !== p.id); idx.push({ id: p.id, name: p.name, updated: Date.now(), tracks: p.tracks.length }); writeIndex(idx);
  }
  async function load(id) {
    const b = await GVStore.get(pkey(id)); if (!b) throw new Error('Project not found');
    const p = JSON.parse(await b.text()), blobs = new Map();
    for (const a of Object.keys(p.assets || {})) { const x = await GVStore.get(akey(id, a)); if (x) blobs.set(a, x); }
    return { p, blobs };
  }
  /* versions: a copy of the project's settings and clip layout; the sound files are shared, and kept for as long as a version needs them */
  const skey = (sid) => 'ssnap:' + sid;
  async function snapshot(p, name) {
    const sid = 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), rec = { id: sid, pid: p.id, name: (name || '').trim().slice(0, 60), ts: Date.now(), tracks: p.tracks.length, assets: Object.keys(p.assets || {}) };
    await GVStore.put(skey(sid), new Blob([JSON.stringify(p)], { type: 'application/json' }));
    let all = readSnaps(); all.push(rec); const mine = all.filter((x) => x.pid === p.id).sort((a, b) => b.ts - a.ts);
    for (const old of mine.slice(MAXV)) { await GVStore.del(skey(old.id)).catch(() => {}); all = all.filter((x) => x.id !== old.id); }
    writeSnaps(all); return rec;
  }
  async function restore(pid, sid) {
    const b = await GVStore.get(skey(sid)); if (!b) throw new Error('That version is no longer stored');
    const p = JSON.parse(await b.text()); p.id = pid; await GVStore.put(pkey(pid), new Blob([JSON.stringify(p)], { type: 'application/json' }));
    const idx = readIndex().filter((x) => x.id !== pid); idx.push({ id: pid, name: p.name, updated: Date.now(), tracks: p.tracks.length }); writeIndex(idx); return p;
  }
  async function removeSnap(sid) {
    const rec = readSnaps().find((x) => x.id === sid); if (!rec) return;
    await GVStore.del(skey(sid)).catch(() => {}); const rest = readSnaps().filter((x) => x.id !== sid); writeSnaps(rest);
    const keep = new Set(); rest.filter((x) => x.pid === rec.pid).forEach((s) => (s.assets || []).forEach((a) => keep.add(a)));
    try { const cur = await load(rec.pid); Object.keys(cur.p.assets || {}).forEach((a) => keep.add(a)); } catch (_) { /* the project itself is gone */ }
    for (const a of rec.assets || []) if (!keep.has(a)) await GVStore.del(akey(rec.pid, a)).catch(() => {});
  }
  async function remove(id) {
    for (const s of snapsOf(id)) await removeSnap(s.id);
    try { const { p } = await load(id); for (const a of Object.keys(p.assets || {})) await GVStore.del(akey(id, a)).catch(() => {}); } catch (_) { /* nothing stored */ }
    await GVStore.del(pkey(id)).catch(() => {}); writeIndex(readIndex().filter((x) => x.id !== id));
  }
  const safe = (n) => String(n).replace(/[^\w.\- ]+/g, '_').slice(0, 60) || 'audio';
  async function exportZip(p, blobs) {
    const entries = [{ name: 'project.json', blob: new Blob([JSON.stringify({ app: 'govibe-mix-studio', version: 1, project: p })], { type: 'application/json' }) }];
    for (const [a, rec] of Object.entries(p.assets)) if (blobs.has(a)) entries.push({ name: 'assets/' + a + '-' + safe(rec.name), blob: blobs.get(a) });
    return GVZip.write(entries);
  }
  async function importZip(file) {
    const files = {}; for (const e of await GVZip.read(file)) files[e.name] = e;
    if (!files['project.json']) throw new Error('This is not a Studio project backup');
    const data = JSON.parse(await (await files['project.json'].blob()).text());
    if (!data || data.app !== 'govibe-mix-studio' || !data.project || !Array.isArray(data.project.tracks)) throw new Error('This is not a Studio project backup');
    const p = data.project, blobs = new Map();
    for (const a of Object.keys(p.assets || {})) { const key = Object.keys(files).find((n) => n.startsWith('assets/' + a + '-')); if (key) blobs.set(a, await files[key].blob()); }
    return { p, blobs };
  }
  return { list, save, load, remove, exportZip, importZip, snapshot, restore, removeSnap, snaps: snapsOf };
})();
