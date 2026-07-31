/**
 * React hook for computing Scope Health metrics.
 *
 * Pure calculations from task data — no API calls. Every metric recomputes
 * reactively when tasks, period, or mode change.
 *
 * Calculation logic:
 *   FR-1.1  Scope Creep = items created after baseline lock / baseline count
 *   FR-2.1  New/Done Ratio = items created in window / items COMPLETED in window
 *           (completedAt falls in the window, NOT just status === 'done')
 *   FR-3.1  Epic Completion = completed items or points / total in epic
 *   FR-3.3  Status derived from actual vs expected completion (each epic's own timeline)
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
  EpicStatus,
} from '../types';

/* ── Public parameter shape ────────────────────────────────────────────── */

export interface UseScopeHealthParams {
  tasks: Task[];
  period: Period;
  mode?: CalculationMode;
  baselineInfo?: BaselineInfo;
}

/* ── Helpers ───────────────────────────────────────────────────────────── */

/**
 * How much of a date range has elapsed (0..1).
 * If the task/epic has no explicit start date, use period.windowStart as start.
 */
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
): { status: EpicStatus; delta: number } {
  const delta = expectedPct - completionPct;
  if (delta > 25) return { status: 'off_track', delta };
  if (delta >= 10) return { status: 'at_risk', delta };
  return { status: 'on_track', delta };
}

/**
 * Build a Map<epicId, { epic: Task; children: Task[] }>.
 * Epics are tasks with type === 'epic'. Children are tasks whose parentTaskId
 * matches an epic's id.
 */
function groupByEpic(tasks: Task[]): Map<string, { epic: Task; children: Task[] }> {
  // First pass: identify all epic tasks
  const epicTasks = new Map<string, Task>();
  const nonEpicTasks: Task[] = [];

  for (const t of tasks) {
    if (t.type === 'epic') {
      epicTasks.set(t.id, t);
    } else {
      nonEpicTasks.push(t);
    }
  }

  // Second pass: assign children to epics
  const map = new Map<string, { epic: Task; children: Task[] }>();
  for (const [id, epic] of epicTasks) {
    map.set(id, { epic, children: [] });
  }

  for (const t of nonEpicTasks) {
    if (t.parentTaskId != null) {
      const parentId = String(t.parentTaskId);
      const entry = map.get(parentId);
      if (entry) {
        entry.children.push(t);
      } else {
        // Orphan — parent is not an epic task; create a synthetic entry
        // from the first task's title (fallback for data that doesn't include
        // the epic as a proper task).
        const existing = map.get(parentId);
        if (existing) {
          existing.children.push(t);
        } else {
          map.set(parentId, {
            epic: {
              id: parentId,
              title: 'Unknown Epic',
              status: 'backlog',
              createdAt: t.createdAt,
            },
            children: [t],
          });
        }
      }
    }
  }

  return map;
}

