/**
 * A QR encoder, for getting a published game onto a phone.
 *
 * The distance between "the game is live at an address" and "my son is playing
 * it" is typing that address on a phone keyboard, and that is where the whole
 * flow dies in practice. A code you point a camera at removes it entirely.
 *
 * Written rather than pulled in because the frontend has no QR dependency and
 * this needs one narrow case: a short HTTPS URL, on screen, in both themes. That
 * case lets the implementation stop well short of the full specification —
 * versions 1 to 6 at error-correction level M, byte mode only. Version 6 holds
 * 134 bytes, roughly three times the longest address this can produce, and
 * stopping there removes the two most error-prone parts of the format: version
 * information blocks (only required from version 7) and mixed block sizes (levels
 * and versions where the data is split into groups of differing length — never
 * the case for versions 1 to 6 at level M).
 *
 * Returns null rather than throwing when the input will not fit, so the caller
 * shows the link instead. Nothing here is a security boundary; the output is a
 * picture of a URL the user just published.
 */

/** Data codewords per version at error-correction level M. */
const DATA_CODEWORDS = [16, 28, 44, 64, 86, 108];
/**
 * How many BYTES each version actually holds — not the same number.
 *
 * A byte-mode segment spends 12 bits before any payload: a 4-bit mode indicator
 * and an 8-bit character count. Selecting a version by data-codeword count
 * instead overflows by two bytes at every size, which the encoder then silently
 * truncates. Version 6 holds 106 bytes, roughly three times the longest address
 * this is ever asked for.
 */
const BYTE_CAPACITY = DATA_CODEWORDS.map((codewords) => Math.floor((codewords * 8 - 12) / 8));
/** EC codewords per block, and block count, per version at level M. */
const EC_PER_BLOCK = [10, 16, 26, 18, 24, 16];
const BLOCKS = [1, 1, 1, 2, 2, 4];
/** The single alignment-pattern centre per version; version 1 has none. */
const ALIGNMENT_CENTRE = [0, 18, 22, 26, 30, 34];

/* ---------- GF(256), the field the error correction lives in ---------- */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    // Multiply by the generator (2) modulo the primitive polynomial 0x11d.
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!;
}

const mul = (a: number, b: number): number => (a === 0 || b === 0 ? 0 : EXP[LOG[a]! + LOG[b]!]!);

/**
 * The generator polynomial for `count` error-correction codewords: the product
 * of (x − α^i) for i in 0…count−1.
 *
 * Coefficients are HIGHEST degree first, which is what {@link errorCorrection}
 * assumes when it skips index 0 to drop the monic leading term. Storing it the
 * other way round produces remainders that look plausible and are wrong.
 */
function generatorPoly(count: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < count; i++) {
    const next = new Uint8Array(poly.length + 1);
    for (let j = 0; j < poly.length; j++) {
      next[j] = (next[j]! ^ poly[j]!) as number; // × x
      next[j + 1] = (next[j + 1]! ^ mul(poly[j]!, EXP[i]!)) as number; // × α^i
    }
    poly = next;
  }
  return poly;
}

/** Polynomial long division: the remainder IS the error-correction block. */
function errorCorrection(data: Uint8Array, count: number): Uint8Array {
  const generator = generatorPoly(count);
  const remainder = new Uint8Array(count);
  for (const byte of data) {
    const factor = byte ^ remainder[0]!;
    remainder.copyWithin(0, 1);
    remainder[count - 1] = 0;
    if (factor !== 0) {
      for (let i = 0; i < count; i++) {
        remainder[i] = (remainder[i]! ^ mul(generator[i + 1]!, factor)) as number;
      }
    }
  }
  return remainder;
}

/* ---------- the bitstream ---------- */

class BitBuffer {
  private bits: number[] = [];

