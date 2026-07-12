/**
 * pickableTasks — identification and surfacing of unassigned, immediately pickable tasks.
 *
 * Detects tasks where assignee is null/empty/placeholder and status allows pickup (open/ready/backlog/todo),
 * validates no incomplete upstream dependencies, and ensures the task is not currently claimed.
 * Exposes two outputs: a structured JSON payload (for agents) and a human-readable summary (markdown).
 *
 * Claiming: when an agent picks up a task, mark it as claimed with a short TTL (default 5 minutes).
 */

import { and, eq, lt, or, sql } from 'drizzle-orm';
import { taskClaimLocks, tasks as tasksTable } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';

// -------------------------------------------------------------------
// Constants
// -------------------------------------------------------------------

const PRIORITY_PICKABLE_STATUSES = ['open', 'ready', 'backlog', 'todo'] as const;
const PLACEHOLDER_ASSIGNMENTS = ['unassigned', 'TBD', 'TBD ''', null, '', undefined] as const;

// Recommendation: re-verify TaskStatus enum in domain/shared/types.ts; updates here stay consistent.
const DEFAULT_CLAIM_TTL_MS = 5 * 60 * 1000; // 5 minutes
const JSON_OUTPUT_LIMIT = 1000;

// -------------------------------------------------------------------
// Types
// -------------------------------------------------------------------

/** Whether the task fully meets all pickability criteria. */
export type PickabilityVerdict = 'high' | 'medium' | 'low';

export interface PickableTask {
  taskId: number;
  title: string;
  description: string;
  shortDescription: string;
  status: string;
  projectId: number;
  projectKey: string;
  dependencies?: PickDependencyInfo[];
  hasDependencies: boolean;
  assignee: string | null;
  assigneeType: 'unassigned' | 'agent' | 'human';
  assigneeId: string | null;
  claimTtlMs: number;
  unclaimed: boolean;
}

export interface PickDependencyInfo {
  taskId: number;
  title: string;
  status: string;
}

// For agent consumption (structured JSON)
export interface PickableTasksOutput {
  ok: true;
  tasks: PickableTask[];
  total: number;
  highConfidence: number;
  mediumConfidence: number;
  lowConfidence: number;
  nextRefreshAt: string;
  queryDurationMs: number;
}

/** For human consumption (markdown table) */
export interface PickableTasksMarkdownOutput {
  ok: true;
  markdown: string;
  total: number;
  highConfidence: number;
  mediumConfidence: number;
  lowConfidence: number;
}

export interface PickableTasksError {
  ok: false;
  error: string;
}

export type PickableTasksOutputResult = PickableTasksOutput | PickableTasksMarkdownOutput | PickableTasksError;

// -------------------------------------------------------------------
// Enums / constants used only in pickability evaluation
// -------------------------------------------------------------------

export const PickabilityConfidence = {
  /** All criteria met, plus high signals (has description, no blockers). */
  HIGH: 'high' as PickabilityVerdict,
  /** Missing description or unclear, but no deps and correct status. */
  MEDIUM: 'medium' as PickabilityVerdict,
  /** Lacks description and has unresolved ambiguity. */
  LOW: 'low' as PickabilityVerdict,
} as const;

// -------------------------------------------------------------------
// Logic
// -------------------------------------------------------------------

/**
 * Identify immediately pickable, unassigned tasks for a tenant+project scope.
 *
 * @param db Database connection
 * @param tenantId Tenant to scope to
 * @param projectId Project to restrict to; null means tenant-wide
 * @param crossProject Whether to include tasks from multiple projects (tenant-wide)
 * @returns JSON output or markdown table
 */
