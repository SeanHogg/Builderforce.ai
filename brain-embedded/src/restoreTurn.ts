/**
 * THE one rule for a turn that could not go - the same on every host (web panel, Rovr, the editor chat):
 * it goes back to the composer that is SHOWING, never dropped and never auto-sent into another chat.
 *
 *  - its files come back (merged by key);
 *  - its text comes back. Into an empty box it comes back alone, and with it the ADDRESSEE (reset to what the turn had, so a
 *    turn for the Brain never comes back pointed at a participant the composer happened to hold). If the person has typed
 *    something newer since, the turn's words go IN FRONT of it, a blank line between (they were said first: the same order
 *    `joinRestorableTurns` keeps) - nothing a person said is dropped - and the newer draft keeps the addressee it was
 *    written for.
 */

import type { ChatInputAttachment } from './types';
import type { DirectedRecipient } from './directedMessage';

/** A turn as the composer takes it back. */
export interface RestorableTurn {
  text: string;
  attachments?: readonly ChatInputAttachment[];
  recipient: DirectedRecipient | null;
}

/**
 * SEVERAL turns that cannot go - every turn a chat left behind when the person moved on - as the ONE turn the
 * composer takes back (one `restoreTurn` call: the box holds one draft, so a second restore would find the first's
 * words "a newer draft" and drop its own). Texts joined in the order they were said, files together, and the addressee
 * of the first turn that had one. A single turn is itself.
 */
export function joinRestorableTurns(turns: readonly RestorableTurn[]): RestorableTurn {
  if (turns.length === 1) return turns[0]!;
  const attachments = turns.flatMap((t) => t.attachments ?? []);
  return {
    text: turns.map((t) => t.text).join("\n\n"),
    ...(attachments.length > 0 ? { attachments } : {}),
    recipient: turns.find((t) => t.recipient != null)?.recipient ?? null,
  };
}

export function restoreTurn(
  turn: RestorableTurn,
  composer: {
    /** The composer's text right now (read at call time - a ref, not a render-time capture). */
    draft: () => string;
    /** Write the box's whole text (`useComposerDraft().setInput`): the turn's alone, or the turn's in front of the newer draft. */
    setInput: (text: string) => void;
    restoreAttachments: (files: readonly ChatInputAttachment[]) => void;
    chooseRecipient: (to: DirectedRecipient | null) => void;
  },
): void {
  composer.restoreAttachments(turn.attachments ?? []);
  const newer = composer.draft();
  if (newer) {
    if (turn.text.trim()) composer.setInput(`${turn.text}\n\n${newer}`);
    return;
  }
  composer.setInput(turn.text);
  composer.chooseRecipient(turn.recipient);
}
