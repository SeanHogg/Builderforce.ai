import * as vscode from "vscode";
import { ChatMessage, SECRET_KEY, streamChat } from "./gateway";

/** Renders the sidebar chat webview and drives a single conversation. */
export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = "builderforce.chat";

  private view?: vscode.WebviewView;
  private messages: ChatMessage[] = [];
  private currentAbort?: AbortController;
  private selectedModel: string | undefined;

  constructor(private readonly ctx: vscode.ExtensionContext) {
    this.selectedModel =
      vscode.workspace.getConfiguration("builderforce").get<string>("defaultModel") ||
      undefined;
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

  // --- invoked by commands ---

  newChat(): void {
    this.stop();
    this.messages = [];
    this.post({ type: "cleared" });
  }

  setModel(model: string | undefined): void {
    this.selectedModel = model;
    this.post({ type: "model", model: model ?? "(auto)" });
  }

  async refreshState(): Promise<void> {
    const key = await this.ctx.secrets.get(SECRET_KEY);
    this.post({ type: "state", signedIn: !!key, model: this.selectedModel ?? "(auto)" });
  }

  stop(): void {
    this.currentAbort?.abort();
    this.currentAbort = undefined;
  }

  // --- internals ---

  private async run(text: string): Promise<void> {
    const key = await this.ctx.secrets.get(SECRET_KEY);
    if (!key) {
      this.post({ type: "needSignIn" });
      return;
    }
    this.messages.push({ role: "user", content: text });
    this.post({ type: "user", text });

    const id = `a${Date.now()}`;
    this.post({ type: "assistantStart", id });
    this.currentAbort = new AbortController();
    let acc = "";
    try {
      for await (const delta of streamChat(
        this.ctx.secrets,
        this.messages,
        this.selectedModel,
        this.currentAbort.signal,
      )) {
        acc += delta;
        this.post({ type: "chunk", id, delta });
      }
      this.messages.push({ role: "assistant", content: acc });
      this.post({ type: "assistantDone", id });
    } catch (e) {
      const err = e as { name?: string; message?: string };
      if (err.name === "AbortError") {
        this.messages.push({ role: "assistant", content: acc });
        this.post({ type: "assistantDone", id });
      } else {
        this.post({ type: "error", id, message: err.message ?? String(e) });
      }
    } finally {
      this.currentAbort = undefined;
    }
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
    <textarea id="input" rows="2" placeholder="Ask BuilderForce…"></textarea>
    <div id="actions">
      <span id="model-chip">(auto)</span>
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
