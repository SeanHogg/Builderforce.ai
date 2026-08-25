/**
 * What a sprint cost, and what it was estimated to take (PRD 19 §9).
 *
 * ── THE HALF THAT WAS GENUINELY NET-NEW ─────────────────────────────────────
 * PRD 19 §4 calls B6 "mostly merge — the FINANCIAL half (cost per sprint, runway
 * link) is net-new", and this is that half. Builderforce already owns sprints,
 * velocity, capacity and work items; what it had no reader for is the pair of
 * tables that turn a sprint from a unit of WORK into a unit of SPEND.
 *
 * ── ESTIMATES ARE A HISTORY, NOT A FIELD ────────────────────────────────────
 * `task_effort_estimates` is deliberately not a column on the work item, and
 * {@link recordEstimate} is why: it appends and demotes rather than overwriting.
 * The interesting question about an estimate is almost never "what is it" — it is
 * "what did we think before, who thought it, and how wrong were we". A column
 * answers the first and destroys the other three.
 *
 * `is_current` is maintained by this module and by nothing else. Two rows both
 * claiming to be current is not a state the schema forbids, so it has to be a
 * state the WRITER forbids: the demote and the insert happen in one transaction.
 *
 * ── ESTIMATOR KIND IS THE POINT ─────────────────────────────────────────────
 * `estimator_kind` separates a human estimate from an agent's. Keeping them in one
 * table with a discriminator, rather than in two tables, is what makes
 * {@link estimateAccuracy} able to ask the only question worth asking about
 * agent estimation — is it better or worse than ours — without a union.
 *
 * ── SPRINT COST IS COMPUTED AND STAMPED, NOT DERIVED ON READ ────────────────
 * `sprint_financial_impact` carries `computed_at` because labour rates, tooling
 * allocations and AI spend all change. A sprint that cost $40k under last
 * quarter's rates did cost that; recomputing it on every read would silently
 * rewrite history every time somebody edited a salary. So the rollup is written
 * once per computation and {@link sprintEconomics} reads what was stamped.
 */

import { and, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { sprintFinancialImpact, taskEffortEstimates } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { recordActivity, type ActorIdentity } from '../activity/activityLog';

/** `task_effort_estimates.unit`. */
export const ESTIMATE_UNITS = ['points', 'hours', 'days', 'tshirt'] as const;
export type EstimateUnit = (typeof ESTIMATE_UNITS)[number];

export const isEstimateUnit = (v: unknown): v is EstimateUnit =>
  typeof v === 'string' && (ESTIMATE_UNITS as readonly string[]).includes(v);

export class AgileCostError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 = 400) {
    super(message);
    this.name = 'AgileCostError';
  }
}

export type EstimateInput = {
  workItemRef: string;
  unit?: EstimateUnit;
  value?: number | null;
  tshirt?: string | null;
  estimatorKind?: 'user' | 'agent';
  estimatorRef?: string | null;
  confidence?: number | null;
};

const requireRef = (v: string): string => {
  const s = v.trim();
  if (!s || s.length > 64) throw new AgileCostError('workItemRef is required and must be 64 characters or fewer');
  return s;
};

/** Money and effort arrive as numbers and are stored as `numeric`. Drizzle wants
 *  the string form; doing that conversion once, here, keeps every call site from
 *  inventing its own rounding. */
const money = (n: number | null | undefined): string => (n === null || n === undefined ? '0' : n.toFixed(2));

// ── Estimates ───────────────────────────────────────────────────────────────

/**
 * Record an estimate. The previous current one is demoted in the same
 * transaction, so "current" is never ambiguous even under two concurrent
 * estimators.
 *
 * A `tshirt` estimate carries no numeric `value` and that is legitimate — it is
 * the point of t-shirt sizing. {@link estimateAccuracy} therefore reports on the
 * numeric ones only, rather than coercing S/M/L to invented numbers, which is how
 * an accuracy metric ends up measuring the coercion table instead of the team.
 */