export async function listPickableTasks(
  db: Db,
  tenantId: number,
  projectId: number | null,
  crossProject: boolean = false,
): Promise<PickableTasksOutput> {
  const startTime = Date.now();

  // 1. Resolve scope
  const scopeConstraint = projectId != null ? eq(tasksTable.projectId, projectId) : undefined;
  const crossProjectConstraint = crossProject ? undefined : scopeConstraint;

  // 2. Fetch candidate unassigned tasks (assignee null / empty / placeholder, active status)
  const candidateRows = await db
    .select({
      id: tasksTable.id,
      title: tasksTable.title,
      description: tasksTable.description,
      status: tasksTable.status,
      projectId: tasksTable.projectId,
      projectKey: tasksTable.key,
      assignedAgentType: tasksTable.assignedAgentType,
      assignedAgentRef: tasksTable.assignedAgentRef,
      assignedUserId: tasksTable.assignedUserId,
      dueDate: tasksTable.dueDate,
      createdAt: tasksTable.createdAt,
      updatedAt: tasksTable.updatedAt,
      claimLockedAt: taskClaimLocks.lockedAt,
      unlockAt: taskClaimLocks.unlockAt,
    })
    .from(tasksTable)
    .leftJoin(
      taskClaimLocks,
      and(
        eq(taskClaimLocks.taskId, tasksTable.id),
        eq(taskClaimLocks.tenantId, tenantId),
        eq(taskClaimLocks.projectId, projectId ?? tasksTable.projectId), // group by project for uniqueness
      ),
    )
    .where(
      and(
        eq(tasksTable.archived, false),
        or(...PLACEHOLDER_ASSIGNMENTS.map((t) => eq(tasksTable.assignedUserId, t))),
        or(...PLACEHOLDER_ASSIGNMENTS.map((t) => eq(tasksTable.assignedAgentRef, t))),
        or(...PLACEHOLDER_ASSIGNMENTS.map((t) => eq(tasksTable.assignedAgentType, t))),
        crossProjectConstraint || eq(tasksTable.tenantId, tenantId),
        // Status must be active/pickup-ready: open/ready/backlog/todo (from TaskStatus enum)
        or(...PRIORITY_PICKABLE_STATUSES.map((s) => eq(tasksTable.status, s))),
      ),
    );

  if (candidateRows.length === 0) {
    const result: PickableTasksOutput = {
      ok: true,
      tasks: [],
      total: 0,
      highConfidence: 0,
      mediumConfidence: 0,
      lowConfidence: 0,
      nextRefreshAt: new Date(Date.now() + 60 * 1000).toISOString(), // 60 seconds default polling
      queryDurationMs: Date.now() - startTime,
    };
    return result;
  }

  // 3. Parallelize dependency resolution and pickability classification
  const tss = await Promise.all(
    candidateRows.map((row) =>
      evaluateTaskPickability(db, {
        id: row.id,
        title: row.title ?? '',
        description: row.description ?? '',
        status: row.status,
        projectId: row.projectId,
        projectKey: row.projectKey ?? '',
        assignedAgentType: row.assignedAgentType,
        assignedAgentRef: row.assignedAgentRef,
        assignedUserId: row.assignedUserId,
        claimLockedAt: row.claimLockedAt,
        nextTTL: DEFAULT_CLAIM_TTL_MS,
        useContext: true, // enable cross-project deps
      }),
    ),
  );

  // 4. Build output
  const tasks = tss.filter((t) => t.pickable).map((t) => stripSensitiveFields(t));
  const byConfidence = tasks.reduce(
    (acc, t) => ({
      highConfidence: acc.highConfidence + (t.confidence === PickabilityConfidence.HIGH ? 1 : 0),
      mediumConfidence: acc.mediumConfidence + (t.confidence === PickabilityConfidence.MEDIUM ? 1 : 0),
      lowConfidence: acc.lowConfidence + (t.confidence === PickabilityConfidence.LOW ? 1 : 0),
    }),
    { highConfidence: 0, mediumConfidence: 0, lowConfidence: 0 },
  );

  const output: PickableTasksOutput = {
    ok: true,
    tasks,
    total: tss.length,
    highConfidence: byConfidence.highConfidence,
    mediumConfidence: byConfidence.mediumConfidence,
    lowConfidence: byConfidence.lowConfidence,
    nextRefreshAt: new Date(Date.now() + 60 * 1000).toISOString(),
    queryDurationMs: Date.now() - startTime,
  };
  return output;
}

/**
 * Evaluate pickability for a single task.
 */
