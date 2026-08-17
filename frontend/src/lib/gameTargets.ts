/**
 * Game targets, client side — the vocabulary and the calls behind "play this
 * somewhere real".
 *
 * The server owns the target catalogue (`api/src/application/game/gameTarget.ts`);
 * this mirrors its wire shape and nothing else. Target labels and summaries come
 * FROM the server rather than being duplicated here, so adding a sixth target is
 * one adapter and no frontend change — the panel renders whatever it is sent.
 * Only the two things the UI must decide locally are declared here: which icon a
 * device gets, and how a game is read back off a canvas object.
 */

import { robloxScriptsFrom, robloxWorldReading, type RobloxScriptSource, type RobloxWorldReading } from '@builderforce/creation-canvas-contract';
import { apiRequest } from './apiClient';
import type { CreationNodeData } from '@/components/creation-canvas/types';
import { creativeBrief } from './creationDeliverables';

export type GameTargetKey = 'web' | 'pwa' | 'android' | 'ios' | 'roblox';
export type GameDevice = 'browser' | 'phone' | 'roblox';

export interface GameTargetSummary {
  key: GameTargetKey;
  label: string;
  summary: string;
  zeroSetup: boolean;
  device: GameDevice;
}

export interface GameSetupStep {
  key: string;
  label: string;
  detail: string;
  url?: string;
  blocking: boolean;
}

export interface GameTargetState {
  target: GameTargetKey;
  slug: string;
  title: string;
  status: string;
  directory: string;
  fileCount: number;
  playUrl: string | null;
  detail: string | null;
  setupSteps: GameSetupStep[];
  robloxUniverseId: string | null;
  robloxPlaceId: string | null;
  robloxVersion: number | null;
  lastPublishedAt: string | null;
  updatedAt: string | null;
}

export interface GameCredential {
  name: string;
  label: string;
  detail: string;
  url?: string;
  present: boolean;
}

export interface GameTargetsView {
  targets: GameTargetSummary[];
  states: GameTargetState[];
  credentials: { roblox: GameCredential[]; ios: GameCredential[] };
}

/** The payload every write takes: the game as it is on screen right now. */
export interface GamePayload {
  title: string;
  brief: string;
  html: string;
}

const base = (projectId: number) => `/api/projects/${projectId}/game`;

const post = <T>(path: string, body: unknown): Promise<T> =>
  apiRequest<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

export const gameApi = {
  get: (projectId: number) => apiRequest<GameTargetsView>(base(projectId)),

  materialize: (projectId: number, target: GameTargetKey, game: GamePayload) =>
    post<{ state: GameTargetState; files: string[] }>(`${base(projectId)}/targets/${target}`, game),

  publish: (projectId: number, game: GamePayload, subdomain?: string) =>
    post<{ url: string; state: GameTargetState }>(`${base(projectId)}/publish`, { ...game, subdomain }),

  publishToRoblox: (projectId: number, game: GamePayload, universeId: string, placeId: string) =>
    post<{ placeUrl: string; versionNumber: number; state: GameTargetState }>(
      `${base(projectId)}/roblox/publish`,
      { ...game, universeId, placeId },
    ),

  setRobloxTarget: (projectId: number, slug: string, universeId: string, placeId: string) =>
    apiRequest<{ ok: true }>(`${base(projectId)}/roblox/target`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, universeId, placeId }),
    }),
};

/**
 * The game document a canvas object is currently holding.
 *
 * A generated game is stored as a `data:text/html` URL on the object, so reading
 * it back is a decode rather than a fetch — which matters, because this runs on
 * a click and a fetch would put an await between the gesture and the window that
 * opens from it. Returns an empty string when the object has no game yet, which
 * every caller treats as "generate it first".
 */
export function gameDocumentFrom(data: CreationNodeData): string {
  return gameDocumentFromUrl(data.outputUrl);
}

