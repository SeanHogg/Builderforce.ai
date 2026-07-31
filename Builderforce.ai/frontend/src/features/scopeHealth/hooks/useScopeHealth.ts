/**
 * React hook for computing Scope Health metrics.
 *
 * Pure calculations from task data — no API calls. Every metric recomputes
 * reactively when tasks, period, or mode change.
 */

import { useMemo } from 'react';
import type {
  Task,
  ScopeCreepScore,
  NewVsCompletedRatio,
  EpicCompletion,
  ScopeHealthScore,
  BaselineInfo,
  CalculationMode,
  Period,
} from '../types';

/* ── Public parameter shape ────────────────────────────────────────────── */

export interface UseScopeHealthParams {
  tasks: Task[];
  period: Period;
  mode?: CalculationMode;
  baselineInfo?: BaselineInfo;
}

/* ── Helpers ───────────────────────────────────────────────────────────── */

/** Elapsed ratio of a task window: how much time has passed. */
function elapsedRatio(startISO: string, endISO: string): number {
  const start = new Date(startISO).getTime();
  const end = new Date(endISO).getTime();
  const now = Date.now();
  if (now <= start) return 0;
  if (now >= end) return 1;
  return (now - start) / (end - start);
}

/** Derive epic status per PRD FR-3.3 thresholds. */
function deriveEpicStatus(
  completionPct: number,
  expectedPct: number,
): { status: EpicCompletion['status']; delta: number } {
  const delta = expectedPct - completionPct;
  if (delta > 25) return { status: 'off_track', delta };
  if (delta >= 10) return { status: 'at_risk', delta };
  return { status: 'on_track', delta };
}

/** Build a Map<epicId, Task[]> from tasks that have parentTaskId. */
function groupByEpic(tasks: Task[]): Map<string, Task[]> {
  const map = new Map<string, Task[]>();
  for (const t of tasks) {
    if (t.parentTaskId != null) {
      const id = String(t.parentTaskId);
      const bucket = map.get(id);
      if (bucket) bucket.push(t);
      else map.set(id, [t]);
    }
  }
  return map;
}

/* ── Hook ──────────────────────────────────────────────────────────────── */

