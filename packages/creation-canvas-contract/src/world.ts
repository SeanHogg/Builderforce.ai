/**
 * `world` — the shape a `world` canvas object carries (a 3D authoring space:
 * placed props, a spawn point, sky/ground/lighting), and the pure mutation
 * operations that edit it.
 *
 * ── WHY THIS IS IN THE CONTRACT ───────────────────────────────────────────
 * Same reason `website.ts` is: the canvas editor renders this shape as a real
 * WebGL scene (`world3d/*` under `components/creation-canvas`) and Brain
 * edits the SAME field through `MUTABLE_FIELDS['world']` — an agent turn and
 * a person dragging a prop both have to land on one mutation surface, or the
 * two paths drift. Kept transport-neutral (no React, no Three.js import) so
 * VSIX and any future non-browser consumer can read/patch a scene without
 * pulling in a renderer.
 *
 * Ported from a proven, shipped Three.js + react-three-fiber + Rapier 3D
 * world-builder runtime rather than hand-rolled from scratch, then trimmed to
 * what THIS canvas asked for — placing props, moving a camera, walking a
 * scene with real colliders — and renamed into this repo's `Canvas*`
 * vocabulary (matching `CanvasVideoTimeline`). Dropped from the source: the
 * engine/GameState wrapper (this canvas already discriminates on the object's
 * own `kind`), challenges/scoring, multiplayer peers, the bespoke AI-agent
 * authoring panel (Brain already edits any object's mutable fields through
 * the canvas's own generic mechanism), tags, and the click-to-shoot weapon
 * mechanic — all game-specific engagement features, not "authoring a 3D
 * space". Textures were dropped with them and have since come BACK, as
 * `CanvasWorldProp.surface` in v2, because "put this picture on that wall" is
 * authoring rather than engagement — see the version note below.
 *
 * Every mutation below is TOTAL, same rule `website.ts` states: an unknown
 * prop id returns the scene unchanged rather than throwing. The caller is a
 * UI event handler and an agent turn; neither has anywhere useful to put an
 * exception.
 */

/**
 * ── VERSION 2 ────────────────────────────────────────────────────────────
 * A prop could say what COLOUR it was and nothing else, which is why nothing
 * could be put ON one: a photograph of a whiteboard, a diagram, a rendering.
 * `surface` closes that, and it is optional, so every v1 scene reads back
 * unchanged and no migration runs. The version moves anyway, because a reader
 * that cannot tell which fields it may expect is a reader that guesses.
 *
 * ── WHY THERE IS NO `objectId` HERE ─────────────────────────────────────────
 * Putting a board object into a 3D space was the other half of this change, and
 * it deliberately did NOT become a stored reference on a prop. The `room`
 * surface hangs the session's objects on its wall by reading the BOARD, live —
 * so a card that is renamed, recoloured, re-rendered or deleted is correct in
 * the room on the next frame, with nothing to migrate and nothing to dangle. A
 * stored id would have been a second, staler answer to "which objects exist",
 * which is the one thing a scene document should never be.
 */
export const CANVAS_WORLD_SCHEMA_VERSION = 2;

/** Position + Euler rotation (radians, XYZ order) + non-uniform scale. One
 *  transform shape for the spawn point and every prop — no per-kind fork. */
export interface CanvasWorldTransform {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}

export interface CanvasWorldGround {
  /** Square plane edge length in world units (meters). */
  size: number;
  /** Plane color (CSS hex). */
  color: string;
}

export interface CanvasWorldLighting {
  ambient: { intensity: number; color: string };
  sun: {
    intensity: number;
    /** Normalized direction the light shines TOWARD. */
    direction: [number, number, number];
    color: string;
  };
}

/** Placeable prop kinds. Each picks the right Three.js mesh + Rapier collider
 *  in `world3d/PropMesh.tsx`:
 *   - `block`       — cube. Static by default. Walls, floors, platforms.
 *   - `ramp`        — slanted slab. Static by default. Walkable slopes.
 *   - `sphere`      — ball. Dynamic by default (rolls).
 *   - `platform`    — thin block; scale defaults to a walkable ledge.
 *   - `collectible` — small sensor pickup (walk-through, no physical push).
 *   - `goal`        — sensor finish-zone, rendered translucent.
 *   - `hazard`      — sensor danger-zone, rendered in warning color.
 *   - `light`       — point light + a small visible marker. No collider. */
export type CanvasWorldPropKind =
  | 'block'
  | 'ramp'
  | 'sphere'
  | 'platform'
  | 'collectible'
  | 'goal'
  | 'hazard'
  | 'light';

