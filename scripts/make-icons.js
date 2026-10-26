// Generates the PWA PNG icons (no image libraries needed).
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const OUT = new URL('../docs/icons/', import.meta.url);
mkdirSync(OUT, { recursive: true });

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const SS = 3; // supersampling
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const [pr, pg, pb, pa] = pixel((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size);
        r += pr * pa; g += pg * pa; b += pb * pa; a += pa;
      }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = a ? Math.round(r / a) : 0; raw[o + 1] = a ? Math.round(g / a) : 0; raw[o + 2] = a ? Math.round(b / a) : 0;
      raw[o + 3] = Math.round((a / (SS * SS)) * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const BG = [15, 23, 42], ACC = [56, 189, 248], RED = [239, 68, 68];
function radar(scale, { mono = false, background = true, rounded = true } = {}) {
  return (u, v) => {
    const x = (u - 0.5) / scale, y = (v - 0.5) / scale;
    const d = Math.hypot(x, y);
    const fg = mono ? [255, 255, 255] : ACC;
    // rounded-square background
    const q = Math.max(Math.abs(u - 0.5), Math.abs(v - 0.5));
    const inBg = background && (!rounded || Math.hypot(Math.max(Math.abs(u - 0.5) - 0.3, 0), Math.max(Math.abs(v - 0.5) - 0.3, 0)) < 0.2) && q <= 0.5;
    const ring = (r, w) => Math.abs(d - r) < w;
    // sweep line towards upper-right
    const ang = Math.atan2(-y, x);
    const target = Math.PI / 5;
    const lineDist = Math.abs(Math.sin(ang - target)) * d;
    const onLine = d < 0.4 && Math.cos(ang - target) > 0 && lineDist < 0.028;
    // sweep wedge glow
    const delta = target - ang;
    const inWedge = d < 0.4 && delta > 0 && delta < 0.9;
    if (d < 0.05) return [...fg, 1];
    if (onLine) return [...fg, 1];
    if (!mono && Math.hypot(x + 0.17, y - 0.12) < 0.045) return [...RED, 1]; // blip
    if (ring(0.4, 0.022)) return [...fg, mono ? 1 : 0.55];
    if (ring(0.25, 0.022)) return [...fg, mono ? 1 : 0.8];
    if (inWedge && !mono) {
      const t = 1 - delta / 0.9;
      const mix = 0.35 * t;
      return [BG[0] + (ACC[0] - BG[0]) * mix, BG[1] + (ACC[1] - BG[1]) * mix, BG[2] + (ACC[2] - BG[2]) * mix, 1];
    }
    if (inBg) return [...BG, 1];
    return [0, 0, 0, 0];
  };
}

writeFileSync(new URL('icon-192.png', OUT), png(192, radar(1)));
writeFileSync(new URL('icon-512.png', OUT), png(512, radar(1)));
writeFileSync(new URL('icon-maskable-512.png', OUT), png(512, radar(0.72, { rounded: false })));
writeFileSync(new URL('badge-96.png', OUT), png(96, radar(1.15, { mono: true, background: false })));

// Windows .ico (PNG-compressed entry) for the desktop shortcut.
const ico256 = png(256, radar(1));
const header = Buffer.alloc(22);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
header[6] = 0; header[7] = 0; // 256 x 256
header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12);
header.writeUInt32LE(ico256.length, 14); header.writeUInt32LE(22, 18);
writeFileSync(new URL('icon.ico', OUT), Buffer.concat([header, ico256]));
console.log('Icons written to docs/icons/');
