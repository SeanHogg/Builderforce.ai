/**
 * ONNX Runtime plumbing for the diffusion engines — tensor materialisation,
 * session options per device, the init-time graph-contract check, and the
 * translation of ORT/WebGPU's opaque failures into sentences a user can act on.
 *
 * Model-agnostic: it knows ORT, not UNets. The frame engine
 * (`diffusion-engine.ts`) owns which sessions exist and what they are fed.
 */

import * as ort from 'onnxruntime-web';
import type { ActiveDevice, DiffusionModelId, OrtInputSpec, OrtTensorDtype } from '../types';
import { MODEL_REGISTRY } from './diffusion-models';
import { configureOnnxRuntime } from './onnx-runtime-config';

// Apply shared ONNX runtime config (WASM CDN paths, thread count) once at
// module load. Idempotent — safe to call from multiple modules.
configureOnnxRuntime();

/** A builder produces the raw payload + shape; {@link materializeTensor} wraps it
 *  in a Tensor of the declared dtype. Splitting "compute the value" from "type
 *  the tensor" lets one builder serve every dtype that makes sense for that
 *  input (e.g. `timestep` is float32 in LCM, int64 in SD). */
export interface RawTensor {
  data: Float32Array;
  shape: readonly number[];
}

/** Dtypes the engine can materialize. Exported for the registry contract test. */
export const SUPPORTED_DTYPES: ReadonlySet<OrtTensorDtype> = new Set<OrtTensorDtype>([
  'float32',
  'int32',
  'int64',
]);

/** Wrap a Float32Array payload as an ORT Tensor of the requested dtype.
 *  Single conversion site — every dtype change happens here, no duplication. */
export function materializeTensor(
  dtype: OrtTensorDtype,
  raw: RawTensor,
): ort.Tensor {
  const shape = [...raw.shape];
  if (dtype === 'float32') {
    return new ort.Tensor('float32', raw.data, shape);
  }
  if (dtype === 'int32') {
    const out = new Int32Array(raw.data.length);
    for (let i = 0; i < raw.data.length; i++) out[i] = raw.data[i] | 0;
    return new ort.Tensor('int32', out, shape);
  }
  if (dtype === 'int64') {
    const out = new BigInt64Array(raw.data.length);
    for (let i = 0; i < raw.data.length; i++) out[i] = BigInt(raw.data[i] | 0);
    return new ort.Tensor('int64', out, shape);
  }
  // Exhaustive on OrtTensorDtype — adding a new dtype to the type forces this.
  throw new Error(`Unsupported dtype: ${dtype satisfies never}`);
}

/**
 * ORT sessions in transformers-exported SD models use varying output names
 * (`out_sample`, `sample`, `predicted_noise`). Pick the first Float32 tensor
 * the session emits so we don't fragile-match on a specific key.
 */
export function pickFirstFloat32(result: ort.InferenceSession.OnnxValueMapType): Float32Array | null {
  for (const value of Object.values(result)) {
    const data = (value as ort.Tensor).data;
    if (data instanceof Float32Array) return data;
  }
  return null;
}

/**
 * Pre-flight memory check. Returns null when memory is sufficient (or unknown);
 * returns an error message when the probed memory is below the model's declared
 * minimum. Caller throws if the message is non-null.
 *
 * Why this exists: skipping the check sends the user into a multi-minute model
 * download that ends with the opaque ORT `std::bad_alloc` (ERROR_CODE 6). A
 * pre-flight check fails in milliseconds with an actionable message instead.
 *
 * `approxMemoryMb` of `null` means the device didn't report — we don't refuse
 * in that case (better to attempt and surface a real error than block on
 * unknowns), but a logged warning is the right shape.
 */
export function checkMemoryForModel(
  approxMemoryMb: number | null,
  minVramMb: number,
  modelId: string,
): string | null {
  if (approxMemoryMb === null) return null;
  if (approxMemoryMb >= minVramMb) return null;
  return (
    `Insufficient memory for ${modelId}: device reports ` +
    `~${(approxMemoryMb / 1024).toFixed(1)} GB available, ` +
    `model needs at least ~${(minVramMb / 1024).toFixed(1)} GB. ` +
    `${lighterModelHint(modelId, approxMemoryMb)}`
  );
}

/**
 * Suggest a genuinely lighter model from the registry. A candidate qualifies
 * only if it needs *strictly less* memory than the failing model AND — when the
 * device's available memory is known — would actually fit. This avoids the
 * self-defeating advice the naive "just exclude the failing id" version gave:
 * when sd-turbo (the lightest at 4 GB) OOMs on a 2 GB device, the only other
 * registry entry (lcm-dreamshaper-v7, 6 GB) is heavier and won't fit either, so
 * recommending it just reproduces the failure. Never suggests the failing one.
 *
 * @param availableMb device memory if known, else null (OOM path can't measure
 *   it) — when null we filter on "lighter than failing" alone.
 */
