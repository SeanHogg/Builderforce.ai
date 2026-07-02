import * as vscode from "vscode";
import { getTenantJwt } from "./bfApi";
import { getWebBaseUrl } from "./gateway";

const BFEMBED_SOURCE = "builderforce-embed/v1";

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
  private readonly webUrl = getWebBaseUrl();
  /**
   * Handshake telemetry, reset per (re)load. The framed `/embed` page can fail in
   * several distinct ways that all look like "blank panel + 15s timeout" from the
   * host; these flags let the extension emit a plain-language DIAGNOSIS to its
   * output channel (see logDiagnosis) so the failure mode is identifiable WITHOUT
   * reading the cross-origin iframe console (which the host cannot).
   */
  private diag: { domLoad: boolean; boot: boolean; anyFrameMsg: boolean; ready: boolean; lastError?: string } = {
    domLoad: false,
    boot: false,
    anyFrameMsg: false,
    ready: false,
  };

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
      (m: { type: string; signal?: string; detail?: string }) => void this.onMessage(m),
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
    this.diag = { domLoad: false, boot: false, anyFrameMsg: false, ready: false };
    const version =
      (this.ctx.extension.packageJSON as { version?: string }).version ?? "0";
    const cb = `${version}.${Date.now()}`;
    const embedOrigin = new URL(this.webUrl).origin;
    const hash = this.opts.hash ? `#${this.opts.hash}` : "";
    const src = `${this.webUrl}/embed/${encodeURIComponent(this.view)}?bfcb=${encodeURIComponent(cb)}${hash}`;
    log(`open ${this.view} → ${src}`);
    this.panel.webview.html = this.html(this.panel.webview, src, embedOrigin);
  }

  /** Log to the output channel AND mirror into the webview's copyable log. */
  private note(line: string): void {
    log(`${this.view}: ${line}`);
    this.panel.webview.postMessage({ type: "log", line });
  }

  private async onMessage(m: { type: string; signal?: string; detail?: string }): Promise<void> {
    switch (m.type) {
      // Handshake telemetry forwarded from the framed page's inline reporter +
      // the webview shell (boot / ready / resize / error / domload). Mirrored to
      // the output channel and folded into the diagnosis on timeout.
      case "diag":
        this.onDiag(m.signal, m.detail);
        break;
      case "authNeeded": {
        this.note("iframe ready → exchanging tenant token");
        const token = await getTenantJwt(this.ctx.secrets);
        if (!token) {
          this.note("no tenant token (not signed in / exchange failed)");
          this.panel.webview.postMessage({ type: "noauth" });
          return;
        }
        const theme =
          vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Light ? "light" : "dark";
        this.note(`token acquired (${token.length} chars) → handing to frame`);
        this.panel.webview.postMessage({ type: "auth", token, theme });
        break;
      }
      case "rendered":
        this.note("frame painted content");
        break;
      case "timeout":
        this.note("frame did not render within 15s");
        this.logDiagnosis();
        break;
      case "reload":
        this.note("reload requested");
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

  /** Record one handshake signal from the frame or the webview shell. The webview
   *  already logs it into its own copyable log, so mirror only to the output
   *  channel here (via log, not note) to avoid a duplicate copy-log line. */
  private onDiag(signal: string | undefined, detail: string | undefined): void {
    const s = signal ?? "?";
    log(`${this.view}: frame:${s}${detail ? ` — ${detail}` : ""}`);
    switch (s) {
      case "domload":
        this.diag.domLoad = true;
        break;
      case "boot":
        this.diag.boot = true;
        this.diag.anyFrameMsg = true;
        break;
      case "ready":
      case "resize":
        this.diag.ready = true;
        this.diag.anyFrameMsg = true;
        break;
      case "error":
        this.diag.lastError = detail ?? "(no message)";
        this.diag.anyFrameMsg = true;
        break;
      default:
        this.diag.anyFrameMsg = true;
    }
  }

  /**
   * Turn the collected handshake telemetry into a plain-language verdict in the
   * output channel, so a blank/timed-out embed panel says WHY instead of just
   * "didn't render". Each branch maps to a different fix, so the distinction is
   * the whole point.
   */
  private logDiagnosis(): void {
    const d = this.diag;
    let verdict: string;
    if (d.lastError) {
      verdict = `the framed page reported an error before painting → ${d.lastError}. If this is a "resource failed to load", a JS chunk is being blocked in the credentialless webview; otherwise a provider threw during render.`;
    } else if (!d.domLoad) {
      verdict =
        "the iframe never even fired its DOM load event → the page URL did not load in the webview (network, CSP frame-src, or an auth/redirect). Try Open in Browser to confirm the URL works while signed in.";
    } else if (!d.anyFrameMsg) {
      verdict =
        "the document loaded but the frame sent NO messages — not even the inline 'boot' ping → the page's JavaScript is NOT executing inside the credentialless webview iframe. This is a webview/credentialless block, not a provider crash, so a lean provider tree cannot help; the reliable path for this view is a native panel (like the Board) or Open in Browser. (If the deployed frontend predates the 'boot' reporter, redeploy it to sharpen this verdict.)";
    } else if (d.boot && !d.ready) {
      verdict =
        "inline JS ran ('boot' seen) but the app never became ready → the route bundle failed to load or a provider suspends/hangs during hydration. Look for a 'resource failed to load' line above; if none, it is a hydration hang.";
    } else {
      verdict = "the frame booted and became ready but never painted → a post-ready render or auth-handshake issue.";
    }
    this.note(`DIAGNOSIS: ${verdict}`);
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
  #copylog {
    position: fixed; top: 6px; right: 6px; z-index: 10; opacity: 0.65;
    font-size: 11px; padding: 2px 8px;
    color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground);
  }
  #copylog:hover { opacity: 1; }
</style>
</head>
<body>
<button id="copylog" title="Copy the embed handshake log for troubleshooting">Copy log</button>
<!-- credentialless: load the cross-origin page in an ephemeral, no-cookie, fresh-storage
     partition. VS Code webviews run under COEP, which blocks a cross-origin frame that
     lacks Cross-Origin-Resource-Policy; a credentialless frame is allowed without it.
     It also sidesteps a stuck service worker (separate storage partition). Auth is handed
     in via postMessage (not cookies), so dropping credentials costs nothing here. -->
<iframe id="f" credentialless src="${src}" allow="clipboard-read; clipboard-write"></iframe>

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
  const copyBtn = document.getElementById('copylog');

  // Copyable troubleshooting log (client + extension-mirrored events).
  const logLines = [];
  function pushLog(line) {
    logLines.push(new Date().toISOString().slice(11, 23) + '  ' + line);
  }
  // A structured handshake signal: logged locally AND forwarded to the extension
  // host, which records it (output channel) and folds it into the timeout diagnosis.
  function diag(signal, detail) {
    pushLog('frame:' + signal + (detail ? ' — ' + detail : ''));
    vscode.postMessage({ type: 'diag', signal: signal, detail: detail });
  }
  pushLog('embed webview init');
  pushLog('frame src: ' + iframe.src);
  pushLog('origin (expected frame): ' + EMBED_ORIGIN);
  pushLog('iframe credentialless: ' + ('credentialless' in iframe ? iframe.credentialless : 'unsupported-attr'));
  // Distinguishes "document never loaded" (frame blocked by COEP/CSP) from "loaded but JS
  // never ran" (subresource blocked / SW hang / hydration error) when no 'ready' arrives.
  iframe.addEventListener('load', () => diag('domload', 'document reached the frame'));
  iframe.addEventListener('error', () => pushLog('iframe DOM error event'));
  // Parent-side signals the cross-origin frame can't report itself.
  document.addEventListener('securitypolicyviolation', (e) => {
    pushLog('CSP violation: ' + e.violatedDirective + ' blocked ' + (e.blockedURI || '(inline)'));
  });
  window.addEventListener('error', (e) => {
    pushLog('window error: ' + (e.message || '') + (e.filename ? (' @ ' + e.filename) : ''));
  });
  window.addEventListener('unhandledrejection', (e) => {
    pushLog('unhandledrejection: ' + (e && e.reason ? (e.reason.message || String(e.reason)) : ''));
  });
  function safeData(d) { try { return JSON.stringify(d).slice(0, 200); } catch (_) { return String(d); } }
  copyBtn.addEventListener('click', async () => {
    const text = logLines.join('\\n') || '(empty)';
    try {
      await navigator.clipboard.writeText(text);
      const prev = copyBtn.textContent;
      copyBtn.textContent = '✓ Copied';
      setTimeout(() => { copyBtn.textContent = prev; }, 1200);
    } catch (err) {
      pushLog('clipboard write failed: ' + (err && err.message ? err.message : err));
    }
  });

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
    if (!painted) { pushLog('TIMEOUT: no frame paint after 15s'); vscode.postMessage({ type: 'timeout' }); showError(); }
  }, 15000);

  document.getElementById('reload').addEventListener('click', () => { painted = false; pushLog('reload clicked'); vscode.postMessage({ type: 'reload' }); });
  document.getElementById('open-ext').addEventListener('click', () => { pushLog('open-in-browser clicked'); vscode.postMessage({ type: 'openExternal' }); });
  document.getElementById('diagnose').addEventListener('click', () => { pushLog('diagnose clicked'); vscode.postMessage({ type: 'diagnose' }); });

  // The real origin the frame posts from — captured from its first tagged message so
  // auth is targeted correctly even if a credentialless frame reports an unexpected
  // origin. We match frame messages by their source tag, NOT origin, so an origin
  // quirk can never silently drop ready (it would just never authorize, staying blank).
  let frameOrigin = EMBED_ORIGIN;

  window.addEventListener('message', (e) => {
    const d = e.data;

    // Messages from the embedded page (tagged with the embed protocol source).
    if (d && d.source === SRC && typeof d.type === 'string') {
      if (e.origin && e.origin !== 'null') frameOrigin = e.origin;
      // Forward EVERY tagged signal (boot / ready / resize / error / …) to the
      // host so it lands in the output channel + feeds the timeout diagnosis.
      diag(d.type, d.type === 'error' ? (d.message || '(no message)') : (d.message || undefined));
      if (d.type === 'ready') {
        vscode.postMessage({ type: 'authNeeded' });
        showLoading('Authorizing…', 'Signing in to your workspace.');
      } else if (d.type === 'resize' && typeof d.height === 'number' && d.height > 40) {
        if (!painted) { painted = true; clearTimeout(timeout); vscode.postMessage({ type: 'rendered' }); }
        hideOverlays();
      } else if (d.type === 'error') {
        showError(d.message ? ('BuilderForce: ' + d.message) : undefined);
      }
      return;
    }

    // Messages from the extension host (no source tag).
    if (d && d.type === 'auth') {
      pushLog('extension → auth (forwarding token to frame @ ' + frameOrigin + ')');
      iframe.contentWindow && iframe.contentWindow.postMessage(
        { source: SRC, type: 'auth', token: d.token, theme: d.theme }, frameOrigin);
    } else if (d && d.type === 'noauth') {
      pushLog('extension → noauth (no tenant token)');
      clearTimeout(timeout);
      errorSub.textContent = 'Sign in to BuilderForce to view this page.';
      showError();
    } else if (d && d.type === 'log') {
      pushLog('ext: ' + d.line);
    } else if (d && typeof d === 'object') {
      // Anything else inbound — capture it so we never silently ignore a signal.
      pushLog('other msg: origin=' + e.origin + ' ' + safeData(d));
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
