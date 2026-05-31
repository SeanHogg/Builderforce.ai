/**
 * ScenePlanner — the Director / Storyboard / Character / Shot-Planner layer.
 *
 * Turns ONE high-level user request into a typed `Storyboard` the video engine
 * can execute. The feedback's pipeline:
 *
 *     User Request → Director → Storyboard → Character → Shot Planner → ...
 *
 * is implemented as two structured gateway calls that share the storyboard as
 * their memory bus:
 *
 *   1. directorPass()  — request → { treatment, characters }   (the Director +
 *                        Character Bible: tone/arc/setting + locked character
 *                        appearances for cross-shot consistency).
 *   2. shotPlannerPass()— (treatment + characters) → shots[]    (the Storyboard
 *                        + Shot Planner: each shot's diffusion prompt, camera
 *                        move, action, and frame budget).
 *
 * Both calls use the gateway's `response_format: json_schema` so the model is
 * forced to return parseable structured output (gateway-side retry on schema
 * miss). We DON'T ship a browser LLM — the gateway already runs the failover
 * cascade, same rationale as `llm-bridge.ts`.
 *
 * The reasoning LLM never paints pixels and the diffusion model never sees the
 * raw request — exactly the separation the feedback asked for.
 */

import { BuilderforceClient } from '@seanhogg/builderforce-sdk';
import type {
  CameraMove,
  CharacterBible,
  PlannedShot,
  ScenePlanOptions,
  Storyboard,
} from '../types';

/** Default planner model. A capable instruction-follower; the gateway still
 *  fails over if it's cooled. Override via `ScenePlanOptions.plannerModel`. */
const DEFAULT_PLANNER_MODEL = 'googleai/gemini-2.5-flash';

/** The canonical camera-move vocabulary. Exported so UIs (the storyboard
 *  editor) offer exactly the moves the planner + engine understand. */
export const CAMERA_MOVES: readonly CameraMove[] = [
  'static',
  'pan-left',
  'pan-right',
  'tilt-up',
  'tilt-down',
  'dolly-in',
  'dolly-out',
];

const DIRECTOR_SYSTEM =
  'You are a film director and character designer for an AI video generator. ' +
  'Given a short concept, produce (1) a one-paragraph visual treatment describing tone, ' +
  'setting, lighting and arc, and (2) a character bible: for each distinct character, a ' +
  'LOCKED visual description (age, build, hair, wardrobe, colour palette) that must stay ' +
  'identical across every shot. Keep each appearance under 200 characters and concrete ' +
  '(a diffusion model reads it verbatim). Output only JSON matching the schema.';

const SHOT_PLANNER_SYSTEM =
  'You are a storyboard and shot planner for an AI video generator. Given a treatment and ' +
  'character bible, break the scene into a sequence of shots. For each shot write a single ' +
  'detailed diffusion prompt (subject, environment, lighting, palette, camera angle, visual ' +
  'style) WITHOUT restating character appearance — reference characters by id in characterIds ' +
  'and the engine appends their locked description. Pick one camera move per shot from the ' +
  'allowed list. Size each shot\'s frame budget so the totals sum to the requested total. ' +
  'Output only JSON matching the schema.';

const DIRECTOR_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['treatment', 'characters'],
  properties: {
    treatment: { type: 'string' },
    characters: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'name', 'appearance'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          appearance: { type: 'string' },
        },
      },
    },
  },
} as const;

const SHOT_PLANNER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['shots'],
  properties: {
    shots: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'prompt', 'characterIds', 'camera', 'action', 'durationFrames'],
        properties: {
          id: { type: 'string' },
          prompt: { type: 'string' },
          characterIds: { type: 'array', items: { type: 'string' } },
          camera: { type: 'string', enum: [...CAMERA_MOVES] },
          action: { type: 'string' },
          durationFrames: { type: 'integer', minimum: 1 },
        },
      },
    },
  },
} as const;

/** Parsed shape of the director call (pre-validation). */
interface DirectorOut {
  treatment: string;
  characters: CharacterBible[];
}
interface ShotPlannerOut {
  shots: PlannedShot[];
}

