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
 * rather than an opaque `configure()` failure.
 *
 * Container fallback: AVC/MP4 is probed first; when the browser has no AVC
 * encode path (Firefox), VP9 then VP8 are probed and muxed into WebM with
 * `webm-muxer`. The order and the per-container codec lists live in the
 * `ENCODING_TABLE` data table. The result carries its own mime type and file
 * extension so callers never hard-code ".mp4".
 */

import { Muxer as Mp4Muxer, ArrayBufferTarget as Mp4Target } from 'mp4-muxer';

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
  const probeImpl = resolveProbe(probe);

  // No probe available (older WebCodecs without isConfigSupported): fall back to
  // the historical default and let configure() surface any real incompatibility.
  if (!probeImpl) return AVC_CODEC_CANDIDATES[0];

  return firstSupportedCodec(AVC_CODEC_CANDIDATES, opts, probeImpl);
}

function resolveProbe(probe?: VideoEncoderConfigProbe): VideoEncoderConfigProbe | undefined {
  if (probe) return probe;
  return typeof VideoEncoder !== 'undefined' &&
    typeof (VideoEncoder as unknown as VideoEncoderConfigProbe).isConfigSupported === 'function'
    ? (VideoEncoder as unknown as VideoEncoderConfigProbe)
    : undefined;
}

async function firstSupportedCodec(
  candidates: readonly string[],
  opts: { width: number; height: number; bitrate?: number; fps: number },
  probe: VideoEncoderConfigProbe,
): Promise<string | null> {
  for (const codec of candidates) {
    try {
      const res = await probe.isConfigSupported({
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

/** Output container. */
export type VideoContainer = 'mp4' | 'webm';

/** A muxing backend: how to build the muxer for a chosen codec and read it back. */
export interface ContainerMuxer {
  addVideoChunk(chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata): void;
  finalize(): ArrayBuffer;
}

export interface EncodingRow {
  container: VideoContainer;
  mimeType: string;
  extension: string;
  /** WebCodecs codec strings to probe, most-compatible first. */
  codecs: readonly string[];
  createMuxer(codec: string, opts: MuxOptions): Promise<ContainerMuxer>;
}

/** VP9 profile 0 levels 1.0 / 3.1, then VP8. WebM cannot carry AVC. */
export const VP9_CODEC_CANDIDATES = ['vp09.00.10.08', 'vp09.00.31.08'] as const;
export const VP8_CODEC_CANDIDATES = ['vp8'] as const;

/**
 * Container/codec preference table, probed in order: the first row with a
 * supported codec wins. MP4/AVC first (widest playback), then WebM/VP9, then
 * WebM/VP8. Adding a codec or container is a new row, not new control flow.
 */
export const ENCODING_TABLE: readonly EncodingRow[] = [
  {
    container: 'mp4',
    mimeType: 'video/mp4',
    extension: 'mp4',
    codecs: AVC_CODEC_CANDIDATES,
    async createMuxer(_codec, opts) {
      const muxer = new Mp4Muxer({
        target: new Mp4Target(),
        video: { codec: 'avc', width: opts.width, height: opts.height, frameRate: opts.fps },
        fastStart: 'in-memory',
      });
      return {
        addVideoChunk: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
        finalize: () => {
          muxer.finalize();
          return muxer.target.buffer;
        },
      };
    },
  },
  {
    container: 'webm',
    mimeType: 'video/webm',
    extension: 'webm',
    codecs: VP9_CODEC_CANDIDATES,
    createMuxer: (_codec, opts) => createWebmMuxer('V_VP9', opts),
  },
  {
    container: 'webm',
    mimeType: 'video/webm',
    extension: 'webm',
    codecs: VP8_CODEC_CANDIDATES,
    createMuxer: (_codec, opts) => createWebmMuxer('V_VP8', opts),
  },
];

async function createWebmMuxer(codec: 'V_VP9' | 'V_VP8', opts: MuxOptions): Promise<ContainerMuxer> {
  // Lazy: only Firefox-class browsers ever reach this, so keep it a code-split.
  const { Muxer, ArrayBufferTarget } = await import('webm-muxer');
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec, width: opts.width, height: opts.height, frameRate: opts.fps },
  });
  return {
    addVideoChunk: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    finalize: () => {
      muxer.finalize();
      return muxer.target.buffer;
    },
  };
}

export interface SelectedEncoding {
  row: EncodingRow;
  codec: string;
}

/**
 * Pick the first (container, codec) the browser can encode, walking
 * `ENCODING_TABLE`. Returns null when nothing is supported. With no probe
 * available it assumes the historical MP4/AVC default.
 */
export async function selectVideoEncoding(
  opts: { width: number; height: number; bitrate?: number; fps: number },
  probe?: VideoEncoderConfigProbe,
  table: readonly EncodingRow[] = ENCODING_TABLE,
): Promise<SelectedEncoding | null> {
  const probeImpl = resolveProbe(probe);
  if (!probeImpl) return { row: table[0], codec: table[0].codecs[0] };

  for (const row of table) {
    const codec = await firstSupportedCodec(row.codecs, opts, probeImpl);
    if (codec !== null) return { row, codec };
  }
  return null;
}

/** Thrown when the browser can encode neither AVC/MP4 nor VP9/VP8 WebM. */
export class UnsupportedVideoEncodingError extends Error {
  constructor() {
    super(
      'This browser has no supported video encode configuration (tried H.264/MP4, VP9/WebM and VP8/WebM). ' +
        'Use a current Chrome, Edge, Safari or Firefox to export video.',
    );
    this.name = 'UnsupportedVideoEncodingError';
  }
}

export interface MuxedVideo {
  blob: Blob;
  /** `video/mp4` or `video/webm` — also set as `blob.type`. */
  mimeType: string;
  /** File extension without the dot: `mp4` or `webm`. */
  extension: string;
}

/** File extension for a video mime type produced by this muxer (defaults to mp4). */
export function videoExtensionForMime(mimeType: string): string {
  return ENCODING_TABLE.find((r) => r.mimeType === mimeType.split(';')[0].trim())?.extension ?? 'mp4';
}

export async function muxFramesToVideo(frames: MuxFrame[], opts: MuxOptions): Promise<MuxedVideo> {
  if (typeof VideoEncoder === 'undefined') {
    throw new Error('WebCodecs VideoEncoder is not available in this browser');
  }

  const selected = await selectVideoEncoding(opts);
  if (selected === null) throw new UnsupportedVideoEncodingError();
  const { row, codec } = selected;

  const muxer = await row.createMuxer(codec, opts);

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

  const buffer = muxer.finalize();
  return {
    blob: new Blob([buffer], { type: row.mimeType }),
    mimeType: row.mimeType,
    extension: row.extension,
  };
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
