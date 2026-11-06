/**
 * knip's own REPORT (the pinned analyzer, `--reporter=json`, nothing changed), read two ways:
 *
 *   preview  what the fix would remove: per file, the unused exports it names (this is knip's own
 *            list of what `--fix` deletes, so it is a dry run without writing a byte);
 *   re-scan  whether the finding is gone: the finding's files no longer appear in the report.
 *
 * The report goes to a temp file (stdout is capped for display, and a real report is large).
 */

import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { knipReportCommand, parseAnalyzerJson } from "@builderforce/agent-tools";
import type { FixPreviewRow } from "./knowledgeProtocol";
import { knipRanOk } from "./knowledgeFixes";
import { runShell } from "./knowledgeShell";

const REPORT_TIMEOUT_MS = 10 * 60_000;

interface KnipIssue { file: string; exports?: { name: string; line?: number }[] }
export interface KnipReport { files: string[]; issues: KnipIssue[] }

const norm = (p: string): string => p.replace(/\\/g, "/").replace(/^\.\//, "");

/** Runs the report in the root. Rejects with the shell's failure, or when the output is not a knip report. */
export async function runKnipReport(rootPath: string, signal?: AbortSignal): Promise<KnipReport> {
  const out = join(tmpdir(), `bf-knip-${randomUUID()}.json`);
  try {
    await runShell(`${knipReportCommand()} > "${out}"`, rootPath, { ok: knipRanOk, timeoutMs: REPORT_TIMEOUT_MS, label: "knip", ...(signal ? { signal } : {}) });
    const value = parseAnalyzerJson(await readFile(out, "utf8")) as { files?: unknown; issues?: unknown };
    if (!Array.isArray(value.files) || !Array.isArray(value.issues)) throw new Error("Invalid unused-code report");
    return { files: (value.files as string[]).map(norm), issues: (value.issues as KnipIssue[]).map((i) => ({ ...i, file: norm(i.file) })) };
  } finally {
    await rm(out, { force: true }).catch(() => undefined);
  }
}

/** The finding's files still reported by knip for its kind. Pure. */
export function stillReported(report: KnipReport, kind: string, wanted: readonly string[]): string[] {
  const want = new Set(wanted.map(norm));
  if (kind === "unused-file") return report.files.filter((f) => want.has(f));
  if (kind === "unused-export") return report.issues.filter((i) => want.has(i.file) && (i.exports?.length ?? 0) > 0).map((i) => i.file);
  return [];
}

/** What the fix removes, per file, from knip's report. A file knip no longer reports is listed with nothing to remove. Pure. */
export function previewOf(report: KnipReport, kind: string, wanted: readonly string[]): FixPreviewRow[] {
  return wanted.map((raw): FixPreviewRow => {
    const path = norm(raw);
    if (kind === "unused-export") {
      const names = report.issues.find((i) => i.file === path)?.exports ?? [];
      return { path, ...(names.length > 0 ? { removed: names.length, lines: names.map((e) => `- export ${e.name}${e.line ? `  (line ${e.line})` : ""}`) } : {}) };
    }
    return { path, ...(report.files.includes(path) ? { removed: 1, lines: ["- (the whole file)"] } : {}) };
  });
}
