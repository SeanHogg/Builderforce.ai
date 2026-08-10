/**
 * Roblox place generation — turning a brief into a place that actually opens.
 *
 * Roblox is not a port of the browser game. There is no DOM, no canvas and no
 * `requestAnimationFrame` inside it; it is a server-authoritative engine scripted
 * in Luau. So this target re-authors the BRIEF against that engine rather than
 * wrapping the HTML, which is the only honest thing to do — a wrapper that
 * claimed to run a web game inside Roblox would be a lie with extra steps.
 *
 * ── THE SPLIT, AND WHY IT IS WHERE IT IS ────────────────────────────────────
 * This follows the same discipline as `geometryService`: the model authors a
 * bounded SPEC and code evaluates it into the file format. But the line is drawn
 * in a different place, deliberately.
 *
 *   The WORLD is a spec.  `.rbxlx` is Roblox's XML place format, and its property
 *   serialisation is unforgiving in ways nothing warns you about: `Size` is
 *   written as a lowercase `<Vector3 name="size">`, a colour is a packed uint32
 *   in `Color3uint8`, and a CFrame is twelve separate elements. A model asked for
 *   that XML directly produces something plausible that Studio refuses to open,
 *   with an error that points at a byte offset. So it authors typed parts and
 *   this module writes the XML.
 *
 *   The SCRIPTS are source.  Luau is a programming language, not a file format —
 *   the same thing the browser target already trusts a model to write. Studio
 *   surfaces a script error on the line it happened, editable in place. Making
 *   the model author gameplay through some constrained rule vocabulary would
 *   trade a debuggable script for an inexpressive one and buy nothing.
 *
 * Everything below the model call is pure: spec in, files out. It runs in a test
 * with no network and no key.
 */

import { escapeHtml, hexToRgb } from './gameDocument';

/* ---------- the spec a model is allowed to author ---------- */

/** One built part in the world. Positions and sizes are studs. */
export interface RobloxPartSpec {
  name: string;
  /** Centre of the part. Y is up in Roblox, and the floor sits at y = 0. */
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  depth: number;
  /** `#rrggbb`. */
  color: string;
  /** False for parts the physics engine should move (crates, projectiles). */
  anchored: boolean;
  /**
   * What the part is FOR. The generated scripts find parts by this tag rather
   * than by name, so renaming a part in Studio does not silently unhook it from
   * the gameplay that referenced it.
   */
  role: 'platform' | 'obstacle' | 'collectible' | 'goal' | 'hazard' | 'decor';
}

export interface RobloxGameSpec {
  name: string;
  summary: string;
  /** Where a player spawns. */
  spawnX: number;
  spawnY: number;
  spawnZ: number;
  baseplateColor: string;
  parts: RobloxPartSpec[];
  /** Luau that runs on the server. Owns rules, scoring and anything authoritative. */
  serverScript: string;
  /** Luau that runs on each player's client. Owns UI, input and feedback. */
  clientScript: string;
}

/** A model that runs away with the spec must not produce an unopenable place. */
const MAX_PARTS = 250;
const MAX_SCRIPT_CHARS = 20_000;
/** Roblox refuses parts above 2048 studs on an axis. */
const MAX_STUD = 2048;

const PART_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'x', 'y', 'z', 'width', 'height', 'depth', 'color', 'anchored', 'role'],
  properties: {
    name: { type: 'string' },
    x: { type: 'number' },
    y: { type: 'number' },
    z: { type: 'number' },
    width: { type: 'number' },
    height: { type: 'number' },
    depth: { type: 'number' },
    color: { type: 'string' },
    anchored: { type: 'boolean' },
    role: { type: 'string', enum: ['platform', 'obstacle', 'collectible', 'goal', 'hazard', 'decor'] },
  },
} as const;

const ROBLOX_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'summary', 'spawnX', 'spawnY', 'spawnZ', 'baseplateColor', 'parts', 'serverScript', 'clientScript'],
  properties: {
    name: { type: 'string' },
    summary: { type: 'string' },
    spawnX: { type: 'number' },
    spawnY: { type: 'number' },
    spawnZ: { type: 'number' },
    baseplateColor: { type: 'string' },
    parts: { type: 'array', minItems: 1, items: PART_SCHEMA },
    serverScript: { type: 'string' },
    clientScript: { type: 'string' },
  },
} as const;

