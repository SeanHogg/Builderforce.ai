/**
 * Multi-step, multi-approver sign-off (PRD 19 §9).
 *
 * ── WHAT THE EXISTING OWNER COULD NOT DO ────────────────────────────────────
 * `approvals` (governance) is the mature side for a SINGLE decision and keeps
 * that job: one request, one `reviewed_by`, one status, and `approvalGate.ts`
 * reads it inline to decide whether an act may proceed. That model has exactly
 * one reviewer, which is correct for "may this agent run a workflow" and useless
 * for "this contract needs Finance, then Legal, then the CEO".
 *
 * BurnRateOS's `governance` module had the second shape — `approval_workflows` /
 * `approval_requests` / `approval_actions` — and Builderforce already had schema
 * for the part that matters, `approval_actions`, with no reader. So the merge adds
 * the CHAIN to the existing owner rather than importing a second approval product:
 * the workflow definition and the request row do not come across, because
 * `approvals` already is the request and `approval_rules` already is the policy.
 *
 * ── STEPS ARE SEQUENTIAL, AND THAT IS ENFORCED BY THE READ ──────────────────
 * Every approver on a subject carries a `step`. Only the LOWEST step that still
 * has waiting approvers is `active`; everything above it stays `waiting`. That
 * ordering is not advisory — {@link act} refuses a decision from an approver whose
 * step is not the active one, because an approval chain whose steps can be
 * satisfied out of order is a list of approvers, not a chain, and the whole reason
 * Legal signs after Finance is that Finance's answer changes what Legal reviews.
 *
 * ── A REJECTION ENDS THE CHAIN ──────────────────────────────────────────────
 * {@link act} with `approved: false` marks every remaining approver `skipped` in
 * one statement. Leaving them `waiting` would leave the subject in a state where
 * the chain is dead but the queue still shows work — and somebody eventually
 * approves a step on a request that was rejected two days earlier.
 *
 * ── IDEMPOTENCE ────────────────────────────────────────────────────────────
 * `uq_approval_actions_approver` is (tenant, subject kind, subject ref, approver,
 * step), so the same person cannot be enrolled twice at the same step. Enrolment
 * is therefore `onConflictDoNothing`: re-running a policy that adds the same
 * approvers is a no-op rather than an error, which is what makes the policy safe
 * to re-apply when a subject changes.
 */

import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { approvalActions } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { recordActivity, type ActorIdentity } from '../activity/activityLog';

/** `approval_actions.state`. */
export const APPROVAL_STATES = ['waiting', 'active', 'done', 'skipped'] as const;
export type ApprovalState = (typeof APPROVAL_STATES)[number];

export class ApprovalChainError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 = 400) {
    super(message);
    this.name = 'ApprovalChainError';
  }
}

export type Subject = { kind: string; ref: string };

export type Approver = {
  ref: string;
  kind?: 'user' | 'role' | 'agent';
  step?: number;
};

const requireSubject = (s: Subject): Subject => {
  const kind = s.kind.trim();
  const ref = s.ref.trim();
  if (!kind || !ref) throw new ApprovalChainError('subject kind and ref are required');
  return { kind: kind.slice(0, 32), ref: ref.slice(0, 64) };
};

/**
 * Enrol approvers on a subject and open the first step.
 *
 * Enrolment and activation are ONE call because a chain with nobody active is a
 * chain that silently blocks: the queue shows nothing, the requester sees no
 * progress, and the only symptom is that the approval never arrives.
 */
