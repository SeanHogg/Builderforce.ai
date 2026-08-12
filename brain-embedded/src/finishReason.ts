/**
 * ONE reading of an OpenAI-compatible `finish_reason`.
 *
 * A turn that ends without tool calls is not automatically a turn where the model
 * chose to speak. Two stop reasons mean the opposite — the model was INTERRUPTED
 * mid-output — and they need the opposite recovery from a normal empty answer:
 *
 *  - TRUNCATED: the response hit the output-token ceiling. Vendors spell this
 *    `length` (OpenAI-compatible), `max_tokens` (Anthropic) and `MAX_TOKENS`
 *    (Google). A tool call cut off here never reaches the caller at all, because
 *    its JSON arguments are incomplete — which is exactly how a canvas turn that
 *    was authoring a real artifact appears as "the model just didn't call a tool".
 *  - MALFORMED_TOOL_CALL: the model tried to call a tool and emitted arguments the
 *    provider could not parse (Gemini's `MALFORMED_FUNCTION_CALL`). Also an
 *    attempted action, not a spoken answer.
 *
 * Vendors are compared case-insensitively and by normalised shape so a new spelling
 * of the same condition does not silently degrade to "the model answered".
 */
export type TurnInterruption = 'truncated' | 'malformed-tool-call';

const TRUNCATED_REASONS = new Set(['length', 'max_tokens', 'maxtokens', 'model_length', 'output_limit']);
const MALFORMED_TOOL_CALL_REASONS = new Set(['malformed_function_call', 'malformed_tool_call', 'invalid_tool_call']);

const normalise = (finishReason: string | null | undefined): string =>
  (finishReason ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');

/** The reason this turn was cut short, or `null` when it ended on its own terms. */
export function turnInterruption(finishReason: string | null | undefined): TurnInterruption | null {
  const reason = normalise(finishReason);
  if (!reason) return null;
  if (TRUNCATED_REASONS.has(reason)) return 'truncated';
  if (MALFORMED_TOOL_CALL_REASONS.has(reason)) return 'malformed-tool-call';
  return null;
}

/** The response hit the output-token ceiling — its text and any tool call are incomplete. */
export function isTruncatedTurn(finishReason: string | null | undefined): boolean {
  return turnInterruption(finishReason) === 'truncated';
}

/** The model attempted a tool call the provider could not parse. */
export function isMalformedToolCall(finishReason: string | null | undefined): boolean {
  return turnInterruption(finishReason) === 'malformed-tool-call';
}
