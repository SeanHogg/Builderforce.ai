/**
 * Shared diagnostic line formatter — the ONE place a language-server diagnostic
 * becomes a "path:line:col severity message (code)" line. `prefetch/lspDiagnostics.ts`
 * (the prefetch focus) and `verify/` (the deterministic verifier) both format through
 * this so a diagnostic line reads identically on both surfaces (PRD 45 §4.4
 * pathDiagnostics: the formatter is extracted from lspDiagnostics and shared).
 */
const SEVERITY = { 0: "error", 1: "warning" };
/** One diagnostic → one line. `relPath` is the display path (repo-relative, forward slashes). */
export function formatDiagnostic(relPath, d) {
    const severity = d.severity !== undefined ? SEVERITY[d.severity] : undefined;
    const code = typeof d.code === "object" && d.code !== null ? d.code.value : d.code;
    return (`${relPath}:${d.range.start.line + 1}:${d.range.start.character + 1} ` +
        `${severity ?? "info"} ${d.message.split("\n")[0]}` +
        (code !== undefined ? ` (${d.source ?? ""}${d.source ? " " : ""}${code})` : ""));
}
//# sourceMappingURL=formatDiagnostic.js.map