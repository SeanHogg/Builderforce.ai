/**
 * The run's PER-TURN context block — what changes every run, kept OUT of the system
 * prompt so the prompt prefix can cache (cost lever `b1_stable_prefix`, defect 3).
 *
 * The system prompt leads every call. Folding this run's Evermind recall, its limbic
 * augmentation or the continuation directive into it made the very first bytes of the
 * prompt differ on every run, so no provider prefix cache ever hit across runs of a
 * chat — the persona, the mode contract and the whole history were re-billed at full
 * price each time. These blocks belong to THIS turn, so they ride with this turn's user
 * message, AFTER the history: everything before them is byte-identical to last run.
 *
 * Mechanics. The latest user message in the run's transcript is REPLACED, in its own
 * slot, by a copy with the block appended (a trailing text part for a vision turn) —
 * the transcript's indices never move, so compaction's covered-range memo stays valid,
 * and the original object (which a host's seed array may share) is never mutated. The
 * original is remembered per run cell and put back at the START of the next run's preamble, before
 * anything reads the history, so last run's recall never becomes part of this run's
 * history (or of its routing query). Readers that must see the user's own words read
 * `run.userRequest` / `run.requestQuery`, which the preamble captures before attaching.
 *
 * Pure apart from the per-cell memo; no I/O.
 */

import type { ChatCompletionMessage, ContentPart } from '../streamChatCompletion';
import type { RunCell } from './runCell';

/** Wraps the block so the model reads it as context for this turn, not as the ask. */
const OPEN = '<turn_context>\nContext for this turn only (recalled memory and run directives) — not part of the request:';
const CLOSE = '</turn_context>';

interface Attached {
  convo: ChatCompletionMessage[];
  index: number;
  /** The copy that carries the block — restored only while it still holds the slot. */
  carrier: ChatCompletionMessage;
  original: ChatCompletionMessage;
}

const attached = new WeakMap<RunCell, Attached>();

/** The block for this turn's parts, or null when every part is empty. */
export function turnContextBlock(parts: ReadonlyArray<string | null | undefined>): string | null {
  const body = parts.map((p) => (p ?? '').trim()).filter(Boolean).join('\n\n');
  return body ? `${OPEN}\n\n${body}\n${CLOSE}` : null;
}

/** Put back the user message the previous run attached its block to. Idempotent. */
export function restoreTurnContext(c: RunCell): void {
  const prior = attached.get(c);
  if (!prior) return;
  if (prior.convo[prior.index] === prior.carrier) prior.convo[prior.index] = prior.original;
  attached.delete(c);
}

/**
 * Attach `block` after the history — to the latest user message. Returns false when
 * there is no user message to carry it (the caller then keeps it in the system prompt,
 * today's placement, rather than dropping it).
 */
export function attachTurnContext(c: RunCell, convo: ChatCompletionMessage[], block: string): boolean {
  restoreTurnContext(c);
  for (let i = convo.length - 1; i >= 0; i -= 1) {
    const original = convo[i]!;
    if (original.role !== 'user') continue;
    const content: string | ContentPart[] = typeof original.content === 'string'
      ? `${original.content}\n\n${block}`
      : [...original.content, { type: 'text', text: block }];
    const carrier: ChatCompletionMessage = { ...original, content };
    convo[i] = carrier;
    attached.set(c, { convo, index: i, carrier, original });
    return true;
  }
  return false;
}
