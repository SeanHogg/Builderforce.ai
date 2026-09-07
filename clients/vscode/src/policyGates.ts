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

/** Effective gates for a run in this editor, or `[]` when signed out. */
export async function resolveRunPolicyGates(
  secrets: vscode.SecretStorage,
  projectId: number | undefined,
): Promise<PolicyGate[]> {
  try {
    return (await fetchPolicyGates(secrets, projectId)) ?? [];
  } catch (e) {
    throw new PolicyGatesUnavailableError(e);
  }
}
