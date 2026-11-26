// Renders the ActoMind app icons (PNG) without external dependencies: node tools/gen-icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'icons');
fs.mkdirSync(OUT, { recursive: true });

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
const BG = [9, 9, 11];
const GOLD = [226, 194, 127];
const BURG = [168, 56, 74];

/** Colour at normalised coords (u,v in 0..1), with optional safe-zone scale for maskable icons. */
function shade(u, v, scale) {
  // centre coordinates in units where the logo spans -1..1
  const x = (u - 0.5) * 2 / scale;
  const y = (v - 0.5) * 2 / scale;
  const r = Math.hypot(x, y);
  // background: subtle radial spotlight
  let col = mix([30, 26, 22], BG, Math.min(1, Math.hypot(u - 0.5, v - 0.2) * 1.6));
  let a = 1;
  // ring
  const ringD = Math.abs(r - 0.86);
  if (ringD < 0.05) col = mix(GOLD, BURG, (x + y + 2) / 4);
  // mask: top edge is a gentle curve, bottom is a half-ellipse
  const top = -0.42 + 0.10 * (1 - x * x / 0.36);
  const inside = Math.abs(x) < 0.6 && y > top && (y < 0.05 || (x * x) / 0.36 + ((y - 0.05) * (y - 0.05)) / 0.36 < 1);
  if (inside) {
    col = mix(GOLD, BURG, Math.min(1, Math.max(0, (y + 0.4) / 1.0 + x * 0.25)));
    // eyes
    const eye = (ex) => ((x - ex) ** 2) / 0.012 + ((y + 0.12) ** 2) / 0.006 < 1;
    if (eye(-0.24) || eye(0.24)) col = BG;
    // smile (arc band)
    const sr = Math.hypot(x, (y - 0.02) * 1.1);
    if (y > 0.12 && sr > 0.30 && sr < 0.37 && Math.abs(x) < 0.3) col = BG;
  }
  return [...col, 255 * a];
}

function render(size, { maskable = false, file }) {
  const buf = Buffer.alloc(size * size * 4);
  const ss = 3; // supersampling
  const scale = maskable ? 0.78 : 1;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let acc = [0, 0, 0, 0];
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
        const c = shade((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size, scale);
        acc = acc.map((v, i) => v + c[i]);
      }
      const o = (py * size + px) * 4;
      for (let i = 0; i < 4; i++) buf[o + i] = Math.round(acc[i] / (ss * ss));
    }
  }
  fs.writeFileSync(path.join(OUT, file), png(size, size, buf));
}

render(192, { file: 'icon-192.png' });
render(512, { file: 'icon-512.png' });
render(512, { file: 'icon-maskable-512.png', maskable: true });
render(180, { file: 'apple-touch-icon.png' });
render(32, { file: 'favicon-32.png' });

fs.writeFileSync(path.join(OUT, 'icon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#e2c27f"/><stop offset="1" stop-color="#a8384a"/></linearGradient></defs>
<rect width="64" height="64" rx="14" fill="#09090b"/>
<circle cx="32" cy="32" r="27" fill="none" stroke="url(#g)" stroke-width="3"/>
<path d="M18 21c9 3 19 3 28 0v13c0 8-6 14-14 14s-14-6-14-14z" fill="url(#g)"/>
<ellipse cx="25" cy="29" rx="3.4" ry="2.4" fill="#09090b"/><ellipse cx="39" cy="29" rx="3.4" ry="2.4" fill="#09090b"/>
<path d="M25 37c4 4 10 4 14 0" stroke="#09090b" stroke-width="3" fill="none" stroke-linecap="round"/>
</svg>
`);
console.log('icons written to', OUT);
