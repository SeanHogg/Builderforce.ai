/**
 * Where the `run.local-success` predictor's NON-fatal failures go — the one reporter for
 * what the router degrades around rather than throws: a stored snapshot that could not be
 * read (start cold), a save the host's storage refused (the in-memory head still serves
 * this session), a routed turn whose recording failed (the history skips that turn).
 *
 * None of them may block or fail a turn, which is exactly why they must not vanish:
 * without the reason, "Hybrid never learns on this device" has no answer. One line per
 * failure, in one format — the same shape as `pageEngines/engineFailure.ts`.
 */

import { errorMessage } from '../pageEngines/types';

/** The step that failed. `pull` / `push`: the head's federation with its project's fleet. */
export type LocalSuccessFailureStage = 'load' | 'save' | 'record' | 'pull' | 'push';

export function reportLocalSuccessFailure(stage: LocalSuccessFailureStage, error: unknown): void {
  console.warn(`BuilderForce local-success predictor: ${stage} failed (${errorMessage(error)})`);
}
