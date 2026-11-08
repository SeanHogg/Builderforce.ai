/**
 * Animation export: an {@link AnimationState} to a GIF or APNG blob.
 *
 * Each frame is decoded from its URL (`frameDecode`) and composited over the background onto a
 * canvas to get raw RGBA, which the in-tree encoders turn into bytes. GIF has no
 * alpha in this encoder, so a transparent background is flattened onto white for GIF;
 * APNG keeps it.
 */
import { resolveExportColor } from '../exportColors';
import { decodeFrame } from './frameDecode';
import { encodeApngLazy, type ApngFrame } from './apngEncoder';
import { encodeGifLazy, type GifFrameInput } from './gifEncoder';
import { totalDurationSec, type AnimationState } from './animationState';

export type AnimationExportFormat = 'gif' | 'apng';

export interface AnimationExportFormatSpec {
  format: AnimationExportFormat;
  mimeType: string;
  extension: string;
}

export const ANIMATION_EXPORT_FORMATS: readonly AnimationExportFormatSpec[] = [
  { format: 'gif', mimeType: 'image/gif', extension: 'gif' },
  { format: 'apng', mimeType: 'image/apng', extension: 'png' },
];

export interface AnimationRenderResult {
  blob: Blob;
  durationSec: number;
}

/** Milliseconds a frame is shown for: `hold` ticks at the project fps. */
export function frameDelayMs(fps: number, hold: number): number {
  return Math.max(1, Math.round((1000 / Math.max(1, fps)) * Math.max(1, hold)));
}

/** The same delay in GIF's native 1/100 s (minimum one hundredth). */
export function frameDelayHundredths(fps: number, hold: number): number {
  return Math.max(1, Math.round(frameDelayMs(fps, hold) / 10));
}

/** Largest export, as width * height * frames. Past it the encoder's working set (and the output) is unreasonable. */
export const ANIMATION_EXPORT_MAX_PIXELS = 150_000_000;

/** Thrown when an export would exceed {@link ANIMATION_EXPORT_MAX_PIXELS}; the UI shows a localized message for it. */
export class AnimationOverBudgetError extends Error {
  constructor(readonly pixels: number) {
    super(`animation export: ${pixels} px exceeds the ${ANIMATION_EXPORT_MAX_PIXELS} px budget`);
    this.name = 'AnimationOverBudgetError';
  }
}

export function assertWithinExportBudget(state: Pick<AnimationState, 'width' | 'height' | 'frames'>): void {
  const pixels = state.width * state.height * state.frames.length;
  if (pixels > ANIMATION_EXPORT_MAX_PIXELS) throw new AnimationOverBudgetError(pixels);
}

/** One composited frame of RGBA at a time: the caller pulls, so only about one frame is ever live. */
async function* rasteriseFrames(state: AnimationState, flattenOn: string | null): AsyncGenerator<{ frame: AnimationState['frames'][number]; pixels: Uint8ClampedArray }> {
  const { width, height, background } = state;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('animation export: no 2D context');
  for (const frame of state.frames) {
    ctx.clearRect(0, 0, width, height);
    if (background.kind === 'color') {
      ctx.fillStyle = background.color;
      ctx.fillRect(0, 0, width, height);
    } else if (flattenOn) {
      ctx.fillStyle = flattenOn;
      ctx.fillRect(0, 0, width, height);
    }
    if (frame.pixelsDataUrl) ctx.drawImage(await decodeFrame(frame.pixelsDataUrl), 0, 0, width, height);
    yield { frame, pixels: ctx.getImageData(0, 0, width, height).data };
  }
}

/** `paper` is the export palette's `paper`: a GIF has no real transparency, so a transparent strip is flattened onto it. */
export async function renderAnimation(state: AnimationState, format: AnimationExportFormat, paper: string = resolveExportColor('paper')): Promise<AnimationRenderResult> {
  const spec = ANIMATION_EXPORT_FORMATS.find((entry) => entry.format === format);
  if (!spec) throw new Error(`renderAnimation: unknown format ${format}`);
  assertWithinExportBudget(state);
  const durationSec = totalDurationSec(state);
  const { width, height, frames: stripFrames, fps, loopCount } = state;
  if (format === 'gif') {
    // GIF samples one global palette from every frame, so the strip is rasterised twice (sample, then encode).
    const source = async function* (): AsyncGenerator<GifFrameInput> {
      for await (const { frame, pixels } of rasteriseFrames(state, paper)) {
        yield { pixels, width, height, delayHundredths: frameDelayHundredths(fps, frame.hold) };
      }
    };
    const bytes = await encodeGifLazy(source, { width, height, loopCount, frameCount: stripFrames.length });
    return { blob: new Blob([bytes as BlobPart], { type: spec.mimeType }), durationSec };
  }
  const source = async function* (): AsyncGenerator<ApngFrame> {
    for await (const { frame, pixels } of rasteriseFrames(state, null)) {
      yield { pixels, width, height, delayMs: frameDelayMs(fps, frame.hold) };
    }
  };
  const bytes = await encodeApngLazy(source(), { width, height, loopCount, frameCount: stripFrames.length });
  return { blob: new Blob([bytes as BlobPart], { type: spec.mimeType }), durationSec };
}
