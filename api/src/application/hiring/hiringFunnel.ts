/**
 * The hiring funnel — stage conversion, time-in-stage and source-of-hire.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────
 * A recruiter is measured on four numbers: time-to-hire, stage conversion, source
 * effectiveness and offer-accept rate. The hiring domain has held the rows to compute
 * all four since migration 0419 — `job_pipeline_entries` records every stage transition
 * with `enteredAt`, `exitedAt` and `daysInStage`; `hiring_decisions` and `offer_letters`
 * record the end of it — and nothing computed them, so the seat that claims to run
 * hiring could not answer "where are we losing candidates".
 *
 * ── ONE COMPUTATION, TWO CONSUMERS ───────────────────────────────────────────────
 * The canvas `funnel` object and the Recruiter seat read the SAME function. That is
 * deliberate and it is the reason `funnelDomain` is a value on the canvas kind rather
 * than a `hiringFunnel` kind: the marketing review asked for stage conversion on the
 * same day from the other end of the company, and a second implementation of "count
 * entries, count exits, divide" is how two surfaces come to disagree about one number.
 *
 * ── ONE QUERY, NOT ONE PER STAGE ─────────────────────────────────────────────────
 * Everything below is computed from a SINGLE grouped read of `job_pipeline_entries`.
 * The naive shape — list the stages, then count each one — is an N+1 that grows with
 * the funnel, and a funnel is the thing most likely to gain a stage. Stage ORDER comes
 * from the data too (first-entered wins), because a pipeline's stages are free-form by
 * design: every tenant renames them.
 */

import { sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { jobPipelineEntries } from '../../infrastructure/database/schema/hiring';
import { eq } from 'drizzle-orm';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import type { Env } from '../../env';

/** One stage of a funnel, with the numbers that localise a loss to it. */
export interface FunnelStage {
  stage: string;
  entered: number;
  exited: number;
  /** Percentage of THIS stage that reached the NEXT one. A cumulative percentage
   *  cannot localise a loss, which is the only thing this report is for. */
  conversion: number;
  medianDays: number | null;
}

/** Conversion split by where the candidate came from — the source-effectiveness half. */
export interface FunnelSource {
  source: string;
  entered: number;
  converted: number;
  rate: number;
}

export interface HiringFunnel {
  pipelineRef: string | null;
  stages: FunnelStage[];
  sourceBreakdown: FunnelSource[];
  totalEntered: number;
  totalConverted: number;
  overallConversion: number;
  medianCycleDays: number | null;
  /** The single stage losing the most, or null when nothing has moved yet. One stage:
   *  a list of three is a report, and this field is a decision. */
  bottleneck: string | null;
  dateRange: string;
  fetchedAt: string;
}

/** Rows as the grouped query returns them, before any funnel meaning is applied. */
interface StageRow {
  stage: string;
  source: string | null;
  entered: number;
  exited: number;
  firstEnteredAt: Date | string | null;
  medianDays: number | null;
}

const DEFAULT_WINDOW_DAYS = 90;

/**
 * `null` rather than 0 for an empty list.
 *
 * The same argument the canvas meter makes: a median of zero reads as "these all
 * happened instantly", and an absent median reads as "nothing has completed yet". Those
 * are opposite facts and only one of them is true of an empty funnel.
 */
function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  // `noUncheckedIndexedAccess` is on: `mid` is in range by construction, and saying so
  // with `??` keeps that true if the guard above ever changes.
  const upper = sorted[mid] ?? 0;
  return sorted.length % 2 ? upper : Math.round(((sorted[mid - 1] ?? upper) + upper) / 2);
}

