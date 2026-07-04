import * as vscode from "vscode";
import { getTenantJwt } from "./bfApi";
import { TOOL_DEFS } from "./fileTools";
import { getBaseUrl, SECRET_KEY } from "./gateway";
import { getGroundingSummary } from "./grounding";
import { resolveEffectiveModel } from "./modelState";
import { getSelectedProject } from "./projectState";

/** A host-driven request to the singleton Brain panel (mirror of the webview type). */
export interface BrainIntent {
  kind: "new" | "focus" | "task" | "seed";
  chatId?: number;
  /** For 'seed': a prompt pre-filled into a fresh chat (editor entry points). */
  text?: string;
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
    // Composer toolbar (Claude-style + / menus, auto mode, dictation)
    "app.add": t("Add"),
    "app.options": t("Options"),
    "app.uploadFile": t("Upload from computer"),
    "app.uploading": t("Uploading…"),
    "app.addContext": t("Add context"),
    "app.browseWeb": t("Browse the web"),
    "app.on": t("On"),
    "app.off": t("Off"),
    "app.effort": t("Effort"),
    "app.effortQuick": t("Quick"),
    "app.effortBalanced": t("Balanced"),
    "app.effortThorough": t("Thorough"),
    "app.thinking": t("Thinking"),
    "app.accountSettings": t("Account settings"),
    "app.autoMode": t("Auto mode"),
    "app.autoModeHint": t("Auto-approve tool actions without asking"),
    "app.pickModel": t("Change model"),
    "app.dictate": t("Dictate"),
    "app.stopDictation": t("Stop dictation"),
    "app.working": t("Working…"),
    "app.send": t("Send"),
    "app.stop": t("Stop"),
    "app.placeholder": t("Ask BuilderForce to build or change something…"),
    "app.confirmRun": t("Run {name}?"),
    "app.approve": t("Approve"),
    "app.cancel": t("Cancel"),
    "app.always": t("Always"),
    "app.dismiss": t("Dismiss"),
    "app.reconnect": t("Reconnect"),
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
      // Composer `/` menu → account settings, and the model chip → model picker.
      case "settings":
        void vscode.commands.executeCommand("builderforce.openSettings");
        break;
      case "pickModel":
        void vscode.commands.executeCommand("builderforce.pickModel");
        break;
      // Composer `+` menu → "Add context": pick a workspace file (or the active
      // editor selection) and hand its text back so the webview attaches it.
      case "context.pick": {
        const picked = await this.pickContext();
        this.respond(msg.id, true, picked);
        break;
      }
    }
  }

  /**
   * Let the user attach workspace context to a message: the active editor's
   * selection, an already-open file, or any file chosen from disk. Returns the
   * relative path + text (or null if cancelled) — the webview attaches it through
   * the same upload pipeline as a dropped file, so the model gets the content.
   */
  private async pickContext(): Promise<{ path: string; text: string } | null> {
    // Note: the discriminator is `ctxKind`, not `kind` — `QuickPickItem.kind` is
    // reserved by VS Code (separator vs default), so reusing it collapses to never.
    type Item = vscode.QuickPickItem & { ctxKind: "selection" | "doc" | "browse"; uri?: vscode.Uri };
    const editor = vscode.window.activeTextEditor;
    const items: Item[] = [];
    if (editor && !editor.selection.isEmpty) {
      items.push({
        label: "$(selection) " + vscode.l10n.t("Active selection"),
        description: vscode.workspace.asRelativePath(editor.document.uri),
        ctxKind: "selection",
      });
    }
    for (const doc of vscode.workspace.textDocuments) {
      if (doc.uri.scheme !== "file" || doc.isUntitled) continue;
      items.push({ label: "$(file) " + vscode.workspace.asRelativePath(doc.uri), ctxKind: "doc", uri: doc.uri });
    }
    items.push({ label: "$(search) " + vscode.l10n.t("Choose a file…"), ctxKind: "browse" });

    const pick = await vscode.window.showQuickPick(items, {
      placeHolder: vscode.l10n.t("Add context from your workspace"),
    });
    if (!pick) return null;

    if (pick.ctxKind === "selection" && editor) {
      return { path: vscode.workspace.asRelativePath(editor.document.uri), text: editor.document.getText(editor.selection) };
    }
    let uri = pick.uri;
    if (!uri) {
      const chosen = await vscode.window.showOpenDialog({
        canSelectMany: false,
        defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
      });
      uri = chosen?.[0];
    }
    if (!uri) return null;
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      return { path: vscode.workspace.asRelativePath(uri), text: doc.getText() };
    } catch {
      return null;
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
      // Manual pick > active project's Evermind pin > configured default. Sending the
      // `project_evermind:<id>` pin lets the gateway serve the project's CURRENT learned
      // model on every completion (auto-following learning bumps mid-session).
      model: await resolveEffectiveModel(this.ctx.secrets),
      grounding: root ? getGroundingSummary() : undefined,
      signedIn,
      hasWorkspace: !!root,
      // The sidebar's active project — injected into the system prompt (so the
      // Brain scopes platform tools without asking for a projectId) AND used to
      // scope newly-created chats. Re-pushed on project change via refresh().
      project: getSelectedProject(),
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
      // Link the change back to the editor: reveal the file the agent just wrote
      // or edited so the user SEES each change land (a preview tab beside the
      // chat, focus preserved). Fire-and-forget — never blocks the tool result.
      void this.revealChangedFile(name, args, root);
    } catch (e) {
      this.respond(id, false, undefined, (e as Error).message ?? String(e));
    }
  }

  /**
   * Open the file a mutating file tool just touched, so the change is visible in
   * the editor (VS Code auto-reloads the on-disk edit). Preview mode reuses one
   * tab across a multi-file run, opened Beside the chat with focus preserved so
   * it never steals the composer. Only `write_file`/`edit_file` reveal — a delete
   * has nothing to show, and shell/read tools aren't changes. Best-effort.
   */
  private async revealChangedFile(name: string | undefined, args: Record<string, unknown>, root: string): Promise<void> {
    if (name !== "write_file" && name !== "edit_file") return;
    const rel = typeof args.path === "string" ? args.path : "";
    if (!rel) return;
    try {
      const uri = vscode.Uri.joinPath(vscode.Uri.file(root), ...rel.split("/").filter(Boolean));
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, {
        preview: true,
        preserveFocus: true,
        viewColumn: vscode.ViewColumn.Beside,
      });
    } catch {
      /* file may have been deleted/moved by a later tool — non-fatal */
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
