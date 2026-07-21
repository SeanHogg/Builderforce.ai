/**
 * Feedback engine — the ONE write path a product feedback request takes, whatever
 * channel it arrived on (public snippet POST, or the signed-in in-app panel).
 *
 * It records the submission, collapses duplicates, enforces the collector's
 * rolling-24h abuse ceiling, and opens the backlog ticket. The ticket is marked
 * `source = FEEDBACK_TASK_SOURCE`, which {@link evaluateTaskAutoRun} treats as a
 * hard stop BEFORE any board/lane/agent resolution — so an external request can
 * never be executed by an agent, autonomously or via Run-now, until a human
 * approves it in triage ({@link reviewFeedbackSubmission}).
 *
 * neon-http safe: no interactive transaction. The ticket insert goes direct
 * (rather than through TaskService) because `tasks.source` — the whole gate — is
 * not carried by the domain entity; key allocation is shared via taskKeys.ts.
 */

import { and, count, desc, eq, gte, sql } from 'drizzle-orm';
import {
  feedbackCollectors, feedbackSubmissions, projects, tasks,
} from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { bumpCacheVersion } from '../../infrastructure/cache/readThroughCache';
import { TaskPriority, TaskStatus } from '../../domain/shared/types';
import { withDirectTaskKey } from '../task/taskKeys';
import {
  FEEDBACK_APPROVED_TASK_SOURCE, FEEDBACK_TASK_SOURCE,
  buildFeedbackTaskDraft, computeFeedbackFingerprint,
  type NormalizedFeedback,
} from './feedbackSpec';

/** Version key for a project's cached feedback triage lists. */
export function feedbackVersionKey(projectId: number): string {
  return `feedback-version:project:${projectId}`;
}

/** Version key for a tenant's all-projects cached feedback lists. */
export function feedbackTenantVersionKey(tenantId: number): string {
  return `feedback-version:tenant:${tenantId}`;
}

/** A collector resolved from an ingest key (or synthesized for an in-app submit). */
export interface FeedbackTarget {
  /** Null for an in-app submission — there is no collector row behind it. */
  collectorId: string | null;
  tenantId: number;
  projectId: number;
  autoCreateTask: boolean;
  /** Rolling-24h submission ceiling; null disables the check (in-app path). */
  dailyLimit: number | null;
}

export interface SubmitResult {
  submissionId: string;
  taskId: number | null;
  /** An identical request was already open — this one collapsed onto it. */
  deduped: boolean;
  /** The collector's rolling-24h ceiling rejected the submission. */
  rateLimited?: boolean;
}

/**
 * Record a feedback request and (when the collector opts in) open its human-gated
 * backlog ticket. Best-effort on the ticket: a submission is never lost because
 * the board write failed — it stays visible in triage and can be promoted later.
 */
export async function submitFeedback(
  db: Db,
  env: Env,
  target: FeedbackTarget,
  feedback: NormalizedFeedback,
  actor: { userId?: string | null } = {},
): Promise<SubmitResult | { rateLimited: true }> {
  // Abuse ceiling. A public, unauthenticated endpoint that opens TICKETS needs a
  // hard cap — the error-ingest path's monthly plan quota is far too coarse for
  // something that puts cards on a human's board.
  if (target.collectorId && target.dailyLimit != null) {
    const since = new Date(Date.now() - 24 * 60 * 60_000);
    const [row] = await db
      .select({ n: count() })
      .from(feedbackSubmissions)
      .where(and(
        eq(feedbackSubmissions.collectorId, target.collectorId),
        gte(feedbackSubmissions.createdAt, since),
      ));
    if (Number(row?.n ?? 0) >= target.dailyLimit) return { rateLimited: true };
  }

  const fingerprint = await computeFeedbackFingerprint(feedback);

  // Duplicate collapse: the identical request already recorded for this project
  // (and not declined) is returned instead of opening a second ticket.
  const [existing] = await db
    .select({ id: feedbackSubmissions.id, taskId: feedbackSubmissions.taskId })
    .from(feedbackSubmissions)
    .where(and(
      eq(feedbackSubmissions.projectId, target.projectId),
      eq(feedbackSubmissions.fingerprint, fingerprint),
      sql`${feedbackSubmissions.status} <> 'declined'`,
    ))
    .orderBy(desc(feedbackSubmissions.createdAt))
    .limit(1);
  if (existing) {
    return { submissionId: existing.id, taskId: existing.taskId ?? null, deduped: true };
  }

  const now = new Date();
  const [submission] = await db
    .insert(feedbackSubmissions)
    .values({
      tenantId: target.tenantId,
      projectId: target.projectId,
      collectorId: target.collectorId,
      kind: feedback.kind,
      title: feedback.title,
      body: feedback.body,
      status: 'new',
      submitterUserId: actor.userId ?? null,
      submitterEmail: feedback.submitterEmail,
      submitterName: feedback.submitterName,
      pageUrl: feedback.pageUrl,
      userAgent: feedback.userAgent,
      appVersion: feedback.appVersion,
      context: feedback.context,
      fingerprint,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: feedbackSubmissions.id });
  if (!submission) throw new Error('Failed to record feedback submission');

  let taskId: number | null = null;
  if (target.autoCreateTask) {
    taskId = await openFeedbackTask(db, target.projectId, feedback, {
      submitterLabel: feedback.submitterName ?? feedback.submitterEmail ?? null,
    });
    if (taskId != null) {
      await db.update(feedbackSubmissions)
        .set({ taskId, updatedAt: now })
        .where(eq(feedbackSubmissions.id, submission.id));
    }
  }

  if (target.collectorId) {
    await db.update(feedbackCollectors)
      .set({ lastSubmissionAt: now })
      .where(eq(feedbackCollectors.id, target.collectorId))
      .catch(() => {});
  }
  await bumpFeedbackCaches(env, target.tenantId, target.projectId);

  return { submissionId: submission.id, taskId, deduped: false };
}

