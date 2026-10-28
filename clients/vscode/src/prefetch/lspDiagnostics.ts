/**
 * The editor-only half of `diag.typecheck` (docs/design/deterministic-prefetch.md): the
 * problems the language servers ALREADY reported (`vscode.languages.getDiagnostics`) for
 * the files the person is working in, and those files themselves (the open documents in
 * the workspace) — the focus every scoped PreFetch action reads.
 *
 * Diagnostics are AVAILABLE only for a document a language server has open; when none of
 * the focus files is, the shared `tsc --noEmit` executor answers instead.
 */

import * as path from "path";
import * as vscode from "vscode";
import { PREFETCH_LIST_CAP_LINES, type LspDiagnostics } from "./executors";

const CODE_LANGUAGES = new Set(["typescript", "typescriptreact", "javascript", "javascriptreact"]);

/** Root-relative paths of the workspace's open file documents (the active editor first). */
export function openWorkspaceFiles(root: string): string[] {
  const active = vscode.window.activeTextEditor?.document;
  const docs = [...(active ? [active] : []), ...vscode.workspace.textDocuments];
  const out: string[] = [];
  for (const doc of docs) {
    if (doc.uri.scheme !== "file") continue;
    const rel = path.relative(root, doc.uri.fsPath);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) continue;
    const posix = rel.split(path.sep).join("/");
    if (!out.includes(posix)) out.push(posix);
  }
  return out;
}

const SEVERITY: Record<number, string> = { 0: "error", 1: "warning" };

/** The language servers' errors and warnings for the open code documents under `root`. */
export const lspDiagnostics: LspDiagnostics = async (root) => {
  const docs = vscode.workspace.textDocuments.filter((d) =>
    d.uri.scheme === "file" && CODE_LANGUAGES.has(d.languageId) && !path.relative(root, d.uri.fsPath).startsWith(".."));
  if (docs.length === 0) return { available: false, lines: [] };
  const lines: string[] = [];
  for (const doc of docs) {
    const rel = path.relative(root, doc.uri.fsPath).split(path.sep).join("/");
    for (const d of vscode.languages.getDiagnostics(doc.uri)) {
      const severity = SEVERITY[d.severity];
      if (!severity) continue;
      const code = typeof d.code === "object" ? d.code.value : d.code;
      lines.push(`${rel}:${d.range.start.line + 1}:${d.range.start.character + 1} ${severity} ${d.message.split("\n")[0]}${code !== undefined ? ` (${d.source ?? ""}${d.source ? " " : ""}${code})` : ""}`);
      if (lines.length >= PREFETCH_LIST_CAP_LINES) return { available: true, lines, files: docs.length };
    }
  }
  return { available: true, lines, files: docs.length };
};
