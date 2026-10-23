/**
 * A canvas turn refused because NO MODEL could take it — nothing on this device (Local
 * only, or no cloud route), Specific model with nothing picked, or an on-device engine
 * that failed. Each verdict has a remedy the person can act on (Switch to Hybrid,
 * Download a local model, Pick a model), so it is NOT written into the transcript as a
 * plain system line the person can only read: it is held as the board's live refusal and
 * rendered by THE web banner (`BrainErrorBanner` → the shared `ChatErrorBanner`) beside
 * the conversation, with the request kept so "Switch to Hybrid" re-sends it.
 */
import { chatErrorAction, type ChatErrorAction } from '@seanhogg/builderforce-brain-embedded';

export interface CanvasModelRefusal {
  /** The request the verdict refused — what "Switch to Hybrid" sends again. */
  request: string;
  /** The sentence the turn failed with, in the person's language. */
  message: string;
  /** The verdict the banner reads its remedies from. */
  action: ChatErrorAction;
}

const MODEL_VERDICTS: ReadonlySet<ChatErrorAction['kind']> = new Set(['no_local_model', 'no_specific_model', 'local_engine_failed']);

/** The verdict when `error` is a no-model refusal with a remedy, else null. */
export function modelRefusalAction(error: unknown): ChatErrorAction | null {
  const action = chatErrorAction(error);
  return action && MODEL_VERDICTS.has(action.kind) ? action : null;
}
