/**
 * Hand a chat words it did not get - see `continueChat.ts`. The door the turn hook uses: it knows
 * only the run key, so the run it may start is supplied here.
 */

import type { ChatInputAttachment } from '../types';
import { wakeChat as wake, type HandedTurn } from './continueChat';
import { startRun } from './startRun';

/**
 * True when the chat took the words as its next turn; the caller keeps them otherwise. One turn is
 * `(runKey, text, attachments)`; several - every turn a chat left behind - are `(runKey, [{ text, attachments }, ...])`,
 * taken together, in order, as ONE continuation.
 */
export function wakeChat(runKey: number, turns: string | readonly HandedTurn[], attachments?: readonly ChatInputAttachment[]): boolean {
  return wake(runKey, typeof turns === 'string' ? [{ text: turns, ...(attachments ? { attachments } : {}) }] : turns, startRun);
}
