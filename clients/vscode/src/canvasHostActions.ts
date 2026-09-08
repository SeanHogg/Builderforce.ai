import * as vscode from "vscode";
import { getWebBaseUrl } from "./gateway";

/**
 * WHAT ONLY THE EDITOR CAN DO for the canvas — capture from the workspace, reveal a
 * captured file, and decide what an in-app route means in VS Code.
 *
 * ── WHY IT IS A MODULE AND NOT A PANEL ───────────────────────────────────────
 * It used to be the body of `CreationCanvasPanel`, a second webview panel beside the
 * chat one. Those panels merged (chat is a SURFACE of the canvas, not a separate
 * place — see `webview/src/WorkspaceApp.tsx`), and folding ~250 lines of capture
 * switch into the surviving panel would have made a class that owns run lifecycle,
 * chat registry, tab status, editor context, local-fetch proxying AND clipboard
 * capture — a file everyone has to edit.
 *
 * So the panel keeps the lifecycle and delegates here. Nothing in this module holds
 * panel state: every function takes what it needs and answers with data, which is
 * also what makes the capture switch readable on its own.
 */

/** An object captured from the editor, in the shape `@/lib/canvasHost` expects. */
export interface CanvasCapture {
  kind: string;
  title: string;
  content: Record<string, unknown>;
}

/** Reveal a captured file, at its captured range when there is one. */
export async function openCapturedFile(
  path: string,
  range?: { startLine: number; startColumn: number; endLine: number; endColumn: number },
): Promise<void> {
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path));
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
 * Follow an in-app route. A webview has no history, so each route maps to the editor
 * action that means the same thing, and anything unrecognised opens in the browser
 * rather than navigating the panel's own document (which would blank it with no way
 * back).
 *
 * `openSession` is supplied by the caller rather than imported: this module must not
 * reach back into the panel that owns it, or the two are circular and neither can be
 * read alone.
 */
export function navigateFromCanvas(path: string, openSession: (sessionId: string) => void): void {
  const session = /^\/create\/([^/?#]+)/.exec(path);
  if (session) return openSession(session[1]);
  if (path.startsWith("/login") || path.startsWith("/register")) {
    void vscode.commands.executeCommand("builderforce.signIn");
    return;
  }
  void vscode.env.openExternal(vscode.Uri.parse(`${getWebBaseUrl()}${path}`));
}

export async function captureFromEditor(action: string | undefined): Promise<CanvasCapture | null> {
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

/** The active editor, or a user-facing reason there isn't one. */
function requireEditor(): vscode.TextEditor {
  const editor = vscode.window.activeTextEditor;
  if (!editor) throw new Error(vscode.l10n.t("Open a file first"));
  return editor;
}

/** True when the editor is using a light (or high-contrast light) theme. */
export function isLightTheme(): boolean {
  const kind = vscode.window.activeColorTheme.kind;
  return kind === vscode.ColorThemeKind.Light || kind === vscode.ColorThemeKind.HighContrastLight;
}

/**
 * The strings the canvas asks the HOST for. Everything the canvas renders itself is
 * translated by the web catalogs it ships with; these are the few labels the editor
 * owns — its capture actions and the pre-mount states — so they follow the editor's
 * display language through `vscode.l10n` like the rest of the extension.
 *
 * They are MERGED into the chat surface's bundle rather than replacing it: one panel
 * now renders both, so both sets have to be present whichever surface it opens at.
 */
export function canvasLabels(): Record<string, string> {
  return {
    "canvas.locale": vscode.env.language,
    "canvas.addFile": vscode.l10n.t("Add the active file"),
    "canvas.addSelection": vscode.l10n.t("Add the current selection"),
    "canvas.addProblems": vscode.l10n.t("Add this file's problems"),
    "canvas.addRepository": vscode.l10n.t("Add the workspace repository"),
    "canvas.addTerminal": vscode.l10n.t("Add terminal output"),
    "canvas.addPreview": vscode.l10n.t("Add a local service preview"),
    "canvas.noSession": vscode.l10n.t("No Creation Session is open."),
    "canvas.degraded": vscode.l10n.t("The board could not be drawn. The conversation is still here."),
    "canvas.connecting": vscode.l10n.t("Connecting…"),
    "app.signInPrompt": vscode.l10n.t("Sign in to BuilderForce to start."),
    "app.signIn": vscode.l10n.t("Sign in"),
  };
}
