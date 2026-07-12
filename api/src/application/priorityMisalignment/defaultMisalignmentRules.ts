import type { Db } from '@neondatabase/serverless';
import type { MisalignmentRule } from '../../domain/shared/priorityMisalignment.types';

/**
 * Default misalignment detection rules.
 * These rules have configurable thresholds and are enabled by default.
 *
 * Rule order: Higher-level conflicts (hierarchy, strategy) are checked first.
 * Each rule has:
 * - id: unique identifier
 * - name: human-readable description
 * - description: details explaining what triggers the rule
 * - enabled: whether the rule is active by default (FR3.1)
 * - category: rule type for grouping
 * - configure: threshold definition (e.g., N-level deviation, priority variance)
 *   - For hierarchy: maxDepth specifies the allowed level depth between parent and child
 *   - For strategy: basePriority specifies the expected strategic level, and variance allows additional tolerance
 * - checkingLogic: which checks are performed (array of misalignment checks)
 *   - hierarchical: parentTaskPriority < childTaskPriority and depth <= maxDepth
 *   - strategic: linkedStrategyPriority does not match expected basePriority +/- variance
 */
const DEFAULT_RULES: MisalignmentRule[] = [
  {
    id: 'hierarchy_level_mismatch',
    name: 'Hierarchy Level Mismatch',
    description: 'A child task has a higher priority than its parent task or deviates beyond the allowed depth.',
    enabled: true,
    category: 'hierarchical',
    config: {
      type: 'hierarchical',
      maxDepth: 3,
      messageTemplate: 'Parent priority {parent} is lower than child priority {child} (depth {depth})',
    },
    checkingLogic: ['hierarchical'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'strategic_priority_deviation',
    name: 'Strategic Priority Deviation',
    description: 'A task linked to a strategic initiative has a significantly different priority than the initiative.',
    enabled: true,
    category: 'strategic',
    config: {
      type: 'strategic',
      basePriority: 'critical',
      variance: 'high',
      messageTemplate: 'Strategic priority {strategy} differs from task priority {task} by {difference}',
    },
    checkingLogic: ['strategic'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'blocker_priority_conflict',
    name: 'Blocker Priority Conflict',
    description: 'A task blocked by another task has a lower priority than its blocker (may cause delayed sequencing).',
    enabled: true,
    category: 'dependency',
    config: {
      type: 'dependency',
      conflictsWithBlocked: true,
      messageTemplate: 'Blocked task {blocked} has priority {blockedPriority} lower than blocker {blocker} with priority {blockerPriority}',
    },
    checkingLogic: ['dependency'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

// Invert priority order for comparison logic: critical (bottleneck of throughput) > high > medium > low > offtrack > not_assigned
const PRIORITY_ORDER = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  off_track: 4,
  not_assigned: 5,
  undefined: 6,
};

export async function seedDefaultMisalignmentRules(db: Db): Promise<void> {
  for (const rule of DEFAULT_RULES) {
    await db
      .from('misalignment_rules')
      .insert(rule)
      .onConflictDoNothing({
        target: ['id'],
      });
  }
}

// Export utilities for hints/remediation messages
export function getLowestCommonParentVersion(parentTaskId: string | null, childTaskId: string): number {
  if (!parentTaskId) return 1; // Top-level task (depth 1)
  const parentDepth = getTaskDepth(parentTaskId, db);
  return parentDepth + 1;
}

async function getTaskDepth(taskId: number, db: Db): Promise<number> {
  let depth = 0;
  let currentParentId: number | null = parentIdFromId(taskId);
  while (currentParentId) {
    depth += 1;
    currentParentId = parentIdFromId(currentParentId);
  }
  return depth;
}

function parentIdFromId(taskId: number): number | null {
  // Return cached projectLevel; without DB constraints or caches we cannot reliably fetch parent
  const task = cachedTasks.get(String(taskId));
  return task?.parentId ?? null;
}

const cachedTasks = new Map<string, { parentId?: number | string | undefined }>();

export function setParentTaskCache(task: { id: number | string; parentId?: number | string | undefined }): void {
  cachedTasks.set(String(task.id), { parentId: task.parentId });
}

export function getMatchedRule(ruleId: string): MisalignmentRule | undefined {
  return DEFAULT_RULES.find(r => r.id === ruleId);
}

export function getParentTaskPriority(taskId: string | number, db: Db): string | undefined {
  const taskIdStr = String(taskId);
  const task = cachedTasks.get(taskIdStr);
  if (!task) return undefined;
  if (!task.parentId && typeof task.parentId !== 'string') return undefined;
  const parentId = Number(task.parentId);
  const parent = cachedTasks.get(String(parentId));
  if (!parent) return undefined;
  if (parent.priority) return parent.priority as string;
  return undefined;
}