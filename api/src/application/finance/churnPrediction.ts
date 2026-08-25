/**
 * Predicted churn, and whether the prediction was right (PRD 19 §9).
 *
 * ── WHY THIS IS NOT PART OF SCENARIO MODELLING ──────────────────────────────
 * A scenario is a claim about a hypothetical. A churn prediction is a claim about
 * a REAL named account, and it is falsifiable: the account either churned or it
 * did not. That difference is the whole design here — `outcome` and `outcome_at`
 * exist so a prediction can be marked right or wrong later, and
 * {@link modelCalibration} is the read that makes the model accountable.
 *
 * Three BurnRateOS modules wrote churn scores — `predictiveAnalytics`,
 * `salesGrowth` and `analytics` — and none of them recorded whether a score was
 * ever borne out. A churn model nobody scores is a number that always sounds
 * plausible and never gets better.
 *
 * ── A PREDICTION IS APPEND-ONLY ─────────────────────────────────────────────
 * Re-scoring an account writes a NEW row. It has to: the useful question is "was
 * the score we acted on in March correct", and an in-place update destroys
 * exactly that. {@link currentRisk} therefore reads the newest row per account
 * rather than a flag, and {@link modelCalibration} reads all of them.
 *
 * ── BANDS ARE DERIVED HERE, ONCE ────────────────────────────────────────────
 * `band` is stored, but it is computed by {@link bandFor} rather than supplied by
 * the caller. Two callers with two thresholds is how the dashboard and the alert
 * come to disagree about which accounts are "high risk" while both reading the
 * same probabilities.
 *
 * ── THE CLAIM-TO-PROOF POSITION ─────────────────────────────────────────────
 * `model` names whatever produced the score and there is NO default. A row with
 * no model is a number with no provenance, and this module refuses to write one —
 * which is the same standard the scenario module applies to its assumptions.
 */

import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { churnPredictions } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { recordActivity, type ActorIdentity } from '../activity/activityLog';

/** `churn_predictions.band`. */
export const RISK_BANDS = ['low', 'medium', 'high', 'critical'] as const;
export type RiskBand = (typeof RISK_BANDS)[number];

/** `churn_predictions.outcome` — what actually happened. `null` means the horizon
 *  has not closed yet, which is different from "did not churn". */
export const OUTCOMES = ['churned', 'retained'] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const isOutcome = (v: unknown): v is Outcome =>
  typeof v === 'string' && (OUTCOMES as readonly string[]).includes(v);

export class ChurnError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 = 400) {
    super(message);
    this.name = 'ChurnError';
  }
}

/**
 * The ONE band mapping.
 *
 * Exported so a surface can label a probability it computed itself without
 * inventing a second set of thresholds — which is the failure this replaces.
 */
export function bandFor(probability: number): RiskBand {
  if (probability >= 0.75) return 'critical';
  if (probability >= 0.5) return 'high';
  if (probability >= 0.25) return 'medium';
  return 'low';
}

export type PredictionInput = {
  accountRef: string;
  probability: number;
  /** What produced the score. Required — a number with no provenance is not a
   *  prediction, it is an assertion. */
  model: string;
  drivers?: unknown;
  horizonDays?: number;
};

/** Record a score. Appends; never updates a previous prediction. */
export async function predict(
  db: Db,
  env: Env,
  tenantId: number,
  actor: ActorIdentity,
  input: PredictionInput,
) {
  const accountRef = input.accountRef.trim();
  if (!accountRef) throw new ChurnError('accountRef is required');
  const model = input.model.trim();
  if (!model) throw new ChurnError('model is required — a score with no provenance is not a prediction');
  if (!Number.isFinite(input.probability) || input.probability < 0 || input.probability > 1) {
    throw new ChurnError('probability must be between 0 and 1');
  }

  const [row] = await db
    .insert(churnPredictions)
    .values({
      tenantId,
      accountRef: accountRef.slice(0, 64),
      probability: input.probability.toFixed(4),
      band: bandFor(input.probability),
      drivers: input.drivers ?? null,
      model: model.slice(0, 96),
      horizonDays: input.horizonDays ?? 90,
      predictedAt: new Date(),
    })
    .returning();
  if (!row) throw new ChurnError('could not record the prediction');

  // Only the two bands somebody is expected to act on reach the activity log. A
  // nightly re-score of every account would otherwise bury every other event.
  if (row.band === 'high' || row.band === 'critical') {
    await recordActivity(env, db, {
      tenantId, actor, verb: 'churn.risk_flagged',
      targetType: 'account', targetId: accountRef,
      metadata: { probability: input.probability, band: row.band, model },
    });
  }
  return row;
}

