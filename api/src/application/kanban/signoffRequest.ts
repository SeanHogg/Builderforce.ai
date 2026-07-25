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
 * ── WHY IT NAMES A TOOL AND NOT A URL ────────────────────────────────────────────
 * The instruction used to say "POST /api/kanban/tasks/<id>/signoff". An unattended
 * cloud agent has NO HTTP capability — the entire catalog in `builtinMcpService` has no
 * fetch/http tool of any kind, by design — so that sentence asked for the one thing the
 * reviewer structurally could not do. Its only route to the ledger is the
 * {@link SIGNOFF_TOOL} MCP tool, which IS on `CLOUD_AGENT_PLATFORM_TOOLS` and replays
 * that exact route server-side.
 *
 * The consequence was a closed loop that could never close: the gate dispatched a
 * reviewer, the reviewer run COMPLETED (so no failure breaker ever tripped), no verdict
 * row was written, the slot stayed `in_progress`, `decideSignoffGate` stayed shut, and
 * the manager's conduct pass kept re-asking. Measured on task 173 — 24 days in
 * `in_review`, reviewer dispatched, zero sign-offs. Naming the tool is what lets an
 * autonomously-reviewed ticket actually reach Done.
 *
 * Pure string/JSON building, no IO — trivially unit-tested.
 */

/**
 * The MCP tool an agent records its verdict with. One constant because BOTH instruction
 * builders name it and the whole round-trip is wasted if they name anything else.
 * Must stay in sync with the `kanban.signoff` entry in `builtinMcpService.CATALOG`
 * (and its membership in `CLOUD_AGENT_PLATFORM_TOOLS`).
 */
export const SIGNOFF_TOOL = 'kanban.signoff';

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
  // `laneKey` is spelled out in the tool call AND called out again below, because the
  // whole round-trip is wasted when the agent omits it (see the module header).
  const laneArg = lane ? `, laneKey='${lane}'` : '';
  return (
    `You are the ${spec.roleName} accountable for ticket #${spec.taskId}${title}${at}. `
    + `Review the delivered work against the ticket description, the PRD and its acceptance criteria${pr}. `
    + `Then RECORD YOUR VERDICT — this is required, the ticket cannot complete without it: `
    + `call the \`${SIGNOFF_TOOL}\` tool with taskId=${spec.taskId}, roleKey='${spec.roleKey}'${laneArg}, `
    + `verdict='approved' if the work meets the criteria, or verdict='changes_requested' with the specific fixes needed. `
    + (lane ? `Pass laneKey exactly as given — your verdict is matched to this lane's accountability slot by it. ` : '')
    + `Always pass \`contribution\` linking the evidence you actually inspected (prUrl, diffFiles, executionId) — `
    + `an approval with no linked contribution is itself an audit finding. `
    + `If you request changes, describe the specific fixes for the producing role to resolve. `
    + `\`${SIGNOFF_TOOL}\` is available to you in this run — use it directly; do NOT attempt an HTTP request, `
    + `you have no network tool and the verdict would simply never be recorded.`
  );
}

/**
 * The instruction a PRODUCER receives — "you are the role that must BUILD this stage's
 * deliverable, then record that you did".
 *
 * Shares this module for the same reason the reviewer contract does: the lane
 * requirement gate hand-wrote its producer string inline, and it inherited the same
 * defect in a worse form — it asked for "a role-attributed sign-off" while naming
 * neither the tool nor `laneKey`, so a producer that finished real work still left the
 * slot unsatisfied. One builder, one tool name, one lane argument.
 */
export function buildProducerRequestInstruction(spec: SignoffRequestSpec): string {
  const lane = spec.laneKey ?? '';
  const title = spec.taskTitle?.trim() ? ` ("${spec.taskTitle.trim()}")` : '';
  const at = lane ? ` at lane '${lane}'` : '';
  const laneArg = lane ? `, laneKey='${lane}'` : '';
  return (
    `You are the ${spec.roleName} assigned to PRODUCE the work for ticket #${spec.taskId}${title}${at}. `
    + `Implement or author the required deliverable (open a pull request for code, or write the PRD section for a spec role). `
    + `Your run is recorded as this role's participation on the ticket's accountability manifest. `
    + `When the deliverable is complete, RECORD IT — the ticket cannot complete without it: `
    + `call the \`${SIGNOFF_TOOL}\` tool with taskId=${spec.taskId}, roleKey='${spec.roleKey}'${laneArg}, verdict='approved', `
    + `and \`contribution\` linking the evidence you produced (prUrl, diffFiles, executionId). `
    + (lane ? `Pass laneKey exactly as given — your record is matched to this lane's accountability slot by it. ` : '')
    + `\`${SIGNOFF_TOOL}\` is available to you in this run — use it directly; do NOT attempt an HTTP request, `
    + `you have no network tool and the record would simply never be written.`
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

/**
 * The dispatch payload for a PRODUCER run. `actAsRole` (rather than `reviewRole`) is the
 * key `parseActAsRole` reads for a producing role, so `attributeRunToManifest` lands the
 * finished run — and its PR evidence — on that role's owner/contributor slot.
 */
export function buildProducerRequestPayload(
  spec: SignoffRequestSpec & { cloudAgentRef: string; model?: string | null },
): string {
  return JSON.stringify({
    cloudAgentRef: spec.cloudAgentRef,
    ...(spec.model ? { model: spec.model } : {}),
    laneKey: spec.laneKey,
    actAsRole: spec.roleKey,
    reviewInstruction: buildProducerRequestInstruction(spec),
  });
}
