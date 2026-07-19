import { describe, it, expect } from 'vitest';
import { encodeQr, rsEncode } from './qr';

/**
 * The QR encoder is hand-written maths with no library to lean on, so these
 * tests check it against the spec's own invariants rather than against itself.
 *
 * The strongest of them is the Reed-Solomon syndrome check: QR's generator
 * polynomial is the product of (x - alpha^i) for i in 0..n-1, so a valid codeword
 * evaluates to zero at each of those n roots. The GF(256) arithmetic below is a
 * second, independent implementation, so a bug in the encoder's tables or its
 * polynomial division shows up as a non-zero syndrome instead of cancelling out.
 */

// --- Independent GF(256) implementation (primitive polynomial 0x11D) --------

function gfMulSlow(a: number, b: number): number {
  let result = 0;
  let x = a;
  let y = b;
  while (y > 0) {
    if (y & 1) result ^= x;
    y >>= 1;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  return result;
}

/** alpha^n in GF(256). */
function gfPow(n: number): number {
  let result = 1;
  for (let i = 0; i < n; i++) result = gfMulSlow(result, 2);
  return result;
}

/** Evaluate the codeword polynomial (highest order first) at alpha^power. */
function evalAt(codeword: number[], power: number): number {
  const x = gfPow(power);
  return codeword.reduce((acc, coeff) => gfMulSlow(acc, x) ^ coeff, 0);
}

describe('rsEncode', () => {
  it('produces the requested number of error-correction codewords', () => {
    expect(rsEncode(new Uint8Array([1, 2, 3]), 10)).toHaveLength(10);
    expect(rsEncode(new Uint8Array([1, 2, 3]), 26)).toHaveLength(26);
  });

  it('produces codewords whose syndromes are all zero', () => {
    for (const ecLength of [10, 16, 18, 22, 24, 26]) {
      const data = Array.from({ length: 16 }, (_, i) => (i * 37 + 11) & 0xff);
      const ec = Array.from(rsEncode(new Uint8Array(data), ecLength));
      const codeword = [...data, ...ec];
      for (let power = 0; power < ecLength; power++) {
        expect(evalAt(codeword, power), `ec=${ecLength} syndrome ${power}`).toBe(0);
      }
    }
  });

  it('changes the error-correction codewords when the data changes', () => {
    const a = rsEncode(new Uint8Array([1, 2, 3, 4]), 10);
    const b = rsEncode(new Uint8Array([1, 2, 3, 5]), 10);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });
});

// --- An independent decoder, used by the round-trip test --------------------

const DATA_CODEWORDS_M = [0, 16, 28, 44, 64, 86, 108, 124, 154, 182, 216];
const BLOCKS_M: Array<[number, [number, number], [number, number]]> = [
  [0, [0, 0], [0, 0]],
  [10, [1, 16], [0, 0]], [16, [1, 28], [0, 0]], [26, [1, 44], [0, 0]],
  [18, [2, 32], [0, 0]], [24, [2, 43], [0, 0]], [16, [4, 27], [0, 0]],
  [18, [4, 31], [0, 0]], [22, [2, 38], [2, 39]], [22, [3, 36], [2, 37]],
  [26, [4, 43], [1, 44]],
];
const ALIGNMENT: number[][] = [
  [], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
  [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
];
const MASKS: Array<(r: number, c: number) => boolean> = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

/** Mark every module a scanner treats as a function pattern, not data. */
function functionMap(size: number, version: number): boolean[][] {
  const map = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  const fill = (r0: number, c0: number, h: number, w: number) => {
    for (let r = r0; r < r0 + h; r++) {
      for (let c = c0; c < c0 + w; c++) {
        if (r >= 0 && r < size && c >= 0 && c < size) map[r][c] = true;
      }
    }
  };
  // Finders with their separators, plus the format-information areas.
  fill(0, 0, 9, 9);
  fill(0, size - 8, 9, 8);
  fill(size - 8, 0, 8, 9);
  // Timing patterns.
  fill(6, 0, 1, size);
  fill(0, 6, size, 1);
  // Alignment patterns, excluding those overlapping the finder corners.
  for (const r of ALIGNMENT[version]) {
    for (const c of ALIGNMENT[version]) {
      const nearFinder = (r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8);
      if (!nearFinder) fill(r - 2, c - 2, 5, 5);
    }
  }
  // Version-information blocks.
  if (version >= 7) {
    fill(0, size - 11, 6, 3);
    fill(size - 11, 0, 3, 6);
  }
  return map;
}

/** Reverse the encoder end to end and return the original payload string. */
function decode(qr: { size: number; version: number; modules: boolean[][] }): string {
  const { size, version, modules } = qr;

  // Recover the mask from the format block, then undo it over the data modules.
  let bits = 0;
  for (let i = 0; i < 15; i++) {
    const bit = i < 6 ? modules[i][8] : i < 8 ? modules[i + 1][8] : modules[size - 15 + i][8];
    if (bit) bits |= 1 << i;
  }
  const mask = ((bits ^ 0x5412) >> 10) & 0b111;

  const fn = functionMap(size, version);
  const raw: number[] = [];
  let bitBuffer = 0;
  let bitCount = 0;
  let upward = true;
  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step;
      for (const col of [right, right - 1]) {
        if (fn[row][col]) continue;
        const bit = modules[row][col] !== MASKS[mask](row, col);
        bitBuffer = (bitBuffer << 1) | (bit ? 1 : 0);
        if (++bitCount === 8) {
          raw.push(bitBuffer);
          bitBuffer = 0;
          bitCount = 0;
        }
      }
    }
    upward = !upward;
  }

  // De-interleave into blocks.
  const [ecPerBlock, g1, g2] = BLOCKS_M[version];
  const sizes = [...Array(g1[0]).fill(g1[1]), ...Array(g2[0]).fill(g2[1])] as number[];
  const blocks: number[][] = sizes.map(() => []);
  let cursor = 0;
  for (let i = 0; i < Math.max(...sizes); i++) {
    for (let b = 0; b < sizes.length; b++) {
      if (i < sizes[b]) blocks[b].push(raw[cursor++]);
    }
  }
  const ecBlocks: number[][] = sizes.map(() => []);
  for (let i = 0; i < ecPerBlock; i++) {
    for (let b = 0; b < sizes.length; b++) ecBlocks[b].push(raw[cursor++]);
  }

  // Every reassembled block must be a valid RS codeword.
  for (let b = 0; b < blocks.length; b++) {
    const codeword = [...blocks[b], ...ecBlocks[b]];
    for (let power = 0; power < ecPerBlock; power++) {
      expect(evalAt(codeword, power), `block ${b} syndrome ${power}`).toBe(0);
    }
  }

  const data = blocks.flat();
  expect(data).toHaveLength(DATA_CODEWORDS_M[version]);

  // Read the byte-mode header and payload back out of the data codewords.
  const stream: number[] = [];
  for (const byte of data) {
    for (let i = 7; i >= 0; i--) stream.push((byte >> i) & 1);
  }
  const take = (n: number) => stream.splice(0, n).reduce((acc, b) => (acc << 1) | b, 0);
  expect(take(4)).toBe(0b0100); // byte mode
  const length = take(version >= 10 ? 16 : 8);
  const payload = Array.from({ length }, () => take(8));
  return new TextDecoder().decode(new Uint8Array(payload));
}

