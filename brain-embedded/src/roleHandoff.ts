/**
 * The analysis→code hand-off, as it appears on the wire.
 *
 * When an auto-routed run's planning turn reaches for its first code change, the loop
 * discards that turn and re-asks the SAME turn, from the same transcript, with role
 * `code` (see `brainRunStore.ts`). A request with role `code` straight after one with
 * role `plan` is that re-ask — a run's role only ever moves from plan to code there.
 *
 * Exported so a scripted gateway can recognise the re-ask and replay the current step
 * instead of advancing its script: a real coding model, handed the same transcript,
 * makes the same move. Pure.
 */
export function isCoderReask(role: string | undefined, previousRole: string | undefined): boolean {
  return role === 'code' && previousRole === 'plan';
}

/** A planner tool call, as the hand-off reads it. */
export interface HandoffCall {
  name: string;
  args: string;
}

/** Longest single call quoted in the brief; an edit's text is the part that matters. */
const MAX_CALL_CHARS = 2_000;
/** Longest brief overall — it rides one request, on top of the full transcript. */
const MAX_BRIEF_CHARS = 6_000;

/**
 * What the coding model is TOLD at the hand-off — the planner's findings and the change
 * it was about to make.
 *
 * Observed (VS Code chat #133): MiniMax-M1 planned for 22 turns, reached its first edit,
 * and the re-ask went to Grok 4.6 with nothing but the transcript. Grok did not "make the
 * same move" — it started the investigation over, five and six reads a turn, re-reading
 * files the planner had already read above it. The transcript holds the evidence; it
 * does not say the analysis is FINISHED or what it concluded. This does.
 *
 * Returned as the text of one user-role message appended to that single re-ask (never
 * persisted): the coder's own first call then carries the run forward.
 */
export function coderHandoffBrief(plannerText: string, calls: readonly HandoffCall[]): string {
  const findings = plannerText.trim();
  const intended = calls.map((call) => {
    const args = call.args.length > MAX_CALL_CHARS ? `${call.args.slice(0, MAX_CALL_CHARS)}…` : call.args;
    return `- ${call.name} ${args}`;
  });
  const parts = [
    'HAND-OFF: the analysis for this request is complete — you are the coding model taking it from here. Everything the planner read is in the conversation above; do not start the investigation over or re-read files already returned above.',
    ...(findings ? ['The planner concluded:', findings] : []),
    'It was about to make this change:',
    ...intended,
    'Make that change now. Correct it if it is wrong — a file you have not seen, or text that does not match — but act on it rather than re-planning. Read only what the edit itself needs and is not already above.',
  ];
  const brief = parts.join('\n');
  return brief.length > MAX_BRIEF_CHARS ? `${brief.slice(0, MAX_BRIEF_CHARS)}…` : brief;
}
