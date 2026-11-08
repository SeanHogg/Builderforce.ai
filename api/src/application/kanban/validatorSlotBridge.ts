/**
 * validatorSlotBridge — PRD 23 §5.2: the deterministic, audited bridge between the two
 * evidence ledgers.
 *
 * `task_reviews` is Validator ACCEPTANCE evidence; `ticket_role_signoffs` is lifecycle
 * ACCOUNTABILITY evidence (it is what `ticket_participants.state` is derived from). Until
 * the two are one ledger, a valid Validator review could never release a lane sign-off gate.
 * This module links them, and does nothing else:
 *
 *   • {@link bridgeValidatorReview} — a `complete` review lands linked to the ticket's
 *     VALIDATOR slot (`task_reviews.participant_id`) and records the matching sign-off on
 *     THAT slot only, through the one sign-off writer (`TicketAuditService.recordSignoff`).
 *     It never records any other role's approval. It is idempotent: the sign-off summary
 *     carries a `[task_review #id]` marker, and a review that already has a marked sign-off
 *     is not recorded twice.
 *   • {@link invalidateStaleAcceptance} — a newer PR head invalidates acceptance evidence
 *     recorded against an older head. The slot reopens through the ledger (a
 *     `changes_requested` row, the same pattern as `reopenProducerSlots.ts`), so
 *     `syncStates` derives the slot open again and the Validator is re-dispatched. Once the
 *     row is written the slot is no longer `completed`, so a repeat call writes nothing.
 */
import { and, asc, eq, inArray, like } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { taskReviews, ticketParticipants, ticketRoleSignoffs } from '../../infrastructure/database/schema';
import { TicketAuditService } from '../audit/ticketAuditService';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { TicketParticipantsService } from './ticketParticipants';

export const VALIDATOR_ROLE_KEY = 'validator';

/** Marker stamped into the bridged sign-off's summary — the idempotency key AND the audit link. */
export const reviewMarker = (reviewId: number): string => `[task_review #${reviewId}]`;

/** A manifest slot, as far as the bridge cares. */
export interface BridgeSlot {
  id: string;
  stageKey: string | null;
  roleKey: string;
  responsibility: string;
  required: boolean;
  state: string;
  createdAt?: Date | null;
}

/**
 * Which slot a Validator review is linked to. PURE. The ticket's Validator slot: a
 * waived/skipped slot is a recorded decision and is never overridden; a required reviewer
 * slot wins over an optional one; ties go to the oldest.
 */
export function pickValidatorSlot(slots: readonly BridgeSlot[]): BridgeSlot | null {
  const candidates = slots
    .filter((s) => s.roleKey === VALIDATOR_ROLE_KEY && s.state !== 'waived' && s.state !== 'skipped')
    .sort((a, b) =>
      Number(b.required) - Number(a.required)
      || Number(b.responsibility === 'reviewer') - Number(a.responsibility === 'reviewer')
      || (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0));
  return candidates[0] ?? null;
}

export interface BridgePlan {
  slot: BridgeSlot | null;
  /** True when a sign-off must be written for this review. */
  recordSignoff: boolean;
  reason: 'no_validator_slot' | 'verdict_not_complete' | 'already_bridged' | 'bridge';
}

/** What to do with one review. PURE: `alreadyBridged` is "a marked sign-off for this review exists". */
export function planValidatorBridge(args: {
  slots: readonly BridgeSlot[]; verdict: string; alreadyBridged: boolean;
}): BridgePlan {
  const slot = pickValidatorSlot(args.slots);
  if (!slot) return { slot: null, recordSignoff: false, reason: 'no_validator_slot' };
  if (args.verdict !== 'complete') return { slot, recordSignoff: false, reason: 'verdict_not_complete' };
  if (args.alreadyBridged) return { slot, recordSignoff: false, reason: 'already_bridged' };
  return { slot, recordSignoff: true, reason: 'bridge' };
}

