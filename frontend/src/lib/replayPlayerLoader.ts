/**
 * Loads rrweb's `Replayer` from the replay-sdk's CDN bundle (PRD 33 D1, D5).
 * rrweb is not a frontend dependency: the replay-sdk publishes the Replayer as
 * a hashed bundle named in `replay/manifest.json` (`player`), so the recorder
 * and the player always run the same pinned rrweb and no page carries it until
 * a recording is opened. The network half lives here (components never
 * `fetch`); `components/replay/rrwebLoader.ts` builds Replayers from it.
 *
 * No Subresource Integrity: `ReplayManifest.player` names the hashed URLs but
 * carries no integrity digests, so there is nothing to put in `integrity=`.
 * The URL hash is the pin; the manifest itself is fetched without credentials.
 */
import {
  REPLAY_CDN_ORIGIN,
  REPLAY_MANIFEST_PATH,
  REPLAY_PLAYER_GLOBAL,
  type ReplayManifest,
} from '@builderforce/interaction-contract';
import { getOrSetClientCached } from '@/infrastructure/http/readThrough';

/** rrweb's `Replayer` constructor as the bundle exposes it (typed by the caller). */
export type ReplayerBundleCtor<T> = new (events: unknown[], config: Record<string, unknown>) => T;

/** Manifest freshness matches its CDN cache class (max-age 60). */
const MANIFEST_TTL_MS = 60_000;

export const REPLAY_MANIFEST_URL = `${REPLAY_CDN_ORIGIN}${REPLAY_MANIFEST_PATH}`;

function loadManifestPlayer(): Promise<NonNullable<ReplayManifest['player']>> {
  return getOrSetClientCached(
    'replay:player-manifest',
    async (signal) => {
      const res = await fetch(REPLAY_MANIFEST_URL, { credentials: 'omit', signal });
      if (!res.ok) throw new Error(`replay manifest ${res.status}`);
      const manifest = (await res.json()) as ReplayManifest;
      if (!manifest.player?.url) throw new Error('replay manifest has no player');
      return manifest.player;
    },
    { ttlMs: MANIFEST_TTL_MS },
  );
}

/** Appends a `<script>` or stylesheet `<link>` once per URL; resolves on load. */
export function appendOnce(tag: 'script' | 'link', url: string): Promise<void> {
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
export function loadReplayerBundle<T>(): Promise<ReplayerBundleCtor<T>> {
  return getOrSetClientCached('replay:player-bundle', async () => {
    const player = await loadManifestPlayer();
    await Promise.all([appendOnce('link', player.cssUrl), appendOnce('script', player.url)]);
    const bundle = (window as unknown as Record<string, { Replayer?: ReplayerBundleCtor<T> } | undefined>)[REPLAY_PLAYER_GLOBAL];
    if (!bundle?.Replayer) throw new Error('replay player bundle did not register');
    return bundle.Replayer;
  });
}
