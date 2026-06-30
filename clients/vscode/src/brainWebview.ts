import * as vscode from "vscode";
import { getTenantJwt } from "./bfApi";
import { TOOL_DEFS } from "./fileTools";
import { getBaseUrl, SECRET_KEY } from "./gateway";
import { getGroundingSummary } from "./grounding";
import { getSelectedModel } from "./modelState";

/**
 * The unified BuilderForce Brain — a bundled React webview (the SAME
 * <BrainTimeline> + brain-embedded core the web app uses), so the chat experience
 * is identical on the web and in VS Code, backed by the same server-side `/api/brain`
 * conversations.
 *
 * The React app reaches the gateway/API directly (CORS allows the
 * `vscode-webview://` origin). Two things only the privileged host can do cross a
 * typed postMessage bridge:
 *   - local file tools (read/list/write/edit/delete) run here against the workspace
 *   - the tenant token is minted/refreshed here from the stored editor key
 */
export class BrainWebview {
  private static current: BrainWebview | undefined;

  static open(ctx: vscode.ExtensionContext): void {
    if (BrainWebview.current) {
      BrainWebview.current.panel.reveal();
      return;
    }
    BrainWebview.current = new BrainWebview(ctx);
  }

  /** Re-push init (token/grounding/model) to an open panel — e.g. after sign-in. */
  static refresh(): void {
    void BrainWebview.current?.sendInit();
  }

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];

  private constructor(private readonly ctx: vscode.ExtensionContext) {
    this.panel = vscode.window.createWebviewPanel(
      "builderforce.brain",
      "BuilderForce",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(ctx.extensionUri, "media")],
      },
    );
    this.panel.iconPath = vscode.Uri.joinPath(ctx.extensionUri, "media", "icon.png");
    this.panel.webview.html = this.html(this.panel.webview);
    this.panel.webview.onDidReceiveMessage((m) => void this.onMessage(m), undefined, this.disposables);
    this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
  }

  private async onMessage(msg: {
    type?: string;
    id?: string;
    name?: string;
    args?: Record<string, unknown>;
  }): Promise<void> {
    switch (msg.type) {
      case "ready":
        await this.sendInit();
        break;
      case "tool.call":
        await this.runTool(msg.id, msg.name, msg.args);
        break;
      case "token.refresh": {
        const token = (await getTenantJwt(this.ctx.secrets)) ?? null;
        this.respond(msg.id, true, { token });
        break;
      }
      case "signin":
        void vscode.commands.executeCommand("builderforce.signIn");
        break;
    }
  }

  /** Hand the React app its config: gateway URL, tenant token, model, grounding, tools. */
  private async sendInit(): Promise<void> {
    const signedIn = !!(await this.ctx.secrets.get(SECRET_KEY));
    const token = signedIn ? ((await getTenantJwt(this.ctx.secrets)) ?? null) : null;
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    void this.panel.webview.postMessage({
      type: "init",
      baseUrl: getBaseUrl(),
      token,
      model: getSelectedModel(),
      grounding: root ? getGroundingSummary() : undefined,
      signedIn,
      hasWorkspace: !!root,
      // The local file tools, forwarded so the model can call them over the bridge.
      tools: TOOL_DEFS.map((d) => ({
        name: d.name,
        description: d.description,
        parameters: d.parameters,
        mutating: d.mutating,
      })),
    });
  }

  /** Execute a local file tool against the workspace and return its result string. */
  private async runTool(id: string | undefined, name: string | undefined, args: Record<string, unknown> = {}): Promise<void> {
    const def = TOOL_DEFS.find((d) => d.name === name);
    if (!def) {
      this.respond(id, false, undefined, `Unknown tool: ${name}`);
      return;
    }
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
      this.respond(id, false, undefined, `Tool "${name}" needs an open workspace folder.`);
      return;
    }
    try {
      const result = await def.execute(args, root);
      this.respond(id, true, result);
    } catch (e) {
      this.respond(id, false, undefined, (e as Error).message ?? String(e));
    }
  }

  private respond(id: string | undefined, ok: boolean, result?: unknown, error?: string): void {
    if (!id) return;
    void this.panel.webview.postMessage({ type: "response", id, ok, result, error });
  }

  private dispose(): void {
    BrainWebview.current = undefined;
    for (const d of this.disposables) {
      try {
        d.dispose();
      } catch {
        /* noop */
      }
    }
  }

  private html(webview: vscode.Webview): string {
    const nonce = makeNonce();
    const asset = (f: string) =>
      webview.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, "media", "webview", f));
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
<title>BuilderForce</title>
</head>
<body>
<div id="root"></div>
<script type="module" nonce="${nonce}" src="${asset("index.js")}"></script>
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
