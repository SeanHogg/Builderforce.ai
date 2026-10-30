/**
 * THE one rule for a turn that could not go - the same on every host (web panel, Rovr, the editor chat):
 * it goes back to the composer that is SHOWING, never dropped and never auto-sent into another chat.
 *
 *  - its files come back (merged by key);
 *  - its text comes back unless the person has typed something newer since - and ONLY then does it also restore
 *    the ADDRESSEE (reset to what the turn had, so a turn for the Brain never comes back pointed at a
 *    participant the composer happened to hold). A newer draft keeps the addressee it was written for.
 */

import type { ChatInputAttachment, DirectedRecipient } from './types';

export function restoreTurn(
  turn: { text: string; attachments?: readonly ChatInputAttachment[]; recipient: DirectedRecipient | null },
  composer: {
    /** The composer's text right now (read at call time - a ref, not a render-time capture). */
    draft: () => string;
    /** Put the text back IF the box is still empty (`useComposerDraft().fillIfEmpty`). */
    setInput: (text: string) => void;
    restoreAttachments: (files: readonly ChatInputAttachment[]) => void;
    chooseRecipient: (to: DirectedRecipient | null) => void;
  },
): void {
  composer.restoreAttachments(turn.attachments ?? []);
  if (composer.draft()) return;
  composer.setInput(turn.text);
  composer.chooseRecipient(turn.recipient);
}
