import { reportCaughtError } from '../observability/caughtErrorReporter';
/**
 * openTaskPullRequest — open a PR for a task's accumulated workspace changes and
 * record it. Called when a task is marked Done: the agent host has pushed the
 * ticket branch through the git-proxy, and the API opens the PR server-side with
 * the decrypted credential (the token never leaves the server), records it, and
 * writes the PR back onto the task so the kanban card surfaces it.
 *
 * This is the shared core; {@link openDispatchPullRequest} delegates to it after
 * resolving a dispatch → task.
 */
import { eq, isNull, lt, type SQL } from 'drizzle-orm';
import { tasks } from '../../infrastructure/database/schema';
import { resolveDefaultRepoForTask } from './resolveDefaultRepo';
import { resolveRepoCredential, isResolveError } from './resolveRepoCredential';
import { createPullRequest, type OpenPrInput, type OpenPrResult } from './createPullRequest';
import { mergeBranchToBase, cloudAutoMergeRequiresGreen, cloudAutoMergeEnabled } from './mergeBranchToBase';
import { recordPullRequestRow, markPullRequestMergedById } from './recordPullRequestRow';
import { recordTaskPullRequest } from './recordTaskPullRequest';
import { runPullRequestSecurityStep } from '../security/pullRequestSecurityStep';
import { describeSecurityBlock } from '../security/prSecurityGate';
import { gateReason, type PinnedVerdict } from '../security/securityMergeGate';
import type { Env } from '../../env';
import { listSpanningRepoWrites, recordBindingPullRequest } from './taskRepoSet';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import type { Db } from '../../infrastructure/database/connection';

export interface OpenTaskPrInput {
  branch: string;
  base?: string;
  title?: string;
  body?: string;
}

export type OpenTaskPrResult =
  | { ok: true; url: string; number: number; merged: boolean; mergeError?: string;
      /** Extra PRs opened in the OTHER repos of a spanning task's set (0956). */
      spanning?: SpanningPullRequest[] }
  /** Another finalize path already claimed (or completed) this task's PR — no PR
   *  opened by THIS call. Not an error: the single-PR invariant held. */
  | { ok: false; status: 409; error: string; claimLost: true }
  | { ok: false; status: 400 | 404 | 409 | 501 | 502; error: string };

/** How long a PR-open claim may be held without a recorded PR before it counts as dead (one provider call plus one transaction). */
export const PR_CLAIM_STALE_MS = 5 * 60_000;

/** A claim stamped before this instant is stale. */
export function prClaimStaleBefore(now: Date): Date {
  return new Date(now.getTime() - PR_CLAIM_STALE_MS);
}

/**
 * Atomically claim the right to open this task's PR. Returns true for exactly one
 * concurrent caller (the row is updated only WHERE no claim and no URL yet); a
 * later/loser caller gets false and must NOT call the provider. The claim is
 * released by {@link releaseTaskPrClaim} if the subsequent create fails.
 */
export async function claimTaskPrOpen(db: Db, tenantId: number, taskId: number): Promise<boolean> {
  return (await takeTaskPrClaim(db, tenantId, taskId)).claimed;
}

/** What a caller learns from taking the claim: when (the owner's token for {@link releaseTaskPrClaim}) and whether it RETOOK a dead one. */
export interface TakenClaim { claimed: boolean; retook: boolean; at: Date }

/**
 * {@link claimTaskPrOpen} with the detail. A fresh claim (none held) and the retake of a STALE one (held with no PR,
 * past {@link PR_CLAIM_STALE_MS}: the opener died between the provider create and the record) are separate
 * statements, so the caller knows which it got — a retake means a PR for the branch may already exist that was ours.
 */
export async function takeTaskPrClaim(db: Db, tenantId: number, taskId: number): Promise<TakenClaim> {
  // Scoped on tasks.tenant_id (0944): a write this consequential (it decides who opens a PR) states its own scope.
  const at = new Date();
  const take = async (held: SQL) => (await db
    .update(tasks)
    .set({ prOpeningAt: at })
    .where(scopedToTenant(tasks, tenantId, eq(tasks.id, taskId), held, isNull(tasks.githubPrUrl)))
    .returning({ id: tasks.id })).length > 0;
  if (await take(isNull(tasks.prOpeningAt))) return { claimed: true, retook: false, at };
  if (await take(lt(tasks.prOpeningAt, prClaimStaleBefore(at)))) return { claimed: true, retook: true, at };
  return { claimed: false, retook: false, at };
}

