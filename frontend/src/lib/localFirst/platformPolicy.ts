/**
 * The web app's platform policy — the explicit answer to "may this page talk to
 * BuilderForce right now?", per capability, for the local-first architecture
 * (docs/design/vsix-offline-first-architecture-review.md, G01/G02/G12).
 *
 * The policy object itself is the shared `@builderforce/local-first` one with its
 * API-denied default: every capability starts REFUSED and only an explicit grant
 * opens it. What this module adds is the web composition:
 *
 *   - BOOTSTRAP. There is NO composition-time grant. A profile with no stored
 *     choice boots to the shared `LOCAL_FIRST_POLICY` — every capability
 *     REFUSED — and the only way one opens is the person's explicit choice:
 *     `grantWebPlatformCapabilities`, and for sync of durable local work the
 *     `connectAccountSync` action. Internet connectivity and a sign-in grant
 *     NOTHING; a stored explicit choice is the only thing that survives a
 *     reload. (There used to be a `WEB_CONNECTED_GRANTS` constant the boot path
 *     fell back to — authenticate, connected features, gateway inference, model
 *     downloads — which made the default permissive for exactly the people who
 *     had never chosen, so G01 was false on the web however `bootWebPlatformPolicy`
 *     was called. It is gone rather than merely unused: the architecture says the
 *     default is denied, and a named grant list beside the default is an
 *     invitation to reinstate it.)
 *   - ENFORCEMENT. `webPlatformFetch` is the guarded transport for platform
 *     requests the local-first surface issues (sync push/pull). A denied
 *     capability is BLOCKED BEFORE the request is attempted — the underlying
 *     fetch is never called — and every decision, attempted or blocked, is
 *     recorded for the request account.
 *   - DISCONNECT. `disconnectWebPlatform` revokes every grant and aborts the
 *     requests this module has in flight. Queued local work is untouched: it is
 *     in the durable store, not here.
 *
 * Grants are the person's explicit choices, persisted (`bf_platform_policy_v1`)
 * and mirrored across tabs through the storage event, so Disconnect in one tab
 * is Disconnect in all of them. Identity is never inferred from whichever
 * session happens to be stored — this module reads no tokens.
 */

import {
  LOCAL_FIRST_POLICY,
  PlatformAccessDenied,
  createGuardedPlatformFetch,
  createPlatformPolicy,
  platformSendPermission,
  type MutablePlatformPolicy,
  type PlatformCapability,
  type PlatformPolicySnapshot,
  type PlatformRequestRecord,
} from '@builderforce/local-first';
import { API_ORIGIN } from '../apiOrigin';
import { readLocal, removeLocal, writeLocal } from '../storage';

export const WEB_PLATFORM_POLICY_STORAGE_KEY = 'bf_platform_policy_v1';

/**
 * THE DENIED DEFAULT (G01) — every capability starts REFUSED, on every surface.
 *
 * A profile that has never been asked boots to this: no grant is applied at
 * composition time, and none of the states that are not a person's decision —
 * a live network, a signed-in session, a reachable API — opens one. Only
 * `grantWebPlatformCapabilities` does, and its result is what a reload restores.
 *
 * This was the web's `WEB_CONNECTED_GRANTS` — authenticate, connected features,
 * gateway inference, model downloads — which the boot path applied as a fallback
 * when storage held no choice. It is deleted rather than left unused: a named
 * permissive list sitting beside the denied default reads, months later, as
 * "these are the ones we decided are fine", which is exactly the decision G01
 * says nobody has made.
 */
const DENIED_DEFAULT: Readonly<Partial<PlatformPolicySnapshot>> = Object.freeze(LOCAL_FIRST_POLICY);

const GRANTABLE: readonly (keyof PlatformPolicySnapshot)[] = [
  'synchronize',
  'gatewayInference',
  'connectedFeatures',
  'authenticate',
  'modelDownloads',
  'directProviders',
  'externalMcp',
  'gitRemotes',
];

const policy: MutablePlatformPolicy = createPlatformPolicy();

/** Bounded ring of recent decisions — the runtime request account (G27). */
const requests: PlatformRequestRecord[] = [];
const totals = { attempted: 0, blocked: 0 };
const REQUEST_RING = 1_000;

function recordRequest(record: PlatformRequestRecord): void {
  totals[record.outcome] += 1;
  requests.push(record);
  if (requests.length > REQUEST_RING) requests.splice(0, requests.length - REQUEST_RING);
}

export function webPlatformPolicy(): MutablePlatformPolicy {
  return policy;
}

/** Attempted/blocked counts plus the recent decisions, for diagnostics and tests. */
export function webPlatformRequestAccount(): { attempted: number; blocked: number; recent: readonly PlatformRequestRecord[] } {
  return { ...totals, recent: [...requests] };
}

/** Test hook: reset the accounting without touching the policy itself. */
export function resetWebPlatformRequestAccount(): void {
  totals.attempted = 0;
  totals.blocked = 0;
  requests.length = 0;
}

/**
 * The origins classified as platform traffic: the platform API, plus the origin
 * that served this bundle.
 *
 * The page origin IS here, deliberately. It is not a claim that the host running
 * the app is the platform — it is that a same-origin request is this app talking
 * to its own backend. The web app's sync endpoints are served from the page
 * origin, so a relative `/api/sync/push` resolves there and must still pass the
 * gate. Dropping it would not merely mis-label those calls: `webPlatformFetch`
 * reads a null classification as "not the platform's business" and skips the
 * check entirely, so every relative sync POST would sail past a denied policy
 * — the exact bypass the review calls out at L252 ("a direct `fetch` that is not
 * a platform-origin request … is unaffected").
 *
 * This is why the page origin is scoped to membership rather than used as a
 * blanket claim: a genuinely third-party host (a CDN, a direct model provider) is
 * still a different origin and still classifies as null.
 */
