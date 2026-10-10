/**
 * reopenProducerSlots — THE explicit, recorded way to send a completed producer back to work.
 *
 * ── WHY A REOPEN HAS TO BE EXPLICIT ──────────────────────────────────────────────
 * A completed producer slot stays closed (`managedLaneRoles.isStageProductionDischarged`).
 * Before that rule existed nothing ever reopened a producer on purpose — the managed
 * producer pick simply re-chose the stage's first producing role on every sweep, so
 * "rework" and "the #2180 loop" were the same accident: ticket #2180's Business Analyst
 * finished `ready`, the Architect finished `ready`, and the BA was dispatched again every
 * 6–20 minutes with nothing asking it to.
 *
 * Closing the slot for good would have broken the one legitimate rework path — the
 * manager returning a review ticket to implementation because it has no deliverable or a
 * red build — so that path now says so: it writes a `changes_requested` verdict on the
 * producer's OWN slot, with the reason, to the append-only sign-off ledger. That is the
 * only durable place a slot state lives (`syncStates` recomputes every slot from it), it
 * is visible on the Sign-off & Accountability tab, and it is bounded by construction:
 *
 *   • `syncStates` derives `changes_requested` → the slot is OPEN → one producer run is
 *     dispatched for it (`pickManagedProducer` tier 1 / the requirement gate);
 *   • when that run finishes, `attestCompletedRoleRun` credits it, because a producer
 *     whose latest verdict is a reopen is not covered (`ledgerCovers`) → `completed`;
 *   • the slot is closed again until the NEXT recorded reason.
 *
 * One reason, one rework run. Nothing here can re-dispatch a producer on its own.
 */
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { ticketParticipants } from '../../infrastructure/database/schema';
import { TicketAuditService } from '../audit/ticketAuditService';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { isProducerResponsibility } from './participantStates';
import { TicketParticipantsService } from './ticketParticipants';

/** A manifest slot, as far as a reopen cares. */
export interface ReopenCandidateSlot {
  stageKey: string | null;
  roleKey: string;
  responsibility: string;
  required: boolean;
  state: string;
}

/**
 * Which producer roles a reopen of `stageKey` sends back to work. PURE.
 *
 * Only a REQUIRED producer slot on that exact stage whose state is `completed`. Never a
 * `waived`/`skipped` slot — a waiver is a recorded decision that the role is not needed,
 * and a rework order must not silently undo it — and never a reviewer: a reviewer's
 * verdict is its own to give.
 */
export function decideProducerReopen(slots: readonly ReopenCandidateSlot[], stageKey: string): string[] {
  return [...new Set(slots
    .filter((s) => s.stageKey === stageKey && s.required
      && isProducerResponsibility(s.responsibility) && s.state === 'completed')
    .map((s) => s.roleKey))];
}

export interface ReopenStageProducersArgs {
  tenantId: number;
  taskId: number;
  stageKey: string;
  /** Why the work is being sent back — recorded on the ledger row, verbatim. */
  reason: string;
  /** Who is sending it back, for the accountability record (never anonymous). */
  actor: { kind: 'agent' | 'human'; ref: string | null; name: string };
}

/**
 * Record the reopen of every completed producer slot on `stageKey` and re-derive the
 * manifest. Returns the role keys reopened (empty when there was nothing to reopen —
 * e.g. a board with no manifest, where the lane's own agent does the rework).
 *
 * Best-effort: a failure leaves the slots as they were and returns what was recorded.
 */
export async function reopenStageProducers(env: Env, db: Db, args: ReopenStageProducersArgs): Promise<string[]> {
  const reopened: string[] = [];
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
    const roles = decideProducerReopen(slots, args.stageKey);
    if (!roles.length) return reopened;

    const audit = new TicketAuditService(db);
    for (const roleKey of roles) {
      await audit.recordSignoff(env, args.tenantId, {
        taskId: args.taskId,
        roleKey,
        laneKey: args.stageKey,
        verdict: 'changes_requested',
        memberKind: args.actor.kind,
        memberRef: args.actor.ref,
        memberName: args.actor.name,
        summary: `Reopened for rework: ${args.reason}`.slice(0, 1000),
      });
      reopened.push(roleKey);
    }
    const participants = new TicketParticipantsService(db);
    await participants.syncStates(env, args.tenantId, args.taskId);
    await participants.invalidate(env, args.taskId);
  } catch (error) {
    reportCaughtError(error, { source: 'application/kanban/reopenProducerSlots.ts', operation: 'reopenStageProducers', context: { details: { taskId: args.taskId, stageKey: args.stageKey } } });
  }
  return reopened;
}
