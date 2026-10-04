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

import type { CanvasVideoSource, CanvasVideoTimeline } from './video';
import { canvasVideoSourcesFrom, emptyCanvasVideoTimeline } from './video';

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

/**
 * WHERE a scene's video is made.
 *   - `cloud`  — hosted video models through the gateway (`/llm/v1/videos`):
 *                real motion, any device, billed in video seconds.
 *   - `device` — the studio engine in this browser (WebGPU): free and private,
 *                lower fidelity, needs a capable GPU.
 * An absent value reads as `device`, which is what every scene saved before the
 * cloud engine existed was made with.
 */
export const CANVAS_SCENE_ENGINES = ['cloud', 'device'] as const;
export type CanvasSceneEngine = (typeof CANVAS_SCENE_ENGINES)[number];

export const CANVAS_SCENE_ASPECTS = ['16:9', '9:16', '1:1'] as const;
export type CanvasSceneAspect = (typeof CANVAS_SCENE_ASPECTS)[number];

export const CANVAS_SCENE_SHOT_STATUSES = ['pending', 'rendering', 'done', 'failed'] as const;
export type CanvasSceneShotStatus = (typeof CANVAS_SCENE_SHOT_STATUSES)[number];

/**
 * One shot of a planned scene, and its render state. `prompt` is the shot's
 * FULL generation prompt — the planner's shot prompt with every present
 * character's appearance appended — so each clip is rendered from the same
 * character descriptions and the cast stays recognisable across shots.
 */
export interface CanvasSceneShot {
  id: string;
  /** What happens in the shot — its label on the board and on the timeline. */
  action: string;
  prompt: string;
  camera: string;
  durationSeconds: number;
  status: CanvasSceneShotStatus;
  /** The media job rendering it, while it renders. */
  jobId?: string;
  output?: CanvasVideoSource;
  error?: string;
}

export interface CanvasSceneSpec {
  version: typeof CANVAS_SCENE_SPEC_VERSION;
  /** Absent → `device` (see {@link CanvasSceneEngine}). */
  engine?: CanvasSceneEngine;
  /** Frame shape for cloud clips and the movie built from them. */
  aspectRatio?: CanvasSceneAspect;
  /** Opaque studio `Storyboard` (treatment, character bible, planned shots) —
   *  carried, never introspected here, exactly like `mambaState`. */
  storyboard?: unknown;
  /** The storyboard's shots and their per-shot clips. */
  shots?: CanvasSceneShot[];
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
    engine: 'cloud',
    aspectRatio: '16:9',
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

function oneOf<T extends string>(values: readonly T[], value: unknown): T | undefined {
  return typeof value === 'string' && (values as readonly string[]).includes(value) ? value as T : undefined;
}

function shotsFrom(value: unknown): CanvasSceneShot[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((entry, index): CanvasSceneShot[] => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const raw = entry as Record<string, unknown>;
    if (typeof raw.prompt !== 'string' || !raw.prompt.trim()) return [];
    const [output] = canvasVideoSourcesFrom(raw.output != null ? [raw.output] : []);
    const duration = finiteOrUndefined(raw.durationSeconds);
    return [{
      id: typeof raw.id === 'string' && raw.id ? raw.id : `shot-${index + 1}`,
      action: typeof raw.action === 'string' ? raw.action : '',
      prompt: raw.prompt,
      camera: typeof raw.camera === 'string' ? raw.camera : 'static',
      durationSeconds: duration !== undefined ? Math.min(15, Math.max(1, duration)) : 5,
      status: oneOf(CANVAS_SCENE_SHOT_STATUSES, raw.status) ?? (output ? 'done' : 'pending'),
      ...(typeof raw.jobId === 'string' ? { jobId: raw.jobId } : {}),
      ...(output ? { output } : {}),
      ...(typeof raw.error === 'string' ? { error: raw.error } : {}),
    }];
  });
}

