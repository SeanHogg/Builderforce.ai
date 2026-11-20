/**
 * mergeGrants — a person's "merge into main" grant for ONE cloud run (PRD 48 §4.6).
 *
 * A security fix or a high-priority feature must not wait for the manager. A PERSON with the
 * in-product merge role ({@link PR_MERGE_MIN_ROLE}) may grant, from the web app's run control,
 * that the run's pull request merges into the base branch once its checks pass. The grant is a
 * PRE-APPROVED HUMAN MERGE: it applies exactly the in-product Merge button's checks
 * (`humanMergeGate`) plus green CI, and overrides the project's merge settings as that button does.
 *
 *   - WHO: only a person, from the web UI — never an agent tool, an API key, a device client, a run
 *     or a machine caller ({@link mergeGrantRefusal}). Re-checked at merge time: a granter who has
 *     since left the workspace or lost the merge role voids it (`granter_revoked`).
 *   - WHERE: a CLOUD run on a single-repo ticket ({@link mergeGrantDispatchRefusal}).
 *   - WHAT: the PR this execution opened (or the ticket's open PR a re-run pushed onto), pinned to
 *     the LAST COMMIT THE RUN ITSELF PUSHED, proven by the SHA its provider returned, never by a
 *     commit message ({@link bindGrantToThisRunsPr}); every commit ahead of base must be one the
 *     platform recorded for a run of this ticket — so a later ungranted re-run's PR, a person's
 *     push, and commits pushed after the run cannot ride on it.
 *   - VOID: run ended without its PR, cancelled, failed (incl. before finalize — the terminal
 *     hook), the PR's head moved past the pin, the PR closed unmerged, the granter was revoked, or
 *     seven days passed.
 *   - ONCE: the sweep claims the grant atomically before merging ({@link claimMergeGrant}) and
 *     releases it only on a DEFINITE provider refusal.
 */
