import { describe, expect, it } from 'vitest';
import { unzlibSync } from 'fflate';
import { crc32 } from './crc32';
import { encodeApng, encodeApngLazy } from './apngEncoder';
import { encodeGif, encodeGifLazy } from './gifEncoder';
import {
  ANIMATION_EXPORT_MAX_PIXELS, AnimationOverBudgetError, assertWithinExportBudget, frameDelayHundredths, frameDelayMs, renderAnimation,
} from './animationExport';
import { createBlankAnimationState, type AnimationState } from './animationState';

const solid = (width: number, height: number, rgba: [number, number, number, number]): Uint8ClampedArray => {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) pixels.set(rgba, i);
  return pixels;
};

describe('crc32', () => {
  it('matches the IEEE check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe('encodeApng', () => {
  const red = { pixels: solid(3, 2, [255, 0, 0, 255]), width: 3, height: 2, delayMs: 100 };
  const blue = { pixels: solid(3, 2, [0, 0, 255, 128]), width: 3, height: 2, delayMs: 250 };

  function chunks(bytes: Uint8Array): Array<{ type: string; data: Uint8Array; crcOk: boolean }> {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const out: Array<{ type: string; data: Uint8Array; crcOk: boolean }> = [];
    let at = 8;
    while (at < bytes.length) {
      const length = view.getUint32(at);
      const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
      const data = bytes.subarray(at + 8, at + 8 + length);
      const crc = view.getUint32(at + 8 + length);
      out.push({ type, data, crcOk: crc === crc32(bytes.subarray(at + 4, at + 8 + length)) });
      at += 12 + length;
    }
    return out;
  }

  it('writes the PNG signature and APNG chunks in spec order, every CRC valid', () => {
    const bytes = encodeApng([red, blue], { loopCount: 3 });
    expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const parsed = chunks(bytes);
    expect(parsed.map((c) => c.type)).toEqual(['IHDR', 'acTL', 'fcTL', 'IDAT', 'fcTL', 'fdAT', 'IEND']);
    expect(parsed.every((c) => c.crcOk)).toBe(true);
    const acTL = new DataView(parsed[1]!.data.buffer, parsed[1]!.data.byteOffset, 8);
    expect(acTL.getUint32(0)).toBe(2);
    expect(acTL.getUint32(4)).toBe(3);
  });

  it('stores a real zlib stream per frame, with scanline filter bytes', () => {
    const parsed = chunks(encodeApng([red, blue]));
    const first = unzlibSync(parsed[3]!.data);
    expect(first.length).toBe((3 * 4 + 1) * 2);
    expect(first[0]).toBe(0);
    expect([...first.subarray(1, 5)]).toEqual([255, 0, 0, 255]);
    // fdAT leads with a 4-byte sequence number before the zlib stream.
    const second = unzlibSync(parsed[5]!.data.subarray(4));
    expect([...second.subarray(1, 5)]).toEqual([0, 0, 255, 128]);
  });

  it('writes per-frame delays as milliseconds over 1000', () => {
    const parsed = chunks(encodeApng([red, blue]));
    const fcTL = new DataView(parsed[4]!.data.buffer, parsed[4]!.data.byteOffset, 26);
    expect(fcTL.getUint16(20)).toBe(250);
    expect(fcTL.getUint16(22)).toBe(1000);
  });

  it('refuses no frames and mismatched dimensions', () => {
    expect(() => encodeApng([])).toThrow(/no frames/);
    expect(() => encodeApng([red, { ...blue, width: 2 }])).toThrow(/dimensions/);
  });
});

describe('encodeGif', () => {
  /** Walks the block structure, counting images and reading the loop count. */
  function inspect(bytes: Uint8Array): { header: string; width: number; height: number; images: number; loop: number; delays: number[] } {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const header = String.fromCharCode(...bytes.subarray(0, 6));
    const width = view.getUint16(6, true);
    const height = view.getUint16(8, true);
    const packed = bytes[10]!;
    let at = 13 + (packed & 0x80 ? 3 * (1 << ((packed & 0x07) + 1)) : 0);
    let images = 0;
    let loop = -1;
    const delays: number[] = [];
    const skipSubBlocks = (): void => { while (bytes[at] !== 0) at += bytes[at]! + 1; at += 1; };
    while (bytes[at] !== 0x3b) {
      if (bytes[at] === 0x21) {
        const label = bytes[at + 1];
        if (label === 0xff) loop = view.getUint16(at + 16, true);
        if (label === 0xf9) delays.push(view.getUint16(at + 4, true));
        at += 2;
        skipSubBlocks();
      } else if (bytes[at] === 0x2c) {
        images++;
        at += 10; // separator + descriptor
        at += 1; // LZW minimum code size
        skipSubBlocks();
      } else {
        throw new Error(`unexpected block 0x${bytes[at]!.toString(16)} at ${at}`);
      }
    }
    return { header, width, height, images, loop, delays };
  }

  it('writes a well-formed GIF89a with one image per frame', () => {
    const frames = [
      { pixels: solid(4, 3, [255, 255, 255, 255]), width: 4, height: 3, delayHundredths: 8 },
      { pixels: solid(4, 3, [10, 20, 30, 255]), width: 4, height: 3, delayHundredths: 17 },
    ];
    const info = inspect(encodeGif(frames, { width: 4, height: 3, loopCount: 0 }));
    expect(info).toMatchObject({ header: 'GIF89a', width: 4, height: 3, images: 2, loop: 0, delays: [8, 17] });
  });

  it('keeps a colour that only appears after the first frame', () => {
    const blank = solid(2, 2, [255, 255, 255, 255]);
    const later = solid(2, 2, [200, 30, 30, 255]);
    const bytes = encodeGif([
      { pixels: blank, width: 2, height: 2, delayHundredths: 5 },
      { pixels: later, width: 2, height: 2, delayHundredths: 5 },
    ], { width: 2, height: 2, loopCount: 2 });
    // The global colour table begins at byte 13 and must contain the later colour.
    const table = [...bytes.subarray(13, 13 + 3 * 4)];
    const entries = [0, 1, 2, 3].map((i) => table.slice(i * 3, i * 3 + 3).join(','));
    expect(entries).toContain('200,30,30');
    expect(inspect(bytes).loop).toBe(2);
  });

  it('survives a frame with more than 256 colours and a long LZW run', () => {
    const width = 64;
    const height = 64;
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) pixels.set([i % 256, (i * 7) % 256, (i * 13) % 256, 255], i * 4);
    const info = inspect(encodeGif([{ pixels, width, height, delayHundredths: 4 }], { width, height, loopCount: 0 }));
    expect(info.images).toBe(1);
  });

  it('refuses no frames and mismatched dimensions', () => {
    expect(() => encodeGif([], { width: 1, height: 1, loopCount: 0 })).toThrow(/no frames/);
    expect(() => encodeGif([{ pixels: solid(2, 2, [0, 0, 0, 255]), width: 2, height: 2, delayHundredths: 1 }], { width: 3, height: 2, loopCount: 0 })).toThrow(/match/);
  });
});

