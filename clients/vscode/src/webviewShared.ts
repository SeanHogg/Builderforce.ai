import * as vscode from "vscode";
import { getTenantJwt } from "./bfApi";
import { getBaseUrl } from "./gateway";

/** A random nonce for the webview CSP (`script-src`/inline `<style>` on the board). */
export function makeNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 32; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

/**
 * The shared HTML shell for the bundled-React webview panels (Brain / Project 360 /
 * project pages). Identical CSP (`default-src 'none'`, a nonce'd module script, and
 * the gateway origin allowed in `connect-src` with an `https:` fallback) and asset
 * wiring across all three — only the `<title>` differs per surface.
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
  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource} https: data: blob:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
    `font-src ${webview.cspSource} data:`,
    `connect-src ${apiOrigin} https:`,
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

/** The minimal inbound-message envelope every webview panel shares. */
export interface WebviewInbound {
  type?: string;
  id?: string;
}

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

  protected constructor(
    protected readonly ctx: vscode.ExtensionContext,
    init: { viewType: string; title: string; htmlTitle: string },
  ) {
    this.panel = vscode.window.createWebviewPanel(
      init.viewType,
      init.title,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(ctx.extensionUri, "media")],
      },
    );
    this.panel.iconPath = vscode.Uri.joinPath(ctx.extensionUri, "media", "icon.png");
    this.panel.webview.html = renderWebviewHtml(this.panel.webview, ctx, { title: init.htmlTitle });
    this.panel.webview.onDidReceiveMessage((m) => void this.dispatchMessage(m as M), undefined, this.disposables);
    this.panel.onDidDispose(() => this.teardown(), undefined, this.disposables);
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

  /** Route the two shared, host-owned cases; delegate everything else to the subclass. */
  private async dispatchMessage(msg: M): Promise<void> {
    switch (msg.type) {
      case "token.refresh": {
        const token = (await getTenantJwt(this.ctx.secrets)) ?? null;
        this.respond(msg.id, true, { token });
        return;
      }
      case "signin":
        void vscode.commands.executeCommand("builderforce.signIn");
        return;
      default:
        await this.onMessage(msg);
    }
  }

  /** Fire-and-forget post to the webview. */
  protected post(msg: unknown): void {
    void this.panel.webview.postMessage(msg);
  }

  /** Reply to a webview `request` round-trip; a no-op without an id (fire-and-forget). */
  protected respond(id: string | undefined, ok: boolean, result?: unknown, error?: string): void {
    if (!id) return;
    void this.panel.webview.postMessage({ type: "response", id, ok, result, error });
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
