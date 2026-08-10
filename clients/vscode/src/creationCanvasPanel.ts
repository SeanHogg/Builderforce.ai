import * as vscode from "vscode";
import * as bfApi from "./bfApi";
import { getBaseUrl, getWebBaseUrl } from "./gateway";
import { renderWebviewHtml, WebviewPanelBase, type WebviewInbound } from "./webviewShared";

interface CanvasInbound extends WebviewInbound {
  /** `canvas.capture` — which editor capture to perform. */
  action?: string;
  /** `canvas.openFile` — the file to reveal, and where in it. */
  path?: string;
  range?: { startLine: number; startColumn: number; endLine: number; endColumn: number };
  /** `canvas.navigate` — an in-app route the canvas wants followed. */
  message?: string;
}

/** An object captured from the editor, in the shape `@/lib/canvasHost` expects. */
interface CanvasCapture {
  kind: string;
  title: string;
  content: Record<string, unknown>;
}

/**
 * The Creation Canvas panel.
 *
 * This hosts the SAME canvas the web app renders — `frontend/src/components/
 * creation-canvas/**` compiled into `media/canvas/` by
 * `webview/vite.canvas.config.ts` — rather than a VS Code-shaped imitation of it.
 * So the board, all 66 object kinds, the inspector, the palette, the Brain dock,
 * checkpoints, branch/merge, comments, presence, the 3D view, the workflow editor
 * and the Evermind adapter studio are the web implementations, and a feature
 * added there appears here on the next build.
 *
 * That leaves the host with only what a browser cannot do:
 *
 *   - mint the tenant token (`WebviewPanelBase` already handles `token.refresh`);
 *   - CAPTURE from the workspace — the active file, the current selection, the
 *     problems list, the repository, terminal output, a local service preview;
 *   - reveal a captured file back in the editor;
 *   - decide what an in-app route means in an editor.
 *
 * Everything the old hand-rolled webview did in addition — polling presence,
 * replaying the event log, rendering cards, its own comments panel, its own
 * checkpoint/branch/merge flows — was a second implementation of behaviour the
 * canvas already had, and is gone.
 */
export class CreationCanvasPanel extends WebviewPanelBase<CanvasInbound> {
  private static readonly panels = new Map<string, CreationCanvasPanel>();

  static open(ctx: vscode.ExtensionContext, sessionId: string, title: string): void {
    const existing = this.panels.get(sessionId);
    if (existing) {
      existing.panel.reveal();
      void existing.sendInit();
      return;
    }
    this.panels.set(sessionId, new CreationCanvasPanel(ctx, sessionId, title));
  }

  private constructor(
    ctx: vscode.ExtensionContext,
    private readonly sessionId: string,
    private title: string,
  ) {
    super(ctx, {
      viewType: "builderforce.creationCanvas",
      title: vscode.l10n.t("Create — {0}", title),
      htmlTitle: vscode.l10n.t("BuilderForce Creation Canvas"),
    });
    // The canvas picks its palette from the editor theme; re-push init so a theme
    // switch is reflected without reopening the panel.
    this.disposables.push(vscode.window.onDidChangeActiveColorTheme(() => void this.sendInit()));
  }

  protected renderHtml(webview: vscode.Webview): string {
    return renderWebviewHtml(webview, this.ctx, {
      title: vscode.l10n.t("BuilderForce Creation Canvas"),
      assetDir: "canvas",
      codeSplit: true,
      richMedia: true,
    });
  }