/** Release a claim taken by {@link claimTaskPrOpen} when the PR-create failed, so a
 *  retry can re-claim. No-op once `github_pr_url` is set (success is permanent).
 *  With `claimedAt` only the claim THIS caller wrote is released: a slow opener whose claim was retaken must not
 *  free the claim of whoever retook it. */
export async function releaseTaskPrClaim(db: Db, tenantId: number, taskId: number, claimedAt?: Date): Promise<void> {
  await db
    .update(tasks)
    .set({ prOpeningAt: null })
    .where(scopedToTenant(tasks, tenantId, eq(tasks.id, taskId), isNull(tasks.githubPrUrl), ...(claimedAt ? [eq(tasks.prOpeningAt, claimedAt)] : [])))
    .catch((error) => { /* best-effort — a stale claim only blocks an auto-retry, never data */ 
      reportCaughtError(error, { source: "application/repos/openTaskPullRequest.ts", operation: "releaseTaskPrClaim" });
    });
}

/**
 * THE task PR-open step: claim → create on the provider → release the claim if the
 * create failed. Both finalize surfaces — {@link openTaskPullRequest} (Done-drag,
 * host and runtime routes) and the cloud run-end finalize (`finalizeCloudRun`) —
 * open a task's PR through this, so the single-PR invariant (0140) is enforced in
 * ONE place rather than re-sequenced by each caller. Recording the row and the
 * merge policy stay with the caller: they genuinely differ between surfaces.
 *
 * `claimLost` is not an error — another path holds (or completed) the claim.
 */
export async function openClaimedPullRequest(
  db: Db,
  tenantId: number,
  taskId: number,
  pr: OpenPrInput,
  /** Filled with the claim this call took (when it took one), for a caller that must know whether it retook a dead claim or release it as its owner. */
  claim?: { retook?: boolean; at?: Date },
): Promise<OpenPrResult | { ok: false; claimLost: true }> {
  const taken = await takeTaskPrClaim(db, tenantId, taskId);
  if (!taken.claimed) return { ok: false, claimLost: true };
  if (claim) { claim.retook = taken.retook; claim.at = taken.at; }
  const created = await createPullRequest(pr)
    .catch((error): OpenPrResult => ({ ok: false, code: 'provider_error', reason: error instanceof Error ? error.message : 'pr failed' }));
  // Release so a manual/automatic retry can re-attempt the create.
  if (!created.ok) await releaseTaskPrClaim(db, tenantId, taskId, taken.at);
  return created;
}

