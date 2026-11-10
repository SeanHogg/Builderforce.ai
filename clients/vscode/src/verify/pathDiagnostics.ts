/**
 * The fast tier of the verifier (PRD 45 §4.4 pathDiagnostics): language-server
 * diagnostics for EXACTLY the requested files, even ones the editor never opened.
 *
 * Each path is opened via `vscode.workspace.openTextDocument` (a file that is not
 * shown still gets a TextDocument and its language server still reports), then we
 * wait for `onDidChangeDiagnostics` to fire for that URI or 3 s, and read
 * `vscode.languages.getDiagnostics`. A file with no diagnostics at all yields no
 * record — nothing ran, so nothing is claimed (OD-3).
 *
 * Known limit (stated where it applies): the fast tier only sees the EDITED file.
 * Dependents in the same package are covered by the full tier's package typecheck;
 * dependents in OTHER packages are not checked — the reviewer and CI remain the
 * backstop.
 */

import * as path from "path";
// No runtime `vscode` import: the live module arrives as `VscodeLike`, so this tier runs under a fake in tests.
import type { CheckRecord } from "./types";
import { formatDiagnostic } from "./formatDiagnostic";

/** One diagnostic → one "path:line:col severity message (code)" line, shared with prefetch. */
export { formatDiagnostic };

const CODE_LANGUAGES = new Set(["typescript", "typescriptreact", "javascript", "javascriptreact"]);
/** §4.4: wait for the language server to answer for THIS uri, at most this long. */
const DIAGNOSTIC_WAIT_MS = 3_000;
/** §4.2: a diagnostics record's findings are capped. */
const MAX_FINDINGS = 20;

/** The vscode surface this module needs — the real module, or a fake in tests. */
export interface VscodeLike {
  workspace: {
    openTextDocument(uri: unknown): PromiseLike<{ uri: { fsPath: string; toString(): string }; languageId: string }>;
    readonly workspaceFolders?: readonly { uri: { fsPath: string } }[] | undefined;
  };
  languages: {
    getDiagnostics(uri: unknown): readonly FormattableDiagnosticLike[];
    onDidChangeDiagnostics: (listener: (e: { uris: readonly unknown[] }) => void) => { dispose(): void };
  };
  Uri: { file(p: string): unknown };
}

interface FormattableDiagnosticLike {
  severity?: number;
  message: string;
  source?: string;
  code?: unknown;
  range: { start: { line: number; character: number } };
}

/** The workspace root that absPaths are relativised against for display. */
function rootOf(vscodeLike: VscodeLike, fallback: string): string {
  return vscodeLike.workspace.workspaceFolders?.[0]?.uri.fsPath ?? fallback;
}

function isCodeLanguage(languageId: string): boolean {
  return CODE_LANGUAGES.has(languageId);
}

/**
 * Diagnostics for exactly these absolute paths. Returns null when the language
 * server layer cannot answer here (no files resolved, or no diagnostics reported
 * for any of them) — `unavailable`, never a silent pass.
 */
export async function pathDiagnostics(
  absPaths: readonly string[],
  vscodeLike: VscodeLike,
  opts?: { root?: string; now?: () => number },
): Promise<CheckRecord | null> {
  const now = opts?.now ?? Date.now;
  const root = opts?.root ?? rootOf(vscodeLike, absPaths[0] ? path.dirname(absPaths[0]) : process.cwd());
  const byUri = new Map<string, string>(); // uri string → absPath
  const diagnostics = new Map<string, readonly FormattableDiagnosticLike[]>();

  // Open every path (even unopened ones) so its language server engages.
  const docs: { uri: { fsPath: string; toString(): string }; languageId: string }[] = [];
  for (const absPath of absPaths) {
    try {
      const doc = await Promise.resolve(vscodeLike.workspace.openTextDocument(vscodeLike.Uri.file(absPath)));
      if (!isCodeLanguage(doc.languageId)) continue; // e.g. a .md edit — nothing to check here
      docs.push(doc);
      byUri.set(doc.uri.toString(), absPath);
    } catch {
      // The file cannot be opened (deleted, not in workspace): no diagnostics to read.
    }
  }
  if (docs.length === 0) return null;

  // Wait for the language servers to report for THESE uris, or 3 s — whichever first.
  await new Promise<void>((resolve) => {
    const timer = setTimeout(done, DIAGNOSTIC_WAIT_MS);
    const sub = vscodeLike.languages.onDidChangeDiagnostics((e) => {
      for (const u of e.uris) {
        const abs = byUri.get(String(u));
        if (abs) {
          diagnostics.set(abs, vscodeLike.languages.getDiagnostics(u));
          if (diagnostics.size === docs.length) done();
        }
      }
    });
    function done(): void {
      clearTimeout(timer);
      sub.dispose();
      resolve();
    }
  });

  // Read whatever is there now for every requested path (a server that answered
  // synchronously may never have fired the event).
  const lines: string[] = [];
  for (const doc of docs) {
    const abs = byUri.get(doc.uri.toString());
    if (!abs) continue;
    const diags = diagnostics.get(abs) ?? vscodeLike.languages.getDiagnostics(doc.uri);
    const rel = path.relative(root, abs).split(path.sep).join("/");
    for (const d of diags) {
      if ((d.severity ?? 0) > 1) continue; // only errors and warnings count
      lines.push(formatDiagnostic(rel, d));
      if (lines.length >= MAX_FINDINGS) break;
    }
  }
  if (lines.length === 0) return null;

  const hasError = lines.some((l) => l.split(/\s+/)[1] === "error");
  return {
    kind: "diagnostics",
    name: "lsp",
    outcome: hasError ? "fail" : "pass",
    exitCode: null,
    findings: lines,
    at: now(),
  };
}
