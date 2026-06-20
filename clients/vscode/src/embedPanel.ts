import * as vscode from "vscode";
import { getTenantJwt } from "./bfApi";
import { getBaseUrl } from "./gateway";

const BFEMBED_SOURCE = "builderforce-embed/v1";

/** The web app URL (derived from the gateway base: api.builderforce.ai → builderforce.ai),
 *  overridable via `builderforce.webUrl`. The embed pages live here. */
function webBaseUrl(): string {
  const override = vscode.workspace.getConfiguration("builderforce").get<string>("webUrl");
  if (override) return override.replace(/\/+$/, "");
  try {
    const u = new URL(getBaseUrl());
    u.hostname = u.hostname.replace(/^api\./, "");
    u.pathname = "";
    u.search = "";
    return u.toString().replace(/\/+$/, "");
  } catch {
    return "https://builderforce.ai";
  }
}

export interface EmbedOpenOptions {
  title?: string;
  /** URL hash deep-link, e.g. "projectId=123". */
  hash?: string;
}

/**
 * Opens a BuilderForce web page (the existing `/embed/<view>` surface) as an editor panel
 * in VS Code — reusing the real frontend (DRY), not a reimplementation. Implements the
 * host side of the embed protocol: on the iframe's `ready`, it hands over a tenant JWT
 * (exchanged from the stored gateway key) so the page renders authenticated.
 */
export class EmbedPanel {
  private static readonly panels = new Map<string, EmbedPanel>();

  static open(ctx: vscode.ExtensionContext, view: string, opts: EmbedOpenOptions = {}): void {
    const keyId = `${view}#${opts.hash ?? ""}`;
    const existing = EmbedPanel.panels.get(keyId);
    if (existing) {
      existing.panel.reveal();
      return;
    }
    EmbedPanel.panels.set(keyId, new EmbedPanel(ctx, view, opts, keyId));
  }

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];

  private constructor(
    private readonly ctx: vscode.ExtensionContext,
    view: string,
    opts: EmbedOpenOptions,
    keyId: string,
  ) {
    const webUrl = webBaseUrl();
    const embedOrigin = new URL(webUrl).origin;
    const src = `${webUrl}/embed/${encodeURIComponent(view)}${opts.hash ? `#${opts.hash}` : ""}`;

    this.panel = vscode.window.createWebviewPanel(
      "builderforce.embed",
      opts.title ?? `BuilderForce: ${view}`,
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.panel.iconPath = vscode.Uri.joinPath(ctx.extensionUri, "media", "icon.png");
    this.panel.webview.html = this.html(this.panel.webview, src, embedOrigin);

    this.panel.webview.onDidReceiveMessage(
      async (m: { type: string }) => {
        if (m.type === "authNeeded") {
          const token = await getTenantJwt(this.ctx.secrets);
          if (!token) {
            this.panel.webview.postMessage({ type: "noauth" });
            return;
          }
          const theme =
            vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Light ? "light" : "dark";
          this.panel.webview.postMessage({ type: "auth", token, theme });
        } else if (m.type === "signin") {
          void vscode.commands.executeCommand("builderforce.signIn");
        }
      },
      undefined,
      this.disposables,
    );

    this.panel.onDidDispose(
      () => {
        EmbedPanel.panels.delete(keyId);
        for (const d of this.disposables) {
          try {
            d.dispose();
          } catch {
            /* noop */
          }
        }
      },
      undefined,
      this.disposables,
    );
  }

  private html(webview: vscode.Webview, src: string, embedOrigin: string): string {
    const nonce = makeNonce();
    const csp = [
      `default-src 'none'`,
      `frame-src ${embedOrigin}`,
      `script-src 'nonce-${nonce}'`,
      `style-src 'nonce-${nonce}'`,
    ].join("; ");
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<style nonce="${nonce}">
  html, body, #f { height: 100%; width: 100%; margin: 0; border: 0; }
  body { background: var(--vscode-editor-background); }
  #msg { display: none; padding: 24px; color: var(--vscode-foreground); font-family: var(--vscode-font-family); }
  #msg button { margin-top: 10px; }
</style>
</head>
<body>
<div id="msg">Sign in to BuilderForce to view this page.<br/><button id="signin">Sign in</button></div>
<iframe id="f" src="${src}" allow="clipboard-read; clipboard-write"></iframe>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const EMBED_ORIGIN = ${JSON.stringify(embedOrigin)};
  const SRC = ${JSON.stringify(BFEMBED_SOURCE)};
  const iframe = document.getElementById('f');
  const msg = document.getElementById('msg');
  document.getElementById('signin').addEventListener('click', () => vscode.postMessage({ type: 'signin' }));

  window.addEventListener('message', (e) => {
    // Messages from the embedded page.
    if (e.origin === EMBED_ORIGIN && e.data && e.data.source === SRC) {
      if (e.data.type === 'ready') vscode.postMessage({ type: 'authNeeded' });
      return;
    }
    // Messages from the extension host.
    const m = e.data;
    if (m && m.type === 'auth') {
      msg.style.display = 'none';
      iframe.contentWindow && iframe.contentWindow.postMessage(
        { source: SRC, type: 'auth', token: m.token, theme: m.theme }, EMBED_ORIGIN);
    } else if (m && m.type === 'noauth') {
      msg.style.display = 'block';
    }
  });
</script>
</body>
</html>`;
  }
}

function makeNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 32; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}