/** The response contract handed to the model. */
export const ROBLOX_RESPONSE_SCHEMA = {
  type: 'json_schema' as const,
  json_schema: { name: 'roblox_place', strict: true, schema: ROBLOX_SCHEMA },
};

export const ROBLOX_SYSTEM_PROMPT =
  'You build Roblox experiences in Luau. Read the brief and design a REAL, playable Roblox place for it — '
  + 'not a port of a web game. Lay out the world as positioned parts in studs, with Y up and the floor at y=0; '
  + 'a player is about 5 studs tall, so make platforms reachable (no more than 4 studs of rise between them) '
  + 'and spaces walkable. Give every part a role so the scripts can find it.\n\n'
  + 'Write two Luau scripts that make it actually play:\n'
  + '- serverScript runs in ServerScriptService. It owns the rules: scoring, respawns, what happens on touch, '
  + 'win and lose conditions. Find parts with CollectionService:GetTagged("bf_collectible"), "bf_hazard", '
  + '"bf_goal", "bf_obstacle", "bf_platform" — every part is tagged with "bf_" plus its role. '
  + 'Give each player a leaderstats IntValue named "Score" so the score shows in the player list. '
  + 'Communicate with clients through a RemoteEvent named "GameEvent" in ReplicatedStorage; it already exists.\n'
  + '- clientScript runs in StarterPlayerScripts. It owns feedback: a ScreenGui it builds itself showing score '
  + 'and objective, and reactions to GameEvent.\n\n'
  + 'Use only real Roblox APIs. Do not use require() on any asset id, do not reference images or sounds by id, '
  + 'and do not assume any instance exists that you have not created or been told about. '
  + 'The place must be winnable and must not error on an empty server. Reply with JSON only.';

/* ---------- validation ---------- */

function finite(value: unknown, fallback: number): number {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clampStud(value: number): number {
  return Math.max(-MAX_STUD, Math.min(MAX_STUD, Math.round(value * 100) / 100));
}

function readColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim().toLowerCase() : fallback;
}

/**
 * Read a model's answer as a place, or reject it.
 *
 * Dimensions are clamped rather than rejected: a part 5000 studs wide is a
 * misjudged scale, and clamping it yields a place that opens and can be fixed in
 * Studio. A place with no parts or no server script is rejected — that is not a
 * misjudgement, it is an empty world, and shipping one as a game would be the
 * silent failure this whole module exists to prevent.
 */
export function readRobloxSpec(value: unknown): RobloxGameSpec | null {
  const raw = value as Partial<RobloxGameSpec> | null;
  if (!raw || !Array.isArray(raw.parts)) return null;

  const parts: RobloxPartSpec[] = [];
  for (const candidate of raw.parts.slice(0, MAX_PARTS)) {
    const part = candidate as Partial<RobloxPartSpec> | null;
    if (!part) continue;
    const width = clampStud(Math.abs(finite(part.width, 4)) || 4);
    const height = clampStud(Math.abs(finite(part.height, 1)) || 1);
    const depth = clampStud(Math.abs(finite(part.depth, 4)) || 4);
    const role = part.role;
    parts.push({
      name: (typeof part.name === 'string' && part.name.trim() ? part.name.trim() : 'Part').slice(0, 60),
      x: clampStud(finite(part.x, 0)),
      y: clampStud(finite(part.y, 0)),
      z: clampStud(finite(part.z, 0)),
      width,
      height,
      depth,
      color: readColor(part.color, '#9aa5b1'),
      anchored: part.anchored !== false,
      role:
        role === 'platform' || role === 'obstacle' || role === 'collectible'
          || role === 'goal' || role === 'hazard' || role === 'decor'
          ? role
          : 'decor',
    });
  }
  if (!parts.length) return null;

  const serverScript = typeof raw.serverScript === 'string' ? raw.serverScript.trim() : '';
  const clientScript = typeof raw.clientScript === 'string' ? raw.clientScript.trim() : '';
  if (serverScript.length < 40) return null;

  return {
    name: (typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : 'Builderforce Game').slice(0, 80),
    summary: typeof raw.summary === 'string' ? raw.summary.slice(0, 500) : '',
    spawnX: clampStud(finite(raw.spawnX, 0)),
    spawnY: clampStud(finite(raw.spawnY, 4)),
    spawnZ: clampStud(finite(raw.spawnZ, 0)),
    baseplateColor: readColor(raw.baseplateColor, '#4f7942'),
    parts,
    serverScript: serverScript.slice(0, MAX_SCRIPT_CHARS),
    clientScript: clientScript.slice(0, MAX_SCRIPT_CHARS),
  };
}