/**
 * The artifact behind a `data:` URL, when its media type is one the caller can
 * use. One decoder, because a game now has TWO artifact shapes — a document and
 * a place — and two decoders is two places for the base64 branch to be wrong.
 *
 * Takes the URL rather than the object so consumers that hold a loose record
 * (the app runtime reads `{ kind, ...unknown }` nodes) share this decode
 * instead of writing a second one against the same field.
 */
function decodeArtifact(value: unknown, accepts: (mime: string) => boolean): string {
  const url = typeof value === 'string' ? value : '';
  const match = /^data:([^,]*),/.exec(url);
  if (!match) return '';
  const parameters = match[1]!.split(';');
  if (!accepts(parameters[0] ?? '')) return '';
  const payload = url.slice(match[0].length);
  try {
    return parameters.includes('base64')
      ? atob(payload)
      : decodeURIComponent(payload);
  } catch {
    return '';
  }
}

/** The HTML behind an object's artifact URL, or `''`. */
export function gameDocumentFromUrl(url: unknown): string {
  return decodeArtifact(url, (mime) => mime.startsWith('text/html'));
}

/**
 * The `.rbxlx` behind an artifact URL, or `''`.
 *
 * Gated on the media type alone, deliberately: `gamePlatform` is a field a card
 * carries and a place is a place whether or not the object remembered to say
 * so. The reader that produces a world out of this rejects anything that is not
 * actually a Roblox document.
 */
export function robloxPlaceFromUrl(url: unknown): string {
  return decodeArtifact(url, (mime) => mime.includes('xml'));
}

/** The `.rbxlx` an object is holding, or `''`. */
export function robloxPlaceFrom(data: CreationNodeData): string {
  return robloxPlaceFromUrl(data.outputUrl);
}

/**
 * The world a game is played in, when the game is a place.
 *
 * A `.rbxlx` cannot run in a browser and never will — but the WORLD in it is
 * exactly what this canvas's own 3D runtime already walks, so a place is
 * playable here as the level it is. What it is NOT is the Luau: the rules live
 * in a server-authoritative engine we are not running, which is why the surface
 * that mounts this says so rather than implying the scripts are live.
 */
export function gameWorldFrom(data: CreationNodeData): RobloxWorldReading | null {
  const place = robloxPlaceFrom(data);
  return place ? robloxWorldReading(place) : null;
}

/** The Luau a place carries, for the surfaces that read source. */
export function gameScriptsFrom(data: CreationNodeData): RobloxScriptSource[] {
  const place = robloxPlaceFrom(data);
  return place ? robloxScriptsFrom(place) : [];
}

/**
 * WHICH runtime plays this game — the single answer every play surface, node
 * body and empty state reads.
 *
 * This is the fix for the bug that shipped: `gameDocumentFrom` returning `''`
 * was treated as "there is no game", which is true for a web game with nothing
 * generated and false for a Roblox place, so a real artifact reported itself
 * missing. Runtime and emptiness are two questions, and they are asked
 * separately now.
 */
export type GameRuntime = 'frame' | 'world';

export function gameRuntimeFor(data: CreationNodeData): GameRuntime | null {
  if (gameDocumentFrom(data)) return 'frame';
  if (gameWorldFrom(data)) return 'world';
  return null;
}

/** Everything a target call needs, read off the object the user is looking at. */
export function gamePayloadFrom(data: CreationNodeData): GamePayload | null {
  const html = gameDocumentFrom(data);
  if (!html) return null;
  return {
    title: String(data.title ?? 'Game'),
    brief: creativeBrief(data),
    html,
  };
}

/**
 * A URL a sandboxed frame can load.
 *
 * `srcDoc` is used rather than a blob URL: a blob inherits the creating page's
 * origin, and combining that with `allow-scripts` would give model-authored code
 * same-origin access to the app. See `GameBody` for the full reasoning — this
 * helper exists so the decision is made once.
 */
export const GAME_FRAME_SANDBOX = 'allow-scripts allow-pointer-lock';

/** Which glyph a device reads as. Local because it is presentation, not contract. */
export const GAME_DEVICE_ICON: Record<GameDevice, string> = {
  browser: '▶',
  phone: '▢',
  roblox: '◈',
};
