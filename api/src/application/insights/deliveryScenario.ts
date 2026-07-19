/**
 * Scenario planner (the Jellyfish "Scenario Planner" gap) — model how a
 * deliverable's completion date moves when you change the team, their focus, or
 * the scope, and grade each scenario against the target date with its trade-off.
 *
 * The model is deliberately transparent (linear), reading its baseline straight
 * from the delivery rollup so there is no second source of truth:
 *
 *   per-developer pace   = baseline throughputPerWeek / max(1, activeContributors)
 *   projected throughput = perDeveloperPace × developers × (attention% / 100)
 *   adjusted remaining   = max(0, openTasks + scopeDelta)
 *   projected weeks      = adjusted remaining / projected throughput
 *   projected date       = now + projected weeks
 *   effort (person-wk)   = developers × projected weeks × (attention% / 100)
 *
 * When the baseline has no throughput signal we cannot project off zero, so the
 * scenario reports `no_signal` rather than inventing a pace. The math is a pure
 * function ({@link buildScenario}) so it is unit-tested without a DB and reused
 * by the route untouched.
 */

import { forecastVsTarget, type DeliveryStatus } from './deliveryInsights';
import { clampScore } from '../../domain/shared/numbers';

const DAY_MS = 86_400_000;

/** Baseline read from the delivery rollup for the chosen deliverable. */
export interface ScenarioBaseline {
  openTasks: number;
  throughputPerWeek: number;
  /** Distinct owners delivering it now (the "developers" baseline; floored at 1). */
  activeContributors: number;
  targetDate: string | null;
  now: number;
}

/** The levers the planner exposes. */
export interface ScenarioParams {
  developers: number;    // how many people work it
  attentionPct: number;  // 0..100 — share of their time on this deliverable
  scopeDelta: number;    // +/- remaining tasks (scope cut or growth)
}

export interface ScenarioResult {
  developers: number;
  attentionPct: number;
  scopeDelta: number;
  adjustedOpenTasks: number;
  /** Effective per-developer pace at the baseline (tasks/week), for transparency. */
  perDeveloperPerWeek: number;
  projectedThroughputPerWeek: number;
  projectedWeeks: number | null;
  projectedDate: string | null;
  targetDate: string | null;
  status: DeliveryStatus;
  /** Calendar days the projection lands after (+) or before (−) the target. */
  deltaDaysVsTarget: number | null;
  /** Total effort to finish under this scenario, person-weeks. */
  effortPersonWeeks: number | null;
}


/** Pure: baseline + levers → a graded projection. */
export function buildScenario(base: ScenarioBaseline, params: ScenarioParams): ScenarioResult {
  const developers = Math.max(0, Math.floor(params.developers));
  const attentionPct = clampScore(params.attentionPct);
  const scopeDelta = Math.floor(params.scopeDelta);

  const baselineDevs = Math.max(1, base.activeContributors);
  const perDeveloperPerWeek = base.throughputPerWeek / baselineDevs;
  const projectedThroughputPerWeek = perDeveloperPerWeek * developers * (attentionPct / 100);
  const adjustedOpenTasks = Math.max(0, base.openTasks + scopeDelta);

  let projectedWeeks: number | null = null;
  let projectedDate: string | null = null;
  let effortPersonWeeks: number | null = null;
  let status: DeliveryStatus;

  if (adjustedOpenTasks === 0) {
    status = 'done';
    projectedWeeks = 0;
    projectedDate = new Date(base.now).toISOString().slice(0, 10);
    effortPersonWeeks = 0;
  } else if (projectedThroughputPerWeek <= 0) {
    // No pace (zero baseline throughput, zero developers, or zero attention).
    status = 'no_signal';
  } else {
    projectedWeeks = adjustedOpenTasks / projectedThroughputPerWeek;
    const dateMs = base.now + projectedWeeks * 7 * DAY_MS;
    projectedDate = new Date(dateMs).toISOString().slice(0, 10);
    effortPersonWeeks = developers * projectedWeeks * (attentionPct / 100);
    status = base.targetDate ? forecastVsTarget(dateMs, new Date(base.targetDate).getTime()) : 'no_signal';
  }

  let deltaDaysVsTarget: number | null = null;
  if (projectedDate && base.targetDate) {
    deltaDaysVsTarget = Math.round((new Date(projectedDate).getTime() - new Date(base.targetDate).getTime()) / DAY_MS);
  }

  return {
    developers,
    attentionPct,
    scopeDelta,
    adjustedOpenTasks,
    perDeveloperPerWeek,
    projectedThroughputPerWeek,
    projectedWeeks,
    projectedDate,
    targetDate: base.targetDate,
    status,
    deltaDaysVsTarget,
    effortPersonWeeks,
  };
}