function percent(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

/**
 * Stage order, inferred from when each stage was FIRST entered.
 *
 * A pipeline's stages are free-form (`job_pipeline_entries.stage` is a varchar, because
 * every tenant renames them), so there is no lookup to order by. First-entry order is
 * the honest inference: a stage nobody has reached yet has no position in a funnel that
 * has never run through it, and inventing one would draw a conversion cliff at a stage
 * that simply has not happened.
 */
function orderStages(rows: StageRow[]): string[] {
  const firstSeen = new Map<string, number>();
  for (const row of rows) {
    const at = row.firstEnteredAt ? new Date(row.firstEnteredAt).getTime() : Number.MAX_SAFE_INTEGER;
    const current = firstSeen.get(row.stage);
    if (current === undefined || at < current) firstSeen.set(row.stage, at);
  }
  return [...firstSeen.entries()].sort((a, b) => a[1] - b[1]).map(([stage]) => stage);
}

/**
 * Compute the funnel from one grouped read.
 *
 * Uncached: `hiringFunnel()` below is the cached entry point every caller should use.
 * This is separated so the cache is a decorator rather than something the computation
 * has to know about — and so a test can assert the arithmetic without a KV binding.
 */
export async function computeHiringFunnel(
  db: Db,
  tenantId: number,
  opts: { pipelineRef?: string | null; days?: number } = {},
): Promise<HiringFunnel> {
  const days = Math.max(1, Math.min(365, Math.floor(opts.days ?? DEFAULT_WINDOW_DAYS)));
  const pipelineRef = opts.pipelineRef ?? null;
  const since = new Date(Date.now() - days * 86_400_000);

  // ONE grouped read. Grouping by (stage, source) rather than issuing a query per stage
  // is what keeps this O(1) round trips as the funnel gains stages — and the stage list
  // is not known in advance anyway, so the per-stage shape would need a discovery query
  // before it could even start.
  const rows = await db
    .select({
      stage: jobPipelineEntries.stage,
      source: jobPipelineEntries.source,
      entered: sql<number>`count(*)::int`,
      exited: sql<number>`count(${jobPipelineEntries.exitedAt})::int`,
      firstEnteredAt: sql<Date>`min(${jobPipelineEntries.enteredAt})`,
      // `days_in_stage` is written when the entry exits, so the median is over completed
      // passes only — a median that included still-open entries would report a stage as
      // fast precisely while candidates were stuck in it.
      medianDays: sql<number | null>`percentile_cont(0.5) within group (order by ${jobPipelineEntries.daysInStage})`,
    })
    .from(jobPipelineEntries)
    // `scopedToTenant` INLINE in the `.where(…)` rather than hoisted into a const: the
    // predicate is identical either way, but the tenant-scope guard reads the call site
    // statically, and a hoisted predicate is invisible to it. A scoping rule that a
    // reviewer can see and a checker cannot is a rule that lapses.
    .where(scopedToTenant(
      jobPipelineEntries,
      tenantId,
      pipelineRef ? eq(jobPipelineEntries.pipelineRef, pipelineRef) : undefined,
      sql`${jobPipelineEntries.enteredAt} >= ${since}`,
    ))
    .groupBy(jobPipelineEntries.stage, jobPipelineEntries.source);

  const typed = rows as unknown as StageRow[];
  const order = orderStages(typed);

  const byStage = new Map<string, { entered: number; exited: number; medians: number[]; firstEnteredAt: number }>();
  for (const row of typed) {
    const current = byStage.get(row.stage) ?? { entered: 0, exited: 0, medians: [], firstEnteredAt: Number.MAX_SAFE_INTEGER };
    current.entered += row.entered;
    current.exited += row.exited;
    if (row.medianDays != null) current.medians.push(Number(row.medianDays));
    byStage.set(row.stage, current);
  }

  const stages: FunnelStage[] = order.flatMap((stage, index) => {
    const current = byStage.get(stage);
    if (!current) return [];
    const nextStage = order[index + 1];
    const next = nextStage ? byStage.get(nextStage) : undefined;
    return [{
      stage,
      entered: current.entered,
      exited: current.exited,
      // Conversion is "how many of this stage reached the NEXT one". The terminal stage
      // has nothing after it, so its conversion is what actually completed — not 0,
      // which would draw the offer stage as the worst-performing one in every funnel.
      conversion: next ? percent(next.entered, current.entered) : percent(current.exited, current.entered),
      medianDays: median(current.medians),
    }];
  });

  const bySource = new Map<string, { entered: number; converted: number }>();
  const terminal = order[order.length - 1];
  for (const row of typed) {
    // An entry with no stamped source is not dropped into an "unknown" bucket that then
    // wins the report: it is named, because a large unattributed share IS the finding.
    const key = row.source || 'unattributed';
    const current = bySource.get(key) ?? { entered: 0, converted: 0 };
    if (row.stage === order[0]) current.entered += row.entered;
    if (row.stage === terminal) current.converted += row.entered;
    bySource.set(key, current);
  }

  const totalEntered = stages[0]?.entered ?? 0;
  const totalConverted = terminal ? (byStage.get(terminal)?.entered ?? 0) : 0;

  // The bottleneck is the stage that LOSES the most people, not the one with the worst
  // percentage: a stage that drops 4 of 5 matters less than one that drops 60 of 200,
  // and a recruiter's next hour goes where the people are.
  const losses = stages.slice(0, -1).map((stage, index) => ({
    stage: stage.stage,
    lost: Math.max(0, stage.entered - (stages[index + 1]?.entered ?? 0)),
  }));
  const worst = losses.sort((a, b) => b.lost - a.lost)[0] ?? null;

  return {
    pipelineRef,
    stages,
    sourceBreakdown: [...bySource.entries()]
      .map(([source, value]) => ({ source, entered: value.entered, converted: value.converted, rate: percent(value.converted, value.entered) }))
      .sort((a, b) => b.entered - a.entered),
    totalEntered,
    totalConverted,
    overallConversion: percent(totalConverted, totalEntered),
    medianCycleDays: median(stages.flatMap((stage) => (stage.medianDays == null ? [] : [stage.medianDays]))),
    bottleneck: worst && worst.lost > 0 ? worst.stage : null,
    dateRange: `last ${days} days`,
    fetchedAt: new Date().toISOString(),
  };
}

/** Cache key for one tenant's funnel. Scoped by pipeline and window because both change
 *  the answer, and a key that ignored them would serve the wrong funnel. */
function funnelKey(tenantId: number, pipelineRef: string | null, days: number): string {
  return `hiring:funnel:${tenantId}:${pipelineRef ?? 'all'}:${days}`;
}

/**
 * The funnel, read through the canonical cache.
 *
 * A funnel is the definition of slow-changing expensive data: a grouped aggregate over
 * every stage transition a tenant has, asked repeatedly by a dashboard that refreshes.
 * Five minutes in KV, and `invalidateHiringFunnel` on every pipeline write, so the number
 * is never older than the last stage change that produced it.
 */
export async function hiringFunnel(
  env: Env,
  db: Db,
  tenantId: number,
  opts: { pipelineRef?: string | null; days?: number } = {},
): Promise<HiringFunnel> {
  const days = Math.max(1, Math.min(365, Math.floor(opts.days ?? DEFAULT_WINDOW_DAYS)));
  const pipelineRef = opts.pipelineRef ?? null;
  return getOrSetCached(
    env,
    funnelKey(tenantId, pipelineRef, days),
    () => computeHiringFunnel(db, tenantId, { pipelineRef, days }),
    { kvTtlSeconds: 300, l1TtlMs: 30_000 },
  );
}

/**
 * Drop a tenant's cached funnels after a pipeline write.
 *
 * The window is part of the key and callers may ask for any of 365, so the common
 * windows are invalidated explicitly rather than the keyspace being scanned — KV has no
 * prefix delete, and a version token would make every read pay for a second lookup on a
 * report that tolerates being at most one write stale. These four are the windows the
 * canvas and the seat actually offer.
 */
export async function invalidateHiringFunnel(env: Env, tenantId: number, pipelineRef?: string | null): Promise<void> {
  const refs = pipelineRef ? [pipelineRef, null] : [null];
  await Promise.all(refs.flatMap((ref) =>
    [7, 30, 90, 365].map((days) => invalidateCached(env, funnelKey(tenantId, ref, days))),
  ));
}
