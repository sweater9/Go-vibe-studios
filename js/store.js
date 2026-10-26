/* Tiny IndexedDB store: 'blobs' hands audio between tools (Create -> Editor) and holds DJ library files;
   'tracks' holds the DJ library's metadata (BPM, key, cue points) so listing it never loads the audio. */
window.GVStore = (() => {
  const open = () => new Promise((res, rej) => {
    const r = indexedDB.open('govibe', 2);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
      if (!db.objectStoreNames.contains('tracks')) db.createObjectStore('tracks', { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  const tx = async (store, mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode), req = fn(t.objectStore(store));
      t.oncomplete = () => { db.close(); res(req.result); }; t.onerror = () => { db.close(); rej(t.error); };
    });
  };
  return {
    put: (key, blob) => tx('blobs', 'readwrite', (s) => s.put(blob, key)),
    get: (key) => tx('blobs', 'readonly', (s) => s.get(key)),
    del: (key) => tx('blobs', 'readwrite', (s) => s.delete(key)),
    lib: {
      put: (rec) => tx('tracks', 'readwrite', (s) => s.put(rec)),
      all: () => tx('tracks', 'readonly', (s) => s.getAll()),
      get: (id) => tx('tracks', 'readonly', (s) => s.get(id)),
      del: (id) => tx('tracks', 'readwrite', (s) => s.delete(id))
    }
  };
})();
