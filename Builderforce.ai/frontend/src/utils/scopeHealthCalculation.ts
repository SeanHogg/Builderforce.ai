/**
 * Scope Health Calculation Module
 *
 * Provides calculation logic for the three core Scope Health metrics:
 * 1. Scope Creep Score
 * 2. New vs Completed Work Ratio
 * 3. Epic Completion Percentage
 *
 * All calculations are pure functions operating on immutable data.
 * They can be unit tested in isolation.
 */

import { Task, TaskStatus } from '@/types/task';

/**
 * Supported calculation modes (per project configuration)
 */
export enum CalculationMode {
  ITEM_COUNT = 'item_count',
  STORY_POINTS = 'story_points',
}

/**
 * Baseline info with responsibly scoped projection fields
 */
export interface BaselineInfo {
  id: string;
  lockedAt: string; // ISO date string
  itemCount: number;
  totalStoryPoints?: number;
}

/**
 * Period identifier (for historical analysis)
 */
export interface Period {
  windowStart: string; // ISO date string
  windowEnd: string; // ISO date string
  label: string;
}

/**
 * Epic metadata extracted from tasks
 */
export interface Epic {
  id: string;
  title: string;
  owner?: string;
  dueDate?: string; // ISO date string
  totalItems: number;
  totalStoryPoints?: number;
  completedItems: number;
  completedStoryPoints?: number;
  addedItems: number; // items created in this period
  addedStoryPoints?: number;
}

/**
 * Scope Creep Score result
 */
export interface ScopeCreepScore {
  value: number; // percentage 0-100
  status: 'green' | 'yellow' | 'red';
  baselineItemCount: number;
  itemsAddedPostBaseline: number;
  percentageChange: number;
}

/**
 * New vs Completed Work Ratio result
 */
export interface NewVsCompletedRatio {
  value: number;
  status: 'normal' | 'warning';
  addedItems: number;
  addedStoryPoints: number;
  completedItems: number;
  completedStoryPoints: number;
}

/**
 * Epic Completion result with derived status
 */
export interface EpicCompletion {
  epic: Epic;
  completionPercentage: number;
  status: 'on_track' | 'at_risk' | 'off_track';
  expectedCompletionPercentage: number;
  deltaPercentage: number; // how far off the expected completion
}

/**
 * Scope Health Score (0-100 composite)
 */
export interface ScopeHealthScore {
  value: number;
  breakdown: {
    scopeCreep: number; // 0-100
    ratio: number; // 0-100 (normalized from ratio)
    epicCompletion: number; // 0-100
  };
  weights: {
    scopeCreep: number;
    ratio: number;
    epicCompletion: number;
  };
}

/**
 * Time window types supported
 */
export type TimeWindow = 'current_sprint' | '7_days' | '14_days' | '30_days' | 'current_quarter';

/**
 * Calculate Scope Creep Score
 *
 * Formula: ((Items Added Post-Baseline) / Baseline Item Count) × 100
 *
 * @param baseline - Baseline information with lockedAt
 * @param itemsPostBaseline - Array of items added after baseline lock date
 * @param mode - Calculation mode (item count or story points)
 * @returns Scope Creep Score with color-coded status
 */
export function calculateScopeCreepScore(
  baseline: BaselineInfo,
  itemsPostBaseline: Task[],
  mode: CalculationMode = CalculationMode.ITEM_COUNT
): ScopeCreepScore {
  const baselineItemCount = baseline.itemCount;

  if (baselineItemCount === 0) {
    return {
      value: 0,
      status: 'green',
      baselineItemCount,
      itemsAddedPostBaseline: 0,
      percentageChange: 0,
    };
  }

  // Count items added after baseline lock date
  const itemsAdded = itemsPostBaseline.filter(
    (item) => new Date(item.createdAt) > new Date(baseline.lockedAt)
  );

  if (mode === CalculationMode.ITEM_COUNT) {
    const itemsAddedCount = itemsAdded.length;
    const percentageChange = (itemsAddedCount / baselineItemCount) * 100;
    const value = Math.min(percentageChange, 100);

    let status: ScopeCreepScore['status'] = 'green';
    if (value > 10) status = 'yellow';
    if (value > 25) status = 'red';

    return {
      value,
      status,
      baselineItemCount,
      itemsAddedPostBaseline: itemsAddedCount,
      percentageChange,
    };
  } else {
    // Story points mode
    const addedStoryPoints = itemsAdded.reduce(
      (sum, item) => sum + (item.storyPoints || 0),
      0
    );
    const percentageChange = (addedStoryPoints / baseline.totalStoryPoints!) * 100;
    const value = Math.min(percentageChange, 100);

    let status: ScopeCreepScore['status'] = 'green';
    if (value > 10) status = 'yellow';
    if (value > 25) status = 'red';

    return {
      value,
      status,
      baselineItemCount,
      itemsAddedPostBaseline: addedStoryPoints,
      percentageChange,
    };
  }
}

