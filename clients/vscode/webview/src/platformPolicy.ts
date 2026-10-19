import {
  createGuardedPlatformFetch,
  createPlatformPolicy,
  type PlatformCapability,
  type PlatformPolicySnapshot,
  type PlatformRequestRecord,
} from '@builderforce/local-first';
import { handleFrame } from './bridgeTransport';
import { onInit } from './bridgeState';

/**
 * The webview realm's copy of the host policy. It is not a second policy: the host
 * (`webviewHostBridge`) pushes its snapshot, and a request is classified with the same
 * rules as `platformCapabilityFor` in `clients/vscode/src/platformPolicy.ts`.
 */
const policy = createPlatformPolicy();
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
  baseUrl?: string;
  webUrl?: string;
}): void {
  rememberOrigin(frame.baseUrl);
  rememberOrigin(frame.webUrl);
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

function capabilityFor(url: URL, method: string): PlatformCapability | null {
  if (!origins.has(url.origin)) return null;
  if (url.pathname.includes('/api/auth/') || url.pathname.endsWith('/token')) return 'authenticate';
  if (url.pathname.includes('/chat/completions')) return 'gateway-inference';
  const normalized = method.toUpperCase();
  return normalized === 'GET' || normalized === 'HEAD' ? 'connected-feature' : 'synchronize';
}

export function installWebviewPlatformPolicy(): void {
  if (installed) return;
  installed = true;
  const nativeFetch = globalThis.fetch.bind(globalThis);
  const guarded = createGuardedPlatformFetch({
    policy,
    fetch: (input, init) => nativeFetch(input, init),
    onRequest(record) {
      requests.push(record);
      if (requests.length > 1_000) requests.splice(0, requests.length - 1_000);
    },
  });
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const parsed = asHttpUrl(raw);
    if (!parsed) return nativeFetch(input, init);
    const capability = capabilityFor(parsed, init?.method ?? (input instanceof Request ? input.method : 'GET'));
    if (!capability) return nativeFetch(input, init);
    return guarded(raw, { ...init, redirect: 'error' }, capability);
  }) as typeof fetch;

  const NativeWebSocket = globalThis.WebSocket;
  if (NativeWebSocket) {
    globalThis.WebSocket = class extends NativeWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        const parsed = asHttpUrl(typeof url === 'string' ? url : url.toString());
        if (parsed) {
          const capability = capabilityFor(parsed, 'GET');
          // Throw before super() so a denied platform socket is never opened.
          if (capability) policy.assert(capability);
        }
        super(url, protocols);
      }
    };
  }

  onInit((init) => {
    applyWebviewPlatformPolicy({ platformPolicy: init.platformPolicy, baseUrl: init.baseUrl });
  });
  handleFrame('platform.policy', (frame) => {
    applyWebviewPlatformPolicy(frame as { platformPolicy?: Partial<PlatformPolicySnapshot>; baseUrl?: string; webUrl?: string });
  });
}
