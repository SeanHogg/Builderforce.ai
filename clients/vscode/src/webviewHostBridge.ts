import * as vscode from "vscode";
import { getTenantJwt } from "./bfApi";

/**
 * The host half of the webview bridge — the three things EVERY bundled-React
 * surface does identically, in one place.
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 * `token.refresh`, `signin` and the `response` reply were implemented twice:
 * once in `WebviewPanelBase` (the editor PANELS — Brain, Project 360, project
 * pages, the canvas) and once in `EvermindViewProvider` (the sidebar VIEW). Same
 * three cases, byte-for-byte, except where they had already drifted: the panel
 * base always wrote an `error` key — `error: undefined` on every success — while
 * the view omitted it unless set. Two surfaces, two answers to "does a successful
 * response carry an `error` field", and nothing to make either one wrong.
 *
 * A panel and a view are different VS Code objects, but both expose a
 * `vscode.Webview`, which is all any of this needs — so these are functions over
 * a webview rather than a second base class the view could not have extended.
 *
 * ── THE `error` CONTRACT ────────────────────────────────────────────────────
 * A successful response carries NO `error` key. The webview reads
 * `m.error || 'host error'`, so both old shapes happened to work — but a present
 * key whose value is `undefined` is a different object to anything that inspects
 * it (`'error' in msg`, a structured-clone round trip, a diagnostics dump), and
 * "which surface am I on" is not a question the answer should depend on.
 */

/** The minimal inbound-message envelope every webview surface shares. */
export interface WebviewInbound {
  type?: string;
  id?: string;
}

/** Fire-and-forget post to a webview. A no-op when the surface is not resolved. */
export function postToWebview(webview: vscode.Webview | undefined, msg: unknown): void {
  void webview?.postMessage(msg);
}

/**
 * Reply to a webview `request` round-trip.
 *
 * A no-op without an `id` — that is a fire-and-forget message, and answering one
 * would leave a response nothing is waiting for.
 */
export function respondToWebview(
  webview: vscode.Webview | undefined,
  id: string | undefined,
  ok: boolean,
  result?: unknown,
  error?: string,
): void {
  if (!id || !webview) return;
  void webview.postMessage({ type: "response", id, ok, result, ...(error ? { error } : {}) });
}

/**
 * Handle the cases the HOST owns on every surface. Returns true when the message
 * was handled, so a caller's own switch runs only for its own messages.
 *
 * Both cases are host-owned for the same reason: a webview cannot reach the
 * extension's secret storage, and cannot run a command.
 */
export async function handleSharedHostMessage(
  ctx: vscode.ExtensionContext,
  webview: vscode.Webview | undefined,
  msg: WebviewInbound,
): Promise<boolean> {
  switch (msg.type) {
    case "token.refresh": {
      const token = (await getTenantJwt(ctx.secrets)) ?? null;
      respondToWebview(webview, msg.id, true, { token });
      return true;
    }
    case "signin":
      void vscode.commands.executeCommand("builderforce.signIn");
      return true;
    default:
      return false;
  }
}
