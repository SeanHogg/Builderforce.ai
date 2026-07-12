/**
 * React hook for computing Scope Health metrics
 *
 * Provides an efficient way to compute and cache Scope Health scores
 * based on current tasks and period configuration.
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
  TimeWindow,
  Period,
} from '../types';

export interface UseScopeHealthParams {
  tasks: Task[];
  period: Period;
  mode?: CalculationMode;
  baselineInfo?: BaselineInfo;
}

export function useScopeHealth({
  tasks,
  period,
  mode = 'item_count',
  baselineInfo,
}: UseScopeHealthParams) {
  // Filter tasks by epic (epic tasks have parentTaskId starting with 'epic')
  const epicTasksMap = useMemo(() => {
    const epicMap = new Map<string, Task[]>();
    const epicPrefix = 'epic';
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
  }, [tasks]);

  // Calculate Scope Creep Score
  const scopeCreep = useMemo<ScopeCreepScore>(() => {
    const baseline = baselineInfo || {
      id: 'baseline',
      lockedAt: tasks[0]?.createdAt || new Date().toISOString(),
      itemCount: tasks.length,
    };
    // Find tasks added after baseline lock date
    const baselineDate = new Date(baseline.lockedAt);
    const postBaselineTasks = tasks.filter((t) => new Date(t.createdAt) > baselineDate);

    const itemsAddedPostBaseline = postBaselineTasks.length;
    const percentageChange = baseline.itemCount > 0
      ? (itemsAddedPostBaseline / baseline.itemCount) * 100
      : 0;
    const value = Math.min(percentageChange, 100);

    let status: 'green' | 'yellow' | 'red' = 'green';
    if (value > 10) status = 'yellow';
    if (value > 25) status = 'red';

    return {
      value,
      status,
      baselineItemCount: baseline.itemCount,
      itemsAddedPostBaseline,
      percentageChange,
    };
  }, [tasks, baselineInfo]);

  // Calculate New vs Completed Ratio
  const ratio = useMemo<NewVsCompletedRatio>(() => {
    const windowStart = new Date(period.windowStart).getTime();
    const windowEnd = new Date(period.windowEnd).getTime();

    const tasksInPeriod = tasks.filter((task) => {
      const createdAt = new Date(task.createdAt).getTime();
      const completedAt = task.completedAt ? new Date(task.completedAt).getTime() : windowEnd;
      return createdAt >= windowStart && completedAt >= windowStart;
    });

    if (mode === 'item_count') {
      const addedItems = tasksInPeriod.filter((t) => !t.completedAt).length;
      const completedItems = tasksInPeriod.filter((t) => t.completedAt).length;
      const value = completedItems > 0 ? addedItems / completedItems : 0;
      const status = value > 1.0 ? 'warning' : 'normal';
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
      const status = value > 1.0 ? 'warning' : 'normal';
      return {
        value,
        status,
        addedItems: 0,
        addedStoryPoints,
        completedItems: 0,
        completedStoryPoints,
      };
    }
  }, [tasks, period, mode]);

  // Calculate epic completions
  const epicCompletions = useMemo(() => {
    return Array.from(epicTasksMap.entries()).map(([epicId, epicTasks]) => {
      const totalItems = epicTasks.length;
      const completedItems = epicTasks.filter((t) => t.status === 'done').length;

      if (mode === 'item_count') {
        const percentage = totalItems > 0 ? (completedItems / totalItems) * 100 : 0;
        const completedStoryPoints = epicTasks.reduce((sum, t) => sum + (t.storyPoints || 0), 0);
        const totalStoryPoints = epicTasks.reduce((sum, t) => sum + (t.storyPoints || 0), 0);

        // Derive status
        const expectedCompletionPercentage = 60;
        const deltaPercentage = expectedCompletionPercentage - percentage;
        let status: 'on_track' | 'at_risk' | 'off_track';
        if (deltaPercentage > 25) status = 'off_track';
        else if (deltaPercentage > -25) status = 'at_risk';
        else status = 'on_track';

        return {
          epic: {
            id: epicId,
            title: epicTasks[0]?.title || 'Unknown Epic',
            totalItems,
            totalStoryPoints,
            completedItems,
            completedStoryPoints,
            addedItems: 0,
            addedStoryPoints: completedStoryPoints,
          },
          completionPercentage: percentage,
          status,
          expectedCompletionPercentage,
          deltaPercentage,
        };
      } else {
        const totalStoryPoints = totalItems > 0 ? epicTasks.reduce((sum, t) => sum + (t.storyPoints || 0), 0) : 0;
        const completedStoryPoints = epicTasks
          .filter((t) => t.status === 'done')
          .reduce((sum, t) => sum + (t.storyPoints || 0), 0);
        const percentage = totalStoryPoints > 0 ? (completedStoryPoints / totalStoryPoints) * 100 : 0;

        const expectedCompletionPercentage = 60;
        const deltaPercentage = expectedCompletionPercentage - percentage;
        let status: 'on_track' | 'at_risk' | 'off_track';
        if (deltaPercentage > 25) status = 'off_track';
        else if (deltaPercentage > -25) status = 'at_risk';
        else status = 'on_track';

        return {
          epic: {
            id: epicId,
            title: epicTasks[0]?.title || 'Unknown Epic',
            totalItems,
            totalStoryPoints,
            completedItems: 0,
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
    });
  }, [epicTasksMap, mode]);

  // Calculate composite score (weights: 40% creep, 30% ratio, 30% epic)
  const compositeScore = useMemo<ScopeHealthScore>(() => {
    const normalizedCreep = scopeCreep.value;
    const normalizedRatio = ratio.value <= 2.0 ? (ratio.value / 2.0) * 100 : 100;
    const normalizedEpicCompletion = epicCompletions.reduce((sum, e) => sum + e.completionPercentage, 0) / epicCompletions.length || 0;

    if (epicCompletions.length === 0) {
      return {
        value: normalizedCreep * 0.4 + normalizedRatio * 0.3 + 0,
        breakdown: {
          scopeCreep: scopeCreep.value,
          ratio: ratio.value,
          epicCompletion: 0,
        },
        weights: { scopeCreep: 0.4, ratio: 0.3, epicCompletion: 0.3 },
      };
    }

    const value =
      normalizedCreep * 0.4 +
      normalizedRatio * 0.3 +
      (normalizedEpicCompletion / epicCompletions.length) * 0.3;

    return {
      value,
      breakdown: {
        scopeCreep: scopeCreep.value,
        ratio: ratio.value,
        epicCompletion: normalizedEpicCompletion,
      },
      weights: { scopeCreep: 0.4, ratio: 0.3, epicCompletion: 0.3 },
    };
  }, [scopeCreep, ratio, epicCompletions]);

  // Compute derived historical data if needed (future enhancement)
  const healthHistory = useMemo(() => {
    return []; // Future enhancement: array of historical scores with timestamps
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