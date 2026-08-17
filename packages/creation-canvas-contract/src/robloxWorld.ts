/**
 * A Roblox place, read back as a world this browser can actually walk.
 *
 * ── THE GAP THIS CLOSES ───────────────────────────────────────────────────
 * `.rbxlx` is generated FROM a bounded spec (`api/.../robloxPlace.ts`) and then
 * the spec is thrown away — the file is the artifact of record. That was fine
 * while "play" meant Roblox Studio, and became the bug the moment a player
 * pressed Play on the canvas: the place demonstrably existed, and every surface
 * that reads a game reads `text/html`, so a real artifact reported itself as
 * "no game yet".
 *
 * The place is not HTML and never will be. But the WORLD inside it is the same
 * thing `CanvasWorldScene` describes — positioned boxes with a size, a colour
 * and a physical role — and this canvas already owns a Three.js + Rapier
 * runtime that walks one. So the honest reading of a place, in a browser, is
 * its world; this module is that reading, and it is a pure function of the file.
 *
 * ── WHY PARSE THE FILE RATHER THAN KEEP THE SPEC ──────────────────────────
 * Storing the spec alongside the place would make the two able to disagree, and
 * would do nothing for the places already sitting on people's boards. The file
 * is the one source of truth; reading it back is a decode, not a second author.
 *
 * ── WHY NO XML PARSER ─────────────────────────────────────────────────────
 * This has to run in the browser, the VSIX and a Worker, so it stays
 * transport-neutral: no DOMParser, no dependency. It reads exactly the shapes
 * `rbxlxFromSpec` writes, and anything it does not recognise it drops rather
 * than guesses — a place with one unreadable part is still a place worth
 * walking.
 */

import {
  emptyCanvasWorldScene,
  type CanvasWorldPhysicsKind,
  type CanvasWorldProp,
  type CanvasWorldPropKind,
  type CanvasWorldScene,
} from './world';

/**
 * Studs to world units.
 *
 * Not arbitrary and not a taste call. A Roblox character is ~5 studs tall; the
 * walker in this canvas's runtime is a 2.0-unit capsule (`PlayerController`'s
 * `CapsuleCollider args={[0.6, 0.4]}`). 2 / 5 = 0.4, so a jump a Roblox player
 * could make is a jump this walker can make, and a 4-stud step up stays a step
 * rather than becoming a wall. Roblox's own 16 studs/s walk speed lands at 6.4
 * units/s against the runtime's 6 — close enough that the place feels like the
 * place.
 */
export const STUDS_TO_UNITS = 0.4;

/** Roblox's default sky, so a place opens under the sky it opens under there. */
const ROBLOX_SKY = '#87ceeb';

/** The world the runtime walks, plus what could not be read into it. */
export interface RobloxWorldReading {
  scene: CanvasWorldScene;
  /** Parts that made it in. Zero means the file held no world. */
  partCount: number;
  /** Gameplay parts the Luau would have driven — what makes this a level. */
  collectibles: number;
  goals: number;
  hazards: number;
}

/** One Luau script lifted out of a place, for the surfaces that show source. */
export interface RobloxScriptSource {
  /** `GameServer` / `GameClient` — the instance name, which is the file name. */
  name: string;
  /** `Script` (server) or `LocalScript` (client). */
  className: string;
  source: string;
}

interface RawItem {
  className: string;
  /** Everything between the item's open and close tag, children included. */
  body: string;
}

/**
 * Every `<Item>` in the document, nested ones included.
 *
 * The scanner resumes immediately after each OPEN tag, so a `Part`'s child
 * `StringValue` is emitted in its own right on a later pass — which costs
 * nothing, since only the classes below are read, and saves a recursive walk.
 */
function scanItems(xml: string): RawItem[] {
  const items: RawItem[] = [];
  const open = /<Item\s[^>]*class="([^"]+)"[^>]*>/g;
  let match: RegExpExecArray | null;
  while ((match = open.exec(xml)) !== null) {
    const start = open.lastIndex;
    const token = /<Item\s[^>]*>|<\/Item>/g;
    token.lastIndex = start;
    let depth = 1;
    let end = xml.length;
    let step: RegExpExecArray | null;
    while ((step = token.exec(xml)) !== null) {
      if (step[0].startsWith('</')) {
        depth -= 1;
        if (depth === 0) { end = step.index; break; }
      } else {
        depth += 1;
      }
    }
    items.push({ className: match[1] ?? '', body: xml.slice(start, end) });
  }
  return items;
}

