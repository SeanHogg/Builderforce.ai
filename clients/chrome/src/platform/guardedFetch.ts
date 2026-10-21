/**
 * Rovr's GATED platform `fetch` — the service worker's half of what
 * `bindPlatformPolicy` (`clients/vscode/src/platformPolicy.ts`) does for the VS Code host.
 *
 * Two rules, both taken from there rather than reinvented:
 *
 *   1. CLASSIFY. A request to a BuilderForce origin is sorted into a capability by the
 *      shared route table (`@builderforce/local-first` `PLATFORM_ROUTE_RULES`): the token
 *      exchange is `authenticate`, a gateway completion is `gateway-inference`, a read —
 *      including the read-style POSTs (personality block, recall, search, the model
 *      catalog) — is `connected-feature`, and any other write is `synchronize`.
 *   2. REFUSE. The decision is the mode-derived snapshot (see `./policy.ts`), so a
 *      fresh, signed-out install answers none of it: the denied capability throws
 *      `PlatformAccessDenied` WITHOUT calling `fetch`. An allowed request goes out with
 *      `redirect: 'error'`, so a BuilderForce URL can never be chased to somewhere the
 *      classifier never looked.
 *
 * A request to any OTHER origin is PASS-THROUGH and never classified: on-device loopback
 * inference (Ollama, WebGPU `bfi`) and a provider Rovr calls directly from this browser are
 * not the platform, and the platform policy does not speak for them.
 */
import {
  classifyPlatformRequest,
  createGuardedPlatformFetch,
  platformRequestMethod,
  platformRequestUrl,
  type PlatformCapability,
  type PlatformPolicy,
  type PlatformRequestRecord,
} from '@builderforce/local-first';
import { DEFAULT_BASE_URL, PLATFORM_ORIGINS } from '../config';

const PLATFORM_ORIGIN_SET: ReadonlySet<string> = new Set<string>(PLATFORM_ORIGINS);

/** The gateway's mount on the web origin (`/gateway`): the route table names paths as
 *  the API serves them, so the mount is taken off before a path is classified. */
const BASE = new URL(DEFAULT_BASE_URL);
const MOUNT = BASE.pathname.replace(/\/+$/, '');

const apiPath = (url: URL): string =>
  MOUNT && url.origin === BASE.origin && url.pathname.startsWith(`${MOUNT}/`) ? url.pathname.slice(MOUNT.length) : url.pathname;

/**
 * The capability a request to the platform needs, or `null` when the request is not a
 * platform request at all (any origin outside {@link PLATFORM_ORIGINS}) and so is passed
 * through ungated. What a platform PATH means is the shared route table
 * (`classifyPlatformRequest`), the one the VS Code host and the web app read too; only
 * the origins are Rovr's own, fixed in `config.ts`.
 */
export function platformCapabilityFor(
  input: string | URL | Request,
  init?: RequestInit,
): PlatformCapability | null {
  let url: URL;
  try {
    url = new URL(platformRequestUrl(input));
  } catch {
    return null;
  }
  if (!PLATFORM_ORIGIN_SET.has(url.origin)) return null;
  return classifyPlatformRequest(apiPath(url), platformRequestMethod(input, init));
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