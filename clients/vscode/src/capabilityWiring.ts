/**
 * The capability wiring of activation (PRD 41 Part A1/A2/A3/A5): what keeps the capability context keys,
 * the pending knowledge binding and the platform-bound caches in step with the session and the policy.
 * Kept out of `extension.ts` so that file only calls it.
 */

import * as vscode from "vscode";
import * as bfApi from "./bfApi";
import { registerBundledAnalyzers } from "./bundledAnalyzers";
import { setAnalyzerStorage } from "./runDelta/analyzers/analyzerStorage";
import { currentCapabilityInputs, syncCapabilityContexts } from "./capabilityContext";
import { networkDenied } from "./capabilityStates";
import { SECRET_KEY } from "./gateway";
import { onDidChangeInferenceMode } from "./inferenceModeSetting";
import { checkPendingKnowledgeBinding } from "./knowledge/knowledgeCommands";
import { platformPolicy } from "./platformPolicy";

/**
 * Mirror the signed-in state into the `builderforce.signedIn` context key so the
 * sidebar can hide every feature view behind a single login panel when logged out
 * (the views' `when` clauses read this key). Signed-in truth is "has an editor key
 * in SecretStorage" — the same check every surface already makes ad hoc.
 */
export async function syncSignedInContext(context: vscode.ExtensionContext): Promise<void> {
  const signedIn = !!(await context.secrets.get(SECRET_KEY));
  await vscode.commands.executeCommand("setContext", "builderforce.signedIn", signedIn);
  // PRD 41 Part A1: the sidebar's capability-gated surfaces (health, evermind) refresh
  // from the SAME auth-state sites as the signed-in key, so the two never drift.
  await syncCapabilityContexts();
  await checkPendingKnowledgeBinding();
}

/** Called once at activation, before the first `syncSignedInContext`. */
export function wireCapabilities(context: vscode.ExtensionContext): void {
  // A3: the analyzers ship in the VSIX (`out/analyzers`); every analysis launches them, never `npm exec`.
  registerBundledAnalyzers(context.extensionPath);
  // The run delta's L3 analyzers: osv-scanner's offline database lives in the extension's storage; before trees an earlier
  // session left behind (a crash mid-analysis) are swept, links first.
  setAnalyzerStorage(context.globalStorageUri.fsPath);
  void import("./runDelta/analyzers/beforeTree")
    .then((m) => m.sweepOrphanedTrees((vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath)))
    .catch(() => undefined);
  // A5: the `/me` identity is remembered per session and never requested while the platform is denied.
  bfApi.bindIdentityCache({ memento: context.globalState, offline: () => networkDenied(currentCapabilityInputs()) });
  // A policy change (sync granted or revoked, the mode changed) moves the capability keys, and the
  // pending knowledge binding owns the link edge (bind on link, unbind on revoke or sign-out).
  context.subscriptions.push({ dispose: platformPolicy().subscribe(() => { void syncCapabilityContexts(); void checkPendingKnowledgeBinding(); }) });
  // The session read lands after the policy's first snapshot: a sign-in with sync already granted binds here.
  context.subscriptions.push(onDidChangeInferenceMode(() => { void checkPendingKnowledgeBinding(); }));
}
