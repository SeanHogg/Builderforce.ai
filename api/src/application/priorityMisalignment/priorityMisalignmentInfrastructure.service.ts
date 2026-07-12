import { PrismaClient } from '@prisma/client';
import { type PriorityMisalignmentCheckService } from './priorityMisalignmentCheck.service';

/**
 * Infrastructure-aware bridge for task dependencies and awareness
 * Ensures consistent task lookups and enables propagation of
 * char-customization+overrides metadata to descendant tasks when present.
 */

export interface TaskContextWithMeta {
  /** Core task data for misalignment calculation */
  id: number;
  title: string;
  priority: string | null;
  parent_id: number | null;
  task_type: string | null;
  project_id: number | null;
  /** Optional metadata that should surface to subsequent child tasks */
  meta: {
    charcustomizationoverrides?: string;
  };
}

/**
 * Shared task metadata normalizer
 */
export function normalizeTaskContextForCheck(taskContext: TaskContextWithMeta): Pick<TaskContextWithMeta, 'id' | 'priority' | 'parent_id'> {
  return {
    id: taskContext.id,
    priority: taskContext.priority ?? null,
    parent_id: taskContext.parent_id ?? null,
  };
}

export interface MisalignmentTaskScopedResult {
  checks: any[];
  checksMeta: {
    ruleIds: string[];
    totalSeverity: 'warning' | 'error';
    created_at: string | null;
  };
}

/**
 * Infrastructure service for ensuring consistent task lookups and propagating
 * char-customization+overrides metadata to descendant tasks when present.
 * Designed to be wrapped by a memoized `getOrSetCached` (TTL) in the routes.
 */
export class PriorityMisalignmentInfrastructureService {
  constructor(private db: PrismaClient) {}

