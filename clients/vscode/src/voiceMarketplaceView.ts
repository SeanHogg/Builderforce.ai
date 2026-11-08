import * as vscode from "vscode";
import { getTenantJwt } from "./bfApi";
import { getBaseUrl, getWebBaseUrl, SECRET_KEY } from "./gateway";
import { navigateFromCanvas } from "./canvasHostActions";
import { authLabels } from "./authLabels";
import { getSelectedProject } from "./projectState";
import { renderWebviewHtml } from "./webviewShared";
import { handleSharedHostMessage } from "./webviewHostBridge";

/**
 * The Voice marketplace sidebar view — a bundled-React webview view that renders the
 * SHARED <VoiceMarketplace> (the same browse-and-add component the web mounts at
 * `/marketplace/voices`). The React app reaches the gateway over the webview's bearer
 * fetch; the host's only jobs are minting the tenant token and re-pushing `init` on
 * sign-in/out and project switch — the same contract as the Evermind view.
 */
export class VoiceMarketplaceViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "builderforce.voiceMarketplace";
  private view: vscode.WebviewView | undefined;

  constructor(private readonly ctx: vscode.ExtensionContext) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.ctx.extensionUri, "media")],
    };
    // Listener BEFORE html: the bundled app posts `ready` at module load.
    view.webview.onDidReceiveMessage((m) => void this.onMessage(m as { type?: string }));
    view.webview.html = renderWebviewHtml(view.webview, this.ctx, { title: vscode.l10n.t("Voice marketplace") });
    view.onDidChangeVisibility(() => { if (view.visible) void this.sendInit(); });
    view.onDidDispose(() => { if (this.view === view) this.view = undefined; });
    void this.sendInit();
  }

  /** Re-push init (token / project) to the live view. No-op when not resolved. */
  refresh(): void {
    void this.sendInit();
  }

  /** Ask the live view to reload its listing — the view title-bar refresh action. */
  triggerRefresh(): void {
    void this.view?.webview.postMessage({ type: "refresh" });
  }

  private async onMessage(msg: { type?: string; path?: string }): Promise<void> {
    // `token.refresh` and `signin` are host-owned on every surface (shared bridge).
    if (await handleSharedHostMessage(this.ctx, this.view?.webview, msg, this.view)) return;
    if (msg.type === "ready") await this.sendInit();
    // "Buy": the shared component asks the host to open the web checkout, exactly as
    // every canvas link does (the webview must never navigate its own document). The
    // user pays in the browser; returning to the editor, the view's refresh picks up
    // the license.
    else if (msg.type === "canvas.navigate" && msg.path) navigateFromCanvas(msg.path, () => undefined);
  }

  private async sendInit(): Promise<void> {
    if (!this.view) return;
    const signedIn = !!(await this.ctx.secrets.get(SECRET_KEY));
    const token = signedIn ? ((await getTenantJwt(this.ctx.secrets)) ?? null) : null;
    void this.view.webview.postMessage({
      type: "init",
      view: "voiceMarketplace",
      baseUrl: getBaseUrl(),
      token,
      signedIn,
      hasWorkspace: !!vscode.workspace.workspaceFolders?.[0],
      project: getSelectedProject(),
      webOrigin: getWebBaseUrl(),
      extensionVersion: this.ctx.extension.packageJSON.version as string,
      canManage: false,
      tools: [],
      labels: { ...authLabels(), "canvas.locale": vscode.env.language },
    });
  }
}
