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
import { isParticipantSatisfied, isAttestationExhausted } from './participantStates';

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
  /**
   * Owner/contributor (must PRODUCE the stage's deliverable) vs reviewer (must JUDGE it).
   * Carried because the ask is a different instruction for each — the drive used to send
   * every slot the reviewer contract, so a stage's producer was told to "review the
   * delivered work and record a verdict" for work that did not exist yet.
   */
  responsibility: string;
  /** Who owes it, when the slot has a resolved assignee. */
  assigneeName: string | null;
  assigneeRef: string | null;
  assigneeKind: string | null;
  /**
   * The slot's agent has now finished {@link MAX_UNATTESTED_RUNS} runs for this ask
   * WITHOUT recording a verdict (see `attestRoleRun.ts`). It is still agent-owed, but
   * asking it again is a proven no-op, so it must not be counted as dispatchable.
   *
   * Optional because absent means "not exhausted", which is both the safe reading and the
   * behaviour that predates this field; `decideSignoffGate` — the only place real slots
   * are built — always sets it explicitly.
   */
  attestationExhausted?: boolean;
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
 * WHO owes each outstanding sign-off, split by whether the manager can do anything
 * about it. This is the distinction the whole "waiting on sign-off" story turns on,
 * and nothing used to draw it: `driveOutstandingSignoffs` silently skipped any slot
 * it could not dispatch, so a ticket blocked on roles that are UNSTAFFED or owed by a
 * PERSON produced the identical journal line as one whose agent was asked and ignored
 * it — "waiting on 10 of 10 required sign-offs" forever, with nobody ever told.
 *
 * The three buckets need three different responses, which is why they are three:
 *   • `dispatchable` — an agent owes it; the manager asks it to record a verdict.
 *   • `humanOwed`    — a person owes it; no dispatch exists that can clear this, so the
 *                      only honest move is to escalate rather than "keep trying".
 *   • `unstaffed`    — no resolved assignee at all; the ticket needs staffing first.
 *                      This is the state a reader means by "nobody is assigned".
 *   • `exhausted`    — an agent owes it and HAS BEEN ASKED to the ceiling, finishing
 *                      every run without recording a verdict. Split out of
 *                      `dispatchable` because it is the one bucket that looks askable
 *                      and is not: the decision feed shows the same sign-off request
 *                      re-issued five times in 2h20m against a slot that answered none
 *                      of them. Counting it as dispatchable is precisely what makes the
 *                      loop unexitable, so it is agent-owed but NOT askable.
 */
export interface SignoffOwnership {
  dispatchable: OutstandingSlot[];
  humanOwed: OutstandingSlot[];
  unstaffed: OutstandingSlot[];
  exhausted: OutstandingSlot[];
}

/** Split the outstanding slots by who owes them. PURE. */
export function classifySignoffOwnership(outstanding: readonly OutstandingSlot[]): SignoffOwnership {
  const out: SignoffOwnership = { dispatchable: [], humanOwed: [], unstaffed: [], exhausted: [] };
  for (const slot of outstanding) {
    if (!slot.assigneeRef) out.unstaffed.push(slot);
    else if (slot.assigneeKind !== 'agent') out.humanOwed.push(slot);
    else if (slot.attestationExhausted) out.exhausted.push(slot);
    else out.dispatchable.push(slot);
  }
  return out;
}

/**
 * One clause naming what is holding the gate, for the manager feed and the register.
 * Empty string when an agent CAN be asked — the caller says what it asked instead.
 */
export function describeSignoffOwnership(o: SignoffOwnership): string {
  if (o.dispatchable.length > 0) return '';
  const parts: string[] = [];
  if (o.unstaffed.length) {
    parts.push(`${o.unstaffed.length} with nobody assigned (${roleList(o.unstaffed)})`);
  }
  if (o.humanOwed.length) {
    parts.push(`${o.humanOwed.length} owed by a person (${ownerList(o.humanOwed)})`);
  }
  if (o.exhausted.length) {
    parts.push(
      `${o.exhausted.length} whose agent has finished every run without recording a verdict `
      + `(${ownerList(o.exhausted)}) — re-asking has been tried to the ceiling`,
    );
  }
  if (!parts.length) return '';
  return `No agent can clear this: ${parts.join(', ')}.`;
}

const roleList = (slots: readonly OutstandingSlot[]): string =>
  [...new Set(slots.map((s) => s.roleName))].join(', ');

const ownerList = (slots: readonly OutstandingSlot[]): string =>
  [...new Set(slots.map((s) => `${s.roleName} → ${s.assigneeName ?? s.assigneeRef ?? 'unnamed'}`))].join(', ');

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
      responsibility: p.responsibility,
      assigneeName: p.assigneeName,
      assigneeRef: p.assigneeRef,
      assigneeKind: p.assigneeKind,
      attestationExhausted: isAttestationExhausted(p.evidence),
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
 * Slots belonging to ONE stage — the ticket's current lane — plus stage-less slots.
 * PURE.
 *
 * TWO DIFFERENT QUESTIONS share this manifest and must not share an answer:
 *   • "may this ticket COMPLETE?" — every required slot, every stage (the gate above).
 *   • "who should be ASKED right now?" — only the stage the ticket is actually in.
 *
 * Conflating them is why the manager drove sign-offs from `in_review` alone: an unscoped
 * ask on an earlier lane would have told the QA reviewer to judge a Requirements-stage
 * ticket. Scoping the ASK is what makes it safe to drive on every lane, which is what the
 * lane gate's "re-asking is the AI Manager's job" comment always assumed.
 */
export function slotsForStage(outstanding: readonly OutstandingSlot[], stageKey: string | null): OutstandingSlot[] {
  return outstanding.filter((s) => s.stageKey == null || s.stageKey === stageKey);
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
  args: {
    tenantId: number; taskId: number;
    /**
     * Scope the gate to ONE stage — see {@link slotsForStage}. Callers asking "who do I
     * ask now" pass the ticket's current lane; callers asking "may this complete" (the
     * manager's conduct pass, which owns merge authority) must NOT pass it, or a ticket
     * would complete with earlier stages unsigned.
     */
    stageKey?: string | null;
  },
): Promise<SignoffGateResult> {
  try {
    const participants = await new TicketParticipantsService(db)
      .listParticipants(env, args.tenantId, args.taskId);
    const gate = decideSignoffGate(participants);
    if (args.stageKey === undefined) return gate;
    const outstanding = slotsForStage(gate.outstanding, args.stageKey);
    if (outstanding.length === gate.outstanding.length) return gate;
    return {
      ...gate,
      outstanding,
      detail: outstanding.length
        ? `Waiting on ${outstanding.length} required sign-off${outstanding.length === 1 ? '' : 's'} for this stage: ${outstanding.map((o) => o.roleName).join(', ')}.`
        : `No required role owes anything at this stage (${gate.outstanding.length} outstanding on later stages).`,
    };
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
