/**
 * The ONE governance-gate resolver for an editor-started Brain run — the piece that
 * was missing between `policy.ts` (the pure gate decisions) and the two surfaces
 * that start loops here (the native chat participant and the host-owned webview
 * run). Cloud and on-prem dispatches get their gates stamped by
 * `RuntimeService.withPolicyGates`; an IDE run has no dispatch payload, so it pulls
 * the same effective gates from the api at loop start.
 *
 * Fail-closed, like the server: when a signed-in tenant's policy cannot be read the
 * run is refused rather than started ungated. Signed out means no tenant, so no
 * tenant policy applies and the run proceeds with none.
 *
 * Cached per project for a short window, with a longer stale-on-error window: gates
 * change on the order of days, an editor starts a turn every few seconds, and a
 * transient network blip must not refuse a turn the last successful read already
 * governs. A project whose gates were NEVER read still fails closed — there is no
 * last-known policy to hold it to.
 */

import type * as vscode from "vscode";
import { fetchPolicyGates, fetchProjectShipPolicy } from "./bfApi";
import { getApiKey } from "./gateway";
import type { PolicyGate } from "@builderforce/agent-tools";
import { DEFAULT_SHIP_POLICY, narrowShipPolicy, type ShipPolicy } from "@builderforce/run-guards";
import { snapshotPermitsOfflineRun, type PolicySnapshotValue } from "./policySnapshots";