  protected async onMessage(message: CanvasInbound): Promise<void> {
    try {
      if (message.type === "ready") return void (await this.sendInit());
      if (message.type === "canvas.capture") {
        // A cancelled capture answers null — the canvas treats that as "no change".
        this.respond(message.id, true, await this.capture(message.action));
        return;
      }
      if (message.type === "canvas.openFile" && message.path) return void (await this.openFile(message));
      if (message.type === "canvas.navigate" && message.path) return void this.navigate(message.path);
      if (message.type === "canvas.i18nError") {
        // A missing key renders as the key rather than blanking the board; log it
        // so the gap is visible instead of silently shipping raw identifiers.
        console.warn(`[builderforce] canvas i18n: ${message.message}`);
        return;
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      // Capture failures are user-facing ("open a file first"), so they belong in
      // the editor's own notification channel, not swallowed into the webview.
      void vscode.window.showWarningMessage(detail);
      this.respond(message.id, false, undefined, detail);
    }
  }

  /** The init frame: transport, session identity, theme and the localized labels. */
  private async sendInit(): Promise<void> {
    const token = (await bfApi.getTenantJwt(this.ctx.secrets)) ?? null;
    this.post({
      type: "init",
      view: "canvas",
      baseUrl: getBaseUrl(),
      token,
      signedIn: token != null,
      hasWorkspace: (vscode.workspace.workspaceFolders?.length ?? 0) > 0,
      tools: [],
      colorTheme: isLightTheme() ? "light" : "dark",
      session: { id: this.sessionId, title: this.title, webOrigin: getWebBaseUrl() },
      extensionVersion: this.ctx.extension.packageJSON.version as string,
      labels: canvasLabels(),
    });
  }

  /** Reveal a captured file, at its captured range when there is one. */
  private async openFile(message: CanvasInbound): Promise<void> {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(message.path!));
    const range = message.range;
    await vscode.window.showTextDocument(document, {
      selection: range
        ? new vscode.Range(
            Math.max(0, range.startLine - 1),
            Math.max(0, range.startColumn - 1),
            Math.max(0, range.endLine - 1),
            Math.max(0, range.endColumn - 1),
          )
        : undefined,
    });
  }