export async function openTaskPullRequest(
  db: Db,
  secret: string,
  tenantId: number,
  taskId: number,
  input: OpenTaskPrInput,
  /** Pass the worker env so the "merge only on green CI" gate is honored. When
   *  omitted, the default full-auto-merge policy applies (immediate merge). */
  env?: unknown,
): Promise<OpenTaskPrResult> {
  if (!input.branch || typeof input.branch !== 'string') {
    return { ok: false, status: 400, error: 'branch is required' };
  }

  const repoRef = await resolveDefaultRepoForTask(db, tenantId, taskId);
  if (!repoRef) return { ok: false, status: 409, error: 'No repo bound to this task' };

  const resolved = await resolveRepoCredential(db, secret, tenantId, repoRef.repoId);
  if (isResolveError(resolved)) return { ok: false, status: resolved.status, error: resolved.error };

  const base = (input.base ?? resolved.repo.defaultBranch ?? 'main').trim();
  const title = (input.title ?? '').trim() || `BuilderForce changes for task #${taskId}`;
  const prBody = (input.body ?? '').trim() || `Automated changes for task #${taskId}.`;

  // Atomic single-PR claim (0140) — taken BEFORE the external create so two
  // concurrent finalize paths (inline run-end + human Done-drag) can't both open a
  // PR. A lost claim is NOT an error: the invariant held, another path is opening it.
  const pr = await openClaimedPullRequest(db, tenantId, taskId, {
    provider: resolved.repo.provider,
    host: resolved.repo.host,
    owner: resolved.repo.owner,
    repo: resolved.repo.repo,
    token: resolved.token,
    head: input.branch.trim(),
    base,
    title,
    body: prBody,
  });
  if (!pr.ok) {
    if ('claimLost' in pr) return { ok: false, status: 409, error: 'PR already being opened for this task', claimLost: true };
    return { ok: false, status: pr.code === 'unsupported' ? 501 : 502, error: pr.reason };
  }

  // Merge policy. DEFAULT (CLOUD_AUTOMERGE_ENABLED off): do NOT merge — leave the
  // PR open for in-product human approval. When auto-merge is enabled: wait for
  // green CI by default (`CLOUD_AUTOMERGE_REQUIRE_GREEN`, opt out with 0/false/off)
  // rather than merging unverified code; the CI-success webhook ships it. Best-effort
  // — a conflict/failure leaves the PR open for manual resolution rather than
  // blocking the finalize.
  //
  // SECURITY (PRD 08 §10): the PR row is recorded 'open' FIRST so the post-PR security step has a
  // row to link its scans to, and the SAME gate cloudFinalize / the CI-merge path / the merge sweep
  // consult runs before `mergeBranchToBase`. Fails closed: no `env` (the step needs it) or a step
  // that did not run means no immediate merge. A merged PR is stamped through
  // `markPullRequestMergedById`, the one place a merge becomes a merge.
  // The row AND the task's PR stamp, in one transaction (`recordTaskPullRequest`).
  const prRow = await recordTaskPullRequest(db, {
    tenantId,
    segmentId: resolved.repo.segmentId,
    projectId: resolved.repo.projectId,
    repoId: resolved.repo.id,
    taskId,
    provider: resolved.repo.provider,
    number: pr.number,
    url: pr.url,
    branchName: input.branch.trim(),
    baseBranch: base,
    status: 'open',
  }).catch(async (error) => {
    // The PR EXISTS on the provider: report the failed record, still stamp the task so the card shows it, and return success with the URL.
    reportCaughtError(error, { source: 'application/repos/openTaskPullRequest.ts', operation: 'recordTaskPullRequest' });
    await db.update(tasks)
      .set({ githubPrUrl: pr.url, githubPrNumber: pr.number, gitBranch: input.branch.trim(), updatedAt: new Date() })
      .where(scopedToTenant(tasks, tenantId, eq(tasks.id, taskId)))
      .catch((stampError) => reportCaughtError(stampError, { source: 'application/repos/openTaskPullRequest.ts', operation: 'stampTaskPr' }));
    return null;
  });

  let securityVerdict: PinnedVerdict = { allow: false, reasons: [gateReason('step_not_run', 'the security step has not run')], headSha: null };
  if (env && prRow?.id) {
    const step = await runPullRequestSecurityStep(env as Env, db, {
      tenantId, segmentId: resolved.repo.segmentId, pullRequestId: prRow.id, prNumber: pr.number, prUrl: pr.url,
      executionId: null, agentLabel: 'task Done',
      read: {
        provider: resolved.repo.provider, host: resolved.repo.host, owner: resolved.repo.owner,
        repo: resolved.repo.repo, token: resolved.token, ref: input.branch.trim(),
      },
      base,
    });
    securityVerdict = step.verdict;
  } else {
    securityVerdict = { allow: false, reasons: [gateReason('step_unavailable', 'the security scan could not run for this PR (no runtime environment or PR row)')], headSha: null };
  }

  const merge = !cloudAutoMergeEnabled(env)
    ? { ok: false as const, code: 'provider_error' as const, reason: 'deferred: awaiting in-product approval' }
    : cloudAutoMergeRequiresGreen(env)
    ? { ok: false as const, code: 'provider_error' as const, reason: 'deferred: merge on green CI' }
    : !securityVerdict.allow
    ? { ok: false as const, code: 'provider_error' as const, reason: `deferred: ${describeSecurityBlock(securityVerdict)}` }
    : await mergeBranchToBase({
        provider: resolved.repo.provider,
        host: resolved.repo.host,
        owner: resolved.repo.owner,
        repo: resolved.repo.repo,
        token: resolved.token,
        base,
        head: input.branch.trim(),
        message: `${title} (BuilderForce auto-merge)`,
        // Merge exactly the commit the gate verified; a head that moved since is a non-merge (`head_moved`).
        expectedHeadSha: securityVerdict.headSha,
      });
  if (merge.ok && prRow?.id) {
    await markPullRequestMergedById(db, prRow.id, tenantId, { mergeSha: merge.sha ?? null, env: env as Env | undefined })
      .catch((error) => reportCaughtError(error, { source: 'application/repos/openTaskPullRequest.ts', operation: 'openTaskPullRequest' }));
  }

  // MULTI-REPO (0956): the primary PR is open; now open one per OTHER repo in the
  // task's set that actually received writes. No-op for a single-repo task.
  const spanning = await openTaskRepoSetPullRequests(db, secret, tenantId, taskId, resolved.repo.id, {
    title, body: prBody,
  }).catch((error) => {
    reportCaughtError(error, { source: 'application/repos/openTaskPullRequest.ts', operation: 'openTaskPullRequest' });
    return [] as SpanningPullRequest[];
  });

  return {
    ok: true, url: pr.url, number: pr.number, merged: merge.ok,
    mergeError: merge.ok ? undefined : merge.reason,
    ...(spanning.length ? { spanning } : {}),
  };
}

