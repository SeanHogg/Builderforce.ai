/**
 * Task Insights Computation Service
 * 
 * Dynamically computes task health, trends, anomalies, and supporting data
 * based on task state, due dates, assignment status, and subtask progress.
 */

import { Task } from '../../domain/task/Task';
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
  // For now, we'll compute a simple heuristic: if task is completed and has subtasks,
  // they should all be done
  if (task.status === 'in_progress' || task.status === 'backlog') {
    // If start date is passed and task isn't progressing, flag potential delay
    if (dueDate && due < new Date()) {
      anomalies.push({
        category: 'subtask_delay',
        code: 'SUBTASK_DELAY',
        message: 'Task is behind schedule',
        detectedAt: new Date().toISOString(),
      });
    }
  }

  // AC4: Supporting Data
  const supportingData: InsightSupportingData[] = [
    {
      type: 'Ingested' as const,
      label: 'Time Spent',
      value: task.storyPoints ?? null,
      aggregates: {
        lastUpdated: new Date().toISOString(),
      },
    },
    {
      type: 'Ingested' as const,
      label: 'Priority',
      value: task.priority ?? null,
      aggregates: {
        lastUpdated: new Date().toISOString(),
      },
    },
    {
      type: 'Manual' as const,
      label: 'Due Date',
      value: dueDate ? task.dueDate?.toISOString() : null,
      aggregates: {
        lastUpdated: new Date().toISOString(),
      },
    },
    {
      type: 'Ingested' as const,
      label: 'Status',
      value: task.status ?? null,
      aggregates: {
        lastUpdated: new Date().toISOString(),
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