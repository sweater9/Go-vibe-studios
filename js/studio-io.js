/* GoVibe Mix — Studio storage: projects live in this browser (IndexedDB for the data, localStorage for the list); backups are ZIP files you keep. */
window.GVStudioIO = (() => {
  const IK = 'govibe.sprojects';
  const readIndex = () => { try { return JSON.parse(localStorage.getItem(IK)) || []; } catch (_) { return []; } };
  const writeIndex = (a) => { try { localStorage.setItem(IK, JSON.stringify(a)); } catch (_) { /* storage full or blocked: projects still open from IndexedDB */ } };
  const pkey = (id) => 'sproj:' + id, akey = (id, a) => 'sasset:' + id + ':' + a;
  const list = () => readIndex().sort((a, b) => b.updated - a.updated);
  async function save(p, blobs) {
    const ids = new Set(); p.tracks.forEach((t) => t.clips.forEach((c) => c.assetId && ids.add(c.assetId)));
    const old = (await GVStore.get(pkey(p.id)).then((b) => b && b.text()).then((t) => t && JSON.parse(t)).catch(() => null)) || { assets: {} };
    for (const a of Object.keys(p.assets)) if (!ids.has(a)) delete p.assets[a];
    for (const a of Object.keys(old.assets || {})) if (!p.assets[a]) await GVStore.del(akey(p.id, a)).catch(() => {});
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
  async function remove(id) {
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
  return { list, save, load, remove, exportZip, importZip };
})();
