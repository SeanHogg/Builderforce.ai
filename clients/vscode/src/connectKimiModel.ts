/**
 * The picker's "Connect Kimi" row: connect the workspace's Kimi account, persist the
 * credential locally, then let the person choose which Kimi model new turns run on.
 *
 * The model is CHOSEN, not assumed: Kimi K3 is plan-gated, and pinning it for someone on
 * a lower plan would fail every turn with a refusal. The list comes back in the
 * workspace's chosen order (Settings → Model providers → Kimi), with K3 marked.
 */
import * as vscode from "vscode";
import { formatLocalModelRef } from "@builderforce/local-inference";
import type { LocalCredential } from "@builderforce/provider-connect";
import { localCredentialStore } from "./localProviderCredentials";
import { setSelectedModel } from "./modelState";
import { connectProviderInteractively } from "./providerConnect";

const K3_IDS = new Set(["k3", "k3-256k"]);

/** The credential, `connect` when the workspace has no usable Kimi connection, or null
 *  when the gateway could not be reached (already reported). */
async function resolveKimi(): Promise<LocalCredential | "connect" | null> {
  const outcome = await localCredentialStore("kimi")?.resolve();
  if (!outcome) return null;
  if (outcome.kind === "credential") return outcome.credential;
  if (outcome.kind === "unavailable") {
    void vscode.window.showErrorMessage(vscode.l10n.t("BuilderForce: could not reach your Kimi connection ({0}).", outcome.detail));
    return null;
  }
  return "connect";
}

export async function connectKimiAndPin(secrets: vscode.SecretStorage): Promise<void> {
  // Already connected: skip straight to the choice. Otherwise connect first — the
  // connection lands in the workspace's integrations and the token on this machine.
  let resolved = await resolveKimi();
  if (resolved === "connect") {
    if (!(await connectProviderInteractively(secrets, "kimi", "Kimi"))) return;
    resolved = await resolveKimi();
  }
  if (!resolved || resolved === "connect") return;
  const credential = resolved;
  if (credential.models.length === 0) {
    void vscode.window.showWarningMessage(vscode.l10n.t("BuilderForce: your Kimi account lists no models."));
    return;
  }

  const pick = await vscode.window.showQuickPick(
    credential.models.map((entry) => ({
      label: entry.displayName,
      description: entry.model,
      ...(K3_IDS.has(entry.model) ? { detail: vscode.l10n.t("Kimi's strongest coder — needs a Kimi plan that includes K3.") } : {}),
      model: entry.model,
    })),
    { title: vscode.l10n.t("Which Kimi model should new turns use?") },
  );
  if (!pick) return;
  setSelectedModel(formatLocalModelRef("kimi-code", pick.model));
  void vscode.window.showInformationMessage(vscode.l10n.t("BuilderForce: new turns run on {0}, called from this machine.", pick.label));
}