/**
 * The item's OWN properties.
 *
 * Scoped deliberately: an item's `<Properties>` block always precedes its
 * children, so the first block in the body is this item's and a child's `Name`
 * can never be mistaken for the parent's.
 */
function ownProperties(body: string): string {
  const start = body.indexOf('<Properties>');
  if (start < 0) return '';
  const end = body.indexOf('</Properties>', start);
  return end < 0 ? body.slice(start) : body.slice(start + '<Properties>'.length, end);
}

function tagValue(properties: string, type: string, name: string): string | null {
  const match = new RegExp(`<${type} name="${name}">([\\s\\S]*?)</${type}>`).exec(properties);
  return match ? (match[1] ?? '') : null;
}

function numberIn(source: string, tag: string, fallback: number): number {
  const match = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(source);
  const value = match ? Number(match[1]) : Number.NaN;
  return Number.isFinite(value) ? value : fallback;
}

/** `<X>/<Y>/<Z>` out of a `CoordinateFrame` or a `Vector3`, in studs. */
function vectorIn(properties: string, type: string, name: string, fallback: [number, number, number]): [number, number, number] {
  const raw = tagValue(properties, type, name);
  if (raw === null) return fallback;
  return [numberIn(raw, 'X', fallback[0]), numberIn(raw, 'Y', fallback[1]), numberIn(raw, 'Z', fallback[2])];
}

function hex(value: number): string {
  return value.toString(16).padStart(2, '0');
}

/**
 * Roblox packs a colour into a uint32 with alpha in the top byte — the same
 * packing `color3uint8` writes. Read the low three bytes back; a missing or
 * unreadable value falls back to a neutral grey rather than to black, which
 * would read as a lighting bug rather than as a missing colour.
 */
function readColor(properties: string, fallback: string): string {
  const raw = tagValue(properties, 'Color3uint8', 'Color3uint8');
  if (raw === null) return fallback;
  const packed = Number(raw.trim());
  if (!Number.isFinite(packed)) return fallback;
  const value = packed >>> 0;
  return `#${hex((value >> 16) & 0xff)}${hex((value >> 8) & 0xff)}${hex(value & 0xff)}`;
}

function readBool(properties: string, name: string, fallback: boolean): boolean {
  const raw = tagValue(properties, 'bool', name);
  return raw === null ? fallback : raw.trim() === 'true';
}

/** The `bf_role` marker a generated part carries, as its own child instance. */
function readRole(body: string): string {
  const match = /<string name="Name">bf_role<\/string>\s*<string name="Value">([^<]*)<\/string>/.exec(body);
  return match ? (match[1] ?? '').trim() : '';
}

/**
 * What a Roblox role IS, in this runtime's vocabulary.
 *
 * The three sensor roles keep being sensors, because that is the property that
 * makes them gameplay rather than scenery: a collectible you cannot walk into
 * is not a collectible. `obstacle` and `decor` are both boxes — the difference
 * between them in Roblox is what the Luau does about them, and this runtime is
 * not running the Luau.
 */
const ROLE_KIND: Record<string, CanvasWorldPropKind> = {
  platform: 'platform',
  obstacle: 'block',
  collectible: 'collectible',
  goal: 'goal',
  hazard: 'hazard',
  decor: 'block',
};

const SENSOR_ROLES = new Set(['collectible', 'goal', 'hazard']);

function physicsFor(role: string, anchored: boolean): CanvasWorldPhysicsKind {
  if (SENSOR_ROLES.has(role)) return 'sensor';
  return anchored ? 'static' : 'dynamic';
}

/**
 * Read a `.rbxlx` as a walkable world.
 *
 * Returns null when the file is not a place or holds no parts at all — the
 * caller has something true to say in that case, and a scene with an empty
 * ground would be a lie shaped like a world.
 */