describe('encodeQr', () => {
  it('picks the smallest version that fits the payload', () => {
    // Level-M byte capacity: v1 holds 14, v2 holds 26, v3 holds 42.
    expect(encodeQr('a'.repeat(14))!.version).toBe(1);
    expect(encodeQr('a'.repeat(15))!.version).toBe(2);
    expect(encodeQr('a'.repeat(26))!.version).toBe(2);
    expect(encodeQr('a'.repeat(27))!.version).toBe(3);
  });

  it('sizes the matrix as 17 + 4 * version', () => {
    const qr = encodeQr('https://my-app.apps.builderforce.ai')!;
    expect(qr.size).toBe(17 + 4 * qr.version);
    expect(qr.modules).toHaveLength(qr.size);
    for (const row of qr.modules) expect(row).toHaveLength(qr.size);
  });

  it('returns null when the payload exceeds version 10 capacity', () => {
    expect(encodeQr('a'.repeat(213))).not.toBeNull();
    expect(encodeQr('a'.repeat(214))).toBeNull();
  });

  it('counts multi-byte characters by their UTF-8 length', () => {
    // Four 3-byte characters is 12 bytes, still inside version 1's 14.
    expect(encodeQr('日本語訳')!.version).toBe(1);
  });

  it('places the three finder patterns', () => {
    const { modules, size } = encodeQr('https://example.test')!;
    for (const [top, left] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
      // A finder is a dark 7x7 ring with a dark 3x3 core and a light ring between.
      expect(modules[top][left]).toBe(true);
      expect(modules[top][left + 6]).toBe(true);
      expect(modules[top + 6][left]).toBe(true);
      expect(modules[top + 1][left + 1]).toBe(false);
      expect(modules[top + 3][left + 3]).toBe(true);
    }
  });

  it('places the alternating timing patterns and the dark module', () => {
    const { modules, size } = encodeQr('https://example.test')!;
    for (let i = 8; i < size - 8; i++) {
      expect(modules[6][i], `row timing at ${i}`).toBe(i % 2 === 0);
      expect(modules[i][6], `col timing at ${i}`).toBe(i % 2 === 0);
    }
    expect(modules[size - 8][8]).toBe(true);
  });

  it('writes format information that decodes back to level M and a valid mask', () => {
    const { modules, size } = encodeQr('https://my-app.apps.builderforce.ai')!;
    // Read the column-8 copy: rows 0-5, then 7-8, then the bottom-left run.
    let bits = 0;
    for (let i = 0; i < 15; i++) {
      const bit = i < 6 ? modules[i][8] : i < 8 ? modules[i + 1][8] : modules[size - 15 + i][8];
      if (bit) bits |= 1 << i;
    }
    const unmasked = bits ^ 0x5412;
    // The BCH(15,5) remainder must be zero for an intact format block.
    let rem = unmasked;
    for (let i = 4; i >= 0; i--) {
      if (rem & (1 << (i + 10))) rem ^= 0x537 << i;
    }
    expect(rem & 0x3ff).toBe(0);
    // Top two bits are the EC level: 0b00 is level M.
    expect(unmasked >> 13).toBe(0b00);
    const mask = (unmasked >> 10) & 0b111;
    expect(mask).toBeGreaterThanOrEqual(0);
    expect(mask).toBeLessThanOrEqual(7);
  });

  it('places both copies of the format information consistently', () => {
    const { modules, size } = encodeQr('https://example.test')!;
    for (let i = 0; i < 15; i++) {
      const column = i < 6 ? modules[i][8] : i < 8 ? modules[i + 1][8] : modules[size - 15 + i][8];
      const row = i < 8 ? modules[8][size - 1 - i] : i === 8 ? modules[8][7] : modules[8][14 - i];
      expect(row, `format bit ${i}`).toBe(column);
    }
  });

  // The structural checks above prove the symbol LOOKS like a QR code. This one
  // proves it SCANS: it independently reverses the whole pipeline (unmask, walk
  // the data path, de-interleave, verify each block's syndromes, read the byte-
  // mode header) and recovers the original string. A bug in data placement,
  // mask selection or block interleaving produces a symbol that passes every
  // structural test and still decodes to garbage, so this is the real guard.
  it.each([
    'https://my-app.apps.builderforce.ai',
    'exp://u.expo.dev/update/abc123',
    'a',
    'a'.repeat(213),
  ])('round-trips %s through a full decode', (text) => {
    const qr = encodeQr(text)!;
    expect(decode(qr)).toBe(text);
  });

  it('is deterministic for the same input', () => {
    const a = encodeQr('https://my-app.apps.builderforce.ai')!;
    const b = encodeQr('https://my-app.apps.builderforce.ai')!;
    expect(a.modules).toEqual(b.modules);
  });
});
