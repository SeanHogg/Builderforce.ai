import * as vscode from "vscode";
import { getTenantJwt } from "./bfApi";
import { TOOL_DEFS } from "./fileTools";
import { getBaseUrl, SECRET_KEY } from "./gateway";
import { getGroundingSummary } from "./grounding";
import { getSelectedModel } from "./modelState";

/** A host-driven request to the singleton Brain panel (mirror of the webview type). */
export interface BrainIntent {
  kind: "new" | "focus" | "task";
  chatId?: number;
  task?: { id: number; key?: string; title: string; projectId?: number; dispatched?: boolean };
}

/** Host callbacks so the Brain panel can keep the sidebar trees live. */
export interface BrainWebviewHooks {
  /** A chat was created / renamed / had activity — refresh the Sessions sidebar. */
  onChatsChanged?: () => void;
  /** A platform (catalog) write happened in the chat — refresh Project & Tasks. */
  onPlatformWrite?: (toolName: string) => void;
}

/**
 * Localized UI strings handed to the bundled React webview. The webview ships no
 * i18n stack of its own (next-intl is web-only), so the host translates here via
 * `vscode.l10n` (editor display language) and forwards the bundle through `init`.
 * Keys are the webview's namespace; the l10n lookup is keyed off the English message.
 */
function buildLabels(): Record<string, string> {
  const t = vscode.l10n.t;
  return {
    // <BrainTimeline> (shared transcript UI)
    "tl.thinking": t("Thinking…"),
    "tl.thoughtFor": t("Thought for {duration}"),
    "tl.you": t("You"),
    "tl.assistant": "BuilderForce",
    "tl.input": t("Input"),
    "tl.output": t("Output"),
    "tl.error": t("Error"),
    "tl.loading": t("Loading…"),
    "tl.empty": t("Ask BuilderForce to build or change something."),
    "tl.copy": t("Copy"),
    "tl.copied": t("Copied"),
    "tl.apply": t("Apply"),
    "tl.createFile": t("Create file"),
    // Composer + chrome
    "app.signInPrompt": t("Sign in to BuilderForce to start."),
    "app.signIn": t("Sign in"),
    "app.beta": t("beta"),
    "app.newChat": t("New chat"),
    "app.conversation": t("Conversation"),
    "app.copyChat": t("Copy chat transcript (for triage)"),
    "app.diagnostics": t("Run connection diagnostics"),
    "app.attachImage": t("Attach image"),
    "app.remove": t("Remove"),
    "app.working": t("Working…"),
    "app.send": t("Send"),
    "app.placeholder": t("Ask BuilderForce to build or change something…"),
    "app.confirmRun": t("Run {name}?"),
    "app.approve": t("Approve"),
    "app.cancel": t("Cancel"),
    "app.always": t("Always"),
    "app.taskSeed": t("Let's work on {task}."),
    "app.taskSeedDispatched": t("I just dispatched {task} to run on the platform. Check the latest execution's status and trace, then help me follow up."),
  };
}

/**
 * The unified BuilderForce Brain — a bundled React webview (the SAME
 * <BrainTimeline> + brain-embedded core the web app uses), so the chat experience
 * is identical on the web and in VS Code, backed by the same server-side `/api/brain`
 * conversations. This is the ONE chat surface in the editor: the Sessions sidebar
 * and task commands all drive it (there is no separate legacy chat panel).
 *
 * The React app reaches the gateway/API directly (CORS allows the
 * `vscode-webview://` origin) — including the shared MCP tool catalog. Two things
 * only the privileged host can do cross a typed postMessage bridge:
 *   - local file tools (read/list/write/edit/delete) run here against the workspace
 *   - the tenant token is minted/refreshed here from the stored editor key
 */
export class BrainWebview {
  private static current: BrainWebview | undefined;
  private static hooks: BrainWebviewHooks = {};

  /** Wire host callbacks once (from `activate`) so the panel can refresh the trees. */
  static configure(hooks: BrainWebviewHooks): void {
    BrainWebview.hooks = hooks;
  }

  static open(ctx: vscode.ExtensionContext, intent?: BrainIntent): void {
    if (BrainWebview.current) {
      BrainWebview.current.panel.reveal();
      if (intent) BrainWebview.current.sendIntent(intent);
      return;
    }
    BrainWebview.current = new BrainWebview(ctx, intent);
  }

  /** Re-push init (token/grounding/model/labels) to an open panel — e.g. after sign-in. */
  static refresh(): void {
    void BrainWebview.current?.sendInit();
  }

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  /** Intent captured at construction, flushed once the webview signals `ready`. */
  private pendingIntent?: BrainIntent;

  private constructor(private readonly ctx: vscode.ExtensionContext, intent?: BrainIntent) {
    this.pendingIntent = intent;
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
    text?: string;
    args?: Record<string, unknown>;
  }): Promise<void> {
    switch (msg.type) {
      case "ready":
        await this.sendInit();
        if (this.pendingIntent) {
          this.sendIntent(this.pendingIntent);
          this.pendingIntent = undefined;
        }
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
      case "chats.changed":
        BrainWebview.hooks.onChatsChanged?.();
        break;
      case "platform.write":
        BrainWebview.hooks.onPlatformWrite?.(typeof msg.name === "string" ? msg.name : "");
        break;
      // Triage: the webview built a full transcript (turns + tool I/O + errors);
      // the privileged host writes it to the clipboard reliably (a sandboxed
      // webview can't), so a "No response" turn can be pasted out to debug.
      case "copy":
        await vscode.env.clipboard.writeText(typeof msg.text === "string" ? msg.text : "");
        void vscode.window.showInformationMessage(vscode.l10n.t("Chat transcript copied to clipboard."));
        break;
      // Run the existing connection-diagnostics command (opens the output channel).
      case "diagnose":
        void vscode.commands.executeCommand("builderforce.diagnose");
        break;
    }
  }

  /** Post a host-driven intent to the React app (new / focus / task). */
  private sendIntent(intent: BrainIntent): void {
    void this.panel.webview.postMessage({ type: "intent", intent });
  }

  /** Hand the React app its config: gateway URL, tenant token, model, grounding, tools, labels. */
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
      // (The shared platform catalog is fetched by the webview directly from the gateway.)
      tools: TOOL_DEFS.map((d) => ({
        name: d.name,
        description: d.description,
        parameters: d.parameters,
        mutating: d.mutating,
      })),
      labels: buildLabels(),
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
