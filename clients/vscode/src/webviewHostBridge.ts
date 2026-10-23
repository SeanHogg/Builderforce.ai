import * as vscode from "vscode";
import { getTenantJwt } from "./bfApi";
import { logLine } from "./errorReporter";
import { getBaseUrl, getWebBaseUrl } from "./gateway";
import { localBrainApplication } from "./localFirstStore";
import { platformInferenceMode, platformPolicy } from "./platformPolicy";
import { assertPlatformSocketAllowed, platformPolicyFrame, platformSocketUrl } from "./platformCallGate";
import { isInferenceMode } from "@builderforce/local-first";
import { setInferenceMode } from "./inferenceModeSetting";
import { DOWNLOAD_LOCAL_MODEL_COMMAND } from "./noLocalModelPrompt";
import { callLocalPersistence } from "./localPersistenceDispatch";

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

/** The panel or view that owns a webview — the object that knows when it is disposed. */
export interface WebviewOwner {
  onDidDispose(listener: () => void): vscode.Disposable;
}

/** Webviews receiving policy pushes, each with the subscription that forgets it on dispose. */
const watchedWebviews = new Map<vscode.Webview, vscode.Disposable>();
let policyPushInstalled = false;
/** The frame last pushed to every watched webview — a push happens only when this changes. */
let lastBroadcastKey: string | undefined;

function currentPolicyFrame() {
  return platformPolicyFrame(getBaseUrl(), getWebBaseUrl());
}

function publishPlatformPolicy(webview: vscode.Webview, frame: ReturnType<typeof currentPolicyFrame>): void {
  try {
    void webview.postMessage(frame);
  } catch (error) {
    // A disposed webview throws on access. Forget it; the dispose hook may not have run yet.
    logLine(`[webview] policy push dropped: ${error instanceof Error ? error.message : String(error)}`);
    forgetWebview(webview);
  }
}

function forgetWebview(webview: vscode.Webview): void {
  watchedWebviews.get(webview)?.dispose();
  watchedWebviews.delete(webview);
}

/**
 * Push the host snapshot once when a webview is first seen, and again only when the
 * host policy actually changes. Disposed webviews are removed by their owner's
 * `onDidDispose` — `postMessage` on a disposed webview resolves, so a failed post can
 * not be relied on to prune.
 */
function watchPlatformPolicy(webview: vscode.Webview | undefined, owner: WebviewOwner | undefined): void {
  if (!webview || !owner || watchedWebviews.has(webview)) return;
  if (!policyPushInstalled) {
    policyPushInstalled = true;
    platformPolicy().subscribe(() => {
      const frame = currentPolicyFrame();
      const key = JSON.stringify(frame);
      if (key === lastBroadcastKey) return;
      lastBroadcastKey = key;
      for (const view of [...watchedWebviews.keys()]) publishPlatformPolicy(view, frame);
    });
  }
  watchedWebviews.set(webview, owner.onDidDispose(() => forgetWebview(webview)));
  const frame = currentPolicyFrame();
  lastBroadcastKey ??= JSON.stringify(frame);
  publishPlatformPolicy(webview, frame);
}

/** Webviews currently receiving policy pushes. For tests and diagnostics. */
export function watchedWebviewCount(): number {
  return watchedWebviews.size;
}

/**
 * Fire-and-forget post to a webview. A no-op when the surface is not resolved.
 * Pass the `owner` (panel or view) so an `init` frame also subscribes the webview to
 * policy changes until its owner is disposed.
 */
export function postToWebview(webview: vscode.Webview | undefined, msg: unknown, owner?: WebviewOwner): void {
  if (!webview) return;
  if (msg && typeof msg === "object" && (msg as { type?: unknown }).type === "init") {
    watchPlatformPolicy(webview, owner);
    const frame = msg as { platformPolicy?: unknown; inferenceMode?: unknown; baseUrl?: string };
    if (!frame.platformPolicy) {
      void webview.postMessage({
        ...frame,
        platformPolicy: platformPolicy().snapshot(),
        // The realm decides with the shared gate, which needs the mode as well.
        inferenceMode: frame.inferenceMode ?? platformInferenceMode(),
        baseUrl: frame.baseUrl ?? getBaseUrl(),
      });
      return;
    }
  }
  void webview.postMessage(msg);
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

/** A failed API answer relayed by `webview/src/apiFailureRelay.ts`. */
interface ApiFailureMessage extends WebviewInbound {
  method?: string;
  path?: string;
  status?: number;
  error?: string;
  errorId?: string;
}

/** One output-channel line per failed answer: the endpoint, the status, the API's
 *  reference (the lookup key of its stored error row) and its sentence. */
export function apiFailureLine(m: ApiFailureMessage): string {
  const ref = m.errorId ? ` · ref ${m.errorId}` : "";
  const said = m.error ? ` — ${m.error}` : "";
  return `[webview api] ${m.method ?? "GET"} ${m.path ?? "?"} → ${m.status ?? "?"}${ref}${said}`;
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
  owner?: WebviewOwner,
): Promise<boolean> {
  // First message from this webview subscribes it; every later one is a no-op here.
  watchPlatformPolicy(webview, owner);
  const socket = platformSocketUrl(msg);
  if (socket) {
    try {
      assertPlatformSocketAllowed(socket);
    } catch (error) {
      respondToWebview(webview, msg.id, false, undefined, error instanceof Error ? error.message : String(error));
      return true;
    }
  }
  switch (msg.type) {
    case "token.refresh": {
      const token = (await getTenantJwt(ctx.secrets)) ?? null;
      respondToWebview(webview, msg.id, true, { token });
      return true;
    }
    case "local.persistence": {
      const request = msg as WebviewInbound & { method?: unknown; args?: unknown[] };
      const answer = await callLocalPersistence(localBrainApplication(ctx).persistence, request.method, request.args, logLine);
      if (answer.ok) respondToWebview(webview, msg.id, true, answer.result);
      else respondToWebview(webview, msg.id, false, undefined, answer.error);
      return true;
    }
    case "signin":
      void vscode.commands.executeCommand("builderforce.signIn");
      return true;
    // The `/` menu's mode control and the first-run question: applied at once (the turn
    // the question held runs in it), persisted, and re-pushed to every panel via `init`.
    case "setInferenceMode": {
      const mode = (msg as WebviewInbound & { mode?: unknown }).mode;
      if (isInferenceMode(mode)) void setInferenceMode(mode);
      return true;
    }
    // "Download a local model" from the chat banner: the model picker's on-device list.
    case "downloadLocalModel":
      void vscode.commands.executeCommand(DOWNLOAD_LOCAL_MODEL_COMMAND);
      return true;
    case "api.failure":
      logLine(apiFailureLine(msg as ApiFailureMessage));
      return true;
    default:
      return false;
  }
}
