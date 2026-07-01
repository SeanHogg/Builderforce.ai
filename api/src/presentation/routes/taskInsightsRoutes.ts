/**
 * Task Insights Routes
 * 
 * Endpoint: GET /api/tasks/{id}/insights
 */
import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';

// Types aligned with PRD
export interface InsightAnomaly {
  category: 'resource_overload' | 'deadline_missed' | 'subtask_delay';
  code: string; // e.g., 'RES_OVERLOAD', 'DL_MISSED', 'SUBTASK_DELAY'
  message: string;
  detectedAt: string;
}

export interface InsightSupportingData {
  type: 'Ingested' | 'Manual';
  label: string;
  value: string | number | null;
  source?: string;
  aggregates?: InsightAggregates;
}

export interface InsightAggregates {
  count?: number;
  lastUpdated?: string;
  chartData?: number[]; // For historical charts (e.g., 30 days)
}

export interface TaskInsights {
  currentHealth: 'RED' | 'YELLOW' | 'GREEN';
  trend: 'IMPROVING' | 'WORSENING' | 'STABLE';
  anomalies: InsightAnomaly[];
  supportingData: InsightSupportingData[];
}

export const anomalySchemas = {
  resourceOverload: z.object({
    category: z.literal('resource_overload'),
    code: z.literal('RES_OVERLOAD'),
    message: z.string(),
    detectedAt: z.string().datetime(),
  }),

  deadlineMissed: z.object({
    category: z.literal('deadline_missed'),
    code: z.literal('DL_MISSED'),
    message: z.string(),
    detectedAt: z.string().datetime(),
  }),

  subtaskDelay: z.object({
    category: z.literal('subtask_delay'),
    code: z.literal('SUBTASK_DELAY'),
    message: z.string(),
    detectedAt: z.string().datetime(),
  }),
} as const;

// Simple rule引擎: Return synthetic taskInsights (default states)
function computeTaskInsights(
  taskId: string,
  baseTask: any = {}
): TaskInsights {
  const dueDate = baseTask.dueDate;
  const status = baseTask.status;

  // Determine trend (simple heuristic for now)
  // TODO: Implement proper trend calculation based on historical states
  const trend: 'IMPROVING' | 'WORSENING' | 'STABLE' = 'STABLE';

  // Determine health based on due date
  const health: 'RED' | 'YELLOW' | 'GREEN' = (() => {
    const now = new Date();
    const due = dueDate ? new Date(dueDate) : null;
    
    if (!due) return 'GREEN';
    
    const diffTime = due.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays <= 1) return 'RED';
    if (diffDays <= 3) return 'YELLOW';
    return 'GREEN';
  })();

  // Detect anomalies
  const anomalies: InsightAnomaly[] = [];

  // AC3: Resource Overload (if assignee has >100% capacity for next 5 working days)
  if (baseTask.assignedAgentHostId || baseTask.assignedUserId) {
    // TODO: Replace with actual capacity calculation from workforce API
    anomalies.push({
      category: 'resource_overload',
      code: 'RES_OVERLOAD',
      message: 'Assignee has exceeded 100% estimated capacity',
      detectedAt: nowString(),
    });
  }

  // AC3: Deadline Missed
  if (dueDate && due < new Date()) {
    anomalies.push({
      category: 'deadline_missed',
      code: 'DL_MISSED',
      message: 'Deadline has been missed',
      detectedAt: nowString(),
    });
  }

  // Subtask delay (if subtasks were expected by now)
  if (baseTask.subtaskCount && baseTask.subtasksCompleted && baseTask.subtasksCompleted < baseTask.subtaskCount) {
    anomalies.push({
      category: 'subtask_delay',
      code: 'SUBTASK_DELAY',
      message: 'Subtasks are falling behind schedule',
      detectedAt: nowString(),
    });
  }

  // AC4: Supporting Data
  const supportingData: InsightSupportingData[] = [
    {
      type: 'Ingested' as const,
      label: 'Time Spent',
      value: baseTask.timeSpent || null,
      aggregates: {
        lastUpdated: '2025-06-20T10:00:00Z',
      },
    },
    {
      type: 'Ingested' as const,
      label: 'Sub-tasks Remaining',
      value: baseTask.subtasksCompleted ? baseTask.subtaskCount - baseTask.subtasksCompleted : null,
      aggregates: {
        lastUpdated: '2025-06-20T10:00:00Z',
      },
    },
    {
      type: 'Manual' as const,
      label: 'Blockers',
      value: baseTask.blockers || null,
      aggregates: {
        lastUpdated: '2025-06-20T10:00:00Z',
      },
    },
    {
      type: 'Ingested' as const,
      label: 'Priority',
      value: baseTask.priority || null,
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

function nowString(): string {
  return new Date().toISOString();
}

const router = Router();

/**
 * GET /api/tasks/:id/insights
 * 
 * Returns task-level insights including current health, trend, anomalies, and supporting data.
 * 
 * Query Parameters:
 * - limit: number of data points to return (default: 10)
 * - includeChartData: boolean to include chart data in aggregates (default: false)
 */
router.get('/tasks/:id/insights', async (req: any, res: Response, next: NextFunction) => {
  try {
    const taskId = req.params.id;
    const validateTaskId = z.string().uuid().regex(/^\d+$/).safeParse(taskId);

    if (!validateTaskId.success) {
      return res.status(400).json({
        error: 'Invalid task ID format - expected numeric ID',
        details: validateTaskId.error.message,
      });
    }

    // Simulated task data for this demo
    // TODO: Fetch the actual task from the database
    const baseTask = {
      id: validateTaskId.data,
      title: 'Task Example',
      status: 'in_progress',
      priority: 'high',
      dueDate: new Date(Date.now() + 86400000 * 2).toISOString(), // 2 days from now
      assignedAgentHostId: 1,
      assignedUserId: 'user-123',
      subtaskCount: 10,
      subtasksCompleted: 3,
      timeSpent: '12h 30m',
      blockers: null,
    };

    // Compute insights (das skeleton to be expanded in later passes)
    const insights = computeTaskInsights(validateTaskId.data, baseTask);

    res.json({
      taskId: insights,
    });
  } catch (err) {
    next(err);
  }
});

export default router;