function platformOrigins(): Set<string> {
  const origins = new Set<string>([API_ORIGIN]);
  if (typeof window !== 'undefined') origins.add(window.location.origin);
  return origins;
}

/**
 * The capability a request to the platform exercises, or null for a request that
 * is not the platform's (a CDN, a direct provider, a model registry — those carry
 * their own declared policies and are not judged here). Mirrors the VSIX host's
 * classifier so one URL means the same capability in every modality.
 */
export function webPlatformCapabilityFor(input: string | URL, init?: RequestInit): PlatformCapability | null {
  let url: URL;
  try {
    url = new URL(typeof input === 'string' ? input : input.toString(), typeof window === 'undefined' ? API_ORIGIN : window.location.origin);
  } catch {
    return null;
  }
  if (!platformOrigins().has(url.origin)) return null;
  if (url.pathname.includes('/api/auth/') || url.pathname.endsWith('/token')) return 'authenticate';
  if (url.pathname.includes('/chat/completions')) return 'gateway-inference';
  const method = (init?.method ?? 'GET').toUpperCase();
  return method === 'GET' || method === 'HEAD' ? 'connected-feature' : 'synchronize';
}

const inFlight = new Set<AbortController>();

const guarded = createGuardedPlatformFetch({
  policy,
  fetch: (input, init) => {
    const controller = new AbortController();
    inFlight.add(controller);
    return globalThis.fetch(input, { ...init, signal: init?.signal ?? controller.signal })
      .finally(() => inFlight.delete(controller));
  },
  onRequest: recordRequest,
});

/**
 * The guarded platform transport. A denied capability rejects with
 * {@link PlatformAccessDenied} BEFORE any request is attempted; the block is
 * recorded either way. This is the only fetch the local-first sync surface uses.
 */
export function webPlatformFetch(
  input: string,
  init?: RequestInit,
  capability?: PlatformCapability,
): Promise<Response> {
  return guarded(input, init, capability ?? webPlatformCapabilityFor(input, init) ?? 'connected-feature');
}

// ---------------------------------------------------------------------------
// Explicit grants — the only way a capability opens
// ---------------------------------------------------------------------------

function readStoredGrants(): Partial<PlatformPolicySnapshot> | null {
  const raw = readLocal(WEB_PLATFORM_POLICY_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PlatformPolicySnapshot>;
    const grants: Partial<PlatformPolicySnapshot> = {};
    for (const key of GRANTABLE) {
      if (typeof parsed[key] === 'boolean') grants[key] = parsed[key];
    }
    return grants;
  } catch {
    return null;
  }
}

function persistGrants(): void {
  const snapshot = policy.snapshot();
  const grants: Partial<PlatformPolicySnapshot> = {};
  for (const key of GRANTABLE) grants[key] = snapshot[key];
  writeLocal(WEB_PLATFORM_POLICY_STORAGE_KEY, JSON.stringify(grants));
}

/** Apply an explicit choice and remember it. The only writer of the stored grants. */
export function grantWebPlatformCapabilities(patch: Partial<PlatformPolicySnapshot>): void {
  policy.set(patch);
  persistGrants();
}

/** The explicit Connect action: this browser may synchronize local work with the account. */
export function connectAccountSync(): void {
  grantWebPlatformCapabilities({ synchronize: true });
}

/**
 * Disconnect: every capability revoked, in-flight requests aborted, the stored
 * grants erased. Queued local work is untouched — it is in the durable store,
 * not here — and a later Connect resumes it.
 */
export function disconnectWebPlatform(): void {
  for (const controller of [...inFlight]) controller.abort();
  const denied = Object.fromEntries(GRANTABLE.map((key) => [key, false])) as Partial<PlatformPolicySnapshot>;
  policy.set(denied);
  removeLocal(WEB_PLATFORM_POLICY_STORAGE_KEY);
}

/** The absolute send gate for sync transports and outboxes (G12). */
export const webPlatformSendPermission = platformSendPermission(policy);

// ---------------------------------------------------------------------------
// Bootstrap — once per page, free of module-load side effects for SSR
// ---------------------------------------------------------------------------

let booted = false;

/**
 * Boot the policy for this tab: restore the person's explicit choices, or — when
 * they have never been asked — leave every capability REFUSED. Signing in,
 * coming online and mounting this module all grant nothing; `connectAccountSync`
 * and `grantWebPlatformCapabilities` are the only ways a capability opens. Then
 * mirror cross-tab changes, so a Disconnect in one tab is a Disconnect in all.
 */
export function bootWebPlatformPolicy(): void {
  if (booted || typeof window === 'undefined') return;
  booted = true;
  const stored = readStoredGrants();
  policy.set(stored ?? DENIED_DEFAULT);
  window.addEventListener('storage', (event) => {
    if (event.key !== null && event.key !== WEB_PLATFORM_POLICY_STORAGE_KEY) return;
    policy.set(readStoredGrants() ?? DENIED_DEFAULT);
  });
}

/** Test hook: re-arm the bootstrap and return the policy to the API-denied default. */
export function resetWebPlatformPolicyForTests(): void {
  booted = false;
  policy.set(Object.fromEntries(GRANTABLE.map((key) => [key, false])) as Partial<PlatformPolicySnapshot>);
  resetWebPlatformRequestAccount();
}

export { PlatformAccessDenied };
