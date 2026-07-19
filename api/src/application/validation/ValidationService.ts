/**
 * ValidationService — the write path for the Validator agent's review of a "Done"
 * work item against the codebase.
 *
 * The Validator (a built-in agent with programming + BA / team-lead skills) reviews
 * a completed ticket, judges whether the delivered code ACTUALLY satisfies the
 * ticket end-to-end, and reports back through this service. Each pass:
 *
 *   1. appends a row to `task_reviews` (the append-only audit trail — a Done item is
 *      reviewed MANY times: on entry to Done, then re-swept on a schedule, so the
 *      same item accrues multiple review passes);
 *   2. denormalises the latest pass onto the task (review_count++, last_reviewed_at,
 *      last_review_verdict) for cheap board rendering;
 *   3. for every gap found, mints a first-class GAP task (taskType='gap') carrying
 *      gap_origin_task_id back to the reviewed item, so the gap is visible and
 *      schedulable rather than lost in a comment.
 *
 * DRY: reached through ONE built-in MCP tool (`reviews.record`) so the Validator can
 * report from any runtime (cloud loop, CLI, on-prem), and callable directly by the
 * on-Done / recurring-sweep dispatcher. Mirrors QaFindingRouter (finding → task) and
 * the CI auto-fix loop (review outcome → corrective work).
 */
import { and, eq, sql } from 'drizzle-orm';
import { taskReviews, tasks as tasksTable, projects } from '../../infrastructure/database/schema';
import { TaskService } from '../task/TaskService';
import { TaskRepository } from '../../infrastructure/repositories/TaskRepository';
import { ProjectRepository } from '../../infrastructure/repositories/ProjectRepository';
import { TaskType, TaskPriority } from '../../domain/shared/types';
import type { Db } from '../../infrastructure/database/connection';

export type ReviewVerdict = 'complete' | 'gaps';

export interface ReviewGapInput {
  /** Short title of the gap (becomes the GAP task title). */
  title: string;
  /** What is missing / incomplete and what "done" would require. */
  detail?: string | null;
  /** Optional priority override (default HIGH — a gap in shipped work is urgent-ish). */
  priority?: TaskPriority;
  /**
   * Repo-relative file the gap is about, and the line it starts at.
   *
   * Optional and frequently absent — plenty of real gaps ("no tests were added",
   * "the PRD's third requirement is unimplemented") are about the ABSENCE of code
   * and have nowhere to point. Gaps that DO carry a location are published as
   * inline comments on the pull request, anchored to that line, so the reviewer
   * sees the finding against the code rather than in a separate list; gaps
   * without one are published in the review body instead. Neither is degraded —
   * they are different kinds of finding.
   *
   * See application/validation/publishReviewToPr.ts.
   */
  path?: string | null;
  line?: number | null;
}

export interface RecordReviewInput {
  /** The Done item being reviewed. */
  taskId: number;
  /** ide_agents.id of the Validator (or 'system'). */
  reviewerRef?: string | null;
  /** Explicit verdict; derived from gaps.length when omitted. */
  verdict?: ReviewVerdict;
  /** The Validator's one-paragraph assessment. */
  summary?: string | null;
  /** Gaps found — each becomes a GAP task. Empty ⇒ the work is complete. */
  gaps?: ReviewGapInput[];
}

export interface RecordReviewResult {
  reviewId: number;
  verdict: ReviewVerdict;
  reviewCount: number;
  gapTaskIds: number[];
}

export class ValidationService {
  private readonly tasks: TaskService;

  constructor(private readonly db: Db) {
    const taskRepo = new TaskRepository(db);
    const projectRepo = new ProjectRepository(db);
    this.tasks = new TaskService(taskRepo, projectRepo);
  }

  /** The reviewed task, tenant-scoped (via project join). Null on cross-tenant / missing. */
  private async ownedTask(tenantId: number, taskId: number): Promise<{ projectId: number } | null> {
    const [row] = await this.db
      .select({ projectId: tasksTable.projectId })
      .from(tasksTable)
      .innerJoin(projects, eq(projects.id, tasksTable.projectId))
      .where(and(eq(tasksTable.id, taskId), eq(projects.tenantId, tenantId)))
      .limit(1);
    return row ?? null;
  }

  /**
   * Record one Validator review pass. Creates the ledger row + any GAP tasks and
   * bumps the task's denormalised review counters, all tenant-scoped.
   */
  async recordReview(tenantId: number, input: RecordReviewInput): Promise<RecordReviewResult> {
    const owned = await this.ownedTask(tenantId, input.taskId);
    if (!owned) throw new Error('Task not found in workspace');

    const gaps = Array.isArray(input.gaps) ? input.gaps.filter((g) => g && String(g.title || '').trim()) : [];
    const verdict: ReviewVerdict = input.verdict ?? (gaps.length > 0 ? 'gaps' : 'complete');

    // 1. Mint a GAP task per gap, tied back to the reviewed item.
    const gapTaskIds: number[] = [];
    for (const gap of gaps) {
      // Carry the location into the GAP task's description: whoever picks the gap
      // up needs to know where it is, and the ticket is the only place they will
      // look. `path:line` matches the convention githubAlerts.ts already uses for
      // a finding location.
      const where = gap.path ? `\n\nLocation: \`${gap.path}${gap.line ? `:${gap.line}` : ''}\`` : '';
      const created = await this.tasks.createTask({
        projectId: owned.projectId,
        title: String(gap.title).trim().slice(0, 500),
        description: (gap.detail ? String(gap.detail) : `Gap found reviewing ${'#' + input.taskId}.`) + where,
        priority: gap.priority ?? TaskPriority.HIGH,
        taskType: TaskType.GAP,
        gapOriginTaskId: input.taskId,
      }, tenantId);
      gapTaskIds.push(Number(created.id));
    }

    // 2. Append the review-pass ledger row.
    const [review] = await this.db.insert(taskReviews).values({
      tenantId,
      taskId: input.taskId,
      reviewerRef: input.reviewerRef ?? undefined,
      verdict,
      summary: input.summary ?? undefined,
      gapsCount: gapTaskIds.length,
    }).returning({ id: taskReviews.id });

    // 3. Denormalise the latest pass onto the task for cheap board reads.
    const [updated] = await this.db.update(tasksTable).set({
      reviewCount: sql`${tasksTable.reviewCount} + 1`,
      lastReviewedAt: new Date(),
      lastReviewVerdict: verdict,
      updatedAt: new Date(),
    }).where(eq(tasksTable.id, input.taskId)).returning({ reviewCount: tasksTable.reviewCount });

    return { reviewId: review!.id, verdict, reviewCount: Number(updated?.reviewCount ?? 0), gapTaskIds };
  }

  /** Review history for a task (newest first) — the ticket drawer + re-sweep guard. */
  async listReviews(tenantId: number, taskId: number) {
    const owned = await this.ownedTask(tenantId, taskId);
    if (!owned) return [];
    return this.db.select().from(taskReviews)
      .where(and(eq(taskReviews.tenantId, tenantId), eq(taskReviews.taskId, taskId)))
      .orderBy(sql`${taskReviews.createdAt} DESC`);
  }
}
