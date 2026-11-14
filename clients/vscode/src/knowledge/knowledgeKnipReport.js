/**
 * knip's own REPORT (the pinned analyzer, `--reporter=json`, nothing changed), read two ways:
 *
 *   preview  what the fix would remove: per file, the unused export the finding names (every
 *            unused export of the file for a finding that names none), as a dry run without writing a byte;
 *   re-scan  whether the finding is gone: its export (or file) no longer appears in the report.
 *
 * The report goes to a temp file (stdout is capped for display, and a real report is large).
 */
import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { knipReportCommand, parseAnalyzerJson } from "@builderforce/agent-tools";
import { knipRanOk } from "./knowledgeFixes";
import { runShell } from "./knowledgeShell";
const REPORT_TIMEOUT_MS = 10 * 60_000;
const norm = (p) => p.replace(/\\/g, "/").replace(/^\.\//, "");
/** Runs the report in the root. Rejects with the shell's failure, or when the output is not a knip report. */
export async function runKnipReport(rootPath, signal) {
    const out = join(tmpdir(), `bf-knip-${randomUUID()}.json`);
    try {
        await runShell(`${knipReportCommand()} > "${out}"`, rootPath, { ok: knipRanOk, timeoutMs: REPORT_TIMEOUT_MS, label: "knip", ...(signal ? { signal } : {}) });
        const value = parseAnalyzerJson(await readFile(out, "utf8"));
        if (!Array.isArray(value.files) || !Array.isArray(value.issues))
            throw new Error("Invalid unused-code report");
        return { files: value.files.map(norm), issues: value.issues.map((i) => ({ ...i, file: norm(i.file) })) };
    }
    finally {
        await rm(out, { force: true }).catch(() => undefined);
    }
}
/** A file's unused exports in knip's report: only `exportName` when the finding names one. */
const unusedExportsOf = (report, path, exportName) => (report.issues.find((i) => i.file === path)?.exports ?? []).filter((e) => exportName === undefined || e.name === exportName);
/** The finding's files still reported by knip for its kind (for an `unused-export` naming one export, only while THAT export is reported). Pure. */
export function stillReported(report, kind, wanted, exportName) {
    const want = [...new Set(wanted.map(norm))];
    if (kind === "unused-file")
        return report.files.filter((f) => want.includes(f));
    if (kind === "unused-export")
        return want.filter((f) => unusedExportsOf(report, f, exportName).length > 0);
    return [];
}
/** What the fix removes, per file, from knip's report (only `exportName` when the finding names one). A file knip no longer reports is listed with nothing to remove. Pure. */
export function previewOf(report, kind, wanted, exportName) {
    return wanted.map((raw) => {
        const path = norm(raw);
        if (kind === "unused-export") {
            const names = unusedExportsOf(report, path, exportName);
            return { path, ...(names.length > 0 ? { removed: names.length, lines: names.map((e) => `- export ${e.name}${e.line ? `  (line ${e.line})` : ""}`) } : {}) };
        }
        return { path, ...(report.files.includes(path) ? { removed: 1, lines: ["- (the whole file)"] } : {}) };
    });
}
//# sourceMappingURL=knowledgeKnipReport.js.map