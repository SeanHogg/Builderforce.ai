/**
 * The Creation Canvas HOST PORT.
 *
 * The canvas is ONE implementation rendered on two surfaces: the web app, and a
 * VS Code webview whose Vite build compiles these very files (see
 * `clients/vscode/webview/vite.canvas.config.ts`). Everything the canvas does is
 * identical on both — except the handful of actions only an editor can perform:
 * capture the active file, the current selection, the problems list, the
 * workspace repository or terminal output, and open a captured file back in the
 * editor.
 *
 * Rather than branch on a surface flag threaded through the tree, the editor
 * REGISTERS itself here at boot. Nothing registers on the web, so
 * {@link useCanvasHost} returns null and `<CanvasHostActions>` renders nothing —
 * the component decides its own visibility instead of being handed an `isVsCode`
 * boolean it would have to interpret.
 *
 * The host owns its own labels (it translates them through `vscode.l10n`, the
 * catalog the rest of the extension already uses), so adding an editor action
 * never means editing a web message catalog.
 */

import type { CreationObjectKind } from '@builderforce/creation-canvas-contract';

/** A source range inside a captured file, 1-based to match what editors show. */
export interface CanvasHostRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

/** An object the host captured from the editor, ready to place on the canvas. */
export interface CanvasHostCapture {
  kind: CreationObjectKind;
  title: string;
  /** Merged into the new object's `data`. `path`/`range` make it re-openable. */
  content: Record<string, unknown>;
}

/**
 * One editor-only action, contributed by the host. `run` resolves to the object
 * to add, or null when the user cancelled (or there was nothing to capture) —
 * the canvas treats null as "no change", never as an error.
 */
export interface CanvasHostAction {
  id: string;
  /** Already localized BY THE HOST — the canvas renders it verbatim. */
  label: string;
  /** A short glyph for the compact button (the label becomes its tooltip). */
  icon: string;
  run(): Promise<CanvasHostCapture | null>;
}

export interface CanvasHost {
  /** Which editor is hosting, for diagnostics reports and activity telemetry. */
  surface: 'vscode';
  actions: readonly CanvasHostAction[];
  /** Reveal a captured file in the editor, optionally at the captured range. */
  openFile(path: string, range?: CanvasHostRange): void;
  /**
   * Follow an in-app route (`/create/:id`, `/login`, …). A webview has no
   * browser history to push, so the host decides: open another Canvas panel,
   * start the sign-in command, or fall back to an external browser.
   */
  navigate(path: string): void;
  /**
   * The PUBLIC web origin (`https://builderforce.ai`). A webview's own origin is
   * `vscode-webview://…`, so any link built to be pasted elsewhere — an
   * invitation, a share URL — has to come from here rather than
   * `window.location.origin`.
   */
  webOrigin: string;
  /**
   * Where the host serves the ONNX runtime's `.wasm` from, if it serves one.
   *
   * The runtime is ~21 MB. A web bundle emits it beside the app and resolves it
   * relatively, which is right there; a VSIX would have to ship it to every user
   * for a feature (on-device voice cloning) most sessions never open. So the
   * editor omits it from the package and points the runtime at the BuilderForce
   * origin instead, fetched on first use.
   */
  wasmBaseUrl?: string;
}

let host: CanvasHost | null = null;
const listeners = new Set<() => void>();

/**
 * Install the editor host. Called once by the VS Code canvas entry before React
 * mounts; never called on the web. Passing null uninstalls it (used by tests to
 * restore the default, host-less behaviour between cases).
 */
export function registerCanvasHost(next: CanvasHost | null): void {
  host = next;
  for (const listener of [...listeners]) listener();
}

/** The registered host, or null on the web. Safe to call outside React. */
export function getCanvasHost(): CanvasHost | null {
  return host;
}

/**
 * Which surface this canvas is running on, for activity telemetry and the
 * diagnostics report. Derived from the registered host rather than passed
 * around, so a new call site can never report the wrong surface — and so the
 * VS Code canvas stops filing its usage as `web`.
 */
export function canvasSurface(): 'web' | 'vscode' {
  return host?.surface ?? 'web';
}

/**
 * Follow an in-app route from the canvas. On the web this is a full navigation
 * (the canvas replaces the whole viewport, so there is nothing to preserve); in
 * an editor the host reopens the right panel instead. ONE call site shape, so a
 * new navigation can't be added that works on only one surface.
 */
export function canvasNavigate(path: string): void {
  if (host) {
    host.navigate(path);
    return;
  }
  window.location.href = path;
}

/**
 * The origin to build user-shareable links against. Never `window.location.origin`
 * directly — inside a webview that is `vscode-webview://…`, which is useless to
 * whoever receives the link.
 */
export function canvasWebOrigin(): string {
  return host?.webOrigin ?? window.location.origin;
}

/**
 * The base URL the ONNX runtime should load its `.wasm` from, or null to keep
 * the bundler's own relative resolution (the web).
 */
export function canvasWasmBaseUrl(): string | null {
  return host?.wasmBaseUrl ?? null;
}

/** Subscribe to host registration changes (drives {@link useCanvasHost}). */
export function subscribeCanvasHost(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
