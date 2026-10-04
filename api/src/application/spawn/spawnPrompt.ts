/**
 * What the Spawn builder model is told, and how a player's place is shown to it.
 *
 * The place arrives from the Spawn Studio plugin as a snapshot: the Explorer tree
 * (paths and classes), the scripts a build may need to read, and the errors the
 * last play-test printed. Everything here is bounded before it reaches the model —
 * a place is unbounded, a prompt is not — and the bounds are the reason a large
 * game still builds instead of failing on context.
 */
import { SPAWN_ROOTS, MAX_OPS } from './spawnOps';

const MAX_PROMPT_CHARS = 4_000;
const MAX_TREE_CHARS = 24_000;
const MAX_SCRIPTS_CHARS = 60_000;
const MAX_SCRIPT_CHARS = 12_000;
const MAX_ERRORS = 20;
const MAX_ERROR_CHARS = 600;
const MAX_HISTORY = 8;
const MAX_HISTORY_CHARS = 1_500;

export interface SpawnPlaceScript {
  path: string;
  kind: string;
  source: string;
}

export interface SpawnPlaceSnapshot {
  /** The Explorer tree, one `path [Class]` per line, as the plugin lists it. */
  tree: string;
  scripts: SpawnPlaceScript[];
  /** Errors and warnings from the last play-test's Output. */
  errors: string[];
}

export interface SpawnTurn {
  role: 'player' | 'spawn';
  text: string;
}

export interface SpawnBuildRequest {
  prompt: string;
  place: SpawnPlaceSnapshot;
  history: SpawnTurn[];
}

const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');

/** Bound everything the plugin sent. Never throws: a malformed field is an empty one. */
export function readBuildRequest(body: unknown): SpawnBuildRequest {
  const raw = (body ?? {}) as Record<string, unknown>;
  const place = (raw.place ?? {}) as Record<string, unknown>;

  let budget = MAX_SCRIPTS_CHARS;
  const scripts: SpawnPlaceScript[] = [];
  for (const entry of Array.isArray(place.scripts) ? place.scripts : []) {
    const s = entry as Record<string, unknown>;
    const source = text(s.source, Math.min(MAX_SCRIPT_CHARS, budget));
    if (!source) continue;
    budget -= source.length;
    scripts.push({ path: text(s.path, 300), kind: text(s.kind, 20), source });
    if (budget <= 0) break;
  }

  const history: SpawnTurn[] = (Array.isArray(raw.history) ? raw.history : [])
    .slice(-MAX_HISTORY)
    .map((t) => {
      const turn = t as Record<string, unknown>;
      return { role: turn.role === 'spawn' ? 'spawn' : 'player', text: text(turn.text, MAX_HISTORY_CHARS) } as SpawnTurn;
    })
    .filter((t) => t.text);

  return {
    prompt: text(raw.prompt, MAX_PROMPT_CHARS).trim(),
    place: {
      tree: text(place.tree, MAX_TREE_CHARS),
      scripts,
      errors: (Array.isArray(place.errors) ? place.errors : []).slice(-MAX_ERRORS).map((e) => text(e, MAX_ERROR_CHARS)).filter(Boolean),
    },
    history,
  };
}

