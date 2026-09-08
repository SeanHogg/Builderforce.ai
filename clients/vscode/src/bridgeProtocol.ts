/**
 * The webview↔host message vocabulary — ONE declaration, both sides.
 *
 * ── THE PROBLEM THIS SOLVES ─────────────────────────────────────────────────
 * The bridge was stringly typed end to end: `post(type: string, …)` accepted any
 * string, and every host dispatched on `switch (msg.type)` with a `default` that
 * did nothing. So a message name that existed on ONE side only — a typo, a rename
 * that missed a call site, a case added to the wrong panel's switch — compiled,
 * shipped, and was a permanent silent no-op. Nothing anywhere could observe the
 * difference between "the host ignored this" and "the host has never heard of it".
 *
 * Naming every message in one union turns that class of bug into a compile error:
 * the sender cannot invent a name, and {@link assertHandled} lets a host prove at
 * compile time that its switch is exhaustive over the slice it owns.
 *
 * ── WHY NOT A PACKAGE ───────────────────────────────────────────────────────
 * The host (`src/`) and the webview (`webview/src/`) are one project tree, and the
 * webview already imports host modules directly (`../../src/idePersona`,
 * `../../src/gitChangeModel`). A separate workspace package would buy nothing and
 * cost a tsconfig path, a vite alias, an esbuild external and a `sourcePackages`
 * entry — four more places for the wiring to be incomplete, which is the failure
 * mode `check-source-package-graph` exists for.
 *
 * ── THE SLICES ──────────────────────────────────────────────────────────────
 * Messages are grouped by WHICH HOST answers them, because that is the boundary
 * that actually matters: a name in the wrong group is a message sent to a surface
 * that will never handle it.
 */

/** Answered by every surface — see `webviewHostBridge.handleSharedHostMessage`. */
export const SHARED_HOST_MESSAGES = [
  /** Re-mint the tenant JWT (the webview cannot reach secret storage). */
  'token.refresh',
  /** Run the sign-in command (the webview cannot execute commands). */
  'signin',
] as const;

/** The Brain panel: the run loop, the tool bridge and the editor's own state. */
export const BRAIN_HOST_MESSAGES = [
  'ready',
  'run.start',
  'run.stop',
  'run.confirm',
  'run.autoApprove',
  'run.clearError',
  'llm.fetch',
  'llm.abort',
  'model.set',
  'session.meta',
  'settings',
  'context.pick',
  'copy',
  'diagnose',
  'chats.changed',
  'open.web',
  'open.artifact',
  'changes.open',
  'changes.review',
  'fetchLimbic',
] as const;

/** Project 360 and the project pages. */
export const PROJECT_HOST_MESSAGES = ['p360.action', 'page.action'] as const;

/** The Evermind sidebar view — the host owns these because only it has a filesystem. */
export const EVERMIND_HOST_MESSAGES = [
  'evermind.pickMemory',
  'evermind.compactMemory',
  'evermind.copyText',
] as const;

/** The canvas surface of the workspace panel. */
export const CANVAS_HOST_MESSAGES = [
  'canvas.capture',
  'canvas.navigate',
  'canvas.openFile',
  'canvas.i18nError',
  // The board threw and the panel fell back to the conversation. Reported to the HOST
  // because a webview's console is not somewhere anyone looks, which is how a board
  // that fails to draw becomes a bug report reading only "it doesn't load".
  'canvas.error',
] as const;

/** Every message the webview may send to a host. */
export const HOST_MESSAGES = [
  ...SHARED_HOST_MESSAGES,
  ...BRAIN_HOST_MESSAGES,
  ...PROJECT_HOST_MESSAGES,
  ...EVERMIND_HOST_MESSAGES,
  ...CANVAS_HOST_MESSAGES,
] as const;

export type SharedHostMessage = (typeof SHARED_HOST_MESSAGES)[number];
export type BrainHostMessage = (typeof BRAIN_HOST_MESSAGES)[number];
export type ProjectHostMessage = (typeof PROJECT_HOST_MESSAGES)[number];
export type EvermindHostMessage = (typeof EVERMIND_HOST_MESSAGES)[number];
export type CanvasHostMessage = (typeof CANVAS_HOST_MESSAGES)[number];

/** The name of any message the webview sends to the host. */
export type HostMessageType = (typeof HOST_MESSAGES)[number];

/**
 * Prove a host's `switch` covered every message in its slice.
 *
 * Call it in the `default` branch with the narrowed `msg.type`. Once every case is
 * present TypeScript narrows that value to `never` and the call compiles; the
 * moment a name is added to this file and not to that switch, it does not — which
 * is the whole point, because the runtime symptom is silence.
 *
 * It returns rather than throws: an unrecognised message at RUNTIME (an older
 * webview bundle against a newer host, which is a real state during an upgrade)
 * must be ignored, not crash the panel.
 */
export function assertHandled(_exhausted: never): void {
  /* compile-time only */
}
