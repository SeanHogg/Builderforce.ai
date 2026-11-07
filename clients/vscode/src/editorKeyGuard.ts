import * as vscode from "vscode";
import { dropWorkspaceSelection, onEditorKeyRejected } from "./bfApi";
import { SECRET_KEY } from "./gateway";
import { onWorkspaceRefused } from "./gatewayAuth";

/**
 * A stored editor key the gateway REFUSES is a signed-out editor, not a signed-in one.
 *
 * Signed-in truth used to be "a key is in SecretStorage". A key revoked on the web (or
 * deleted, or minted without a user) stays there, so the sidebar kept every feature
 * view revealed while each tenant-JWT exchange quietly failed: empty Sessions, Evermind
 * on its sign-in wall, and a Sign in button that handed back the same dead session
 * without ever opening the browser — "BuilderForce: signed in." over nothing.
 *
 * When the exchange rejects the key (401 / 400 — a verdict on the KEY, never a network
 * blip), sign out so the login panel returns and Sign in runs the real flow again.
 */
export function watchRejectedEditorKey(
  secrets: vscode.SecretStorage,
  signOut: () => Promise<void>,
): vscode.Disposable {
  let expiring = false;
  // The gateway refusing the SELECTED WORKSPACE fails closed (never a fallback to the key's
  // own tenant), in one of two ways:
  //   - `workspace_not_member`: the person left that workspace. The key is fine - drop the
  //     stale selection (the same function the /api re-scope refusal uses), no sign-out.
  //   - `editor_key_required`: THIS key can never switch workspaces (a legacy or restricted
  //     key). A fresh sign-in mints one that can, so sign out and say why - once per key.
  const refusedKeys = new Set<string>();
  const workspaceRefused = onWorkspaceRefused(async ({ refusal, key, workspace }) => {
    // Only the key that is STILL stored: a refusal answering a previous key must not act.
    if ((await secrets.get(SECRET_KEY)) !== key) return;
    if (refusal === "workspace_not_member") {
      dropWorkspaceSelection(workspace);
      return;
    }
    if (refusedKeys.has(key)) return;
    refusedKeys.add(key);
    await signOut();
    void promptSignInForWorkspace();
  });
  const keyRejected = onEditorKeyRejected(async (rejectedKey) => {
    // Only the key that is STILL stored: an exchange for the previous key can land
    // after a fresh sign-in, and must not sign the new one out. Several in-flight
    // exchanges reject together — act once.
    if (expiring || (await secrets.get(SECRET_KEY)) !== rejectedKey) return;
    expiring = true;
    try {
      await signOut();
    } finally {
      expiring = false;
    }
    void promptSignInAgain();
  });
  return vscode.Disposable.from(keyRejected, { dispose: workspaceRefused });
}

/** This key cannot switch workspaces; the one action that fixes it is a fresh sign-in. */
export async function promptSignInForWorkspace(): Promise<void> {
  const signIn = vscode.l10n.t("Sign In");
  const pick = await vscode.window.showWarningMessage(
    vscode.l10n.t("This sign-in can't switch workspaces. Sign in again to get one that can."),
    signIn,
  );
  if (pick === signIn) void vscode.commands.executeCommand("builderforce.signIn");
}

/** Tell the person their key no longer works, with the one action that fixes it. */
export async function promptSignInAgain(): Promise<void> {
  const signIn = vscode.l10n.t("Sign In");
  const pick = await vscode.window.showWarningMessage(
    vscode.l10n.t("BuilderForce no longer accepts this editor's key (it was revoked or expired). Sign in again to reconnect."),
    signIn,
  );
  if (pick === signIn) void vscode.commands.executeCommand("builderforce.signIn");
}