export async function recordEstimate(
  db: Db,
  tenantId: number,
  input: EstimateInput,
) {
  const workItemRef = requireRef(input.workItemRef);
  const unit = input.unit ?? 'points';
  if (!isEstimateUnit(unit)) throw new AgileCostError(`unit must be one of: ${ESTIMATE_UNITS.join(', ')}`);
  if (unit === 'tshirt' && !input.tshirt) throw new AgileCostError('a tshirt estimate needs a tshirt size');
  if (unit !== 'tshirt' && (input.value === null || input.value === undefined)) {
    throw new AgileCostError(`a ${unit} estimate needs a numeric value`);
  }

  return db.transaction(async (tx) => {
    await tx
      .update(taskEffortEstimates)
      .set({ isCurrent: false })
      .where(scopedToTenant(taskEffortEstimates, tenantId, and(
        eq(taskEffortEstimates.workItemRef, workItemRef),
        eq(taskEffortEstimates.isCurrent, true),
      )));

    const [row] = await tx
      .insert(taskEffortEstimates)
      .values({
        tenantId,
        workItemRef,
        unit,
        value: input.value === null || input.value === undefined ? null : String(input.value),
        tshirt: input.tshirt ?? null,
        estimatorKind: input.estimatorKind ?? 'user',
        estimatorRef: input.estimatorRef ?? null,
        confidence: input.confidence === null || input.confidence === undefined ? null : String(input.confidence),
        isCurrent: true,
      })
      .returning();
    if (!row) throw new AgileCostError('could not record the estimate');
    return row;
  });
}

/** The estimate that stands for this work item, or null if nobody has estimated. */
export async function currentEstimate(db: Db, tenantId: number, workItemRef: string) {
  const [row] = await db
    .select()
    .from(taskEffortEstimates)
    .where(scopedToTenant(taskEffortEstimates, tenantId, and(
      eq(taskEffortEstimates.workItemRef, requireRef(workItemRef)),
      eq(taskEffortEstimates.isCurrent, true),
    )))
    .limit(1);
  return row ?? null;
}

/** Every estimate ever made for this work item, newest first — what we thought,
 *  when, and who thought it. */
export async function estimateHistory(db: Db, tenantId: number, workItemRef: string) {
  return db
    .select()
    .from(taskEffortEstimates)
    .where(scopedToTenant(taskEffortEstimates, tenantId, eq(taskEffortEstimates.workItemRef, requireRef(workItemRef))))
    .orderBy(desc(taskEffortEstimates.estimatedAt));
}

/**
 * How much estimates move, split by who made them.
 *
 * Reported as the SPREAD between a work item's first and current estimate rather
 * than as error against actuals, because actuals live in time tracking and a
 * cross-domain join here would make this module depend on it. Spread is the honest
 * thing this table alone can say: an item re-estimated from 3 to 13 was
 * misunderstood, whoever eventually turned out to be right.
 */
export async function estimateAccuracy(db: Db, tenantId: number) {
  return db
    .select({
      estimatorKind: taskEffortEstimates.estimatorKind,
      unit: taskEffortEstimates.unit,
      items: sql<number>`count(distinct ${taskEffortEstimates.workItemRef})::int`,
      estimates: sql<number>`count(*)::int`,
      reEstimated: sql<number>`count(distinct ${taskEffortEstimates.workItemRef}) filter (
        where ${taskEffortEstimates.isCurrent} = false
      )::int`,
      avgConfidence: sql<number | null>`avg(${taskEffortEstimates.confidence})`,
    })
    .from(taskEffortEstimates)
    // t-shirt rows carry no numeric value; including them would make the averages
    // describe a coercion table rather than the team.
    .where(scopedToTenant(taskEffortEstimates, tenantId, sql`${taskEffortEstimates.unit} <> 'tshirt'`))
    .groupBy(taskEffortEstimates.estimatorKind, taskEffortEstimates.unit);
}

// ── Sprint economics ────────────────────────────────────────────────────────

export type SprintCostInput = {
  sprintRef: string;
  projectRef?: string | null;
  laborCost?: number;
  toolingCost?: number;
  aiCost?: number;
  deliveredValue?: number | null;
  currency?: string;
};

