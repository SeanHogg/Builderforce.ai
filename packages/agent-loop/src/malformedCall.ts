/**
 * What to do with a tool call whose arguments never parsed.
 *
 * The kernel's policy is that bad JSON never aborts a run: `parseToolArgs`
 * hands the call over with `args: {}` and `malformed: true` (see
 * `parseToolCall.ts`). That policy only works if every consumer then DECLINES
 * TO RUN the call. A consumer that dispatches it anyway runs the tool with an
 * empty bag, and the tool answers with whatever it says when a required
 * argument is missing — which tells the model nothing about what actually
 * happened, so it re-sends the same oversized call and fails identically until
 * the run is spent.
 *
 * That is not hypothetical. A Studio build run on 2026-10-03 produced four
 * `canvas_write_build_file` calls of ~12 KB each, every one of them the tail of
 * a response that hit the output ceiling, and every one of them dispatched with
 * `{}` and answered "A path is required." The canvas loop had this guard; the
 * Brain loop did not, so the same defect was fixed in one place and live in the
 * other. It lives here now, next to the parse that creates the flag, so the
 * next loop to call the kernel inherits the handling instead of the bug.
 *
 * The two messages are deliberately opposite, because the remedies are: a
 * truncated call must be made SMALLER, while a malformed one is the right size
 * and simply encoded wrong. Telling a model to "send valid JSON" when it was
 * cut off at the token ceiling sends it round the loop again.
 */

export const MALFORMED_CALL_RESULT =
  "This tool call's arguments were not valid JSON, so it was NOT executed. Re-issue it with strictly valid JSON: no comments, no trailing commas, no unescaped newlines or quotes inside string values.";

export const TRUNCATED_CALL_RESULT =
  'This tool call was cut off by the output limit before its arguments were complete, so it was NOT executed. Re-issue it in your next response as ONE call with complete JSON — never several calls in one response. If the content is long, write it in parts: create it with its essential fields first, then extend it with follow-up calls.';

/**
 * The outcome to return INSTEAD of running `call`, or null when it is fine to run.
 *
 * `truncated` is the turn's interruption, not the call's: only the finish reason
 * knows whether the arguments were cut off or merely wrong, and the caller is
 * what holds it (`turnInterruption(finishReason) === 'truncated'`).
 *
 * `retryHint` appends a surface's own advice — the canvas names
 * `canvas_update_object` as the way to add the rest of a long object, which is
 * true there and meaningless elsewhere.
 */
export function malformedCallOutcome(
  call: { malformed: boolean },
  truncated: boolean,
  retryHint?: string,
): { error: string } | null {
  if (!call.malformed) return null;
  const base = truncated ? TRUNCATED_CALL_RESULT : MALFORMED_CALL_RESULT;
  return { error: retryHint ? `${base} ${retryHint}` : base };
}

/** The trace label for a declined call — it says which of the two happened. */
export function malformedCallLabel(name: string, truncated: boolean): string {
  return truncated ? `${name} (cut off by the output limit)` : `${name} (unparseable arguments)`;
}
