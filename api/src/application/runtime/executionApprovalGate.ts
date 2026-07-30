/**
 * Execution approval gate — the ONE governance check that decides whether a task
 * may start a (billable) agent run right now, or must first be approved by a human.
 *
 * Extracted from `presentation/routes/runtimeRoutes.ts` (where it was route-private)
 * so EVERY dispatch entry point can apply it — including the ones with no HTTP
 * request and no user principal at all (the autonomous lane trigger, the cron
 * execution sweep, the CI auto-fix loop). Those callers previously bypassed the
 * gate entirely: a high/urgent ticket that a human could not run without manager
 * sign-off would run anyway the moment a lane trigger picked it up.
 *
 * Application layer on purpose: it depends only on `Db` + drizzle, never on Hono,
 * so a system caller can use it without fabricating a request context.
 */
import { and, desc, eq } from 'drizzle-orm';
import { approvals, boards } from '../../infrastructure/database/schema';
import { parseActAsRole } from './cloudDispatch';
import type { Db } from '../../infrastructure/database/connection';

/**
 * The minimum a task must expose for the gate to rule on it. A structural subset
 * of the runtime's `ExecutionTaskRow`, so route callers pass their row unchanged.
 */
export interface ApprovalGateTask {
  id: number;
  title: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  projectId: number;
  /** Host pinned on the ticket, if any — recorded so an approve replays host targeting. */
  assignedAgentHostId: number | null;
}

export type ExecutionApprovalGateResult =
  | { allowed: true }
  | {
      allowed: false;
      approvalId: string;
      status: 'pending';
      reason: string;
    };

/** Run context replayed when a `task.execution` approval is approved. */
export interface ApprovalReplay {
  taskId: number;
  /** The original submit payload (carries the cloud-agent ref + model + repo pin). */
  payload?: string;
  /** A per-run pinned host, if the gated run targeted one. */
  agentHostId?: number | null;
}

/** The `taskId` a `task.execution` approval was opened for, or null. */
export function parseApprovalTaskId(metadata: string | null): number | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata) as { taskId?: unknown };
    const value = parsed.taskId;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const n = Number(value);
      if (Number.isFinite(n)) return n;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Read the stored run context off a `task.execution` approval so approving it can
 * replay the original submit AS the same agent + model — the gate discards no run
 * detail (see {@link evaluateExecutionApprovalGate}). Returns null for approvals
 * without a parseable taskId (non-task.execution rows).
 */
export function parseApprovalReplay(metadata: string | null): ApprovalReplay | null {
  const taskId = parseApprovalTaskId(metadata);
  if (taskId == null || !metadata) return null;
  try {
    const parsed = JSON.parse(metadata) as { payload?: unknown; agentHostId?: unknown };
    const payload = typeof parsed.payload === 'string' ? parsed.payload : undefined;
    const agentHostId =
      typeof parsed.agentHostId === 'number' && Number.isFinite(parsed.agentHostId)
        ? parsed.agentHostId
        : null;
    return { taskId, payload, agentHostId };
  } catch {
    return { taskId };
  }
}

/**
 * Whether running this task must first open a manager-approval request.
 *
 * Only HIGH/URGENT priority tickets are gated. A manager can OVERRIDE the gate
 * per board (boards.require_execution_approval = false) so high/urgent work on
 * that board runs without approval — see the board "Require manager approval"
 * setting. The board flag is read directly (not cached) so flipping the toggle
 * takes effect on the very next run rather than after a cache TTL; it is a single
 * indexed lookup on the dispatch path, alongside the gate's own uncached
 * approvals query.
 */
export async function requiresTaskExecutionApproval(
  db: Db,
  tenantId: number,
  task: ApprovalGateTask,
): Promise<boolean> {
  if (task.priority !== 'high' && task.priority !== 'urgent') return false;

  const [board] = await db
    .select({ requireExecutionApproval: boards.requireExecutionApproval })
    .from(boards)
    .where(and(eq(boards.tenantId, tenantId), eq(boards.projectId, task.projectId)))
    .limit(1);

  // No board row yet → keep the default governance behaviour (gate on).
  return board?.requireExecutionApproval !== false;
}

/**
 * Decide whether `task` may run now, opening a pending `task.execution` approval
 * when it may not.
 *
 * Returns `{ allowed: true }` when the ticket isn't gated, or when a still-valid
 * approval already exists for it. Otherwise it REUSES an outstanding pending
 * request (never stacking duplicates) or creates one, and returns
 * `{ allowed: false, approvalId, reason }` — the caller must NOT dispatch.
 *
 * @param requestedBy Who asked for the run. An HTTP caller passes its `userId`; a
 *   system caller (lane trigger, cron sweep, CI auto-fix) passes its own
 *   `system:*` handle so the approval queue shows what actually asked.
 * @param submitContext The original submit payload, persisted on the approval so
 *   approving it replays the EXACT run (same agent + model + repo pin).
 */
export async function evaluateExecutionApprovalGate(
  db: Db,
  tenantId: number,
  requestedBy: string,
  task: ApprovalGateTask,
  requestedAgentHostId: number | null,
  submitContext?: { payload?: string },
): Promise<ExecutionApprovalGateResult> {
  if (!(await requiresTaskExecutionApproval(db, tenantId, task))) {
    return { allowed: true };
  }

  const now = new Date();
  const recentApprovals = await db
    .select({
      id: approvals.id,
      status: approvals.status,
      metadata: approvals.metadata,
      expiresAt: approvals.expiresAt,
      createdAt: approvals.createdAt,
    })
    .from(approvals)
    .where(
      and(
        eq(approvals.tenantId, tenantId),
        eq(approvals.actionType, 'task.execution'),
      ),
    )
    .orderBy(desc(approvals.createdAt))
    .limit(100);

  const latestForTask = recentApprovals.find((row) => parseApprovalTaskId(row.metadata) === task.id);
  if (latestForTask) {
    if (latestForTask.status === 'approved' && (!latestForTask.expiresAt || latestForTask.expiresAt > now)) {
      return { allowed: true };
    }
    if (latestForTask.status === 'pending' && (!latestForTask.expiresAt || latestForTask.expiresAt > now)) {
      return {
        allowed: false,
        approvalId: latestForTask.id,
        status: 'pending',
        reason: 'Task execution is waiting for manager approval.',
      };
    }
  }

  const approvalId = crypto.randomUUID();
  await db.insert(approvals).values({
    id: approvalId,
    tenantId,
    agentHostId: task.assignedAgentHostId ?? requestedAgentHostId,
    requestedBy,
    actionType: 'task.execution',
    description: `Approve execution of task #${task.id}: ${task.title}`,
    metadata: JSON.stringify({
      taskId: task.id,
      priority: task.priority,
      // Persist the run context so approving the request replays the exact run
      // (as the same cloud agent + model + repo pin) — see parseApprovalReplay.
      payload: submitContext?.payload ?? null,
      agentHostId: task.assignedAgentHostId ?? requestedAgentHostId,
      // When this run is role-attributed (a reviewer/producer dispatch), record the
      // role so a human APPROVAL of the gate records that role's sign-off (§5.8 bridge).
      roleKey: parseActAsRole(submitContext?.payload ?? null) ?? null,
    }),
    createdAt: now,
    updatedAt: now,
  });

  return {
    allowed: false,
    approvalId,
    status: 'pending',
    reason: 'Task priority requires manager approval before execution.',
  };
}
