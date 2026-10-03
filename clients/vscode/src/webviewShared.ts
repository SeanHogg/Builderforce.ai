import * as vscode from "vscode";
import { getBaseUrl } from "./gateway";
import { makeNonce, renderBundleShell } from "./webviewBundleShell";
import { handleSharedHostMessage, postToWebview, respondToWebview, type WebviewInbound } from "./webviewHostBridge";

// Re-exported for the board panel, which builds its own (non-bundle) shell.
export { makeNonce };

/**
 * The shared HTML shell for the bundled-React webview panels (the workspace —
 * board and chat — plus Project 360 and the project pages). Identical CSP
 * (`default-src 'none'`, a nonce'd module script, and the gateway origin allowed in
 * `connect-src` with an `https:` fallback) and asset wiring across all of them, so
 * only the `<title>` differs.
 *
 * There is ONE bundle now. `assetDir` used to choose between a chat bundle and a
 * canvas bundle; the two merged when chat became a SURFACE of the board rather than
 * a place of its own, so there is nothing left to choose between. The capabilities
 * the board needs are therefore always granted: any panel can now BE the board.
 */
export function renderWebviewHtml(
  webview: vscode.Webview,
  ctx: vscode.ExtensionContext,
  opts: { title: string },
): string {
  // The gateway/API origin the app fetches directly; allowed in connect-src.
  let apiOrigin = "https://api.builderforce.ai";
  try {
    apiOrigin = new URL(getBaseUrl()).origin;
  } catch {
    /* keep default */
  }
  return renderBundleShell({
    cspSource: webview.cspSource,
    nonce: makeNonce(),
    apiOrigin,
    assetUrl: (f) => webview.asWebviewUri(vscode.Uri.joinPath(ctx.extensionUri, "media", "webview", f)).toString(),
    title: opts.title,
  });
}

// The inbound envelope is declared once, beside the bridge that consumes it.
// Re-exported here because the panel subclasses import it from their base.
export type { WebviewInbound } from "./webviewHostBridge";

/**
 * Shared lifecycle for the bundled-React webview panels. Creates the panel with the
 * standard options, installs the HTML shell, pumps messages (handling the two
 * host-owned cases every panel shares — `token.refresh` and `signin` — centrally),
 * and tears down on dispose. Subclasses supply only their unique message handling
 * ({@link onMessage}) and registry cleanup ({@link onDispose}); those that re-pull on
 * refocus opt in via {@link onDidBecomeVisible}.
 */
export abstract class WebviewPanelBase<M extends WebviewInbound = WebviewInbound> {
  protected readonly panel: vscode.WebviewPanel;
  protected readonly disposables: vscode.Disposable[] = [];
  private readonly htmlTitle: string;

  protected constructor(
    protected readonly ctx: vscode.ExtensionContext,
    init: { viewType: string; title: string; htmlTitle: string; localResourceRoots?: vscode.Uri[] },
  ) {
    this.htmlTitle = init.htmlTitle;
    this.panel = vscode.window.createWebviewPanel(
      init.viewType,
      init.title,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: init.localResourceRoots ?? [vscode.Uri.joinPath(ctx.extensionUri, "media")],
      },
    );
    this.panel.iconPath = vscode.Uri.joinPath(ctx.extensionUri, "media", "icon.png");
    // Listener before html — same race as EvermindViewProvider: the bundle posts
    // `ready` at module load, and a dropped ready leaves the panel on the sign-in wall.
    this.panel.webview.onDidReceiveMessage((m) => void this.dispatchMessage(m as M), undefined, this.disposables);
    this.panel.webview.html = this.renderHtml(this.panel.webview);
    this.panel.onDidDispose(() => this.teardown(), undefined, this.disposables);
  }

  /** The panel's HTML. Defaults to the shared bundled-React shell (Brain / Project 360 /
   *  project pages); panels with a bespoke self-contained UI — the native Kanban board —
   *  override this to supply their own document while still sharing the lifecycle above. */
  protected renderHtml(webview: vscode.Webview): string {
    return renderWebviewHtml(webview, this.ctx, { title: this.htmlTitle });
  }

  /** Re-pull the screen when the panel regains focus (Project 360 / project pages). */
  protected onDidBecomeVisible(cb: () => void): void {
    this.panel.onDidChangeViewState(
      (e) => {
        if (e.webviewPanel.visible) cb();
      },
      undefined,
      this.disposables,
    );
  }

  /** Route the shared, host-owned cases; delegate everything else to the subclass.
   *  The shared set lives in `webviewHostBridge` because the Evermind SIDEBAR VIEW
   *  answers the same messages and cannot extend this panel base. */
  private async dispatchMessage(msg: M): Promise<void> {
    if (await handleSharedHostMessage(this.ctx, this.panel.webview, msg)) return;
    await this.onMessage(msg);
  }

  /** Fire-and-forget post to the webview. */
  protected post(msg: unknown): void {
    postToWebview(this.panel.webview, msg);
  }

  /** Reply to a webview `request` round-trip; a no-op without an id (fire-and-forget). */
  protected respond(id: string | undefined, ok: boolean, result?: unknown, error?: string): void {
    respondToWebview(this.panel.webview, id, ok, result, error);
  }

  private teardown(): void {
    this.onDispose();
    for (const d of this.disposables) {
      try {
        d.dispose();
      } catch {
        /* noop */
      }
    }
  }

  /** This surface's unique message handling (the shared cases are already handled). */
  protected abstract onMessage(msg: M): void | Promise<void>;

  /** Drop this panel from its subclass registry (static `current` / `panels` map). */
  protected abstract onDispose(): void;
}