import { and, asc, eq, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import type { ShipPolicy } from '@builderforce/run-guards';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { mergeGrantPullRequests, mergeGrants, pullRequests, taskFileChanges, tasks } from '../../infrastructure/database/schema';
import { acrossTenants, scopedToTenant } from '../../infrastructure/database/tenantScope';
import { hasMinRole } from '../../domain/shared/types';
import { recordActivity, type ActorIdentity } from '../activity/activityLog';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { PR_MERGE_MIN_ROLE } from '../repos/prMergeAuthority';
import { getCloudShipPolicy } from '../manager/managerPolicyStore';
import { resolvePullRequestHead } from '../security/prSecurityGate';
import { listTaskRepoBindings } from '../repos/taskRepoSet';
import type { BranchCommit } from '../repos/branchLifecycle';
import { resolveTenantMembership } from '../auth/tenantMembership';
import { reconcilePullRequestState } from '../repos/reconcilePullRequestState';
import { wouldRunOnHost } from './runHostBinding';

/** The journal type the sweep writes when it HOLDS a granted merge (the PR timeline line). */
export const MERGE_GRANT_HELD_ACTION = 'merge_grant_held';

/** The longest reason stored — a sentence or two, not a document. */
export const MERGE_GRANT_REASON_MAX = 2000;

/** A grant expires this long after it was given — a hotfix grant is not a standing permission. */
export const MERGE_GRANT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Why the sweep is holding a bound PR right now — a code the UI words. */
export type MergeGrantHoldCode = 'ci_pending' | 'ci_failed' | 'security' | 'merge_refused';

/** Why a grant can no longer apply — a code the UI words. */
export type MergeGrantVoidCode =
  | 'cancelled' | 'run_failed' | 'no_pull_request' | 'head_moved' | 'no_head'
  | 'pr_closed' | 'expired' | 'granter_revoked' | 'foreign_commits';

/** Who is asking — read off the request's authenticated identity. */
export interface MergeGrantCaller {
  role: string | null | undefined;
  /** Set for a machine token (an agent host, a run principal). */
  machineActor?: unknown;
  /** Set when the call is made on an agent's behalf (a replayed tool call carries `agt`). */
  agentActorRef?: string | null;
  /** Set when the call is authenticated by an API key rather than a person's session. */
  apiKeyId?: unknown;
  /** Set for a device client (VS Code, CLI, …) — a grant comes from the web app only. */
  clientSurface?: string | null;
}

/**
 * Why this caller may NOT grant a merge, or null when it may. A person's own web session only,
 * with the in-product merge role — the same tier `POST /pull-requests/:id/merge` requires.
 */
export function mergeGrantRefusal(caller: MergeGrantCaller): string | null {
  if (caller.machineActor || caller.agentActorRef) {
    return 'A merge grant can only be given by a person. A run or an agent cannot grant itself (or another run) a merge into main.';
  }
  if (caller.apiKeyId != null || caller.clientSurface) {
    return 'A merge grant can only be given by a person from the web app\'s run control — not through an API key or another client.';
  }
  if (!hasMinRole(caller.role ?? null, PR_MERGE_MIN_ROLE)) {
    return `Granting a merge into main needs the role that may merge a pull request in-product (at least '${PR_MERGE_MIN_ROLE}').`;
  }
  return null;
}

export type MergeGrantDispatchRefusal = { code: 'merge_grant_not_cloud' | 'merge_grant_multi_repo'; error: string };

/**
 * Why THIS dispatch may not carry a grant, or null. Asked before anything is dispatched:
 *   - the run must be a CLOUD run — decided by the dispatcher's own routing rule
 *     (`runHostBinding.wouldRunOnHost`: the pinned host, the task's host, the agent's runtime);
 *   - the ticket must span ONE repository — a spanning ticket opens several PRs, and a grant
 *     covers exactly the run's one PR.
 */
export async function mergeGrantDispatchRefusal(
  env: Env, db: Db,
  a: { tenantId: number; taskId: number; agentHostId?: number | null; payload?: string },
): Promise<MergeGrantDispatchRefusal | null> {
  const [task] = await db
    .select({ assignedAgentHostId: tasks.assignedAgentHostId, assignedAgentRef: tasks.assignedAgentRef })
    .from(tasks)
    .where(scopedToTenant(tasks, a.tenantId, eq(tasks.id, a.taskId)))
    .limit(1);
  if (!task) return null;
  if (await wouldRunOnHost(env, a.tenantId, { agentHostId: a.agentHostId ?? null, task, payload: a.payload })) {
    return {
      code: 'merge_grant_not_cloud',
      error: 'A merge grant applies to cloud runs only. This run would execute on an on-prem agent host; merge its pull request in-product instead.',
    };
  }
  const repos = await listTaskRepoBindings(db, a.tenantId, a.taskId);
  if (repos.length > 1) {
    return {
      code: 'merge_grant_multi_repo',
      error: 'A merge grant covers one pull request. This ticket spans several repositories; merge each pull request in-product instead.',
    };
  }
  return null;
}

/** The grant row for an execution, or null. */
export async function loadMergeGrant(
  db: Db, tenantId: number, executionId: number,
): Promise<{ id: string; grantedBy: string | null; reason: string; createdAt: Date; consumedAt: Date | null; voidedAt: Date | null } | null> {
  const [row] = await db
    .select({
      id: mergeGrants.id, grantedBy: mergeGrants.grantedBy, reason: mergeGrants.reason,
      createdAt: mergeGrants.createdAt, consumedAt: mergeGrants.consumedAt, voidedAt: mergeGrants.voidedAt,
    })
    .from(mergeGrants)
    .where(and(eq(mergeGrants.tenantId, tenantId), eq(mergeGrants.executionId, executionId)))
    .limit(1);
  return row ?? null;
}

/**
 * Record a grant for an execution and audit it on the shared activity timeline. Idempotent
 * per execution (the first grant stands). The caller has already passed {@link mergeGrantRefusal}
 * and {@link mergeGrantDispatchRefusal}.
 */
export async function recordMergeGrant(
  env: Env | undefined, db: Db,
  a: { tenantId: number; executionId: number; grantedBy: string; reason: string; actor: ActorIdentity; projectId?: number | null },
): Promise<void> {
  const reason = a.reason.trim().slice(0, MERGE_GRANT_REASON_MAX);
  await db.insert(mergeGrants)
    .values({ tenantId: a.tenantId, executionId: a.executionId, grantedBy: a.grantedBy, grantedByLabel: a.actor.name || a.grantedBy, reason })
    .onConflictDoNothing({ target: mergeGrants.executionId });
  await recordActivity(env, db, {
    tenantId: a.tenantId,
    projectId: a.projectId ?? null,
    actor: a.actor,
    verb: 'merge_grant.created',
    targetType: 'execution',
    targetId: a.executionId,
    summary: `Granted a merge into main for run #${a.executionId} once its security scan and CI pass: ${reason}`,
    metadata: { executionId: a.executionId, reason },
  }).catch((error) => {
    reportCaughtError(error, { source: 'application/runtime/mergeGrants.ts', operation: 'recordMergeGrant.activity', context: { tenantId: a.tenantId, executionId: a.executionId } });
  });
}

/**
 * The commits the PLATFORM wrote on a ticket's branch, by SHA → the execution that wrote each:
 * the SHAs its providers returned for the runs' own writes (`task_file_changes.commit_sha`).
 * This — never a commit message — is the proof a commit is a run's: a subject marker is a public
 * string anyone with push access can type.
 */
export async function recordedRunCommits(db: Db, tenantId: number, taskId: number): Promise<Map<string, number>> {
  const rows = await db
    .select({ sha: taskFileChanges.commitSha, executionId: taskFileChanges.executionId })
    .from(taskFileChanges)
    .where(and(eq(taskFileChanges.tenantId, tenantId), eq(taskFileChanges.taskId, taskId), isNotNull(taskFileChanges.commitSha)))
    .limit(5000);
  const out = new Map<string, number>();
  for (const r of rows) if (r.sha) out.set(r.sha.toLowerCase(), r.executionId);
  return out;
}

/**
 * Finalize's half of the binding: bind this run's grant to the PR it opened (or the ticket's open
 * PR a re-run pushed onto), pinned to the LAST COMMIT THIS RUN PUSHED.
 *
 * Proof by SHA, never by text: the PR's head must be a commit whose SHA the provider returned for
 * one of THIS execution's own writes ({@link recordedRunCommits}), else the grant voids
 * `head_moved`. And EVERY commit ahead of base (finalize's complete branch listing) must be one the
 * platform recorded for a run of this ticket, else it voids `foreign_commits` — a squash merge
 * would carry a person's or an unrecorded commit into main under this grant. No listing or no
 * readable head voids it `no_head`. Returns true when the grant was settled here — bound or
 * voided — so finalize does not void it again as "no pull request".
 */
export async function bindGrantToThisRunsPr(
  env: Env, db: Db,
  a: { tenantId: number; executionId: number; taskId: number; prRowId: string; headSha: string | null; runCommits: readonly BranchCommit[] | null },
): Promise<boolean> {
  try {
    const grant = await loadMergeGrant(db, a.tenantId, a.executionId);
    if (!grant || grant.consumedAt || grant.voidedAt) return false;
    const voidWith = async (reason: MergeGrantVoidCode) => {
      await voidMergeGrant(db, { tenantId: a.tenantId, executionId: a.executionId, reason });
      return true;
    };
    if (!a.runCommits) return voidWith('no_head');
    const head = (a.headSha ?? await resolvePullRequestHead(db, env, a.tenantId, a.prRowId).then((h) => (h.ok ? h.sha : null)))?.toLowerCase() ?? null;
    if (!head) return voidWith('no_head');
    const recorded = await recordedRunCommits(db, a.tenantId, a.taskId);
    const listed = a.runCommits.map((c) => c.sha?.toLowerCase() ?? '');
    if (!listed.includes(head) || recorded.get(head) !== a.executionId) return voidWith('head_moved');
    if (listed.some((sha) => !sha || !recorded.has(sha))) return voidWith('foreign_commits');
    await db.insert(mergeGrantPullRequests)
      .values({ tenantId: a.tenantId, grantId: grant.id, pullRequestId: a.prRowId, headSha: head })
      .onConflictDoUpdate({
        target: [mergeGrantPullRequests.grantId, mergeGrantPullRequests.pullRequestId],
        set: { headSha: head, holdCode: null },
      });
    return true;
  } catch (error) {
    reportCaughtError(error, { source: 'application/runtime/mergeGrants.ts', operation: 'bindGrantToThisRunsPr', context: { tenantId: a.tenantId, executionId: a.executionId } });
    return false;
  }
}

/** Void a run's live grant — it can no longer apply. A no-op when the run has none. */
export async function voidMergeGrant(
  db: Db, a: { tenantId: number; reason: MergeGrantVoidCode } & ({ executionId: number } | { grantId: string }),
): Promise<void> {
  await db.update(mergeGrants)
    .set({ voidedAt: new Date(), voidReason: a.reason })
    .where(and(
      eq(mergeGrants.tenantId, a.tenantId),
      'grantId' in a ? eq(mergeGrants.id, a.grantId) : eq(mergeGrants.executionId, a.executionId),
      isNull(mergeGrants.consumedAt), isNull(mergeGrants.voidedAt),
    ));
}

/**
 * THE terminal hook: a run that lands anything but `completed` voids its grant — unless that grant
 * is already bound to a PR (the merge of an opened PR stands on its own evidence). Covers a run that
 * fails before finalize, an approval-gate rejection and an admission refusal after the grant write.
 */
export async function voidUnboundGrantOnTerminal(
  db: Db, e: { id: unknown; tenantId: unknown; status: string },
): Promise<void> {
  if (e.status === 'completed') return;
  const reason: MergeGrantVoidCode = e.status === 'cancelled' ? 'cancelled' : 'run_failed';
  await db.update(mergeGrants)
    .set({ voidedAt: new Date(), voidReason: reason })
    .where(and(
      eq(mergeGrants.tenantId, Number(e.tenantId)),
      eq(mergeGrants.executionId, Number(e.id)),
      isNull(mergeGrants.consumedAt), isNull(mergeGrants.voidedAt),
      sql`not exists (select 1 from ${mergeGrantPullRequests} where ${mergeGrantPullRequests.grantId} = ${mergeGrants.id})`,
    ));
}

/**
 * CLAIM a grant for one merge, atomically: only the caller whose update flips `consumed_at`
 * from null may merge. Concurrent sweeps — or two PRs bound to one grant — cannot both merge.
 */
export async function claimMergeGrant(db: Db, tenantId: number, grantId: string): Promise<boolean> {
  const claimed = await db.update(mergeGrants)
    .set({ consumedAt: new Date() })
    .where(and(eq(mergeGrants.tenantId, tenantId), eq(mergeGrants.id, grantId), isNull(mergeGrants.consumedAt), isNull(mergeGrants.voidedAt)))
    .returning({ id: mergeGrants.id });
  return claimed.length > 0;
}

/** Give a claimed grant back — ONLY after a definite provider refusal (the merge did not happen). */
export async function releaseMergeGrant(db: Db, tenantId: number, grantId: string): Promise<void> {
  await db.update(mergeGrants)
    .set({ consumedAt: null })
    .where(and(eq(mergeGrants.tenantId, tenantId), eq(mergeGrants.id, grantId)));
}

/** Record the sweep's CURRENT reason for holding a bound PR (null clears it). */
export async function setMergeGrantHold(db: Db, tenantId: number, bindingId: string, code: MergeGrantHoldCode | null): Promise<void> {
  await db.update(mergeGrantPullRequests)
    .set({ holdCode: code })
    .where(and(eq(mergeGrantPullRequests.tenantId, tenantId), eq(mergeGrantPullRequests.id, bindingId)));
}

/** Stamp that the sweep visited a grant — the cohort's rotation key. */
export async function touchMergeGrant(db: Db, tenantId: number, grantId: string): Promise<void> {
  await db.update(mergeGrants)
    .set({ lastConsideredAt: new Date() })
    .where(and(eq(mergeGrants.tenantId, tenantId), eq(mergeGrants.id, grantId)));
}

/**
 * Is the person who granted it STILL authorized to? A current active member of the tenant with
 * the in-product merge role. A deleted user (null `grantedBy`) is not.
 */
export async function granterStillAuthorized(env: Env, db: Db, tenantId: number, userId: string | null): Promise<boolean> {
  if (!userId) return false;
  const membership = await resolveTenantMembership(env, () => db, tenantId, userId);
  return !!membership && (membership.isSuperadmin || hasMinRole(membership.role, PR_MERGE_MIN_ROLE));
}

/**
 * Void live grants older than {@link MERGE_GRANT_TTL_MS}. The sweep spans tenants, so the stale
 * cohort is selected first and each grant is voided by its own tenant-scoped write (never one
 * unscoped cross-tenant UPDATE). Returns how many expired.
 */
export async function expireMergeGrants(db: Db, now: Date = new Date(), limit = 50): Promise<number> {
  const stale = await db
    .select({ grantId: mergeGrants.id, tenantId: mergeGrants.tenantId })
    .from(mergeGrants)
    .where(acrossTenants(mergeGrants, 'scheduled_sweep',
      isNull(mergeGrants.consumedAt), isNull(mergeGrants.voidedAt), lt(mergeGrants.createdAt, new Date(now.getTime() - MERGE_GRANT_TTL_MS))))
    .limit(limit);
  for (const g of stale) {
    await voidMergeGrant(db, { tenantId: g.tenantId, grantId: g.grantId, reason: 'expired' });
  }
  return stale.length;
}

/**
 * Settle live grants whose bound PRs are ALL no longer open: merged by someone else → the grant is
 * spent (`consumed_at`); closed unmerged → voided `pr_closed`. Returns how many were settled.
 */
export async function settleGrantsWithoutOpenPr(db: Db, limit = 50): Promise<number> {
  const rows = await db
    .select({
      grantId: mergeGrants.id, tenantId: mergeGrants.tenantId,
      anyMerged: sql<boolean>`bool_or(${pullRequests.status} = 'merged')`,
    })
    .from(mergeGrants)
    .innerJoin(mergeGrantPullRequests, and(eq(mergeGrantPullRequests.grantId, mergeGrants.id), eq(mergeGrantPullRequests.tenantId, mergeGrants.tenantId)))
    .innerJoin(pullRequests, and(eq(pullRequests.id, mergeGrantPullRequests.pullRequestId), eq(pullRequests.tenantId, mergeGrants.tenantId)))
    .where(acrossTenants(mergeGrants, 'scheduled_sweep', isNull(mergeGrants.consumedAt), isNull(mergeGrants.voidedAt)))
    .groupBy(mergeGrants.id, mergeGrants.tenantId)
    .having(sql`bool_and(${pullRequests.status} in ('merged', 'closed'))`)
    .limit(limit);
  for (const r of rows) {
    if (r.anyMerged) {
      await db.update(mergeGrants).set({ consumedAt: new Date() })
        .where(and(eq(mergeGrants.tenantId, r.tenantId), eq(mergeGrants.id, r.grantId), isNull(mergeGrants.consumedAt)));
    } else {
      await voidMergeGrant(db, { tenantId: r.tenantId, grantId: r.grantId, reason: 'pr_closed' });
    }
  }
  return rows.length;
}

/** A claim older than this with its PR still open is STUCK — the merge attempt died mid-way. */
export const MERGE_GRANT_STUCK_CLAIM_MS = 30 * 60 * 1000;

/**
 * Settle STUCK claims. The sweep keeps a claim when the merge THROWS (the merge may have landed),
 * so a throw before the provider was ever reached leaves a claimed grant over an open PR that
 * {@link settleGrantsWithoutOpenPr} (live grants only) never revisits — "pending" forever. For a
 * claim older than {@link MERGE_GRANT_STUCK_CLAIM_MS} whose bound PR is still open here, ask the
 * PROVIDER: merged → the reconcile records the merge and the grant stays spent; not merged → the
 * claim is released (back to live, so the cohort tries again) and reported. A provider that cannot
 * be reached leaves the claim for the next tick. Returns how many claims were settled.
 */
export async function reconcileStuckMergeClaims(env: Env, db: Db, now: Date = new Date(), limit = 10): Promise<number> {
  const stuck = await db
    .select({
      grantId: mergeGrants.id, tenantId: mergeGrants.tenantId, consumedAt: mergeGrants.consumedAt,
      id: pullRequests.id, number: pullRequests.number, repoId: pullRequests.repoId,
      status: pullRequests.status, updatedAt: pullRequests.updatedAt,
    })
    .from(mergeGrants)
    .innerJoin(mergeGrantPullRequests, and(eq(mergeGrantPullRequests.grantId, mergeGrants.id), eq(mergeGrantPullRequests.tenantId, mergeGrants.tenantId)))
    .innerJoin(pullRequests, and(eq(pullRequests.id, mergeGrantPullRequests.pullRequestId), eq(pullRequests.tenantId, mergeGrants.tenantId)))
    .where(acrossTenants(mergeGrants, 'scheduled_sweep',
      isNotNull(mergeGrants.consumedAt), isNull(mergeGrants.voidedAt), eq(pullRequests.status, 'open'),
      lt(mergeGrants.consumedAt, new Date(now.getTime() - MERGE_GRANT_STUCK_CLAIM_MS))))
    .limit(limit);
  let settled = 0;
  for (const s of stuck) {
    const state = await reconcilePullRequestState(env, db, s.tenantId, s, { forceFresh: true });
    if (!state.checked) continue;
    settled += 1;
    if (state.providerState === 'merged') continue;
    await releaseMergeGrant(db, s.tenantId, s.grantId);
    reportCaughtError(new Error('merge grant claim was stuck with its pull request unmerged; released'), {
      source: 'application/runtime/mergeGrants.ts', operation: 'reconcileStuckMergeClaims', level: 'warning',
      context: { tenantId: s.tenantId, grantId: s.grantId, pullRequestId: s.id, providerState: state.providerState, claimedAt: s.consumedAt?.toISOString() ?? null },
    });
  }
  return settled;
}

/** Does this task have an open PR bound to a LIVE grant — i.e. a PR in the sweep's granted cohort? */
export async function taskHasBoundMergeGrant(db: Db, tenantId: number, taskId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: mergeGrantPullRequests.id })
    .from(mergeGrantPullRequests)
    .innerJoin(mergeGrants, and(eq(mergeGrants.id, mergeGrantPullRequests.grantId), eq(mergeGrants.tenantId, mergeGrantPullRequests.tenantId)))
    .innerJoin(pullRequests, and(eq(pullRequests.id, mergeGrantPullRequests.pullRequestId), eq(pullRequests.tenantId, mergeGrantPullRequests.tenantId)))
    .where(and(
      eq(mergeGrantPullRequests.tenantId, tenantId), eq(pullRequests.taskId, taskId), eq(pullRequests.status, 'open'),
      isNull(mergeGrants.consumedAt), isNull(mergeGrants.voidedAt),
    ))
    .limit(1);
  return !!row;
}

