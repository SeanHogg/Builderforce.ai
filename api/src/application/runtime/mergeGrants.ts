/**
 * mergeGrants — a person's "merge into main" grant for ONE cloud run (PRD 48 §4.6).
 *
 * A security fix or a high-priority feature must not wait for the manager. A PERSON with the
 * in-product merge role ({@link PR_MERGE_MIN_ROLE}) may grant, from the web app's run control,
 * that the run's pull request merges into the base branch once its checks pass. The grant is a
 * PRE-APPROVED HUMAN MERGE: it applies exactly the in-product Merge button's checks
 * (`humanMergeGate`) plus green CI, and overrides the project's merge settings as that button does.
 *
 *   - WHO: only a person, from the web UI — never an agent tool, a run or a machine caller.
 *   - WHAT: the PR(s) THIS execution opened, pinned to the head its finalize saw
 *     ({@link bindMergeGrantToRunPr}) — never the ticket, so a later ungranted re-run's PR and
 *     commits pushed after the run cannot ride on it.
 *   - VOID: when the run ends without a PR or is cancelled ({@link voidMergeGrant}), or when the
 *     bound PR's head moves past the pinned commit (the sweep voids it).
 *   - ONCE: the sweep claims the grant atomically before merging ({@link claimMergeGrant}) and
 *     releases it if the merge fails.
 */
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { ShipPolicy } from '@builderforce/run-guards';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { mergeGrantPullRequests, mergeGrants, pullRequests, users } from '../../infrastructure/database/schema';
import { hasMinRole } from '../../domain/shared/types';
import { recordActivity, type ActorIdentity } from '../activity/activityLog';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { PR_MERGE_MIN_ROLE } from '../repos/prMergeAuthority';
import { getCloudShipPolicy } from '../manager/managerPolicyStore';
import { resolvePullRequestHead } from '../security/prSecurityGate';

/** The journal type the sweep writes when it HOLDS a granted merge (the PR timeline line). */
export const MERGE_GRANT_HELD_ACTION = 'merge_grant_held';

/** The longest reason stored — a sentence or two, not a document. */
export const MERGE_GRANT_REASON_MAX = 2000;

/** Why the sweep is holding a bound PR right now — a code the UI words. */
export type MergeGrantHoldCode = 'ci_pending' | 'ci_failed' | 'security' | 'merge_refused';

/** Why a grant can no longer apply — a code the UI words. */
export type MergeGrantVoidCode = 'cancelled' | 'no_pull_request' | 'head_moved' | 'no_head';

/** Who is asking — read off the request's authenticated identity. */
export interface MergeGrantCaller {
  role: string | null | undefined;
  /** Set for a machine token (an agent host, a run principal). */
  machineActor?: unknown;
  /** Set when the call is made on an agent's behalf (a replayed tool call carries `agt`). */
  agentActorRef?: string | null;
}

/**
 * Why this caller may NOT grant a merge, or null when it may. A person only, with the
 * in-product merge role — the same tier `POST /pull-requests/:id/merge` requires.
 */
export function mergeGrantRefusal(caller: MergeGrantCaller): string | null {
  if (caller.machineActor || caller.agentActorRef) {
    return 'A merge grant can only be given by a person. A run or an agent cannot grant itself (or another run) a merge into main.';
  }
  if (!hasMinRole(caller.role ?? null, PR_MERGE_MIN_ROLE)) {
    return `Granting a merge into main needs the role that may merge a pull request in-product (at least '${PR_MERGE_MIN_ROLE}').`;
  }
  return null;
}

/** A grant is for a CLOUD run only: an on-prem host opens its PR on its own, outside the run's finalize binding. */
export function mergeGrantTargetRefusal(agentHostId: number | null | undefined): string | null {
  return agentHostId != null
    ? 'A merge grant applies to cloud runs only. This run targets an on-prem agent host; merge its pull request in-product instead.'
    : null;
}