export const SPAWN_SYSTEM_PROMPT = [
  'You are Spawn, a friendly expert Roblox developer helping a young creator (13+) build their own Roblox game in Roblox Studio.',
  'You change their place by returning OPERATIONS that a Studio plugin applies inside one undo step. You see their current place below.',
  '',
  'Reply with ONE JSON object and nothing else:',
  '{ "reply": string, "refused": boolean, "ops": Operation[], "next": string[] }',
  '- reply: 1-4 short, encouraging sentences saying what you built and how to try it (press Play). Plain words, no jargon dumps.',
  '- next: 2-3 short ideas for what they could ask for next.',
  `- ops: at most ${MAX_OPS} operations, applied in order. Three kinds:`,
  '  { "op": "script", "path": "ServerScriptService/CoinSystem", "kind": "Script" | "LocalScript" | "ModuleScript", "source": "<full Luau source>" }',
  '     Creates the script or REPLACES its whole source. Always send the complete file, never a fragment.',
  '  { "op": "instance", "path": "Workspace/Obby/Stage1", "className": "Part", "properties": { ... } }',
  '     Creates the instance, or updates its properties if it already exists. Missing parent folders are created as Folders.',
  '  { "op": "delete", "path": "Workspace/OldThing" }',
  `- A path starts with one of: ${SPAWN_ROOTS.join(', ')}. LocalScripts for the player go under StarterPlayer/StarterPlayerScripts or StarterGui/<ScreenGui>; server Scripts under ServerScriptService; shared ModuleScripts under ReplicatedStorage.`,
  '- Property values: strings, numbers and booleans as JSON; typed values as one-key objects:',
  '  {"Vector3":[x,y,z]} {"Vector2":[x,y]} {"Color3":"#rrggbb"} {"UDim2":[xScale,xOffset,yScale,yOffset]} {"UDim":[scale,offset]}',
  '  {"CFrame":[x,y,z]} or {"CFrame":[x,y,z,rxDeg,ryDeg,rzDeg]} {"Enum":"Material.Neon"} {"NumberRange":[min,max]}',
  '  {"ColorSequence":["#rrggbb",...]} {"NumberSequence":[n,...]}',
  '',
  'Build REAL, playable Roblox:',
  '- Use modern Luau and current Roblox APIs only (task.wait/task.spawn, not wait/spawn; GetPropertyChangedSignal; Players.PlayerAdded with existing players handled).',
  '- Server owns the rules (scores, damage, rewards, saving); clients own UI and input; they talk through RemoteEvents you create under ReplicatedStorage. Validate everything a client sends.',
  '- Leaderboards use a "leaderstats" Folder under the player. Saving uses DataStoreService with pcall, and only from the server.',
  '- Parts in the world are Anchored unless they must move. Y is up; a player is about 5 studs tall and jumps about 7 studs.',
  '- Reuse what is already in the place: read the tree and scripts below and change them instead of making duplicates. Fix errors from the last play-test when you see them.',
  '- Keep each script focused on one job. Name things clearly so the creator can find them in the Explorer.',
  '',
  'You may NOT (the plugin refuses these, so never write them):',
  '- use HttpService, loadstring, getfenv/setfenv, or require() an asset id;',
  '- reference any asset id (rbxassetid://, Image, SoundId, MeshId, TextureId, AnimationId). Build visuals from parts, colours, materials, lights, particles and UI instead.',
  '',
  'Keep it right for players 13+, following the Roblox Community Standards:',
  '- No gore, realistic weapons aimed at people, sexual or romantic content, dating, drugs, alcohol, real-money gambling, hate, bullying, self-harm, or scary content beyond mild spooky fun. Cartoon combat (blasters, swords, tag, knock-backs) is fine.',
  '- Never build anything that collects personal information, links off Roblox, promises free Robux, or imitates a real brand or person.',
  'If a request crosses these lines, set "refused": true, return no ops, and in "reply" kindly suggest a fun version that is okay.',
].join('\n');

/** The user turn: the request, the conversation so far, and the place as it is now. */
export function renderBuildUserMessage(request: SpawnBuildRequest): string {
  const parts: string[] = [];
  if (request.history.length) {
    parts.push('## Conversation so far');
    for (const turn of request.history) parts.push(`${turn.role === 'player' ? 'Creator' : 'Spawn'}: ${turn.text}`);
    parts.push('');
  }
  parts.push('## The place right now', request.place.tree || '(an empty Baseplate)', '');
  if (request.place.scripts.length) {
    parts.push('## Scripts');
    for (const s of request.place.scripts) parts.push(`### ${s.path} (${s.kind})`, '```lua', s.source, '```');
    parts.push('');
  }
  if (request.place.errors.length) {
    parts.push('## Errors from the last play-test', ...request.place.errors.map((e) => `- ${e}`), '');
  }
  parts.push('## What the creator asks', request.prompt);
  return parts.join('\n');
}
