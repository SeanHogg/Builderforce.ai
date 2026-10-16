/**
 * Run a local-first plan: each attempt in order, falling over to the next when one fails
 * BEFORE the user saw anything, and recording every attempt so a trace shows which
 * served.
 *
 * The rule that makes the failover transparent rather than merely automatic is
 * COMMITMENT. The moment an attempt has streamed output to the user (a text delta, a
 * tool-call fragment) it owns the turn: replaying the turn elsewhere would show the user
 * two answers spliced together, so a failure after that point is rethrown, not retried.
 * Before it, a failure — refused connection, HTTP error, a runtime that rejects the
 * model, an empty answer — is invisible, and the next attempt runs as if it were first.
 *
 * A Stop is never failed over: an aborted signal rethrows whatever the attempt threw.
 * Transport-agnostic: the host supplies `run`, so the same rule drives the editor's
 * transport seam and a browser extension's.
 */

import type { LocalFirstAttempt } from './plan.js';

export type LocalFirstOutcome = 'served' | 'failed' | 'refused';

export interface LocalFirstAttemptRecord {
  attempt: LocalFirstAttempt;
  outcome: LocalFirstOutcome;
  /** Why it did not serve (`failed`: the error's message; `refused`: an empty answer). */
  detail?: string;
}

export interface LocalFirstRunOptions<T> {
  signal?: AbortSignal;
  /** Did this result actually answer? A `false` before commitment fails over as
   *  `refused` (a runtime that returns 200 and nothing at all). Default: always yes. */
  accept?: (result: T) => boolean;
  /** Each attempt as it settles — the hook a host's trace/log hangs on. */
  onAttempt?: (record: LocalFirstAttemptRecord) => void;
}

export interface LocalFirstRunResult<T> {
  result: T;
  served: LocalFirstAttempt;
  attempts: LocalFirstAttemptRecord[];
}

/** Thrown when a plan is empty: nothing local fits the call and there is no cloud. */
export class LocalFirstUnavailableError extends Error {
  constructor() {
    super('local_first_unavailable: no local model fits this call and no cloud fallback is available');
    this.name = 'LocalFirstUnavailableError';
  }
}

/**
 * `run(attempt, commit)` performs one attempt and calls `commit()` the moment it emits
 * anything user-visible. Resolves with the first accepted result; rejects with the
 * attempt's own error when it committed, was aborted or was the last one.
 */
export async function runLocalFirst<T>(
  plan: readonly LocalFirstAttempt[],
  run: (attempt: LocalFirstAttempt, commit: () => void) => Promise<T>,
  options: LocalFirstRunOptions<T> = {},
): Promise<LocalFirstRunResult<T>> {
  if (plan.length === 0) throw new LocalFirstUnavailableError();
  const attempts: LocalFirstAttemptRecord[] = [];
  const record = (entry: LocalFirstAttemptRecord): void => {
    attempts.push(entry);
    options.onAttempt?.(entry);
  };
  for (let i = 0; i < plan.length; i++) {
    const attempt = plan[i]!;
    const isLast = i === plan.length - 1;
    // An object, not a `let`: the flag flips inside `run`'s callback, where TypeScript's
    // narrowing of a local boolean cannot see it.
    const state = { committed: false };
    try {
      const result = await run(attempt, () => {
        state.committed = true;
      });
      if (state.committed || isLast || (options.accept?.(result) ?? true)) {
        record({ attempt, outcome: 'served' });
        return { result, served: attempt, attempts };
      }
      record({ attempt, outcome: 'refused', detail: 'empty_response' });
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      record({ attempt, outcome: 'failed', detail });
      // The ORIGINAL error when nothing could be failed over, never a wrapper: the
      // caller's existing error mapping (sign-in, plan limits, Stop) keeps working
      // unchanged. What was tried before it is already in `onAttempt`.
      if (options.signal?.aborted || state.committed || isLast) throw e;
    }
  }
  // Unreachable: the last attempt either returns or throws.
  throw new LocalFirstUnavailableError();
}