/** One extra repo's PR, opened because that repo actually received writes. */
export interface SpanningPullRequest {
  repoId: string;
  slug: string;
  branch: string;
  url?: string;
  number?: number;
  /** Present instead of url/number when the provider refused. */
  error?: string;
}

/**
 * MULTI-REPO SPANNING (0956): open a PR in every OTHER repo of this task's bound
 * set that received writes.
 *
 * The task's PRIMARY repo keeps the existing single-PR path above (atomic claim,
 * `tasks.github_pr_url`, auto-merge policy) — untouched. This is only the tail: a
 * task bound to 2+ repos gets one branch and one PR *per repo that got code*, and
 * a bound repo that received nothing gets nothing. Both finalize surfaces (the
 * inline cloud finalize and the human "Done" drag through {@link
 * openTaskPullRequest}) call this so a spanning run cannot open its extra PRs on
 * one path and silently drop them on the other.
 *
 * Best-effort by construction: a failure here never fails the run — the primary
 * PR is already open and the extra branch is already pushed, so the worst case is
 * a PR a human opens by hand, reported in the returned list.
 */
export async function openTaskRepoSetPullRequests(
  db: Db,
  secret: string,
  tenantId: number,
  taskId: number,
  primaryRepoId: string | null,
  input: { title: string; body: string },
): Promise<SpanningPullRequest[]> {
  const pending = await listSpanningRepoWrites(db, tenantId, taskId, primaryRepoId).catch(() => []);
  if (pending.length === 0) return [];  // single-repo task, or nothing else was written

  const opened: SpanningPullRequest[] = [];
  for (const binding of pending) {
    const slug = `${binding.owner}/${binding.repo}`;
    const branch = binding.branch?.trim();
    if (!branch) continue;  // no branch pinned ⇒ nothing was pushed here
    const resolved = await resolveRepoCredential(db, secret, tenantId, binding.repoId);
    if (isResolveError(resolved)) {
      opened.push({ repoId: binding.repoId, slug, branch, error: resolved.error });
      continue;
    }
    const base = (binding.defaultBranch ?? resolved.repo.defaultBranch ?? 'main').trim();
    const pr = await createPullRequest({
      provider: resolved.repo.provider,
      host: resolved.repo.host,
      owner: resolved.repo.owner,
      repo: resolved.repo.repo,
      token: resolved.token,
      head: branch,
      base,
      title: input.title,
      body: input.body,
    }).catch(() => ({ ok: false as const, code: 'provider_error' as const, reason: 'pr failed' }));
    if (!pr.ok) {
      opened.push({ repoId: binding.repoId, slug, branch, error: pr.reason });
      continue;
    }
    await recordPullRequestRow(db, {
      tenantId,
      segmentId: resolved.repo.segmentId,
      projectId: resolved.repo.projectId,
      repoId: resolved.repo.id,
      taskId,
      provider: resolved.repo.provider,
      number: pr.number,
      url: pr.url,
      branchName: branch,
      baseBranch: base,
      status: 'open',
    }).catch((error) => {
      reportCaughtError(error, { source: 'application/repos/openTaskPullRequest.ts', operation: 'openTaskRepoSetPullRequests' });
      return null;
    });
    await recordBindingPullRequest(db, tenantId, taskId, binding.repoId, {
      url: pr.url, number: pr.number, status: 'open',
    }).catch((error) => reportCaughtError(error, { source: 'application/repos/openTaskPullRequest.ts', operation: 'openTaskRepoSetPullRequests' }));
    opened.push({ repoId: binding.repoId, slug, branch, url: pr.url, number: pr.number });
  }
  return opened;
}
