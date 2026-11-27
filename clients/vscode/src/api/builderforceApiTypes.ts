import type * as vscode from "vscode";

/**
 * The public surface the Builderforce extension returns from `activate()`. Other extensions
 * (Spawn) call it through `vscode.extensions.getExtension("builderforce.builderforce-ai")`.
 * Types only: a consumer vendors this file and imports nothing from the extension's internals.
 *
 * It exports NO credential and no sign-in. A consumer that needs to act for the user asks
 * the `builderforce` authentication provider: `vscode.authentication.getSession("builderforce",
 * ["spawn"], { createIfNone: true })` returns a session whose `accessToken` is a short-lived
 * token scoped to the Spawn routes only (SEC-G017).
 */
export interface BuilderforceApi {
  readonly version: 2;
  /** Gateway base URL and web app URL, from the existing configuration accessors. */
  getBaseUrl(): string;
  getWebUrl(): string;
  /** Fires `true` after a sign-in and `false` after a sign-out. */
  readonly onDidChangeSignIn: vscode.Event<boolean>;
  /**
   * Drops the cached audience-scoped token so the next `getSession("builderforce", ["spawn"], { silent: true })`
   * mints a fresh one. Returns nothing and exposes no credential. (VS Code's only option that reaches
   * `createSession`, `forceNewSession`, always shows a sign-in dialog, so a silent retry needs this.)
   */
  invalidateScopedToken(): void;
}
