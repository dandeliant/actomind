// ActoMind – Ogg/Opus muxer (RFC 7845). Packets come from WebCodecs AudioEncoder ('opus').

const OGG_CRC = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let k = 0; k < 8; k++) r = r & 0x80000000 ? ((r << 1) ^ 0x04c11db7) : (r << 1);
    t[i] = r >>> 0;
  }
  return t;
})();

export function oggCrc(bytes) {
  let crc = 0;
  for (let i = 0; i < bytes.length; i++) crc = ((crc << 8) ^ OGG_CRC[((crc >>> 24) ^ bytes[i]) & 0xff]) >>> 0;
  return crc >>> 0;
}

export class OggOpusMuxer {
  /** @param {{channels?:number, preSkip?:number, inputSampleRate?:number, serial?:number, vendor?:string}} o */
  constructor(o = {}) {
    this.channels = o.channels || 1;
    this.preSkip = o.preSkip ?? 312;
    this.inputSampleRate = o.inputSampleRate || 48000;
    this.serial = o.serial ?? ((Math.random() * 0xffffffff) >>> 0);
    this.seq = 0;
    this.granule = 0;
    this.pages = [];
    this.pending = []; // packets waiting for a page
    this.pendingSamples = 0;
    this.writeHeaders(o.vendor || 'ActoMind');
  }

  writeHeaders(vendor) {
    const head = new Uint8Array(19);
    const hv = new DataView(head.buffer);
    head.set([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64]); // OpusHead
    head[8] = 1;
    head[9] = this.channels;
    hv.setUint16(10, this.preSkip, true);
    hv.setUint32(12, this.inputSampleRate, true);
    hv.setInt16(16, 0, true);
    head[18] = 0;
    this.writePage([head], 0, 0x02);
    const enc = new TextEncoder();
    const v = enc.encode(vendor);
    const tags = new Uint8Array(8 + 4 + v.length + 4);
    const tv = new DataView(tags.buffer);
    tags.set([0x4f, 0x70, 0x75, 0x73, 0x54, 0x61, 0x67, 0x73]); // OpusTags
    tv.setUint32(8, v.length, true);
    tags.set(v, 12);
    tv.setUint32(12 + v.length, 0, true);
    this.writePage([tags], 0, 0);
  }

  writePage(packets, granule, flags) {
    const lacing = [];
    for (const p of packets) {
      let n = p.length;
      while (n >= 255) { lacing.push(255); n -= 255; }
      lacing.push(n);
    }
    const bodyLen = packets.reduce((s, p) => s + p.length, 0);
    const page = new Uint8Array(27 + lacing.length + bodyLen);
    const v = new DataView(page.buffer);
    page.set([0x4f, 0x67, 0x67, 0x53]); // OggS
    page[4] = 0;
    page[5] = flags;
    v.setUint32(6, granule % 0x100000000, true);
    v.setUint32(10, Math.floor(granule / 0x100000000), true);
    v.setUint32(14, this.serial, true);
    v.setUint32(18, this.seq++, true);
    v.setUint32(22, 0, true);
    page[26] = lacing.length;
    page.set(lacing, 27);
    let o = 27 + lacing.length;
    for (const p of packets) { page.set(p, o); o += p.length; }
    v.setUint32(22, oggCrc(page), true);
    this.pages.push(page);
  }

  /** @param {Uint8Array} packet  @param {number} samples48k decoded length at 48 kHz */
  addPacket(packet, samples48k) {
    const lacingCount = Math.floor(packet.length / 255) + 1;
    const currentLacing = this.pending.reduce((s, p) => s + Math.floor(p.length / 255) + 1, 0);
    if (this.pending.length && (currentLacing + lacingCount > 255 || this.pendingSamples >= 48000)) this.flushPage(false);
    this.pending.push(packet);
    this.pendingSamples += samples48k;
  }

  flushPage(last, endGranule) {
    if (!this.pending.length && !last) return;
    this.granule += this.pendingSamples;
    const g = last && endGranule != null ? Math.min(this.granule, endGranule) : this.granule;
    this.writePage(this.pending, g, last ? 0x04 : 0);
    this.pending = [];
    this.pendingSamples = 0;
  }

  /** @param {number} totalInputSamples48k original audio length at 48 kHz (trims encoder padding) */
  finish(totalInputSamples48k) {
    const end = totalInputSamples48k != null ? this.preSkip + totalInputSamples48k : null;
    this.flushPage(true, end);
    return new Blob(this.pages, { type: 'audio/ogg; codecs=opus' });
  }
}
