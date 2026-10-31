/**
 * The web and Rovr hosts' opt-in to the one agent (PRD 35 WS4): `builderforce.runEngine` in
 * `localStorage`, or `?runEngine=agent` on the page URL, which stores it. ONE reader for both
 * hosts, read once at each host's request site and carried on `BrainRunRequest.engine`. It
 * selects the engine and nothing else; it goes away when the ship gate flips the default.
 * Storage can be blocked or absent (a private window, a worker), so every touch is guarded.
 */

import type { RunEngineId } from './runTypes';

/** The `localStorage` key and URL parameter that carry the choice. */
export const RUN_ENGINE_STORAGE_KEY = 'builderforce.runEngine';
export const RUN_ENGINE_QUERY_PARAM = 'runEngine';

const isEngine = (value: unknown): value is RunEngineId => value === 'agent' || value === 'loop';

/** Keep the URL's choice for later loads. False when storage is blocked: the URL still decides this load. */
function keepChoice(storage: Storage | undefined, engine: RunEngineId): boolean {
  try {
    storage?.setItem(RUN_ENGINE_STORAGE_KEY, engine);
    return storage !== undefined;
  } catch {
    return false;
  }
}

/** The device's stored engine choice, or undefined when it never made one (⇒ the Brain's default). */
export function storedRunEngine(): RunEngineId | undefined {
  try {
    const search = (globalThis as { location?: { search?: string } }).location?.search;
    const fromUrl = search ? new URLSearchParams(search).get(RUN_ENGINE_QUERY_PARAM) : null;
    const storage = (globalThis as { localStorage?: Storage }).localStorage;
    if (isEngine(fromUrl)) {
      keepChoice(storage, fromUrl);
      return fromUrl;
    }
    const stored = storage?.getItem(RUN_ENGINE_STORAGE_KEY);
    return isEngine(stored) ? stored : undefined;
  } catch {
    return undefined;
  }
}

/** The request fragment a host spreads into its run request: the stored engine, or nothing. */
export function storedRunEngineField(): { engine: RunEngineId } | Record<string, never> {
  const engine = storedRunEngine();
  return engine ? { engine } : {};
}