/* ---------- evaluation into a place ---------- */

/**
 * Roblox packs a colour into a uint32 with alpha in the top byte. Emitting the
 * plain 24-bit value instead produces a part that is transparent-black in Studio
 * — it opens, and looks broken, which is worse than failing.
 */
function color3uint8(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return ((0xff << 24) >>> 0) + (r << 16) + (g << 8) + b;
}

/** An identity rotation. Every part in a generated place is axis-aligned. */
function cframe(x: number, y: number, z: number): string {
  return [
    '<CoordinateFrame name="CFrame">',
    `<X>${x}</X><Y>${y}</Y><Z>${z}</Z>`,
    '<R00>1</R00><R01>0</R01><R02>0</R02>',
    '<R10>0</R10><R11>1</R11><R12>0</R12>',
    '<R20>0</R20><R21>0</R21><R22>1</R22>',
    '</CoordinateFrame>',
  ].join('');
}

/**
 * CDATA cannot contain the sequence that ends it. Luau legitimately can — `a[b[c]]>d`
 * is valid — so the section is split around it rather than the character being
 * escaped, which CDATA has no mechanism for.
 */
function cdata(source: string): string {
  return `<![CDATA[${source.split(']]>').join(']]]]><![CDATA[>')}]]>`;
}

class ReferentCounter {
  private next = 0;
  take(): string {
    return `RBX${this.next++}`;
  }
}

function partItem(part: RobloxPartSpec, ref: ReferentCounter): string {
  // A collectible or hazard that blocks the player is a bug in level design, so
  // those two roles are non-colliding by construction: they are meant to be
  // walked THROUGH and detected on touch.
  const canCollide = part.role !== 'collectible' && part.role !== 'hazard';
  return [
    `<Item class="Part" referent="${ref.take()}">`,
    '<Properties>',
    `<bool name="Anchored">${part.anchored ? 'true' : 'false'}</bool>`,
    `<bool name="CanCollide">${canCollide ? 'true' : 'false'}</bool>`,
    `<Color3uint8 name="Color3uint8">${color3uint8(part.color)}</Color3uint8>`,
    cframe(part.x, part.y, part.z),
    `<string name="Name">${escapeHtml(part.name)}</string>`,
    `<Vector3 name="size"><X>${part.width}</X><Y>${part.height}</Y><Z>${part.depth}</Z></Vector3>`,
    '</Properties>',
    // The tag the generated scripts actually look the part up by. A `StringValue`
    // child is used rather than CollectionService's own serialisation because the
    // tag container's XML shape is a private detail that has changed; a child
    // instance is stable, and a two-line server loop turns it into a real tag.
    `<Item class="StringValue" referent="${ref.take()}">`,
    '<Properties>',
    '<string name="Name">bf_role</string>',
    `<string name="Value">${escapeHtml(part.role)}</string>`,
    '</Properties>',
    '</Item>',
    '</Item>',
  ].join('\n');
}

function scriptItem(className: string, name: string, source: string, ref: ReferentCounter): string {
  return [
    `<Item class="${className}" referent="${ref.take()}">`,
    '<Properties>',
    `<string name="Name">${escapeHtml(name)}</string>`,
    `<ProtectedString name="Source">${cdata(source)}</ProtectedString>`,
    '</Properties>',
    '</Item>',
  ].join('\n');
}

/**
 * The bootstrap that turns the authored world into the world the scripts expect.
 *
 * Prepended to the generated server script rather than left for the model to
 * remember, because two things must be true before ANY generated gameplay line
 * runs, and a model that forgets either produces a place that opens and then
 * errors on join: every part must carry a real CollectionService tag, and
 * `ReplicatedStorage.GameEvent` must exist.
 */
