/**
 * mergeRecordedPullRequest — the server-side "merge + close a recorded PR" core,
 * shared by the in-product "Approve & Merge" route AND the AI Manager's autonomous
 * PR coordination. Resolves the tenant's decrypted credential, calls the provider
 * PR-merge API (which closes the PR), records who/what merged it, and busts the
 * cached PR detail. Extracted so the human path and the manager path can never
 * drift on how a PR is merged.
 */
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { pullRequests } from '../../infrastructure/database/schema';
import { resolveRepoCredential, isResolveError } from './resolveRepoCredential';
import { mergePullRequest, normalizeMergeMethod, type MergeMethod } from './mergePullRequest';
import { markPullRequestMergedById } from './recordPullRequestRow';
import { invalidatePullRequestDetail } from './getPullRequestDetail';
import { completeTaskOnMerge } from '../task/taskLifecycle';
import { updatePullRequestBranch } from './updatePullRequestBranch';

export type UpdateRecordedPrBranchResult =
  | { ok: true; updated: boolean }
  | { ok: false; httpStatus: number; error: string; code: 'conflict' | 'provider_error' };

/** Tenant-scoped preparation used by the manager before checking CI/merging. */
export async function updateRecordedPullRequestBranch(
  db: Db,
  env: Env,
  args: { tenantId: number; prId: string },
): Promise<UpdateRecordedPrBranchResult> {
  const [row] = await db.select().from(pullRequests)
    .where(and(eq(pullRequests.id, args.prId), eq(pullRequests.tenantId, args.tenantId))).limit(1);
  if (!row) return { ok: false, httpStatus: 404, error: 'Pull request not found', code: 'provider_error' };
  if (!row.repoId || row.number == null) {
    return { ok: false, httpStatus: 409, error: 'Pull request is not ready to update', code: 'provider_error' };
  }
  const e = env as unknown as { INTEGRATION_ENCRYPTION_SECRET?: string; JWT_SECRET?: string };
  const resolved = await resolveRepoCredential(
    db, e.INTEGRATION_ENCRYPTION_SECRET ?? e.JWT_SECRET ?? '', args.tenantId, row.repoId,
  );
  if (isResolveError(resolved)) {
    return { ok: false, httpStatus: resolved.status, error: resolved.error, code: 'provider_error' };
  }
  const result = await updatePullRequestBranch({
    provider: resolved.repo.provider, host: resolved.repo.host,
    owner: resolved.repo.owner, repo: resolved.repo.repo,
    token: resolved.token, number: row.number,
  });
  // No provider endpoint means there is no preparation step; retain the existing
  // merge behaviour instead of disabling supported Bitbucket merges.
  if (!result.ok && result.code === 'unsupported') return { ok: true, updated: false };
  if (!result.ok) {
    return {
      ok: false, httpStatus: result.code === 'conflict' ? 409 : 502,
      error: result.reason, code: result.code,
    };
  }
  return result;
}

export type MergeRecordedPrResult =
  | { ok: true; merged: boolean; alreadyMerged?: boolean; branchUpdated?: boolean; sha: string | null; pullRequest: unknown }
  | { ok: false; httpStatus: number; error: string; code?: string };

/**
 * Merge the recorded PR `prId` (tenant-scoped). `mergedBy` records who approved it
 * — a user id for the in-product button, or a `manager:<ref>` marker for the AI
 * manager. Idempotent: a PR already merged returns ok+alreadyMerged.
 */
export async function mergeRecordedPullRequest(
  db: Db,
  env: Env,
  args: { tenantId: number; prId: string; method?: MergeMethod | string; mergedBy?: string | null; updateBranch?: boolean },
): Promise<MergeRecordedPrResult> {
  const [row] = await db
    .select()
    .from(pullRequests)
    .where(and(eq(pullRequests.id, args.prId), eq(pullRequests.tenantId, args.tenantId)))
    .limit(1);
  if (!row) return { ok: false, httpStatus: 404, error: 'Pull request not found' };
  if (row.status === 'merged') return { ok: true, merged: true, alreadyMerged: true, sha: null, pullRequest: row };
  if (!row.repoId) return { ok: false, httpStatus: 409, error: 'PR has no linked repo to merge against' };
  if (row.number == null) return { ok: false, httpStatus: 409, error: 'PR has no provider number yet (still being opened)' };

  const e = env as unknown as { INTEGRATION_ENCRYPTION_SECRET?: string; JWT_SECRET?: string };
  const secret = e.INTEGRATION_ENCRYPTION_SECRET ?? e.JWT_SECRET ?? '';
  const resolved = await resolveRepoCredential(db, secret, args.tenantId, row.repoId);
  if (isResolveError(resolved)) return { ok: false, httpStatus: resolved.status, error: resolved.error };

  let branchUpdated = false;
  if (args.updateBranch) {
    const update = await updatePullRequestBranch({
      provider: resolved.repo.provider,
      host: resolved.repo.host,
      owner: resolved.repo.owner,
      repo: resolved.repo.repo,
      token: resolved.token,
      number: row.number,
    });
    // Providers without a safe update endpoint retain the old merge behaviour.
    if (!update.ok && update.code !== 'unsupported') {
      return { ok: false, httpStatus: update.code === 'conflict' ? 409 : 502, error: update.reason, code: update.code };
    }
    branchUpdated = update.ok && update.updated;
  }

  const result = await mergePullRequest({
    provider: resolved.repo.provider,
    host: resolved.repo.host,
    owner: resolved.repo.owner,
    repo: resolved.repo.repo,
    token: resolved.token,
    number: row.number,
    method: normalizeMergeMethod(args.method),
    commitTitle: `Task #${row.taskId ?? ''}: merge ${row.branchName ?? ''}`.trim(),
  });

  if (!result.ok) {
    const httpStatus = result.code === 'unsupported' ? 501
      : (result.code === 'conflict' || result.code === 'not_mergeable') ? 409
      : 502;
    return { ok: false, httpStatus, error: result.reason, code: result.code };
  }

  const updated = await markPullRequestMergedById(db, args.prId, args.tenantId, {
    mergeSha: result.sha ?? null,
    mergedBy: args.mergedBy ?? null,
  });

  await invalidatePullRequestDetail(
    env,
    args.prId,
    row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
  ).catch(() => { /* cache miss is fine */ });

  // Merge → ticket complete: the ONE place every merge path funnels through, so the
  // human "Approve & Merge", the AI Manager sweep and the green-CI auto-merge all
  // complete the linked ticket identically. Best-effort — a merged PR must not be
  // reported as failed just because the completion write hiccuped.
  if (row.taskId != null) {
    await completeTaskOnMerge(env, db, {
      tenantId: args.tenantId,
      taskId: row.taskId,
      actorUserId: args.mergedBy && !args.mergedBy.startsWith('manager:') ? args.mergedBy : null,
    }).catch(() => { /* completion is best-effort; the merge itself succeeded */ });
  }

  return { ok: true, merged: result.merged, branchUpdated, sha: result.sha, pullRequest: updated ?? row };
}
