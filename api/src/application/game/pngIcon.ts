/**
 * App icons, drawn as real PNGs.
 *
 * An installed game needs a picture. On Android a manifest icon can be an SVG and
 * Chrome will cope; on iOS `apple-touch-icon` accepts PNG and ICO and nothing
 * else, and a home-screen install with no usable icon falls back to a SCREENSHOT
 * of the page — which for a game mid-load is a black square. So the icon is a
 * PNG, and since there is no canvas and no image library in a Worker, it is
 * encoded here.
 *
 * A PNG is a signature, three chunks and a CRC each. The only part that is not
 * trivial is the compression, and `fflate` (already a dependency, used by the
 * XLSX and DOCX writers) provides exactly the zlib stream IDAT wants. Encoding an
 * icon is therefore ~80 lines rather than a dependency, and produces a file that
 * is byte-identical for the same input — which matters, because the icon is
 * regenerated on every publish and a churning icon invalidates itself in the
 * home-screen cache.
 */

import { zlibSync } from 'fflate';
import { hexToRgb } from './gameDocument';

/** CRC-32, the PNG variant. Table built once per isolate. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** Encode 8-bit RGBA pixels as a PNG. `pixels` is `width * height * 4` bytes. */
export function encodePng(width: number, height: number, pixels: Uint8Array): Uint8Array {
  // Each scanline is prefixed with its filter type. Filter 0 (None) keeps the
  // encoder honest and costs nothing here — the image is a smooth gradient, which
  // deflate handles well regardless of the filter.
  const raw = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0;
    raw.set(pixels.subarray(y * width * 4, (y + 1) * width * 4), y * (1 + width * 4) + 1);
  }

  const ihdr = new Uint8Array(13);
  const header = new DataView(ihdr.buffer);
  header.setUint32(0, width);
  header.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: truecolour with alpha
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlibSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ];
  const png = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    png.set(part, offset);
    offset += part.length;
  }
  return png;
}

/**
 * The arcade glyph, 11×8, as a bitmap.
 *
 * Deliberately a recognisable invader rather than a letter: an initial is
 * unreadable at the 48px an Android launcher actually renders, and every game on
 * the home screen would start with a different one. This reads as "a game" at any
 * size, which is the only job an icon has.
 */
const GLYPH = [
  '..X.....X..',
  '...X...X...',
  '..XXXXXXX..',
  '.XX.XXX.XX.',
  'XXXXXXXXXXX',
  'X.XXXXXXX.X',
  'X.X.....X.X',
  '...XX.XX...',
];

/**
 * A square app icon for a game, in the game's accent colour.
 *
 * Drawn full-bleed with the glyph inside the central 60%, which is the safe area
 * a `maskable` icon must respect — Android crops the icon to whatever shape the
 * launcher uses (circle, squircle, teardrop), and a glyph drawn to the edges
 * loses its legs on a round launcher.
 */
export function gameIconPng(size: number, accent: string): Uint8Array {
  const [r, g, b] = hexToRgb(accent);
  const pixels = new Uint8Array(size * size * 4);

  // Background: a diagonal gradient from the accent to a darkened version of it,
  // so the icon has depth without needing a second authored colour.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const t = (x / size + y / size) / 2;
      const i = (y * size + x) * 4;
      pixels[i] = Math.round(r * (1 - t * 0.55));
      pixels[i + 1] = Math.round(g * (1 - t * 0.55));
      pixels[i + 2] = Math.round(b * (1 - t * 0.55));
      pixels[i + 3] = 255;
    }
  }

  // Glyph: white, centred, integer-scaled so the pixel art stays crisp.
  const glyphWidth = GLYPH[0]!.length;
  const glyphHeight = GLYPH.length;
  const scale = Math.max(1, Math.floor((size * 0.6) / glyphWidth));
  const offsetX = Math.floor((size - glyphWidth * scale) / 2);
  const offsetY = Math.floor((size - glyphHeight * scale) / 2);
  for (let gy = 0; gy < glyphHeight; gy++) {
    for (let gx = 0; gx < glyphWidth; gx++) {
      if (GLYPH[gy]![gx] !== 'X') continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const x = offsetX + gx * scale + dx;
          const y = offsetY + gy * scale + dy;
          if (x < 0 || y < 0 || x >= size || y >= size) continue;
          const i = (y * size + x) * 4;
          pixels[i] = 255;
          pixels[i + 1] = 255;
          pixels[i + 2] = 255;
          pixels[i + 3] = 255;
        }
      }
    }
  }
  return encodePng(size, size, pixels);
}