export function robloxWorldReading(rbxlx: string): RobloxWorldReading | null {
  if (typeof rbxlx !== 'string' || !/<roblox[\s>]/i.test(rbxlx)) return null;

  const base = emptyCanvasWorldScene();
  const props: CanvasWorldProp[] = [];
  let ground = { size: base.ground.size, color: base.ground.color };
  let spawn: [number, number, number] | null = null;
  let index = 0;

  for (const item of scanItems(rbxlx)) {
    if (item.className !== 'Part' && item.className !== 'SpawnLocation' && item.className !== 'Workspace') continue;
    const properties = ownProperties(item.body);

    if (item.className === 'Workspace') continue;

    const partName = (tagValue(properties, 'string', 'Name') ?? '').trim();
    const centre = vectorIn(properties, 'CoordinateFrame', 'CFrame', [0, 0, 0]);
    const size = vectorIn(properties, 'Vector3', 'size', [4, 1, 4]);

    if (item.className === 'SpawnLocation') {
      // The walker's body centre, not the pad's: a capsule spawned level with
      // the pad starts half-buried in it and is shoved out by the solver.
      spawn = [centre[0] * STUDS_TO_UNITS, centre[1] * STUDS_TO_UNITS + 1.4, centre[2] * STUDS_TO_UNITS];
      continue;
    }

    // The baseplate IS the ground, not a prop standing on it. Rendering it as a
    // 205-unit static box would double the floor and bury the fog in a wall.
    if (partName === 'Baseplate') {
      ground = {
        size: Math.max(20, Math.max(size[0], size[2]) * STUDS_TO_UNITS),
        color: readColor(properties, base.ground.color),
      };
      continue;
    }

    const role = readRole(item.body);
    const anchored = readBool(properties, 'Anchored', true);
    index += 1;
    props.push({
      id: `${role || 'part'}-${index}`,
      kind: ROLE_KIND[role] ?? 'block',
      position: [centre[0] * STUDS_TO_UNITS, centre[1] * STUDS_TO_UNITS, centre[2] * STUDS_TO_UNITS],
      rotation: [0, 0, 0],
      scale: [
        Math.max(0.05, size[0] * STUDS_TO_UNITS),
        Math.max(0.05, size[1] * STUDS_TO_UNITS),
        Math.max(0.05, size[2] * STUDS_TO_UNITS),
      ],
      color: readColor(properties, '#9aa5b1'),
      physics: physicsFor(role, anchored),
    });
  }

  if (props.length === 0) return null;

  return {
    partCount: props.length,
    collectibles: props.filter((prop) => prop.kind === 'collectible').length,
    goals: props.filter((prop) => prop.kind === 'goal').length,
    hazards: props.filter((prop) => prop.kind === 'hazard').length,
    scene: {
      ...base,
      skyColor: ROBLOX_SKY,
      ground,
      spawn: { ...base.spawn, position: spawn ?? [0, 2, 0] },
      props,
    },
  };
}

/** The world alone, for the callers that only want something to render. */
export function robloxWorldSceneFrom(rbxlx: string): CanvasWorldScene | null {
  return robloxWorldReading(rbxlx)?.scene ?? null;
}

/**
 * CDATA cannot contain its own terminator, so `rbxlxFromSpec` splits the
 * sequence across two sections. This is the exact inverse — without it, a Luau
 * line containing `]]>` comes back with a stray `<![CDATA[` in the middle of it.
 */
function decodeCdata(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('<![CDATA[') || !trimmed.endsWith(']]>')) return trimmed;
  return trimmed.slice('<![CDATA['.length, -']]>'.length).split(']]]]><![CDATA[>').join(']]>');
}

/**
 * The Luau a place carries.
 *
 * A place is not only a world — it is the rules that run in it, and those are
 * the half of a Roblox game a person actually edits. Reading them back is what
 * lets the code-reading surfaces show a Roblox game's source beside a web
 * game's, instead of treating the place as an opaque download.
 */
export function robloxScriptsFrom(rbxlx: string): RobloxScriptSource[] {
  if (typeof rbxlx !== 'string') return [];
  const scripts: RobloxScriptSource[] = [];
  for (const item of scanItems(rbxlx)) {
    if (item.className !== 'Script' && item.className !== 'LocalScript' && item.className !== 'ModuleScript') continue;
    const properties = ownProperties(item.body);
    const source = tagValue(properties, 'ProtectedString', 'Source');
    if (source === null) continue;
    scripts.push({
      name: (tagValue(properties, 'string', 'Name') ?? 'Script').trim() || 'Script',
      className: item.className,
      source: decodeCdata(source),
    });
  }
  return scripts;
}
