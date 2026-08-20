/**
 * The PLAN VERDICT — "does this plan actually fit, and is it even a DAG?"
 *
 * {@link scheduleItems} has always answered that (`compressed`, `overruns`,
 * `cyclic`), but only the AI Manager's SCHEDULE pass ever wrote any of it down,
 * and even that only recorded the cycle count. The Epic fan-out path
 * ({@link TaskService.decomposeEpic}) computed the same verdict and THREW IT AWAY:
 * an Epic whose children had to be squeezed to fit its due date, or whose children
 * sit in a dependency cycle, looked exactly like one that planned cleanly. The PM
 * who needed to know found out when the date slipped.
 *
 * This module is the one shared shape both writers produce and every reader
 * consumes, so the board, the spine and the manager journal cannot drift into
 * three different opinions about whether a plan fits.
 */

import type { ScheduleResult } from './scheduleWork';

/** What the planner concluded about ONE parent's plan. Keys are caller-space
 *  (fan-out indices before ids exist, task ids afterwards). */
export interface PlanVerdict {
  /** Estimates had to be scaled DOWN to fit the parent's window. */
  compressed: boolean;
  /** Items that still end after the parent's due date. */
  overruns: string[];
  /** Items in a precedence cycle — scheduled from the anchor, so their order is a guess. */
  cyclic: string[];
  /** Items whose start was pushed out because their owner was already busy. */
  capacityDeferred: string[];
}

/** An empty (clean) verdict — the shape a caller starts from. */
export function emptyPlanVerdict(): PlanVerdict {
  return { compressed: false, overruns: [], cyclic: [], capacityDeferred: [] };
}

/**
 * Lift a {@link ScheduleResult} into a verdict, optionally re-keying planner keys
 * into the ids the rest of the system uses. The re-key matters for the Epic
 * fan-out: it schedules by PLAN INDEX because task rows do not exist yet, and a
 * verdict naming "2" instead of task 4711 is useless to every reader downstream.
 */
export function summarizePlanVerdict(
  result: ScheduleResult,
  resolveKey: (key: string) => string | null = (k) => k,
): PlanVerdict {
  const map = (keys: readonly string[]): string[] =>
    keys.map(resolveKey).filter((k): k is string => k != null);
  return {
    compressed: result.compressed,
    overruns: map(result.overruns),
    cyclic: map(result.cyclic),
    capacityDeferred: map(result.capacityDeferred),
  };
}

/**
 * TRUE when the plan fits its parent window — nothing compressed, nothing ending
 * late. Capacity deferral alone is NOT a misfit: the plan still lands inside the
 * window, one person is simply the constraint, and warning about it would train
 * people to ignore the warning that matters.
 */
export function planFits(verdict: PlanVerdict): boolean {
  return !verdict.compressed && verdict.overruns.length === 0;
}

/** TRUE when there is nothing at all for a PM to act on. */
export function planVerdictIsClean(verdict: PlanVerdict): boolean {
  return planFits(verdict) && verdict.cyclic.length === 0;
}

/** Counts only — what a badge, a journal entry or a census row needs. */
export function planVerdictCounts(verdict: PlanVerdict): {
  compressed: boolean;
  overrunCount: number;
  cyclicCount: number;
  capacityDeferredCount: number;
  fits: boolean;
} {
  return {
    compressed: verdict.compressed,
    overrunCount: verdict.overruns.length,
    cyclicCount: verdict.cyclic.length,
    capacityDeferredCount: verdict.capacityDeferred.length,
    fits: planFits(verdict),
  };
}
