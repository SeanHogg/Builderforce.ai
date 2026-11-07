/**
 * Retry (PRD 41 A8): the files that failed are marked OWED in the root's manifest, so the next incremental
 * plan lists them as changed even when their bytes did not move. This writes the very entry memory's planner
 * reads (`extractorManifestKey`: `owed:<path>` fingerprints beside the extractor `version`); it adds to what is
 * there and changes nothing else. A path the root never listed is ignored by the planner, so a stale one is harmless.
 */

import type { IngestManifest } from "@seanhogg/builderforce-memory/ingest";
import { extractorManifestKey } from "@seanhogg/builderforce-memory/knowledge";

/** Memory's id for an owed file in the extractor entry (owedFiles.ts); the hash is the model calls it is still expected to cost. */
const OWED_PREFIX = "owed:";
/** The one call a re-extraction may add (memory's own estimate for an owed file). */
const OWED_CALLS = "1";

export async function markOwed(manifest: IngestManifest, rootId: string, paths: readonly string[]): Promise<number> {
  const key = extractorManifestKey(rootId);
  const entry = (await manifest.get(key)) ?? [];
  const held = new Set(entry.map((f) => f.id));
  const added = [...new Set(paths)].filter((p) => !held.has(`${OWED_PREFIX}${p}`));
  if (added.length === 0) return 0;
  await manifest.set(key, [...entry, ...added.map((p) => ({ id: `${OWED_PREFIX}${p}`, hash: OWED_CALLS }))]);
  return added.length;
}
