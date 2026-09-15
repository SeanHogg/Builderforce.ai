import * as vscode from "vscode";

/**
 * The account-state strings EVERY bundled-React surface renders before its own screen
 * mounts: `WorkspaceApp`'s sign-in wall, the post-login "Connecting…" wait, and the
 * "couldn't reach BuilderForce" retry.
 *
 * They were declared twice (the Brain panel's bundle and the canvas bundle) and were
 * missing from Evermind, Project 360 and the project pages — which therefore showed
 * the wall in English whatever the editor's language. One builder, spread into every
 * surface's `init.labels`.
 */
export function authLabels(): Record<string, string> {
  const t = vscode.l10n.t;
  return {
    "app.signInPrompt": t("Sign in to BuilderForce to start."),
    "app.signIn": t("Sign in"),
    "app.connecting": t("Connecting…"),
    "app.connectFailed": t("Couldn't reach BuilderForce. Check your connection and try again."),
    "app.retry": t("Retry"),
  };
}
