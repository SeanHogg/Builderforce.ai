/**
 * Shared data shapes for the brain core. These define the contract the host
 * persistence adapter conforms to — they mirror the Builderforce `/api/brain`
 * payloads but are owned here so the package has no dependency on the app.
 */

/** A brain chat (conversation) record. */
export interface BrainChat {
  id: number;
  title: string;
  projectId: number | null;
  /** Where the chat was created (e.g. 'brainstorm' | 'ide' | 'project'). */
  origin?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Truthful, server-reported outcome of the project-Evermind LEARN gate for a
 * just-persisted assistant turn: whether the server WILL contribute this turn to the
 * project's Evermind (the same gate `learnFromBrainTurn` applies — project-scoped +
 * seeded + connected head) and the head version it contributes to. The run loop uses
 * it to render a TRUTHFUL `learn` step, replacing the old client-side heuristic guess
 * (which both false-positived and, for a connected-but-empty Evermind, false-negatived).
 */
export interface EvermindLearnOutcome {
  learned: boolean;
  version: number;
  /**
   * When `learned` is false, WHY the turn wasn't contributed — mirrors the api's
   * `BrainLearnSkipReason` so the run loop can render an EXPLAINED (muted) skip step
   * instead of silently showing nothing. Absent/null when the turn was contributed.
   *   `not-attached` chat isn't bound to a project · `not-seeded` no base model yet ·
   *   `frozen` Evermind is read-only · `too-short` no teachable assistant text.
   */
  reason?: 'not-attached' | 'not-seeded' | 'frozen' | 'too-short' | null;
}

/** A single message within a chat. */
export interface BrainMessage {
  id: number;
  role: string;
  content: string;
  metadata: string | null;
  seq: number;
  createdAt: string;
  /**
   * Transient (NOT persisted, NOT returned by getMessages): the learn-gate outcome
   * the send-messages response computed for THIS turn, attached to the returned
   * assistant message so the run loop can render a truthful learn step. Absent on
   * loaded/historical messages and on non-assistant turns.
   */
  evermindLearn?: EvermindLearnOutcome;
}

/**
 * The message role used for durable tool/memory STEP rows the agent loop persists
 * (so a reload can reconstruct the timeline steps — the live trace is in-memory only).
 * These rows are NOT conversation turns: their `content` is empty and the payload
 * lives in `metadata` (`{ kind:'step', … }`). The timeline reconstructs them into
 * tool/recall/learn/reconcile nodes; every OTHER consumer that treats the message
 * list as a dialogue (the model seed, a summary/PRD transcript, a plain bubble list)
 * must exclude them via {@link isStepMessage}.
 */
export const STEP_MESSAGE_ROLE = 'tool';

/** True when a persisted message is a durable tool/memory STEP row (role ===
 *  {@link STEP_MESSAGE_ROLE}) rather than a user/assistant conversation turn. */
export function isStepMessage(m: { role: string }): boolean {
  return m.role === STEP_MESSAGE_ROLE;
}

/** An uploaded attachment reference attached to an outgoing message. */
export interface ChatInputAttachment {
  key: string;
  name: string;
  type: string;
  /**
   * Model-visible image source for vision turns — a `data:` URL (inlined small
   * images) or a short-lived signed public URL (large images). Present only for
   * raster images; when set, the attachment becomes an `image_url` content part
   * the vision model can actually see, instead of a plain text link.
   */
  imageUrl?: string;
}

/**
 * Modality is a free-form string in the core (e.g. 'designer' | 'video' | 'llm').
 * The host maps it to a system prompt via `BrainConfig.resolveSystemPrompt`.
 */
export type BrainModality = string;
