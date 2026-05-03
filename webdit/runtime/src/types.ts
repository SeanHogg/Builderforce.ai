/**
 * Runtime-only types. Bundle/manifest types are re-exported from
 * @webdit/shared so the converter and runtime cannot drift.
 */
export * from "@webdit/shared";

/**
 * Minimal in-memory tensor shape used by the pure tensor-ops and scheduler
 * helpers. ort.Tensor is structurally compatible (it has .data and .dims),
 * so anywhere we accept MutableTensor we can also be handed an ort.Tensor.
 */
export interface MutableTensor {
  data: Float32Array;
  dims: readonly number[];
}

export interface VideoGenerateRequest {
  prompt: string;
  negativePrompt?: string;
  frames?: number;
  height?: number;
  width?: number;
  steps?: number;
  guidanceScale?: number;
  seed?: number;
  /** Called after each scheduler step. */
  onProgress?: (step: number, totalSteps: number) => void;
}

export interface VideoGenerateResult {
  /** Decoded RGBA frames (4 bytes per pixel); length === number of frames produced. */
  frames: Uint8ClampedArray[];
  width: number;
  height: number;
  elapsedMs: number;
}