describe('lazy encoding and the export budget', () => {
  const dims = { width: 2, height: 2 };
  const colours: Array<[number, number, number, number]> = [[255, 255, 255, 255], [200, 30, 30, 255], [10, 20, 30, 255]];

  it('APNG pulls frames one at a time and matches the eager encoder', async () => {
    let live = 0;
    let maxLive = 0;
    let pulled = 0;
    async function* source() {
      for (const rgba of colours) {
        live++; pulled++; maxLive = Math.max(maxLive, live);
        yield { pixels: solid(2, 2, rgba), ...dims, delayMs: 50 };
        live--;
      }
    }
    const lazy = await encodeApngLazy(source(), { ...dims, frameCount: colours.length, loopCount: 1 });
    expect(pulled).toBe(3);
    expect(maxLive).toBe(1);
    const eager = encodeApng(colours.map((rgba) => ({ pixels: solid(2, 2, rgba), ...dims, delayMs: 50 })), { loopCount: 1 });
    expect([...lazy]).toEqual([...eager]);
  });

  it('GIF samples then encodes, one frame live per pass, and matches the eager encoder', async () => {
    let live = 0;
    let maxLive = 0;
    let passes = 0;
    const source = async function* () {
      passes++;
      for (const rgba of colours) {
        live++; maxLive = Math.max(maxLive, live);
        yield { pixels: solid(2, 2, rgba), ...dims, delayHundredths: 5 };
        live--;
      }
    };
    const lazy = await encodeGifLazy(source, { ...dims, loopCount: 0, frameCount: colours.length });
    expect(passes).toBe(2);
    expect(maxLive).toBe(1);
    const eager = encodeGif(colours.map((rgba) => ({ pixels: solid(2, 2, rgba), ...dims, delayHundredths: 5 })), { ...dims, loopCount: 0 });
    expect([...lazy]).toEqual([...eager]);
  });

  it('refuses an export over the pixel budget before touching a canvas', async () => {
    const frame = { id: 'f', pixelsDataUrl: null, hold: 1 };
    const state = { ...createBlankAnimationState(), width: 1920, height: 1920, frames: Array.from({ length: 41 }, () => frame) } as AnimationState;
    expect(state.width * state.height * state.frames.length).toBeGreaterThan(ANIMATION_EXPORT_MAX_PIXELS);
    await expect(renderAnimation(state, 'gif', '#fff')).rejects.toBeInstanceOf(AnimationOverBudgetError);
    await expect(renderAnimation(state, 'apng')).rejects.toBeInstanceOf(AnimationOverBudgetError);
    expect(() => assertWithinExportBudget({ ...state, frames: state.frames.slice(0, 40) })).not.toThrow();
  });
});

describe('frame delays', () => {
  it('multiplies the tick by the hold and never drops below one', () => {
    expect(frameDelayMs(10, 1)).toBe(100);
    expect(frameDelayMs(10, 3)).toBe(300);
    expect(frameDelayMs(1000, 1)).toBe(1);
    expect(frameDelayHundredths(10, 3)).toBe(30);
    expect(frameDelayHundredths(1000, 1)).toBe(1);
  });
});