/**
 * Open the backlog ticket for a request. Deliberately UNASSIGNED (no owner agent)
 * and marked with the gating source, so it is inert on the board until approved:
 * the owner-agent fallback in laneAutoRun is the usual way a backlog card starts
 * running by surprise, and leaving the owner null closes that door too.
 */
async function openFeedbackTask(
  db: Db,
  projectId: number,
  feedback: NormalizedFeedback,
  meta: { submitterLabel: string | null },
): Promise<number | null> {
  const [project] = await db
    .select({ key: projects.key })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project) return null;

  const draft = buildFeedbackTaskDraft(feedback, meta);
  const row = await withDirectTaskKey(db, projectId, project.key, (key) =>
    db.insert(tasks).values({
      projectId,
      key,
      title: draft.title,
      description: draft.description,
      status: TaskStatus.BACKLOG,
      // A request is a request until a human sizes it — never inherit urgency
      // from whoever typed it.
      priority: feedback.kind === 'bug' ? TaskPriority.MEDIUM : TaskPriority.LOW,
      // THE GATE. evaluateTaskAutoRun short-circuits on this value.
      source: FEEDBACK_TASK_SOURCE,
    }).returning({ id: tasks.id }),
  );
  return row?.[0]?.id ?? null;
}

/**
 * Human triage decision — the approval gate itself.
 *
 * Approving flips the ticket's marker to FEEDBACK_APPROVED_TASK_SOURCE, which is
 * what makes it executable at all; from that point it is ordinary board work that
 * still carries its external provenance. Declining archives the ticket so a
 * rejected request stops occupying the backlog.
 */
export async function reviewFeedbackSubmission(
  db: Db,
  env: Env,
  args: { tenantId: number; submissionId: string; decision: 'approved' | 'declined'; reviewerUserId?: string | null },
): Promise<{ ok: boolean; taskId: number | null }> {
  const [submission] = await db
    .select({
      id: feedbackSubmissions.id,
      projectId: feedbackSubmissions.projectId,
      taskId: feedbackSubmissions.taskId,
    })
    .from(feedbackSubmissions)
    .where(and(eq(feedbackSubmissions.id, args.submissionId), eq(feedbackSubmissions.tenantId, args.tenantId)))
    .limit(1);
  if (!submission) return { ok: false, taskId: null };

  const now = new Date();
  await db.update(feedbackSubmissions)
    .set({ status: args.decision, reviewedBy: args.reviewerUserId ?? null, reviewedAt: now, updatedAt: now })
    .where(eq(feedbackSubmissions.id, submission.id));

  if (submission.taskId != null) {
    await db.update(tasks)
      .set(args.decision === 'approved'
        ? { source: FEEDBACK_APPROVED_TASK_SOURCE, updatedAt: now }
        : { archived: true, updatedAt: now })
      .where(eq(tasks.id, submission.taskId));
  }

  await bumpFeedbackCaches(env, args.tenantId, submission.projectId);
  return { ok: true, taskId: submission.taskId ?? null };
}

/** Invalidate both the project- and tenant-scoped triage list caches. */
export async function bumpFeedbackCaches(env: Env, tenantId: number, projectId: number): Promise<void> {
  await bumpCacheVersion(env, feedbackVersionKey(projectId));
  await bumpCacheVersion(env, feedbackTenantVersionKey(tenantId));
}