/** Rapier body kind:
 *   - `static`    — immovable, infinite mass. Walls, floors.
 *   - `dynamic`   — full physics. Falls with gravity, collides.
 *   - `kinematic` — moved by authoring edits, not by physics.
 *   - `sensor`    — overlap-only collider. Player passes through.
 *   - `none`      — no collider. Decorative, or a light. */
export type CanvasWorldPhysicsKind = 'static' | 'dynamic' | 'kinematic' | 'sensor' | 'none';

/**
 * What is PAINTED on a prop's face, as opposed to what the prop is made of.
 *
 * Deliberately not a replacement for `color`: a wall is grey AND has a
 * photograph pinned to it, and collapsing those into one field would mean the
 * untextured faces of a textured prop had no colour to fall back to. Absent
 * means the prop is plain — which is every prop that existed before v2.
 *
 * Only an image today. A video stream is the obvious second member and is
 * deliberately NOT declared until something produces one: a union arm nothing
 * emits is a promise, and the renderer would have to branch on a case it can
 * never be handed.
 */
export type CanvasWorldPropSurface = {
  kind: 'image';
  /** Absolute or same-origin URL. The renderer loads it as a texture. */
  url: string;
  /** How the image sits in the face's aspect ratio. Defaults to `cover`. */
  fit?: 'cover' | 'contain';
};

/**
 * The kinds with a flat face a picture can actually sit on.
 *
 * Declared here rather than decided twice: `PropMesh` needs it to know whether
 * to draw a panel, and `WorldPropertiesPanel` needs it to know whether to offer
 * the field. If only the renderer knew, the panel would accept an image URL for
 * a sphere and nothing would happen — an author typing into a control that does
 * nothing is worse than a control that is not there.
 */
const SURFACEABLE_PROP_KINDS: readonly CanvasWorldPropKind[] = ['block', 'platform', 'ramp', 'hazard', 'goal'];

export function propTakesSurface(kind: CanvasWorldPropKind): boolean {
  return SURFACEABLE_PROP_KINDS.includes(kind);
}

export interface CanvasWorldProp extends CanvasWorldTransform {
  id: string;
  kind: CanvasWorldPropKind;
  /** Display color (CSS hex). The material; see {@link CanvasWorldPropSurface}. */
  color: string;
  physics: CanvasWorldPhysicsKind;
  /** What is painted on the prop's face. Absent = plain colour. */
  surface?: CanvasWorldPropSurface;
}

export interface CanvasWorldScene {
  schemaVersion: number;
  /** Sky / clear color, and the ambient fog fallback. */
  skyColor: string;
  ground: CanvasWorldGround;
  lighting: CanvasWorldLighting;
  /** Where the walker appears on entering walk mode. */
  spawn: CanvasWorldTransform;
  /** Order is paint-order for the left-rail authoring list; the renderer
   *  itself sorts by camera distance, so order has no visual effect in 3D. */
  props: readonly CanvasWorldProp[];
}

/** Build an empty world — flat green ground, midday sun, spawn at origin, no
 *  props. Single source so the registry seed and any migration reader agree. */
