/**
 * signoffRequest — THE contract for asking an agent to record a role sign-off.
 *
 * Three call sites dispatch a cloud run whose whole purpose is "review this ticket as
 * role R and record your verdict": the lane requirement gate's reviewer round-trip, the
 * new lane-AGENT approval path (a board with no `swimlane_requirements` rows), and the
 * AI Manager's `driveOutstandingSignoffs`. Each had hand-written its own instruction
 * string, and the drift between them was not cosmetic — it was the bug.
 *
 * WHY `laneKey` IS THE LOAD-BEARING PART. A manifest slot is keyed by (stage, role)
 * and `TicketParticipantsService.syncStates` matches a ledger row to a slot on
 * `${laneKey}:${roleKey}`. Both hand-written instructions told the agent to POST
 * `roleKey` and said NOTHING about `laneKey` — so the agent recorded a verdict with
 * `laneKey = null`, which matched no lane-scoped slot, so the slot never left
 * `in_progress`, so `decideSignoffGate` never opened. A sign-off that lands in the
 * ledger but not on the manifest is invisible to every gate that depends on it, which
 * is a large part of why the measured state was 487 required slots and 0 satisfied.
 *
 * Pure string/JSON building, no IO — trivially unit-tested.
 */

/** Everything the reviewing agent must be told to record a slot-matching sign-off. */
export interface SignoffRequestSpec {
  taskId: number;
  /** Ticket title, when the caller has it (makes the instruction self-describing). */
  taskTitle?: string | null;
  roleKey: string;
  roleName: string;
  /** The lane whose accountability slot this verdict must satisfy. */
  laneKey: string | null;
  /** The ticket's pull request, when there is one — the artefact to actually inspect. */
  prUrl?: string | null;
}

/**
 * The instruction an approving agent receives. Deliberately explicit that the verdict
 * is MANDATORY and that `contribution` must link real evidence: an approval with no
 * linked contribution is itself an audit finding (`getAccountability` raises it as the
 * `no_contribution` gap), so asking for it up front is cheaper than auditing it later.
 */
export function buildSignoffRequestInstruction(spec: SignoffRequestSpec): string {
  const lane = spec.laneKey ?? '';
  const title = spec.taskTitle?.trim() ? ` ("${spec.taskTitle.trim()}")` : '';
  const at = lane ? ` at lane '${lane}'` : '';
  const pr = spec.prUrl ? ` (pull request: ${spec.prUrl})` : '';
  // `laneKey` is spelled out in the POST body AND called out again below, because the
  // whole round-trip is wasted when the agent omits it (see the module header).
  const laneArg = lane ? `, laneKey='${lane}'` : '';
  return (
    `You are the ${spec.roleName} accountable for ticket #${spec.taskId}${title}${at}. `
    + `Review the delivered work against the ticket description, the PRD and its acceptance criteria${pr}. `
    + `Then RECORD YOUR VERDICT — this is required, the ticket cannot complete without it: `
    + `POST /api/kanban/tasks/${spec.taskId}/signoff with roleKey='${spec.roleKey}'${laneArg}, `
    + `verdict 'approved' if the work meets the criteria, or 'changes_requested' with the specific fixes needed. `
    + (lane ? `Pass laneKey exactly as given — your verdict is matched to this lane's accountability slot by it. ` : '')
    + `Always pass \`contribution\` linking the evidence you actually inspected (prUrl, diffFiles, executionId) — `
    + `an approval with no linked contribution is itself an audit finding. `
    + `If you request changes, describe the specific fixes for the producing role to resolve.`
  );
}

/**
 * The dispatch payload for a sign-off request run. `reviewRole` is what makes the run
 * role-attributed (`parseActAsRole` reads it, so `attributeRunToManifest` lands the run
 * on the right slot) and `laneKey` is what records which lane the run served.
 */
export function buildSignoffRequestPayload(
  spec: SignoffRequestSpec & { cloudAgentRef: string; model?: string | null },
): string {
  return JSON.stringify({
    cloudAgentRef: spec.cloudAgentRef,
    ...(spec.model ? { model: spec.model } : {}),
    laneKey: spec.laneKey,
    reviewRole: spec.roleKey,
    reviewInstruction: buildSignoffRequestInstruction(spec),
  });
}
