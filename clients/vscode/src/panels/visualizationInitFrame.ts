/**
 * The init frame the Visualization panel posts — the WORKSPACE frame, re-addressed.
 *
 * The panel used to assemble a narrow frame of its own (session, token, labels — no
 * model route, no grounding, no editor context) and answer only `ready`. The board
 * it draws is the SAME `CreationCanvas` the editor tab draws, and that component
 * reaches the host for persistence, captures, runs and its error report; a narrow
 * frame and a one-case handler left every one of those calls unanswered, and the
 * webview mounted the canvas outside the providers it reads (`useTranslations` with
 * no intl context) — "The board could not be drawn." on every open.
 *
 * So the panel now hosts the one `WorkspaceSurface` (as the editor tab and the sidebar
 * chat view do) and its frame is `buildWorkspaceInit`'s, passed through this pure
 * step. It is pure — and its own module — so the invariants that make the panel route
 * to the right screen are asserted without an extension host.
 */

/** The workspace frame, as this step reads it. */
export type WorkspaceInitFrame = Record<string, unknown>;

/** The frame the webview routes to `VisualizationScreen`. */
export type VisualizationInitFrame = Omit<WorkspaceInitFrame, "surface" | "boardBeside"> & { view: "visualization" };

/**
 * Three decisions are encoded here rather than left to the caller, because getting
 * any of them wrong produces a panel that looks fine and shows the wrong thing:
 *
 * 1. `view` is the LITERAL `"visualization"`. The webview routes on it (`WorkspaceApp`);
 *    without it the root falls back to the workspace screen — the chat, in the panel
 *    that exists to hold the board.
 * 2. `surface` is ABSENT. It is the board's own persisted surface preference; this
 *    panel shows whatever the user left, and the webview sanitizes an absent value
 *    back to the default rather than blanking (`sanitizeCanvasSurface`).
 * 3. `boardBeside` is ABSENT. It tells the SIDEBAR chat that its board lives in this
 *    panel; read here, it would render the chat instead of the board.
 *
 * A `pendingChanges` of `undefined` (no workspace, no git) is dropped rather than sent
 * as an undefined-valued key: `bridgeState` seeds from the key's presence.
 */
export function asVisualizationFrame(frame: WorkspaceInitFrame): VisualizationInitFrame {
  const { surface: _surface, boardBeside: _beside, ...rest } = frame;
  if (rest.pendingChanges === undefined) delete rest.pendingChanges;
  return { ...rest, view: "visualization" };
}
