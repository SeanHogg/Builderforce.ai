import * as vscode from "vscode";
import { WebviewPanelBase } from "./webviewShared";
import { workspaceCanvasSession, type WorkspaceCanvasSession } from "./workspaceSession";
import { WorkspaceSurface, type BrainInbound } from "./workspaceSurface";
import { asVisualizationFrame } from "./visualizationInitFrame";

/**
 * The RIGHT-HAND half of the chat split: the same Creation Canvas beside the live run's
 * changes (AC2). It boots the SAME bundle, the same CSP and the same assets as the
 * workspace panel (`renderWebviewHtml`, inherited), and the webview routes its
 * `init.view: "visualization"` to `VisualizationScreen` (`webview/src/WorkspaceApp.tsx`).
 *
 * WHAT IT HOSTS: the one {@link WorkspaceSurface} — exactly as the editor tab
 * (`BuilderForcePanel`) and the sidebar chat view do. The board this panel draws is the
 * same component, and it reaches the host for persistence, captures, run frames and
 * its error report; a panel that answered only `ready` (as this one first did) left
 * every one of those unanswered and the board failed to draw. The surface also brings
 * the run mirror, the live working tree, theme re-push and sign-in refresh, so nothing
 * here re-implements them.
 *
 * What stays the panel's own: where it opens, and that there is only one.
 */
export class VisualizationPanel extends WebviewPanelBase<BrainInbound> {
  /** One reused panel: asking for the visualization twice reveals it, never stacks tabs. */
  private static current: VisualizationPanel | undefined;

  /** The open in flight: the session lookup can be a network round trip, and a second
   *  caller in that window (the auto-open and an early Visualize click) must not get a
   *  second tab. */
  private static opening: Promise<void> | undefined;

  private readonly surface: WorkspaceSurface;

  private constructor(ctx: vscode.ExtensionContext, session: WorkspaceCanvasSession) {
    // In the editor area, NOT beside the user's file: the chat now lives in the sidebar,
    // so `Beside` would split whatever code editor is focused. Opened without stealing
    // focus — the person is typing in the chat or reading a file when it appears.
    super(ctx, {
      viewType: "builderforce.visualization",
      title: vscode.l10n.t("BuilderForce Visualization"),
      htmlTitle: "BuilderForce Visualization",
      show: { viewColumn: vscode.ViewColumn.Active, preserveFocus: true },
    });
    // The board is the SAME session the chat is working in — the canvas must not fork
    // into a second board, or the user would edit one and see the other.
    // It holds no conversation, so it offers no page engines: the host prefers the newest
    // webview's, and this one opens beside the chat — it would load the chat's models.
    this.surface = new WorkspaceSurface(
      ctx,
      { webview: this.panel.webview, owner: this.panel, frame: asVisualizationFrame, offersPageEngines: false },
      session,
      "graph",
    );
  }

  /** Open (or reveal) the visualization panel in the editor area. Rejects when the
   *  board's session could not be resolved, so a caller can try again later. */
  static open(ctx: vscode.ExtensionContext): Promise<void> {
    if (VisualizationPanel.current) {
      VisualizationPanel.current.panel.reveal(undefined, true);
      return Promise.resolve();
    }
    VisualizationPanel.opening ??= workspaceCanvasSession(ctx)
      .then((session) => {
        VisualizationPanel.current ??= new VisualizationPanel(ctx, session);
      })
      .finally(() => {
        VisualizationPanel.opening = undefined;
      });
    return VisualizationPanel.opening;
  }

  protected onMessage(msg: BrainInbound): Promise<void> {
    return this.surface.handle(msg);
  }

  protected onDispose(): void {
    this.surface.dispose();
    if (VisualizationPanel.current === this) VisualizationPanel.current = undefined;
  }
}
