/**
 * A reply the USER cut short — what the model had streamed when Stop was pressed, kept
 * as its own message instead of vanishing with the streaming bubble.
 *
 * Stop is pressed exactly when a model has gone wrong: looping, narrating calls it never
 * makes, counting to itself. Stop used to clear the live text, and an aborted stream
 * never returns a result, so the evidence — WHAT it was writing and WHICH model wrote it
 * — was gone the instant the reader acted on it. Observed 2026-09-13 (chat #106): a Grok
 * turn and a MiniMax turn both ran on until Stop, and neither the transcript nor the
 * copied report could say which model had done it. The run store now persists the
 * partial with the usual provenance (so the timeline chip names the model), this marker,
 * and a durable {@link STOPPED_TURN_STEP} step the diagnostics score per model.
 *
 * The marker is also what keeps the partial OUT of the model's view: a stopped turn is a
 * record for the reader, never a turn to continue from — re-sending a loop to the next
 * model is how a loop spreads.
 */
import { asProvenanceAccount, withProvenanceMetadata } from './provenance';

/** The metadata key that marks a persisted assistant message as stopped mid-stream. */
export const STOPPED_TURN_META_KEY = 'stoppedByUser';

/** The trace/step label a user Stop records — `args.model` names the model it cut off. */
export const STOPPED_TURN_STEP = 'agent.stopped';

/** Which model (and whose account) was streaming when Stop was pressed, when known. */
export interface StoppedTurnSource {
  model?: string;
  account?: string;
}

/** Metadata for a stopped turn: the marker, plus provenance whenever the model was known. */
export function stoppedTurnMetadata(source: StoppedTurnSource): string {
  const account = asProvenanceAccount(source.account);
  const provenance = source.model ? { model: source.model, ...(account ? { account } : {}) } : null;
  return withProvenanceMetadata(provenance, { [STOPPED_TURN_META_KEY]: true }) ?? '{}';
}

/** Whether a persisted message is a reply the user stopped mid-stream. */
export function isStoppedTurn(msg: { metadata?: string | null }): boolean {
  if (!msg.metadata) return false;
  try {
    return (JSON.parse(msg.metadata) as Record<string, unknown> | null)?.[STOPPED_TURN_META_KEY] === true;
  } catch {
    return false;
  }
}
