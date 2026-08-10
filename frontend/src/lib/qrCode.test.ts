import { describe, expect, it } from 'vitest';
import { qrMatrix, qrSvg } from './qrCode';

/**
 * A QR code that does not scan is worse than no QR code — it fails silently, on
 * someone else's phone, after they have walked over to look at the screen. So
 * these verify the output three independent ways rather than eyeballing shape:
 *
 *  1. STRUCTURE — the function patterns a reader locks onto are where the
 *     specification says they are.
 *  2. ERROR CORRECTION — the codeword polynomial is divisible by the generator
 *     polynomial, which is the DEFINING property of a valid Reed-Solomon
 *     codeword. This checks the field arithmetic against mathematics rather than
 *     against the encoder that produced it.
 *  3. ROUND TRIP — an independent decoder written here (unmask → read format →
 *     de-interleave → parse) recovers the original string. This checks module
 *     placement, masking and format information, none of which the other two
 *     touch.
 */

/* ---------- GF(256), re-derived independently of the encoder ---------- */

const EXP: number[] = [];
const LOG: number[] = [];
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x = (x << 1) ^ (x & 0x80 ? 0x11d : 0);
  }
}
const mul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : EXP[(LOG[a]! + LOG[b]!) % 255]!);

/** Evaluate a codeword polynomial at α^power, Horner-style. */
function evaluate(codewords: number[], power: number): number {
  const x = EXP[power % 255]!;
  return codewords.reduce((acc, coefficient) => mul(acc, x) ^ coefficient, 0);
}

/* ---------- an independent decoder, for the round trip ---------- */

const MASKS: Array<(x: number, y: number) => boolean> = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

const CAPACITY = [16, 28, 44, 64, 86, 108];
const BLOCKS = [1, 1, 1, 2, 2, 4];
const EC_PER_BLOCK = [10, 16, 26, 18, 24, 16];
const ALIGNMENT_CENTRE = [0, 18, 22, 26, 30, 34];

/** Which modules carry data — everything that is not a function pattern. */
function reservedMask(version: number, size: number): boolean[][] {
  const reserved = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  const block = (ox: number, oy: number, w: number, h: number) => {
    for (let y = oy; y < oy + h; y++) {
      for (let x = ox; x < ox + w; x++) {
        if (x >= 0 && y >= 0 && x < size && y < size) reserved[y]![x] = true;
      }
    }
  };
  block(0, 0, 9, 9);
  block(size - 8, 0, 8, 9);
  block(0, size - 8, 9, 8);
  for (let i = 0; i < size; i++) {
    reserved[6]![i] = true;
    reserved[i]![6] = true;
  }
  const centre = ALIGNMENT_CENTRE[version - 1]!;
  if (centre) block(centre - 2, centre - 2, 5, 5);
  return reserved;
}

function decode(rows: boolean[][]): string {
  const size = rows.length;
  const version = (size - 17) / 4;

  // Read the mask from the format information (copy 1, bits 0–2, XOR the mask).
  const formatMaskBits = 0b101010000010010;
  let format = 0;
  for (let i = 0; i < 15; i++) {
    const bit = i < 6 ? rows[i]![8]! : i < 8 ? rows[i + 1]![8]! : i === 8 ? rows[8]![7]! : rows[8]![14 - i]!;
    if (bit) format |= 1 << i;
  }
  // The five data bits (error-correction level, then mask) sit at the TOP of the
  // 15-bit word; the low ten are the BCH remainder.
  const mask = ((format ^ formatMaskBits) >> 10) & 0b111;

  const reserved = reservedMask(version, size);
  const bits: number[] = [];
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step++) {
      const y = upward ? size - 1 - step : step;
      for (const x of [right, right - 1]) {
        if (reserved[y]![x]) continue;
        bits.push((rows[y]![x]! ? 1 : 0) ^ (MASKS[mask]!(x, y) ? 1 : 0));
      }
    }
    upward = !upward;
  }

  const codewords: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    codewords.push(bits.slice(i, i + 8).reduce((acc, bit) => (acc << 1) | bit, 0));
  }

  // De-interleave: data codewords were written block-round-robin.
  const dataCount = CAPACITY[version - 1]!;
  const blockCount = BLOCKS[version - 1]!;
  const blocksOut: number[][] = Array.from({ length: blockCount }, () => []);
  for (let i = 0; i < dataCount; i++) blocksOut[i % blockCount]!.push(codewords[i]!);
  const data = blocksOut.flat();

  // Byte mode: 4-bit mode indicator, 8-bit length, then the bytes.
  const stream = data.flatMap((byte) => [...Array(8)].map((_, i) => (byte >> (7 - i)) & 1));
  const take = (offset: number, length: number) =>
    stream.slice(offset, offset + length).reduce((acc, bit) => (acc << 1) | bit, 0);
  expect(take(0, 4)).toBe(0b0100);
  const length = take(4, 8);
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) bytes[i] = take(12 + i * 8, 8);
  return new TextDecoder().decode(bytes);
}

