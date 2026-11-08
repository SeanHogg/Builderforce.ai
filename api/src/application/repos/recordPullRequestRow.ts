import { reportCaughtError } from '../observability/caughtErrorReporter';
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
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import type { Db, Tx } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { recordAutomatedEvidence } from '../governance/automatedSocEvidence';

/**
 * The column projection every PR-lookup helper below returns. It was duplicated
 * verbatim across findOpenPullRequestByTask / findMergedPullRequestBySha /
 * findOpenPullRequestByProject, so a column added for one caller silently missed
 * the other two — which is exactly how `number` came to be absent from all three
 * despite the ordering clauses already referencing it.
 *
 * `number` is included because publishing a Check Run needs the PR head SHA, and
 * the only way to that SHA is getPullRequestDetail(…, { number }).
 */
const PR_REF_COLUMNS = {
  id: pullRequests.id,
  tenantId: pullRequests.tenantId,
  taskId: pullRequests.taskId,
  projectId: pullRequests.projectId,
  repoId: pullRequests.repoId,
  buildStatus: pullRequests.buildStatus,
  number: pullRequests.number,
  status: pullRequests.status,
} as const;

/**
 * Whether a green CI result may MERGE this PR and a red one may dispatch an AUTO-FIX run for it. A draft may not:
 * the platform's early draft (`ci/draftPrForCi`) belongs to a run that is still live, and a human's draft is
 * explicitly not ready. ONE predicate for both decisions in `ingestPreMergeEvent`.
 */
export function isMergeCandidate(pr: { status: string | null }): boolean {
  return pr.status !== 'draft';
}

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
  /** The execution that opened this as the platform's early draft (`ci/draftPrForCi`); the marker of a draft that is ours. */
  platformDraftExecutionId?: number | null;
}

function rowValues(input: RecordPullRequestInput) {
  const now = new Date();
  return {
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
    platformDraftExecutionId: input.platformDraftExecutionId ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Insert a pull_requests row, or — when the provider's own identity `(tenant, repo, number)` already has one (the PR
 * reconciler inserts a row for every PR it sees, possibly before we get to) — take that row over: the task, status,
 * branch and marker are set from this write. Returns the row.
 */
export async function upsertPullRequestRow(db: Db | Tx, input: RecordPullRequestInput) {
  const values = rowValues(input);
  const [row] = await db
    .insert(pullRequests)
    .values(values)
    .onConflictDoUpdate({
      target: [pullRequests.tenantId, pullRequests.repoId, pullRequests.number],
      targetWhere: sql`${pullRequests.repoId} is not null and ${pullRequests.number} is not null`,
      set: {
        taskId: values.taskId, status: values.status, url: values.url, branchName: values.branchName,
        baseBranch: values.baseBranch, platformDraftExecutionId: values.platformDraftExecutionId, updatedAt: values.updatedAt,
      },
    })
    .returning();
  return row;
}

/** Insert a pull_requests row and return it. */
export async function recordPullRequestRow(db: Db | Tx, input: RecordPullRequestInput) {
  const [row] = await db
    .insert(pullRequests)
    .values(rowValues(input))
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
  } catch (error) {
    // best-effort — a missing deployment row only undercounts DORA frequency.
  
    reportCaughtError(error, { source: "application/repos/recordPullRequestRow.ts", operation: "recordMergeDeployment" });
  }
}