function lighterModelHint(failingModelId: string, availableMb: number | null): string {
  const failing = MODEL_REGISTRY[failingModelId as DiffusionModelId];
  const failingMin = failing?.minVramMb ?? Infinity;
  const alternatives = Object.values(MODEL_REGISTRY)
    .filter((m) => m.id !== failingModelId)
    // Stay within the same generation family: lcm-diffusion and webdit-dit
    // are incompatible pipelines (different weights, different call sites —
    // see VideoEngine.create's refinementModel guard), so recommending one
    // as a "lighter alternative" to the other would be actionable-sounding
    // but wrong advice.
    .filter((m) => failing === undefined || m.engine === failing.engine)
    .filter((m) => m.minVramMb < failingMin)
    .filter((m) => availableMb === null || m.minVramMb <= availableMb)
    .sort((a, b) => a.minVramMb - b.minVramMb)
    .map((m) => m.id);
  if (alternatives.length === 0) {
    return 'No lighter model is available — close other GPU-heavy tabs and retry.';
  }
  return `Try a lighter model (${alternatives.join(', ')}) or close other GPU-heavy tabs.`;
}

/**
 * Translate ORT/WebGPU's opaque errors into actionable diagnostics. Used
 * everywhere ORT can throw — `InferenceSession.create()` AND every `session.run()`.
 * A raw `std::bad_alloc` / `DXGI_ERROR_DEVICE_HUNG` / `Device is lost` becomes
 * a sentence the user can act on, not a stack trace into the WASM runtime.
 */
export function explainOrtError(
  err: unknown,
  label: string,
  modelId: string,
  minVramMb: number,
  availableMemoryMb: number | null = null,
): Error {
  const message = err instanceof Error ? err.message : String(err);
  if (/bad_alloc|out of memory|memory access out of bounds/i.test(message)) {
    return new Error(
      `Out of memory during ${label} for ${modelId} ` +
        `(needs ~${(minVramMb / 1024).toFixed(1)} GB). ` +
        `${lighterModelHint(modelId, availableMemoryMb)} ` +
        `Original error: ${message}`,
    );
  }
  if (/DXGI_ERROR_DEVICE_HUNG|Device.*is lost|GPUDevice.*lost|mapAsync.*lost/i.test(message)) {
    return new Error(
      `GPU device was lost during ${label} for ${modelId} — typically a Windows TDR ` +
        `(driver timeout, ~2 s per kernel). The model is too heavy for this GPU at the current ` +
        `resolution. Try a lower resolution (e.g. 256×256), pick a lighter model, or switch ` +
        `the device target to CPU. Original error: ${message}`,
    );
  }
  if (/InsertedPrecisionFreeCast|SimplifiedLayerNormFusion|graph_utils\.cc/.test(message)) {
    return new Error(
      `${label} ORT session refused to load due to a graph-fusion crash. ` +
        `This usually means graphOptimizationLevel is too aggressive — verify ` +
        `buildOrtSessionOptions still pins 'basic'. Original error: ${message}`,
    );
  }
  return err instanceof Error ? err : new Error(message);
}

/**
 * Build ORT session options for a probed device.
 *
 * `graphOptimizationLevel: 'basic'` is critical — ORT-web's default `'all'`
 * runs extended fusions (SimplifiedLayerNormFusion, ConstantFolding for
 * inserted Casts) that crash on most browser-exported SD / SD-Turbo / LCM
 * text-encoders with errors like:
 *
 *   "Attempting to get index by a name which does not exist:
 *    InsertedPrecisionFreeCast_/text_model/final_layer_norm/Constant_output_0
 *    for node /text_model/encoder/layers.0/layer_norm1/Mul/SimplifiedLayerNormFusion/"
 *
 * `'basic'` skips the entire extended-fusion pass while keeping the cheap
 * constant-folding optimizations that don't touch the layout. Matches what
 * Microsoft's ORT-web SD-Turbo demo and aislamov's diffusers-js demos use.
 */
export function buildOrtSessionOptions(
  device: ActiveDevice,
): ort.InferenceSession.SessionOptions {
  const base: ort.InferenceSession.SessionOptions = {
    graphOptimizationLevel: 'basic',
    // Drop ORT's `[W:` warnings (e.g. "VerifyEachNodeIsAssignedToAnEp: some
    // nodes were not assigned to the preferred EP"). These are informational
    // — every shape-op fallback to CPU logs one per session. With 3 sessions
    // and per-frame reuse, the console becomes unreadable. Severity 3 = error,
    // so real failures still log; warnings are silenced.
    logSeverityLevel: 3,
  };
  if (device === 'webnn') return { ...base, executionProviders: ['webnn', 'wasm'] };
  if (device === 'webgpu') return { ...base, executionProviders: ['webgpu', 'wasm'] };
  return { ...base, executionProviders: ['wasm'] };
}

/** Last path segment — the name an .onnx graph uses to reference its sidecar. */
export function basename(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? path : path.slice(i + 1);
}

/** Init-time drift check: every input the registry declares for `session`
 *  must exist in `session.inputNames`. Throws with a clear, actionable error
 *  if the model and the registry disagree. */
export function assertSessionMatchesSpec(
  sessionLabel: string,
  session: ort.InferenceSession,
  specs: readonly OrtInputSpec[],
): void {
  const declared = specs.map((s) => s.name);
  const actual = session.inputNames;
  const missing = declared.filter((n) => !actual.includes(n));
  if (missing.length > 0) {
    throw new Error(
      `Registry/model mismatch on ${sessionLabel}: declared input(s) [${missing.join(', ')}] ` +
        `are not in the model's inputNames [${actual.join(', ')}]. ` +
        `Update MODEL_REGISTRY in diffusion-models.ts to match the actual export.`,
    );
  }
}