/**
 * Run the full two-pass planning pipeline. Returns a `Storyboard` whose shot
 * `durationFrames` are normalised to sum EXACTLY to `opts.totalFrames` (the LLM
 * is asked to hit the total but rarely lands on it precisely; the engine needs
 * an exact budget). Inject `client` in tests; production constructs its own.
 */
export async function planScene(
  opts: ScenePlanOptions,
  client?: BuilderforceClient,
): Promise<Storyboard> {
  const c = client ?? new BuilderforceClient({ apiKey: opts.apiKey, baseUrl: opts.baseUrl });
  const model = opts.plannerModel ?? DEFAULT_PLANNER_MODEL;

  const director = await directorPass(c, model, opts);
  const planner = await shotPlannerPass(c, model, opts, director);

  const shots = normaliseShotBudget(
    sanitiseShots(planner.shots, director.characters),
    opts.totalFrames,
  );

  return {
    treatment: director.treatment,
    characters: director.characters,
    shots,
  };
}

/** Director + Character Bible pass. */
export async function directorPass(
  client: BuilderforceClient,
  model: string,
  opts: ScenePlanOptions,
): Promise<DirectorOut> {
  const parsed = await structuredCall<DirectorOut>(client, {
    model,
    system: DIRECTOR_SYSTEM,
    user: `Concept: ${opts.request}\nTarget length: ${opts.totalFrames} frames.`,
    schemaName: 'director',
    schema: DIRECTOR_SCHEMA,
    signal: opts.signal,
  });
  return {
    treatment: typeof parsed?.treatment === 'string' ? parsed.treatment : opts.request,
    characters: Array.isArray(parsed?.characters) ? parsed.characters : [],
  };
}

/** Storyboard + Shot Planner pass. */
export async function shotPlannerPass(
  client: BuilderforceClient,
  model: string,
  opts: ScenePlanOptions,
  director: DirectorOut,
): Promise<ShotPlannerOut> {
  const characterList = director.characters
    .map((ch) => `${ch.id} (${ch.name}): ${ch.appearance}`)
    .join('\n');
  const parsed = await structuredCall<ShotPlannerOut>(client, {
    model,
    system: SHOT_PLANNER_SYSTEM,
    user:
      `Treatment: ${director.treatment}\n\nCharacters:\n${characterList || '(none)'}\n\n` +
      `Allowed camera moves: ${CAMERA_MOVES.join(', ')}\n` +
      `Distribute exactly ${opts.totalFrames} frames across the shots.`,
    schemaName: 'shot_planner',
    schema: SHOT_PLANNER_SCHEMA,
    signal: opts.signal,
  });
  return { shots: Array.isArray(parsed?.shots) ? parsed.shots : [] };
}

/**
 * Map a planned camera move to the engine's motion knobs. Camera motion in the
 * engine is a latent-space pan/tilt/zoom fed into img2img recursion, so a move
 * implies BOTH a transform AND a non-zero img2img strength (otherwise the
 * transform has no recursion path to ride on). `static` → no motion.
 *
 * dx/dy are in latent pixels (1 = 8 output px). `zoom` is a per-keyframe scale
 * factor applied about the frame centre: >1 pushes in (dolly-in), <1 pulls out
 * (dolly-out). 1.04 ≈ a 4 %/keyframe push, gentle enough that img2img can keep
 * the scene coherent while still reading as a dolly.
 */
export function cameraMoveToMotion(
  move: CameraMove,
): { cameraMotion?: { dx: number; dy: number; zoom?: number }; imgToImgStrength: number } {
  switch (move) {
    case 'pan-left':
      return { cameraMotion: { dx: -1, dy: 0 }, imgToImgStrength: 0.6 };
    case 'pan-right':
      return { cameraMotion: { dx: 1, dy: 0 }, imgToImgStrength: 0.6 };
    case 'tilt-up':
      return { cameraMotion: { dx: 0, dy: -1 }, imgToImgStrength: 0.6 };
    case 'tilt-down':
      return { cameraMotion: { dx: 0, dy: 1 }, imgToImgStrength: 0.6 };
    case 'dolly-in':
      return { cameraMotion: { dx: 0, dy: 0, zoom: 1.04 }, imgToImgStrength: 0.55 };
    case 'dolly-out':
      return { cameraMotion: { dx: 0, dy: 0, zoom: 1 / 1.04 }, imgToImgStrength: 0.55 };
    case 'static':
    default:
      return { imgToImgStrength: 0 };
  }
}