const SERVER_BOOTSTRAP = `--!strict
-- Builderforce bootstrap. Runs before the generated gameplay below.
local CollectionService = game:GetService("CollectionService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

-- Turn the authored bf_role markers into real tags, so the gameplay below can
-- use CollectionService:GetTagged("bf_collectible") and friends.
for _, descendant in ipairs(workspace:GetDescendants()) do
\tif descendant:IsA("StringValue") and descendant.Name == "bf_role" then
\t\tlocal part = descendant.Parent
\t\tif part and part:IsA("BasePart") then
\t\t\tCollectionService:AddTag(part, "bf_" .. descendant.Value)
\t\tend
\tend
end

-- The one channel the client script listens on.
if not ReplicatedStorage:FindFirstChild("GameEvent") then
\tlocal event = Instance.new("RemoteEvent")
\tevent.Name = "GameEvent"
\tevent.Parent = ReplicatedStorage
end

-- ---------------------------------------------------------------------------
-- Generated gameplay
-- ---------------------------------------------------------------------------

`;

const CLIENT_FALLBACK = `--!strict
-- No client script was generated for this place; the server owns all the rules.
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local event = ReplicatedStorage:WaitForChild("GameEvent")
event.OnClientEvent:Connect(function(...)
\tprint("GameEvent", ...)
end)

local _ = Players.LocalPlayer
`;

/**
 * Emit a `.rbxlx` place.
 *
 * Version 4 of Roblox's XML place format: a `<roblox>` root whose direct children
 * are services, each carrying its instances. Only the property types Studio round
 * -trips without ambiguity are emitted — the fewer serialisations this writes, the
 * fewer ways the file can be rejected, and everything omitted takes its default.
 */
export function rbxlxFromSpec(spec: RobloxGameSpec): string {
  const ref = new ReferentCounter();
  const workspaceRef = ref.take();
  const baseplateRef = ref.take();
  const spawnRef = ref.take();

  const baseplate = [
    `<Item class="Part" referent="${baseplateRef}">`,
    '<Properties>',
    '<bool name="Anchored">true</bool>',
    '<bool name="CanCollide">true</bool>',
    `<Color3uint8 name="Color3uint8">${color3uint8(spec.baseplateColor)}</Color3uint8>`,
    // Centred at y = -2 with a height of 4 puts its TOP face at y = 0, which is
    // the floor every authored part's y coordinate is measured from.
    cframe(0, -2, 0),
    '<string name="Name">Baseplate</string>',
    '<Vector3 name="size"><X>512</X><Y>4</Y><Z>512</Z></Vector3>',
    '</Properties>',
    '</Item>',
  ].join('\n');

  const spawn = [
    `<Item class="SpawnLocation" referent="${spawnRef}">`,
    '<Properties>',
    '<bool name="Anchored">true</bool>',
    '<bool name="CanCollide">true</bool>',
    `<Color3uint8 name="Color3uint8">${color3uint8('#f5f5f5')}</Color3uint8>`,
    cframe(spec.spawnX, spec.spawnY, spec.spawnZ),
    '<int name="Duration">0</int>',
    '<string name="Name">SpawnLocation</string>',
    '<bool name="Neutral">true</bool>',
    '<Vector3 name="size"><X>12</X><Y>1</Y><Z>12</Z></Vector3>',
    '</Properties>',
    '</Item>',
  ].join('\n');

  const parts = spec.parts.map((part) => partItem(part, ref)).join('\n');

  const lightingRef = ref.take();
  const replicatedRef = ref.take();
  const serverServiceRef = ref.take();
  const starterPlayerRef = ref.take();
  const starterScriptsRef = ref.take();

  return `<roblox xmlns:xmime="http://www.w3.org/2005/05/xmlmime" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.roblox.com/roblox.xsd" version="4">
<Item class="Workspace" referent="${workspaceRef}">
<Properties>
<string name="Name">Workspace</string>
<bool name="FilteringEnabled">true</bool>
</Properties>
${baseplate}
${spawn}
${parts}
</Item>
<Item class="Lighting" referent="${lightingRef}">
<Properties>
<string name="Name">Lighting</string>
<float name="ClockTime">14</float>
<bool name="GlobalShadows">true</bool>
</Properties>
</Item>
<Item class="ReplicatedStorage" referent="${replicatedRef}">
<Properties>
<string name="Name">ReplicatedStorage</string>
</Properties>
</Item>
<Item class="ServerScriptService" referent="${serverServiceRef}">
<Properties>
<string name="Name">ServerScriptService</string>
</Properties>
${scriptItem('Script', 'GameServer', SERVER_BOOTSTRAP + spec.serverScript, ref)}
</Item>
<Item class="StarterPlayer" referent="${starterPlayerRef}">
<Properties>
<string name="Name">StarterPlayer</string>
</Properties>
<Item class="StarterPlayerScripts" referent="${starterScriptsRef}">
<Properties>
<string name="Name">StarterPlayerScripts</string>
</Properties>
${scriptItem('LocalScript', 'GameClient', spec.clientScript || CLIENT_FALLBACK, ref)}
</Item>
</Item>
</roblox>
`;
}