export interface BridgeReviewArgs {
  tenantId: number;
  taskId: number;
  reviewId: number;
  verdict: string;
  reviewerRef: string | null;
  summary: string | null;
  executionId?: number | null;
  reviewedHeadSha?: string | null;
}

export interface BridgeResult {
  participantId: string | null;
  signoffId: string | null;
  reason: BridgePlan['reason'];
}

/**
 * Link a freshly written review to its Validator slot and, for a `complete` verdict,
 * record the matching sign-off on that slot. Best-effort: the review is already durable,
 * so a failure here is reported and returns what was achieved.
 */
export async function bridgeValidatorReview(env: Env, db: Db, args: BridgeReviewArgs): Promise<BridgeResult> {
  try {
    const slots = await db.select({
      id: ticketParticipants.id, stageKey: ticketParticipants.stageKey, roleKey: ticketParticipants.roleKey,
      responsibility: ticketParticipants.responsibility, required: ticketParticipants.required,
      state: ticketParticipants.state, createdAt: ticketParticipants.createdAt,
    }).from(ticketParticipants).where(and(
      eq(ticketParticipants.tenantId, args.tenantId), eq(ticketParticipants.taskId, args.taskId),
      eq(ticketParticipants.roleKey, VALIDATOR_ROLE_KEY),
    ));

    const marker = reviewMarker(args.reviewId);
    const marked = slots.length ? await db.select({ id: ticketRoleSignoffs.id }).from(ticketRoleSignoffs).where(and(
      eq(ticketRoleSignoffs.tenantId, args.tenantId), eq(ticketRoleSignoffs.taskId, args.taskId),
      eq(ticketRoleSignoffs.roleKey, VALIDATOR_ROLE_KEY), like(ticketRoleSignoffs.summary, `${marker}%`),
    )).limit(1) : [];

    const plan = planValidatorBridge({ slots, verdict: args.verdict, alreadyBridged: marked.length > 0 });
    if (!plan.slot) return { participantId: null, signoffId: null, reason: plan.reason };

    // Link the evidence: the review row now names its slot, execution and reviewed head.
    await db.update(taskReviews).set({
      participantId: plan.slot.id,
      ...(args.executionId != null ? { executionId: args.executionId } : {}),
      ...(args.reviewedHeadSha ? { reviewedHeadSha: args.reviewedHeadSha } : {}),
    }).where(and(eq(taskReviews.id, args.reviewId), eq(taskReviews.tenantId, args.tenantId)));

    if (!plan.recordSignoff) return { participantId: plan.slot.id, signoffId: null, reason: plan.reason };

    const recorded = await new TicketAuditService(db).recordSignoff(env, args.tenantId, {
      taskId: args.taskId,
      roleKey: VALIDATOR_ROLE_KEY,
      laneKey: plan.slot.stageKey,
      verdict: 'approved',
      memberKind: 'agent',
      memberRef: args.reviewerRef,
      memberName: 'Validator',
      publishToPr: false, // the review itself is posted once by publishReviewToPr
      summary: `${marker} ${args.summary ?? 'Acceptance review: complete.'}`.slice(0, 1000),
    });
    const participants = new TicketParticipantsService(db);
    await participants.syncStates(env, args.tenantId, args.taskId);
    await participants.invalidate(env, args.taskId);
    return { participantId: plan.slot.id, signoffId: recorded.signoffId, reason: plan.reason };
  } catch (error) {
    reportCaughtError(error, { source: 'application/kanban/validatorSlotBridge.ts', operation: 'bridgeValidatorReview', context: { details: { taskId: args.taskId, reviewId: args.reviewId } } });
    return { participantId: null, signoffId: null, reason: 'no_validator_slot' };
  }
}

/** A bridged `complete` review, as far as head invalidation cares. */
export interface BridgedReview {
  id: number;
  taskId: number;
  participantId: string;
  reviewedHeadSha: string;
}

