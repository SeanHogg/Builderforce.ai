/**
 * Minimal GIF89a encoder: raw RGBA frames + per-frame delays in, a GIF byte stream out.
 *
 * Covers the Netscape looping extension, one global palette (median-cut when the strip
 * uses more than 256 colours) and variable-width LZW. The palette is sampled from EVERY
 * frame — a strip that starts on a blank frame would otherwise get a one-colour palette
 * and flatten everything drawn later. No interlace and no transparency: callers
 * composite onto an opaque background first.
 */

export interface GifFrameInput {
  /** RGBA, width*height*4 bytes. */
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  /** Delay in 1/100ths of a second (the GIF native unit). */
  delayHundredths: number;
}

export interface GifEncodeOptions {
  width: number;
  height: number;
  /** 0 = loop forever. */
  loopCount: number;
}

type Rgb = [number, number, number];

function assertFrameSize(frame: GifFrameInput, options: GifEncodeOptions): void {
  if (frame.width !== options.width || frame.height !== options.height) {
    throw new Error(`encodeGif: frame ${frame.width}x${frame.height} doesn't match output ${options.width}x${options.height}`);
  }
}

export function encodeGif(frames: readonly GifFrameInput[], options: GifEncodeOptions): Uint8Array {
  if (frames.length === 0) throw new Error('encodeGif: no frames');
  for (const frame of frames) assertFrameSize(frame, options);
  const palette = buildPalette(frames.map((frame) => frame.pixels), 256);
  const writer = beginGif(palette, options);
  for (const frame of frames) writer.frame(frame);
  return writer.finish();
}

/**
 * Lazy encode: `source` is called twice (palette sampling, then encoding) and each pass pulls
 * ONE frame at a time, so only about one frame of RGBA is live. `frameCount` fixes the palette
 * sampling stride up front.
 */
export async function encodeGifLazy(
  source: () => AsyncIterable<GifFrameInput>,
  options: GifEncodeOptions & { frameCount: number },
): Promise<Uint8Array> {
  if (options.frameCount === 0) throw new Error('encodeGif: no frames');
  const sampler = new PaletteSampler(options.width * options.height * options.frameCount);
  for await (const frame of source()) { assertFrameSize(frame, options); sampler.add(frame.pixels); }
  const writer = beginGif(sampler.palette(256), options);
  for await (const frame of source()) writer.frame(frame);
  return writer.finish();
}

interface GifWriter {
  frame(frame: GifFrameInput): void;
  finish(): Uint8Array;
}

function beginGif(palette: Rgb[], options: GifEncodeOptions): GifWriter {
  const cache = new Map<number, number>();
  const out = new ByteWriter();
  for (const char of 'GIF89a') out.byte(char.charCodeAt(0));

  // Logical screen descriptor: global colour table present, 8-bit resolution.
  out.short(options.width);
  out.short(options.height);
  out.byte(0x80 | 0x70 | paletteSizeBits(palette.length));
  out.byte(0);
  out.byte(0);

  const slots = 1 << (paletteSizeBits(palette.length) + 1);
  for (let i = 0; i < slots; i++) {
    const entry = palette[i] ?? [0, 0, 0];
    out.byte(entry[0]); out.byte(entry[1]); out.byte(entry[2]);
  }

  // Netscape application extension: loop count.
  out.byte(0x21); out.byte(0xff); out.byte(0x0b);
  for (const char of 'NETSCAPE2.0') out.byte(char.charCodeAt(0));
  out.byte(0x03); out.byte(0x01); out.short(options.loopCount); out.byte(0x00);

  return {
    frame(frame) {
      // Graphic control extension: disposal 2 (restore to background), no transparency.
      out.byte(0x21); out.byte(0xf9); out.byte(0x04); out.byte(0x08);
      out.short(Math.max(1, Math.round(frame.delayHundredths)));
      out.byte(0x00); out.byte(0x00);
      // Image descriptor: whole canvas, no local table, no interlace.
      out.byte(0x2c); out.short(0); out.short(0); out.short(options.width); out.short(options.height); out.byte(0x00);
      writeLzwImageData(out, quantize(frame.pixels, palette, cache), palette.length);
    },
    finish() {
      out.byte(0x3b);
      return out.bytes();
    },
  };
}

/** GIF stores a table of 2^(N+1) entries; this is N for the smallest table that fits. */
function paletteSizeBits(length: number): number {
  let slots = 2;
  let bits = 0;
  while (slots < length) { slots *= 2; bits++; }
  return bits;
}

function writeLzwImageData(out: ByteWriter, indices: Uint8Array, paletteLength: number): void {
  const minCodeSize = Math.max(2, paletteSizeBits(paletteLength) + 1);
  out.byte(minCodeSize);
  const data = lzwEncode(indices, minCodeSize);
  for (let at = 0; at < data.length; at += 255) {
    const size = Math.min(255, data.length - at);
    out.byte(size);
    for (let j = 0; j < size; j++) out.byte(data[at + j]!);
  }
  out.byte(0);
}