/** The newest score per account, worst first — the retention queue. */
export async function currentRisk(db: Db, tenantId: number, band?: RiskBand) {
  const newest = db
    .select({
      accountRef: churnPredictions.accountRef,
      latest: sql<Date>`max(${churnPredictions.predictedAt})`.as('latest'),
    })
    .from(churnPredictions)
    .where(scopedToTenant(churnPredictions, tenantId))
    .groupBy(churnPredictions.accountRef)
    .as('newest');

  return db
    .select({
      accountRef: churnPredictions.accountRef,
      probability: churnPredictions.probability,
      band: churnPredictions.band,
      drivers: churnPredictions.drivers,
      model: churnPredictions.model,
      horizonDays: churnPredictions.horizonDays,
      predictedAt: churnPredictions.predictedAt,
      outcome: churnPredictions.outcome,
    })
    .from(churnPredictions)
    .innerJoin(newest, and(
      eq(churnPredictions.accountRef, newest.accountRef),
      eq(churnPredictions.predictedAt, newest.latest),
    ))
    .where(scopedToTenant(churnPredictions, tenantId, band ? eq(churnPredictions.band, band) : undefined))
    .orderBy(desc(churnPredictions.probability));
}

/** Every score ever given to one account — the shape of a relationship going
 *  wrong, which a single current number cannot show. */
export async function riskHistory(db: Db, tenantId: number, accountRef: string) {
  return db
    .select()
    .from(churnPredictions)
    .where(scopedToTenant(churnPredictions, tenantId, eq(churnPredictions.accountRef, accountRef.trim())))
    .orderBy(desc(churnPredictions.predictedAt));
}

/**
 * Close the loop: this account churned, or it did not.
 *
 * Stamps every OPEN prediction for the account, not just the newest, because each
 * one was a separate claim and calibration needs all of them scored. Predictions
 * already resolved are left alone — re-stamping them would let a later outcome
 * rewrite an earlier verdict.
 */
export async function recordOutcome(
  db: Db,
  env: Env,
  tenantId: number,
  actor: ActorIdentity,
  accountRef: string,
  outcome: Outcome,
) {
  if (!isOutcome(outcome)) throw new ChurnError(`outcome must be one of: ${OUTCOMES.join(', ')}`);
  const ref = accountRef.trim();

  const rows = await db
    .update(churnPredictions)
    .set({ outcome, outcomeAt: new Date() })
    .where(scopedToTenant(churnPredictions, tenantId, and(
      eq(churnPredictions.accountRef, ref),
      isNull(churnPredictions.outcome),
    )))
    .returning({ id: churnPredictions.id });

  if (rows.length === 0) throw new ChurnError('no open prediction for that account', 404);

  await recordActivity(env, db, {
    tenantId, actor, verb: 'churn.outcome_recorded',
    targetType: 'account', targetId: ref,
    metadata: { outcome, scored: rows.length },
  });
  return { accountRef: ref, outcome, scored: rows.length };
}

/**
 * Was the model right?
 *
 * Grouped by model AND band, because a model can be well calibrated at the low
 * end and useless at the top — which is the end anyone acts on. Only RESOLVED
 * predictions are counted: including open ones would score the model on outcomes
 * that have not happened yet and would drift towards "retained" simply because
 * churn takes time to show up.
 *
 * `actualChurnRate` beside `avgProbability` is the whole read. A model claiming
 * 80% on a band that churns 20% of the time is confidently wrong, and no single
 * accuracy number reveals that.
 */
export async function modelCalibration(db: Db, tenantId: number) {
  return db
    .select({
      model: churnPredictions.model,
      band: churnPredictions.band,
      resolved: sql<number>`count(*)::int`,
      churned: sql<number>`count(*) filter (where ${churnPredictions.outcome} = 'churned')::int`,
      avgProbability: sql<number>`avg(${churnPredictions.probability})::float8`,
      actualChurnRate: sql<number>`(count(*) filter (where ${churnPredictions.outcome} = 'churned')::float8 / nullif(count(*), 0))`,
    })
    .from(churnPredictions)
    // Resolved only — see the docstring. An open prediction is not evidence.
    .where(scopedToTenant(churnPredictions, tenantId, sql`${churnPredictions.outcome} is not null`))
    .groupBy(churnPredictions.model, churnPredictions.band)
    .orderBy(churnPredictions.model, churnPredictions.band);
}
