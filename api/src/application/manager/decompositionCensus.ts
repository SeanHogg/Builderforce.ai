/**
 * WHO planned this project's Epics — the LLM, or the degraded markdown fallback?
 *
 * `tasks.decomposition_source` has been written on every decomposition since the
 * column existed ('llm' | 'heuristic' | 'manual'), and nothing has ever displayed
 * it. That made a real failure mode invisible: when the model pool is unavailable,
 * `llmEpicDecomposer` silently degrades to `heuristicEpicDecomposer`, which infers
 * no estimates and no sequence, so its children land flat and thin. The board then
 * fills with visibly worse tickets and the only available explanation is "the AI
 * is bad at planning" — when the actual fact is that no model answered.
 *
 * A count is what turns that into an incident someone can act on: one heuristic
 * Epic is a coincidence, a RUN of them is an outage. Computed here, in the
 * application layer, so the manager surface renders a number rather than deriving
 * one from a list it happens to have loaded.
 */

import { eq, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { tasks } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { notSystemTask } from '../task/taskScope';

/**
 * Heuristic Epics needed before a run reads as an INCIDENT rather than a one-off.
 * Below this, a single fallback is just a single fallback — flagging it would teach
 * people to ignore the flag.
 */
export const DEGRADED_MIN_HEURISTIC = 3;
/** …and the share of decomposed Epics it must represent. */
export const DEGRADED_HEURISTIC_PCT = 40;

export interface DecompositionCensus {
  /** Epics with a recorded source — the denominator for {@link heuristicPct}. */
  decomposed: number;
  llm: number;
  /** The DEGRADED path: the markdown-checklist fallback that runs when no model answers. */
  heuristic: number;
  manual: number;
  /** Epics with no recorded source (decomposed before the column, or never decomposed). */
  unrecorded: number;
  /** Heuristic share of decomposed Epics, 0-100 (0 when nothing is decomposed). */
  heuristicPct: number;
  /**
   * TRUE when the fallback has produced enough of this project's plans to be read
   * as a model-availability incident rather than as poor tickets.
   */
  degraded: boolean;
}

export function emptyDecompositionCensus(): DecompositionCensus {
  return { decomposed: 0, llm: 0, heuristic: 0, manual: 0, unrecorded: 0, heuristicPct: 0, degraded: false };
}

/**
 * Fold raw per-source counts into the census. PURE — the thresholds are the
 * interesting part and they are testable without a database.
 */
export function foldDecompositionCensus(
  counts: readonly { source: string | null; n: number }[],
): DecompositionCensus {
  const out = emptyDecompositionCensus();
  for (const row of counts) {
    const n = Number(row.n) || 0;
    if (row.source === 'llm') out.llm += n;
    else if (row.source === 'heuristic') out.heuristic += n;
    else if (row.source === 'manual') out.manual += n;
    else out.unrecorded += n;
  }
  out.decomposed = out.llm + out.heuristic + out.manual;
  out.heuristicPct = out.decomposed > 0 ? Math.round((out.heuristic / out.decomposed) * 100) : 0;
  out.degraded = out.heuristic >= DEGRADED_MIN_HEURISTIC && out.heuristicPct >= DEGRADED_HEURISTIC_PCT;
  return out;
}

/** One grouped aggregate over the project's Epics — no per-row read. */
export async function computeDecompositionCensus(
  db: Db,
  tenantId: number,
  projectId: number,
): Promise<DecompositionCensus> {
  const rows = await db
    .select({ source: tasks.decompositionSource, n: sql<number>`count(*)::int` })
    .from(tasks)
    .where(scopedToTenant(
      tasks,
      tenantId,
      eq(tasks.projectId, projectId),
      eq(tasks.taskType, 'epic'),
      eq(tasks.archived, false),
      notSystemTask,
    ))
    .groupBy(tasks.decompositionSource);
  return foldDecompositionCensus(rows.map((r) => ({ source: r.source ?? null, n: Number(r.n) })));
}