/**
 * Compose the final diffusion prompt for a shot: the shot prompt plus the
 * locked appearance of every referenced character. Single source of truth for
 * "what text the diffusion model actually sees" so consistency can't drift
 * between the validator and the generator.
 */
export function composeShotPrompt(shot: PlannedShot, characters: CharacterBible[]): string {
  const byId = new Map(characters.map((ch) => [ch.id, ch]));
  const appearances = shot.characterIds
    .map((id) => byId.get(id))
    .filter((ch): ch is CharacterBible => Boolean(ch))
    .map((ch) => `${ch.name}: ${ch.appearance}`);
  if (appearances.length === 0) return shot.prompt;
  return `${shot.prompt}. ${appearances.join('. ')}`;
}

// ───────────────────────────────────────────────────────────────────────────
// Internals
// ───────────────────────────────────────────────────────────────────────────

/** Drop malformed shots and clamp the camera enum so a hallucinated move can't
 *  reach the engine. Keeps only shots with a non-empty prompt. */
function sanitiseShots(shots: PlannedShot[], characters: CharacterBible[]): PlannedShot[] {
  const validIds = new Set(characters.map((c) => c.id));
  return shots
    .filter((s) => s && typeof s.prompt === 'string' && s.prompt.trim().length > 0)
    .map((s, i) => ({
      id: typeof s.id === 'string' && s.id ? s.id : `shot-${i + 1}`,
      prompt: s.prompt.trim(),
      characterIds: Array.isArray(s.characterIds)
        ? s.characterIds.filter((id) => validIds.has(id))
        : [],
      camera: CAMERA_MOVES.includes(s.camera) ? s.camera : 'static',
      action: typeof s.action === 'string' ? s.action : '',
      durationFrames:
        Number.isFinite(s.durationFrames) && s.durationFrames > 0
          ? Math.floor(s.durationFrames)
          : 1,
    }));
}

/**
 * Force the shot frame budgets to sum to exactly `total`. The LLM's per-shot
 * counts are treated as PROPORTIONS; we rescale them and fix rounding drift on
 * the last shot so the engine gets a precise, non-zero budget per shot.
 *
 * Falls back to a single synthetic shot if the planner returned none — the
 * caller always gets an executable storyboard.
 */
export function normaliseShotBudget(shots: PlannedShot[], total: number): PlannedShot[] {
  const target = Math.max(1, Math.floor(total));
  if (shots.length === 0) {
    return [
      {
        id: 'shot-1',
        prompt: '',
        characterIds: [],
        camera: 'static',
        action: '',
        durationFrames: target,
      },
    ];
  }
  const sum = shots.reduce((acc, s) => acc + s.durationFrames, 0) || shots.length;
  let allocated = 0;
  const out = shots.map((s, i) => {
    const frames =
      i === shots.length - 1
        ? Math.max(1, target - allocated) // last shot absorbs rounding drift
        : Math.max(1, Math.round((s.durationFrames / sum) * target));
    allocated += frames;
    return { ...s, durationFrames: frames };
  });
  return out;
}

interface StructuredCallArgs {
  model: string;
  system: string;
  user: string;
  schemaName: string;
  schema: Record<string, unknown>;
  signal?: AbortSignal;
}

/** One structured gateway call returning parsed JSON, or null on any failure
 *  (empty body / non-JSON / abort handled by the caller's fallbacks). */
async function structuredCall<T>(
  client: BuilderforceClient,
  args: StructuredCallArgs,
): Promise<T | null> {
  const completion = await client.chat.completions.create({
    model: args.model,
    messages: [
      { role: 'system', content: args.system },
      { role: 'user', content: args.user },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: args.schemaName, schema: args.schema, strict: true },
    },
    temperature: 0.7,
    max_tokens: 1500,
    signal: args.signal,
  });
  const text = completion.choices?.[0]?.message?.content;
  if (!text || typeof text !== 'string') return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    // Some models wrap JSON in prose despite json_schema — salvage the object.
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1)) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}
