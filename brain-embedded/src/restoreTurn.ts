/**
 * Give a turn that could not go back to the composer: its text (unless the person has typed something
 * since), its files (merged by key), and its ADDRESSEE - reset to what the turn had, so a turn for the Brain
 * never comes back pointed at a participant the composer happened to hold. THE one restore every host uses
 * (web panel, editor chat), so a message is never half-restored.
 */

import type { Dispatch, SetStateAction } from 'react';
import type { ChatInputAttachment, DirectedRecipient } from './types';

export function restoreTurn(
  turn: { text: string; attachments?: readonly ChatInputAttachment[]; recipient: DirectedRecipient | null },
  composer: {
    setInput: Dispatch<SetStateAction<string>>;
    restoreAttachments: (files: readonly ChatInputAttachment[]) => void;
    chooseRecipient: (to: DirectedRecipient | null) => void;
  },
): void {
  composer.setInput((cur) => cur || turn.text);
  composer.restoreAttachments(turn.attachments ?? []);
  composer.chooseRecipient(turn.recipient);
}