export function useScopeHealth({
  tasks,
  period,
  mode = 'item_count',
  baselineInfo,
}: UseScopeHealthParams) {
  /* ── Scope Creep Score (FR-1.1) ───────────────────────────────────── */
  const scopeCreep = useMemo<ScopeCreepScore>(() => {
    const baseline = baselineInfo ?? {
      id: 'baseline',
      lockedAt: tasks.length > 0 ? tasks[0].createdAt : new Date().toISOString(),
      itemCount: tasks.length,
      totalStoryPoints: tasks.reduce((s, t) => s + (t.storyPoints ?? 0), 0),
    };

    const baselineDate = new Date(baseline.lockedAt).getTime();
    const added = tasks.filter((t) => new Date(t.createdAt).getTime() > baselineDate);

    const count = mode === 'story_points'
      ? added.reduce((s, t) => s + (t.storyPoints ?? 0), 0)
      : added.length;

    const base = mode === 'story_points'
      ? (baseline.totalStoryPoints ?? baseline.itemCount)
      : baseline.itemCount;

    const pct = base > 0 ? Math.min((count / base) * 100, 100) : 0;

    let status: ScopeCreepScore['status'] = 'green';
    if (pct > 25) status = 'red';
    else if (pct > 10) status = 'yellow';

    return {
      value: pct,
      status,
      baselineItemCount: baseline.itemCount,
      itemsAddedPostBaseline: count,
      percentageChange: pct,
    };
  }, [tasks, baselineInfo, mode]);

  /* ── New vs Completed Ratio (FR-2.1) ──────────────────────────────── */
  const ratio = useMemo<NewVsCompletedRatio>(() => {
    const wStart = new Date(period.windowStart).getTime();
    const wEnd = new Date(period.windowEnd).getTime();

    const inWindow = tasks.filter((t) => {
      const created = new Date(t.createdAt).getTime();
      return created >= wStart && created <= wEnd;
    });

    const isDone = (t: Task) => t.status === 'done';

    if (mode === 'item_count') {
      const added = inWindow.filter((t) => !isDone(t)).length;
      const done = inWindow.filter((t) => isDone(t)).length;
      const val = done > 0 ? added / done : (added > 0 ? Infinity : 0);
      return {
        value: Number.isFinite(val) ? val : 0,
        status: val > 1.0 ? 'warning' : 'normal',
        addedItems: added,
        addedStoryPoints: 0,
        completedItems: done,
        completedStoryPoints: 0,
      };
    }

    // story_points mode
    const addedSP = inWindow.filter((t) => !isDone(t)).reduce((s, t) => s + (t.storyPoints ?? 0), 0);
    const doneSP = inWindow.filter((t) => isDone(t)).reduce((s, t) => s + (t.storyPoints ?? 0), 0);
    const val = doneSP > 0 ? addedSP / doneSP : (addedSP > 0 ? Infinity : 0);
    return {
      value: Number.isFinite(val) ? val : 0,
      status: val > 1.0 ? 'warning' : 'normal',
      addedItems: 0,
      addedStoryPoints: addedSP,
      completedItems: 0,
      completedStoryPoints: doneSP,
    };
  }, [tasks, period, mode]);

  /* ── Epic Completions (FR-3.1–3.3) ───────────────────────────────── */
  const epicCompletions = useMemo<EpicCompletion[]>(() => {
    const epicMap = groupByEpic(tasks);
    return Array.from(epicMap.entries()).map(([epicId, epicTasks]) => {
      const totalItems = epicTasks.length;
      const done = epicTasks.filter((t) => t.status === 'done').length;

      if (mode === 'item_count') {
        const pct = totalItems > 0 ? (done / totalItems) * 100 : 0;
        const expected = elapsedRatio(
          period.windowStart,
          period.windowEnd,
        ) * 100;
        const { status, delta } = deriveEpicStatus(pct, expected);
        return {
          epic: {
            id: epicId,
            title: epicTasks[0]?.title ?? 'Unknown Epic',
            totalItems,
            completedItems: done,
            addedItems: totalItems,
          },
          completionPercentage: pct,
          status,
          expectedCompletionPercentage: expected,
          deltaPercentage: delta,
        };
      }

      // story_points mode
      const totalSP = epicTasks.reduce((s, t) => s + (t.storyPoints ?? 0), 0);
      const doneSP = epicTasks.filter((t) => t.status === 'done').reduce((s, t) => s + (t.storyPoints ?? 0), 0);
      const pct = totalSP > 0 ? (doneSP / totalSP) * 100 : 0;
      const expected = elapsedRatio(
        period.windowStart,
        period.windowEnd,
      ) * 100;
      const { status, delta } = deriveEpicStatus(pct, expected);
      return {
        epic: {
          id: epicId,
          title: epicTasks[0]?.title ?? 'Unknown Epic',
          totalItems,
          totalStoryPoints: totalSP,
          completedItems: done,
          completedStoryPoints: doneSP,
          addedItems: totalItems,
          addedStoryPoints: totalSP,
        },
        completionPercentage: pct,
        status,
        expectedCompletionPercentage: expected,
        deltaPercentage: delta,
      };
    });
  }, [tasks, period, mode]);

  /* ── Composite Scope Health Score (FR-4.1) ────────────────────────── */
  const compositeScore = useMemo<ScopeHealthScore>(() => {
    // Invert creep: 0% creep = 100 pts, 100% creep = 0 pts
    const creepNorm = 100 - scopeCreep.value;

    // Normalize ratio: <= 0.5 → 100 pts, >= 1.5 → 0 pts (linear ramp between)
    const r = ratio.value;
    const ratioNorm = Number.isFinite(r)
      ? Math.max(0, Math.min(100, 100 - ((r - 0.5) / 1.0) * 100))
      : 0;

    // Epic avg: direct percentage (0–100)
    const epicAvg = epicCompletions.length > 0
      ? epicCompletions.reduce((s, e) => s + e.completionPercentage, 0) / epicCompletions.length
      : 0;

    const w = { scopeCreep: 0.4, ratio: 0.3, epicCompletion: 0.3 };
    const value = creepNorm * w.scopeCreep + ratioNorm * w.ratio + epicAvg * w.epicCompletion;

    return {
      value,
      breakdown: { scopeCreep: creepNorm, ratio: ratioNorm, epicCompletion: epicAvg },
      weights: w,
    };
  }, [scopeCreep, ratio, epicCompletions]);

  /* ── Health history (FR-4.3 placeholder) ──────────────────────────── */
  const healthHistory = useMemo(() => {
    // Future: derive from stored snapshots. For now, return the single point.
    return [];
  }, [compositeScore]);

  return {
    scopeCreep,
    ratio,
    epicCompletions,
    compositeScore,
    healthHistory,
    config: {
      calculateBy: mode,
      period: period.label,
    },
  };
}
