/**
 * The fast tier of the verifier (PRD 45 §4.4 pathDiagnostics): language-server
 * diagnostics for EXACTLY the requested files, even ones the editor never opened.
 *
 * Each path is opened via `vscode.workspace.openTextDocument` (a file that is not
 * shown still gets a TextDocument and its language server still reports), then we
 * wait for `onDidChangeDiagnostics` to fire for that URI or 3 s, and read
 * `vscode.languages.getDiagnostics`. A code file the language server was asked about
 * and reported clean yields a PASS record (findings empty) — a clean read is evidence;
 * only a path set with no code document to ask about yields no record (OD-3).
 *
 * Known limit (stated where it applies): the fast tier only sees the EDITED file.
 * Dependents in the same package are covered by the full tier's package typecheck;
 * dependents in OTHER packages are not checked — the reviewer and CI remain the
 * backstop.
 */
import * as path from "path";
import { formatDiagnostic } from "./formatDiagnostic";
/** One diagnostic → one "path:line:col severity message (code)" line, shared with prefetch. */
export { formatDiagnostic };
const CODE_LANGUAGES = new Set(["typescript", "typescriptreact", "javascript", "javascriptreact"]);
/** §4.4: wait for the language server to answer for THIS uri, at most this long. */
const DIAGNOSTIC_WAIT_MS = 3_000;
/** §4.2: a diagnostics record's findings are capped. */
const MAX_FINDINGS = 20;
/** The workspace root that absPaths are relativised against for display. */
function rootOf(vscodeLike, fallback) {
    return vscodeLike.workspace.workspaceFolders?.[0]?.uri.fsPath ?? fallback;
}
function isCodeLanguage(languageId) {
    return CODE_LANGUAGES.has(languageId);
}
/**
 * Diagnostics for exactly these absolute paths. Returns null when the language
 * server layer cannot answer here (no code document resolved) — `unavailable`; a
 * clean read is a pass record with no findings.
 */
export async function pathDiagnostics(absPaths, vscodeLike, opts) {
    const now = opts?.now ?? Date.now;
    const root = opts?.root ?? rootOf(vscodeLike, absPaths[0] ? path.dirname(absPaths[0]) : process.cwd());
    const byUri = new Map(); // uri string → absPath
    const diagnostics = new Map();
    // Open every path (even unopened ones) so its language server engages.
    const docs = [];
    for (const absPath of absPaths) {
        try {
            const doc = await Promise.resolve(vscodeLike.workspace.openTextDocument(vscodeLike.Uri.file(absPath)));
            if (!isCodeLanguage(doc.languageId))
                continue; // e.g. a .md edit — nothing to check here
            docs.push(doc);
            byUri.set(doc.uri.toString(), absPath);
        }
        catch {
            // The file cannot be opened (deleted, not in workspace): no diagnostics to read.
        }
    }
    if (docs.length === 0)
        return null;
    // Wait for the language servers to report for THESE uris, or 3 s — whichever first.
    await new Promise((resolve) => {
        const timer = setTimeout(done, DIAGNOSTIC_WAIT_MS);
        const sub = vscodeLike.languages.onDidChangeDiagnostics((e) => {
            for (const u of e.uris) {
                const abs = byUri.get(String(u));
                if (abs) {
                    diagnostics.set(abs, vscodeLike.languages.getDiagnostics(u));
                    if (diagnostics.size === docs.length)
                        done();
                }
            }
        });
        function done() {
            clearTimeout(timer);
            sub.dispose();
            resolve();
        }
    });
    // Read whatever is there now for every requested path (a server that answered
    // synchronously may never have fired the event).
    const lines = [];
    for (const doc of docs) {
        const abs = byUri.get(doc.uri.toString());
        if (!abs)
            continue;
        const diags = diagnostics.get(abs) ?? vscodeLike.languages.getDiagnostics(doc.uri);
        const rel = path.relative(root, abs).split(path.sep).join("/");
        for (const d of diags) {
            if ((d.severity ?? 0) > 1)
                continue; // only errors and warnings count
            lines.push(formatDiagnostic(rel, d));
            if (lines.length >= MAX_FINDINGS)
                break;
        }
    }
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
//# sourceMappingURL=pathDiagnostics.js.map