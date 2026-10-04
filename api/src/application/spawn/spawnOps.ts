/**
 * SPAWN OPERATIONS — the only things a build may do to a player's place.
 *
 * The model never touches Roblox Studio. It answers with a list of operations, and
 * the Spawn Studio plugin applies them inside one undo step. This module is the
 * contract between the two and the gate in front of the plugin: everything a
 * model wrote is read here, and only what survives reaches the player's game.
 *
 * Three operations, because three are enough to build anything Studio holds:
 *
 *   script    — create or replace a Script / LocalScript / ModuleScript's source.
 *   instance  — create or update any allowed instance at a path, with properties.
 *   delete    — remove the instance at a path.
 *
 * ── WHAT THE GATE REFUSES, AND WHY ──────────────────────────────────────────
 * Spawn is for players 13+, building games other children will play. So beyond
 * shape, an op is refused when it could:
 *
 *   · reach off the platform — `HttpService` in a script is how a game leaks a
 *     player's data or phones home, and a plugin-placed script inherits trust the
 *     player never meant to give;
 *   · run code nobody can read — `loadstring`, `getfenv`/`setfenv`, and
 *     `require(<asset id>)` are the three ways a Roblox "backdoor" hides, and none
 *     of them is needed to make a game;
 *   · pull in an unseen asset — an image, sound, mesh or animation id the player
 *     cannot see before it is in their game. The builder makes things from parts,
 *     colours, lights and effects, which a person can see in the viewport.
 *
 * Refusals are per-op, with a reason, so one bad line does not lose a whole build.
 *
 * Pure: values in, values out, no network — so it is tested exhaustively.
 */

/** Where a build may put things. The first segment of every path. */
export const SPAWN_ROOTS = [
  'Workspace',
  'ServerScriptService',
  'ServerStorage',
  'ReplicatedStorage',
  'StarterGui',
  'StarterPack',
  'StarterPlayer',
  'Lighting',
  'SoundService',
  'Teams',
] as const;

export type SpawnScriptKind = 'Script' | 'LocalScript' | 'ModuleScript';

/** Classes an `instance` op may create. Building, UI, effects, values and wiring — no asset loaders. */
export const SPAWN_CLASSES: ReadonlySet<string> = new Set([
  // structure
  'Folder', 'Model', 'Configuration',
  // parts
  'Part', 'WedgePart', 'CornerWedgePart', 'TrussPart', 'SpawnLocation', 'Seat', 'VehicleSeat',
  // physics + attachments
  'Attachment', 'WeldConstraint', 'HingeConstraint', 'PrismaticConstraint', 'SpringConstraint',
  'RopeConstraint', 'RodConstraint', 'BallSocketConstraint', 'AlignPosition', 'AlignOrientation',
  'LinearVelocity', 'AngularVelocity', 'VectorForce', 'Torque',
  // interaction
  'ClickDetector', 'ProximityPrompt', 'Tool', 'Team',
  // light + effects
  'PointLight', 'SpotLight', 'SurfaceLight', 'ParticleEmitter', 'Fire', 'Smoke', 'Sparkles',
  'Trail', 'Beam', 'Highlight', 'Atmosphere', 'BloomEffect', 'ColorCorrectionEffect',
  'SunRaysEffect', 'BlurEffect', 'DepthOfFieldEffect', 'Clouds',
  // UI
  'ScreenGui', 'BillboardGui', 'SurfaceGui', 'Frame', 'ScrollingFrame', 'TextLabel', 'TextButton',
  'TextBox', 'UICorner', 'UIStroke', 'UIGradient', 'UIListLayout', 'UIGridLayout', 'UIPadding',
  'UIScale', 'UIAspectRatioConstraint', 'UISizeConstraint', 'UITextSizeConstraint',
  // values + events
  'RemoteEvent', 'RemoteFunction', 'BindableEvent', 'BindableFunction', 'IntValue', 'NumberValue',
  'StringValue', 'BoolValue', 'ObjectValue', 'Vector3Value', 'Color3Value', 'CFrameValue',
]);

/** Properties that load an asset by id. Refused (see the module note). */
const ASSET_PROPERTIES: ReadonlySet<string> = new Set([
  'Image', 'HoverImage', 'PressedImage', 'SoundId', 'MeshId', 'TextureId', 'TextureID', 'Texture',
  'AnimationId', 'SkyboxBk', 'SkyboxDn', 'SkyboxFt', 'SkyboxLf', 'SkyboxRt', 'SkyboxUp', 'Decal',
]);

