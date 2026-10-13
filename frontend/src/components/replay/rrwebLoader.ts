/**
 * The ONE door to rrweb in the frontend (PRD 33 D1, D5). rrweb is not a
 * frontend dependency: the replay-sdk publishes rrweb's `Replayer` as a
 * hashed CDN bundle named in `replay/manifest.json` (`player`), so the
 * recorder and the player always run the same pinned rrweb and no page
 * carries it until a recording is opened. Tests replace this module.
 */
import {
  REPLAY_CDN_ORIGIN,
  REPLAY_MANIFEST_PATH,
  REPLAY_PLAYER_GLOBAL,
  type ReplayManifest,
} from '@builderforce/interaction-contract';
import { getOrSetClientCached } from '@/infrastructure/http/readThrough';

/** The slice of rrweb's `Replayer` the player uses. */
export interface ReplayerLike {
  play(timeOffset?: number): void;
  pause(timeOffset?: number): void;
  setConfig(config: { speed?: number; skipInactive?: boolean }): void;
  getCurrentTime(): number;
  getMetaData(): { startTime: number; endTime: number; totalTime: number };
  addEvent(event: unknown): void;
  on(event: string, handler: () => void): unknown;
  destroy(): void;
}

export interface ReplayerOptions {
  speed: number;
  skipInactive: boolean;
}

type ReplayerCtor = new (events: unknown[], config: Record<string, unknown>) => ReplayerLike;

/** Manifest freshness matches its CDN cache class (max-age 60). */
const MANIFEST_TTL_MS = 60_000;

function loadManifestPlayer(): Promise<NonNullable<ReplayManifest['player']>> {
  return getOrSetClientCached(
    'replay:player-manifest',
    async (signal) => {
      const res = await fetch(`${REPLAY_CDN_ORIGIN}${REPLAY_MANIFEST_PATH}`, { credentials: 'omit', signal });
      if (!res.ok) throw new Error(`replay manifest ${res.status}`);
      const manifest = (await res.json()) as ReplayManifest;
      if (!manifest.player?.url) throw new Error('replay manifest has no player');
      return manifest.player;
    },
    { ttlMs: MANIFEST_TTL_MS },
  );
}

function appendOnce(tag: 'script' | 'link', url: string): Promise<void> {
  const selector = tag === 'script' ? `script[src="${url}"]` : `link[href="${url}"]`;
  if (document.head.querySelector(selector)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const el = document.createElement(tag);
    if (el instanceof HTMLScriptElement) {
      el.async = true;
      el.src = url;
    } else if (el instanceof HTMLLinkElement) {
      el.rel = 'stylesheet';
      el.href = url;
    }
    el.addEventListener('load', () => resolve(), { once: true });
    el.addEventListener('error', () => reject(new Error(`failed to load ${url}`)), { once: true });
    document.head.appendChild(el);
  });
}

/** Resolves rrweb's Replayer from the CDN bundle, loading it at most once per URL. */
function loadReplayer(): Promise<ReplayerCtor> {
  return getOrSetClientCached('replay:player-bundle', async () => {
    const player = await loadManifestPlayer();
    await Promise.all([appendOnce('link', player.cssUrl), appendOnce('script', player.url)]);
    const bundle = (window as unknown as Record<string, { Replayer?: ReplayerCtor } | undefined>)[REPLAY_PLAYER_GLOBAL];
    if (!bundle?.Replayer) throw new Error('replay player bundle did not register');
    return bundle.Replayer;
  });
}

export async function createReplayer(events: unknown[], root: HTMLElement, options: ReplayerOptions): Promise<ReplayerLike> {
  const Replayer = await loadReplayer();
  return new Replayer(events, {
    root,
    speed: options.speed,
    skipInactive: options.skipInactive,
    mouseTail: false,
    showWarning: false,
    // Canvas frames are captured as images when the site enables recordCanvas (D10).
    UNSAFE_replayCanvas: true,
  });
}