/* ---------- the Rojo project, for developing it properly ---------- */

function luauString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * The world as Luau that builds it.
 *
 * Rojo syncs SCRIPTS, not instances — the `.rbxlx` is the double-click artifact,
 * but a Rojo workflow needs the world in code or `rojo build` produces an empty
 * baseplate. Emitting the same parts as a data table means both artifacts
 * describe one world, and the developer can edit the level in a diff.
 */
export function worldBuilderLuau(spec: RobloxGameSpec): string {
  const rows = spec.parts
    .map(
      (part) =>
        `\t{ name = ${luauString(part.name)}, role = ${luauString(part.role)}, `
        + `pos = Vector3.new(${part.x}, ${part.y}, ${part.z}), `
        + `size = Vector3.new(${part.width}, ${part.height}, ${part.depth}), `
        + `color = Color3.fromHex(${luauString(part.color)}), anchored = ${part.anchored} },`,
    )
    .join('\n');

  return `--!strict
-- The world, as data. Built at run time so a Rojo sync produces the same place
-- the .rbxlx does. Edit the table; the level changes.
local CollectionService = game:GetService("CollectionService")

local PARTS = {
${rows}
}

local function build()
\tif workspace:FindFirstChild("GeneratedWorld") then return end

\tlocal folder = Instance.new("Folder")
\tfolder.Name = "GeneratedWorld"
\tfolder.Parent = workspace

\tlocal baseplate = Instance.new("Part")
\tbaseplate.Name = "Baseplate"
\tbaseplate.Anchored = true
\tbaseplate.Size = Vector3.new(512, 4, 512)
\tbaseplate.Position = Vector3.new(0, -2, 0)
\tbaseplate.Color = Color3.fromHex(${luauString(spec.baseplateColor)})
\tbaseplate.Parent = folder

\tlocal spawn = Instance.new("SpawnLocation")
\tspawn.Anchored = true
\tspawn.Neutral = true
\tspawn.Duration = 0
\tspawn.Size = Vector3.new(12, 1, 12)
\tspawn.Position = Vector3.new(${spec.spawnX}, ${spec.spawnY}, ${spec.spawnZ})
\tspawn.Parent = folder

\tfor _, spec in ipairs(PARTS) do
\t\tlocal part = Instance.new("Part")
\t\tpart.Name = spec.name
\t\tpart.Size = spec.size
\t\tpart.Position = spec.pos
\t\tpart.Color = spec.color
\t\tpart.Anchored = spec.anchored
\t\t-- Collectibles and hazards are walked through, not into.
\t\tpart.CanCollide = spec.role ~= "collectible" and spec.role ~= "hazard"
\t\tpart.Parent = folder
\t\tCollectionService:AddTag(part, "bf_" .. spec.role)
\tend
end

build()
`;
}

export function rojoProjectJson(slug: string): string {
  return `${JSON.stringify(
    {
      name: slug,
      tree: {
        $className: 'DataModel',
        Workspace: { $className: 'Workspace', $properties: { FilteringEnabled: true } },
        ReplicatedStorage: { $className: 'ReplicatedStorage' },
        ServerScriptService: {
          $className: 'ServerScriptService',
          // Ordering is not guaranteed between sibling scripts, so the world
          // builder runs from its own script and the gameplay script waits for
          // the tags it needs rather than assuming they are already there.
          World: { $path: 'src/server/World.server.luau' },
          GameServer: { $path: 'src/server/GameServer.server.luau' },
        },
        StarterPlayer: {
          $className: 'StarterPlayer',
          StarterPlayerScripts: {
            $className: 'StarterPlayerScripts',
            GameClient: { $path: 'src/client/GameClient.client.luau' },
          },
        },
      },
    },
    null,
    2,
  )}\n`;
}

/** The server script as Rojo sees it — bootstrap included, same as the place. */
export function serverScriptLuau(spec: RobloxGameSpec): string {
  return SERVER_BOOTSTRAP + spec.serverScript;
}

export function clientScriptLuau(spec: RobloxGameSpec): string {
  return spec.clientScript || CLIENT_FALLBACK;
}
