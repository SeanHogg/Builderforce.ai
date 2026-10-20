/**
 * projectFacts DECAY — beliefs recall has not returned within the window are expired
 * (never deleted) by the scheduled sweep (1248). Recall stamps `last_recalled_at`
 * (`projectFactsRecall.stampFactRecall`) first; this only then expires what it drops.
 */
import { and, eq, gt, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { projectFacts } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import type { Db } from '../../infrastructure/database/connection';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { QA_CACHE_SOURCE } from './projectFactsStore';

/** A fact never returned by recall within this window is expired by the sweep. */
export const UNRECALLED_DECAY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Drop beliefs that have not been recalled within `windowMs` of `now`.
 *
 * Pure and total: a fact with no `lastRecalledAt` has never been recalled, so it is
 * the first thing this drops, and a fact recalled inside the window survives.
 * `sweepUnrecalledFactDecay` is what runs this against the table — recall stamps
 * `last_recalled_at` first, and the sweep only then expires what this filter drops.
 * Calling it before that stamp exists would expire every row. `now` is injectable
 * so a test does not depend on the clock.
 */
export function decayUnrecalled<T extends { lastRecalledAt?: string | null }>(
  facts: readonly T[],
  now: Date,
  windowMs: number,
): T[] {
  if (!(windowMs > 0)) return [...facts];
  const cutoff = now.getTime() - windowMs;
  return facts.filter((fact) => {
    if (!fact.lastRecalledAt) return false;
    const recalled = new Date(fact.lastRecalledAt).getTime();
    return Number.isFinite(recalled) && recalled >= cutoff;
  });
}

/**
 * Expire facts recall has not returned within `windowMs` (1248).
 *
 * Same predicate as `decayUnrecalled`, with one guard that comment names: recall
 * stamps `last_recalled_at` first, and the sweep only then expires a missing
 * stamp. A column that has not been stamped yet is NULL on every row, and
 * treating that as "never recalled" would expire the whole project on the first
 * sweep. The NULL branch therefore requires that SOME row in this scope already
 * has a stamp. A fact recalled inside the window has a timestamp past the cutoff
 * and is not in either branch. Written as an EXPIRY, not a delete. `updated_at`
 * is not touched: a sweep is not a rewrite.
 */
export async function sweepUnrecalledFactDecay(
  db: Db,
  tenantId: number,
  projectId: number,
  opts?: { now?: Date; windowMs?: number },
): Promise<number> {
  const now = opts?.now ?? new Date();
  const windowMs = opts?.windowMs ?? UNRECALLED_DECAY_WINDOW_MS;
  if (!Number.isInteger(projectId) || projectId <= 0) return 0;
  if (!(windowMs > 0)) return 0;
  const cutoff = new Date(now.getTime() - windowMs);
  const expired = await db
    .update(projectFacts)
    .set({ expiresAt: now })
    .where(and(
      scopedToTenant(projectFacts, tenantId),
      eq(projectFacts.projectId, projectId),
      isNull(projectFacts.supersededBy),
      ne(projectFacts.source, QA_CACHE_SOURCE),
      or(
        // Recalled, and outside the window. A timestamp is evidence the column
        // has been stamped, so this branch is safe even on the first sweep.
        lt(projectFacts.lastRecalledAt, cutoff),
        // Never recalled — but only once a stamp exists in this scope. See the
        // comment on `decayUnrecalled`: calling the filter before that stamp
        // exists would expire every row.
        and(
          isNull(projectFacts.lastRecalledAt),
          sql`EXISTS (
            SELECT 1 FROM project_facts AS stamped_recall
            WHERE stamped_recall.tenant_id = ${tenantId}
              AND stamped_recall.project_id = ${projectId}
              AND stamped_recall.last_recalled_at IS NOT NULL
          )`,
        ),
      ),
      or(isNull(projectFacts.expiresAt), gt(projectFacts.expiresAt, now)),
    ))
    .returning({ key: projectFacts.key })
    .catch((err: unknown) => {
      // The sweep RETURNS this count. Zero is indistinguishable from "nothing
      // expired", so a failed delete must be reported — otherwise a systematically
      // failing sweep reports a clean bill of health forever and nothing ever decays.
      reportCaughtError(err, { source: 'project-facts', operation: 'sweep-unrecalled-fact-decay', level: 'error', context: { tenantId, projectId } });
      return [] as Array<{ key: string }>;
    });
  return expired.length;
}

/** Every (tenantId, projectId) that has facts, so a sweep can run without a
 *  caller-supplied project. Used by the cron entrypoint. */
export async function listProjectFactScopes(db: Db): Promise<Array<{ tenantId: number; projectId: number }>> {
  const rows = await db
    .selectDistinct({ tenantId: projectFacts.tenantId, projectId: projectFacts.projectId })
    .from(projectFacts)
    .catch((err: unknown) => {
      // The cron entrypoint decides WHICH SCOPES to sweep from this list. An empty
      // list on failure means the sweep silently does nothing and no fact anywhere in
      // the workspace ever decays, so this is an error, not a warning.
      reportCaughtError(err, { source: 'project-facts', operation: 'list-fact-scopes', level: 'error' });
      return [] as Array<{ tenantId: number; projectId: number }>;
    });
  return rows.filter((r) => Number.isInteger(r.tenantId) && Number.isInteger(r.projectId));
}

/** Decay across every project scope, for the scheduled sweep. */
export async function sweepAllUnrecalledFactDecay(
  db: Db,
  opts?: { now?: Date; windowMs?: number },
): Promise<number> {
  const scopes = await listProjectFactScopes(db);
  let expired = 0;
  for (const scope of scopes) {
    expired += await sweepUnrecalledFactDecay(db, scope.tenantId, scope.projectId, opts).catch((err: unknown) => {
      // The per-scope sweep already reports its own failure; this catch exists so one
      // broken tenant cannot abort the loop and leave every LATER scope undecayed.
      // Reporting keeps the reason visible instead of folding it into the total.
      reportCaughtError(err, { source: 'project-facts', operation: 'sweep-fact-decay-per-scope', level: 'error', context: { tenantId: scope.tenantId, projectId: scope.projectId } });
      return 0;
    });
  }
  return expired;
}