/**
 * Stamp what a sprint cost.
 *
 * Idempotent per sprint: recomputing overwrites the stamp and moves `computed_at`
 * forward, because a recomputation is a better answer to the same question rather
 * than a second question. What it does NOT do is recompute on read — see the
 * module docstring; rates change, and a sprint's cost is a fact about the period,
 * not a view of today's salaries.
 */
export async function stampSprintCost(
  db: Db,
  env: Env,
  tenantId: number,
  actor: ActorIdentity,
  input: SprintCostInput,
) {
  const sprintRef = requireRef(input.sprintRef);

  const existing = await db
    .select({ id: sprintFinancialImpact.id })
    .from(sprintFinancialImpact)
    .where(scopedToTenant(sprintFinancialImpact, tenantId, eq(sprintFinancialImpact.sprintRef, sprintRef)))
    .limit(1);

  const values = {
    tenantId,
    sprintRef,
    projectRef: input.projectRef ?? null,
    laborCost: money(input.laborCost),
    toolingCost: money(input.toolingCost),
    aiCost: money(input.aiCost),
    deliveredValue: input.deliveredValue === null || input.deliveredValue === undefined ? null : money(input.deliveredValue),
    currency: input.currency ?? 'USD',
    computedAt: new Date(),
  };

  const first = existing[0];
  const [row] = first
    ? await db
      .update(sprintFinancialImpact)
      .set(values)
      .where(scopedToTenant(sprintFinancialImpact, tenantId, eq(sprintFinancialImpact.id, first.id)))
      .returning()
    : await db.insert(sprintFinancialImpact).values(values).returning();
  if (!row) throw new AgileCostError('could not stamp the sprint cost');

  await recordActivity(env, db, {
    tenantId,
    actor,
    verb: 'sprint.cost_stamped',
    targetType: 'sprint',
    targetId: sprintRef,
    metadata: { laborCost: values.laborCost, toolingCost: values.toolingCost, aiCost: values.aiCost, currency: values.currency },
  });
  return row;
}

/**
 * The economics of one sprint, with the ratio the CFO actually asks for.
 *
 * `valueRatio` is null rather than 0 when `delivered_value` is unset, and the
 * distinction matters: "we did not price the output" and "the output was worth
 * nothing" are different answers, and a 0 here would put a sprint that nobody
 * valued at the bottom of every ranking.
 */
export async function sprintEconomics(db: Db, tenantId: number, sprintRef: string) {
  const [row] = await db
    .select()
    .from(sprintFinancialImpact)
    .where(scopedToTenant(sprintFinancialImpact, tenantId, eq(sprintFinancialImpact.sprintRef, requireRef(sprintRef))))
    .limit(1);
  if (!row) return null;

  const total = Number(row.laborCost) + Number(row.toolingCost) + Number(row.aiCost);
  const delivered = row.deliveredValue === null ? null : Number(row.deliveredValue);
  return {
    ...row,
    totalCost: total,
    valueRatio: delivered === null || total === 0 ? null : delivered / total,
  };
}

/** Sprint spend across the workspace, newest first — the trend line, and the one
 *  read that makes `ai_cost` worth having as its own column rather than folded
 *  into tooling. */
export async function costTrend(db: Db, tenantId: number, projectRef?: string) {
  const where = projectRef ? eq(sprintFinancialImpact.projectRef, projectRef) : undefined;
  return db
    .select({
      sprintRef: sprintFinancialImpact.sprintRef,
      projectRef: sprintFinancialImpact.projectRef,
      laborCost: sprintFinancialImpact.laborCost,
      toolingCost: sprintFinancialImpact.toolingCost,
      aiCost: sprintFinancialImpact.aiCost,
      deliveredValue: sprintFinancialImpact.deliveredValue,
      currency: sprintFinancialImpact.currency,
      computedAt: sprintFinancialImpact.computedAt,
      totalCost: sql<number>`(${sprintFinancialImpact.laborCost} + ${sprintFinancialImpact.toolingCost} + ${sprintFinancialImpact.aiCost})::float8`,
    })
    .from(sprintFinancialImpact)
    .where(scopedToTenant(sprintFinancialImpact, tenantId, where))
    .orderBy(desc(sprintFinancialImpact.computedAt));
}