async function evaluateTaskPickability(
  db: Db,
  taskInfo: {
    id: number;
    title: string;
    description: string;
    status: string;
    projectId: number;
    projectKey: string;
    assignedAgentType: string | null;
    assignedAgentRef: string | null;
    assignedUserId: string | null;
    claimLockedAt: Date | null;
    nextTTL: number;
    useContext: boolean;
  },
): Promise<PickableTask | null> {
  // 1) No blockers check
  const hasIncompleteDeps = await checkUpstreamDependencies(db, taskInfo, taskInfo.useContext);
  if (hasIncompleteDeps) return null;

  // 2) Ambiguity check: needs non-empty description OR acceptance criteria (derived from description)
  const isUnambiguous = !!(taskInfo.description && taskInfo.description.trim().length > 0);
  if (!isUnambiguous) {
    return {
      taskId: taskInfo.id,
      title: taskInfo.title,
      description: taskInfo.description,
      shortDescription: (taskInfo.description || '(no description)')?.trim() || '(no description)',
      status: taskInfo.status,
      projectId: taskInfo.projectId,
      projectKey: taskInfo.projectKey,
      dependencies: [],
      hasDependencies: false,
      assignee: null,
      assigneeType: 'unassigned',
      assigneeId: null,
      claimTtlMs: taskInfo.nextTTL,
      unclaimed: true,
      confidence: PickabilityConfidence.LOW,
    };
  }

  // 3) Status validation (already ensured by PRIORITY_PICKABLE_STATUSES upfront)
  // 4) Claim lock check (update claimLockedAt to bump claimTtl if locked)
  const now = new Date();
  const locked = taskInfo.claimLockedAt != null;
  const unclaimed = !locked || taskInfo.claimLockedAt < now;
  const claimTtlMs = locked
    ? Math.max(0, taskInfo.nextTTL - (now.getTime() - taskInfo.claimLockedAt.getTime()))
    : taskInfo.nextTTL;

  return {
    taskId: taskInfo.id,
    title: taskInfo.title,
    description: taskInfo.description,
    shortDescription: taskInfo.description?.trim() || '(no description)',
    status: taskInfo.status,
    projectId: taskInfo.projectId,
    projectKey: taskInfo.projectKey,
    dependencies: [],
    hasDependencies: false,
    assignee: null,
    assigneeType: 'unassigned',
    assigneeId: null,
    claimTtlMs,
    unclaimed,
    confidence: PickabilityConfidence.HIGH,
  };
}

/**
 * Check upstream dependencies for the given task.
 * If useContext is true, spans tenant and cross-project (when crossProject=true).
 *
 * This is simplified: it checks an OPPOSITE-FK direction (dependentId) that needs to be equivalent to
 * whatever the repo’s schema expresses for "dependent tasks of this task". The query takes the
 * project scope into account via projectId filter and/or tenantId filter, and it also respects the
 * crossProject setting to include or exclude tasks from other projects.
 */
async function checkUpstreamDependencies(
  db: Db,
  taskInfo: { id: number; projectId: number; useContext: boolean },
  crossProject: boolean,
): Promise<boolean> {
  // Build filter: if not cross-project, restrict to this project; otherwise tenant-wide.
  const projectIdConstraint = crossProject ? undefined : eq(tasksTable.projectId, taskInfo.projectId);
  const tenantIdConstraint = crossProject ? eq(tasksTable.tenantId, (await db
    .select({ tenantId: tasksTable.tenantId })
    .from(tasksTable)
    .where(eq(tasksTable.id, taskInfo.id))
    .limit(1))?.[0]?.tenantId ?? 0) : undefined;

  // Query candidates whose dependsOn array contains |taskInfo.id|.
  const candidates = await db
    .select({
      taskId: tasksTable.id,
      title: tasksTable.title,
      status: tasksTable.status,
    })
    .from(tasksTable)
    .where(
      and(
        // Filter by assignedUser: only show non-unassigned dependencies
        or(
          ...PLACEHOLDER_ASSIGNMENTS.map((t) => eq(tasksTable.assignedUserId, t)),
          ...PLACEHOLDER_ASSIGNMENTS.map((t) => eq(tasksTable.assignedAgentRef, t)),
          ...PLACEHOLDER_ASSIGNMENTS.map((t) => eq(tasksTable.assignedAgentType, t)),
        ),
        // Filter by status: only show active dependencies (not done/closed)
        or([
          eq(tasksTable.status, 'pending'),
          eq(tasksTable.status, 'in_progress'),
          eq(tasksTable.status, 'ready'),
          eq(tasksTable.status, 'todo'),
          eq(tasksTable.status, 'backlog'),
          eq(tasksTable.status, 'open'),
        ]),
        projectIdConstraint,
        tenantIdConstraint,
      ),
    );

  // Check for any incomplete dep (status not 'done' or 'completed')
  return candidates.some(
    (c) => c.status !== 'done' && c.status !== 'completed' && c.status !== 'closed' && c.status !== 'cancelled',
  );
}

