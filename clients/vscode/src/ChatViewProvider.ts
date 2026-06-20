import * as vscode from "vscode";
import { runAgent } from "./agent";
import { ChatMessage, SECRET_KEY } from "./gateway";

/** Renders the sidebar chat webview and drives the agent over the open folder. */
export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = "builderforce.chat";

  private view?: vscode.WebviewView;
  /** Full running transcript (user/assistant/tool), excluding system messages. */
  private history: ChatMessage[] = [];
  private currentAbort?: AbortController;
  private selectedModel: string | undefined;
  private codebaseSummary: string | undefined;

  constructor(private readonly ctx: vscode.ExtensionContext) {
    this.selectedModel =
      vscode.workspace.getConfiguration("builderforce").get<string>("defaultModel") || undefined;
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.ctx.extensionUri, "media")],
    };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage((msg: { type: string; text?: string }) => {
      switch (msg.type) {
        case "ready":
          void this.refreshState();
          break;
        case "submit":
          if (msg.text?.trim()) void this.run(msg.text.trim());
          break;
        case "stop":
          this.stop();
          break;
        case "signin":
          void vscode.commands.executeCommand("builderforce.signIn");
          break;
      }
    });
  }

  // --- invoked by commands / extension ---

  newChat(): void {
    this.stop();
    this.history = [];
    this.post({ type: "cleared" });
  }

  setModel(model: string | undefined): void {
    this.selectedModel = model;
    this.post({ type: "model", model: model ?? "(auto)" });
  }

  setCodebaseSummary(summary: string | undefined): void {
    this.codebaseSummary = summary;
    this.post({ type: "scan", grounded: !!summary });
  }

  async refreshState(): Promise<void> {
    const key = await this.ctx.secrets.get(SECRET_KEY);
    this.post({
      type: "state",
      signedIn: !!key,
      model: this.selectedModel ?? "(auto)",
      grounded: !!this.codebaseSummary,
      hasFolder: !!this.workspaceRoot(),
    });
  }

  stop(): void {
    this.currentAbort?.abort();
    this.currentAbort = undefined;
  }

  // --- internals ---

  private workspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  private permissionMode(): "ask" | "acceptEdits" {
    return (
      vscode.workspace.getConfiguration("builderforce").get<"ask" | "acceptEdits">("permissionMode") ??
      "ask"
    );
  }

  private systemMessages(root: string | undefined): ChatMessage[] {
    const base = root
      ? "You are BuilderForce, an AI coding agent embedded in VS Code. You can read and edit files in the user's open workspace folder using the provided tools. Read files before editing them. Prefer edit_file for changes to existing files and write_file for new files. Make minimal, correct changes and briefly explain what you did."
      : "You are BuilderForce, an AI assistant embedded in VS Code. No workspace folder is open, so file tools are unavailable — answer conversationally.";
    const msgs: ChatMessage[] = [{ role: "system", content: base }];
    if (this.codebaseSummary) {
      msgs.push({ role: "system", content: `Project knowledge (for grounding):\n${this.codebaseSummary}` });
    }
    return msgs;
  }

  private async approve(summary: string): Promise<boolean> {
    const pick = await vscode.window.showWarningMessage(
      `BuilderForce wants to ${summary}.`,
      { modal: true },
      "Apply",
      "Skip",
    );
    return pick === "Apply";
  }

  private async run(text: string): Promise<void> {
    const key = await this.ctx.secrets.get(SECRET_KEY);
    if (!key) {
      this.post({ type: "needSignIn" });
      return;
    }
    const root = this.workspaceRoot();

    this.history.push({ role: "user", content: text });
    this.post({ type: "user", text });

    const id = `a${Date.now()}`;
    this.post({ type: "assistantStart", id });
    this.currentAbort = new AbortController();

    const system = this.systemMessages(root);
    const working: ChatMessage[] = [...system, ...this.history];

    await runAgent(
      working,
      {
        secrets: this.ctx.secrets,
        root,
        model: this.selectedModel,
        permissionMode: this.permissionMode(),
        approve: (summary) => this.approve(summary),
        signal: this.currentAbort.signal,
      },
      {
        onText: (delta) => this.post({ type: "chunk", id, delta }),
        onToolStart: (label) => this.post({ type: "tool", phase: "start", label }),
        onToolResult: (label, ok) => this.post({ type: "tool", phase: "end", label, ok }),
        onError: (message) => this.post({ type: "error", id, message }),
      },
    );

    // Persist the turn's appended messages (assistant + tool) back into history.
    this.history = working.slice(system.length);
    this.post({ type: "assistantDone", id });
    this.currentAbort = undefined;
  }

  private post(msg: unknown): void {
    void this.view?.webview.postMessage(msg);
  }

  private html(webview: vscode.Webview): string {
    const nonce = makeNonce();
    const mediaUri = (f: string) =>
      webview.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, "media", f));
    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource}`,
      `img-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
      `font-src ${webview.cspSource}`,
    ].join("; ");
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<link rel="stylesheet" href="${mediaUri("main.css")}" />
<title>BuilderForce</title>
</head>
<body>
<div id="root">
  <div id="messages"></div>
  <div id="composer">
    <textarea id="input" rows="2" placeholder="Ask BuilderForce to build or change something…"></textarea>
    <div id="actions">
      <span id="model-chip">(auto)</span>
      <span id="scan-chip" hidden>● grounded</span>
      <button id="send">Send</button>
      <button id="stop" hidden>Stop</button>
    </div>
  </div>
</div>
<script nonce="${nonce}" src="${mediaUri("main.js")}"></script>
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
