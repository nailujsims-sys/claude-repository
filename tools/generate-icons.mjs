// Generates PNG app icons (no external deps) so the PWA installs nicely on iOS
// and Android. Draws a watermelon wedge + hockey striker on a dark gradient,
// supersampled for anti-aliasing, then encodes PNG via Node's zlib.
//   node tools/generate-icons.mjs
import zlib from 'node:zlib';
import fs from 'node:fs';

const mix = (a, b, t) => a + (b - a) * t;
const lerpC = (c1, c2, t) => [mix(c1[0], c2[0], t), mix(c1[1], c2[1], t), mix(c1[2], c2[2], t)];

function draw(size, { maskable = false } = {}) {
  const ss = 2, S = size * ss;
  const buf = Buffer.alloc(size * size * 4);
  const R = S * 0.36, cx = S * 0.46, cy = S * 0.58;
  const radius = S * 0.22;
  const scx = S * 0.72, scy = S * 0.30, sr = S * 0.135;

  const bgTop = [16, 36, 63], bgBot = [12, 19, 34];
  const inRounded = (x, y) => {
    if (maskable) return true;
    const rx = Math.min(x, S - x), ry = Math.min(y, S - y);
    if (rx >= radius || ry >= radius) return true;
    const dx = radius - rx, dy = radius - ry;
    return dx * dx + dy * dy <= radius * radius;
  };

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let aR = 0, aG = 0, aB = 0, aA = 0;
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
        const x = px * ss + sx + 0.5, y = py * ss + sy + 0.5;
        if (!inRounded(x, y)) continue;
        let col = lerpC(bgTop, bgBot, (x + y) / (2 * S)); // diagonal gradient
        let a = 1;

        // watermelon wedge (flat side up: only lower semicircle)
        const ddx = x - cx, ddy = y - cy, dist = Math.hypot(ddx, ddy);
        if (ddy >= 0 && dist <= R) {
          if (dist > R * 0.92) col = [46, 125, 50];
          else if (dist > R * 0.85) col = [102, 187, 106];
          else if (dist > R * 0.79) col = [244, 255, 244];
          else {
            col = [255, 90, 106];
            const seeds = [[-0.30, 0.32], [0, 0.46], [0.30, 0.32], [-0.15, 0.18], [0.15, 0.18]];
            for (const [ux, uy] of seeds) {
              if (Math.hypot(ddx - ux * R, ddy - uy * R) < R * 0.05) col = [36, 16, 22];
            }
          }
        }

        // hockey striker (top-right)
        const sd = Math.hypot(x - scx, y - scy);
        if (sd <= sr) {
          if (sd > sr * 0.88) col = [122, 14, 20];
          else if (sd > sr * 0.42) col = lerpC([255, 122, 126], [200, 29, 37], sd / sr);
          else col = [255, 233, 234];
        }

        aR += col[0] * a; aG += col[1] * a; aB += col[2] * a; aA += a;
      }
      const n = ss * ss;
      const i = (py * size + px) * 4;
      if (aA > 0) { buf[i] = aR / aA; buf[i + 1] = aG / aA; buf[i + 2] = aB / aA; buf[i + 3] = 255 * (aA / n); }
      else { buf[i] = buf[i + 1] = buf[i + 2] = 0; buf[i + 3] = 0; }
    }
  }
  return buf;
}

// --- minimal PNG encoder ---
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
  return t;
})();
const crc32 = (b) => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function encodePNG(rgba, size) {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

fs.mkdirSync('assets', { recursive: true });
const out = [
  ['assets/icon-192.png', 192, {}],
  ['assets/icon-512.png', 512, {}],
  ['assets/icon-maskable.png', 512, { maskable: true }],
];
for (const [path, size, opts] of out) {
  fs.writeFileSync(path, encodePNG(draw(size, opts), size));
  console.log('wrote', path);
}