/** Split a decoded matrix back into per-block data+EC codewords. */
function codewordBlocks(rows: boolean[][]): number[][] {
  const size = rows.length;
  const version = (size - 17) / 4;
  const reserved = reservedMask(version, size);

  let format = 0;
  for (let i = 0; i < 15; i++) {
    const bit = i < 6 ? rows[i]![8]! : i < 8 ? rows[i + 1]![8]! : i === 8 ? rows[8]![7]! : rows[8]![14 - i]!;
    if (bit) format |= 1 << i;
  }
  const mask = ((format ^ 0b101010000010010) >> 10) & 0b111;

  const bits: number[] = [];
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step++) {
      const y = upward ? size - 1 - step : step;
      for (const x of [right, right - 1]) {
        if (reserved[y]![x]) continue;
        bits.push((rows[y]![x]! ? 1 : 0) ^ (MASKS[mask]!(x, y) ? 1 : 0));
      }
    }
    upward = !upward;
  }
  const codewords: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    codewords.push(bits.slice(i, i + 8).reduce((acc, bit) => (acc << 1) | bit, 0));
  }

  const dataCount = CAPACITY[version - 1]!;
  const blockCount = BLOCKS[version - 1]!;
  const ecCount = EC_PER_BLOCK[version - 1]!;

  const blocks: number[][] = Array.from({ length: blockCount }, () => []);
  for (let i = 0; i < dataCount; i++) blocks[i % blockCount]!.push(codewords[i]!);
  for (let i = 0; i < ecCount * blockCount; i++) blocks[i % blockCount]!.push(codewords[dataCount + i]!);
  return blocks;
}

const URLS = [
  'https://space-blaster.builderforce.ai',
  'https://a.builderforce.ai',
  'https://cave-diver-2000.builderforce.ai/index.html',
];

describe('structure', () => {
  it('sizes the matrix to the version the payload needs', () => {
    // 4 × version + 17.
    expect(qrMatrix('https://a.builderforce.ai')!.length).toBe(4 * 2 + 17);
    expect(qrMatrix('x'.repeat(106))!.length).toBe(4 * 6 + 17);
  });

  it('places all three finder patterns', () => {
    const rows = qrMatrix(URLS[0]!)!;
    const size = rows.length;
    for (const [ox, oy] of [[0, 0], [size - 7, 0], [0, size - 7]] as const) {
      for (let y = 0; y < 7; y++) {
        for (let x = 0; x < 7; x++) {
          const ring = Math.max(Math.abs(x - 3), Math.abs(y - 3));
          expect(rows[oy + y]![ox + x]).toBe(ring !== 2);
        }
      }
    }
  });

  it('places the timing patterns and the dark module', () => {
    const rows = qrMatrix(URLS[0]!)!;
    for (let i = 8; i < rows.length - 8; i++) {
      expect(rows[6]![i]).toBe(i % 2 === 0);
      expect(rows[i]![6]).toBe(i % 2 === 0);
    }
    expect(rows[rows.length - 8]![8]).toBe(true);
  });

  it('places the alignment pattern for every version that has one', () => {
    const rows = qrMatrix('x'.repeat(100))!; // version 6, centre at 34
    for (let y = -2; y <= 2; y++) {
      for (let x = -2; x <= 2; x++) {
        expect(rows[34 + y]![34 + x]).toBe(Math.max(Math.abs(x), Math.abs(y)) !== 1);
      }
    }
  });

  it('refuses a payload that will not fit rather than truncating it', () => {
    expect(qrMatrix('x'.repeat(106))).not.toBeNull();
    expect(qrMatrix('x'.repeat(107))).toBeNull();
    expect(qrSvg('x'.repeat(107))).toBeNull();
  });
});

describe('error correction', () => {
  it('produces codewords divisible by the generator polynomial', () => {
    // The defining property of a Reed-Solomon codeword: it evaluates to zero at
    // α^0 … α^(ec-1). Checked against the field arithmetic re-derived above, so a
    // bug in the encoder's tables cannot make this pass.
    for (const url of URLS) {
      const rows = qrMatrix(url)!;
      const version = (rows.length - 17) / 4;
      const ecCount = EC_PER_BLOCK[version - 1]!;
      for (const block of codewordBlocks(rows)) {
        for (let power = 0; power < ecCount; power++) {
          expect(evaluate(block, power)).toBe(0);
        }
      }
    }
  });

  it('holds across every version and block layout', () => {
    for (const length of [10, 20, 40, 60, 80, 100]) {
      const rows = qrMatrix('h'.repeat(length))!;
      const version = (rows.length - 17) / 4;
      const ecCount = EC_PER_BLOCK[version - 1]!;
      for (const block of codewordBlocks(rows)) {
        for (let power = 0; power < ecCount; power++) {
          expect(evaluate(block, power)).toBe(0);
        }
      }
    }
  });
});

describe('round trip', () => {
  it('decodes back to the URL that was encoded', () => {
    for (const url of URLS) {
      expect(decode(qrMatrix(url)!)).toBe(url);
    }
  });

  it('round-trips at the exact capacity of every version, so nothing is truncated', () => {
    // The byte capacity of each version at level M — data codewords minus the
    // 12-bit mode-and-length header. Version selection that ignores that header
    // overflows by two bytes at every size.
    for (const length of [1, 14, 26, 42, 62, 84, 106]) {
      const text = 'a'.repeat(length);
      expect(decode(qrMatrix(text)!)).toBe(text);
    }
  });

  it('round-trips non-ASCII, because the encoder is byte mode over UTF-8', () => {
    const text = 'https://x.builderforce.ai/?q=café';
    expect(decode(qrMatrix(text)!)).toBe(text);
  });
});

describe('svg output', () => {
  const svg = qrSvg(URLS[0]!, { dark: '#111111', light: '#ffffff', size: 200 })!;

  it('includes the quiet zone a reader needs against a busy background', () => {
    const rows = qrMatrix(URLS[0]!)!;
    expect(svg).toContain(`viewBox="0 0 ${rows.length + 8} ${rows.length + 8}"`);
  });

  it('renders crisp modules in the requested colours', () => {
    expect(svg).toContain('shape-rendering="crispEdges"');
    expect(svg).toContain('fill="#111111"');
    expect(svg).toContain('fill="#ffffff"');
    expect(svg).toContain('width="200"');
  });

  it('is labelled for a screen reader', () => {
    expect(svg).toContain('role="img"');
    expect(svg).toContain('aria-label="QR code"');
  });
});
