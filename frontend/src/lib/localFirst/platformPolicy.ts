/**
 * The web app's platform policy — the explicit answer to "may this page talk to
 * BuilderForce right now?", per capability, for the local-first architecture
 * (docs/design/vsix-offline-first-architecture-review.md, G01/G02/G12).
 *
 * The policy object is the shared `@builderforce/local-first` one. What a person
 * sees is ONE choice, the INFERENCE MODE (Local only · Hybrid · Specific), and the
 * capabilities are derived from it by the shared `resolveInferencePolicy`:
 *
 *   - BOOTSTRAP. Signed out and never asked = Local only = the denied default:
 *     every capability REFUSED, nothing leaves for the platform. Signed in and
 *     never asked = Hybrid (gateway inference + connected features; sync per its
 *     own grant), so an existing person's chat, heartbeat and insights keep
 *     working; the composer asks them once, on their first turn, and stores the
 *     answer. Connectivity alone grants nothing. The signed-in fact is THE web's
 *     one definition, `webSignedIn` (a stored web or tenant session — a guest token
 *     is NOT one: an anonymous visitor stays Local only until they choose Hybrid),
 *     read live;
 *     the auth provider calls `refreshWebPlatformPolicy` when its session changes.
 *     This module never reads a token's contents and never sends one.
 *   - ADVANCED OVERRIDES. Per-capability choices stored under
 *     `bf_platform_policy_v1` (written by the retired per-capability switches) still
 *     apply over the mode — except what Local only promises (no gateway, connected
 *     features, sync or direct providers).
 *   - ENFORCEMENT. Every request the web app makes to the BuilderForce API passes
 *     `assertWebApiRequest` — `apiClient`'s one transport calls it before the
 *     network — and the local-first sync surface uses `webPlatformFetch`. A denied
 *     capability is BLOCKED BEFORE the request is attempted — the underlying fetch
 *     is never called — and every block is recorded for the request account. What
 *     a path MEANS is the shared route table (`classifyPlatformRequest`), so one URL
 *     is one capability on every host.
 *
 * The mode, the overrides and the session are mirrored across tabs through the
 * storage event, so a choice in one tab is the choice in all of them.
 */

import {
  PlatformAccessDenied,
  createGuardedPlatformFetch,
  createPlatformPolicy,
  type InferenceMode,
  type MutablePlatformPolicy,
  type PlatformCapability,
  type PlatformPolicySnapshot,
  type PlatformRequestRecord,
} from '@builderforce/local-first';
import { isSessionStorageKey } from '../auth';
import { bootWebHostStore, type BootWebHostOptions, type WebHostBoot } from './bootWebHost';
import {
  WEB_INFERENCE_MODE_STORAGE_KEY,
  notifyWebInferenceMode,
  webSignedIn,
  writeStoredInferenceMode,
} from './webInferenceMode';
import {
  GRANTABLE,
  WEB_PLATFORM_POLICY_STORAGE_KEY,
  webApiRequestRefusal,
  webInferencePolicyFor,
  webPlatformCapabilityFor,
  webSocketRefusal,
} from './webRequestGate';

export { webSignedIn };
// THE gate's decisions live in the light `./webRequestGate` (socket openers import it
// synchronously); this module enforces, records and boots them.
export { WEB_PLATFORM_POLICY_STORAGE_KEY, webApiRequestRefusal, webInferencePolicyFor, webPlatformCapabilityFor, webSocketRefusal };

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

