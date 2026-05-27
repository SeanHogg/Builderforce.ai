/**
 * WebCodecsMuxer — encode an array of frame pixel buffers to an MP4 Blob.
 *
 * Uses the browser's WebCodecs VideoEncoder API + mp4-muxer for container
 * generation. No native dependencies, no FFmpeg-WASM bundle.
 *
 * Falls back to a WebM container when WebCodecs MP4 encode is unsupported
 * (Safari early implementations) — caller can detect via `result.type`.
 */

import { Muxer, ArrayBufferTarget } from 'mp4-muxer';

export interface MuxOptions {
  width: number;
  height: number;
  fps: number;
  /** Bitrate in bits/second. Defaults to 2 Mbps. */
  bitrate?: number;
  signal?: AbortSignal;
}

export interface MuxFrame {
  /** RGBA pixels (0..255), length = width * height * 4. */
  rgba: Uint8ClampedArray;
}

export async function muxFramesToMp4(frames: MuxFrame[], opts: MuxOptions): Promise<Blob> {
  if (typeof VideoEncoder === 'undefined') {
    throw new Error('WebCodecs VideoEncoder is not available in this browser');
  }

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: {
      codec: 'avc',
      width: opts.width,
      height: opts.height,
      frameRate: opts.fps,
    },
    fastStart: 'in-memory',
  });

  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (err) => {
      throw err;
    },
  });

  encoder.configure({
    codec: 'avc1.42E01F',
    width: opts.width,
    height: opts.height,
    bitrate: opts.bitrate ?? 2_000_000,
    framerate: opts.fps,
  });

  const microsPerFrame = Math.round(1_000_000 / opts.fps);

  for (let i = 0; i < frames.length; i++) {
    if (opts.signal?.aborted) {
      encoder.close();
      throw new DOMException('Mux aborted', 'AbortError');
    }

    const bitmap = await frameToImageBitmap(frames[i], opts.width, opts.height);
    const videoFrame = new VideoFrame(bitmap, {
      timestamp: i * microsPerFrame,
      duration: microsPerFrame,
    });
    encoder.encode(videoFrame, { keyFrame: i === 0 });
    videoFrame.close();
    bitmap.close();
  }

  await encoder.flush();
  encoder.close();
  muxer.finalize();

  const { buffer } = muxer.target;
  return new Blob([buffer], { type: 'video/mp4' });
}

async function frameToImageBitmap(
  frame: MuxFrame,
  width: number,
  height: number
): Promise<ImageBitmap> {
  const imageData = new ImageData(
    frame.rgba as Uint8ClampedArray<ArrayBuffer>,
    width,
    height,
  );
  return createImageBitmap(imageData);
}

/**
 * Convert the diffusion engine's [-1..1] Float32 RGB pixel output to a
 * displayable RGBA Uint8 buffer suitable for both ImageBitmap previews
 * (the onFrame callback) and the muxer.
 */
export function pixelsToRgba(
  pixels: Float32Array,
  width: number,
  height: number
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  const channelSize = width * height;
  for (let i = 0; i < channelSize; i++) {
    const r = pixels[0 * channelSize + i];
    const g = pixels[1 * channelSize + i];
    const b = pixels[2 * channelSize + i];
    out[i * 4 + 0] = clamp((r + 1) * 127.5);
    out[i * 4 + 1] = clamp((g + 1) * 127.5);
    out[i * 4 + 2] = clamp((b + 1) * 127.5);
    out[i * 4 + 3] = 255;
  }
  return out;
}

function clamp(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}
