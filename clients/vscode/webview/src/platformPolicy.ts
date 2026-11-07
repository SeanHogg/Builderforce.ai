import {
  classifyPlatformRequest,
  createGuardedPlatformFetch,
  createPlatformPolicy,
  isInferenceMode,
  PlatformAccessDenied,
  platformRequestRefusal,
  type InferenceMode,
  type PlatformCapability,
  type PlatformPolicySnapshot,
  type PlatformRequestRecord,
} from '@builderforce/local-first';
import { useSyncExternalStore } from 'react';
import { handleFrame } from './bridgeTransport';
import { onInit } from './bridgeState';

/**
 * The webview realm's copy of the host policy. It is not a second policy: the host
 * (`webviewHostBridge`) pushes its snapshot AND its mode, and a request is decided by the
 * SAME shared gate (`platformRequestRefusal`) as the host's global fetch, the web app and
 * Rovr — so a signed-in Hybrid run's writes are not refused here and let through there.
 */
const policy = createPlatformPolicy();
/** Refused (`local-only`) until the host names the mode. */
let mode: InferenceMode = 'local-only';
const requests: PlatformRequestRecord[] = [];
const origins = new Set(['https://builderforce.ai', 'https://api.builderforce.ai']);
let installed = false;

export const webviewPlatformPolicy = () => policy;

/**
 * True when a platform read/write cannot run: the mode is `local-only` (nothing
 * reaches the platform) or the connected-features capability is off. The composer
 * uses this to swap `@`/`#` from server-backed (invited participants / linked
 * tickets) to LOCAL candidates (live sub-agents, persona agents / local tickets)
 * so the typeaheads still answer offline.
 *
 * NOT reactive — for React consumers use {@link useWebviewOffline}, which
 * subscribes to policy pushes. Reading this during render freezes the decision at
 * whatever the policy said on that render, so a `platform.policy` frame that
 * arrives after mount never un-starves the pickers.
 */
export function webviewOffline(): boolean {
  return mode === 'local-only' || !policy.snapshot().connectedFeatures;
}

/** One decision value the reactive hook snapshots — a stable primitive, so the
 *  `useSyncExternalStore` snapshot never changes identity spuriously. */
function offlineSnapshot(): boolean {
  return mode === 'local-only' || !policy.snapshot().connectedFeatures;
}

// ── Reactive offline decision ────────────────────────────────────────────────
// The host pushes a `platform.policy` frame on init and again on every policy
// change. Plain `webviewOffline()` reads mode + snapshot non-reactively, so a
// frame that lands AFTER the composer first rendered left the `@`/`#` pickers
// computed for the stale (default-denied) state — both typeaheads starved at
// once while signed in. Subscribing here makes the decision re-render consumers.

const offlineListeners = new Set<() => void>();

function emitOfflineChanged(): void {
  for (const listener of [...offlineListeners]) listener();
}

function subscribeOffline(listener: () => void): () => void {
  offlineListeners.add(listener);
  return () => offlineListeners.delete(listener);
}

/**
 * The reactive offline decision for React consumers. Re-renders the component the
 * moment a `platform.policy` frame (or the init frame's carried snapshot) flips
 * the mode or the connected-features capability — so the `@`/`#` pickers move
 * from their local fallback to the server-backed roster as soon as the host says
 * the platform is reachable. Prefer this over {@link webviewOffline} in hooks.
 */
export function useWebviewOffline(): boolean {
  return useSyncExternalStore(subscribeOffline, offlineSnapshot, offlineSnapshot);
}

export function webviewPlatformRequestAccount(): { attempted: number; blocked: number; recent: readonly PlatformRequestRecord[] } {
  return {
    attempted: requests.filter((record) => record.outcome === 'attempted').length,
    blocked: requests.filter((record) => record.outcome === 'blocked').length,
    recent: [...requests],
  };
}

function rememberOrigin(value: string | undefined): void {
  if (!value) return;
  try {
    origins.add(new URL(value).origin);
  } catch {
    // An unparseable base URL is not a platform origin. The host settings UI reports it.
  }
}

/** Apply a host snapshot. Missing fields are left as they are; a missing snapshot denies nothing new. */
export function applyWebviewPlatformPolicy(frame: {
  platformPolicy?: Partial<PlatformPolicySnapshot> | null;
  inferenceMode?: unknown;
  baseUrl?: string;
  webUrl?: string;
}): void {
  rememberOrigin(frame.baseUrl);
  rememberOrigin(frame.webUrl);
  if (isInferenceMode(frame.inferenceMode)) mode = frame.inferenceMode;
  if (frame.platformPolicy && typeof frame.platformPolicy === 'object') policy.set(frame.platformPolicy);
  // The mode/snapshot may have flipped the offline decision — wake every `useWebviewOffline`
  // consumer (the `@`/`#` pickers) so a late-arriving frame un-starves them.
  emitOfflineChanged();
}

/** `ws`/`wss` become `http`/`https` so the origin set — which is https — can see the socket. */
function asHttpUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (url.protocol === 'ws:') url.protocol = 'http:';
    else if (url.protocol === 'wss:') url.protocol = 'https:';
    return url;
  } catch {
    return null;
  }
}

/** The capability refusing this request, or null (not the platform, or it may go). */
function refusalFor(url: URL, method: string): PlatformCapability | null {
  if (!origins.has(url.origin)) return null;
  return platformRequestRefusal({ pathname: url.pathname, method }, { mode, snapshot: policy.snapshot() });
}

export function installWebviewPlatformPolicy(): void {
  if (installed) return;
  installed = true;
  const nativeFetch = globalThis.fetch.bind(globalThis);
  const guarded = createGuardedPlatformFetch({
    policy,
    fetch: (input, init) => nativeFetch(input, init),
    decide: (_capability, input, init) => {
      const parsed = asHttpUrl(input);
      return parsed ? refusalFor(parsed, init?.method ?? 'GET') : null;
    },
    onRequest(record) {
      requests.push(record);
      if (requests.length > 1_000) requests.splice(0, requests.length - 1_000);
    },
  });
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const parsed = asHttpUrl(raw);
    if (!parsed) return nativeFetch(input, init);
    if (!origins.has(parsed.origin)) return nativeFetch(input, init);
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    return guarded(raw, { ...init, method, redirect: 'error' }, classifyPlatformRequest(parsed.pathname, method));
  }) as typeof fetch;

  const NativeWebSocket = globalThis.WebSocket;
  if (NativeWebSocket) {
    globalThis.WebSocket = class extends NativeWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        const parsed = asHttpUrl(typeof url === 'string' ? url : url.toString());
        // Throw before super() so a denied platform socket is never opened.
        const refused = parsed ? refusalFor(parsed, 'GET') : null;
        if (refused) throw new PlatformAccessDenied(refused);
        super(url, protocols);
      }
    };
  }

  onInit((init) => {
    applyWebviewPlatformPolicy({ platformPolicy: init.platformPolicy, inferenceMode: init.inferenceMode, baseUrl: init.baseUrl });
  });
  handleFrame('platform.policy', (frame) => {
    applyWebviewPlatformPolicy(frame as { platformPolicy?: Partial<PlatformPolicySnapshot>; inferenceMode?: unknown; baseUrl?: string; webUrl?: string });
  });
}