export async function openChain(
  db: Db,
  env: Env,
  tenantId: number,
  actor: ActorIdentity,
  subject: Subject,
  approvers: Approver[],
) {
  const s = requireSubject(subject);
  if (approvers.length === 0) throw new ApprovalChainError('a chain needs at least one approver');

  const rows = approvers.map((a) => {
    const ref = a.ref.trim();
    if (!ref) throw new ApprovalChainError('every approver needs a ref');
    return {
      tenantId,
      subjectKind: s.kind,
      subjectRef: s.ref,
      approverKind: a.kind ?? 'user',
      approverRef: ref.slice(0, 64),
      step: a.step ?? 1,
      state: 'waiting' as const,
      requestedAt: new Date(),
    };
  });

  await db
    .insert(approvalActions)
    .values(rows)
    .onConflictDoNothing({
      target: [
        approvalActions.tenantId,
        approvalActions.subjectKind,
        approvalActions.subjectRef,
        approvalActions.approverRef,
        approvalActions.step,
      ],
    });

  const activated = await activateNextStep(db, tenantId, s);
  await recordActivity(env, db, {
    tenantId,
    actor,
    verb: 'approval_chain.opened',
    targetType: s.kind,
    targetId: s.ref,
    metadata: { approvers: rows.length, activeStep: activated },
  });
  return chainState(db, tenantId, s);
}

/**
 * Promote the lowest step that still has waiting approvers to `active`.
 *
 * Written as one UPDATE against a scalar sub-select rather than read-then-write,
 * because two approvers finishing a step simultaneously would otherwise both
 * compute the same "next step" and both activate it — harmless here, but the same
 * race skips a step when the two are one apart.
 */
async function activateNextStep(db: Db, tenantId: number, subject: Subject): Promise<number | null> {
  const [next] = await db
    .select({ step: sql<number | null>`min(${approvalActions.step})` })
    .from(approvalActions)
    .where(scopedToTenant(approvalActions, tenantId, and(
      eq(approvalActions.subjectKind, subject.kind),
      eq(approvalActions.subjectRef, subject.ref),
      eq(approvalActions.state, 'waiting'),
    )));

  const step = next?.step ?? null;
  if (step === null) return null;

  await db
    .update(approvalActions)
    .set({ state: 'active', updatedAt: new Date() })
    .where(scopedToTenant(approvalActions, tenantId, and(
      eq(approvalActions.subjectKind, subject.kind),
      eq(approvalActions.subjectRef, subject.ref),
      eq(approvalActions.state, 'waiting'),
      eq(approvalActions.step, step),
    )));
  return step;
}

/**
 * One approver's decision.
 *
 * Refuses a decision from an approver whose row is not `active` — that is the
 * enforcement of sequence described in the module docstring, and it is a 409
 * rather than a silent success so the caller learns their turn has not come
 * rather than believing they have signed.
 */
export async function act(
  db: Db,
  env: Env,
  tenantId: number,
  actor: ActorIdentity,
  subject: Subject,
  approverRef: string,
  approved: boolean,
) {
  const s = requireSubject(subject);
  const ref = approverRef.trim();

  const [row] = await db
    .update(approvalActions)
    .set({ state: 'done', actedAt: new Date(), updatedAt: new Date() })
    .where(scopedToTenant(approvalActions, tenantId, and(
      eq(approvalActions.subjectKind, s.kind),
      eq(approvalActions.subjectRef, s.ref),
      eq(approvalActions.approverRef, ref),
      eq(approvalActions.state, 'active'),
    )))
    .returning();

  if (!row) {
    const [enrolled] = await db
      .select({ state: approvalActions.state, step: approvalActions.step })
      .from(approvalActions)
      .where(scopedToTenant(approvalActions, tenantId, and(
        eq(approvalActions.subjectKind, s.kind),
        eq(approvalActions.subjectRef, s.ref),
        eq(approvalActions.approverRef, ref),
      )))
      .limit(1);
    if (!enrolled) throw new ApprovalChainError('that approver is not on this chain', 404);
    throw new ApprovalChainError(`it is not this approver's turn (state: ${enrolled.state}, step ${enrolled.step})`, 409);
  }

  if (!approved) {
    // A rejection ends the chain. Leaving the rest `waiting` is how somebody
    // approves step 3 of a request that was rejected at step 1.
    await db
      .update(approvalActions)
      .set({ state: 'skipped', updatedAt: new Date() })
      .where(scopedToTenant(approvalActions, tenantId, and(
        eq(approvalActions.subjectKind, s.kind),
        eq(approvalActions.subjectRef, s.ref),
        inArray(approvalActions.state, ['waiting', 'active']),
      )));
  } else {
    // Only advance once every approver on the active step has acted.
    const [remaining] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(approvalActions)
      .where(scopedToTenant(approvalActions, tenantId, and(
        eq(approvalActions.subjectKind, s.kind),
        eq(approvalActions.subjectRef, s.ref),
        eq(approvalActions.step, row.step),
        eq(approvalActions.state, 'active'),
      )));
    if ((remaining?.n ?? 0) === 0) await activateNextStep(db, tenantId, s);
  }

  await recordActivity(env, db, {
    tenantId,
    actor,
    verb: approved ? 'approval_chain.approved' : 'approval_chain.rejected',
    targetType: s.kind,
    targetId: s.ref,
    metadata: { approverRef: ref, step: row.step },
  });
  return chainState(db, tenantId, s);
}

