/**
 * Connecting a model provider's subscription FROM THE EDITOR — and doing it at the moment
 * a turn needs it.
 *
 * Three entry points, one flow:
 *   • {@link connectProviderInteractively} — the "Model Provider Connections" command
 *     (`byoConnections.ts`) and the picker's "connect Kimi" row;
 *   • {@link ensureLocalProviderCredential} — a turn about to call a provider from this
 *     machine. It resolves the local credential and, when the workspace has no usable
 *     connection, launches the sign-in right there (once per session; a cancel is
 *     remembered) instead of silently falling back to a different model. A connect
 *     started here lands in Builderforce's integrations (the gateway stores the grant)
 *     and the access token is persisted locally for the turn;
 *   • {@link signInToAccountProvider} — the chat banner's Sign-in button, which overrides
 *     a remembered cancel.
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
import { LOCAL_RUNTIMES } from "@builderforce/local-inference";
import { gatewayRequest } from "./gatewayRequest";
import { connectedAccounts } from "./localProviderCredentials";
import type { ConnectedAccounts } from "@builderforce/provider-connect/accounts";

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

/**
 * The chat banner's "Sign in to {label}": run the connect for the account provider a failed turn
 * named. The provider arrives from the webview, so it is matched against the runtime registry
 * (`accountProvider`) and the display name comes from there - the webview names nothing it is
 * not allowed to connect. False when no runtime is backed by that provider, or the connect did
 * not finish.
 */
export async function signInToAccountProvider(secrets: vscode.SecretStorage, provider: unknown): Promise<boolean> {
  const runtime = LOCAL_RUNTIMES.find((r) => r.accountProvider !== undefined && r.accountProvider === provider);
  if (!runtime?.accountProvider) return false;
  // The person asked for this one: it overrides an earlier cancel, and shares the single flight with a turn's own prompt.
  declined.delete(runtime.accountProvider);
  return connectOnce(secrets, runtime.accountProvider, runtime.label);
}

/** The editor's connected accounts (the shared implementation Rovr runs too), created on
 *  first use with this editor's authenticated gateway call. */
export function editorAccounts(secrets: vscode.SecretStorage): ConnectedAccounts {
  return connectedAccounts(secrets, () => gatewayRequest(secrets));
}

/** One sign-in per provider at a time: three turns that start together (or a turn and the banner's button) ask once. */
const prompting = new Map<string, Promise<boolean>>();

/** Providers whose automatic sign-in the person cancelled this session; only the banner's Sign-in button clears it. */
const declined = new Set<string>();

/** Whether the person cancelled (or failed) this provider's automatic sign-in this session. */
export function signInDeclined(provider: string): boolean {
  return declined.has(provider);
}

/** Test seam: forget every remembered cancel and in-flight sign-in. */
export function resetProviderSignIn(): void {
  declined.clear();
  prompting.clear();
}

function connectOnce(secrets: vscode.SecretStorage, provider: string, label: string): Promise<boolean> {
  const pending = prompting.get(provider);
  if (pending) return pending;
  const run = connectProviderInteractively(secrets, provider, label)
    .then((connected) => {
      if (connected) declined.delete(provider);
      else declined.add(provider);
      return connected;
    })
    .finally(() => prompting.delete(provider));
  prompting.set(provider, run);
  return run;
}

/**
 * A credential this machine may send to the provider right now. When the workspace has none (or its
 * grant is dead) the sign-in is launched ONCE per session: a cancel is remembered, so the next turn
 * reports the missing connection instead of opening the browser again, until the person clicks the
 * chat banner's Sign-in button.
 */
export async function ensureLocalProviderCredential(
  secrets: vscode.SecretStorage,
  provider: string,
  label: string,
  { prompt }: { prompt: boolean },
): Promise<LocalCredentialOutcome> {
  const store = editorAccounts(secrets).store(provider);
  const first = await store.resolve();
  if (first.kind === "credential" || first.kind === "unavailable" || !prompt || declined.has(provider)) return first;

  // Straight into the sign-in: the browser opens with the code and a cancellable progress
  // notification waits for approval. A confirm toast in front of it was missable, and a
  // missed toast looked like a silent failure.
  if (!(await connectOnce(secrets, provider, label))) return first;
  return store.resolve();
}
