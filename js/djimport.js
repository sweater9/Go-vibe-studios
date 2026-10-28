/* GoVibe Mix — import a DJ library from rekordbox (XML export), Traktor (collection.nml) or Serato (database V2 and crate files). Only the file contains data; it is read on this device. Tracks are matched to your library by file name; the rest wait as entries until you add their audio. */
window.GVDJImport = (() => {
  const base = (p) => String(p || '').replace(/^file:\/\/localhost/i, '').split(/[\\/]|\/:/).filter(Boolean).pop() || '';
  const clean = (n) => { try { return decodeURIComponent(n); } catch (_) { return n; } };
  const PC = { c: 0, 'b#': 0, 'c#': 1, db: 1, d: 2, 'd#': 3, eb: 3, e: 4, fb: 4, 'e#': 5, f: 5, 'f#': 6, gb: 6, g: 7, 'g#': 8, ab: 8, a: 9, 'a#': 10, bb: 10, b: 11, cb: 11 };
  const MAJ = [8, 3, 10, 5, 12, 7, 2, 9, 4, 11, 6, 1], MIN = [5, 12, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10];
  function camelot(k) { // "Am", "F#m", "Db", "8A" -> "8A"
    k = String(k || '').trim(); if (!k) return null; if (/^(1[0-2]|[1-9])[ABab]$/.test(k)) return k.toUpperCase();
    const m = k.match(/^([A-Ga-g])([#b♯♭]?)\s*(m|min|minor|maj|major|M)?$/); if (!m) return null;
    const name = (m[1] + (m[2] === '♯' ? '#' : m[2] === '♭' ? 'b' : m[2])).toLowerCase(), pc = PC[name]; if (pc == null) return null;
    return /^(m|min|minor)$/.test(m[3] || '') && m[3] !== 'M' ? MIN[pc] + 'A' : MAJ[pc] + 'B';
  }
  const TRAKTOR_KEYS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B', 'Cm', 'C#m', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'Bbm', 'Bm'];
  const stars = (v) => Math.max(0, Math.min(5, Math.round((+v || 0) / 51)));
  const gridOf = (bpm, t0) => (bpm > 0 ? { bpm, t0: Math.max(0, t0 || 0), period: 60 / bpm } : null);
  const xml = (text) => { const d = new DOMParser().parseFromString(text, 'application/xml'); if (d.querySelector('parsererror')) throw new Error('This file is not valid XML'); return d; };

  function rekordbox(text) {
    const d = xml(text); if (!d.querySelector('DJ_PLAYLISTS')) throw new Error('This is not a rekordbox XML export');
    const tracks = [], byId = {};
    d.querySelectorAll('COLLECTION > TRACK').forEach((e) => {
      const name = clean(base(e.getAttribute('Location'))) || e.getAttribute('Name'); if (!name) return;
      const tempos = [...e.querySelectorAll('TEMPO')], bpm = +e.getAttribute('AverageBpm') || (tempos[0] ? +tempos[0].getAttribute('Bpm') : 0) || null;
      const cues = new Array(8).fill(null); e.querySelectorAll('POSITION_MARK').forEach((m) => { const n = +m.getAttribute('Num'); if (n >= 0 && n < 8 && m.getAttribute('Type') === '0') cues[n] = +m.getAttribute('Start'); });
      const t = { name, size: +e.getAttribute('Size') || 0, dur: +e.getAttribute('TotalTime') || 0, bpm, key: camelot(e.getAttribute('Tonality')), grid: gridOf(bpm, tempos[0] ? +tempos[0].getAttribute('Inizio') : 0), cues, rating: stars(e.getAttribute('Rating')), notes: e.getAttribute('Comments') || '' };
      tracks.push(t); byId[e.getAttribute('TrackID')] = t;
    });
    const playlists = []; d.querySelectorAll('PLAYLISTS NODE').forEach((n) => { if (n.getAttribute('Type') !== '1') return; const files = [...n.children].filter((c) => c.tagName === 'TRACK').map((c) => byId[c.getAttribute('Key')]).filter(Boolean).map((t) => t.name); playlists.push({ name: n.getAttribute('Name') || 'Playlist', files }); });
    return { source: 'rekordbox', tracks, playlists };
  }
  function traktor(text) {
    const d = xml(text); if (!d.querySelector('NML')) throw new Error('This is not a Traktor collection file');
    const tracks = [], byKey = {};
    d.querySelectorAll('COLLECTION > ENTRY').forEach((e) => {
      const loc = e.querySelector('LOCATION'); if (!loc) return; const name = loc.getAttribute('FILE'); if (!name) return;
      const info = e.querySelector('INFO'), bpm = e.querySelector('TEMPO') ? +e.querySelector('TEMPO').getAttribute('BPM') || null : null, mk = e.querySelector('MUSICAL_KEY');
      const cues = new Array(8).fill(null); let t0 = 0; e.querySelectorAll('CUE_V2').forEach((c) => { const h = +c.getAttribute('HOTCUE'), ty = c.getAttribute('TYPE'); if (ty === '4' && !t0) t0 = (+c.getAttribute('START') || 0) / 1000; if (h >= 0 && h < 8 && (ty === '0' || ty === '1')) cues[h] = (+c.getAttribute('START') || 0) / 1000; });
      const key = mk ? camelot(TRAKTOR_KEYS[+mk.getAttribute('VALUE')]) : null;
      const t = { name, size: 0, dur: info ? +info.getAttribute('PLAYTIME') || 0 : 0, bpm, key, grid: gridOf(bpm, t0), cues, rating: stars(info && info.getAttribute('RANKING')), notes: (info && info.getAttribute('COMMENT')) || '' };
      tracks.push(t); byKey[(loc.getAttribute('VOLUME') || '') + (loc.getAttribute('DIR') || '') + name] = t;
    });
    const playlists = []; d.querySelectorAll('PLAYLISTS NODE[TYPE="PLAYLIST"]').forEach((n) => { const files = [...n.querySelectorAll('PRIMARYKEY')].map((k) => { const key = k.getAttribute('KEY') || '', t = byKey[key]; return t ? t.name : base(key); }).filter(Boolean); playlists.push({ name: n.getAttribute('NAME') || 'Playlist', files }); });
    return { source: 'Traktor', tracks, playlists };
  }
  /* Serato files are lists of records: four letter tag, 32 bit length, payload; text is UTF-16 big endian */
  function records(u8, from, to) { const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), out = []; let p = from; while (p + 8 <= to) { const tag = String.fromCharCode(...u8.subarray(p, p + 4)), len = dv.getUint32(p + 4); if (p + 8 + len > to) break; out.push({ tag, a: p + 8, b: p + 8 + len }); p += 8 + len; } return out; }
  const u16 = (u8, a, b) => { let s = ''; for (let i = a; i + 1 < b; i += 2) s += String.fromCharCode((u8[i] << 8) | u8[i + 1]); return s.replace(/\0+$/, ''); };
  function serato(u8, fname) {
    const top = records(u8, 0, u8.length), tracks = [], files = [];
    top.forEach((r) => {
      if (r.tag !== 'otrk') return; const f = {}; records(u8, r.a, r.b).forEach((x) => { f[x.tag] = u16(u8, x.a, x.b); });
      const name = base(f.pfil || f.ptrk || ''); if (!name) return; files.push(name);
      if (f.pfil) { const bpm = parseFloat(f.tbpm) || null; tracks.push({ name, size: 0, dur: 0, bpm, key: camelot(f.tkey), grid: null, cues: new Array(8).fill(null), rating: 0, notes: '' }); }
    });
    if (!top.some((r) => r.tag === 'otrk')) throw new Error('This is not a Serato file');
    const isDb = tracks.length > 0, nm = clean(String(fname || '').replace(/\.crate$/i, '').split(/[\\/]/).pop()).split('%%').pop();
    return { source: 'Serato', tracks, playlists: isDb ? [] : [{ name: nm || 'Serato crate', files }], crateOnly: !isDb };
  }
  async function parse(file) {
    const n = file.name.toLowerCase();
    if (n.endsWith('.crate') || /database v2$/i.test(n)) return serato(new Uint8Array(await file.arrayBuffer()), file.name);
    const text = await file.text();
    if (/<DJ_PLAYLISTS/.test(text.slice(0, 4000))) return rekordbox(text);
    if (/<NML/.test(text.slice(0, 4000))) return traktor(text);
    throw new Error('Choose a rekordbox XML export, a Traktor collection.nml, or a Serato database V2 or .crate file');
  }

  /* put the result into the library: fill gaps in tracks you already have, add waiting entries for the rest, rebuild playlists */
  async function apply(data, L) {
    const key = (s) => s.toLowerCase(); const idx = new Map(L.recs().map((r) => [key(r.name), r]));
    let updated = 0, added = 0, plists = 0;
    for (const t of data.tracks) {
      const have = idx.get(key(t.name));
      if (have) {
        let ch = false;
        if (!have.bpm && t.bpm) { have.bpm = t.bpm; ch = true; } if (!have.grid && t.grid) { have.grid = t.grid; ch = true; } if (!have.key && t.key) { have.key = t.key; ch = true; }
        if (!(have.cues || []).some((c) => c != null) && t.cues.some((c) => c != null)) { have.cues = L.cues8(t.cues); ch = true; }
        if (!have.rating && t.rating) { have.rating = t.rating; ch = true; } if (!have.notes && t.notes) { have.notes = t.notes; ch = true; }
        if (ch) { await L.save(have, null); updated++; }
      } else {
        const rec = { id: t.size ? t.name + '|' + t.size : 'imp|' + t.name, name: t.name, size: t.size, dur: t.dur, bpm: t.bpm, key: t.key, grid: t.grid, cues: L.cues8(t.cues), rating: t.rating, tag: '', notes: t.notes, added: Date.now(), played: 0, missing: true };
        await L.save(rec, null); idx.set(key(t.name), rec); added++;
      }
    }
    const lists = L.lists();
    data.playlists.forEach((p) => {
      const ids = []; p.files.forEach((f) => { let r = idx.get(key(f)); if (!r && data.crateOnly) { r = { id: 'imp|' + f, name: f, size: 0, dur: 0, bpm: null, key: null, grid: null, cues: L.cues8(), rating: 0, tag: '', notes: '', added: Date.now(), played: 0, missing: true }; idx.set(key(f), r); L.pending.push(r); } if (r && !ids.includes(r.id)) ids.push(r.id); });
      if (!ids.length) return; const have = lists.find((l) => l.name.toLowerCase() === p.name.slice(0, 40).toLowerCase());
      if (have) ids.forEach((i) => { if (!have.ids.includes(i)) have.ids.push(i); }); else lists.push({ id: L.newId(), name: p.name.slice(0, 40), ids }); plists++;
    });
    for (const r of L.pending.splice(0)) { await L.save(r, null); added++; }
    L.done(); return { updated, added, plists, tracks: data.tracks.length, source: data.source };
  }
  return { camelot, rekordbox, traktor, serato, parse, apply };
})();