/** Reads old or AI-authored JSON defensively so an invalid patch cannot break the
 *  surface — same rule `canvasVideoTimelineFrom`/`canvasWorldSceneFrom` follow. */
export function canvasSceneSpecFrom(value: unknown): CanvasSceneSpec {
  const fallback = emptyCanvasSceneSpec();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  const raw = value as Record<string, unknown>;
  const [output] = canvasVideoSourcesFrom(raw.output != null ? [raw.output] : []);
  const engine = oneOf(CANVAS_SCENE_ENGINES, raw.engine);
  const aspectRatio = oneOf(CANVAS_SCENE_ASPECTS, raw.aspectRatio);
  const shots = shotsFrom(raw.shots);
  return {
    version: CANVAS_SCENE_SPEC_VERSION,
    ...(engine ? { engine } : {}),
    ...(aspectRatio ? { aspectRatio } : {}),
    ...(raw.storyboard !== undefined ? { storyboard: raw.storyboard } : {}),
    ...(shots ? { shots } : {}),
    modelId: typeof raw.modelId === 'string' ? raw.modelId : fallback.modelId,
    prompt: typeof raw.prompt === 'string' ? raw.prompt : fallback.prompt,
    params: paramsFrom(raw.params),
    ...(raw.mambaState !== undefined ? { mambaState: raw.mambaState } : {}),
    ...(output ? { output } : {}),
  };
}

/** The engine a scene renders with — absent means `device` (see {@link CanvasSceneEngine}). */
export function canvasSceneEngine(spec: Pick<CanvasSceneSpec, 'engine'>): CanvasSceneEngine {
  return spec.engine ?? 'device';
}

/** Output frame size for an aspect ratio — the movie timeline's canvas. */
export function canvasSceneFrameSize(aspect: CanvasSceneAspect | undefined): { width: number; height: number } {
  if (aspect === '9:16') return { width: 1080, height: 1920 };
  if (aspect === '1:1') return { width: 1080, height: 1080 };
  return { width: 1920, height: 1080 };
}

/** Shots that still need a clip: never rendered, or failed. */
export function canvasSceneShotsToRender(spec: Pick<CanvasSceneSpec, 'shots'>): CanvasSceneShot[] {
  return (spec.shots ?? []).filter((shot) => !shot.output && shot.status !== 'rendering');
}

/**
 * The MOVIE a scene makes: every rendered shot, in storyboard order, laid end to
 * end on a `video` timeline's visual track and labelled with what happens in it.
 * The result is an ordinary editable timeline: music, voiceover, captions and
 * trims are added in the video editor like on any other. A scene with no shots
 * but one generated clip becomes a one-clip movie. Null when nothing is rendered.
 */
export function canvasSceneMovie(spec: CanvasSceneSpec): { timeline: CanvasVideoTimeline; sources: CanvasVideoSource[] } | null {
  const rendered = (spec.shots ?? []).filter((shot): shot is CanvasSceneShot & { output: CanvasVideoSource } => Boolean(shot.output));
  const clips = rendered.length > 0
    ? rendered.map((shot) => ({ source: shot.output, label: shot.action || shot.id }))
    : spec.output ? [{ source: spec.output, label: spec.prompt.slice(0, 60) }] : [];
  if (clips.length === 0) return null;
  const { width, height } = canvasSceneFrameSize(spec.aspectRatio);
  let cursor = 0;
  const timeline: CanvasVideoTimeline = {
    ...emptyCanvasVideoTimeline(),
    width,
    height,
    clips: clips.map(({ source, label }, index) => {
      const startSeconds = cursor;
      cursor += source.durationSeconds;
      return {
        id: `scene-clip-${index + 1}`,
        sourceId: source.id,
        track: 'visual' as const,
        startSeconds,
        durationSeconds: source.durationSeconds,
        trimStartSeconds: 0,
        volume: 1,
        label,
      };
    }),
  };
  return { timeline, sources: clips.map(({ source }) => source) };
}
