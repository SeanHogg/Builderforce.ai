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
