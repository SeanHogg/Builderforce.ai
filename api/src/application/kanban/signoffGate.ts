/**
 * signoffGate — "have ALL required agents signed off on this ticket?"
 *
 * This is the precondition for the AI Manager to self-govern: it may complete a ticket
 * and merge its PR without a human ONLY when every required participation slot on the
 * ticket's manifest has reached a satisfied verdict.
 *
 * WHY THIS EXISTS
 * The Manager already had full merge authority — `coordinatePullRequests` force-wrote
 * `status = DONE` for any in-review ticket with a branch and then squash-merged it, with
 * NO manifest verification at all (and, under the default `prMergePolicy: 'immediate'`,
 * no CI check either). So unanimous sign-off is a TIGHTENING of autonomous behaviour,
 * not a new permission. This module is the gate that was missing.
 *
 * FAIL CLOSED ON AN EMPTY MANIFEST — the important subtlety. "Every required slot is
 * satisfied" is vacuously TRUE when there are no required slots, which would make a
 * ticket nobody reviewed the *easiest* thing to auto-merge. That is the opposite of the
 * intent, so a ticket with no required participants is reported `no_required_participants`
 * and is NOT satisfied. The manifest is derived from the board template on first read
 * (`listParticipants` self-derives), so the healthy path is: derive slots → the lane
 * requirement gate dispatches those reviewer agents → they sign off → this gate opens.
 *
 * The decision is a PURE function ({@link decideSignoffGate}) so every branch is
 * unit-tested without a database; {@link resolveSignoffGate} is the thin cached IO wrapper.
 */
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { TicketParticipantsService, type ManifestParticipant } from './ticketParticipants';
import { isParticipantSatisfied } from './participantStates';

/** Why the gate is open or shut — surfaced to telemetry, the ledger and the UI. */
export type SignoffGateReason =
  /** Every required slot reached a satisfied verdict — the Manager may self-govern. */
  | 'all_signed_off'
  /** At least one required slot still owes a verdict. */
  | 'outstanding_signoffs'
  /** No required slots exist, so nobody has reviewed this — deliberately NOT satisfied. */
  | 'no_required_participants';

/** One slot still owing a verdict, for an actionable "waiting on…" message. */
export interface OutstandingSlot {
  roleKey: string;
  roleName: string;
  stageKey: string | null;
  state: string;
  /** Who owes it, when the slot has a resolved assignee. */
  assigneeName: string | null;
  assigneeRef: string | null;
  assigneeKind: string | null;
}

export interface SignoffGateResult {
  /** True ONLY when there is at least one required slot and every one is satisfied. */
  satisfied: boolean;
  reason: SignoffGateReason;
  requiredCount: number;
  satisfiedCount: number;
  outstanding: OutstandingSlot[];
  /** One plain sentence naming what is being waited on. */
  detail: string;
}

/**
 * Decide the gate from a ticket's manifest. PURE.
 *
 * Only `required` slots count — an optional participant is advisory and must never
 * block a merge. Slot state semantics come from the ONE shared classification in
 * `participantStates` (`waived`/`skipped` satisfy; `unstaffed` blocks completion,
 * because "no agent assigned" must not read as "the agent approved").
 */
export function decideSignoffGate(participants: readonly ManifestParticipant[]): SignoffGateResult {
  const required = participants.filter((p) => p.required);
  const outstanding: OutstandingSlot[] = required
    .filter((p) => !isParticipantSatisfied(p.state))
    .map((p) => ({
      roleKey: p.roleKey,
      roleName: p.roleName,
      stageKey: p.stageKey,
      state: p.state,
      assigneeName: p.assigneeName,
      assigneeRef: p.assigneeRef,
      assigneeKind: p.assigneeKind,
    }));
  const satisfiedCount = required.length - outstanding.length;

  if (required.length === 0) {
    return {
      satisfied: false,
      reason: 'no_required_participants',
      requiredCount: 0,
      satisfiedCount: 0,
      outstanding: [],
      detail: 'No required roles are on this ticket, so no agent has signed off — autonomous completion needs at least one recorded sign-off.',
    };
  }
  if (outstanding.length > 0) {
    const names = outstanding.map((o) => o.roleName).join(', ');
    return {
      satisfied: false,
      reason: 'outstanding_signoffs',
      requiredCount: required.length,
      satisfiedCount,
      outstanding,
      detail: `Waiting on ${outstanding.length} of ${required.length} required sign-off${required.length === 1 ? '' : 's'}: ${names}.`,
    };
  }
  return {
    satisfied: true,
    reason: 'all_signed_off',
    requiredCount: required.length,
    satisfiedCount,
    outstanding: [],
    detail: `All ${required.length} required role${required.length === 1 ? '' : 's'} signed off.`,
  };
}

/**
 * Load the ticket's manifest and decide the gate. Reads through
 * `TicketParticipantsService.listParticipants`, which is version-token cached AND
 * self-derives the template slots on first access — so a ticket that has never been
 * coordinated still gets a real manifest rather than an empty one.
 *
 * Never throws: an unreadable manifest returns an unsatisfied gate, so a telemetry or
 * DB blip can never be the reason a merge is auto-approved.
 */
export async function resolveSignoffGate(
  env: Env,
  db: Db,
  args: { tenantId: number; taskId: number },
): Promise<SignoffGateResult> {
  try {
    const participants = await new TicketParticipantsService(db)
      .listParticipants(env, args.tenantId, args.taskId);
    return decideSignoffGate(participants);
  } catch {
    return {
      satisfied: false,
      reason: 'outstanding_signoffs',
      requiredCount: 0,
      satisfiedCount: 0,
      outstanding: [],
      detail: 'Could not read the ticket participation manifest, so autonomous completion is withheld.',
    };
  }
}