/**
 * Which bridged reviews a set of current PR heads invalidates. PURE. Only the LATEST
 * bridged review per slot counts (callers pass them oldest-first), and only when its
 * reviewed head differs from the task's current head.
 */
export function selectStaleReviews(
  reviews: readonly BridgedReview[],
  currentHeadByTask: ReadonlyMap<number, string>,
): BridgedReview[] {
  const latestBySlot = new Map<string, BridgedReview>();
  for (const r of reviews) latestBySlot.set(r.participantId, r);
  return [...latestBySlot.values()].filter((r) => {
    const head = currentHeadByTask.get(r.taskId);
    return head != null && head !== r.reviewedHeadSha;
  });
}

const short = (sha: string): string => sha.slice(0, 7);

/**
 * Invalidate acceptance evidence recorded against an older PR head. Returns the task ids
 * whose Validator slot was reopened. One batched read for reviews, one for slots; a write
 * only per slot that is still `completed` (that is the idempotency guard).
 */
export async function invalidateStaleAcceptance(
  env: Env, db: Db, tenantId: number, heads: ReadonlyArray<{ taskId: number; headSha: string }>,
): Promise<number[]> {
  const reopened: number[] = [];
  try {
    const currentHeadByTask = new Map(heads.filter((h) => h.headSha).map((h) => [h.taskId, h.headSha] as const));
    if (!currentHeadByTask.size) return reopened;

    const rows = await db.select({
      id: taskReviews.id, taskId: taskReviews.taskId, participantId: taskReviews.participantId,
      reviewedHeadSha: taskReviews.reviewedHeadSha, verdict: taskReviews.verdict,
    }).from(taskReviews).where(and(
      eq(taskReviews.tenantId, tenantId), inArray(taskReviews.taskId, [...currentHeadByTask.keys()]),
    )).orderBy(asc(taskReviews.id));
    const bridged: BridgedReview[] = rows
      .filter((r) => r.participantId && r.reviewedHeadSha && r.verdict === 'complete')
      .map((r) => ({ id: r.id, taskId: r.taskId, participantId: r.participantId!, reviewedHeadSha: r.reviewedHeadSha! }));
    const stale = selectStaleReviews(bridged, currentHeadByTask);
    if (!stale.length) return reopened;

    const slots = await db.select({
      id: ticketParticipants.id, stageKey: ticketParticipants.stageKey, state: ticketParticipants.state,
    }).from(ticketParticipants).where(and(
      eq(ticketParticipants.tenantId, tenantId), inArray(ticketParticipants.id, stale.map((s) => s.participantId)),
    ));
    const slotById = new Map(slots.map((s) => [s.id, s] as const));

    const audit = new TicketAuditService(db);
    const participants = new TicketParticipantsService(db);
    for (const review of stale) {
      const slot = slotById.get(review.participantId);
      if (!slot || slot.state !== 'completed') continue;
      await audit.recordSignoff(env, tenantId, {
        taskId: review.taskId,
        roleKey: VALIDATOR_ROLE_KEY,
        laneKey: slot.stageKey,
        verdict: 'changes_requested',
        memberKind: 'agent',
        memberRef: null,
        memberName: 'Platform',
        publishToPr: false, // an internal re-review trigger, never a changes_requested verdict mirrored onto the PR
        summary: `Acceptance invalidated: the PR head moved ${short(review.reviewedHeadSha)} -> ${short(currentHeadByTask.get(review.taskId)!)} after ${reviewMarker(review.id)}. Re-review the new head.`.slice(0, 1000),
      });
      await participants.syncStates(env, tenantId, review.taskId);
      await participants.invalidate(env, review.taskId);
      reopened.push(review.taskId);
    }
  } catch (error) {
    reportCaughtError(error, { source: 'application/kanban/validatorSlotBridge.ts', operation: 'invalidateStaleAcceptance', context: { tenantId } });
  }
  return reopened;
}
