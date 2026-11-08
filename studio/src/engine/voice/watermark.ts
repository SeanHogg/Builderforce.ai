/**
 * Mark a freshly synthesized clip. The watermark itself (embed/detect) is the
 * shared `@builderforce/voice-provenance` module — bundled into this package at
 * build time — so the studio engine, the api and the web client agree on exactly
 * what is embedded. This file is only the engine's policy for using it.
 */

import { embedWatermark, newWatermarkId } from '@builderforce/voice-provenance';

export interface MarkedPcm {
  pcm: Float32Array;
  /** The embedded 64-bit id, or null when the clip was too short/quiet to carry one. */
  watermarkId: string | null;
}

/** Embed a fresh id, or return the clip untouched with `watermarkId: null` —
 *  never an unmarked clip that claims an id. */
export function markSynthesizedPcm(samples: Float32Array, sampleRate: number): MarkedPcm {
  const watermarkId = newWatermarkId();
  try {
    return { pcm: embedWatermark(samples, sampleRate, watermarkId), watermarkId };
  } catch {
    return { pcm: samples, watermarkId: null };
  }
}
