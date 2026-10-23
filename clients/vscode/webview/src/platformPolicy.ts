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
