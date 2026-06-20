import * as vscode from "vscode";
import { runAgent } from "./agent";
import { loadTaskConversation } from "./bfApi";
import { ChatMessage, SECRET_KEY } from "./gateway";
import { getGroundingSummary, onGroundingChange } from "./grounding";
import { getSelectedModel, onModelChange } from "./modelState";
import { buildSystemMessages } from "./prompt";
import { ChatSession, SessionStore } from "./sessionStore";

/** A chat opened as a document in the center editor area (one panel per session). */
export class ChatPanel {
  private static readonly panels = new Map<string, ChatPanel>();

  static open(ctx: vscode.ExtensionContext, store: SessionStore, sessionId: string): void {
    const existing = ChatPanel.panels.get(sessionId);
    if (existing) {
      existing.panel.reveal();
      return;
    }
    const session = store.get(sessionId);
    if (!session) return;
    ChatPanel.panels.set(sessionId, new ChatPanel(ctx, store, session));
  }

  static close(sessionId: string): void {
    ChatPanel.panels.get(sessionId)?.panel.dispose();
  }

  /** Update an open panel's tab title (after a rename). No-op if not open. */
  static setTitle(sessionId: string, title: string): void {
    const panel = ChatPanel.panels.get(sessionId);
    if (panel) panel.panel.title = title;
  }

  /** Push current signed-in/grounded/model state to every open panel. */
  static async refreshAll(ctx: vscode.ExtensionContext): Promise<void> {
    const signedIn = !!(await ctx.secrets.get(SECRET_KEY));
    for (const p of ChatPanel.panels.values()) p.postState(signedIn);
  }

  private readonly panel: vscode.WebviewPanel;
  private currentAbort?: AbortController;
  private hydratedTask = false;
  private readonly disposables: vscode.Disposable[] = [];

  private constructor(
    private readonly ctx: vscode.ExtensionContext,
    private readonly store: SessionStore,
    private readonly session: ChatSession,
  ) {
    this.panel = vscode.window.createWebviewPanel(
      "builderforce.chat",
      session.title || "BuilderForce",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(ctx.extensionUri, "media")],
      },
    );
    this.panel.iconPath = vscode.Uri.joinPath(ctx.extensionUri, "media", "icon.png");
    this.panel.webview.html = this.html(this.panel.webview);

    this.panel.webview.onDidReceiveMessage(
      (msg: { type: string; text?: string }) => this.onMessage(msg),
      undefined,
      this.disposables,
    );
    onGroundingChange(() => this.postState(), undefined, this.disposables);
    onModelChange((m) => this.post({ type: "model", model: m ?? "(auto)" }), undefined, this.disposables);

    this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
  }

  private onMessage(msg: { type: string; text?: string }): void {
    switch (msg.type) {
      case "ready":
        this.post({ type: "restore", messages: this.visibleMessages() });
        void this.postState();
        void this.hydrateTaskHistory();
        break;
      case "submit":
        if (msg.text?.trim()) void this.run(msg.text.trim());
        break;
      case "stop":
        this.currentAbort?.abort();
        this.currentAbort = undefined;
        break;
      case "signin":
        void vscode.commands.executeCommand("builderforce.signIn");
        break;
    }
  }

  /** The user/assistant turns the webview should render (system/tool turns excluded). */
  private visibleMessages(): { role: string; text: string }[] {
    return this.session.messages
      .filter((m) => (m.role === "user" || m.role === "assistant") && m.content)
      .map((m) => ({ role: m.role, text: m.content as string }));
  }

  /**
   * On first open of a task-linked session with no local turns yet, pull the task's
   * server-side conversation (its latest execution's durable message thread) and seed
   * it — so the panel shows the real history (and the agent has that prior context)
   * instead of a blank composer. Best-effort: a task with no prior run, or an offline
   * runtime, just leaves the empty state. Never clobbers an existing local chat.
   */
  private async hydrateTaskHistory(): Promise<void> {
    if (this.hydratedTask) return;
    this.hydratedTask = true;
    if (this.session.taskId == null || this.session.messages.length > 0) return;
    try {
      const history = await loadTaskConversation(this.ctx.secrets, this.session.taskId);
      if (!history.length || this.session.messages.length > 0) return;
      this.session.messages = history.map((m) => ({ role: m.role, content: m.content }));
      this.store.save(this.session); // persist + refresh the sidebar list
      this.post({ type: "restore", messages: this.visibleMessages() });
    } catch {
      /* history is best-effort — leave the empty state on failure */
    }
  }

  private async postState(signedIn?: boolean): Promise<void> {
    const isSignedIn = signedIn ?? !!(await this.ctx.secrets.get(SECRET_KEY));
    this.post({
      type: "state",
      signedIn: isSignedIn,
      model: getSelectedModel() ?? "(auto)",
      grounded: !!getGroundingSummary(),
    });
  }

  private async run(text: string): Promise<void> {
    const key = await this.ctx.secrets.get(SECRET_KEY);
    if (!key) {
      this.post({ type: "needSignIn" });
      return;
    }
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const permissionMode =
      vscode.workspace.getConfiguration("builderforce").get<"ask" | "acceptEdits">("permissionMode") ??
      "ask";

    this.session.messages.push({ role: "user", content: text });
    this.maybeTitleFrom(text);
    this.post({ type: "user", text });

    const id = `a${Date.now()}`;
    this.post({ type: "assistantStart", id });
    this.currentAbort = new AbortController();

    const taskContext = this.session.taskKey
      ? `You are collaborating with the human on BuilderForce task ${this.session.taskKey}: ${this.session.taskTitle ?? ""}. Keep your work scoped to this task.`
      : undefined;
    const system = buildSystemMessages(root, getGroundingSummary(), taskContext);
    const working: ChatMessage[] = [...system, ...this.session.messages];

    await runAgent(
      working,
      {
        secrets: this.ctx.secrets,
        root,
        model: getSelectedModel(),
        permissionMode,
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

    this.session.messages = working.slice(system.length);
    this.store.save(this.session); // persists + refreshes the sidebar list
    this.post({ type: "assistantDone", id });
    this.currentAbort = undefined;
  }

  private maybeTitleFrom(text: string): void {
    if (this.session.title && this.session.title !== "New session") return;
    const title = text.replace(/\s+/g, " ").trim().slice(0, 48) || "New session";
    this.session.title = title;
    this.panel.title = title;
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

  private post(msg: unknown): void {
    void this.panel.webview.postMessage(msg);
  }

  private dispose(): void {
    ChatPanel.panels.delete(this.session.id);
    this.currentAbort?.abort();
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
  <div id="header">
    <img id="logo" src="${mediaUri("icon.png")}" alt="" />
    <span id="title">BuilderForce</span>
    <span id="beta">beta</span>
    <div id="header-actions">
      <button id="copy-output" class="icon-btn" title="Copy the whole conversation (for debugging)">Copy output</button>
    </div>
  </div>
  <div id="messages"></div>
  <div id="composer">
    <textarea id="input" rows="2" placeholder="Ask BuilderForce to build or change something…"></textarea>
    <div id="actions">
      <span id="model-chip">(auto)</span>
      <span id="scan-chip" hidden>● grounded</span>
      <button id="send" class="primary">Send</button>
      <button id="stop" class="primary" hidden>Stop</button>
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