/** Script source that opens a door off the platform or hides code. */
const FORBIDDEN_SOURCE: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  { pattern: /HttpService/, reason: 'scripts may not call the internet (HttpService)' },
  { pattern: /\bloadstring\s*\(/, reason: 'scripts may not run hidden code (loadstring)' },
  { pattern: /\b[gs]etfenv\s*\(/, reason: 'scripts may not rewrite their environment (getfenv/setfenv)' },
  { pattern: /\brequire\s*\(\s*\d/, reason: 'scripts may not load code by asset id (require(id))' },
  { pattern: /rbxassetid:\/\/|roblox\.com\/asset/i, reason: 'scripts may not load assets by id' },
];

export const MAX_OPS = 150;
const MAX_SOURCE_CHARS = 40_000;
const MAX_PATH_SEGMENTS = 10;
const MAX_NAME_CHARS = 60;
const MAX_STRING_CHARS = 2_000;
const MAX_PROPERTIES = 40;

/** A property value the plugin knows how to apply. Typed values are one-key objects. */
export type SpawnValue =
  | string
  | number
  | boolean
  | { Vector3: [number, number, number] }
  | { Vector2: [number, number] }
  | { Color3: string }
  | { UDim2: [number, number, number, number] }
  | { UDim: [number, number] }
  | { CFrame: [number, number, number, number, number, number] }
  | { Enum: string }
  | { NumberRange: [number, number] }
  | { ColorSequence: string[] }
  | { NumberSequence: number[] };

export type SpawnOp =
  | { op: 'script'; path: string; kind: SpawnScriptKind; source: string }
  | { op: 'instance'; path: string; className: string; properties: Record<string, SpawnValue> }
  | { op: 'delete'; path: string };

export interface RejectedOp {
  index: number;
  reason: string;
}

export interface ReadOpsResult {
  ops: SpawnOp[];
  rejected: RejectedOp[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const finiteTuple = (v: unknown, n: number): v is number[] => Array.isArray(v) && v.length === n && v.every(finite);

/**
 * A path a build may write: `Root/Child/Grandchild`, starting at an allowed root,
 * every segment a plain name. Returns the canonical form, or a refusal reason.
 */
export function readPath(value: unknown): { path: string } | { reason: string } {
  if (typeof value !== 'string' || !value.trim()) return { reason: 'missing path' };
  const segments = value.split('/').map((s) => s.trim()).filter(Boolean);
  if (segments.length < 2) return { reason: `"${value}" must name something inside a service` };
  if (segments.length > MAX_PATH_SEGMENTS) return { reason: `"${value}" is nested too deeply` };
  if (!(SPAWN_ROOTS as readonly string[]).includes(segments[0]!)) {
    return { reason: `"${segments[0]}" is not a place Spawn builds in` };
  }
  for (const segment of segments) {
    if (segment.length > MAX_NAME_CHARS) return { reason: `"${segment.slice(0, 20)}…" is too long a name` };
    if (/[\u0000-\u001f]/.test(segment)) return { reason: 'names may not contain control characters' };
  }
  return { path: segments.join('/') };
}

/** The first reason a script's source may not run in a player's game, or null. */
export function forbiddenSourceReason(source: string): string | null {
  for (const { pattern, reason } of FORBIDDEN_SOURCE) {
    if (pattern.test(source)) return reason;
  }
  return null;
}

/** One property value, or null when it is not a shape the plugin can apply. */
export function readValue(value: unknown): SpawnValue | null {
  if (typeof value === 'string') return value.length <= MAX_STRING_CHARS ? value : null;
  if (finite(value) || typeof value === 'boolean') return value;
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== 1) return null;
  const key = keys[0]!;
  const inner = value[key];
  switch (key) {
    case 'Vector3': return finiteTuple(inner, 3) ? { Vector3: inner as [number, number, number] } : null;
    case 'Vector2': return finiteTuple(inner, 2) ? { Vector2: inner as [number, number] } : null;
    case 'UDim2': return finiteTuple(inner, 4) ? { UDim2: inner as [number, number, number, number] } : null;
    case 'UDim': return finiteTuple(inner, 2) ? { UDim: inner as [number, number] } : null;
    case 'NumberRange': return finiteTuple(inner, 2) ? { NumberRange: inner as [number, number] } : null;
    case 'CFrame': {
      // Position only, or position + rotation in degrees (x, y, z).
      if (finiteTuple(inner, 3)) {
        const [x, y, z] = inner as [number, number, number];
        return { CFrame: [x, y, z, 0, 0, 0] };
      }
      return finiteTuple(inner, 6) ? { CFrame: inner as [number, number, number, number, number, number] } : null;
    }
    case 'Color3': return typeof inner === 'string' && /^#[0-9a-f]{6}$/i.test(inner) ? { Color3: inner.toLowerCase() } : null;
    case 'Enum': return typeof inner === 'string' && /^Enum\.\w+\.\w+$|^\w+\.\w+$/.test(inner) ? { Enum: inner.replace(/^Enum\./, '') } : null;
    case 'ColorSequence':
      return Array.isArray(inner) && inner.length >= 1 && inner.length <= 8 && inner.every((c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c))
        ? { ColorSequence: (inner as string[]).map((c) => c.toLowerCase()) } : null;
    case 'NumberSequence':
      return Array.isArray(inner) && inner.length >= 1 && inner.length <= 8 && inner.every(finite)
        ? { NumberSequence: inner as number[] } : null;
    default: return null;
  }
}

function readProperties(value: unknown): { properties: Record<string, SpawnValue> } | { reason: string } {
  if (value === undefined || value === null) return { properties: {} };
  if (!isRecord(value)) return { reason: 'properties must be an object' };
  const entries = Object.entries(value);
  if (entries.length > MAX_PROPERTIES) return { reason: 'too many properties on one instance' };
  const properties: Record<string, SpawnValue> = {};
  for (const [name, raw] of entries) {
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(name)) return { reason: `"${name}" is not a property name` };
    if (name === 'Parent' || name === 'Name') continue; // the path decides both
    if (ASSET_PROPERTIES.has(name)) {
      if (raw === '') continue;
      return { reason: `${name} would load an asset by id; build it from parts and colours instead` };
    }
    const parsed = readValue(raw);
    if (parsed === null) return { reason: `${name} has a value Spawn cannot apply` };
    if (typeof parsed === 'string' && /rbxassetid:\/\/|roblox\.com\/asset/i.test(parsed)) {
      return { reason: `${name} would load an asset by id` };
    }
    properties[name] = parsed;
  }
  return { properties };
}

function readOne(raw: unknown): SpawnOp | { reason: string } {
  if (!isRecord(raw)) return { reason: 'not an operation' };
  const where = readPath(raw.path);
  if ('reason' in where) return where;
  switch (raw.op) {
    case 'script': {
      const kind = raw.kind;
      if (kind !== 'Script' && kind !== 'LocalScript' && kind !== 'ModuleScript') return { reason: 'unknown script kind' };
      if (typeof raw.source !== 'string' || !raw.source.trim()) return { reason: 'a script needs source' };
      if (raw.source.length > MAX_SOURCE_CHARS) return { reason: 'that script is too long for one build' };
      const forbidden = forbiddenSourceReason(raw.source);
      if (forbidden) return { reason: forbidden };
      return { op: 'script', path: where.path, kind, source: raw.source };
    }
    case 'instance': {
      if (typeof raw.className !== 'string' || !SPAWN_CLASSES.has(raw.className)) {
        return { reason: `${String(raw.className)} is not something Spawn builds` };
      }
      const props = readProperties(raw.properties);
      if ('reason' in props) return props;
      return { op: 'instance', path: where.path, className: raw.className, properties: props.properties };
    }
    case 'delete':
      return { op: 'delete', path: where.path };
    default:
      return { reason: `unknown operation "${String(raw.op)}"` };
  }
}

/** Read a model's operations: the ones that may run, and why each other one may not. */
export function readSpawnOps(value: unknown): ReadOpsResult {
  const ops: SpawnOp[] = [];
  const rejected: RejectedOp[] = [];
  if (!Array.isArray(value)) return { ops, rejected };
  value.slice(0, MAX_OPS).forEach((raw, index) => {
    const read = readOne(raw);
    if ('reason' in read) rejected.push({ index, reason: read.reason });
    else ops.push(read);
  });
  if (value.length > MAX_OPS) rejected.push({ index: MAX_OPS, reason: `only the first ${MAX_OPS} operations run in one build` });
  return { ops, rejected };
}