const guarded = createGuardedPlatformFetch({
  policy,
  fetch: (input, init) => globalThis.fetch(input, init),
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
// The ONE gate for the web app's API transport
// ---------------------------------------------------------------------------

/**
 * {@link webApiRequestRefusal}, enforced: throws {@link PlatformAccessDenied} — before
 * the request exists — and records the block. `apiClient`'s transport calls this for
 * every request; a caller that treats its feature as best-effort (memory recall, the
 * personality block) already turns the throw into "nothing", so Local only shows no
 * error for them.
 */
export function assertWebApiRequest(input: string, method: string, credentialed: boolean): void {
  const refused = webApiRequestRefusal(input, method, credentialed);
  if (!refused) return;
  recordRequest({ capability: refused, url: input, outcome: 'blocked', at: new Date().toISOString() });
  throw new PlatformAccessDenied(refused);
}

// ---------------------------------------------------------------------------
// The mode, the advanced overrides and the session — composed into the snapshot
// ---------------------------------------------------------------------------

/** Re-derive the snapshot from the stored mode, the overrides and the session. */
function applyPolicy(): void {
  policy.set(webInferencePolicyFor(webSignedIn()).snapshot);
  notifyWebInferenceMode();
}

/** The person's explicit mode choice: stored, then applied. */
export function setWebInferenceMode(mode: InferenceMode): void {
  writeStoredInferenceMode(mode);
  applyPolicy();
}

/**
 * Re-apply the policy after the session changed in THIS tab (the auth provider's
 * sign-in / sign-out). Other tabs follow through the storage event.
 */
export function refreshWebPlatformPolicy(): void {
  applyPolicy();
}

// ---------------------------------------------------------------------------
// Bootstrap — once per page, free of module-load side effects for SSR
// ---------------------------------------------------------------------------

let booted = false;

/**
 * Set by `bootWebPlatformPolicy` only after the derived snapshot is applied. The
 * root layout's head script holds platform-origin `fetch` until this is true, so
 * a request cannot leave before the policy runs. The continuing gate for every
 * transport is G02; this flag is the ordering.
 */
export const WEB_PLATFORM_POLICY_BOOTED = '__bfPlatformPolicyBooted';

/**
 * Boot the policy for this tab: derive the snapshot from the stored mode, the
 * stored overrides and whether a session is present (signed out and never asked:
 * every capability REFUSED). Then mirror cross-tab changes — the mode, the
 * overrides, a sign-in/out elsewhere. The boot flag is set last,
 * after the snapshot is in place.
 */
export function bootWebPlatformPolicy(): void {
  if (booted || typeof window === 'undefined') return;
  booted = true;
  applyPolicy();
  window.addEventListener('storage', (event) => {
    // A guest token is not a session: minting one (the Hybrid opt-in) changes nothing
    // the policy derives from — the stored mode does.
    const relevant = event.key === null
      || isSessionStorageKey(event.key)
      || event.key === WEB_PLATFORM_POLICY_STORAGE_KEY
      || event.key === WEB_INFERENCE_MODE_STORAGE_KEY;
    if (relevant) applyPolicy();
  });
  (window as unknown as Record<string, boolean>)[WEB_PLATFORM_POLICY_BOOTED] = true;
}

/** Test hook: re-arm the bootstrap and return the policy to the API-denied default. */
export function resetWebPlatformPolicyForTests(): void {
  booted = false;
  policy.set(Object.fromEntries(GRANTABLE.map((key) => [key, false])) as Partial<PlatformPolicySnapshot>);
  resetWebPlatformRequestAccount();
  if (typeof window !== 'undefined') {
    delete (window as unknown as Record<string, boolean>)[WEB_PLATFORM_POLICY_BOOTED];
  }
}

export { PlatformAccessDenied };
export type { BootWebHostOptions, WebDurableRecord, WebHostBoot, WebReplayResult } from './bootWebHost';
export { WEB_REPLAY_KIND } from './bootWebHost';

/**
 * Node-callable web boot. `bootWebPlatformPolicy` no-ops without `window` and
 * only sets policy flags. This boot writes into the caller's durable store —
 * not localStorage, which `writeLocal` cannot use without `window` — and
 * replays one batch locally while the network is denied. It uses this module's
 * policy object. Platform fetch is not called on that path.
 */
export function bootWebHost(options: BootWebHostOptions): WebHostBoot {
  return bootWebHostStore({ ...options, policy });
}
