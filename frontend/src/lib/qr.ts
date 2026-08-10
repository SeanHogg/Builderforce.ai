/**
 * Minimal, dependency-free QR encoder (byte mode, error-correction level M,
 * versions 1–10).
 *
 * The mobile IDE needs to show a scannable code for the project's published URL
 * ("Preview on your phone"). Every option that isn't this one is worse:
 * a QR npm package is a runtime dependency for ~200 lines of well-specified
 * maths, and a hosted image service would ship the user's project URL to a third
 * party on every render. So: encode locally, render as SVG.
 *
 * Scope is deliberately narrow. Versions 1–10 at level M hold 213 bytes, which
 * covers any project URL by a wide margin; `encodeQr` returns null rather than
 * guessing when the payload doesn't fit, and callers fall back to showing the
 * link as text.
 *
 * Reference: ISO/IEC 18004. The tables below are the version-specific block
 * layouts and alignment-pattern centres for versions 1–10 only.
 */

/** Error-correction level M (~15% recovery) — the only level this encoder emits. */
const EC_LEVEL_BITS = 0b00;

/** Total data codewords available at level M, indexed by version (1-based). */
const DATA_CODEWORDS_M = [0, 16, 28, 44, 64, 86, 108, 124, 154, 182, 216];

/**
 * Level-M block layout per version: error-correction codewords per block, then
 * the two block groups as [blockCount, dataCodewordsPerBlock]. Group 2 is absent
 * for most versions (its count is 0).
 */
interface BlockLayout {
  ecPerBlock: number;
  group1: [number, number];
  group2: [number, number];
}
const BLOCK_LAYOUT_M: Array<BlockLayout | null> = [
  null,
  { ecPerBlock: 10, group1: [1, 16], group2: [0, 0] },
  { ecPerBlock: 16, group1: [1, 28], group2: [0, 0] },
  { ecPerBlock: 26, group1: [1, 44], group2: [0, 0] },
  { ecPerBlock: 18, group1: [2, 32], group2: [0, 0] },
  { ecPerBlock: 24, group1: [2, 43], group2: [0, 0] },
  { ecPerBlock: 16, group1: [4, 27], group2: [0, 0] },
  { ecPerBlock: 18, group1: [4, 31], group2: [0, 0] },
  { ecPerBlock: 22, group1: [2, 38], group2: [2, 39] },
  { ecPerBlock: 22, group1: [3, 36], group2: [2, 37] },
  { ecPerBlock: 26, group1: [4, 43], group2: [1, 44] },
];

/** Alignment-pattern centre coordinates per version (1-based). */
const ALIGNMENT_CENTRES: number[][] = [
  [], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
  [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
];

const MAX_VERSION = 10;

// --- GF(256) arithmetic (primitive polynomial 0x11D) ------------------------

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

/** The generator polynomial for `degree` error-correction codewords. */
function rsGenerator(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], GF_EXP[i]);
    }
    poly = next;
  }
  return poly;
}

/** Reed-Solomon error-correction codewords for one data block. */
export function rsEncode(data: Uint8Array, ecLength: number): Uint8Array {
  const gen = rsGenerator(ecLength);
  const remainder = new Uint8Array(ecLength);
  for (const byte of data) {
    const factor = byte ^ remainder[0];
    remainder.copyWithin(0, 1);
    remainder[ecLength - 1] = 0;
    if (factor !== 0) {
      for (let i = 0; i < ecLength; i++) remainder[i] ^= gfMul(gen[i + 1], factor);
    }
  }
  return remainder;
}

// --- BCH codes for the format and version information areas -----------------

/** 15-bit format information: 2 EC-level bits + 3 mask bits, BCH-protected. */
function formatBits(mask: number): number {
  const data = (EC_LEVEL_BITS << 3) | mask;
  let rem = data << 10;
  for (let i = 4; i >= 0; i--) {
    if (rem & (1 << (i + 10))) rem ^= 0x537 << i;
  }
  return ((data << 10) | rem) ^ 0x5412;
}

/** 18-bit version information (versions 7+ only), BCH-protected. */
function versionBits(version: number): number {
  let rem = version << 12;
  for (let i = 5; i >= 0; i--) {
    if (rem & (1 << (i + 12))) rem ^= 0x1f25 << i;
  }
  return (version << 12) | rem;
}

// --- Encoding ---------------------------------------------------------------

/** Byte-mode payload capacity (in bytes) for a version at level M. */
function byteCapacity(version: number): number {
  const charCountBits = version >= 10 ? 16 : 8;
  return Math.floor((DATA_CODEWORDS_M[version] * 8 - 4 - charCountBits) / 8);
}

