/**
 * QaFindingRouter — the one place a captured Agentic-Tester finding turns into a
 * board task, and (when a project opts in) gets routed straight to a fix agent.
 *
 * Before this, the finding → task → fix-agent path was split and partly manual:
 * the task body + severity→priority mapping lived inline in the
 * `POST /findings/:id/task` handler, and a finding only ever reached an agent if a
 * human clicked "Create task" and then dragged the ticket into a staffed lane — so
 * findings "landed in the backlog" (the QA gap). This service centralises:
 *
 *   • {@link buildFindingTaskDraft} — pure title/description/priority for a finding.
 *   • {@link QaFindingRouter.createTaskFromFinding} — open the board task + link the
 *     finding (the shared core of BOTH the manual endpoint and the auto-route path).
 *   • {@link QaFindingRouter.resolveAutoFixLaneKey} — the lane an auto-routed ticket
 *     enters (explicit policy lane, else the first staffed non-human lane).
 *
 * The actual auto-run dispatch stays in the route layer (it owns `env` +
 * `runtimeService` + the canonical `maybeAutoRunOnLaneEntry` trigger) — this
 * service does the data work and hands back the task so the route can move it into
 * the fix lane and fire the SAME trigger a board drag uses. No new dispatch path.
 */

import { and, asc, desc, eq, isNotNull, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { TaskService } from '../task/TaskService';
import type { Task } from '../../domain/task/Task';
import { TaskPriority, TaskStatus, TaskType } from '../../domain/shared/types';
import {
  boards,
  qaFindings,
  swimlaneAgentAssignments,
  swimlanes,
  tasks,
} from '../../infrastructure/database/schema';
import type { QaFindingSeverity } from './qaTypes';
import type { Env } from '../../env';
import { onTaskLandedInLane } from '../swimlane/laneEntryTrigger';

/** Severity ordering — higher is worse. The single source of truth for both the
 *  routing threshold and any severity-weighted quality scoring. */
export const SEVERITY_RANK: Record<QaFindingSeverity, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

/** Coerce an arbitrary stored severity string to a known rank (unknown → medium). */
export function severityRank(severity: string): number {
  return SEVERITY_RANK[severity as QaFindingSeverity] ?? SEVERITY_RANK.medium;
}

/** Does `severity` meet/exceed the policy's `minSeverity` threshold? */
export function meetsSeverityThreshold(severity: string, minSeverity: string): boolean {
  return severityRank(severity) >= severityRank(minSeverity);
}

/** Finding → board priority for the feedback task. */
export function priorityForSeverity(severity: string): TaskPriority {
  switch (severity) {
    case 'critical': return TaskPriority.URGENT;
    case 'high':     return TaskPriority.HIGH;
    case 'low':      return TaskPriority.LOW;
    default:         return TaskPriority.MEDIUM;
  }
}

/** The finding fields the task draft + routing need (a subset of the row). */
export interface QaFindingLike {
  id: string;
  explorationId: string;
  projectId: number | null;
  type: string;
  severity: string;
  route: string | null;
  selector: string | null;
  message: string;
  detail: string | null;
  heat: number;
  taskId?: number | null;
  /** Dedupe key (type+route+selector+message hash) — stable for the same error
   *  across explorations, so an open fix task can be reused instead of duplicated. */
  fingerprint?: string | null;
}

export interface FindingTaskDraft {
  title: string;
  description: string;
  priority: TaskPriority;
}

/**
 * Pure: render a finding into the board task's title/description/priority. Shared
 * by the manual "Create task" endpoint and the auto-route path so the ticket an
 * agent picks up reads identically however it was opened.
 */
export function buildFindingTaskDraft(finding: QaFindingLike): FindingTaskDraft {
  const where = finding.route ? ` on ${finding.route}` : '';
  const onEl = finding.selector ? ` (element: ${finding.selector})` : '';
  const title = `[QA ${finding.type}] ${finding.message.slice(0, 120)}`;
  const description =
    `Captured by the Agentic Tester${where}${onEl}.\n\n` +
    `**Type:** ${finding.type}  •  **Severity:** ${finding.severity}  •  **Zone heat:** ${finding.heat}\n` +
    (finding.route ? `**Route:** ${finding.route}\n` : '') +
    (finding.selector ? `**Selector:** \`${finding.selector}\`\n` : '') +
    `\n**Error:**\n\`\`\`\n${finding.message}\n\`\`\`\n` +
    (finding.detail ? `\n**Detail:**\n\`\`\`\n${finding.detail.slice(0, 4000)}\n\`\`\`\n` : '') +
    `\nSurfaced from exploration \`${finding.explorationId}\`.`;
  return { title, description, priority: priorityForSeverity(finding.severity) };
}

export interface CreatedFindingTask {
  taskId: number;
  /** The plain task as returned by TaskService (for the HTTP response). */
  plain: ReturnType<Task['toPlain']>;
  /** True when an existing OPEN task for an equivalent finding was reused rather
   *  than a new one created (cross-exploration dedupe). */
  deduped: boolean;
}

export class QaFindingRouter {
  constructor(private readonly db: Db, private readonly taskService: TaskService) {}

  /**
   * Open a board task for a finding and link them (finding → task_created + taskId).
   * Throws if the finding has no project (self-test findings cannot open board tasks)
   * or already has a task. `autoRouted` records whether this was an autonomous route.
   */
  async createTaskFromFinding(
    finding: QaFindingLike,
    tenantId: number,
    /** `env` opts the new ticket into the canonical lane auto-run funnel; omit it
     *  when the caller moves the ticket into a target lane and fires the trigger
     *  itself (the auto-route batch), so the run is dispatched exactly once. */
    opts?: { autoRouted?: boolean; env?: Env },
  ): Promise<CreatedFindingTask> {
    if (finding.projectId == null) {
      throw new Error('This finding has no project — self-test findings cannot create board tasks.');
    }
    if (finding.taskId) {
      throw new Error('A task already exists for this finding');
    }

    // Cross-exploration dedupe: the same recurring error captured in a later run
    // shares this finding's fingerprint. If an equivalent finding already has an
    // OPEN fix task, link to it instead of opening (and dispatching) a duplicate.
    const reuseTaskId = finding.fingerprint
      ? await this.findReusableTask(finding.projectId, finding.fingerprint)
      : null;
    if (reuseTaskId != null) {
      await this.linkFinding(finding.id, reuseTaskId, opts?.autoRouted ?? false);
      const existing = await this.taskService.getTask(reuseTaskId);
      return { taskId: reuseTaskId, plain: existing.toPlain(), deduped: true };
    }

    const draft = buildFindingTaskDraft(finding);
    const task = await this.taskService.createTask(
      { projectId: finding.projectId, title: draft.title, description: draft.description, priority: draft.priority, taskType: TaskType.TASK },
      tenantId,
    );
    const plain = task.toPlain();
    const taskId = Number(plain.id);
    await this.linkFinding(finding.id, taskId, opts?.autoRouted ?? false);
    // A fix ticket is a ticket LANDING IN A LANE — route it through the ONE funnel
    // so a lane that is staffed and auto-gated starts its agent now. The auto-route
    // path (qaRoutes.autoRouteFindings) moves the ticket into the configured fix lane
    // and fires the trigger itself, so it passes no `env` here and there is no double
    // dispatch; the manual `POST /findings/:id/task` path used to fire NOTHING at all.
    if (opts?.env) {
      await onTaskLandedInLane(opts.env, this.db, {
        tenantId,
        projectId:   finding.projectId,
        taskId,
        status:      String(plain.status),
        submittedBy: 'system:qa-finding',
      });
    }
    return { taskId, plain, deduped: false };
  }

  /** Link a finding to its fix task (status → task_created, record the route mode). */
  private async linkFinding(findingId: string, taskId: number, autoRouted: boolean): Promise<void> {
    await this.db
      .update(qaFindings)
      .set({ status: 'task_created', taskId, autoRouted })
      .where(eq(qaFindings.id, findingId));
  }

  /**
   * An existing OPEN (non-Done) fix task for an equivalent finding in this project —
   * same `fingerprint`, the stable per-error hash. Returns the newest such task id,
   * or null when none is open (a closed/Done prior task does NOT block a fresh
   * ticket: a recurrence of a "fixed" bug should reopen the loop).
   */
  private async findReusableTask(projectId: number, fingerprint: string): Promise<number | null> {
    const [row] = await this.db
      .select({ taskId: qaFindings.taskId })
      .from(qaFindings)
      .innerJoin(tasks, eq(tasks.id, qaFindings.taskId))
      .where(and(
        eq(qaFindings.projectId, projectId),
        eq(qaFindings.fingerprint, fingerprint),
        isNotNull(qaFindings.taskId),
        sql`${tasks.status} <> ${TaskStatus.DONE}`,
      ))
      .orderBy(desc(qaFindings.createdAt))
      .limit(1);
    return row?.taskId ?? null;
  }

  /**
   * The lane an auto-routed ticket should enter. An explicit `configuredLaneKey`
   * (the project's routing policy) wins. Otherwise auto-detect the project board's
   * natural fix lane: the first (lowest-position) non-terminal swimlane that has a
   * non-human gate AND at least one staffed agent — i.e. a lane that will actually
   * auto-run. Returns null when no such lane exists (the caller then leaves the
   * ticket in the backlog rather than dispatching into a dead lane).
   */
  async resolveAutoFixLaneKey(projectId: number, configuredLaneKey: string | null): Promise<string | null> {
    if (configuredLaneKey) return configuredLaneKey;

    const [board] = await this.db
      .select({ id: boards.id })
      .from(boards)
      .where(eq(boards.projectId, projectId))
      .limit(1);
    if (!board) return null;

    const [lane] = await this.db
      .select({ key: swimlanes.key })
      .from(swimlanes)
      .innerJoin(swimlaneAgentAssignments, eq(swimlaneAgentAssignments.swimlaneId, swimlanes.id))
      .where(
        and(
          eq(swimlanes.boardId, board.id),
          eq(swimlanes.isTerminal, false),
          sql`${swimlanes.gate} <> 'human'`,
          sql`${swimlaneAgentAssignments.agentRef} is not null`,
        ),
      )
      .orderBy(asc(swimlanes.position))
      .limit(1);
    return lane?.key ?? null;
  }
}