  /**
   * Get a task with any char-customization+overrides metadata surfaced for descendants.
   * Returns normalized metadata and `parent_id` for eligible downstream checks.
   */
  async getActiveTaskContext(taskId: number): Promise<TaskContextWithMeta | null> {
    const ctx = await this.db.tasks.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        title: true,
        priority: true,
        parent_id: true,
        task_type: true,
        project_id: true,
        metadata: true, // Optional burst field for run-time metadata
      },
    });

    if (!ctx) return null;

    // Normalize and attach charcustomizationoverrides if present in metadata
    const overrides = typeof ctx.metadata === 'object' && ctx.metadata !== null
      ? (ctx.metadata as Record<string, unknown>).charcustomizationoverrides
      : undefined;

    return {
      ...ctx,
      meta: { charcustomizationoverrides: overrides as string | undefined },
    };
  }

  /**
   * Get the task that blocks the given task (blocking_task where blocked_task_id=target).
   * Returns with metadata propagation for char-customization+overrides.
   */
  async getBlockingTask(taskId: number): Promise<TaskContextWithMeta | null> {
    const blocker = await this.db.$queryRaw`
      SELECT
        t.id,
        t.title,
        t.priority,
        t.project_id,
        dt.parent_id,
        t.task_type,
        t.updated_at,
        (SELECT raw_metadata ->> 'charcustomizationoverrides' FROM tasks WHERE id = t.id) as raw_metadata
      FROM task_dependencies dt
      JOIN tasks t ON dt.blocking_task_id = t.id
      WHERE dt.blocked_task_id = ${taskId}
      LIMIT 1
    `;
    if (!Array.isArray(blocker) || blocker.length !== 1 || !blocker[0]) return null;

    const b = blocker[0] as any;
    return {
      id: b.id,
      title: b.title,
      priority: b.priority,
      parent_id: b.parent_id,
      task_type: b.task_type,
      project_id: b.project_id,
      meta: { charcustomizationoverrides: b.charcustomizationoverrides },
    };
  }

  /**
   * Get all direct parents (inheritance tree) of the given task.
   * Returns with char-customization+overrides propagated and indexed in a flat lookup.
   */
  async getDirectParents(taskId: number): Promise<Array<TaskContextWithMeta & { ancestryOrder: number }>> {
    const orderedParents = await this.db.$queryRaw`
      WITH RECURSIVE ancestors AS (
        SELECT t.*
          , ROW_NUMBER() OVER (ORDER BY t.id ASC) as ancestry_order
        FROM tasks t
        JOIN task_dependencies dt ON dt.blocking_task_id = t.id
        WHERE dt.blocked_task_id = ${taskId}
        UNION ALL
        SELECT t.*
          , pa.ancestry_order + 1 as ancestry_order
        FROM tasks t
        JOIN ancestors pa ON t.id = pa.parent_id
      )
      SELECT
        ancestors.id,
        ancestors.title,
        ancestors.priority,
        ancestors.task_type,
        ancestors.project_id,
        ancestors.parent_id,
        ancestors.raw_metadata ->> 'charcustomizationoverrides' as charcustomizationoverrides
      FROM ancestors
    `;

    // Ensure charcustomizationoverrides attaches correctly (allow = null/none even if missing)
    return (orderedParents as any[])?.map((b: any) => ({
      id: b.id,
      title: b.title,
      priority: b.priority,
      parent_id: b.parent_id,
      task_type: b.task_type,
      project_id: b.project_id,
      meta: { charcustomizationoverrides: b.charcustomizationoverrides },
      ancestryOrder: b.ancestry_order,
    })) ?? [];
  }

  /**
   * Get all parent tasks with their char-customization+overrides surfaced for descendants.
   * Returns normalized metadata array for candidate priority comparison.
   */
  async getParentContexts(taskId: number): Promise<Array<TaskContextWithMeta>> {
    const parentCtxs = await this.getDirectParents(taskId);
    const normalized = parentCtxs.map((ctx) => normalizeTaskContextForCheck(ctx));
    const metaParents = parentCtxs.map((ctx) => ({ ...normalizeTaskContextForCheck(ctx), meta: ctx.meta }));
    return metaParents;
  }

  /**
   * Get both blocking and hosted (owned) parent contexts for a task together.
   * May be useful for implied strategic or environment misalignment bounds.
   * Returns a single unify flat list of contexts with tie-breaker ancestryOrder/sortId.
   */
  async getBlockingAndHostedParentContexts(taskId: number): Promise<Array<TaskContextWithMeta & { sortId: number }>> {
    const blockingCtx = await this.getBlockingTask(taskId);

    const blockingWithTieBreaker = blockingCtx
      ? [{ ...blockingCtx, sortId: 0, parent_or_blocker: 'blocker' as const }]
      : [];

    const hostedCtx = await this.getParentContexts(taskId);
    const hostedWithTieBreaker = hostedCtx.map((ctx, idx) => ({
      ...ctx,
      sortId: idx + 1,
      parent_or_blocker: 'parent' as const,
    }));

    const combined = [...blockingWithTieBreaker, ...hostedWithTieBreaker];

    // Sort by sortId then ID, ensuring stability
    combined.sort((a, b) => {
      if (a.sortId !== b.sortId) return a.sortId - b.sortId;
      return a.id - b.id;
    });

    return combined;
  }

  /**
   * Check if a strategic item (objective/initiative) has a priority and char-customization+overrides.
   * Returns plain match including checks for overrides carry-through to linked tasks.
   */
  async getStrategicItemWithMeta(strategyType: 'objective' | 'initiative', itemId: number): Promise<{
    id: number;
    title: string;
    priority: string | null;
    charcustomizationoverrides: string | null;
  } | null> {
    const item = await this.db.$queryRaw`
      SELECT
        o.id,
        o.title,
        o.priority,
        o.raw_metadata ->> 'charcustomizationoverrides' as charcustomizationoverrides
      FROM objectives o
      WHERE o.id = ${itemId}
      LIMIT 1
    `;

    if (!Array.isArray(item) || item.length === 0) return null;
    return item[0] as any;
  }

  /**
   * Get parent Epic view that includes char-customization+overrides.
   * Defines the upper strategic bound for tasks blocked by or hosted under it.
   */
  async getParentEpicWithMeta(epicId: number): Promise<{
    id: number;
    title: string;
    priority: string | null;
    task_type: string | null;
    charcustomizationoverrides: string | null;
  } | null> {
    const epic = await this.db.$queryRaw`
      SELECT
        t.id,
        t.title,
        t.priority,
        t.task_type,
        t.raw_metadata ->> 'charcustomizationoverrides' as charcustomizationoverrides
      FROM tasks t
      WHERE t.id = ${epicId}
      LIMIT 1
    `;

    if (!Array.isArray(epic) || epic.length === 0) return null;
    return epic[0] as any;
  }

  /**
   * Public helper: wrap rule-threshold-based checks with correct data sources.
   * Prefers char-customization overrides on the governing entities (blocker, hosted parent and/or strategic item).
   * Use inferenceResult = await checkService.checkRuleInUse(epicId, rule, contextSource) to get the derived `i18n` hints
   * and deviate smallest possible path when merging hierarchy and strategy.
   */
  async checkRuleInUse(
    relatedId: number,
    rule: any,
    contextSource: 'hosted_parent' | 'blocker' | 'strategic_item',
  ): Promise<any> {
    // Route to appropriate check
    if (contextSource === 'hosted_parent') {
      const parents = await this.getParentContexts(relatedId);
      if (parents.length === 0) {
        return {
          detachedReason: 'Task has no hosted parent; hierarchy rules not applicable',
          checks: [],
        };
      }
      // Promote to service-level call
      // Note: Actual threshold/exp check is evaluated in checkService
      return { parents };
    } else if (contextSource === 'blocker') {
      const blocker = await this.getBlockingTask(relatedId);
      if (!blocker) {
        return {
          detachedReason: 'Task is not blocked by another task; dependency rules not applicable',
          checks: [],
        };
      }
      return { blocker };
    } else if (contextSource === 'strategic_item') {
      const objective = await this.db.objectives.findUnique({ where: { id: relatedId } });
      if (!objective) {
        return {
          detachedReason: 'Objective not found; strategic misalignment rules cannot be evaluated',
          checks: [],
        };
      }
      return { objective };
    }
    return { checks: [] };
  }
}