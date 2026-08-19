/**
 * AI adoption — the share of DELIVERED work that an agent actually worked on.
 *
 * ── WHY THIS REPLACED A PROXY ───────────────────────────────────────────────
 * The benchmarking lens defined `ai_adoption_pct` as "% of delivered work touched
 * by AI" — that is what migration 0230 seeded its cohort percentiles against —
 * and then computed it as `ciGreenRatePct`: the fraction of AI RUNS that came out
 * of CI green. Those are different quantities, and they move in opposite
 * directions in the case that matters. A team with one flawless agent on one
 * ticket scores 100% adoption. A team rolling AI out across half its board while
 * shaking out CI scores less. The number rose when AI use FELL, and it was being
 * ranked against a cohort distribution built for the other definition.
 *
 * The measurement here is the one the cohort expects: of the tickets COMPLETED in
 * the window, how many had at least one live agent execution against them.
 *
 * ── WHY 'AT LEAST ONE' AND NOT A WEIGHTED SHARE ─────────────────────────────
 * Adoption asks whether the work goes through AI at all, not how much of it did.
 * A ticket an agent drafted and a human finished is adopted; weighting by run
 * count would rank a ticket that took ten flailing runs above one that took a
 * single good run, which measures difficulty, not adoption.
 *
 * Rehearsal runs (`mode <> 'live'`) do not count: a dry run is a test of the
 * system, not delivery going through it.
 */

import { and, eq, exists, gte, isNotNull, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { executions, projects, tasks } from '../../infrastructure/database/schema';
import { notSystemTask } from '../task/taskScope';

const DAY_MS = 86_400_000;

export interface AiAdoption {
  /** Tickets completed in the window (the denominator). */
  completed: number;
  /** Of those, how many had at least one live agent run. */
  withAiRun: number;
  /** 0..100, or null when nothing completed — never 0, which would read as "no AI". */
  adoptionPct: number | null;
}

export async function computeAiAdoption(
  db: Db,
  tenantId: number,
  days: number,
  projectId?: number,
): Promise<AiAdoption> {
  const since = new Date(Date.now() - days * DAY_MS);

  // ONE aggregate, not a per-ticket fan-out: a correlated EXISTS inside a
  // conditional count, so a tenant with thousands of completed tickets costs one
  // round trip. Both sides are indexed (executions by task, tasks by completedAt).
  const hasLiveRun = exists(
    db.select({ one: sql`1` })
      .from(executions)
      .where(and(
        eq(executions.taskId, tasks.id),
        eq(executions.tenantId, tenantId),
        sql`coalesce(${executions.mode}, 'live') = 'live'`,
      )),
  );

  const [row] = await db
    .select({
      completed: sql<string>`count(*)`,
      withAiRun: sql<string>`coalesce(sum(case when ${hasLiveRun} then 1 else 0 end), 0)`,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(
      eq(projects.tenantId, tenantId),
      ...(projectId != null ? [eq(tasks.projectId, projectId)] : []),
      eq(tasks.archived, false),
      isNotNull(tasks.completedAt),
      gte(tasks.completedAt, since),
      notSystemTask,
    ));

  const completed = Number(row?.completed ?? 0);
  const withAiRun = Number(row?.withAiRun ?? 0);
  return {
    completed,
    withAiRun,
    // Null, not 0, when nothing shipped: "we delivered nothing" and "we delivered
    // without AI" are different facts and the benchmark must not rank the first.
    adoptionPct: completed > 0 ? (withAiRun / completed) * 100 : null,
  };
}
