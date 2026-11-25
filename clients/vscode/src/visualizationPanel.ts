import * as vscode from "vscode";
import { WebviewPanelBase } from "./panels/webviewShared";
import { workspaceCanvasSession, type WorkspaceCanvasSession } from "./workspace/workspaceSession";
import { WorkspaceSurface, type BrainInbound } from "./workspaceSurface";
import { asVisualizationFrame } from "./visualizationInitFrame";
import { KnowledgeBridge, setPendingKnowledgeFocus } from "./knowledge/knowledgeBridge";
import { KNOWLEDGE_CALL, KNOWLEDGE_EDITOR, KNOWLEDGE_FOCUS, type KnowledgeCall, type KnowledgeEditorFrame, type KnowledgeFocusFrame } from "./knowledge/knowledgeProtocol";
import { editorFrameOf, sameFrame } from "./knowledge/knowledgeEditorFrame";
import { messageOf } from "./messageOf";

/** At most one `knowledge.editor` post per this window (ms): the LAST editor state in it, posted when it ends. */
export const EDITOR_FEED_MS = 100;

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
  /** The Knowledge view's host side (PRD 38): its calls never reach the board's surface. */
  private readonly knowledge: KnowledgeBridge;

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
      { webview: this.webview, owner: this.panel, frame: asVisualizationFrame, offersPageEngines: false },
      session,
      "graph",
    );
    // The CAPTURED webview (via `post`): a knowledge review run can finish after the
    // panel closed, and re-reading `panel.webview` then throws "Webview is disposed".
    this.knowledge = new KnowledgeBridge({ ctx, post: (msg) => this.post(msg) });
    // The code band follows the editor only while the panel shows: hidden, it listens to nothing.
    this.followEditor(this.panel.visible);
    this.panel.onDidChangeViewState((e) => this.followEditor(e.webviewPanel.visible), undefined, this.disposables);
  }

  /** The editor listeners while the panel is visible (empty when hidden). */
  private editorFeed: vscode.Disposable[] = [];
  /** The trailing post pending in the current {@link EDITOR_FEED_MS} window. */
  private editorTimer: ReturnType<typeof setTimeout> | undefined;
  /** The text editor last scrolled, selected in or focused: the panel itself taking focus leaves no active text editor. */
  private editorSeen: vscode.TextEditor | undefined;
  private lastEditorFrame: KnowledgeEditorFrame | null = null;

  private followEditor(visible: boolean): void {
    if (!visible) { this.stopEditorFeed(); return; }
    if (this.editorFeed.length > 0) return;
    const seen = (editor: vscode.TextEditor | undefined): void => {
      if (editor) this.editorSeen = editor;
      this.editorTimer ??= setTimeout(() => { this.editorTimer = undefined; this.postEditor(); }, EDITOR_FEED_MS);
    };
    this.editorFeed = [
      vscode.window.onDidChangeTextEditorVisibleRanges((e) => seen(e.textEditor)),
      vscode.window.onDidChangeTextEditorSelection((e) => seen(e.textEditor)),
      vscode.window.onDidChangeActiveTextEditor((editor) => seen(editor)),
    ];
    // Shown again: say where the editor is now, the view may have missed every change while hidden.
    this.lastEditorFrame = null;
    seen(vscode.window.activeTextEditor ?? vscode.window.visibleTextEditors[0]);
  }

  private stopEditorFeed(): void {
    for (const d of this.editorFeed) d.dispose();
    this.editorFeed = [];
    if (this.editorTimer !== undefined) clearTimeout(this.editorTimer);
    this.editorTimer = undefined;
  }

  /** Posts the last-seen editor's view when it shows a file of the loaded root and differs from the last post. */
  private postEditor(): void {
    const frame = editorFrameOf(this.editorSeen, this.knowledge.loadedRoot());
    if (!frame || sameFrame(frame, this.lastEditorFrame)) return;
    this.lastEditorFrame = frame;
    this.post({ type: KNOWLEDGE_EDITOR, ...frame });
  }

  /**
   * Open (or reveal) the panel on its Knowledge view, focused on `frame.focus` — the
   * `builderforce.openKnowledgeGraph` command (Open in graph chips, `/graph`). The focus
   * waits for the view to take it when the panel is still booting.
   */
  static async openKnowledge(ctx: vscode.ExtensionContext, frame: KnowledgeFocusFrame): Promise<void> {
    setPendingKnowledgeFocus(frame);
    await VisualizationPanel.open(ctx);
    const current = VisualizationPanel.current;
    if (current) current.post({ type: KNOWLEDGE_FOCUS, ...frame });
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

  protected async onMessage(msg: BrainInbound): Promise<void> {
    if (msg.type !== KNOWLEDGE_CALL) return this.surface.handle(msg);
    const { type: _type, id, ...call } = msg as unknown as KnowledgeCall & { type: string; id?: string };
    try {
      this.respond(id, true, await this.knowledge.handle(call as KnowledgeCall));
    } catch (error) {
      this.respond(id, false, undefined, messageOf(error));
    }
  }

  protected onDispose(): void {
    this.stopEditorFeed();
    this.surface.dispose();
    this.knowledge.dispose();
    if (VisualizationPanel.current === this) VisualizationPanel.current = undefined;
  }
}
