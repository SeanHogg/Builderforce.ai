import { CONTINUATION_TIMED_OUT } from '../chatError';

/**
 * Deadlines for the awaits that sit between "a run ended" and "the chat is free" - the ones that hold a
 * chat's claim (`runClaim.ts`). A hang there must not leave the chat live forever: Send would steer into
 * an inbox no run reads and Stop would have nothing to stop.
 */

/** How long a continuation waits on the host's run-time parts / the attachments it reads, and how long a
 *  settling run's ticket backstops may hold the chat. Mutable so tests can shorten them. */
export const continuationLimits = { prepareMs: 15_000, settleMs: 30_000 };

/** One overall allowance for a sequence of steps: each asks how much is LEFT (never below 1 ms), so stacked
 *  per-step bounds cannot add up to a long hold. */
export function budget(ms: number): () => number {
  const end = Date.now() + ms;
  return () => Math.max(1, end - Date.now());
}

/** `promise`, or a rejection once `ms` have passed. The timer is always cleared. The rejection carries a CODE,
 * not a sentence (`CONTINUATION_TIMED_OUT`): each host renders it in the person's language
 * (`chatErrorAction` -> the banner's `continuationTimedOut`).
 */
export async function bounded<T>(ms: number, promise: Promise<T> | T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(CONTINUATION_TIMED_OUT)), ms); });
  try {
    return await Promise.race([Promise.resolve(promise), late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run `work`, but stop WAITING for it after `ms` (`onLate` says so). The work itself cannot be cancelled and
 * finishes in the background; it only stops holding what waits on it. A failure of the work - before OR
 * after the wait ended - goes to `onError`, never an unhandled rejection and never a skipped step after it.
 */
export async function within(ms: number, work: () => Promise<void>, onLate: () => void, onError: (e: unknown) => void = () => undefined): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<'late'>((resolve) => { timer = setTimeout(() => resolve('late'), ms); });
  const settled = (async () => { try { await work(); } catch (e) { onError(e); } return 'done' as const; })();
  try {
    if ((await Promise.race([settled, late])) === 'late') onLate();
  } finally {
    clearTimeout(timer);
  }
}
