import { PrismaClient } from '@prisma/client';
import { PriorityLevel, PriorityWeight, type MisalignmentCheck, type MisalignmentDetails } from '../../domain/shared/priorityMisalignment.types';

/**
 * Service for detecting priority misalignments against configured rules
 */
export class PriorityMisalignmentCheckService {
  constructor(private db: PrismaClient) {}

  /**
   * Check all enabled rules for a given task
   */
  async checkTask(
    taskId: number,
    projectId: number | null
  ): Promise<{ checks: MisalignmentCheck[]; totalSeverity: 'warning' | 'error' }> {
    const checks: MisalignmentCheck[] = [];
    let totalSeverity: 'warning' | 'error' = 'warning';

    // Find all applicable (project-scoped or workspace-scoped) rules
    const rules = await this.db.misalignment_rules.findMany({
      where: {
        enabled: true,
        ...(projectId !== null ? { projectId } : { projectId: null }),
      },
      orderBy: { createdAt: 'asc' },
    });

    for (const rule of rules) {
      const check = await this.performCheck(taskId, rule);
      if (check) {
        checks.push(check);
        totalSeverity = rule.severity;
      }
    }

    return { checks, totalSeverity };
  }

  /**
   * Perform a single misalignment check for a rule
   */
  private async performCheck(
    taskId: number,
    rule: any
  ): Promise<MisalignmentCheck | null> {
    const task = await this.db.tasks.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        priority: true,
        parent_id: true,
        update_at: true,
      },
    });

    if (!task || !task.priority) {
      return null; // No priority to check
    }

    const childPriority = task.priority as PriorityLevel;

    switch (rule.type) {
      case 'hierarchical':
        return this.checkHierarchicalMisalignment(task, childPriority, rule);
      case 'strategic':
        return this.checkStrategicMisalignment(task, childPriority, rule, taskId);
      case 'dependency':
        return this.checkDependencyMisalignment(task, childPriority, rule, taskId);
      default:
        return null;
    }
  }

  /**
   * FR1.1: Hierarchical Misalignment
   * Detect when a child task's priority is higher than its parent epic/feature/task,
   * or deviates by more than N levels.
   */
  private async checkHierarchicalMisalignment(
    task: any,
    childPriority: PriorityLevel,
    rule: any
  ): Promise<MisalignmentCheck | null> {
    // Only apply to child tasks (have a parent)
    if (!task.parent_id) {
      return {
        taskId: task.id,
        ruleId: rule.id,
        type: rule.type,
        severity: rule.severity,
        detachedReason: 'No parent task - hierarchical rules not applicable',
        details: {
          reason: 'Task has no parent',
          childPriority,
          deviation: 0,
        },
        createdAt: new Date(),
      };
    }

    // Get parent task
    const parent = await this.db.tasks.findUnique({
      where: { id: task.parent_id },
      select: {
        id: true,
        priority: true,
        task_type: true,
      },
    });

    if (!parent?.priority) {
      return {
        taskId: task.id,
        ruleId: rule.id,
        type: rule.type,
        severity: rule.severity,
        detachedReason: 'Parent task has no priority - cannot assess',
        details: {
          reason: 'Parent task priority missing',
          childPriority,
          parentPriority: undefined,
          deviation: 0,
        },
        createdAt: new Date(),
      };
    }

    const parentPriority = parent.priority as PriorityLevel;

    // Calculate deviation (difference in priority levels)
    const childWeight = PriorityWeight[childPriority];
    const parentWeight = PriorityWeight[parentPriority];
    const deviation = Math.abs(childWeight - parentWeight);

    // Check if deviation exceeds threshold
    if (deviation > rule.threshold) {
      const isHigher = childWeight > parentWeight;
      const reason = isHigher
        ? `Child task ({child}) priority (${childPriority}) is HIGHER than parent (${parentPriority}) by ${deviation} level(s)`
        : `Child task ({child}) priority (${childPriority}) appears to be LOWER than expected for its position relative to parent (${parentPriority})`;

      return {
        taskId: task.id,
        ruleId: rule.id,
        type: rule.type,
        severity: rule.severity,
        details: {
          reason,
          parentPriority,
          childPriority,
          deviation,
          actionableHint: isHigher
            ? 'Review parent task priority. Consider aligning child with parent or adjusting parent priority upward.'
            : 'Review task priority. Ensure task is appropriate for its current level in hierarchy.',
        },
        createdAt: new Date(),
      };
    }

    // No misalignment detected (threshold not exceeded)
    return null;
  }

  /**
   * FR1.2: Strategic Alignment Misalignment
   * Detect when a task linked to a strategic initiative has a priority that
   * significantly deviates from the initiative's defined priority.
   */
  private async checkStrategicMisalignment(
    task: any,
    childPriority: PriorityLevel,
    rule: any,
    taskId: number
  ): Promise<MisalignmentCheck | null> {
    // Find parent initiative if task is part of PMO spine
    // Tasks in PMO spine have parent_id pointing to epics, which can be under initiatives
    const parentEpic = await this.db.tasks.findUnique({
      where: { id: task.parent_id },
      include: {
        linked_initiatives: true,
        linked_objectives: true,
      },
    });

    if (!parentEpic?.linked_objectives?.length && !parentEpic?.linked_initiatives?.length) {
      return {
        taskId,
        ruleId: rule.id,
        type: rule.type,
        severity: rule.severity,
        detachedReason: 'Not linked to strategic initiative/OKR',
        details: {
          reason: 'Task not linked to strategic objectives',
          childPriority,
          deviation: 0,
        },
        createdAt: new Date(),
      };
    }

    // Calculate expected priority from strategic layer (highest OKR/initiative takes precedence)
    const linkedItems: any[] = [
      ...(parentEpic?.linked_objectives || []),
      ...(parentEpic?.linked_initiatives || []),
    ];

    // Find the highest priority among linked items
    const linkedItemsWithPriority = linkedItems
      .map((item) => ({
        id: item.id,
        priority: item.priority as PriorityLevel,
        title: item.title,
      }))
      .filter((item) => item.priority);

    if (linkedItemsWithPriority.length === 0) {
      return {
        taskId,
        ruleId: rule.id,
        type: rule.type,
        severity: rule.severity,
        detachedReason: 'Strategic items have no defined priority',
        details: {
          reason: 'Linked objectives/initiatives lack priority values',
          childPriority,
          deviation: 0,
        },
        createdAt: new Date(),
      };
    }

    const highestLinkedPriority = linkedItemsWithPriority.reduce((max, item) =>
      PriorityWeight[item.priority] > PriorityWeight[max.priority] ? item : max
    ).priority;

    const childWeight = PriorityWeight[childPriority];
    const expectedWeight = PriorityWeight[highestLinkedPriority];
    const deviation = Math.abs(childWeight - expectedWeight);

    if (deviation > rule.threshold) {
      const direction = childWeight > expectedWeight ? 'higher' : 'lower';
      return {
        taskId,
        ruleId: rule.id,
        type: rule.type,
        severity: rule.severity,
        details: {
          reason: `Task priority (${childPriority}) is ${direction} than strategic item priority (${highestLinkedPriority})`,
          parentPriority: highestLinkedPriority,
          childPriority,
          deviation,
          expected: highestLinkedPriority,
          actionableHint: 'Align task priority with strategic objective initiative priority to ensure resources focus on the most impactful work.',
        },
        createdAt: new Date(),
      };
    }

    return null;
  }

  /**
   * FR1.3: Dependency Misalignment
   * Detect when a task that is blocked by another task has a lower priority than
   * its blocker, or vice-versa.
   */
  private async checkDependencyMisalignment(
    task: any,
    childPriority: PriorityLevel,
    rule: any,
    taskId: number
  ): Promise<MisalignmentCheck | null> {
    // Check blocking tasks (tasks where this task is blocked)
    const blockedBy = await this.db.task_dependencies.findMany({
      where: {
        blocked_task_id: taskId,
      },
      include: {
        blocking_task: {
          select: {
            id: true,
            priority: true,
          },
        },
      },
    });

    if (blockedBy.length === 0) {
      return {
        taskId,
        ruleId: rule.id,
        type: rule.type,
        severity: rule.severity,
        detachedReason: 'Task is not blocked by any other task',
        details: {
          reason: 'No dependencies - cannot assess dependency rules',
          childPriority,
          deviation: 0,
        },
        createdAt: new Date(),
      };
    }

    const ownerSecurityCheckResult: any = { severity: 'warning' };

    for (const dep of blockedBy) {
      const blockingTask = dep.blocking_task;
      if (!blockingTask?.priority) continue;

      const blockerPriority = blockingTask.priority as PriorityLevel;
      const childWeight = PriorityWeight[childPriority];
      const blockerWeight = PriorityWeight[blockerPriority];
      const deviation = Math.abs(childWeight - blockerWeight);

      if (deviation > rule.threshold) {
        // Check if violation is in the wrong direction
        const isWrongDirection = childWeight < blockerWeight; // Should NOT have lower priority than blocker
        const direction = isWrongDirection ? 'lower' : 'higher';

        return {
          taskId,
          ruleId: rule.id,
          type: rule.type,
          severity: rule.severity,
          details: {
            reason: `Blocked task (${childPriority}) is ${direction} than its blocker (${blockerPriority})`,
            blockerPriority,
            childPriority,
            deviation,
            actionableHint: isWrongDirection
              ? 'Request that the blocker be resolved or assigned higher priority before you proceed. Consider escalating if the blocker is blocking critical work.'
              : 'Review if this task should have higher priority. Blocking task may need attention.',
          },
          createdAt: new Date(),
        };
      }
    }

    return null;
  }

  /**
   * Check all tasks for a project (batch operation for performance)
   */
  async checkProjectTasks(
    projectId: number,
    limit: number = 100
  ): Promise<MisalignmentCheck[]> {
    const tasks = await this.db.tasks.findMany({
      where: { project_id: projectId },
      take: limit,
    });

    const checks: MisalignmentCheck[] = [];
    for (const task of tasks) {
      const result = await this.checkTask(task.id, projectId);
      checks.push(...result.checks);
    }

    return checks;
  }

  /**
   * Get task misalignment state (aggregated view)
   */
  async getTaskMisalignmentState(taskId: number): Promise<any> {
    const ruleIds = [];
    let totalSeverity: 'warning' | 'error' = 'warning';
    let hasMisalignment = false;
    const issues: any[] = [];

    const rules = await this.db.misalignment_rules.findMany({
      where: { enabled: true },
      orderBy: { createdAt: 'asc' },
    });

    for (const rule of rules) {
      const ruleProjectId = rule.projectId ?? null;
      const result = await this.checkTask(taskId, ruleProjectId);

      if (result?.checks?.length) {
        const check = result.checks[0]; // One check per rule
        ruleIds.push(check.ruleId);
        totalSeverity = check.severity;
        hasMisalignment = true;
        issues.push(check);
      }
    }

    return {
      taskId,
      hasMisalignment,
      ruleIds,
      totalSeverity,
      issues,
    };
  }
}

/**
 * Helper function to create detailed explanation strings
 * Uses the i18n pattern observed in the repo (e.g., translate in frontend)
 */
export function explainMisalignment(
  type: string,
  details: MisalignmentDetails
): string {
  return details.reason;
}

export function generateActionableHint(
  type: string,
  details: MisalignmentDetails
): string | undefined {
  return details.actionableHint;
}