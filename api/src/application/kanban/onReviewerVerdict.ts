/**
 * onReviewerVerdict — a reviewer's `changes_requested` sends the author back to work.
 *
 * A verdict recorded on a REVIEWER/validator slot used to change nothing for the producer:
 * the producer slot stayed `completed` (closed), so the reviewer's request had no owner and
 * the ticket stalled. Operator decision: the verdict alone reopens the stage's producer
 * slot(s) — one rework run, bounded by the existing run cap and cooldown.
 *
 * ONE seam for every verdict entry point (the sign-off route — which the `kanban.signoff`
 * MCP tool replays — and the human approval gate's role bridge). It is a use case, not part
 * of `TicketAuditService`, so the audit service never owns coordination. The caller still
 * owns dispatch (`coordinateTicket`) and runs it when this returns reopened roles (or, for
 * the sign-off route, always).
 *
 * No recursion: `reopenStageProducers` records `changes_requested` on PRODUCER slots
 * through `recordSignoff` directly (never through here), and this use case ignores any
 * verdict whose slot is itself a producer slot. Idempotent: only a `completed` required
 * producer is reopened, so a second verdict while the producers are already open is a no-op.
 *
 * CONCURRENT SIGN-OFFS. Two reviewers (or one retried request) can both read the producer
 * slot as `completed` before either write lands, so both may record a `changes_requested`
 * ledger row for the same producer. That duplicate is harmless: `syncStates` derives slot
 * state from the ledger and is idempotent (two identical reopen rows derive the same open
 * state as one), and the rework dispatch that follows is deduped by admission (one live run
 * per ticket, bounded by the run cap and cooldown). The cost is one extra audit line, which
 * is cheaper than serialising every verdict behind a lock.
 */
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { ticketParticipants } from '../../infrastructure/database/schema';
import { TaskStatus } from '../../domain/shared/types';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { isProducerResponsibility } from './participantStates';
import { reopenStageProducers, type ReopenStageProducersArgs } from './reopenProducerSlots';

/** A manifest slot, as far as routing a verdict cares. */
export interface VerdictSlot {
  stageKey: string | null;
  roleKey: string;
  responsibility: string;
  required: boolean;
  /** The slot's derived state; read only to tell which stage's producer work is `completed`. */
  state?: string;
}

/**
 * Which stage's producers a reviewer's changes_requested reopens, or null for "nothing". PURE.
 *
 * Null when the verdict is not changes_requested, or when the role holds no REVIEWER slot
 * for it. The role's own PRODUCER slots are excluded from the decision (not a reason to
 * bail): a producer's own verdict — including the ones a reopen writes — is never a review,
 * but a role that also reviews somewhere else must still have that review honoured.
 * Otherwise the reviewer's stage when that stage has required producers; else
 * implementation (where a review stage's authors work).
 *
 * WHICH STAGE when the reviewer (with no `laneKey`) holds reviewer slots in several: the
 * stage whose required producer slot is `completed` — that is the work under review — then
 * any stage with a required producer, then the alphabetically first stage. Never "whichever
 * row the database returned first": the choice must not depend on row order.
 */
export function decideVerdictReopenStage(
  slots: readonly VerdictSlot[],
  verdict: { roleKey: string; laneKey?: string | null; verdict: string },
): string | null {
  if (verdict.verdict !== 'changes_requested') return null;
  const own = slots.filter((s) =>
    s.roleKey === verdict.roleKey
    && (!verdict.laneKey || s.stageKey === verdict.laneKey)
    && !isProducerResponsibility(s.responsibility));
  if (!own.length) return null;
  const hasProducer = (stage: string, completedOnly: boolean): boolean => slots.some((s) =>
    s.stageKey === stage && s.required && isProducerResponsibility(s.responsibility)
    && (!completedOnly || s.state === 'completed'));
  const stages = [...new Set(own.map((s) => s.stageKey ?? verdict.laneKey ?? null))]
    .filter((s): s is string => s != null)
    .sort();
  const stageKey = stages.find((s) => hasProducer(s, true)) ?? stages.find((s) => hasProducer(s, false)) ?? null;
  return stageKey ?? TaskStatus.IN_PROGRESS;
}

export interface ReviewerVerdictArgs {
  tenantId: number;
  taskId: number;
  roleKey: string;
  laneKey?: string | null;
  verdict: string;
  summary?: string | null;
  actor: ReopenStageProducersArgs['actor'];
}

/** Returns the producer role keys reopened (empty when nothing applied). Best-effort. */
export async function onReviewerVerdict(env: Env, db: Db, args: ReviewerVerdictArgs): Promise<string[]> {
  if (args.verdict !== 'changes_requested') return [];
  try {
    const slots = await db
      .select({
        stageKey: ticketParticipants.stageKey,
        roleKey: ticketParticipants.roleKey,
        responsibility: ticketParticipants.responsibility,
        required: ticketParticipants.required,
        state: ticketParticipants.state,
      })
      .from(ticketParticipants)
      .where(and(eq(ticketParticipants.tenantId, args.tenantId), eq(ticketParticipants.taskId, args.taskId)));
    const stageKey = decideVerdictReopenStage(slots, args);
    if (!stageKey) return [];
    return await reopenStageProducers(env, db, {
      tenantId: args.tenantId,
      taskId: args.taskId,
      stageKey,
      reason: args.summary?.trim() || `${args.roleKey} requested changes`,
      actor: args.actor,
    });
  } catch (error) {
    reportCaughtError(error, { source: 'application/kanban/onReviewerVerdict.ts', operation: 'onReviewerVerdict', context: { details: { taskId: args.taskId, roleKey: args.roleKey } } });
    return [];
  }
}