  put(value: number, length: number): void {
    for (let i = length - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  }

  get length(): number {
    return this.bits.length;
  }

  toBytes(target: number): Uint8Array {
    const bytes = new Uint8Array(target);
    for (let i = 0; i < this.bits.length; i++) {
      if (this.bits[i]) bytes[i >> 3]! |= 0x80 >> (i & 7);
    }
    // Alternating pad bytes, as the specification requires — a run of zeroes
    // scores badly under the mask penalty and reads less reliably.
    for (let i = Math.ceil(this.bits.length / 8); i < target; i++) {
      bytes[i] = i % 2 === Math.ceil(this.bits.length / 8) % 2 ? 0xec : 0x11;
    }
    return bytes;
  }
}

/* ---------- the matrix ---------- */

type Matrix = { size: number; modules: Int8Array };

const at = (m: Matrix, x: number, y: number): number => m.modules[y * m.size + x]!;
const set = (m: Matrix, x: number, y: number, value: number): void => {
  m.modules[y * m.size + x] = value;
};

/** -1 = free (data goes here), 0 = light function module, 1 = dark. */
function functionPatterns(version: number): Matrix {
  const size = version * 4 + 17;
  const matrix: Matrix = { size, modules: new Int8Array(size * size).fill(-1) };

  const finder = (ox: number, oy: number) => {
    for (let y = -1; y <= 7; y++) {
      for (let x = -1; x <= 7; x++) {
        const px = ox + x;
        const py = oy + y;
        if (px < 0 || py < 0 || px >= size || py >= size) continue;
        const ring = Math.max(Math.abs(x - 3), Math.abs(y - 3));
        // The separator (the light ring at distance 4) is part of the pattern.
        set(matrix, px, py, ring === 2 || ring === 4 || x === -1 || y === -1 || x === 7 || y === 7 ? 0 : 1);
      }
    }
  };
  finder(0, 0);
  finder(size - 7, 0);
  finder(0, size - 7);

  // Timing patterns: the alternating row and column that let a reader establish
  // module pitch.
  for (let i = 8; i < size - 8; i++) {
    set(matrix, i, 6, i % 2 === 0 ? 1 : 0);
    set(matrix, 6, i, i % 2 === 0 ? 1 : 0);
  }

  const centre = ALIGNMENT_CENTRE[version - 1]!;
  if (centre) {
    for (let y = -2; y <= 2; y++) {
      for (let x = -2; x <= 2; x++) {
        set(matrix, centre + x, centre + y, Math.max(Math.abs(x), Math.abs(y)) === 1 ? 0 : 1);
      }
    }
  }

  // Format-information area, reserved now and written after masking.
  for (let i = 0; i < 9; i++) {
    if (at(matrix, i, 8) === -1) set(matrix, i, 8, 0);
    if (at(matrix, 8, i) === -1) set(matrix, 8, i, 0);
  }
  for (let i = 0; i < 8; i++) {
    set(matrix, size - 1 - i, 8, 0);
    set(matrix, 8, size - 1 - i, 0);
  }
  // The dark module — always dark, always here.
  set(matrix, 8, size - 8, 1);

  return matrix;
}

/** Walk the free modules bottom-right to top-left, two columns at a time. */
function placeData(matrix: Matrix, data: Uint8Array): void {
  let bit = 0;
  let upward = true;
  for (let right = matrix.size - 1; right >= 1; right -= 2) {
    // Column 6 is the vertical timing pattern and is skipped entirely.
    if (right === 6) right = 5;
    for (let step = 0; step < matrix.size; step++) {
      const y = upward ? matrix.size - 1 - step : step;
      for (const x of [right, right - 1]) {
        if (at(matrix, x, y) !== -1) continue;
        const value = bit < data.length * 8 ? (data[bit >> 3]! >> (7 - (bit & 7))) & 1 : 0;
        set(matrix, x, y, value);
        bit++;
      }
    }
    upward = !upward;
  }
}

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

/**
 * How badly a masked matrix reads. Lower is better.
 *
 * The four rules from the specification, in order: long same-colour runs,
 * 2×2 same-colour blocks, the finder-like 1:1:3:1:1 sequence appearing in the
 * data, and an unbalanced dark/light ratio.
 */
function penalty(matrix: Matrix): number {
  const { size } = matrix;
  let score = 0;

  const runScore = (line: number[]) => {
    let total = 0;
    let run = 1;
    for (let i = 1; i < line.length; i++) {
      if (line[i] === line[i - 1]) {
        run++;
      } else {
        if (run >= 5) total += 3 + (run - 5);
        run = 1;
      }
    }
    if (run >= 5) total += 3 + (run - 5);
    return total;
  };

  const FINDER = [1, 0, 1, 1, 1, 0, 1];
  const hasFinderAt = (line: number[], i: number) =>
    FINDER.every((bit, k) => line[i + k] === bit)
    && (line.slice(Math.max(0, i - 4), i).every((bit) => bit === 0) && i - 4 >= 0
      || line.slice(i + 7, i + 11).every((bit) => bit === 0) && i + 11 <= line.length);

  for (let i = 0; i < size; i++) {
    const row: number[] = [];
    const column: number[] = [];
    for (let j = 0; j < size; j++) {
      row.push(at(matrix, j, i));
      column.push(at(matrix, i, j));
    }
    score += runScore(row) + runScore(column);
    for (let j = 0; j + 7 <= size; j++) {
      if (hasFinderAt(row, j)) score += 40;
      if (hasFinderAt(column, j)) score += 40;
    }
  }

  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const first = at(matrix, x, y);
      if (first === at(matrix, x + 1, y) && first === at(matrix, x, y + 1) && first === at(matrix, x + 1, y + 1)) {
        score += 3;
      }
    }
  }

  let dark = 0;
  for (let i = 0; i < matrix.modules.length; i++) if (matrix.modules[i] === 1) dark++;
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return score;
}

/** BCH(15,5)-encoded format information for level M and a mask. */
function formatBits(mask: number): number {
  // 0b00 is level M. The five data bits are the level then the mask.
  const data = (0b00 << 3) | mask;
  let remainder = data << 10;
  for (let i = 4; i >= 0; i--) {
    if (remainder & (1 << (i + 10))) remainder ^= 0b10100110111 << i;
  }
  return ((data << 10) | remainder) ^ 0b101010000010010;
}