/** Smallest version that fits `byteLength`, or null when it exceeds version 10. */
function pickVersion(byteLength: number): number | null {
  for (let v = 1; v <= MAX_VERSION; v++) {
    if (byteLength <= byteCapacity(v)) return v;
  }
  return null;
}

/** Build the final interleaved codeword stream (data blocks then EC blocks). */
function buildCodewords(payload: Uint8Array, version: number): Uint8Array {
  const layout = BLOCK_LAYOUT_M[version]!;
  const totalData = DATA_CODEWORDS_M[version];
  const charCountBits = version >= 10 ? 16 : 8;

  // Bit stream: mode indicator (0100 = byte), character count, payload.
  const bits: number[] = [];
  const pushBits = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >> i) & 1);
  };
  pushBits(0b0100, 4);
  pushBits(payload.length, charCountBits);
  for (const byte of payload) pushBits(byte, 8);

  // Terminator (up to 4 zero bits), then pad to a byte boundary.
  const capacityBits = totalData * 8;
  for (let i = 0; i < 4 && bits.length < capacityBits; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const data = new Uint8Array(totalData);
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    data[i / 8] = byte;
  }
  // Pad the remainder with the specified alternating pad codewords.
  for (let i = bits.length / 8, alt = 0; i < totalData; i++, alt++) {
    data[i] = alt % 2 === 0 ? 0xec : 0x11;
  }

  // Split into blocks, error-correct each, then interleave.
  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  let offset = 0;
  for (const [count, size] of [layout.group1, layout.group2]) {
    for (let b = 0; b < count; b++) {
      const block = data.subarray(offset, offset + size);
      offset += size;
      dataBlocks.push(block);
      ecBlocks.push(rsEncode(block, layout.ecPerBlock));
    }
  }

  const out: number[] = [];
  const maxDataLen = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < maxDataLen; i++) {
    for (const block of dataBlocks) if (i < block.length) out.push(block[i]);
  }
  for (let i = 0; i < layout.ecPerBlock; i++) {
    for (const block of ecBlocks) out.push(block[i]);
  }
  return new Uint8Array(out);
}

// --- Matrix construction ----------------------------------------------------

/** A module is `null` while unreserved, so data placement knows where it may write. */
type Grid = Array<Array<boolean | null>>;

function placeFunctionPatterns(grid: Grid, version: number): void {
  const size = grid.length;

  const finderAt = (row: number, col: number) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const rr = row + r;
        const cc = col + c;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        const inRing = (r >= 0 && r <= 6 && (c === 0 || c === 6)) || (c >= 0 && c <= 6 && (r === 0 || r === 6));
        const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        grid[rr][cc] = inRing || inCore;
      }
    }
  };
  finderAt(0, 0);
  finderAt(0, size - 7);
  finderAt(size - 7, 0);

  // Timing patterns.
  for (let i = 8; i < size - 8; i++) {
    grid[6][i] = i % 2 === 0;
    grid[i][6] = i % 2 === 0;
  }

  // Alignment patterns, skipping the three finder corners.
  const centres = ALIGNMENT_CENTRES[version];
  for (const r of centres) {
    for (const c of centres) {
      const nearFinder =
        (r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8);
      if (nearFinder) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          grid[r + dr][c + dc] = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
        }
      }
    }
  }

  // The always-dark module below the top-left finder.
  grid[size - 8][8] = true;

  // Reserve the format-information areas (written after masking).
  for (let i = 0; i < 9; i++) {
    if (grid[8][i] === null) grid[8][i] = false;
    if (grid[i][8] === null) grid[i][8] = false;
  }
  for (let i = 0; i < 8; i++) {
    if (grid[8][size - 1 - i] === null) grid[8][size - 1 - i] = false;
    if (grid[size - 1 - i][8] === null) grid[size - 1 - i][8] = false;
  }

  // Version information blocks (versions 7+).
  if (version >= 7) {
    const bits = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const bit = ((bits >> i) & 1) === 1;
      const row = Math.floor(i / 3);
      const col = i % 3;
      grid[row][size - 11 + col] = bit;
      grid[size - 11 + col][row] = bit;
    }
  }
}

/** Walk the zigzag data path, writing codeword bits into unreserved modules. */
function placeData(grid: Grid, codewords: Uint8Array): void {
  const size = grid.length;
  let bitIndex = 0;
  let upward = true;

  for (let right = size - 1; right > 0; right -= 2) {
    // Column 6 is the vertical timing pattern; the path skips over it.
    if (right === 6) right = 5;
    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step;
      for (const col of [right, right - 1]) {
        if (grid[row][col] !== null) continue;
        const byte = codewords[bitIndex >> 3];
        // Past the last codeword the spec leaves remainder bits at zero.
        const bit = byte === undefined ? 0 : (byte >> (7 - (bitIndex & 7))) & 1;
        grid[row][col] = bit === 1;
        bitIndex++;
      }
    }
    upward = !upward;
  }
}

