/**
 * Hand a chat words it did not get - see `continueChat.ts`. The door the turn hook uses: it knows
 * only the run key, so the run it may start is supplied here.
 */

import type { ChatInputAttachment } from '../types';
import { continueLeftovers, wakeChat as wake } from './continueChat';
import { getCell } from './runCells';
import { startRun } from './startRun';

/**
 * Words steered into a run that is never going to start (its send could not be saved): the chat's
 * next turn when it has a request to run with, kept in its inbox - never lost - when it has none.
 */
export function continueStranded(runKey: number): void {
  void continueLeftovers(runKey, getCell(runKey), startRun);
}

/** True when the chat took the words as its next turn; the caller keeps them otherwise. */
export function wakeChat(runKey: number, text: string, attachments?: readonly ChatInputAttachment[]): boolean {
  return wake(runKey, text, attachments, startRun);
}