/** The grant row for an execution, or null. */
export async function loadMergeGrant(
  db: Db, tenantId: number, executionId: number,
): Promise<{ id: string; grantedBy: string; reason: string; createdAt: Date; consumedAt: Date | null; voidedAt: Date | null } | null> {
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
 * per execution (the first grant stands). The caller has already passed
 * {@link mergeGrantRefusal} and {@link mergeGrantTargetRefusal}.
 */
export async function recordMergeGrant(
  env: Env | undefined, db: Db,
  a: { tenantId: number; executionId: number; grantedBy: string; reason: string; actor: ActorIdentity; projectId?: number | null },
): Promise<void> {
  const reason = a.reason.trim().slice(0, MERGE_GRANT_REASON_MAX);
  await db.insert(mergeGrants)
    .values({ tenantId: a.tenantId, executionId: a.executionId, grantedBy: a.grantedBy, reason })
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
 * Bind a granted run's grant to the pull request THAT RUN opened, pinned to the head its
 * finalize saw. A no-op for a run with no live grant. Re-binding the same PR moves the pin
 * to this finalize's head (a granted run is the only writer of its own PR's pin).
 */
export async function bindMergeGrantToRunPr(
  db: Db, a: { tenantId: number; executionId: number; pullRequestId: string; headSha: string },
): Promise<boolean> {
  const grant = await loadMergeGrant(db, a.tenantId, a.executionId);
  if (!grant || grant.consumedAt || grant.voidedAt) return false;
  await db.insert(mergeGrantPullRequests)
    .values({ tenantId: a.tenantId, grantId: grant.id, pullRequestId: a.pullRequestId, headSha: a.headSha.toLowerCase() })
    .onConflictDoUpdate({
      target: [mergeGrantPullRequests.grantId, mergeGrantPullRequests.pullRequestId],
      set: { headSha: a.headSha.toLowerCase(), holdCode: null },
    });
  return true;
}

/**
 * Finalize's half of the binding: bind this run's grant to the PR it opened at the head the
 * security step judged, resolving the head from the provider when the step had none. A grant
 * whose head cannot be read is voided (`no_head`) rather than bound to a guess. Returns whether
 * a LIVE grant ended up bound; false also when the run has no grant at all.
 */
export async function bindGrantToThisRunsPr(
  env: Env, db: Db, a: { tenantId: number; executionId: number; prRowId: string; headSha: string | null },
): Promise<boolean> {
  try {
    const grant = await loadMergeGrant(db, a.tenantId, a.executionId);
    if (!grant || grant.consumedAt || grant.voidedAt) return false;
    const head = a.headSha ?? await resolvePullRequestHead(db, env, a.tenantId, a.prRowId).then((h) => (h.ok ? h.sha : null));
    if (!head) {
      await voidMergeGrant(db, { tenantId: a.tenantId, executionId: a.executionId, reason: 'no_head' });
      return true; // handled: do not let the caller re-void it as "no pull request"
    }
    return await bindMergeGrantToRunPr(db, { tenantId: a.tenantId, executionId: a.executionId, pullRequestId: a.prRowId, headSha: head });
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

/** Give a claimed grant back — the merge after the claim did not happen. */
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
  grantedBy: string;
  grantedByName: string | null;
  reason: string;
  createdAt: Date;
  status: 'pending' | 'merged' | 'held' | 'voided';
  /** Set when `status` is `held`. */
  heldCode: MergeGrantHoldCode | null;
  /** Set when `status` is `voided`. */
  voidCode: MergeGrantVoidCode | null;
}

/** The grant for an execution, with who granted it and where it stands — null when it has none. */
export async function mergeGrantView(db: Db, tenantId: number, executionId: number): Promise<MergeGrantView | null> {
  const [row] = await db
    .select({
      id: mergeGrants.id, grantedBy: mergeGrants.grantedBy, reason: mergeGrants.reason,
      createdAt: mergeGrants.createdAt, consumedAt: mergeGrants.consumedAt,
      voidedAt: mergeGrants.voidedAt, voidReason: mergeGrants.voidReason,
      displayName: users.displayName, email: users.email,
    })
    .from(mergeGrants)
    .leftJoin(users, eq(users.id, mergeGrants.grantedBy))
    .where(and(eq(mergeGrants.tenantId, tenantId), eq(mergeGrants.executionId, executionId)))
    .limit(1);
  if (!row) return null;
  const base = {
    grantedBy: row.grantedBy, grantedByName: row.displayName ?? row.email ?? null, reason: row.reason, createdAt: row.createdAt,
    heldCode: null, voidCode: null,
  };
  if (row.consumedAt) return { ...base, status: 'merged' };
  if (row.voidedAt) return { ...base, status: 'voided', voidCode: (row.voidReason as MergeGrantVoidCode | null) ?? null };
  const [held] = await db
    .select({ holdCode: mergeGrantPullRequests.holdCode })
    .from(mergeGrantPullRequests)
    .where(and(eq(mergeGrantPullRequests.tenantId, tenantId), eq(mergeGrantPullRequests.grantId, row.id)))
    .orderBy(desc(mergeGrantPullRequests.createdAt))
    .limit(1);
  return held?.holdCode
    ? { ...base, status: 'held', heldCode: held.holdCode as MergeGrantHoldCode }
    : { ...base, status: 'pending' };
}
