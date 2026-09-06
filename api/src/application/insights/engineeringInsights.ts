/**
 * LENS #1 — AI effectiveness over `run_model_outcomes` (gate insights.engineering).
 *
 * The industry's only "did this AI approach actually ship" signal, currently
 * raw-only. We surface the per-run outcome score (merged·CI·completion·
 * efficiency) sliced by action_type × model, so a Tech Lead / CTO can see WHICH
 * approach actually merges — not just that runs happened.
 *
 * The aggregation ({@link summarizeOutcomes}) is a pure function over already-
 * fetched rows so it is unit-testable without a DB; the route caches it.
 */

import { and, eq, gte } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { runModelOutcomes } from '../../infrastructure/database/schema';
import { HOUR_MS } from '../../domain/shared/time';

export interface OutcomeRow {
  actionType: string;
  resolvedModel: string;
  score: number;
  merged: boolean;
  ciGreen: boolean;
  degraded: boolean;
  steps: number;
  costUsdMillicents: number;
}

export interface EffectivenessBucket {
  key: string;          // model, actionType, or "actionType · model"
  actionType?: string;
  model?: string;
  runs: number;
  avgScore: number;     // 0..1
  mergedRatePct: number;
  ciGreenRatePct: number;
  degradedRatePct: number;
  avgSteps: number;
  costUsd: number;
}

export interface EngineeringInsights {
  windowDays: number;
  totals: {
    runs: number;
    avgScore: number;
    mergedRatePct: number;
    ciGreenRatePct: number;
    degradedRatePct: number;
    costUsd: number;
  };
  byModel: EffectivenessBucket[];
  byActionType: EffectivenessBucket[];
  byApproach: EffectivenessBucket[]; // actionType × model — the headline ranking
}

const MILLICENTS_PER_USD = 100_000;

function bucket(key: string, rows: OutcomeRow[], extra: Partial<EffectivenessBucket> = {}): EffectivenessBucket {
  const runs = rows.length;
  const pct = (n: number) => (runs ? (n / runs) * 100 : 0);
  return {
    key,
    runs,
    avgScore: runs ? rows.reduce((a, r) => a + r.score, 0) / runs : 0,
    mergedRatePct: pct(rows.filter((r) => r.merged).length),
    ciGreenRatePct: pct(rows.filter((r) => r.ciGreen).length),
    degradedRatePct: pct(rows.filter((r) => r.degraded).length),
    avgSteps: runs ? rows.reduce((a, r) => a + r.steps, 0) / runs : 0,
    costUsd: rows.reduce((a, r) => a + r.costUsdMillicents, 0) / MILLICENTS_PER_USD,
    ...extra,
  };
}

function groupBy<T>(rows: T[], keyOf: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = keyOf(r);
    const list = m.get(k) ?? [];
    list.push(r);
    m.set(k, list);
  }
  return m;
}

/** Pure: turn outcome rows into the effectiveness rollup. Buckets are sorted by
 *  run count (most-evidenced first) so the UI ranks the approaches that matter. */
export function summarizeOutcomes(rows: OutcomeRow[], windowDays: number): EngineeringInsights {
  const byModel = [...groupBy(rows, (r) => r.resolvedModel).entries()]
    .map(([model, rs]) => bucket(model, rs, { model }))
    .sort((a, b) => b.runs - a.runs);
  const byActionType = [...groupBy(rows, (r) => r.actionType).entries()]
    .map(([at, rs]) => bucket(at, rs, { actionType: at }))
    .sort((a, b) => b.runs - a.runs);
  const byApproach = [...groupBy(rows, (r) => `${r.actionType}\u0000${r.resolvedModel}`).entries()]
    .map(([k, rs]) => {
      const [actionType, model] = k.split('\u0000');
      return bucket(`${actionType} · ${model}`, rs, { actionType, model });
    })
    .sort((a, b) => b.runs - a.runs);

  return {
    windowDays,
    totals: {
      runs: rows.length,
      avgScore: rows.length ? rows.reduce((a, r) => a + r.score, 0) / rows.length : 0,
      mergedRatePct: rows.length ? (rows.filter((r) => r.merged).length / rows.length) * 100 : 0,
      ciGreenRatePct: rows.length ? (rows.filter((r) => r.ciGreen).length / rows.length) * 100 : 0,
      degradedRatePct: rows.length ? (rows.filter((r) => r.degraded).length / rows.length) * 100 : 0,
      costUsd: rows.reduce((a, r) => a + r.costUsdMillicents, 0) / MILLICENTS_PER_USD,
    },
    byModel,
    byActionType,
    byApproach,
  };
}

export async function computeEngineeringInsights(db: Db, tenantId: number, days: number, projectId?: number): Promise<EngineeringInsights> {
  const since = new Date(Date.now() - days * 24 * HOUR_MS);
  const rows = (await db
    .select({
      actionType: runModelOutcomes.actionType,
      resolvedModel: runModelOutcomes.resolvedModel,
      score: runModelOutcomes.score,
      merged: runModelOutcomes.merged,
      ciGreen: runModelOutcomes.ciGreen,
      degraded: runModelOutcomes.degraded,
      steps: runModelOutcomes.steps,
      costUsdMillicents: runModelOutcomes.costUsdMillicents,
    })
    .from(runModelOutcomes)
    .where(and(
      eq(runModelOutcomes.tenantId, tenantId),
      ...(projectId != null ? [eq(runModelOutcomes.projectId, projectId)] : []),
      gte(runModelOutcomes.createdAt, since),
    ))) as OutcomeRow[];
  return summarizeOutcomes(rows, days);
}
