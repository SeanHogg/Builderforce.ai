/**
 * The `coverage` analyzer of the run delta (PRD 41 §C8.4, run-delta `ANALYZER_RULES`, after side only): the share of
 * the run's changed lines a test executed, from the coverage a test run left behind. It composes agent-tools'
 * per-line parsers (`lcovLineHits`, `istanbulLineHits`, the knowledge coverage badge's own) with run-delta's
 * `diffCoverageMetric` — it lives in the host because it needs both packages.
 *
 * Reports are looked for in a `coverage/` folder beside each changed file and every folder above it, up to the root.
 * A report older than the changed file describes other code and is not used. No report, or no changed line it
 * instruments: `skipped` / `no-coverage` — never 0%.
 */

import * as path from "node:path";
import { istanbulLineHits, lcovLineHits } from "@builderforce/agent-tools/knowledge";
import type { AnalyzerExec, AnalyzerSide, DeltaAnalyzer } from "@builderforce/agent-tools";
import { diffCoverageMetric, type DiffCoverageFile } from "@builderforce/run-delta";

export const COVERAGE_TOOL = "coverage";
/** The adapter's own version (C9): the measurement is ours, not a tool's. */
export const COVERAGE_VERSION = "1";

const REPORTS = [["coverage-final.json", istanbulLineHits], ["lcov.info", lcovLineHits]] as const;

/** Every folder from each changed file's own up to the root ('' = root), deepest first, deduped. */
function foldersOf(paths: readonly string[]): string[] {
  const out = new Set<string>();
  for (const p of paths) {
    const parts = p.split("/").slice(0, -1);
    for (let i = parts.length; i >= 0; i--) out.add(parts.slice(0, i).join("/"));
  }
  return [...out].sort((a, b) => b.split("/").length - a.split("/").length || (a < b ? -1 : 1));
}

async function lineHits(side: AnalyzerSide, exec: AnalyzerExec): Promise<Map<string, Map<number, boolean>>> {
  const hits = new Map<string, Map<number, boolean>>();
  const changedAt = new Map<string, number | undefined>();
  for (const f of side.changed) changedAt.set(f.path, await exec.mtime(`${side.dir}/${f.path}`));
  for (const folder of foldersOf(side.changed.map((f) => f.path))) {
    for (const [name, parse] of REPORTS) {
      const file = `${side.dir}/${folder ? `${folder}/` : ""}coverage/${name}`;
      const written = await exec.mtime(file);
      if (written === undefined) continue;
      const text = await exec.readText(file);
      if (!text) continue;
      for (const [p, lines] of parse(text, side.dir, folder)) {
        if (!changedAt.has(p) || hits.has(p)) continue; // the deepest report of a file wins
        const edited = changedAt.get(p);
        if (edited !== undefined && edited > written) continue; // stale: written before the file's last edit
        hits.set(p, lines);
      }
    }
  }
  return hits;
}

export const coverageAnalyzer: DeltaAnalyzer = {
  tool: COVERAGE_TOOL,
  async run(side, exec) {
    const files: DiffCoverageFile[] = side.changed
      .filter((f) => f.text !== undefined)
      .map((f) => ({ path: f.path, after: f.text!, ...(f.beforeText !== undefined ? { before: f.beforeText } : {}) }));
    if (files.length === 0) return { tool: COVERAGE_TOOL, version: COVERAGE_VERSION, status: "skipped", reason: "no-coverage", findings: [] };
    const metric = diffCoverageMetric(files, await lineHits(side, exec));
    return metric
      ? { tool: COVERAGE_TOOL, version: COVERAGE_VERSION, status: "ok", findings: [], metrics: [metric] }
      : { tool: COVERAGE_TOOL, version: COVERAGE_VERSION, status: "skipped", reason: "no-coverage", findings: [] };
  },
};

/** For tests: the folders searched for a set of changed paths. */
export const coverageFolders = (paths: readonly string[]): string[] => foldersOf(paths).map((f) => path.posix.join(f || ".", "coverage"));
