/**
 * boundedPool — the ONE bounded-concurrency worker pool the cron sweeps share.
 *
 * ── WHY IT IS A PRIMITIVE ────────────────────────────────────────────────────────
 * Four sweeps had independently grown the same eight lines: N workers drawing from a
 * shared cursor, because `for (const x of xs) await f(x)` inside a Worker invocation
 * means the first slow item consumes the whole tick and everything behind it gets
 * nothing (measured on the manager sweep: one project's 20–31s pass starved a fleet of
 * 200). Three of the four also disagreed about the details that matter — whether there
 * is a DEADLINE, and whether the items it never reached are reported — so "how does
 * this sweep pace itself" had a different answer per file.
 *
 * `cursor++` needs no lock: it is a synchronous read-modify-write and JS cannot
 * interleave two of those. The only suspension points are the `await`s inside the
 * caller's `run`, by which time the slot is already claimed.
 *
 * ── THE DEADLINE IS OPTIONAL AND THE SKIPPED COUNT IS NOT ────────────────────────
 * A sweep with a `deadlineAt` stops STARTING new units past it (never mid-unit, so a
 * half-applied action is impossible) and reports `notReached`. That number is the one
 * the old serial loops could not produce — they ran until the isolate was evicted, so
 * there was no moment at which they knew how much they had skipped. A sweep with no
 * deadline drains the list and reports `notReached: 0`.
 */

export interface BoundedPoolOptions {
  /** Max units in flight. Clamped to at least 1. */
  limit: number;
  /**
   * Epoch-ms after which no NEW unit is started. Omit to drain the whole list.
   * Checked BEFORE a slot is claimed, so an item is never half-started by the clock.
   */
  deadlineAt?: number;
}

export interface BoundedPoolResult {
  /** Units the pool actually started (all of which ran to completion). */
  started: number;
  /** Units never started because the deadline passed. 0 without a deadline. */
  notReached: number;
}

/**
 * Run `run` over `items` with at most `options.limit` in flight, stopping cleanly on
 * an optional deadline. Never throws on the caller's behalf — `run` owns its own
 * isolation, exactly as the per-item try/catch in each sweep already did.
 */
export async function runBoundedPool<T>(
  items: readonly T[],
  options: BoundedPoolOptions,
  run: (item: T, index: number) => Promise<void>,
): Promise<BoundedPoolResult> {
  const limit = Math.max(1, Math.floor(options.limit));
  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      if (options.deadlineAt != null && Date.now() >= options.deadlineAt) return;
      const index = cursor++;
      if (index >= items.length) return;
      await run(items[index] as T, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  const started = Math.min(cursor, items.length);
  return { started, notReached: Math.max(0, items.length - started) };
}

/**
 * The MAP flavour: same pool, but each unit's return value is kept AT ITS INPUT INDEX
 * so the result array lines up with `items`. Used where the caller needs the answers
 * rather than the side effects; it has no deadline because a partial map would silently
 * hand back holes.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  await runBoundedPool(items, { limit }, async (item, index) => {
    out[index] = await worker(item, index);
  });
  return out;
}
