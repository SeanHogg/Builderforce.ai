/**
 * A repository's run delta HISTORY on this device (PRD 41 §C11.3): its stored `run-delta` records, read through the
 * repository index (never a scan of every delta), projected to the engine's own `RunDeltaSummary` — the same rows the web
 * lists from `/api/projects/:id/run-deltas`, so the ONE history view renders both. Newest first, at most `limit`.
 *
 * The webview names the repository as the card does (`repo`: remote URL, else the local root); the index key is its synced
 * identity ({@link syncedRepository}), so a local root never has to leave the host to be looked up.
 */

import { scanByIndex, type LocalFirstStore } from "@builderforce/local-first";
import { summarizeRunDelta, type RunDeltaSummary } from "@builderforce/run-delta";
import { RUN_DELTAS_BY_REPOSITORY, syncedRepository, type RunDeltaRecordValue } from "./runDeltaRecords";

/** The most rows one request returns. */
export const MAX_HISTORY = 200;
export const DEFAULT_HISTORY = 50;

export async function readRunDeltaHistory(store: LocalFirstStore, query: { repo: string; limit?: number }): Promise<RunDeltaSummary[]> {
  if (!query.repo) return [];
  const limit = Math.max(1, Math.min(MAX_HISTORY, Math.floor(query.limit ?? DEFAULT_HISTORY)));
  const repository = syncedRepository(query.repo);
  const rows: RunDeltaSummary[] = [];
  await store.read(async (tx) => {
    await scanByIndex<RunDeltaRecordValue>(tx, RUN_DELTAS_BY_REPOSITORY, repository, (row) => {
      const value = row.payload;
      if (row.deletedAt || !value?.delta || !Array.isArray(value.delta.dimensions)) return;
      rows.push(summarizeRunDelta(value.delta, { repoKey: value.repository, surface: "vscode", mode: value.mode, computedAt: row.occurredAt }));
    });
  });
  return rows
    .sort((a, b) => b.computedAt.localeCompare(a.computedAt) || a.runId.localeCompare(b.runId))
    .slice(0, limit);
}
