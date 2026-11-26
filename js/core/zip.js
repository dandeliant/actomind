// ActoMind – minimal ZIP writer (STORE) and reader (STORE + DEFLATE via DecompressionStream).
// Used for DOCX import and for "download everything as ZIP".

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32Update(crc, bytes) {
  let c = crc ^ 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export async function crc32Blob(blob, sliceSize = 4 * 1024 * 1024) {
  let crc = 0;
  for (let off = 0; off < blob.size; off += sliceSize) {
    const part = new Uint8Array(await blob.slice(off, off + sliceSize).arrayBuffer());
    crc = crc32Update(crc, part);
  }
  return crc;
}

function dosTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2));
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

/**
 * Create a ZIP (no compression – audio is already compressed or PCM).
 * @param {{name:string, data:Blob|Uint8Array|string, date?:Date}[]} files
 * @returns {Promise<Blob>}
 */
export async function createZip(files) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const blob = f.data instanceof Blob ? f.data : new Blob([typeof f.data === 'string' ? enc.encode(f.data) : f.data]);
    const name = enc.encode(f.name);
    const crc = await crc32Blob(blob);
    const size = blob.size;
    const { time, date } = dosTime(f.date || new Date());
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, 0x0800, true); // UTF-8 names
    lh.setUint16(8, 0, true); // store
    lh.setUint16(10, time, true);
    lh.setUint16(12, date, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, size, true);
    lh.setUint32(22, size, true);
    lh.setUint16(26, name.length, true);
    lh.setUint16(28, 0, true);
    parts.push(lh.buffer, name, blob);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true);
    ch.setUint16(12, time, true);
    ch.setUint16(14, date, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, size, true);
    ch.setUint32(24, size, true);
    ch.setUint16(28, name.length, true);
    ch.setUint32(42, offset, true);
    central.push(ch.buffer, name);
    offset += 30 + name.length + size;
  }
  const cdSize = central.reduce((s, p) => s + (p.byteLength ?? p.length), 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}

async function inflateRaw(bytes, inflater) {
  if (inflater) return inflater(bytes);
  if (typeof DecompressionStream === 'undefined') throw new Error('DecompressionStream not supported');
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Read entries of a ZIP archive.
 * @param {ArrayBuffer} ab
 * @param {{inflater?:(u8:Uint8Array)=>Promise<Uint8Array>|Uint8Array}} opts
 * @returns {Promise<Map<string, ()=>Promise<Uint8Array>>>}
 */
export async function readZip(ab, opts = {}) {
  const v = new DataView(ab);
  let eocd = -1;
  for (let i = ab.byteLength - 22; i >= Math.max(0, ab.byteLength - 65557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a ZIP archive');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) break;
    const method = v.getUint16(p + 10, true);
    const csize = v.getUint32(p + 20, true);
    const nlen = v.getUint16(p + 28, true);
    const xlen = v.getUint16(p + 30, true);
    const clen = v.getUint16(p + 32, true);
    const lho = v.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(ab, p + 46, nlen));
    entries.set(name, async () => {
      const lnlen = v.getUint16(lho + 26, true);
      const lxlen = v.getUint16(lho + 28, true);
      const start = lho + 30 + lnlen + lxlen;
      const data = new Uint8Array(ab, start, csize);
      if (method === 0) return data.slice();
      if (method === 8) return inflateRaw(data, opts.inflater);
      throw new Error('Unsupported ZIP compression method ' + method);
    });
    p += 46 + nlen + xlen + clen;
  }
  return entries;
}
