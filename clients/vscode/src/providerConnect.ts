/**
 * Connecting a model provider's subscription FROM THE EDITOR — and doing it at the moment
 * a turn needs it.
 *
 * Two entry points, one flow:
 *   • {@link connectProviderInteractively} — the "Model Provider Connections" command
 *     (`byoConnections.ts`) and the picker's "connect Kimi" row;
 *   • {@link ensureLocalProviderCredential} — a turn about to call a provider from this
 *     machine. It resolves the local credential and, when the workspace has no usable
 *     connection, OFFERS to connect right there instead of silently falling back to a
 *     different model. A connect started here lands in Builderforce's integrations (the
 *     gateway stores the grant) and the access token is persisted locally for the turn.
 *
 * The connect itself is `@builderforce/provider-connect` — the same start/poll contract
 * Rovr and the web settings card run.
 */
import * as vscode from "vscode";
import {
  ProviderConnectError,
  awaitDeviceApproval,
  completePasteConnect,
  startProviderConnect,
  type LocalCredentialOutcome,
} from "@builderforce/provider-connect";
import { gatewayRequest } from "./gatewayRequest";
import { localCredentialStore, type LocalCredentialProvider } from "./localProviderCredentials";

/** Why a connect did not finish, in the person's language. */
function failureMessage(label: string, error: unknown): string {
  const reason = error instanceof ProviderConnectError ? error.reason : "failed";
  switch (reason) {
    case "denied":
      return vscode.l10n.t("BuilderForce: the {0} connection was declined.", label);
    case "expired":
      return vscode.l10n.t("BuilderForce: the {0} connection request expired before it was approved. Start again.", label);
    case "unavailable":
      return vscode.l10n.t("BuilderForce: could not start connecting {0} ({1}).", label, error instanceof Error ? error.message : String(error));
    default:
      return vscode.l10n.t("BuilderForce: could not connect {0} ({1}).", label, error instanceof Error ? error.message : String(error));
  }
}

/**
 * Run the provider's connect flow end to end. Resolves true once Builderforce stored the
 * connection; false when the person cancelled or it failed (already reported).
 */
export async function connectProviderInteractively(
  secrets: vscode.SecretStorage,
  provider: string,
  label: string,
): Promise<boolean> {
  const request = gatewayRequest(secrets);
  try {
    const start = await startProviderConnect(request, provider);
    await vscode.env.openExternal(vscode.Uri.parse(start.authorizeUrl));

    if (start.grant === "paste") {
      const code = await vscode.window.showInputBox({
        title: vscode.l10n.t("Complete {0} connection", label),
        prompt: vscode.l10n.t("Paste the authorization code from the browser"),
        ignoreFocusOut: true,
        validateInput: (v) => (v.trim() ? undefined : vscode.l10n.t("Authorization code is required")),
      });
      if (!code?.trim()) return false;
      await completePasteConnect(request, provider, code.trim(), start.state);
    } else {
      // Device grant: the code already travelled in the URL. Show it so the person can
      // confirm the page they landed on, and wait — cancellable — for the approval.
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: vscode.l10n.t("Connecting {0}", label),
          cancellable: true,
        },
        async (progress, token) => {
          progress.report({
            message: start.userCode
              ? vscode.l10n.t("Approve in your browser — the page shows code {0}.", start.userCode)
              : vscode.l10n.t("Approve in your browser."),
          });
          const controller = new AbortController();
          const cancel = token.onCancellationRequested(() => controller.abort());
          try {
            await awaitDeviceApproval(request, provider, start, {
              sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
              now: Date.now,
              signal: controller.signal,
            });
          } finally {
            cancel.dispose();
          }
        },
      );
    }
    void vscode.window.showInformationMessage(vscode.l10n.t("BuilderForce: connected {0}.", label));
    return true;
  } catch (error) {
    if (error instanceof ProviderConnectError && error.reason === "cancelled") return false;
    void vscode.window.showErrorMessage(failureMessage(label, error));
    return false;
  }
}

/** One prompt per provider at a time: three turns that start together ask once. */
const prompting = new Map<LocalCredentialProvider, Promise<LocalCredentialOutcome>>();

/**
 * A credential this machine may send to the provider right now, connecting first when
 * the workspace has none (or its grant is dead) and the person agrees.
 */
export async function ensureLocalProviderCredential(
  secrets: vscode.SecretStorage,
  provider: LocalCredentialProvider,
  label: string,
): Promise<LocalCredentialOutcome> {
  const store = localCredentialStore(provider);
  if (!store) return { kind: "unavailable", detail: `${label} credentials are not initialized.` };
  const first = await store.resolve();
  if (first.kind === "credential" || first.kind === "unavailable") return first;

  const pending = prompting.get(provider);
  if (pending) return pending;
  const run = (async (): Promise<LocalCredentialOutcome> => {
    const connect = vscode.l10n.t("Connect {0}", label);
    const ask = first.kind === "reconnect"
      ? vscode.l10n.t("Your {0} connection needs to be renewed before this turn can use it.", label)
      : vscode.l10n.t("This turn runs on {0}, and your workspace has no {0} account connected yet.", label);
    const pick = await vscode.window.showInformationMessage(ask, connect);
    if (pick !== connect) return first;
    if (!(await connectProviderInteractively(secrets, provider, label))) return first;
    return store.resolve();
  })().finally(() => prompting.delete(provider));
  prompting.set(provider, run);
  return run;
}