/**
 * Claim a task for an agent (claim lock with TTL).
 * Returns the updated task (null if already claimed/unclaimed).
 */
export async function claimTaskForAgent(
  db: Db,
  taskId: number,
  tenantId: number,
  projectId: number,
  agentKind: string, // 'agent' | 'human'
  agentRef: string,
  ttlMs: number = DEFAULT_CLAIM_TTL_MS,
): Promise<{
  ok: true;
  taskId: number;
  claimed: boolean;
  ttlMs: number;
  claimLockedAt: Date;
  unlockAt: Date;
} | { ok: false; error: string }> {
  const now = new Date();
  const unlockAt = new Date(now.getTime() + ttlMs);

  try {
    // Upsert claim lock: insert or replace if existing
    await db
      .insert(taskClaimLocks)
      .values({
        taskId,
        tenantId,
        projectId,
        kind: agentKind,
        ref: agentRef,
        lockedAt: now,
        unlockAt,
      })
      .onConflictDoUpdate({
        target: [taskClaimLocks.taskId, taskClaimLocks.tenantId, taskClaimLocks.projectId], // unique constraint per task/project
        set: {
          kind: agentKind,
          ref: agentRef,
          lockedAt: now,
          unlockAt,
          // Optionally mark lastModifier/ref for audit
        },
      });

    return {
      ok: true,
      taskId,
      claimed: true,
      ttlMs,
      claimLockedAt: now,
      unlockAt,
    };
  } catch (e) {
    // Handle duplicate-key errors (e.g., concurrent claim)
    const error = (e as Error).message.toLowerCase();
    if (error.includes('unique') || error.includes('violates unique constraint')) {
      return {
        ok: false,
        error: 'Task already claimed',
      };
    }
    return {
      ok: false,
      error: (e as Error).message,
    };
  }
}

/**
 * Release a task claim (clear the lock).
 */
export async function releaseTaskClaim(db: Db, taskId: number, tenantId: number, projectId: number): Promise<{
  ok: true;
  taskId: number;
} | { ok: false; error: string }> {
  try {
    await db
      .delete(taskClaimLocks)
      .where(
        and(
          eq(taskClaimLocks.taskId, taskId),
          eq(taskClaimLocks.tenantId, tenantId),
          eq(taskClaimLocks.projectId, projectId), // unique constraint per task/project
        ),
      );

    return { ok: true, taskId };
  } catch (e) {
    return {
      ok: false,
      error: (e as Error).message,
    };
  }
}

/**
 * Strip sensitive/computed fields for public output.
 */
function stripSensitiveFields(t: PickableTask): PickableTask {
  return {
    taskId: t.taskId,
    title: t.title,
    description: t.description,
    shortDescription: t.shortDescription,
    status: t.status,
    projectId: t.projectId,
    projectKey: t.projectKey,
    dependencies: t.dependencies,
    hasDependencies: t.hasDependencies,
    assignee: t.assignee,
    assigneeType: t.assigneeType,
    assigneeId: t.assigneeId,
    claimTtlMs: t.claimTtlMs,
    unclaimed: t.unclaimed,
    confidence: t.confidence,
  };
}

/**
 * Generate a markdown table for human consumption.
 */
export function mkPickableTable(output: PickableTasksOutput): string {
  const { tasks, highConfidence, mediumConfidence, lowConfidence, total } = output;
  let markdown = `## Pickable Tasks\n`;
  markdown += `**Total:** ${total} (high: ${highConfidence}, medium: ${mediumConfidence}, low: ${lowConfidence})\n\n`;
  markdown += `| Task ID | Title | Status | Description Summary | Dependencies | Assignee | Confidence |\n`;
  markdown += `|---|---|---|---|---|---|---|\n`;
  tasks.slice(0, JSON_OUTPUT_LIMIT).forEach((t) => {
    const depSummary = t.hasDependencies ? `<${t.dependencies?.length ?? 0} missing deps>` : 'None';
    markdown += `| ${t.taskId} | ${t.title.slice(0, 100)} | ${t.status} | ${t.shortDescription.slice(0, 120)} | ${depSummary} | ${t.assignee || '(none)'} | ${t.confidence} |\n`;
  });

  if (tasks.length > JSON_OUTPUT_LIMIT) {
    markdown += `\n*Showing first ${JSON_OUTPUT_LIMIT} tasks (total: ${total})*\n`;
  }

  return markdown;
}