  /**
   * Follow an in-app route. A webview has no history, so each route maps to the
   * editor action that means the same thing — another Canvas panel, the sign-in
   * command — and anything unrecognised opens in the browser rather than
   * navigating the panel's own document (which would blank it with no way back).
   */
  private navigate(path: string): void {
    const session = /^\/create\/([^/?#]+)/.exec(path);
    if (session) {
      CreationCanvasPanel.open(this.ctx, session[1], vscode.l10n.t("Creation Session"));
      return;
    }
    if (path.startsWith("/login") || path.startsWith("/register")) {
      void vscode.commands.executeCommand("builderforce.signIn");
      return;
    }
    void vscode.env.openExternal(vscode.Uri.parse(`${getWebBaseUrl()}${path}`));
  }

  /**
   * Run one editor capture. Returns null when there is nothing to capture or the
   * user backed out; throws with a user-facing reason when the workspace state
   * makes the action impossible ("open a file first").
   */
  private async capture(action: string | undefined): Promise<CanvasCapture | null> {
    switch (action) {
      case "file": {
        const editor = requireEditor();
        return {
          kind: "code",
          title: vscode.workspace.asRelativePath(editor.document.uri),
          content: {
            path: editor.document.uri.fsPath,
            language: editor.document.languageId,
            subtitle: vscode.l10n.t("VS Code file"),
            text: editor.document.getText().slice(0, 100_000),
          },
        };
      }
      case "selection": {
        const editor = requireEditor();
        if (editor.selection.isEmpty) throw new Error(vscode.l10n.t("Select a range in an open file first"));
        const range = editor.selection;
        return {
          kind: "selection",
          title: `${vscode.workspace.asRelativePath(editor.document.uri)}:${range.start.line + 1}-${range.end.line + 1}`,
          content: {
            path: editor.document.uri.fsPath,
            language: editor.document.languageId,
            range: {
              startLine: range.start.line + 1,
              startColumn: range.start.character + 1,
              endLine: range.end.line + 1,
              endColumn: range.end.character + 1,
            },
            subtitle: vscode.l10n.t("VS Code selection"),
            text: editor.document.getText(range).slice(0, 20_000),
          },
        };
      }
      case "diagnostics": {
        const editor = requireEditor();
        const diagnostics = vscode.languages
          .getDiagnostics(editor.document.uri)
          .slice(0, 50)
          .map((item) => ({
            severity: vscode.DiagnosticSeverity[item.severity],
            message: item.message.slice(0, 1_000),
            line: item.range.start.line + 1,
            source: item.source,
          }));
        return {
          kind: "diagnostics",
          title: vscode.l10n.t("Problems — {0}", vscode.workspace.asRelativePath(editor.document.uri)),
          content: {
            path: editor.document.uri.fsPath,
            subtitle: vscode.l10n.t("{0} diagnostics from VS Code", diagnostics.length),
            diagnostics,
          },
        };
      }
      case "repository": {
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) throw new Error(vscode.l10n.t("Open a repository or workspace folder first"));
        const git = vscode.extensions.getExtension("vscode.git")?.exports?.getAPI?.(1);
        const branch = git?.getRepository?.(folder.uri)?.state?.HEAD?.name ?? null;
        return {
          kind: "repository",
          title: folder.name,
          content: {
            path: folder.uri.fsPath,
            branch,
            subtitle: branch
              ? vscode.l10n.t("Branch {0}", branch)
              : vscode.l10n.t("VS Code workspace repository"),
          },
        };
      }
      case "terminal": {
        const name = vscode.window.activeTerminal?.name || vscode.l10n.t("Terminal output");
        let text = (await vscode.env.clipboard.readText()).trim();
        if (!text) {
          text =
            (await vscode.window.showInputBox({
              title: vscode.l10n.t("Add terminal output"),
              prompt: vscode.l10n.t("Paste the terminal output to store in this Session"),
            })) || "";
        }
        if (!text) return null;
        // Terminal output routinely carries tokens and connection strings, and this
        // Session is shared — so this one capture asks before it leaves the machine.
        const confirmLabel = vscode.l10n.t("Add to Session");
        const accepted = await vscode.window.showWarningMessage(
          vscode.l10n.t(
            "Store the clipboard/pasted terminal output in this shared Creation Session? Review it for secrets first.",
          ),
          { modal: true },
          confirmLabel,
        );
        if (accepted !== confirmLabel) return null;
        return {
          kind: "terminal",
          title: name,
          content: {
            subtitle: vscode.l10n.t("Terminal output added from VS Code"),
            text: text.slice(0, 20_000),
            language: "text",
          },
        };
      }
      case "preview": {
        const url = await vscode.window.showInputBox({
          title: vscode.l10n.t("Add local service or browser preview"),
          prompt: vscode.l10n.t("Enter an http(s) URL"),
          placeHolder: "http://localhost:3000",
          validateInput: (value) =>
            /^https?:\/\//i.test(value) ? undefined : vscode.l10n.t("Enter an http(s) URL"),
        });
        if (!url) return null;
        return {
          kind: "service",
          title: new URL(url).host,
          content: { url, subtitle: vscode.l10n.t("Local service preview added from VS Code") },
        };
      }
      default:
        return null;
    }
  }

  protected onDispose(): void {
    CreationCanvasPanel.panels.delete(this.sessionId);
  }
}

/** The active editor, or a user-facing reason there isn't one. */
function requireEditor(): vscode.TextEditor {
  const editor = vscode.window.activeTextEditor;
  if (!editor) throw new Error(vscode.l10n.t("Open a file first"));
  return editor;
}

/** True when the editor is using a light (or high-contrast light) theme. */
function isLightTheme(): boolean {
  const kind = vscode.window.activeColorTheme.kind;
  return kind === vscode.ColorThemeKind.Light || kind === vscode.ColorThemeKind.HighContrastLight;
}

/**
 * The strings the canvas asks the HOST for. Everything the canvas renders itself
 * is translated by the web catalogs it ships with; these are the few labels the
 * editor owns — its capture actions and the pre-mount states — so they follow the
 * editor's display language through `vscode.l10n` like the rest of the extension.
 */
function canvasLabels(): Record<string, string> {
  return {
    "canvas.locale": vscode.env.language,
    "canvas.addFile": vscode.l10n.t("Add the active file"),
    "canvas.addSelection": vscode.l10n.t("Add the current selection"),
    "canvas.addProblems": vscode.l10n.t("Add this file's problems"),
    "canvas.addRepository": vscode.l10n.t("Add the workspace repository"),
    "canvas.addTerminal": vscode.l10n.t("Add terminal output"),
    "canvas.addPreview": vscode.l10n.t("Add a local service preview"),
    "canvas.noSession": vscode.l10n.t("No Creation Session is open."),
    "canvas.connecting": vscode.l10n.t("Connecting…"),
    "app.signInPrompt": vscode.l10n.t("Sign in to BuilderForce to start."),
    "app.signIn": vscode.l10n.t("Sign in"),
  };
}
