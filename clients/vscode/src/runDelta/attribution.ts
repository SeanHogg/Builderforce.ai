/**
 * The run delta's attribution filter (PRD 41 §C1, "Concurrent human edits or parallel runs on the same tree"): only files the
 * run authored or modified enter the verdicts; the rest are `outside-run`, listed as "changed outside this run".
 *
 * The change set already drops a pre-existing edit the run never touched (`attributeRunChanges`). What it cannot see is a
 * PARALLEL run on the same tree: both runs' baselines predate the other's writes, so both claim the file. The tie is settled
 * by the evidence the store holds: another run's change set of the same repository, finalized inside this run's window,
 * that claims the file at the content it has NOW wrote the file last — so for this run it is `outside-run`.
 */

import type { ChangedFileInput } from "@builderforce/run-delta";
import type { LocalFirstStore } from "@builderforce/local-first";
import type { LocalChangeSetValue } from "../runChangeSets";

/** The run's own window and repository. */
export interface AttributionScope {
  runId: string;
  repository: string;
  /** The baseline's capture time (ISO): another run's set finalized after it overlapped this run. */
  since: string;
}

/** path → the after hash another run, finalized inside this run's window, claimed it at. */
export async function parallelClaims(store: LocalFirstStore, scope: AttributionScope): Promise<Map<string, Set<string>>> {
  const claims = new Map<string, Set<string>>();
  await store.read(async (tx) => {
    await tx.scan<LocalChangeSetValue>("change-set", (row) => {
      const p = row.payload;
      if (row.deletedAt || !p || p.runId === scope.runId || p.repository !== scope.repository) return;
      if (typeof p.capturedAt !== "string" || p.capturedAt < scope.since || !Array.isArray(p.files)) return;
      for (const file of p.files) {
        if (!file?.afterHash) continue;
        const set = claims.get(file.path) ?? new Set<string>();
        set.add(file.afterHash);
        claims.set(file.path, set);
      }
    });
  });
  return claims;
}

/**
 * The change set's attribution as the engine reads it: the run's own kinds pass through, anything else (or a file a parallel
 * run claimed at its current content) is `outside-run`. `claims` hold the change set's own `sha256:` fingerprints.
 */
export function deltaAttribution(
  file: { path: string; afterHash?: string; attribution: string },
  claims: ReadonlyMap<string, ReadonlySet<string>>,
): ChangedFileInput["attribution"] {
  if (file.attribution !== "run-authored" && file.attribution !== "run-modified-existing") return "outside-run";
  if (file.afterHash && claims.get(file.path)?.has(file.afterHash)) return "outside-run";
  return file.attribution;
}