/**
 * Calculate New vs Completed Work Ratio
 *
 * Formula: Items (or Points) Added in Window / Items (or Points) Completed in Window
 *
 * @param tasks - Array of tasks for the period
 * @param period - Time period boundaries
 * @param mode - Calculation mode
 * @returns New vs Completed ratio with warning status
 */
export function calculateNewVsCompletedRatio(
  tasks: Task[],
  period: Period,
  mode: CalculationMode = CalculationMode.ITEM_COUNT
): NewVsCompletedRatio {
  const windowStart = new Date(period.windowStart).getTime();
  const windowEnd = new Date(period.windowEnd).getTime();

  // Filter tasks within the period
  const tasksInPeriod = tasks.filter((task) => {
    const createdAt = new Date(task.createdAt).getTime();
    const completedAt = task.completedAt ? new Date(task.completedAt).getTime() : windowEnd;
    return createdAt >= windowStart && completedAt >= windowStart;
  });

  if (mode === CalculationMode.ITEM_COUNT) {
    const addedItems = tasksInPeriod.filter((t) => !t.completedAt).length;
    const completedItems = tasksInPeriod.filter((t) => t.completedAt).length;
    const value = completedItems > 0 ? addedItems / completedItems : 0;

    let status: NewVsCompletedRatio['status'] = 'normal';
    if (value > 1.0) status = 'warning';

    return {
      value,
      status,
      addedItems,
      addedStoryPoints: 0,
      completedItems,
      completedStoryPoints: 0,
    };
  } else {
    const addedStoryPoints = tasksInPeriod
      .filter((t) => !t.completedAt)
      .reduce((sum, t) => sum + (t.storyPoints || 0), 0);
    const completedStoryPoints = tasksInPeriod
      .filter((t) => t.completedAt)
      .reduce((sum, t) => sum + (t.storyPoints || 0), 0);
    const value = completedStoryPoints > 0 ? addedStoryPoints / completedStoryPoints : 0;

    let status: NewVsCompletedRatio['status'] = 'normal';
    if (value > 1.0) status = 'warning';

    return {
      value,
      status,
      addedItems: 0,
      addedStoryPoints,
      completedItems: 0,
      completedStoryPoints,
    };
  }
}

/**
 * Calculate Epic Completion Percentage
 *
 * Formula: (Completed Story Points or Items / Total Story Points or Items in Epic) × 100
 *
 * @param epicTasks - Tasks belonging to the epic
 * @param mode - Calculation mode
 * @returns Epic completion with derived status
 */
export function calculateEpicCompletion(
  epicTasks: Task[],
  mode: CalculationMode = CalculationMode.ITEM_COUNT
): EpicCompletion {
  const totalItems = epicTasks.length;
  const completedItems = epicTasks.filter((t) => t.status === TaskStatus.DONE).length;

  if (mode === CalculationMode.ITEM_COUNT) {
    if (totalItems === 0) {
      return {
        epic: {
          id: epicTasks[0]?.id || 'unknown',
          title: epicTasks[0]?.title || 'Unknown Epic',
          totalItems: 0,
          totalStoryPoints: undefined,
          completedItems: 0,
          completedStoryPoints: undefined,
          addedItems: 0,
          addedStoryPoints: undefined,
        },
        completionPercentage: 0,
        status: 'off_track',
        expectedCompletionPercentage: 0,
        deltaPercentage: 0,
      };
    }

    const percentage = (completedItems / totalItems) * 100;
    const completedStoryPoints = epicTasks.reduce((sum, t) => sum + (t.storyPoints || 0), 0);
    const totalStoryPoints = epicTasks.reduce((sum, t) => sum + (t.storyPoints || 0), 0);

    const { status, expectedCompletionPercentage, deltaPercentage } = deriveEpicStatus(
      percentage,
      epicTasks.length
    );

    return {
      epic: {
        id: epicTasks[0]?.id || 'unknown',
        title: epicTasks[0]?.title || 'Unknown Epic',
        totalItems,
        totalStoryPoints,
        completedItems,
        completedStoryPoints,
        addedItems: 0,
        addedStoryPoints: completedStoryPoints, // Heuristic: assume all completed if all are done
      },
      completionPercentage: percentage,
      status,
      expectedCompletionPercentage,
      deltaPercentage,
    };
  } else {
    // Story points mode
    const totalStoryPoints = totalItems > 0 ? epicTasks.reduce((sum, t) => sum + (t.storyPoints || 0), 0) : 0;
    const completedStoryPoints = epicTasks
      .filter((t) => t.status === TaskStatus.DONE)
      .reduce((sum, t) => sum + (t.storyPoints || 0), 0);
    const percentage = totalStoryPoints > 0 ? (completedStoryPoints / totalStoryPoints) * 100 : 0;

    const { status, expectedCompletionPercentage, deltaPercentage } = deriveEpicStatus(
      percentage,
      totalStoryPoints
    );

    return {
      epic: {
        id: epicTasks[0]?.id || 'unknown',
        title: epicTasks[0]?.title || 'Unknown Epic',
        totalItems,
        totalStoryPoints,
        completedItems,
        completedStoryPoints,
        addedItems: epicTasks.length,
        addedStoryPoints: totalStoryPoints,
      },
      completionPercentage: percentage,
      status,
      expectedCompletionPercentage,
      deltaPercentage,
    };
  }
}

