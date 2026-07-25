/**
 * participantStates — THE one classification of a ticket-participation slot's state.
 *
 * `ParticipantState` has 8 values, and "is this slot still owing work?" is the single
 * most load-bearing question in the whole coordination layer: it decides whether a lane
 * may advance, whether a reviewer gets dispatched, whether a ticket is complete, and
 * (now) whether the AI Manager may self-govern a merge.
 *
 * That question was answered by SEVEN independent inline `new Set([...])` literals
 * (`ticketParticipants.doneGate` / `.projectSummary` / `.getAccountability`,
 * `coordinateTicket.decideCoordinatedAdvance` / `.coordinateTicket`,
 * `laneRequirementGate`, and the inverse framing in `evaluateAutoRun`). Seven copies of
 * the rule that gates autonomous merging is exactly the kind of drift that lets one
 * path complete a ticket another path considers unfinished — so it lives here once.
 *
 * Pure data + pure predicates: no DB, no env, trivially unit-testable.
 */
import type { ParticipantState } from './ticketParticipants';

/**
 * States that mean "this slot owes nothing further".
 *
 * `waived` and `skipped` count as satisfied deliberately: a waiver is a recorded,
 * reasoned decision not to require the role (the sign-off route demands a reason for
 * one), not an omission. Treating them as outstanding would deadlock any ticket whose
 * template names a role the project genuinely does not use.
 */
export const SATISFIED_PARTICIPANT_STATES: ReadonlySet<ParticipantState> = new Set<ParticipantState>([
  'completed', 'waived', 'skipped',
]);

/**
 * States that still owe work AND have someone to do it — the dispatch/advance blockers.
 *
 * Deliberately EXCLUDES `unstaffed`: that slot has no resolved assignee, so there is
 * nobody to dispatch and no sign-off to wait for. It is a staffing gap surfaced by the
 * accountability report, not a work-in-flight state. (This is the pre-existing
 * `OPEN_PARTICIPANT_STATES` semantics from `evaluateAutoRun`, preserved verbatim.)
 */
export const OPEN_PARTICIPANT_STATES: ReadonlySet<ParticipantState> = new Set<ParticipantState>([
  'pending', 'assigned', 'in_progress', 'changes_requested',
]);

/**
 * States a run-attribution may advance out of (`recordRunAttribution`). Includes
 * `unstaffed` because attributing a run to a slot is precisely what resolves its
 * assignee — but never moves a slot that already reached a terminal verdict.
 */
export const ADVANCEABLE_PARTICIPANT_STATES: ReadonlySet<ParticipantState> = new Set<ParticipantState>([
  'pending', 'assigned', 'unstaffed', 'in_progress',
]);

/** True when the slot owes nothing further (completed / waived / skipped). */
export function isParticipantSatisfied(state: ParticipantState | string): boolean {
  return SATISFIED_PARTICIPANT_STATES.has(state as ParticipantState);
}

/**
 * True when the slot still owes work AND has someone to do it — i.e. it is a candidate
 * for dispatch. See {@link OPEN_PARTICIPANT_STATES} for why `unstaffed` is excluded;
 * use {@link blocksCompletion} instead when asking "may this ticket complete?".
 */
export function isParticipantOpen(state: ParticipantState | string): boolean {
  return OPEN_PARTICIPANT_STATES.has(state as ParticipantState);
}

/**
 * True when the slot is REQUIRED and not yet satisfied — i.e. it blocks completion.
 *
 * Note this treats `unstaffed` as blocking, unlike {@link OPEN_PARTICIPANT_STATES}.
 * The distinction is intentional and matters: an unstaffed required role must never be
 * *dispatched* (nobody to dispatch), but it must absolutely still *block a merge* —
 * otherwise "all agents signed off" would be satisfiable by having no agent at all.
 */
export function blocksCompletion(slot: { required: boolean; state: ParticipantState | string }): boolean {
  return slot.required && !isParticipantSatisfied(slot.state);
}
