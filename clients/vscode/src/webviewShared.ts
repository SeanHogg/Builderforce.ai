import * as vscode from "vscode";
import { getBaseUrl } from "./gateway";
import { handleSharedHostMessage, postToWebview, respondToWebview, type WebviewInbound } from "./webviewHostBridge";

/** A random nonce for the webview CSP (`script-src`/inline `<style>` on the board). */
export function makeNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 32; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

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
  const nonce = makeNonce();
  const asset = (f: string) =>
    webview.asWebviewUri(vscode.Uri.joinPath(ctx.extensionUri, "media", "webview", f));
  // The React app fetches the gateway/API directly; allow that origin in connect-src.
  let apiOrigin = "https://api.builderforce.ai";
  try {
    apiOrigin = new URL(getBaseUrl()).origin;
  } catch {
    /* keep default */
  }
  // A nonce authorises the ENTRY script only — it does not extend to modules that
  // script imports. The bundle is code-split (the board's own dependencies, the
  // Evermind engines, the voice studio and mermaid load on demand), so its chunks
  // must be allowed by origin or every lazy feature dies at the import.
  const scriptSrc = `'nonce-${nonce}' ${webview.cspSource} 'wasm-unsafe-eval'`;
  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource} https: data: blob:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src ${scriptSrc}`,
    `font-src ${webview.cspSource} data:`,
    `connect-src ${apiOrigin} https: blob: data:`,
    // The canvas renders generated artefacts: website/mockup previews in frames,
    // audio + video deliverables, and WebGPU/WASM training in a worker. Always
    // granted now that every panel can be the board.
    //
    // `https:` carries the canvas Web page panel, which frames an arbitrary address
    // the user typed or dropped; the allowlist alternative cannot express "any
    // page". Frames are sandboxed and cross-origin. The loopback origins are what
    // make a `service` object — the dev server running in this very editor —
    // previewable, which the deployed web app cannot do at all (a https page may
    // not frame http).
    `frame-src ${webview.cspSource} https: http://localhost:* http://127.0.0.1:* blob: data:`,
    `media-src ${webview.cspSource} https: blob: data:`,
    `worker-src ${webview.cspSource} blob:`,
  ].join("; ");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<link rel="stylesheet" href="${asset("index.css")}" />
<title>${opts.title}</title>
</head>
<body>
<div id="root"></div>
<script type="module" nonce="${nonce}" src="${asset("index.js")}"></script>
</body>
</html>`;
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
    this.panel.webview.html = this.renderHtml(this.panel.webview);
    this.panel.webview.onDidReceiveMessage((m) => void this.dispatchMessage(m as M), undefined, this.disposables);
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