export function emptyCanvasWorldScene(): CanvasWorldScene {
  return {
    schemaVersion: CANVAS_WORLD_SCHEMA_VERSION,
    skyColor: '#7dd3fc',
    ground: { size: 100, color: '#65a30d' },
    lighting: {
      ambient: { intensity: 0.45, color: '#ffffff' },
      sun: { intensity: 1.0, direction: [1, -1, 0.5], color: '#ffffff' },
    },
    spawn: { position: [0, 2, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    props: [],
  };
}

// ─── Mutations ──────────────────────────────────────────────────────────────

interface PropKindDefaults {
  scale: [number, number, number];
  color: string;
  physics: CanvasWorldPhysicsKind;
}

/** Single source of truth for "what does a fresh <kind> look like". The
 *  palette's add action and the properties panel's per-kind physics default
 *  both read this — no per-call-site hand-rolling. */
export const PROP_KIND_DEFAULTS: Record<CanvasWorldPropKind, PropKindDefaults> = {
  block: { scale: [2, 2, 2], color: '#94a3b8', physics: 'static' },
  ramp: { scale: [3, 1, 3], color: '#a8a29e', physics: 'static' },
  sphere: { scale: [1, 1, 1], color: '#fbbf24', physics: 'dynamic' },
  platform: { scale: [4, 0.5, 4], color: '#a3a3a3', physics: 'static' },
  collectible: { scale: [0.6, 0.6, 0.6], color: '#facc15', physics: 'sensor' },
  goal: { scale: [2, 2, 2], color: '#22c55e', physics: 'sensor' },
  hazard: { scale: [2, 1, 2], color: '#ef4444', physics: 'sensor' },
  light: { scale: [0.4, 0.4, 0.4], color: '#fef9c3', physics: 'none' },
};

function nextPropId(scene: CanvasWorldScene, kind: CanvasWorldPropKind): string {
  let max = 0;
  const re = new RegExp(`^${kind}-(\\d+)$`);
  for (const prop of scene.props) {
    const m = re.exec(prop.id);
    if (m) max = Math.max(max, Number.parseInt(m[1] ?? '0', 10));
  }
  return `${kind}-${max + 1}`;
}

/** Add a new prop at the given position (defaults to sitting on the ground
 *  at the origin). Remaining fields come from `PROP_KIND_DEFAULTS`, so
 *  callers only need to pass `{ kind, position? }`. Returns the new scene
 *  and the new prop so the caller can select it on add. */
export function addProp(
  scene: CanvasWorldScene,
  opts: {
    kind: CanvasWorldPropKind;
    position?: [number, number, number];
    rotation?: [number, number, number];
    scale?: [number, number, number];
    color?: string;
    physics?: CanvasWorldPhysicsKind;
    surface?: CanvasWorldPropSurface;
  },
): { scene: CanvasWorldScene; prop: CanvasWorldProp } {
  const defaults = PROP_KIND_DEFAULTS[opts.kind];
  const prop: CanvasWorldProp = {
    id: nextPropId(scene, opts.kind),
    kind: opts.kind,
    position: opts.position ?? [0, defaults.scale[1] / 2, 0],
    rotation: opts.rotation ?? [0, 0, 0],
    scale: opts.scale ?? defaults.scale,
    color: opts.color ?? defaults.color,
    physics: opts.physics ?? defaults.physics,
    // Spread rather than assigned so a plain prop carries no `surface: undefined`
    // key into the jsonb column — an absent field and a null one read the same
    // here, and only one of them survives a round-trip looking like the original.
    ...(opts.surface ? { surface: opts.surface } : {}),
  };
  return { scene: { ...scene, props: [...scene.props, prop] }, prop };
}

export function updateProp(
  scene: CanvasWorldScene,
  propId: string,
  patch: Partial<Omit<CanvasWorldProp, 'id'>>,
): CanvasWorldScene {
  return {
    ...scene,
    props: scene.props.map((prop) => (prop.id === propId ? { ...prop, ...patch } : prop)),
  };
}

/**
 * Paint a prop's face, or strip it back to plain colour with `null`.
 *
 * Its own mutation rather than a call through {@link updateProp} because
 * CLEARING is the interesting case: `updateProp(scene, id, { surface: undefined })`
 * leaves the key present-and-undefined, and a key that exists holding undefined
 * survives a jsonb round-trip differently from one that was never there. This
 * rebuilds the prop without the key, so "no picture" is the same document it
 * would have been if nobody had ever added one.
 *
 * Total like every other mutation here: an unknown prop id, or a surface on a
 * kind with no flat face to put it on, returns the scene unchanged.
 */
export function setPropSurface(
  scene: CanvasWorldScene,
  propId: string,
  surface: CanvasWorldPropSurface | null,
): CanvasWorldScene {
  return {
    ...scene,
    props: scene.props.map((prop) => {
      if (prop.id !== propId) return prop;
      if (!surface) {
        const { surface: _dropped, ...bare } = prop;
        return bare;
      }
      return propTakesSurface(prop.kind) ? { ...prop, surface } : prop;
    }),
  };
}

export function deleteProp(scene: CanvasWorldScene, propId: string): CanvasWorldScene {
  return { ...scene, props: scene.props.filter((prop) => prop.id !== propId) };
}

export function updateSpawn(scene: CanvasWorldScene, patch: Partial<CanvasWorldTransform>): CanvasWorldScene {
  return { ...scene, spawn: { ...scene.spawn, ...patch } };
}

export function updateGround(scene: CanvasWorldScene, patch: Partial<CanvasWorldGround>): CanvasWorldScene {
  return { ...scene, ground: { ...scene.ground, ...patch } };
}

export function updateLighting(scene: CanvasWorldScene, patch: Partial<CanvasWorldLighting>): CanvasWorldScene {
  return { ...scene, lighting: { ...scene.lighting, ...patch } };
}

export function updateSkyColor(scene: CanvasWorldScene, skyColor: string): CanvasWorldScene {
  return { ...scene, skyColor };
}

// ─── Defensive read ─────────────────────────────────────────────────────────

const PROP_KINDS: readonly CanvasWorldPropKind[] = ['block', 'ramp', 'sphere', 'platform', 'collectible', 'goal', 'hazard', 'light'];
const PHYSICS_KINDS: readonly CanvasWorldPhysicsKind[] = ['static', 'dynamic', 'kinematic', 'sensor', 'none'];

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function vec3(value: unknown, fallback: [number, number, number]): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) return fallback;
  return [finite(value[0], fallback[0]), finite(value[1], fallback[1]), finite(value[2], fallback[2])];
}

function hexColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

/** Largest texture URL accepted, so a data: URI cannot make one prop the size
 *  of the whole scene document. Real images live behind a URL; a base64 blob
 *  belongs in the attachment store the canvas already has. */
const MAX_SURFACE_URL = 2_048;

/** Read a prop's painted face back, or undefined when there is nothing usable.
 *  Undefined rather than a `{kind:'image', url:''}` placeholder: an empty
 *  texture is a grey square the author cannot explain, and a plain prop is
 *  exactly what they had before. */
function propSurface(value: unknown): CanvasWorldPropSurface | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (raw.kind !== 'image') return undefined;
  const url = typeof raw.url === 'string' ? raw.url.trim() : '';
  if (!url || url.length > MAX_SURFACE_URL) return undefined;
  const fit = raw.fit === 'contain' ? 'contain' : undefined;
  return { kind: 'image', url, ...(fit ? { fit } : {}) };
}

/** Read a `CanvasWorldScene` back from whatever a canvas object's `world`
 *  field actually holds — untrusted at the type level (jsonb round-trip, or
 *  a Brain-authored patch), same reason `canvasVideoTimelineFrom` exists for
 *  video. Malformed props are dropped rather than crashing the surface;
 *  every other field falls back to the empty scene's default. */
export function canvasWorldSceneFrom(value: unknown): CanvasWorldScene {
  const fallback = emptyCanvasWorldScene();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  const raw = value as Record<string, unknown>;

  const ground = raw.ground && typeof raw.ground === 'object' ? raw.ground as Record<string, unknown> : {};
  const lighting = raw.lighting && typeof raw.lighting === 'object' ? raw.lighting as Record<string, unknown> : {};
  const ambient = lighting.ambient && typeof lighting.ambient === 'object' ? lighting.ambient as Record<string, unknown> : {};
  const sun = lighting.sun && typeof lighting.sun === 'object' ? lighting.sun as Record<string, unknown> : {};
  const spawn = raw.spawn && typeof raw.spawn === 'object' ? raw.spawn as Record<string, unknown> : {};

  const props = Array.isArray(raw.props) ? raw.props.flatMap((entry, index): CanvasWorldProp[] => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const prop = entry as Record<string, unknown>;
    const kind = PROP_KINDS.includes(prop.kind as CanvasWorldPropKind) ? prop.kind as CanvasWorldPropKind : null;
    if (!kind) return [];
    const defaults = PROP_KIND_DEFAULTS[kind];
    const surface = propSurface(prop.surface);
    return [{
      id: typeof prop.id === 'string' && prop.id ? prop.id : `${kind}-${index}`,
      kind,
      position: vec3(prop.position, [0, defaults.scale[1] / 2, 0]),
      rotation: vec3(prop.rotation, [0, 0, 0]),
      scale: vec3(prop.scale, defaults.scale),
      color: hexColor(prop.color, defaults.color),
      physics: PHYSICS_KINDS.includes(prop.physics as CanvasWorldPhysicsKind) ? prop.physics as CanvasWorldPhysicsKind : defaults.physics,
      ...(surface ? { surface } : {}),
    }];
  }) : [];

  return {
    schemaVersion: CANVAS_WORLD_SCHEMA_VERSION,
    skyColor: hexColor(raw.skyColor, fallback.skyColor),
    ground: {
      size: finite(ground.size, fallback.ground.size),
      color: hexColor(ground.color, fallback.ground.color),
    },
    lighting: {
      ambient: {
        intensity: finite(ambient.intensity, fallback.lighting.ambient.intensity),
        color: hexColor(ambient.color, fallback.lighting.ambient.color),
      },
      sun: {
        intensity: finite(sun.intensity, fallback.lighting.sun.intensity),
        direction: vec3(sun.direction, fallback.lighting.sun.direction),
        color: hexColor(sun.color, fallback.lighting.sun.color),
      },
    },
    spawn: {
      position: vec3(spawn.position, fallback.spawn.position),
      rotation: vec3(spawn.rotation, fallback.spawn.rotation),
      scale: vec3(spawn.scale, fallback.spawn.scale),
    },
    props,
  };
}
