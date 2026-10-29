/**
 * Hand a chat words it did not get - see `continueChat.ts`. The door the turn hook uses: it knows
 * only the run key, so the run it may start is supplied here.
 */

import type { ChatInputAttachment } from '../types';
import { wakeChat as wake } from './continueChat';
import { startRun } from './startRun';

/** True when the chat took the words as its next turn; the caller keeps them otherwise. */
export function wakeChat(runKey: number, text: string, attachments?: readonly ChatInputAttachment[]): boolean {
  return wake(runKey, text, attachments, startRun);
}