/** The eight standard data-mask predicates. */
const MASK_FNS: Array<(row: number, col: number) => boolean> = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

/** Penalty score used to choose the least visually-confusable mask. */
function penalty(modules: boolean[][]): number {
  const size = modules.length;
  let score = 0;

  // Rule 1: runs of five or more same-coloured modules in a row or column.
  for (let i = 0; i < size; i++) {
    for (const read of [(j: number) => modules[i][j], (j: number) => modules[j][i]]) {
      let runColour = read(0);
      let runLength = 1;
      for (let j = 1; j < size; j++) {
        const value = read(j);
        if (value === runColour) {
          runLength++;
        } else {
          if (runLength >= 5) score += runLength - 2;
          runColour = value;
          runLength = 1;
        }
      }
      if (runLength >= 5) score += runLength - 2;
    }
  }

  // Rule 2: 2x2 blocks of one colour.
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = modules[r][c];
      if (v === modules[r][c + 1] && v === modules[r + 1][c] && v === modules[r + 1][c + 1]) score += 3;
    }
  }

  // Rule 3: finder-like 1:1:3:1:1 patterns with four light modules beside them.
  const pattern = [true, false, true, true, true, false, true, false, false, false, false];
  const reversed = [...pattern].reverse();
  for (let i = 0; i < size; i++) {
    for (let j = 0; j + 11 <= size; j++) {
      const row = modules[i].slice(j, j + 11);
      const col = Array.from({ length: 11 }, (_, k) => modules[j + k][i]);
      for (const line of [row, col]) {
        if (pattern.every((v, k) => v === line[k]) || reversed.every((v, k) => v === line[k])) score += 40;
      }
    }
  }

  // Rule 4: deviation from an even balance of dark and light modules.
  const dark = modules.flat().filter(Boolean).length;
  const ratio = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(ratio - 50) / 5) * 10;

  return score;
}

/**
 * Write the 15 format-information bits for `mask` into their two copies.
 *
 * Bit 0 is the LSB. Column 8 runs top-down (skipping the row-6 timing module)
 * and continues in the bottom-left corner; row 8 runs right-to-left from the
 * top-right corner and continues beside the top-left finder. Note that neither
 * run touches (size - 8, 8) — that module is the always-dark one, and writing a
 * format bit over it corrupts both the dark module and the format block.
 */
function placeFormatInfo(modules: boolean[][], mask: number): void {
  const size = modules.length;
  const bits = formatBits(mask);
  for (let i = 0; i < 15; i++) {
    const bit = ((bits >> i) & 1) === 1;
    // Column 8: rows 0-5, then 7-8, then the bottom-left run.
    if (i < 6) modules[i][8] = bit;
    else if (i < 8) modules[i + 1][8] = bit;
    else modules[size - 15 + i][8] = bit;
    // Row 8: the top-right run, then column 7, then columns 5-0.
    if (i < 8) modules[8][size - 1 - i] = bit;
    else if (i === 8) modules[8][7] = bit;
    else modules[8][14 - i] = bit;
  }
}

/** A rendered QR symbol: a square matrix of dark/light modules. */
export interface QrMatrix {
  size: number;
  version: number;
  /** `modules[row][col]` — true is a dark module. */
  modules: boolean[][];
}

/**
 * Encode `text` as a QR symbol (byte mode, EC level M). Returns null when the
 * UTF-8 payload exceeds the 213-byte capacity of version 10 — callers should
 * fall back to showing the value as text rather than rendering a broken code.
 */
export function encodeQr(text: string): QrMatrix | null {
  const payload = new TextEncoder().encode(text);
  const version = pickVersion(payload.length);
  if (version === null) return null;

  const size = 17 + version * 4;
  const grid: Grid = Array.from({ length: size }, () => Array<boolean | null>(size).fill(null));
  placeFunctionPatterns(grid, version);

  // Remember which modules the data path may not touch, so masking skips them.
  const reserved = grid.map((row) => row.map((cell) => cell !== null));
  placeData(grid, buildCodewords(payload, version));

  // Try every mask, keep the lowest-penalty result.
  let best: boolean[][] | null = null;
  let bestScore = Infinity;
  let bestMask = 0;
  for (let mask = 0; mask < 8; mask++) {
    const candidate = grid.map((row, r) =>
      row.map((cell, c) => (reserved[r][c] ? cell === true : (cell === true) !== MASK_FNS[mask](r, c))),
    );
    placeFormatInfo(candidate, mask);
    const score = penalty(candidate);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
      bestMask = mask;
    }
  }

  const modules = best!;
  placeFormatInfo(modules, bestMask);
  return { size, version, modules };
}
