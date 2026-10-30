/**
 * Where the pending-words journal's NON-fatal failures go - what it degrades around rather than throws: a page load that
 * could not announce itself as alive (so another load may call its words dead and replay them), a replay that failed.
 * Neither may block a steer or the app's start, which is exactly why neither may vanish: without the reason, "my words
 * came back twice" or "my words never came back" has no answer. One line per failure, in one format - the same shape as
 * `pageEngines/engineFailure.ts`.
 */

import { errorMessage } from './pageEngines/types';

/** The step that failed. */
export type PendingWordsFailureStage = 'hold_session' | 'replay';

export function reportPendingWordsFailure(stage: PendingWordsFailureStage, error: unknown): void {
  console.warn(`BuilderForce pending words: ${stage} failed (${errorMessage(error)})`);
}
