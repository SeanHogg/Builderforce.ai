/**
 * The run delta's attribution filter (PRD 41 §C1, "Concurrent human edits or parallel runs on the same tree"): only files the
 * run authored or modified enter the verdicts; the rest are `outside-run`, listed as "changed outside this run".
 *
 * The change set already drops a pre-existing edit the run never touched (`attributeRunChanges`). What it cannot tell apart is a
 * change made by ANOTHER run (or a person) on the same tree while this run was going: both baselines predate it. The rule:
 *
 *   1. WRITE EVIDENCE first. A file this run's own file tools created, edited or deleted (the run's recorded tool calls,
 *      `RunKnowledgeRecorder.activity`) is the run's, whoever else ran.
 *   2. Otherwise, CONSERVATIVE. When another run's window overlapped this run's on the same repository — a run still in
 *      flight (its lifecycle has a baseline and no finalization) or one whose change set was finalized after this run
 *      started — a changed file without write evidence is `outside-run`, for BOTH runs: neither can prove it wrote it (a
 *      shell command, a formatter, or the other run may have).
 *   3. No overlap: the change set's attribution stands (a shell write of a lone run is the run's).
 *
 * An in-flight lifecycle older than {@link STALE_RUN_MS} is a run that died without finalizing; it overlaps nothing.
 */

import * as path from "node:path";
import { scanByIndex, type LocalFirstStore } from "@builderforce/local-first";
import type { ChangedFileInput } from "@builderforce/run-delta";
import { OPEN_CHANGE_SET_LIFECYCLES, type ChangeSetLifecycleValue } from "../changeSetLifecycle";
import { CHANGE_SETS_BY_REPOSITORY, type LocalChangeSetValue } from "../runChangeSets";

/** An in-flight lifecycle older than this is a dead run's, not a parallel one. */
export const STALE_RUN_MS = 12 * 60 * 60 * 1000;

/** The run's own window and repository. */
export interface AttributionScope {
  runId: string;
  repository: string;
  /** The baseline's capture time (ISO): this run's window starts here. */
  since: string;
  /** Now (ISO): this run's window ends here. */
  until: string;
}

/** Whether another run's window overlapped this run's on the same repository. */
export async function overlappingRun(store: LocalFirstStore, scope: AttributionScope): Promise<boolean> {
  const staleBefore = new Date(Date.parse(scope.until) - STALE_RUN_MS).toISOString();
  let overlap = false;
  await store.read(async (tx) => {
    // Finalized during (or after the start of) this run: its window reached into ours.
    await scanByIndex<LocalChangeSetValue>(tx, CHANGE_SETS_BY_REPOSITORY, scope.repository, (row) => {
      const p = row.payload;
      if (p.runId !== scope.runId && typeof p.capturedAt === "string" && p.capturedAt >= scope.since) overlap = true;
    });
    if (overlap) return;
    // Still in flight: started before now, not finalized, and not a dead run's leftover.
    await scanByIndex<ChangeSetLifecycleValue>(tx, OPEN_CHANGE_SET_LIFECYCLES, "open", (row) => {
      const p = row.payload;
      const started = p.baseline?.capturedAt;
      if (p.runId === scope.runId || typeof started !== "string" || started > scope.until || started < staleBefore) return;
      if (p.baseline.repos.some((repo) => repo.repository === scope.repository)) overlap = true;
    });
  });
  return overlap;
}

/**
 * The run's write evidence as repository-relative POSIX paths: each recorded path (absolute, or relative to the workspace
 * folder the tools resolve against) resolved and kept when it lies inside `repoRoot`.
 */
export function writesInRepo(written: readonly string[], repoRoot: string, workspaceRoot: string | undefined): Set<string> {
  const out = new Set<string>();
  for (const p of written) {
    const abs = path.resolve(workspaceRoot ?? repoRoot, p);
    const rel = path.relative(repoRoot, abs);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) continue;
    out.add(rel.split(path.sep).join("/"));
  }
  return out;
}

/**
 * The change set's attribution as the engine reads it (see the module rule): write evidence keeps a file; an overlapping run
 * makes the rest `outside-run`; an unknown attribution is `outside-run`.
 */
export function deltaAttribution(
  file: { path: string; attribution: string },
  evidence: { writes?: ReadonlySet<string>; overlap: boolean },
): ChangedFileInput["attribution"] {
  if (file.attribution !== "run-authored" && file.attribution !== "run-modified-existing") return "outside-run";
  if (evidence.writes?.has(file.path)) return file.attribution;
  return evidence.overlap ? "outside-run" : file.attribution;
}
