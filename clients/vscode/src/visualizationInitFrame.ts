import type { WorkspaceCanvasSession } from "./workspaceSession";

/**
 * The init frame the Visualization panel posts — ASSEMBLED, not resolved.
 *
 * Why this is a pure function and not just an inline `post()` in `visualizationPanel.ts`:
 * the very first version of this panel shipped with no `ready` handler at all, so the
 * webview sat on "Connecting…" forever. The failure mode was invisible — everything
 * type-checked, the command existed, the panel opened. It is only catchable by a test
 * that asserts WHAT THE HOST SENDS, which needs the frame to be a value a test can
 * build without an extension host (this package's suites run in plain node with no
 * `vscode` mock — that is why `visualizationViewState.ts` is its own module too).
 *
 * So the contract lives here: which fields the visualization screen needs, and the
 * invariants that make it render rather than blank. Everything environment-bound
 * (locale, theme, labels, token) is passed in by the caller.
 */

/** The four facts the visualization screen cannot render without. */
export interface VisualizationInitInput {
  /** `vscode.env.language`, passed through — the webview maps it onto a shipped catalog. */
  locale: string;
  /** Whether the editor is in a light theme, as a plain string. */
  colorTheme: "light" | "dark";
  /** Every label bundle. The canvas is the same component the workspace panel draws,
   *  so it reads the same keys — a narrower bundle would print raw keys on the board. */
  labels: Record<string, string>;
  /** The board this panel shows, and the session that owns it. */
  session: WorkspaceCanvasSession;
  /** Signed-in state, and the tenant JWT when there is one (`null` signed out). */
  signedIn: boolean;
  token: string | null;
  /** The gateway base URL. */
  baseUrl: string;
  /** The public web origin — a webview's own origin is `vscode-webview://…`, which is
   *  useless to whoever receives a link built from it. */
  webOrigin: string;
  /** The working tree at boot. `undefined` on a host with no workspace or no git. */
  pendingChanges?: unknown;
  /** The selected project, or `null`. */
  project?: unknown;
}

/** The init frame, as the webview's `InitData` sees it. */
export interface VisualizationInitFrame {
  type: "init";
  view: "visualization";
  baseUrl: string;
  token: string | null;
  signedIn: boolean;
  project: unknown;
  labels: Record<string, string>;
  locale: string;
  colorTheme: "light" | "dark";
  session: { id: string; title: string; webOrigin: string; durable: boolean };
  pendingChanges?: unknown;
}

/**
 * Build the frame. Two decisions are encoded here rather than left to the caller,
 * because getting either wrong produces a panel that looks fine and shows nothing:
 *
 * 1. `view` is the LITERAL `"visualization"`, not a parameter. The webview routes on it
 *    (`WorkspaceApp`), so a caller that could pass something else would send a frame the
 *    React root has no branch for — and the webview falls back to the workspace screen,
 *    which renders the chat: a panel that opened, drew, and was the wrong product.
 * 2. `surface` is deliberately ABSENT. It is the board's own persisted surface
 *    preference; this panel shows whatever the user left, and the webview sanitizes an
 *    absent value back to the default rather than blanking (`sanitizeCanvasSurface`).
 */
export function buildVisualizationInitFrame(input: VisualizationInitInput): VisualizationInitFrame {
  const { session } = input;
  return {
    type: "init",
    view: "visualization",
    baseUrl: input.baseUrl,
    token: input.token,
    signedIn: input.signedIn,
    project: input.project ?? null,
    labels: input.labels,
    locale: input.locale,
    colorTheme: input.colorTheme,
    session: {
      id: session.id,
      title: session.title,
      webOrigin: input.webOrigin,
      durable: session.durable,
    },
    ...(input.pendingChanges === undefined ? {} : { pendingChanges: input.pendingChanges }),
  };
}