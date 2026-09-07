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
import { fetchPolicyGates } from "./bfApi";
import type { PolicyGate } from "./policy";

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

interface CachedGates {
  gates: PolicyGate[];
  readAt: number;
}

const cache = new Map<string, CachedGates>();

const cacheKey = (projectId: number | undefined): string => (projectId == null ? "workspace" : `project:${projectId}`);

/** Forget every cached policy — a sign-out, a workspace switch, or a test. */
export function resetPolicyGatesCache(): void {
  cache.clear();
}

/** Effective gates for a run in this editor, or `[]` when signed out. */
export async function resolveRunPolicyGates(
  secrets: vscode.SecretStorage,
  projectId: number | undefined,
  now: number = Date.now(),
): Promise<PolicyGate[]> {
  const key = cacheKey(projectId);
  const cached = cache.get(key);
  if (cached && now - cached.readAt < POLICY_GATES_FRESH_MS) return cached.gates;
  try {
    const gates = (await fetchPolicyGates(secrets, projectId)) ?? [];
    cache.set(key, { gates, readAt: now });
    return gates;
  } catch (e) {
    if (cached && now - cached.readAt < POLICY_GATES_STALE_MS) return cached.gates;
    throw new PolicyGatesUnavailableError(e);
  }
}
