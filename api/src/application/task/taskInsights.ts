/**
 * Task Insights Computation Service
 * 
 * Dynamically computes task health, trends, anomalies, and supporting data
 * based on task state, due dates, assignment status, and subtask progress.
 */

import { Task } from '../../domain/task/entities';
import { InsightAnomaly, InsightSupportingData, TaskInsights, HealthState, TrendDirection, InsightAggregates } from '../../presentation/types/taskInsightsTypes';

/**
 * Simple rule引擎: Return synthetic taskInsights (default states)
 */
export function computeTaskInsights(
  taskId: number,
  task: Task
): TaskInsights {
  const dueDate = task.dueDate ? new Date(task.dueDate) : null;
  const status = task.status;
  const assignedAgentRef = task.assignedAgentRef;
  
  // Determine trend (simple heuristic for now)
  // TODO: Implement proper trend calculation based on historical states
  const trend: TrendDirection = 'STABLE';

  // Determine health based on due date (AC1)
  const health: HealthState = (() => {
    const now = new Date();
    const due = dueDate;
    
    if (!due) return 'GREEN';
    
    const diffTime = due.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays <= 1) return 'RED';
    if (diffDays <= 3) return 'YELLOW';
    return 'GREEN';
  })();

  // Detect anomalies (AC3)
  const anomalies: InsightAnomaly[] = [];

  // AC3: Resource Overload (if assignee has >100% capacity for next 5 working days)
  if (assignedAgentRef) {
    // TODO: Replace with actual capacity calculation from workforce API
    anomalies.push({
      category: 'resource_overload',
      code: 'RES_OVERLOAD',
      message: 'Assignee has exceeded 100% estimated capacity',
      detectedAt: new Date().toISOString(),
    });
  }

  // AC3: Deadline Missed
  if (dueDate && due < new Date()) {
    anomalies.push({
      category: 'deadline_missed',
      code: 'DL_MISSED',
      message: 'Deadline has been missed',
      detectedAt: new Date().toISOString(),
    });
  }

  // Subtask delay (if subtasks were expected by now)
  // TODO: Fetch subtask count and completion status from subtasks endpoint
  // For now, we'll use what's in the task result if available
  const subtaskCount = (task as any).subtaskCount || 0;
  const subtasksCompleted = (task as any).subtasksCompleted || 0;
  
  if (subtaskCount > 0 && subtasksCompleted < subtaskCount) {
    anomalies.push({
      category: 'subtask_delay',
      code: 'SUBTASK_DELAY',
      message: 'Subtasks are falling behind schedule',
      detectedAt: new Date().toISOString(),
    });
  }

  // AC4: Supporting Data
  const supportingData: InsightSupportingData[] = [
    {
      type: 'Ingested' as const,
      label: 'Time Spent',
      value: task.timeSpent || null,
      aggregates: {
        lastUpdated: '2025-06-20T10:00:00Z',
      },
    },
    {
      type: 'Ingested' as const,
      label: 'Sub-tasks Remaining',
      value: subtasksCompleted ? subtaskCount - subtasksCompleted : null,
      aggregates: {
        lastUpdated: '2025-06-20T10:00:00Z',
      },
    },
    {
      type: 'Manual' as const,
      label: 'Blockers',
      value: task.blockers || null,
      aggregates: {
        lastUpdated: '2025-06-20T10:00:00Z',
      },
    },
    {
      type: 'Ingested' as const,
      label: 'Priority',
      value: task.priority || null,
      aggregates: {
        lastUpdated: '2025-06-20T10:00:00Z',
      },
    },
  ];

  return {
    currentHealth: health,
    trend,
    anomalies,
    supportingData,
  };
}