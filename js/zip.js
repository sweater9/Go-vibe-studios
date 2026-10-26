/* GoVibe Mix — tiny ZIP writer (stored) and reader (stored + deflate) for library backups. No dependencies. */
window.GVZip = (() => {
  const T = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; T[n] = c >>> 0; }
  const crc32 = (u8) => { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = T[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const enc = new TextEncoder(), dec = new TextDecoder();
  const dosTime = (d) => ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff;
  const dosDate = (d) => (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;

  async function write(entries) {                         // entries: [{ name, blob }]
    const parts = [], central = [], now = new Date(); let offset = 0;
    for (const e of entries) {
      const data = new Uint8Array(await e.blob.arrayBuffer()), name = enc.encode(e.name), crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true); h.setUint16(10, dosTime(now), true); h.setUint16(12, dosDate(now), true);
      h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
      parts.push(h.buffer, name, data); central.push({ name, crc, size: data.length, offset }); offset += 30 + name.length + data.length;
    }
    const cdStart = offset;
    for (const c of central) {
      const h = new DataView(new ArrayBuffer(46));
      h.setUint32(0, 0x02014b50, true); h.setUint16(4, 20, true); h.setUint16(6, 20, true); h.setUint16(8, 0x0800, true); h.setUint16(10, 0, true); h.setUint16(12, dosTime(now), true); h.setUint16(14, dosDate(now), true);
      h.setUint32(16, c.crc, true); h.setUint32(20, c.size, true); h.setUint32(24, c.size, true); h.setUint16(28, c.name.length, true); h.setUint32(42, c.offset, true);
      parts.push(h.buffer, c.name); offset += 46 + c.name.length;
    }
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, central.length, true); end.setUint16(10, central.length, true); end.setUint32(12, offset - cdStart, true); end.setUint32(16, cdStart, true);
    parts.push(end.buffer);
    return new Blob(parts, { type: 'application/zip' });
  }

  async function read(blob) {                             // -> [{ name, blob() }]
    const tail = new DataView(await blob.slice(Math.max(0, blob.size - 65557)).arrayBuffer());
    let e = -1; for (let i = tail.byteLength - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error('Not a zip file');
    const count = tail.getUint16(e + 10, true), cdSize = tail.getUint32(e + 12, true), cdOff = tail.getUint32(e + 16, true);
    const cd = new DataView(await blob.slice(cdOff, cdOff + cdSize).arrayBuffer()), out = []; let p = 0;
    for (let i = 0; i < count; i++) {
      if (cd.getUint32(p, true) !== 0x02014b50) throw new Error('Damaged zip');
      const method = cd.getUint16(p + 10, true), csize = cd.getUint32(p + 20, true), nl = cd.getUint16(p + 28, true), xl = cd.getUint16(p + 30, true), cl = cd.getUint16(p + 32, true), off = cd.getUint32(p + 42, true);
      const name = dec.decode(new Uint8Array(cd.buffer, p + 46, nl)); p += 46 + nl + xl + cl;
      out.push({ name, async blob() {
        const lh = new DataView(await blob.slice(off, off + 30).arrayBuffer()), start = off + 30 + lh.getUint16(26, true) + lh.getUint16(28, true), raw = blob.slice(start, start + csize);
        if (method === 0) return raw;
        if (method === 8 && window.DecompressionStream) return new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
        throw new Error('Unsupported zip compression');
      } });
    }
    return out;
  }
  return { write, read, crc32 };
})();
