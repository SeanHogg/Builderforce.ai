/**
 * Deadlines for the awaits that sit between "a run ended" and "the chat is free" - the ones that hold a
 * chat's claim (`runClaim.ts`). A hang there must not leave the chat live forever: Send would steer into
 * an inbox no run reads and Stop would have nothing to stop.
 */

/** How long a continuation waits on the host's run-time parts / the attachments it reads, and how long a
 *  settling run's ticket backstops may hold the chat. Mutable so tests can shorten them. */
export const continuationLimits = { prepareMs: 15_000, settleMs: 30_000 };

/** `promise`, or a rejection once `ms` have passed. The timer is always cleared. */
export async function bounded<T>(ms: number, promise: Promise<T> | T, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${what} timed out`)), ms); });
  try {
    return await Promise.race([Promise.resolve(promise), late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run `work`, but stop WAITING for it after `ms` (`onLate` says so). The work itself cannot be cancelled and
 * finishes in the background; it only stops holding what waits on it.
 */
export async function within(ms: number, work: () => Promise<void>, onLate: () => void): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<'late'>((resolve) => { timer = setTimeout(() => resolve('late'), ms); });
  try {
    if ((await Promise.race([work().then(() => 'done' as const), late])) === 'late') onLate();
  } finally {
    clearTimeout(timer);
  }
}
