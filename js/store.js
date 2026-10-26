/* Tiny IndexedDB blob store so tools can hand audio to each other (e.g. Create -> Editor). */
window.GVStore = (() => {
  const open = () => new Promise((res, rej) => {
    const r = indexedDB.open('govibe', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('blobs');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  const tx = async (mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction('blobs', mode), req = fn(t.objectStore('blobs'));
      t.oncomplete = () => res(req.result); t.onerror = () => rej(t.error);
    });
  };
  return {
    put: (key, blob) => tx('readwrite', (s) => s.put(blob, key)),
    get: (key) => tx('readonly', (s) => s.get(key)),
    del: (key) => tx('readwrite', (s) => s.delete(key))
  };
})();
