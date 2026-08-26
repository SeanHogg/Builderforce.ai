/**
 * `scene` — the shape a `scene` canvas object carries: a client-side AI video/3D
 * generation request, bound to the studio engine, and the clip it produced.
 *
 * ── WHY THIS EXISTS, AND WHY IT IS NOT `video` ───────────────────────────────────
 * `video.ts`'s `CanvasVideoTimeline`/`CanvasVideoSource` are the REAL timeline editor
 * for imported, screen-recorded and camera clips — tracks × seconds, trims, captions.
 * `scene` is the opposite shape: one prompt, one model, one generation call, and (once
 * it has run) one produced clip. It opens into the `scene3d` surface rather than
 * `timeline` — see `creationObjectSurfaces.ts` — because the product's AI video/3D
 * generation capability lives under the 3D surface, deliberately, rather than under the
 * timeline editor that already has a different, unrelated job.
 *
 * `modelId` is typed as a plain `string` rather than importing studio's
 * `DiffusionModelId`: this package is consumed by both the web frontend and the VSIX,
 * neither of which should take a build dependency on the studio engine merely to know
 * which kind of object a `scene` is. The value corresponds 1:1 to studio's
 * `DiffusionModelId` — the canvas's own `CanvasSceneGeneratorPanel` is what actually
 * imports studio and narrows the string when it calls `VideoEngine.create()`.
 *
 * `mambaState` is opaque (`unknown`) for the same reason: studio's
 * `MambaStateSnapshot` is a JSON-portable bag of numbers, and round-tripping it through
 * this object is exactly what `output` already models for the clip itself — the
 * contract does not need to understand either shape, only carry it.
 *
 * `output` reuses `CanvasVideoSource` (from `video.ts`) verbatim rather than inventing
 * a second "generated file" shape — a scene's produced clip is stored exactly the way
 * every other canvas object's media is: uploaded through `storeCanvasMedia` into the
 * tenant's own R2, referenced by url/storageKey. Two storage conventions for one fact
 * (where does the binary live) is the drift `video.ts`'s own `CanvasVideoSource` exists
 * to prevent for the timeline; this reuses it rather than repeating the argument.
 */

import type { CanvasVideoSource } from './video';
import { canvasVideoSourcesFrom } from './video';

export const CANVAS_SCENE_SPEC_VERSION = 1;

/** Generation parameters — mirrors studio's `GenerateOptions` shape loosely (the
 *  fields a `scene` object persists so a saved generation can be reproduced or
 *  continued), without importing studio's own type into this package. */
export interface CanvasSceneGenerationParams {
  frames: number;
  fps: number;
  steps?: number;
  guidance?: number;
  negativePrompt?: string;
  seed?: number;
}

export function defaultCanvasSceneGenerationParams(): CanvasSceneGenerationParams {
  return { frames: 16, fps: 8 };
}

export interface CanvasSceneSpec {
  version: typeof CANVAS_SCENE_SPEC_VERSION;
  /** Corresponds to studio's `DiffusionModelId` — kept as a plain string here so this
   *  contract package does not take a dependency on the studio engine. Empty string
   *  means "not chosen yet"; the authoring panel seeds a real default. */
  modelId: string;
  prompt: string;
  params: CanvasSceneGenerationParams;
  /** Opaque Mamba-SSM coherence snapshot returned by the last generation, carried
   *  forward so the next generation call can continue the same coherence state rather
   *  than starting cold. Never introspected here — studio owns its shape and its own
   *  JSON-portability guarantee. */
  mambaState?: unknown;
  /** The generated clip, once one exists. Same shape every other canvas object's
   *  stored media uses — see the module header. */
  output?: CanvasVideoSource;
}

export function emptyCanvasSceneSpec(): CanvasSceneSpec {
  return {
    version: CANVAS_SCENE_SPEC_VERSION,
    modelId: '',
    prompt: '',
    params: defaultCanvasSceneGenerationParams(),
  };
}

function finiteOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function paramsFrom(value: unknown): CanvasSceneGenerationParams {
  const fallback = defaultCanvasSceneGenerationParams();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  const raw = value as Record<string, unknown>;
  const frames = typeof raw.frames === 'number' && Number.isFinite(raw.frames) ? Math.max(1, raw.frames) : fallback.frames;
  const fps = typeof raw.fps === 'number' && Number.isFinite(raw.fps) ? Math.max(1, raw.fps) : fallback.fps;
  const steps = finiteOrUndefined(raw.steps);
  const guidance = finiteOrUndefined(raw.guidance);
  const seed = finiteOrUndefined(raw.seed);
  return {
    frames,
    fps,
    ...(steps !== undefined ? { steps } : {}),
    ...(guidance !== undefined ? { guidance } : {}),
    ...(typeof raw.negativePrompt === 'string' ? { negativePrompt: raw.negativePrompt } : {}),
    ...(seed !== undefined ? { seed } : {}),
  };
}

/** Reads old or AI-authored JSON defensively so an invalid patch cannot break the
 *  surface — same rule `canvasVideoTimelineFrom`/`canvasWorldSceneFrom` follow. */
export function canvasSceneSpecFrom(value: unknown): CanvasSceneSpec {
  const fallback = emptyCanvasSceneSpec();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  const raw = value as Record<string, unknown>;
  const [output] = canvasVideoSourcesFrom(raw.output != null ? [raw.output] : []);
  return {
    version: CANVAS_SCENE_SPEC_VERSION,
    modelId: typeof raw.modelId === 'string' ? raw.modelId : fallback.modelId,
    prompt: typeof raw.prompt === 'string' ? raw.prompt : fallback.prompt,
    params: paramsFrom(raw.params),
    ...(raw.mambaState !== undefined ? { mambaState: raw.mambaState } : {}),
    ...(output ? { output } : {}),
  };
}
