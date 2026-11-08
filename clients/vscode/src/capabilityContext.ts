/**
 * Host side of the capability source (PRD 41 Part A1): reads the live inputs (the session and the
 * platform policy) and mirrors the derived states (`capabilityStates.ts`) into
 * `builderforce.capability.*` context keys for `package.json` `when` clauses.
 * `builderforce.signedIn` stays the account signal; its allowlist is guarded by
 * `scripts/check-signed-in-when.mjs`. A capability that later needs a real precondition changes
 * its derivation in `capabilityStates.ts`, never a new `signedIn` when-clause.
 *
 * `syncCapabilityContexts` is called from the SAME auth-state sites that refresh the
 * signed-in key (activation + every sign-in / sign-out), so the two never drift.
 */

import * as vscode from "vscode";
import { inferenceModeState } from "./inferenceModeSetting";
import { platformCapabilityAllows } from "./platformPolicy";
import { capabilityContextKeys, capabilityStates, type CapabilityInputs, type CapabilityStates } from "./capabilityStates";

/** The live inputs: the session (inference-mode binding's signed-in read) and the policy's grants. */
export function currentCapabilityInputs(): CapabilityInputs {
  return {
    signedIn: inferenceModeState().signedIn,
    synchronize: platformCapabilityAllows("synchronize"),
    gatewayInference: platformCapabilityAllows("gateway-inference"),
    connectedFeatures: platformCapabilityAllows("connected-feature"),
  };
}

/** The capability states right now. */
export function currentCapabilities(): CapabilityStates {
  return capabilityStates(currentCapabilityInputs());
}

/** Mirror each capability into its `builderforce.capability.<id>` context key. */
export async function syncCapabilityContexts(): Promise<void> {
  const keys = capabilityContextKeys(currentCapabilities());
  for (const [key, value] of Object.entries(keys)) {
    await vscode.commands.executeCommand("setContext", key, value);
  }
}