/** Raised when a tenant's gates could not be resolved — the run must not start. */
export class PolicyGatesUnavailableError extends Error {
  constructor(cause: unknown) {
    super(`policy gates unavailable: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "PolicyGatesUnavailableError";
  }
}

/** How long a successful read answers later turns without a round-trip. */
export const POLICY_GATES_FRESH_MS = 60_000;
/** How long a last-known policy still governs a turn when a re-read fails. */
export const POLICY_GATES_STALE_MS = 10 * 60_000;

/**
 * Durable policy-snapshot persistence (G09), wired once by the composition root.
 * Every successful read is persisted as a versioned snapshot; a re-read failure past
 * the in-memory stale window falls back to that snapshot when it is still valid and
 * permits offline runs. Without a configured port the resolver behaves as before
 * (memory only) — and durable snapshots are NEVER cleared by sign-out or cache resets,
 * so signing out cannot strip policy from previously managed records.
 */
export interface PolicyGatesPersistence {
  save(scopeKey: string, projectId: number | undefined, gates: PolicyGate[]): Promise<void>;
  load(scopeKey: string): Promise<PolicySnapshotValue | undefined>;
  /** Record the project's ship policy (PRD 48) on the scope's existing snapshot. */
  saveShipPolicy?(scopeKey: string, shipPolicy: ShipPolicy | null): Promise<void>;
}

let persistence: PolicyGatesPersistence | undefined;

export function configurePolicyGatesPersistence(port: PolicyGatesPersistence | undefined): void {
  persistence = port;
}

/** One cached read: the project's gates, or its ship policy (keyed apart, same windows). */
interface CachedRead<T> {
  value: T;
  readAt: number;
}

const cache = new Map<string, CachedRead<unknown>>();

const cacheKey = (projectId: number | undefined): string => (projectId == null ? "workspace" : `project:${projectId}`);
const shipCacheKey = (projectId: number): string => `ship:${cacheKey(projectId)}`;

function cachedRead<T>(key: string): CachedRead<T> | undefined {
  return cache.get(key) as CachedRead<T> | undefined;
}

/** Forget every cached policy — a sign-out, a workspace switch, or a test. */
export function resetPolicyGatesCache(): void {
  cache.clear();
}

/**
 * A read answered `undefined` ("nothing read") means signed out OR the platform is down or
 * refusing (the key→JWT exchange answered 503). While an editor key is stored it is a FAILED
 * read: throw so the caller's failure path (stale cache → durable snapshot → fail closed /
 * default) governs, and nothing is cached or persisted over the recorded policy.
 */
async function throwIfSignedIn(secrets: vscode.SecretStorage, what: string): Promise<void> {
  if (await getApiKey(secrets)) throw new Error(`${what} unreadable: the platform returned no session`);
}

/** Effective gates for a run in this editor, or `[]` when signed out. */
export async function resolveRunPolicyGates(
  secrets: vscode.SecretStorage,
  projectId: number | undefined,
  now: number = Date.now(),
): Promise<PolicyGate[]> {
  const key = cacheKey(projectId);
  const cached = cachedRead<PolicyGate[]>(key);
  if (cached && now - cached.readAt < POLICY_GATES_FRESH_MS) return cached.value;
  try {
    const read = await fetchPolicyGates(secrets, projectId);
    if (read === undefined) {
      // Signed out: no tenant policy applies this turn, but an empty policy is never cached or
      // persisted, so it can neither outlive the sign-out nor overwrite the recorded snapshot.
      await throwIfSignedIn(secrets, "policy gates");
      return [];
    }
    const gates = read;
    cache.set(key, { value: gates, readAt: now });
    // Persist before returning so a sign-out that clears this cache in the same turn
    // still has a snapshot. A failed save must not refuse a turn the read already answered.
    try {
      await persistence?.save(key, projectId, gates);
    } catch {
      /* snapshot write failed; the in-memory read still governs this turn */
    }
    return gates;
  } catch (e) {
    if (cached && now - cached.readAt < POLICY_GATES_STALE_MS) return cached.value;
    // Durable last resort: a valid snapshot that permits offline runs still governs
    // this scope across restarts. Missing or expired required policy fails closed.
    const snapshot = await persistence?.load(key).catch(() => undefined);
    if (snapshot && snapshotPermitsOfflineRun(snapshot, new Date(now))) return snapshot.gates;
    throw new PolicyGatesUnavailableError(e);
  }
}

/**
 * The project's effective SHIP POLICY (PRD 48) for a run started now — read through the
 * SAME cache windows and durable snapshot as the gates above. Never refuses a run: no
 * project, signed out, no value, or an unreadable API with nothing cached or snapshotted
 * all mean `DEFAULT_SHIP_POLICY` (source `default`), which the run states in its report.
 * A failed read is handed to `report`, never swallowed.
 */
export async function resolveRunShipPolicy(
  secrets: vscode.SecretStorage,
  projectId: number | undefined,
  report: (message: string) => void,
  now: number = Date.now(),
): Promise<ShipPolicy> {
  if (projectId == null) return DEFAULT_SHIP_POLICY;
  const key = shipCacheKey(projectId);
  const cached = cachedRead<ShipPolicy | null>(key);
  if (cached && now - cached.readAt < POLICY_GATES_FRESH_MS) return cached.value ?? DEFAULT_SHIP_POLICY;
  try {
    const read = await fetchProjectShipPolicy(secrets, projectId);
    if (read === undefined) {
      // Nothing read: signed out ⇒ the default, nothing cached or recorded; signed in ⇒ failure path.
      await throwIfSignedIn(secrets, `ship policy for project ${projectId}`);
      return DEFAULT_SHIP_POLICY;
    }
    const policy = read; // `null` = read fine, the project has no well-formed local policy
    cache.set(key, { value: policy, readAt: now });
    try {
      await persistence?.saveShipPolicy?.(cacheKey(projectId), policy);
    } catch (error) {
      report(`ship policy snapshot for project ${projectId} not saved: ${String(error)}`);
    }
    return policy ?? DEFAULT_SHIP_POLICY;
  } catch (e) {
    report(`ship policy for project ${projectId} unreadable (${String(e)}); using the last known value (never looser than the default) or the default`);
    // A stale value may predate the project NARROWING its policy, so it is never looser than
    // the default: a remembered `commit_push` commits until the project's policy is read again.
    if (cached && now - cached.readAt < POLICY_GATES_STALE_MS) return narrowShipPolicy(cached.value ?? DEFAULT_SHIP_POLICY, DEFAULT_SHIP_POLICY);
    const snapshot = await persistence?.load(cacheKey(projectId)).catch((error: unknown) => {
      report(`ship policy snapshot for project ${projectId} unreadable: ${String(error)}`);
      return undefined;
    });
    if (snapshot?.shipPolicy && snapshotPermitsOfflineRun(snapshot, new Date(now))) return narrowShipPolicy(snapshot.shipPolicy, DEFAULT_SHIP_POLICY);
    return DEFAULT_SHIP_POLICY;
  }
}
