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
import { and, desc, eq, ne } from 'drizzle-orm';
import { pullRequests } from '../../infrastructure/database/schema';
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

/** Record the post-merge build outcome on a PR row. */
export async function setPullRequestBuildStatus(db: Db, id: string, buildStatus: string) {
  await db
    .update(pullRequests)
    .set({ buildStatus, updatedAt: new Date() })
    .where(eq(pullRequests.id, id));
}