/** Count items completed within a date window (by completedAt). */
function countCompletedInWindow(
  tasks: Task[],
  wStart: number,
  wEnd: number,
): Task[] {
  return tasks.filter((t) => {
    if (!t.completedAt) return false;
    const c = new Date(t.completedAt).getTime();
    return c >= wStart && c <= wEnd;
  });
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

    const count =
      mode === 'story_points'
        ? added.reduce((s, t) => s + (t.storyPoints ?? 0), 0)
        : added.length;

    const base =
      mode === 'story_points'
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

    // FR-2.1: "Added in Window" = tasks CREATED in the window
    const addedInWindow = tasks.filter((t) => {
      const created = new Date(t.createdAt).getTime();
      return created >= wStart && created <= wEnd;
    });

    // FR-2.1: "Completed in Window" = tasks whose completedAt falls in the window
    const completedInWindow = countCompletedInWindow(tasks, wStart, wEnd);

    if (mode === 'item_count') {
      const added = addedInWindow.length;
      const done = completedInWindow.length;
      const val = done > 0 ? added / done : added > 0 ? Infinity : 0;
      return {
        value: Number.isFinite(val) ? val : 0,
        status: val > 1.0 ? 'warning' : 'normal',
        addedItems: added,
        addedStoryPoints: 0,
        completedItems: done,
        completedStoryPoints: 0,
        addedInWindow,
        completedInWindow,
      };
    }

    // story_points mode
    const addedSP = addedInWindow.reduce((s, t) => s + (t.storyPoints ?? 0), 0);
    const doneSP = completedInWindow.reduce((s, t) => s + (t.storyPoints ?? 0), 0);
    const val = doneSP > 0 ? addedSP / doneSP : addedSP > 0 ? Infinity : 0;
    return {
      value: Number.isFinite(val) ? val : 0,
      status: val > 1.0 ? 'warning' : 'normal',
      addedItems: 0,
      addedStoryPoints: addedSP,
      completedItems: 0,
      completedStoryPoints: doneSP,
      addedInWindow,
      completedInWindow,
    };
  }, [tasks, period, mode]);

  /* ── Epic Completions (FR-3.1–3.3) ───────────────────────────────── */
  const epicCompletions = useMemo<EpicCompletion[]>(() => {
    const epicMap = groupByEpic(tasks);
    const wStart = new Date(period.windowStart).getTime();
    const wEnd = new Date(period.windowEnd).getTime();

    return Array.from(epicMap.entries()).map(([epicId, { epic, children }]) => {
      const totalItems = children.length;
      const doneTasks = children.filter((t) => t.status === 'done');
      const doneCount = doneTasks.length;
      const addedInWindow = children.filter((t) => {
        const created = new Date(t.createdAt).getTime();
        return created >= wStart && created <= wEnd;
      });

      // FR-3.3: expected completion uses the EPIC's own timeline
      const epicStart = epic.createdAt ?? period.windowStart;
      const epicEnd = epic.dueDate ?? period.windowEnd;

      if (mode === 'item_count') {
        const pct = totalItems > 0 ? (doneCount / totalItems) * 100 : 0;
        const expected = elapsedRatio(epicStart, epicEnd) * 100;
        const { status, delta } = deriveEpicStatus(pct, expected);
        return {
          epic: {
            id: epicId,
            title: epic.title,
            owner: epic.creator,
            dueDate: epic.dueDate,
            createdAt: epic.createdAt,
            totalItems,
            completedItems: doneCount,
            addedItems: addedInWindow.length,
          },
          completionPercentage: pct,
          status,
          expectedCompletionPercentage: expected,
          deltaPercentage: delta,
        };
      }

      // story_points mode
      const totalSP = children.reduce((s, t) => s + (t.storyPoints ?? 0), 0);
      const doneSP = doneTasks.reduce((s, t) => s + (t.storyPoints ?? 0), 0);
      const addedSP = addedInWindow.reduce((s, t) => s + (t.storyPoints ?? 0), 0);
      const pct = totalSP > 0 ? (doneSP / totalSP) * 100 : 0;
      const expected = elapsedRatio(epicStart, epicEnd) * 100;
      const { status, delta } = deriveEpicStatus(pct, expected);
      return {
        epic: {
          id: epicId,
          title: epic.title,
          owner: epic.creator,
          dueDate: epic.dueDate,
          createdAt: epic.createdAt,
          totalItems,
          totalStoryPoints: totalSP,
          completedItems: doneCount,
          completedStoryPoints: doneSP,
          addedItems: addedInWindow.length,
          addedStoryPoints: addedSP,
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
    const creepNorm = Math.max(0, 100 - scopeCreep.value);

    // Normalize ratio: ≤ 0.5 → 100 pts, ≥ 2.0 → 0 pts (linear ramp between)
    const r = ratio.value;
    const ratioNorm = Number.isFinite(r)
      ? Math.max(0, Math.min(100, 100 - ((r - 0.5) / 1.5) * 100))
      : 0;

    // Epic avg: direct percentage (0–100)
    const epicAvg =
      epicCompletions.length > 0
        ? epicCompletions.reduce((s, e) => s + e.completionPercentage, 0) /
          epicCompletions.length
        : 100; // no epics = neutral

    const w = { scopeCreep: 0.4, ratio: 0.3, epicCompletion: 0.3 };
    const value =
      creepNorm * w.scopeCreep + ratioNorm * w.ratio + epicAvg * w.epicCompletion;

    return {
      value: Math.max(0, Math.min(100, value)),
      breakdown: { scopeCreep: creepNorm, ratio: ratioNorm, epicCompletion: epicAvg },
      weights: w,
    };
  }, [scopeCreep, ratio, epicCompletions]);

  return {
    scopeCreep,
    ratio,
    epicCompletions,
    compositeScore,
    config: {
      calculateBy: mode,
      period: period.label,
    },
  };
}
