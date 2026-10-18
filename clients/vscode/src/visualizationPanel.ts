import * as vscode from "vscode";
import { getBaseUrl, getWebBaseUrl, SECRET_KEY } from "./gateway";
import { getTenantJwt } from "./bfApi";
import { WebviewPanelBase } from "./webviewShared";
import { detectPendingChanges, watchPendingChanges } from "./gitChanges";
import { canvasLabels, isLightTheme } from "./canvasHostActions";
import { authLabels } from "./authLabels";
import { subagentLabels } from "./subagentLabels";
import { localModelLabels } from "./localModelLabels";
import { chatTicketsLabels } from "./chatTicketsLabels";
import { chatSurfaceLabels } from "./chatSurfaceLabels";
import { workStatusLabels } from "./workStatusLabels";
import { getSelectedProject } from "./projectState";
import { workspaceCanvasSession, type WorkspaceCanvasSession } from "./workspaceSession";
import type { BrainRunHost } from "./brainRunHost";
import { buildVisualizationInitFrame } from "./visualizationInitFrame";

/**
 * The RIGHT-HAND half of the chat split: the same Creation Canvas beside the live run's
 * changes (AC2). It boots the SAME bundle, the same CSP and the same assets as the
 * workspace panel (`renderWebviewHtml`, inherited) — the only differences are the
 * `<title>` and `init.view: "visualization"`, which the shared React root routes to
 * `VisualizationScreen` (see `webview/src/WorkspaceApp.tsx`).
 *
 * WHY A CLASS AND NOT A RAW `createWebviewPanel`:
 * the first version of this command built the panel inline and shipped — and the
 * webview sat on "Connecting…" forever. The bundle posts `ready` at module load and
 * the host must ANSWER it; with no `onDidReceiveMessage` listener at all the frame went
 * nowhere, so `init` was never sent and `WorkspaceApp` (which renders nothing until it
 * has one) never left its boot screen. Every other bundled surface has exactly this
 * `ready` case — this file is the one that had none. Subclassing `WebviewPanelBase`
 * buys the listener, the shared `token.refresh` / `signin` handling and the dispose
 * teardown, and leaves this class supplying only what is genuinely its own.
 */
export class VisualizationPanel extends WebviewPanelBase<VisualizationInbound> {
  /** One reused panel: asking for the visualization twice reveals it, never stacks tabs. */
  private static current: VisualizationPanel | undefined;

  private detachRuns?: () => void;

  private constructor(
    ctx: vscode.ExtensionContext,
    private readonly session: WorkspaceCanvasSession,
    private readonly runHost: BrainRunHost,
  ) {
    // Beside, not on top of: the point of the panel is that the chat stays visible
    // next to it. `WebviewPanelBase` opens Active, so the column is taken here.
    super(ctx, {
      viewType: "builderforce.visualization",
      title: vscode.l10n.t("BuilderForce Visualization"),
      htmlTitle: "BuilderForce Visualization",
    });
    this.panel.reveal(vscode.ViewColumn.Beside, true);
    // The canvas picks its palette from the editor theme, as the workspace panel does.
    this.disposables.push(vscode.window.onDidChangeActiveColorTheme(() => void this.sendInit()));
    // The run's file list is the panel's reason to exist (AC4): a tool that writes,
    // a stage, a checkout — each one has to reach the tree.
    this.disposables.push(watchPendingChanges(() => void this.pushPendingChanges()));
  }

  /** Open (or reveal) the visualization panel beside the current chat. */
  static open(ctx: vscode.ExtensionContext, runHost: BrainRunHost): void {
    // The board is the SAME session the chat is working in — the canvas must not fork
    // into a second board, or the user would edit one and see the other.
    void workspaceCanvasSession(ctx).then((session) => {
      if (VisualizationPanel.current) {
        VisualizationPanel.current.panel.reveal(vscode.ViewColumn.Beside, true);
        return;
      }
      const panel = new VisualizationPanel(ctx, session, runHost);
      VisualizationPanel.current = panel;
    });
  }

  protected async onMessage(msg: VisualizationInbound): Promise<void> {
    if (msg.type !== "ready") return;
    // Mirror on `runHost`: every frame the workspace panel sees, this one sees too, so
    // the change tree advances as the run works. Without it the panel renders and then
    // never updates — built, wired to nothing, the exact failure this class exists to fix.
    this.detachRuns?.();
    this.detachRuns = this.runHost.attach({ post: (m) => this.post(m) });
    await this.sendInit();
  }

  private async pushPendingChanges(): Promise<void> {
    this.post({ type: "pendingChanges", pendingChanges: await detectPendingChanges() });
  }

  /**
   * The webview's config. Deliberately a SUBSET of the workspace panel's init: this
   * surface draws a board and a change tree, and needs no model picker, no tool
   * catalogue and no chat composer to have either. Every label bundle the workspace
   * panel sends is included anyway — the canvas is the same component and reads the
   * same keys, so shipping a narrower bundle would surface raw keys on the board.
   */
  private async sendInit(): Promise<void> {
    const signedIn = !!(await this.ctx.secrets.get(SECRET_KEY));
    const token = signedIn ? ((await getTenantJwt(this.ctx.secrets)) ?? null) : null;
    // Assembled by the pure builder, so the frame this surface sends is one a test can
    // assert — the "Connecting…" failure was invisible to every check that existed.
    this.post(
      buildVisualizationInitFrame({
        signedIn,
        token,
        baseUrl: getBaseUrl(),
        webOrigin: getWebBaseUrl(),
        project: getSelectedProject(),
        locale: vscode.env.language,
        colorTheme: isLightTheme() ? "light" : "dark",
        labels: {
          ...authLabels(),
          ...canvasLabels(),
          ...subagentLabels(),
          ...localModelLabels(),
          ...chatTicketsLabels(),
          ...chatSurfaceLabels(),
          ...workStatusLabels(),
        },
        session: this.session,
        pendingChanges: await detectPendingChanges(),
      }),
    );
  }

  protected onDispose(): void {
    this.detachRuns?.();
    this.detachRuns = undefined;
    if (VisualizationPanel.current === this) VisualizationPanel.current = undefined;
  }
}

/** The inbound frames this surface answers. `ready` is the only one: it draws, it does not act. */
export type VisualizationInbound = { type: "ready" };