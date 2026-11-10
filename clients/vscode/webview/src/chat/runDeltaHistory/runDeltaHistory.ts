/**
 * The run delta history in the editor (PRD 41 §C11.3), as pure data: the `run-delta/history` request and the guard over
 * its answer. The host reads the repository's local `run-delta` records and answers the engine's `RunDeltaSummary` rows,
 * newest first (`clients/vscode/src/runDelta/runDeltaHistory.ts`).
 */

import type { RunDeltaSummary } from '@builderforce/run-delta';

/** Request `{ repo, limit? }` → `RunDeltaSummary[]`. */
export const RUN_DELTA_HISTORY = 'run-delta/history';

/** How many past runs the panel asks for. */
export const HISTORY_LIMIT = 50;

/** A `run-delta/history` answer → rows; anything else (an older host, an error shape) → none, and a malformed row is dropped. */
export function historyFromAnswer(answer: unknown): RunDeltaSummary[] {
  if (!Array.isArray(answer)) return [];
  return answer.filter((s): s is RunDeltaSummary =>
    !!s && typeof s === 'object'
    && typeof s.runId === 'string' && typeof s.repoKey === 'string' && typeof s.computedAt === 'string' && typeof s.headline === 'string'
    && !!s.verdicts && typeof s.verdicts === 'object'
    && !!s.counts && typeof s.counts.introduced === 'number' && typeof s.counts.resolved === 'number'
    && !!s.blastRadius && typeof s.blastRadius.score === 'number' && typeof s.blastRadius.band === 'string'
    && Array.isArray(s.blocking));
}