/**
 * Which of these PRs are bound to a LIVE grant. The MANAGED queue skips them: its base sync and
 * conflict recovery would move the head off the commit the person granted (PRD 48 §4.6).
 */
export async function prsBoundToLiveGrants(db: Db, tenantId: number, prIds: readonly string[]): Promise<Set<string>> {
  if (prIds.length === 0) return new Set();
  const rows = await db
    .select({ prId: mergeGrantPullRequests.pullRequestId })
    .from(mergeGrantPullRequests)
    .innerJoin(mergeGrants, and(eq(mergeGrants.id, mergeGrantPullRequests.grantId), eq(mergeGrants.tenantId, mergeGrantPullRequests.tenantId)))
    .where(and(
      eq(mergeGrantPullRequests.tenantId, tenantId),
      inArray(mergeGrantPullRequests.pullRequestId, [...prIds]),
      isNull(mergeGrants.consumedAt), isNull(mergeGrants.voidedAt),
    ));
  return new Set(rows.map((r) => r.prId));
}

/** A granted run's ship policy: the platform merges its PR on green, by a person's authority. */
export function grantedShipPolicy(base: ShipPolicy): ShipPolicy {
  return { ...base, mode: 'pull_request', merge: 'on_green', source: 'person_grant' };
}

/**
 * THE cloud run's ship policy: the project's (`getCloudShipPolicy`), or — when a person granted
 * this execution a merge — {@link grantedShipPolicy}. A failed grant read is reported and the
 * project's policy stands (the sweep, which reads the grant itself, is unaffected).
 */