function lzwEncode(indices: Uint8Array, minCodeSize: number): number[] {
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  const maxCode = 1 << 12;
  const bytes: number[] = [];
  let bitBuffer = 0;
  let bitCount = 0;
  let codeSize = minCodeSize + 1;

  const emit = (code: number): void => {
    bitBuffer |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      bytes.push(bitBuffer & 0xff);
      bitBuffer >>>= 8;
      bitCount -= 8;
    }
  };

  // (prefix code << 8 | next index) -> code. A single index IS its own code.
  const dictionary = new Map<number, number>();
  let nextCode = endCode + 1;
  emit(clearCode);
  if (indices.length === 0) { emit(endCode); if (bitCount > 0) bytes.push(bitBuffer & 0xff); return bytes; }

  let prefix = indices[0]!;
  for (let i = 1; i < indices.length; i++) {
    const next = indices[i]!;
    const key = (prefix << 8) | next;
    const found = dictionary.get(key);
    if (found !== undefined) { prefix = found; continue; }
    emit(prefix);
    if (nextCode < maxCode) {
      dictionary.set(key, nextCode++);
      if (nextCode === (1 << codeSize) + 1 && codeSize < 12) codeSize++;
    } else {
      emit(clearCode);
      dictionary.clear();
      nextCode = endCode + 1;
      codeSize = minCodeSize + 1;
    }
    prefix = next;
  }
  emit(prefix);
  emit(endCode);
  if (bitCount > 0) bytes.push(bitBuffer & 0xff);
  return bytes;
}

// ── Palette: sample every frame, median-cut above 256 colours ──────────────────

function buildPalette(buffers: readonly Uint8ClampedArray[], maxColors: number): Rgb[] {
  const sampler = new PaletteSampler(buffers.reduce((sum, buffer) => sum + buffer.length / 4, 0));
  for (const pixels of buffers) sampler.add(pixels);
  return sampler.palette(maxColors);
}

/** Collects distinct sampled colours one frame at a time; the stride is fixed by the total pixel count. */
class PaletteSampler {
  private readonly stride: number;
  private readonly samples: Rgb[] = [];
  private readonly seen = new Set<number>();
  constructor(totalPixels: number) { this.stride = Math.max(1, Math.floor(totalPixels / 8192)); }
  add(pixels: Uint8ClampedArray): void {
    for (let i = 0; i < pixels.length; i += this.stride * 4) {
      const r = pixels[i]!;
      const g = pixels[i + 1]!;
      const b = pixels[i + 2]!;
      const key = (r << 16) | (g << 8) | b;
      if (this.seen.has(key)) continue;
      this.seen.add(key);
      this.samples.push([r, g, b]);
    }
  }
  palette(maxColors: number): Rgb[] {
    return medianCut(this.samples, maxColors);
  }
}

function medianCut(samples: Rgb[], maxColors: number): Rgb[] {
  if (samples.length === 0) return [[0, 0, 0]];
  if (samples.length <= maxColors) return samples;

  const buckets: Rgb[][] = [samples];
  while (buckets.length < maxColors) {
    let widest = -1;
    let widestIndex = 0;
    let widestChannel = 0;
    buckets.forEach((bucket, index) => {
      if (bucket.length < 2) return;
      const [range, channel] = widestChannelRange(bucket);
      if (range > widest) { widest = range; widestIndex = index; widestChannel = channel; }
    });
    if (widest <= 0) break;
    const bucket = buckets[widestIndex]!;
    bucket.sort((a, b) => a[widestChannel]! - b[widestChannel]!);
    const middle = Math.floor(bucket.length / 2);
    buckets.splice(widestIndex, 1, bucket.slice(0, middle), bucket.slice(middle));
  }
  return buckets.map(meanColor);
}

function widestChannelRange(bucket: readonly Rgb[]): [number, number] {
  const low: Rgb = [255, 255, 255];
  const high: Rgb = [0, 0, 0];
  for (const pixel of bucket) {
    for (let c = 0; c < 3; c++) {
      if (pixel[c]! < low[c]!) low[c] = pixel[c]!;
      if (pixel[c]! > high[c]!) high[c] = pixel[c]!;
    }
  }
  let range = -1;
  let channel = 0;
  for (let c = 0; c < 3; c++) {
    if (high[c]! - low[c]! > range) { range = high[c]! - low[c]!; channel = c; }
  }
  return [range, channel];
}

function meanColor(bucket: readonly Rgb[]): Rgb {
  let r = 0; let g = 0; let b = 0;
  for (const pixel of bucket) { r += pixel[0]; g += pixel[1]; b += pixel[2]; }
  const n = bucket.length || 1;
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}

/** Nearest palette entry per pixel; `cache` makes a flat-coloured frame near-free. */
function quantize(pixels: Uint8ClampedArray, palette: readonly Rgb[], cache: Map<number, number>): Uint8Array {
  const out = new Uint8Array(pixels.length / 4);
  for (let i = 0, j = 0; i < pixels.length; i += 4, j++) {
    const r = pixels[i]!;
    const g = pixels[i + 1]!;
    const b = pixels[i + 2]!;
    const key = (r << 16) | (g << 8) | b;
    let best = cache.get(key);
    if (best === undefined) {
      let bestDistance = Infinity;
      best = 0;
      for (let p = 0; p < palette.length; p++) {
        const entry = palette[p]!;
        const distance = (r - entry[0]) ** 2 + (g - entry[1]) ** 2 + (b - entry[2]) ** 2;
        if (distance < bestDistance) { bestDistance = distance; best = p; }
      }
      cache.set(key, best);
    }
    out[j] = best;
  }
  return out;
}

class ByteWriter {
  private readonly buffer: number[] = [];
  byte(value: number): void { this.buffer.push(value & 0xff); }
  short(value: number): void { this.buffer.push(value & 0xff, (value >>> 8) & 0xff); }
  bytes(): Uint8Array { return new Uint8Array(this.buffer); }
}