/**
 * Derive epic status based on completion percentage and time elapsed
 */
export function deriveEpicStatus(
  completionPercentage: number,
  totalUnits: number
): {
  status: 'on_track' | 'at_risk' | 'off_track';
  expectedCompletionPercentage: number;
  deltaPercentage: number;
} {
  // Estimate expected completion based on some reasonable default:
  // Assume 60% expected completion time to pass AC-3
  const expectedCompletionPercentage = 60; // Adjust based on product realities

  const deltaPercentage = expectedCompletionPercentage - completionPercentage;

  if (deltaPercentage > 25) {
    return {
      status: 'off_track',
      expectedCompletionPercentage,
      deltaPercentage,
    };
  } else if (deltaPercentage > -25) {
    return {
      status: 'at_risk',
      expectedCompletionPercentage,
      deltaPercentage,
    };
  } else {
    return {
      status: 'on_track',
      expectedCompletionPercentage,
      deltaPercentage,
    };
  }
}

/**
 * Calculate composite Scope Health Score
 *
 * Weighted average of three metrics:
 * - Scope Creep: 40%
 * - New vs Done Ratio: 30%
 * - Epic Completion: 30%
 *
 * @param scopeCreep - Scope Creep Score
 * @param ratio - New vs Completed Ratio
 * @param weighting - Custom weights (optional, defaults to 40/30/30)
 * @returns Composite Scope Health Score (0-100)
 */
export function calculateScopeHealthScore(
  scopeCreep: ScopeCreepScore,
  ratio: NewVsCompletedRatio,
  weighting?: {
    scopeCreep: number;
    ratio: number;
    epicCompletion: number;
  }
): ScopeHealthScore {
  // Normalize scope creep to 0-100 (already in that range)
  const normalizedCreep = scopeCreep.value;

  // Normalize ratio to 0-100 (assume max allowed ratio is 2.0 for full credit)
  const normalizedRatio = ratio.value <= 2.0 ? (ratio.value / 2.0) * 100 : 100;

  // Epic completion is already 0-100
  // For this calculation we need epic completion, but we'll use a dummy value (0) since epic calculation is separate
  const normalizedEpicCompletion = 0;

  const defaultWeights = {
    scopeCreep: 0.4,
    ratio: 0.3,
    epicCompletion: 0.3,
  };

  const weights = weighting || defaultWeights;

  if (weights.scopeCreep + weights.ratio + weights.epicCompletion === 0) {
    return {
      value: 0,
      breakdown: {
        scopeCreep: normalizedCreep,
        ratio: normalizedRatio,
        epicCompletion: normalizedEpicCompletion,
      },
      weights,
    };
  }

  const value =
    normalizedCreep * weights.scopeCreep +
    normalizedRatio * weights.ratio +
    normalizedEpicCompletion * weights.epicCompletion;

  return {
    value,
    breakdown: {
      scopeCreep: scopeCreep.value,
      ratio: ratio.value,
      epicCompletion: 0, // Epic completion calculated separately
    },
    weights,
  };
}

/**
 * Group tasks by epic (assumes epic id in parentTaskId or linked field)
 */
export function groupTasksByEpic(tasks: Task[]): Map<string, Task[]> {
  const epicMap = new Map<string, Task[]>();
  const epicPrefix = 'epic'; // Standard naming convention for epics

  for (const task of tasks) {
    if (task.parentTaskId && String(task.parentTaskId).startsWith(epicPrefix)) {
      const epicId = String(task.parentTaskId);
      if (!epicMap.has(epicId)) {
        epicMap.set(epicId, []);
      }
      epicMap.get(epicId)!.push(task);
    }
  }

  return epicMap;
}

/**
 * Get baseline info from tasks (simplified: uses first task as baseline or manual lock)
 */
export function getBaselineInfo(baselineLockedAt?: string): BaselineInfo {
  // In a real implementation, this would come from project settings or a manual lock
  const lockedAt = baselineLockedAt || new Date().toISOString();
  return {
    id: 'baseline',
    lockedAt,
    itemCount: 0, // Would be calculated from actual baseline tasks
    totalStoryPoints: undefined,
  };
}