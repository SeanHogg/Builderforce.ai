/**
 * Capability context keys (PRD 41 Part A1): the sidebar reads CAPABILITY state, not a
 * login gate. `builderforce.signedIn` stays the account signal and its allowlist is
 * guarded by `scripts/check-signed-in-when.mjs` (welcome, work, inbox, changes only);
 * the optional product surfaces key off `builderforce.capability.*` so a signed-out
 * workspace still shows them. Health and Evermind ship in the VSIX and need no account —
 * their keys are simply `true`. A capability that later needs a real precondition sets
 * its key from that precondition here, not a new `signedIn` when-clause.
 *
 * `syncCapabilityContexts` is called from the SAME auth-state sites that refresh the
 * signed-in key (activation + every sign-in / sign-out), so the two never drift.
 */

import * as vscode from "vscode";

/** Capability keys the product surfaces read, and whether the VSIX grants them by default. */
export const CAPABILITY_KEYS = {
  health: true,
  evermind: true,
} as const;

export type CapabilityKey = keyof typeof CAPABILITY_KEYS;

/**
 * Mirror each capability into its `builderforce.capability.<name>` context key. Pure
 * grant for now (both ship in the VSIX, neither needs an account); a capability whose
 * availability becomes conditional reads that condition here.
 */
export async function syncCapabilityContexts(): Promise<void> {
  for (const [name, granted] of Object.entries(CAPABILITY_KEYS)) {
    await vscode.commands.executeCommand("setContext", `builderforce.capability.${name}`, granted);
  }
}