export async function cloudRunShipPolicy(
  db: Db, tenantId: number, projectId: number, executionId: number, env?: Env,
): Promise<ShipPolicy> {
  const [base, grant] = await Promise.all([
    getCloudShipPolicy(db, tenantId, projectId, env),
    loadMergeGrant(db, tenantId, executionId).catch((error) => {
      reportCaughtError(error, { source: 'application/runtime/mergeGrants.ts', operation: 'cloudRunShipPolicy', context: { tenantId, executionId } });
      return null;
    }),
  ]);
  return grant && !grant.consumedAt && !grant.voidedAt ? grantedShipPolicy(base) : base;
}

/** The grant as the run view shows it — codes the UI words, derived from CURRENT state. */
export interface MergeGrantView {
  grantedBy: string | null;
  grantedByName: string;
  reason: string;
  createdAt: Date;
  status: 'pending' | 'merged' | 'held' | 'voided';
  /** Set when `status` is `held`. */
  heldCode: MergeGrantHoldCode | null;
  /** Set when `status` is `voided`. */
  voidCode: MergeGrantVoidCode | null;
}

/**
 * The grant for an execution, with who granted it and where it stands — null when it has none.
 * `merged` is read off a bound PR row that IS merged — never off `consumed_at` alone, which a
 * claim sets before the provider answers.
 */
