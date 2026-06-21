/**
 * WebCodecsMuxer — encode an array of frame pixel buffers to an MP4 Blob.
 *
 * Uses the browser's WebCodecs VideoEncoder API + mp4-muxer for container
 * generation. No native dependencies, no FFmpeg-WASM bundle.
 *
 * The AVC profile is selected at runtime via `VideoEncoder.isConfigSupported`
 * (see `selectVideoCodec`) instead of hardcoding one profile string, because
 * Safari's WebCodecs builds reject specific profile/dimension combinations. When
 * no AVC profile is supported the muxer throws an explicit, actionable error
 * rather than an opaque `configure()` failure. (A WebM/VP9 container fallback for
 * Firefox would need an extra `webm-muxer` dependency and is tracked separately.)
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

/**
 * AVC profile codec strings to try, most-compatible first. Safari has
 * historically rejected a hardcoded `avc1.42E01F` (Constrained Baseline L3.1)
 * for arbitrary dimensions, so we probe each via `VideoEncoder.isConfigSupported`
 * and pick the first the browser actually accepts instead of blindly configuring
 * one and dying at `configure()`.
 *
 *   avc1.42001f — Baseline L3.1      (widest decode support)
 *   avc1.42E01E — Constrained Base L3
 *   avc1.4D401F — Main L3.1
 *   avc1.640028 — High L4.0          (last resort, best quality)
 */
export const AVC_CODEC_CANDIDATES = [
  'avc1.42001f',
  'avc1.42E01E',
  'avc1.4D401F',
  'avc1.640028',
] as const;

/** Minimal structural type for the VideoEncoder support probe so the selector is
 *  unit-testable without a real WebCodecs runtime. */
export interface VideoEncoderConfigProbe {
  isConfigSupported(config: {
    codec: string;
    width: number;
    height: number;
    bitrate?: number;
    framerate?: number;
  }): Promise<{ supported?: boolean }>;
}

/**
 * Resolve the first AVC codec string the browser can actually encode at these
 * dimensions, probing `isConfigSupported` in compatibility order. Returns null
 * when none are supported (e.g. Safari builds without an MP4/AVC encode path),
 * which the caller turns into an honest, actionable error rather than an opaque
 * `configure()` throw. Exported + dependency-injected so it can be tested
 * headlessly with a fake probe.
 */
export async function selectVideoCodec(
  opts: { width: number; height: number; bitrate?: number; fps: number },
  probe?: VideoEncoderConfigProbe,
): Promise<string | null> {
  const probeImpl =
    probe ??
    (typeof VideoEncoder !== 'undefined' &&
    typeof (VideoEncoder as unknown as VideoEncoderConfigProbe).isConfigSupported === 'function'
      ? (VideoEncoder as unknown as VideoEncoderConfigProbe)
      : undefined);

  // No probe available (older WebCodecs without isConfigSupported): fall back to
  // the historical default and let configure() surface any real incompatibility.
  if (!probeImpl) return AVC_CODEC_CANDIDATES[0];

  for (const codec of AVC_CODEC_CANDIDATES) {
    try {
      const res = await probeImpl.isConfigSupported({
        codec,
        width: opts.width,
        height: opts.height,
        bitrate: opts.bitrate ?? 2_000_000,
        framerate: opts.fps,
      });
      if (res?.supported) return codec;
    } catch {
      // A probe that throws (rather than reporting unsupported) just means this
      // candidate is unusable — try the next one.
    }
  }
  return null;
}

export async function muxFramesToMp4(frames: MuxFrame[], opts: MuxOptions): Promise<Blob> {
  if (typeof VideoEncoder === 'undefined') {
    throw new Error('WebCodecs VideoEncoder is not available in this browser');
  }

  // Probe for a supported AVC profile instead of hardcoding avc1.42E01F (which
  // Safari rejects for many dimension/profile combinations). A null result means
  // this browser has no usable MP4/AVC encode path — surface that explicitly.
  const codec = await selectVideoCodec(opts);
  if (codec === null) {
    throw new Error(
      'This browser has no supported MP4 (H.264/AVC) encode configuration. ' +
        'MP4 export currently requires a WebCodecs AVC encoder (Chrome 113+, Edge). ' +
        'Use a Chromium-based browser to export video.',
    );
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
    codec,
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