function writeFormat(matrix: Matrix, mask: number): void {
  const bits = formatBits(mask);
  const { size } = matrix;
  for (let i = 0; i < 15; i++) {
    const bit = (bits >> i) & 1;
    // Copy 1, around the top-left finder.
    if (i < 6) set(matrix, 8, i, bit);
    else if (i < 8) set(matrix, 8, i + 1, bit);
    else if (i === 8) set(matrix, 7, 8, bit);
    else set(matrix, 14 - i, 8, bit);
    // Copy 2, split between the other two finders.
    if (i < 8) set(matrix, size - 1 - i, 8, bit);
    else set(matrix, 8, size - 15 + i, bit);
  }
}

/**
 * Encode `text` as a QR matrix of booleans, or null when it will not fit.
 *
 * Exported separately from the SVG renderer so the geometry can be tested
 * without asserting on markup.
 */
export function qrMatrix(text: string): boolean[][] | null {
  const bytes = new TextEncoder().encode(text);

  const version = BYTE_CAPACITY.findIndex((capacity) => bytes.length <= capacity) + 1;
  if (version === 0) return null;

  const dataCodewords = DATA_CODEWORDS[version - 1]!;
  const blockCount = BLOCKS[version - 1]!;
  const ecCount = EC_PER_BLOCK[version - 1]!;

  const buffer = new BitBuffer();
  buffer.put(0b0100, 4); // byte mode
  buffer.put(bytes.length, 8); // character count, 8 bits for versions 1–9
  for (const byte of bytes) buffer.put(byte, 8);
  // Terminator, truncated if there is no room for all four bits.
  buffer.put(0, Math.min(4, dataCodewords * 8 - buffer.length));
  const payload = buffer.toBytes(dataCodewords);

  // Split into blocks, compute EC per block, then INTERLEAVE — a QR is read
  // block-interleaved so that physical damage is spread across blocks rather
  // than destroying one of them entirely.
  const perBlock = dataCodewords / blockCount;
  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  for (let i = 0; i < blockCount; i++) {
    const block = payload.subarray(i * perBlock, (i + 1) * perBlock);
    dataBlocks.push(block);
    ecBlocks.push(errorCorrection(block, ecCount));
  }

  const interleaved: number[] = [];
  for (let i = 0; i < perBlock; i++) for (const block of dataBlocks) interleaved.push(block[i]!);
  for (let i = 0; i < ecCount; i++) for (const block of ecBlocks) interleaved.push(block[i]!);

  const template = functionPatterns(version);
  const reserved = Int8Array.from(template.modules);

  let best: Matrix | null = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const matrix: Matrix = { size: template.size, modules: Int8Array.from(reserved) };
    placeData(matrix, Uint8Array.from(interleaved));
    // Mask only the data modules — the function patterns are already final.
    for (let y = 0; y < matrix.size; y++) {
      for (let x = 0; x < matrix.size; x++) {
        if (reserved[y * matrix.size + x] === -1 && MASKS[mask]!(x, y)) {
          set(matrix, x, y, at(matrix, x, y) ^ 1);
        }
      }
    }
    writeFormat(matrix, mask);
    const score = penalty(matrix);
    if (score < bestScore) {
      bestScore = score;
      best = matrix;
    }
  }
  if (!best) return null;

  const rows: boolean[][] = [];
  for (let y = 0; y < best.size; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < best.size; x++) row.push(at(best, x, y) === 1);
    rows.push(row);
  }
  return rows;
}

/**
 * A QR code as an inline SVG string, or null when the text will not fit.
 *
 * The quiet zone is not optional decoration — a code without four modules of
 * margin fails to scan against a busy background, which a canvas is. Colours are
 * parameters rather than theme tokens because this is also embedded into
 * generated files that have no access to the app's stylesheet; the canvas passes
 * its own tokens in.
 */
export function qrSvg(
  text: string,
  options: { dark?: string; light?: string; size?: number } = {},
): string | null {
  const rows = qrMatrix(text);
  if (!rows) return null;
  const dark = options.dark ?? '#000000';
  const light = options.light ?? '#ffffff';
  const quiet = 4;
  const extent = rows.length + quiet * 2;

  // One path for every dark module beats one <rect> each: the same picture at a
  // fraction of the node count, which matters when this re-renders with a panel.
  const path = rows
    .flatMap((row, y) =>
      row.map((on, x) => (on ? `M${x + quiet} ${y + quiet}h1v1h-1z` : '')).filter(Boolean),
    )
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${extent} ${extent}" `
    + `width="${options.size ?? extent * 4}" height="${options.size ?? extent * 4}" `
    + `shape-rendering="crispEdges" role="img" aria-label="QR code">`
    + `<rect width="${extent}" height="${extent}" fill="${light}"/>`
    + `<path d="${path}" fill="${dark}"/>`
    + '</svg>';
}
