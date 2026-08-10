/**
 * The host-side reader for the live editor context — the "what file/folder is open
 * and the corresponding code" the agent needs so it can resolve "this file" / "the
 * selection" without guessing a path. Reads `vscode.window` on demand and formats to
 * the shared, host-free {@link EditorContext} shape so both chat surfaces (the native
 * `@builderforce` participant and the React Brain webview) render it through the ONE
 * shared {@link editorContextDirective} (see `idePersona.ts`) — one reader, one
 * formatter, both surfaces.
 */

import * as vscode from "vscode";
import { detectGitContext, peekGitContext, watchGitContext } from "./gitContext";
import type { EditorContext } from "./idePersona";

/** Bound the selection text handed to the model (a whole-file select shouldn't blow the prompt). */
const MAX_SELECTION_CHARS = 4000;
/** Debounce editor-change bursts (drag-select fires selection events per pixel). */
const DEBOUNCE_MS = 150;

/** Workspace-relative path for a document uri (falls back to the raw path). */
function rel(uri: vscode.Uri): string {
  return vscode.workspace.asRelativePath(uri, false);
}

/** The absolute fsPath of the primary workspace folder — the root local tools resolve against. */
function workspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/**
 * Snapshot the current editor context, or undefined when nothing relevant is open.
 * SYNCHRONOUS by design (the debounced watcher and the webview push read it on the
 * hot path); git facts come from the TTL cache via {@link peekGitContext}, which
 * detects in the background on a miss and wakes {@link watchEditorContext}. Use
 * {@link getEditorContextLive} when it matters that git is resolved on the FIRST read.
 */
export function getEditorContext(): EditorContext | undefined {
  const folders = vscode.workspace.workspaceFolders;
  const workspaceName = folders?.length ? folders.map((f) => f.name).join(", ") : undefined;
  const root = workspaceRoot();
  const git = peekGitContext(root);

  // Distinct on-disk files across all open tabs (tabs, not just visible panes, so
  // background tabs the user has open still count as "open").
  const openFiles = [
    ...new Set(
      vscode.window.tabGroups.all
        .flatMap((g) => g.tabs)
        .map((t) => (t.input instanceof vscode.TabInputText ? t.input.uri : undefined))
        .filter((u): u is vscode.Uri => !!u && u.scheme === "file")
        .map(rel),
    ),
  ];

  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.scheme !== "file") {
    if (!workspaceName && !openFiles.length && !root) return undefined;
    return { workspaceName, workspaceRoot: root, git, openFiles: openFiles.length ? openFiles : undefined };
  }

  const doc = editor.document;
  const activeFile = rel(doc.uri);
  const sel = editor.selection;

  let selection: EditorContext["selection"];
  if (!sel.isEmpty) {
    const raw = doc.getText(sel);
    const text = raw.length > MAX_SELECTION_CHARS ? `${raw.slice(0, MAX_SELECTION_CHARS)}\n…(selection truncated)` : raw;
    selection = {
      path: activeFile,
      startLine: sel.start.line + 1,
      endLine: sel.end.line + 1,
      text,
      languageId: doc.languageId,
    };
  }

  return {
    workspaceName,
    workspaceRoot: root,
    git,
    activeFile,
    languageId: doc.languageId,
    cursor: { line: sel.active.line + 1, column: sel.active.character + 1 },
    selection,
    openFiles: openFiles.length ? openFiles : undefined,
  };
}

/**
 * The editor context with git detection AWAITED — for the one-shot reads where the
 * repo facts must be present on the first pass (a chat turn's system prompt, the
 * webview's init payload) rather than arriving a tick later.
 */
export async function getEditorContextLive(): Promise<EditorContext | undefined> {
  const root = workspaceRoot();
  if (root) await detectGitContext(root); // populates the TTL cache `getEditorContext` peeks
  return getEditorContext();
}

/**
 * Fire `onChange` (debounced) whenever the editor context could have changed — the
 * active editor, the visible editors, the open tabs, the selection, or the git state
 * (checkout / commit / stage, which changes the branch the agent is working on).
 * Returns a disposable that tears down every subscription. Used by the Brain webview
 * to push live context to the React app; the native participant reads fresh each turn
 * so it needs no watcher.
 */
export function watchEditorContext(onChange: () => void): vscode.Disposable {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const fire = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(onChange, DEBOUNCE_MS);
  };
  const subs = [
    vscode.window.onDidChangeActiveTextEditor(fire),
    vscode.window.onDidChangeVisibleTextEditors(fire),
    vscode.window.onDidChangeTextEditorSelection(fire),
    vscode.window.tabGroups.onDidChangeTabs(fire),
    vscode.workspace.onDidChangeWorkspaceFolders(fire),
    watchGitContext(fire),
  ];
  return new vscode.Disposable(() => {
    if (timer) clearTimeout(timer);
    for (const s of subs) s.dispose();
  });
}
