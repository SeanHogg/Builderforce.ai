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

/**
 * The real in-app route that best matches an embed view — used by the "Open in
 * Browser" escape hatch, where the user is cookie-authenticated (the `/embed`
 * surface itself is useless in a plain browser tab: it needs a host to hand it a
 * token via postMessage).
 */
function appRouteForView(view: string): string {
  const product = new Set(["backlog", "roadmap", "prd", "ideas", "feature-roi"]);
  if (product.has(view)) return "/projects";
  return "/tasks";
}

export interface EmbedOpenOptions {
  title?: string;
  /** URL hash deep-link, e.g. "projectId=123". */
  hash?: string;
}

let output: vscode.OutputChannel | undefined;
function log(line: string): void {
  output ??= vscode.window.createOutputChannel("BuilderForce Embed");
  output.appendLine(`[${new Date().toISOString()}] ${line}`);
}

/**
 * Opens a BuilderForce web page (the existing `/embed/<view>` surface) as an editor panel
 * in VS Code — reusing the real frontend (DRY), not a reimplementation. Implements the
 * host side of the embed protocol: on the iframe's `ready`, it hands over a tenant JWT
 * (exchanged from the stored gateway key) so the page renders authenticated.
 *
 * Robustness: the framed page can fail to render for reasons the webview can't see into
 * (a stale pre-deploy bundle cached by the service worker/edge, a handshake that never
 * starts). So the webview shows an explicit status overlay, and on timeout surfaces
 * Reload / Open-in-Browser / Diagnose instead of a silent blank panel. The frame URL is
 * cache-busted per load so a fresh open (or Reload) always pulls the deployed build.
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
  private readonly webUrl = webBaseUrl();

  private constructor(
    private readonly ctx: vscode.ExtensionContext,
    private readonly view: string,
    private readonly opts: EmbedOpenOptions,
    keyId: string,
  ) {
    this.panel = vscode.window.createWebviewPanel(
      "builderforce.embed",
      opts.title ?? `BuilderForce: ${view}`,
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.panel.iconPath = vscode.Uri.joinPath(ctx.extensionUri, "media", "icon.png");
    this.render();

    this.panel.webview.onDidReceiveMessage(
      (m: { type: string }) => void this.onMessage(m),
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

  /** (Re)load the iframe with a fresh cache-busting token so a new deploy / Reload
   *  never serves a stale (pre-deploy) document from the SW or edge cache. */
  private render(): void {
    const version =
      (this.ctx.extension.packageJSON as { version?: string }).version ?? "0";
    const cb = `${version}.${Date.now()}`;
    const embedOrigin = new URL(this.webUrl).origin;
    const hash = this.opts.hash ? `#${this.opts.hash}` : "";
    const src = `${this.webUrl}/embed/${encodeURIComponent(this.view)}?bfcb=${encodeURIComponent(cb)}${hash}`;
    log(`open ${this.view} → ${src}`);
    this.panel.webview.html = this.html(this.panel.webview, src, embedOrigin);
  }

  private async onMessage(m: { type: string }): Promise<void> {
    switch (m.type) {
      case "authNeeded": {
        log(`${this.view}: iframe ready → exchanging tenant token`);
        const token = await getTenantJwt(this.ctx.secrets);
        if (!token) {
          log(`${this.view}: no tenant token (not signed in / exchange failed)`);
          this.panel.webview.postMessage({ type: "noauth" });
          return;
        }
        const theme =
          vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Light ? "light" : "dark";
        log(`${this.view}: token acquired → handing to frame`);
        this.panel.webview.postMessage({ type: "auth", token, theme });
        break;
      }
      case "rendered":
        log(`${this.view}: frame painted content`);
        break;
      case "timeout":
        log(`${this.view}: frame did not render within the timeout (likely a stale cache or blocked load)`);
        break;
      case "frameError":
        log(`${this.view}: frame reported an error`);
        break;
      case "reload":
        log(`${this.view}: reload requested`);
        this.render();
        break;
      case "openExternal":
        void vscode.env.openExternal(vscode.Uri.parse(`${this.webUrl}${appRouteForView(this.view)}`));
        break;
      case "diagnose":
        void vscode.commands.executeCommand("builderforce.diagnose");
        break;
    }
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
  body { background: var(--vscode-editor-background); color: var(--vscode-foreground); font-family: var(--vscode-font-family); }
  #f { display: block; }
  .overlay {
    position: fixed; inset: 0; display: none; align-items: center; justify-content: center;
    background: var(--vscode-editor-background); padding: 24px; box-sizing: border-box;
  }
  .overlay.show { display: flex; }
  .card { max-width: 420px; text-align: center; }
  .card h3 { margin: 0 0 6px; font-size: 14px; font-weight: 600; }
  .card p { margin: 0 0 14px; color: var(--vscode-descriptionForeground); font-size: 12px; }
  .actions { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
  button {
    font: inherit; padding: 4px 12px; border: 0; border-radius: 2px; cursor: pointer;
    color: var(--vscode-button-foreground); background: var(--vscode-button-background);
  }
  button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
  .spinner { width: 18px; height: 18px; margin: 0 auto 12px; border: 2px solid var(--vscode-descriptionForeground);
    border-top-color: transparent; border-radius: 50%; animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
<iframe id="f" src="${src}" allow="clipboard-read; clipboard-write"></iframe>

<div id="loading" class="overlay show">
  <div class="card">
    <div class="spinner"></div>
    <h3 id="loading-title">Loading BuilderForce…</h3>
    <p id="loading-sub">Connecting to your workspace.</p>
  </div>
</div>

<div id="error" class="overlay">
  <div class="card">
    <h3 id="error-title">This page didn't load</h3>
    <p id="error-sub">The BuilderForce page didn't render. This is usually a cached older build — Reload pulls the latest. You can also open it in your browser.</p>
    <div class="actions">
      <button id="reload">Reload</button>
      <button id="open-ext" class="secondary">Open in Browser</button>
      <button id="diagnose" class="secondary">Diagnose</button>
    </div>
  </div>
</div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const EMBED_ORIGIN = ${JSON.stringify(embedOrigin)};
  const SRC = ${JSON.stringify(BFEMBED_SOURCE)};
  const iframe = document.getElementById('f');
  const loading = document.getElementById('loading');
  const errorBox = document.getElementById('error');
  const loadingTitle = document.getElementById('loading-title');
  const loadingSub = document.getElementById('loading-sub');
  const errorSub = document.getElementById('error-sub');

  let painted = false;
  function showLoading(title, sub) {
    loadingTitle.textContent = title;
    loadingSub.textContent = sub;
    loading.classList.add('show');
    errorBox.classList.remove('show');
  }
  function hideOverlays() { loading.classList.remove('show'); errorBox.classList.remove('show'); }
  function showError(sub) {
    if (sub) errorSub.textContent = sub;
    loading.classList.remove('show');
    errorBox.classList.add('show');
  }

  // If the frame never paints (stale/blocked/handshake-dead), surface recovery actions
  // instead of a silent blank panel.
  const timeout = setTimeout(() => {
    if (!painted) { vscode.postMessage({ type: 'timeout' }); showError(); }
  }, 15000);

  document.getElementById('reload').addEventListener('click', () => { painted = false; vscode.postMessage({ type: 'reload' }); });
  document.getElementById('open-ext').addEventListener('click', () => vscode.postMessage({ type: 'openExternal' }));
  document.getElementById('diagnose').addEventListener('click', () => vscode.postMessage({ type: 'diagnose' }));

  window.addEventListener('message', (e) => {
    // Messages from the embedded page (cross-origin frame).
    if (e.origin === EMBED_ORIGIN && e.data && e.data.source === SRC) {
      const t = e.data.type;
      if (t === 'ready') {
        vscode.postMessage({ type: 'authNeeded' });
        showLoading('Authorizing…', 'Signing in to your workspace.');
      } else if (t === 'resize' && typeof e.data.height === 'number' && e.data.height > 40) {
        // The page rendered real content — clear the overlay and stop the failsafe.
        if (!painted) { painted = true; clearTimeout(timeout); vscode.postMessage({ type: 'rendered' }); }
        hideOverlays();
      } else if (t === 'error') {
        vscode.postMessage({ type: 'frameError' });
        showError(e.data.message ? ('BuilderForce: ' + e.data.message) : undefined);
      }
      return;
    }
    // Messages from the extension host.
    const msg = e.data;
    if (msg && msg.type === 'auth') {
      iframe.contentWindow && iframe.contentWindow.postMessage(
        { source: SRC, type: 'auth', token: msg.token, theme: msg.theme }, EMBED_ORIGIN);
    } else if (msg && msg.type === 'noauth') {
      clearTimeout(timeout);
      errorSub.textContent = 'Sign in to BuilderForce to view this page.';
      showError();
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