export async function mergeGrantView(db: Db, tenantId: number, executionId: number): Promise<MergeGrantView | null> {
  const [row] = await db
    .select({
      id: mergeGrants.id, grantedBy: mergeGrants.grantedBy, grantedByLabel: mergeGrants.grantedByLabel, reason: mergeGrants.reason,
      createdAt: mergeGrants.createdAt, voidedAt: mergeGrants.voidedAt, voidReason: mergeGrants.voidReason,
    })
    .from(mergeGrants)
    .where(and(eq(mergeGrants.tenantId, tenantId), eq(mergeGrants.executionId, executionId)))
    .limit(1);
  if (!row) return null;
  const base = {
    grantedBy: row.grantedBy, grantedByName: row.grantedByLabel, reason: row.reason, createdAt: row.createdAt,
    heldCode: null, voidCode: null,
  };
  const bindings = await db
    .select({ holdCode: mergeGrantPullRequests.holdCode, prStatus: pullRequests.status })
    .from(mergeGrantPullRequests)
    .innerJoin(pullRequests, and(eq(pullRequests.id, mergeGrantPullRequests.pullRequestId), eq(pullRequests.tenantId, mergeGrantPullRequests.tenantId)))
    .where(and(eq(mergeGrantPullRequests.tenantId, tenantId), eq(mergeGrantPullRequests.grantId, row.id)))
    .orderBy(asc(mergeGrantPullRequests.createdAt));
  if (bindings.some((b) => b.prStatus === 'merged')) return { ...base, status: 'merged' };
  if (row.voidedAt) return { ...base, status: 'voided', voidCode: (row.voidReason as MergeGrantVoidCode | null) ?? null };
  const held = bindings.find((b) => b.holdCode);
  return held?.holdCode
    ? { ...base, status: 'held', heldCode: held.holdCode as MergeGrantHoldCode }
    : { ...base, status: 'pending' };
}
