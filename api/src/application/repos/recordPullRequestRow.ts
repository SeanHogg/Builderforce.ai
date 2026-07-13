/**
 * recordPullRequestRow — the single place that inserts a `pull_requests` row.
 *
 * Both finalize sites used to hand-roll this insert: {@link openTaskPullRequest}
 * (the agentHost "task Done" path) and the cloud runner finalize in
 * runtimeRoutes.ts. The cloud path in particular had DROPPED the insert entirely
 * (it only wrote `tasks.githubPrUrl`), so cloud-run PRs never surfaced in the
 * in-product PR list / approval flow. Funnelling both through one helper keeps the
 * recorded shape identical and fixes that gap (DRY — one insert, one column map).
 */
import { and, desc, eq, isNull, ne, sql } from 'drizzle-orm';
import { deploymentEvents, pullRequests } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';

export interface RecordPullRequestInput {
  tenantId: number;
  segmentId?: string | null;
  projectId: number;
  repoId?: string | null;
  taskId?: number | null;
  specId?: string | null;
  provider: string;
  number?: number | null;
  url?: string | null;
  branchName?: string | null;
  baseBranch?: string | null;
  /** draft | open | merged | closed. Defaults to 'open' (awaiting approval). */
  status?: string;
}

/** Insert a pull_requests row and return it. */
export async function recordPullRequestRow(db: Db, input: RecordPullRequestInput) {
  const now = new Date();
  const [row] = await db
    .insert(pullRequests)
    .values({
      tenantId: input.tenantId,
      segmentId: input.segmentId ?? null,
      projectId: input.projectId,
      repoId: input.repoId ?? null,
      taskId: input.taskId ?? null,
      specId: input.specId ?? null,
      provider: input.provider,
      number: input.number ?? null,
      url: input.url ?? null,
      branchName: input.branchName ?? null,
      baseBranch: input.baseBranch ?? null,
      status: input.status ?? 'open',
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return row;
}

/** The set-clause shared by every "this PR is now merged" write (one source of truth). */
function mergedSet(opts: { mergeSha?: string | null; mergedBy?: string | null }) {
  const now = new Date();
  return {
    status: 'merged' as const,
    mergeSha: opts.mergeSha ?? null,
    ...(opts.mergedBy !== undefined ? { mergedBy: opts.mergedBy } : {}),
    mergedAt: now,
    updatedAt: now,
  };
}

/**
 * A merge-to-base is the DORA "deployment" proxy (Builderforce has no separate
 * deploy infra): every merge writes one {@link deploymentEvents} row so deployment
 * frequency + lead time light up, and the post-merge CI outcome later flips it to
 * a failure / closes MTTR (see {@link setPullRequestBuildStatus}). externalRef is
 * the PR row id — the stable key both writes share. Best-effort: a metrics row
 * must never block a merge. The workforce-metrics cache refreshes on its TTL or
 * the next status write (no env here to bump the version token).
 */
async function recordMergeDeployment(db: Db, pr: { id: string; tenantId: number; projectId: number; taskId: number | null }): Promise<void> {
  try {
    await db.insert(deploymentEvents).values({
      tenantId: pr.tenantId,
      projectId: pr.projectId,
      taskId: pr.taskId ?? null,
      environment: 'production',
      status: 'success',
      isFailure: false,
      externalRef: pr.id,
      deployedAt: new Date(),
    });
  } catch {
    // best-effort — a missing deployment row only undercounts DORA frequency.
  }
}

/** Flag a PR row merged by its id (in-product Approve & Merge + finalize auto-merge). */
export async function markPullRequestMergedById(
  db: Db,
  id: string,
  tenantId: number,
  opts: { mergeSha?: string | null; mergedBy?: string | null } = {},
) {
  const [row] = await db
    .update(pullRequests)
    .set(mergedSet(opts))
    .where(and(eq(pullRequests.id, id), eq(pullRequests.tenantId, tenantId)))
    .returning();
  if (row) await recordMergeDeployment(db, { id: row.id, tenantId: row.tenantId, projectId: row.projectId, taskId: row.taskId ?? null });
  return row ?? null;
}

/** Flag the latest still-open PR row for a task merged (green-CI webhook merge). */
export async function markPullRequestMergedByTask(
  db: Db,
  tenantId: number,
  taskId: number,
  opts: { mergeSha?: string | null } = {},
) {
  const [latest] = await db
    .select({ id: pullRequests.id })
    .from(pullRequests)
    .where(and(eq(pullRequests.taskId, taskId), eq(pullRequests.tenantId, tenantId), ne(pullRequests.status, 'merged')))
    .orderBy(desc(pullRequests.createdAt))
    .limit(1);
  if (!latest) return null;
  return markPullRequestMergedById(db, latest.id, tenantId, opts);
}

/** The latest still-open (un-merged) PR row for a task — the one whose `builderforce/task-<id>`
 *  branch a PRE-merge CI build belongs to. Mirrors `findMergedPullRequestBySha` for the
 *  pre-merge phase so the build status + reason land on the right PR row. */
export async function findOpenPullRequestByTask(db: Db, tenantId: number, taskId: number) {
  const [row] = await db
    .select({
      id: pullRequests.id,
      tenantId: pullRequests.tenantId,
      taskId: pullRequests.taskId,
      projectId: pullRequests.projectId,
      repoId: pullRequests.repoId,
      buildStatus: pullRequests.buildStatus,
    })
    .from(pullRequests)
    .where(and(eq(pullRequests.taskId, taskId), eq(pullRequests.tenantId, tenantId), ne(pullRequests.status, 'merged')))
    // Prefer a row with a real provider number, then newest (same precedence as the GET route).
    .orderBy(sql`${pullRequests.number} is not null desc`, desc(pullRequests.createdAt))
    .limit(1);
  return row ?? null;
}

/** Find the merged PR a post-merge CI build belongs to, by its recorded merge SHA. */
export async function findMergedPullRequestBySha(db: Db, mergeSha: string) {
  const [row] = await db
    .select({
      id: pullRequests.id,
      tenantId: pullRequests.tenantId,
      taskId: pullRequests.taskId,
      projectId: pullRequests.projectId,
      repoId: pullRequests.repoId,
      buildStatus: pullRequests.buildStatus,
    })
    .from(pullRequests)
    .where(eq(pullRequests.mergeSha, mergeSha))
    .limit(1);
  return row ?? null;
}

/** Record a build outcome on a PR row (pre- OR post-merge), persist the failure
 *  REASON so the ticket can show WHY (cleared on green), and reconcile its DORA
 *  deployment row: a failing post-merge build is a change failure; a later success
 *  closes MTTR by stamping restored_at on the still-open failure. (Pre-merge rows have
 *  no deployment_events row yet, so the DORA reconcile is a harmless no-op for them.) */
export async function setPullRequestBuildStatus(db: Db, id: string, buildStatus: string, buildError: string | null = null) {
  await db
    .update(pullRequests)
    // Keep the reason only while the build is red; a green/pending build clears it.
    .set({ buildStatus, buildError: buildStatus === 'failure' ? buildError : null, updatedAt: new Date() })
    .where(eq(pullRequests.id, id));

  try {
    if (buildStatus === 'failure') {
      await db
        .update(deploymentEvents)
        .set({ isFailure: true, status: 'failed' })
        .where(eq(deploymentEvents.externalRef, id));
    } else if (buildStatus === 'success') {
      // Restore any still-open failure for this deploy (MTTR = restored_at − deployed_at).
      await db
        .update(deploymentEvents)
        .set({ restoredAt: new Date() })
        .where(and(eq(deploymentEvents.externalRef, id), eq(deploymentEvents.isFailure, true), isNull(deploymentEvents.restoredAt)));
    }
  } catch {
    // best-effort — DORA change-failure/MTTR self-heals on the next build event.
  }
}