/** Flag a PR row merged by its id (in-product Approve & Merge + finalize auto-merge). */
export async function markPullRequestMergedById(
  db: Db,
  id: string,
  tenantId: number,
  opts: { mergeSha?: string | null; mergedBy?: string | null; env?: Env } = {},
) {
  // The provider merge has ALREADY happened when this runs, so a failed write must not be swallowed
  // into a PR the gate and the sweep still believe is open: retry once, then log a structured error
  // and return null. The row is then reconciled to 'merged' by `reconcilePullRequestState` (the
  // `pr-ticket-reconciler` sweep reads the provider's state and corrects a row that disagrees).
  const write = () => db
    .update(pullRequests)
    .set(mergedSet(opts))
    .where(and(eq(pullRequests.id, id), eq(pullRequests.tenantId, tenantId)))
    .returning();
  let row: Awaited<ReturnType<typeof write>>[number] | undefined;
  try {
    [row] = await write();
  } catch {
    try {
      [row] = await write();
    } catch (error) {
      reportCaughtError(error, {
        source: 'application/repos/recordPullRequestRow.ts', operation: 'markPullRequestMergedById',
        context: { logMessage: '[pull-request] provider merge succeeded but the row could not be marked merged', details: { tenantId, pullRequestId: id, mergeSha: opts.mergeSha ?? null } },
      });
      return null;
    }
  }
  if (row) {
    await recordMergeDeployment(db, { id: row.id, tenantId: row.tenantId, projectId: row.projectId, taskId: row.taskId ?? null });
    // EVERY merge path converges here, so this is the one place a merge becomes SOC 2 change-management
    // evidence (CC8.1). Idempotent and best-effort — it never fails the merge.
    await recordAutomatedEvidence(opts.env, db, {
      tenantId: row.tenantId, segmentId: row.segmentId ?? null, kind: 'merge', sourceId: row.id, url: row.url ?? null,
      note: `PR #${row.number ?? '?'} merged${row.mergedBy ? ` by ${row.mergedBy}` : ''}${row.taskId != null ? ` (task #${row.taskId})` : ''}; merge sha ${row.mergeSha ?? 'n/a'}`,
    });
  }
  return row ?? null;
}

/**
 * Flag a PR row CLOSED (not merged) by its id — the DB-side counterpart of
 * {@link closePullRequest}, used when a run is reverted.
 *
 * Deliberately does NOT write a {@link deploymentEvents} row: a closed PR shipped
 * nothing, so counting it as a deployment would inflate DORA frequency with work
 * that was thrown away.
 */
export async function markPullRequestClosedById(db: Db, id: string, tenantId: number) {
  const [row] = await db
    .update(pullRequests)
    .set({ status: 'closed', updatedAt: new Date() })
    .where(and(eq(pullRequests.id, id), eq(pullRequests.tenantId, tenantId)))
    .returning();
  return row ?? null;
}

/** Flag the latest still-open PR row for a task merged (green-CI webhook merge). */
export async function markPullRequestMergedByTask(
  db: Db,
  tenantId: number,
  taskId: number,
  opts: { mergeSha?: string | null; env?: Env } = {},
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
 *  pre-merge phase so the build status + reason land on the right PR row. With `branch` it is the row OF THAT
 *  BRANCH, not just the newest row linked to the task (a newer row on another branch must not take its place). */
export async function findOpenPullRequestByTask(db: Db, tenantId: number, taskId: number, branch?: string | null) {
  const [row] = await db
    .select(PR_REF_COLUMNS)
    .from(pullRequests)
    .where(and(eq(pullRequests.taskId, taskId), eq(pullRequests.tenantId, tenantId), ne(pullRequests.status, 'merged'), ...(branch ? [eq(pullRequests.branchName, branch)] : [])))
    // Prefer a row with a real provider number, then newest (same precedence as the GET route).
    .orderBy(sql`${pullRequests.number} is not null desc`, desc(pullRequests.createdAt))
    .limit(1);
  return row ?? null;
}

/** Find the merged PR a post-merge CI build belongs to, by its recorded merge SHA. */
export async function findMergedPullRequestBySha(db: Db, mergeSha: string) {
  const [row] = await db
    .select(PR_REF_COLUMNS)
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
/**
 * The newest open PR for a PROJECT (no task). Designer/Mobile PRs are opened by
 * the IDE bridge, not by an agent working a ticket, so they have a `projectId`
 * and a null `taskId` — `findOpenPullRequestByTask` can never match them.
 */
export async function findOpenPullRequestByProject(db: Db, tenantId: number, projectId: number) {
  const [row] = await db
    .select(PR_REF_COLUMNS)
    .from(pullRequests)
    .where(and(eq(pullRequests.projectId, projectId), eq(pullRequests.tenantId, tenantId), ne(pullRequests.status, 'merged')))
    .orderBy(sql`${pullRequests.number} is not null desc`, desc(pullRequests.createdAt))
    .limit(1);
  return row ?? null;
}

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
  } catch (error) {
    // best-effort — DORA change-failure/MTTR self-heals on the next build event.
  
    reportCaughtError(error, { source: "application/repos/recordPullRequestRow.ts", operation: "setPullRequestBuildStatus" });
  }
}
