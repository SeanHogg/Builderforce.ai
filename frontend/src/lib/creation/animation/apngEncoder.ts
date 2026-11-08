/**
 * Minimal APNG encoder: raw RGBA frames + per-frame delays in, an APNG byte stream out.
 *
 * APNG is a PNG with three extra chunks — `acTL` (animation control), `fcTL` (frame
 * control) and `fdAT` (frame data). A decoder that does not know them shows only the
 * first frame, which is exactly the static-PNG fallback wanted. Each frame is its own
 * zlib stream (`fflate`) with no inter-frame delta coding: larger than `apngasm`
 * output, but it decodes everywhere.
 */
import { zlibSync } from 'fflate';
import { crc32 } from './crc32';

export interface ApngFrame {
  /** RGBA, width*height*4 bytes. */
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  /** Delay in milliseconds (stored as delay_num / 1000). */
  delayMs: number;
}

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function u32(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}
function u16(n: number): Uint8Array {
  return new Uint8Array([(n >>> 8) & 0xff, n & 0xff]);
}
function concat(parts: Uint8Array[]): Uint8Array {
  let length = 0;
  for (const part of parts) length += part.length;
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new Uint8Array(4);
  for (let i = 0; i < 4; i++) typeBytes[i] = type.charCodeAt(i);
  return concat([u32(data.length), typeBytes, data, u32(crc32(concat([typeBytes, data])))]);
}

/** Filter type 0 (None) on every scanline, then zlib-compress. */
function imageData(pixels: Uint8ClampedArray, width: number, height: number): Uint8Array {
  const stride = width * 4;
  const filtered = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    filtered[y * (stride + 1)] = 0;
    filtered.set(pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  return zlibSync(filtered);
}

interface ApngWriter {
  frame(frame: ApngFrame): void;
  finish(): Uint8Array;
}

/** Writes the signature, IHDR and acTL (which must precede the first IDAT), then takes frames one at a time. */
function beginApng(width: number, height: number, frameCount: number, loopCount: number): ApngWriter {
  const parts: Uint8Array[] = [PNG_SIGNATURE];
  const ihdr = new Uint8Array(13);
  ihdr.set(u32(width), 0);
  ihdr.set(u32(height), 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  parts.push(chunk('IHDR', ihdr));

  const acTL = new Uint8Array(8);
  acTL.set(u32(frameCount), 0);
  acTL.set(u32(loopCount), 4);
  parts.push(chunk('acTL', acTL));

  let sequence = 0;
  let index = 0;
  return {
    frame(frame) {
      if (frame.width !== width || frame.height !== height) throw new Error('encodeApng: every frame must share dimensions');
      const fcTL = new Uint8Array(26);
      fcTL.set(u32(sequence++), 0);
      fcTL.set(u32(frame.width), 4);
      fcTL.set(u32(frame.height), 8);
      fcTL.set(u16(Math.min(0xffff, Math.max(1, Math.round(frame.delayMs)))), 20);
      fcTL.set(u16(1000), 22);
      parts.push(chunk('fcTL', fcTL));

      const data = imageData(frame.pixels, frame.width, frame.height);
      if (index++ === 0) {
        parts.push(chunk('IDAT', data));
      } else {
        const fdAT = new Uint8Array(4 + data.length);
        fdAT.set(u32(sequence++), 0);
        fdAT.set(data, 4);
        parts.push(chunk('fdAT', fdAT));
      }
    },
    finish() {
      parts.push(chunk('IEND', new Uint8Array(0)));
      return concat(parts);
    },
  };
}

export function encodeApng(frames: readonly ApngFrame[], options: { loopCount?: number } = {}): Uint8Array {
  if (frames.length === 0) throw new Error('encodeApng: no frames');
  for (const frame of frames) {
    if (frame.width !== frames[0]!.width || frame.height !== frames[0]!.height) throw new Error('encodeApng: every frame must share dimensions');
  }
  const writer = beginApng(frames[0]!.width, frames[0]!.height, frames.length, options.loopCount ?? 0);
  for (const frame of frames) writer.frame(frame);
  return writer.finish();
}

/** Lazy encode: frames are pulled one at a time, so only about one frame of RGBA is live. */
export async function encodeApngLazy(
  frames: AsyncIterable<ApngFrame>,
  options: { width: number; height: number; frameCount: number; loopCount?: number },
): Promise<Uint8Array> {
  if (options.frameCount === 0) throw new Error('encodeApng: no frames');
  const writer = beginApng(options.width, options.height, options.frameCount, options.loopCount ?? 0);
  for await (const frame of frames) writer.frame(frame);
  return writer.finish();
}