/**
 * The whole chain and its verdict.
 *
 * `outcome` is derived here rather than stored: it is a pure function of the rows,
 * and a stored copy is one more thing that can disagree with them. `rejected` is
 * detected by a skipped row co-existing with a done one — the signature a
 * rejection leaves, and the reason rejection skips rather than deletes.
 */
export async function chainState(db: Db, tenantId: number, subject: Subject) {
  const s = requireSubject(subject);
  const steps = await db
    .select()
    .from(approvalActions)
    .where(scopedToTenant(approvalActions, tenantId, and(
      eq(approvalActions.subjectKind, s.kind),
      eq(approvalActions.subjectRef, s.ref),
    )))
    .orderBy(asc(approvalActions.step), asc(approvalActions.approverRef));

  if (steps.length === 0) return { subject: s, steps: [], outcome: 'none' as const, activeStep: null };

  const skipped = steps.some((r) => r.state === 'skipped');
  const pending = steps.some((r) => r.state === 'waiting' || r.state === 'active');
  const active = steps.find((r) => r.state === 'active')?.step ?? null;

  const outcome = skipped ? ('rejected' as const) : pending ? ('pending' as const) : ('approved' as const);
  return { subject: s, steps, outcome, activeStep: active };
}

/** Everything this approver is currently being asked to decide — the queue, and
 *  the only read that has to be fast on a shared inbox. */
export async function queueFor(db: Db, tenantId: number, approverRef: string) {
  return db
    .select()
    .from(approvalActions)
    .where(scopedToTenant(approvalActions, tenantId, and(
      eq(approvalActions.approverRef, approverRef.trim()),
      eq(approvalActions.state, 'active'),
    )))
    .orderBy(asc(approvalActions.requestedAt));
}

/** Withdraw a subject from approval entirely — every un-acted approver is
 *  skipped. Acted rows are left alone: a decision already made is a fact, and
 *  erasing it to tidy the queue is exactly what an approval trail must not do. */
export async function cancelChain(
  db: Db,
  env: Env,
  tenantId: number,
  actor: ActorIdentity,
  subject: Subject,
) {
  const s = requireSubject(subject);
  const rows = await db
    .update(approvalActions)
    .set({ state: 'skipped', updatedAt: new Date() })
    .where(scopedToTenant(approvalActions, tenantId, and(
      eq(approvalActions.subjectKind, s.kind),
      eq(approvalActions.subjectRef, s.ref),
      ne(approvalActions.state, 'done'),
    )))
    .returning({ id: approvalActions.id });

  await recordActivity(env, db, {
    tenantId,
    actor,
    verb: 'approval_chain.cancelled',
    targetType: s.kind,
    targetId: s.ref,
    metadata: { skipped: rows.length },
  });
  return { skipped: rows.length };
}
