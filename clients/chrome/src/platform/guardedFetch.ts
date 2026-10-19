/**
 * Rovr's GATED platform `fetch` — the service worker's half of what
 * `bindPlatformPolicy` (`clients/vscode/src/platformPolicy.ts`) does for the VS Code host.
 *
 * Two rules, both taken from there rather than reinvented:
 *
 *   1. CLASSIFY. A request to a BuilderForce origin is sorted into a capability — the
 *      token exchange is `authenticate`, a gateway completion is `gateway-inference`, a
 *      read is `connected-feature`, and any other write is `synchronize` (the shared
 *      decision rules live in `@builderforce/local-first`, whose `PlatformCapability` is
 *      the same type this codebase passes around).
 *   2. REFUSE. The decision is the persisted `policy.*` snapshot (see `./policy.ts`), so a
 *      fresh install — no keys — answers none of it: the denied capability throws
 *      `PlatformAccessDenied` WITHOUT calling `fetch`. An allowed request goes out with
 *      `redirect: 'error'`, so a BuilderForce URL can never be chased to somewhere the
 *      classifier never looked.
 *
 * A request to any OTHER origin is PASS-THROUGH and never classified: on-device loopback
 * inference (Ollama, WebGPU `bfi`) and a provider Rovr calls directly from this browser are
 * not the platform, and the platform policy does not speak for them.
 */
import {
  createGuardedPlatformFetch,
  type PlatformCapability,
  type PlatformPolicy,
  type PlatformRequestRecord,
} from '@builderforce/local-first';
import { PLATFORM_ORIGINS } from '../config';

const PLATFORM_ORIGIN_SET: ReadonlySet<string> = new Set<string>(PLATFORM_ORIGINS);

const requestUrl = (input: string | URL | Request): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

const requestMethod = (input: string | URL | Request, init?: RequestInit): string =>
  (init?.method ?? (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET')).toUpperCase();

/**
 * The capability a request to the platform needs, or `null` when the request is not a
 * platform request at all (any origin outside {@link PLATFORM_ORIGINS}) and so is passed
 * through ungated. Mirrors `platformCapabilityFor` in the VS Code host, minus the
 * configured-origin lookup: Rovr's origins are fixed in `config.ts`.
 */
export function platformCapabilityFor(
  input: string | URL | Request,
  init?: RequestInit,
): PlatformCapability | null {
  let url: URL;
  try {
    url = new URL(requestUrl(input));
  } catch {
    return null;
  }
  if (!PLATFORM_ORIGIN_SET.has(url.origin)) return null;
  if (url.pathname.includes('/api/auth/') || url.pathname.endsWith('/token')) return 'authenticate';
  if (url.pathname.includes('/chat/completions')) return 'gateway-inference';
  const method = requestMethod(input, init);
  return method === 'GET' || method === 'HEAD' ? 'connected-feature' : 'synchronize';
}

/**
 * The worker's platform `fetch`, classified and gated. `onRequest` is where a denied call
 * becomes visible — the log line is what makes "API denied" legible instead of silent.
 */
export function createRovrGuardedFetch(options: {
  policy: PlatformPolicy;
  onRequest?(record: PlatformRequestRecord): void;
}): (input: string, init?: RequestInit) => Promise<Response> {
  const guarded = createGuardedPlatformFetch({
    policy: options.policy,
    fetch: (input, init) => fetch(input, init),
    ...(options.onRequest ? { onRequest: options.onRequest } : {}),
  });
  return (input, init) => {
    const capability = platformCapabilityFor(input, init);
    // Not the platform: pass it straight through, untouched and unclassified.
    if (capability === null) return fetch(input, init);
    return guarded(input, { ...init, redirect: 'error' }, capability);
  };
}