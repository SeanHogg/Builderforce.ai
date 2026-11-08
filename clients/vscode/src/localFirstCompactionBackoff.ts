/**
 * Backoff for a compaction that keeps failing (G03/G26).
 *
 * `shouldCompactJournal` stays true while a rename or the lock keeps failing, so without a
 * pause every commit would queue another job that streams and rewrites the whole store. After
 * a failure the next job waits `baseMs`, then twice that for each further failure, up to
 * `maxMs`; a success resets it. Pure and clock-injected: no timers, nothing to dispose.
 * The default clock is monotonic (`performance.now`), so a wall-clock change cannot shorten
 * or stretch a window. The backoff is PER WINDOW: each store instance keeps its own, and
 * another window compacting the same journal neither sees nor resets it.
 * No `vscode` import.
 */

export interface CompactionBackoffOptions {
  /** A monotonic clock in ms (default `performance.now`). */
  now?: () => number;
  /** The pause after the first failure. Default 30 s. */
  baseMs?: number;
  /** The longest pause. Default 15 min. */
  maxMs?: number;
}

export interface CompactionBackoff {
  /** True when a compaction job may be queued now. */
  allowed(): boolean;
  /** A compaction job failed: extend the pause. */
  failed(): void;
  /** A compaction job completed: forget the failures. */
  succeeded(): void;
}

export const COMPACTION_BACKOFF_BASE_MS = 30_000;
export const COMPACTION_BACKOFF_MAX_MS = 15 * 60_000;

export function createCompactionBackoff(options: CompactionBackoffOptions = {}): CompactionBackoff {
  const now = options.now ?? (() => performance.now());
  const baseMs = options.baseMs ?? COMPACTION_BACKOFF_BASE_MS;
  const maxMs = options.maxMs ?? COMPACTION_BACKOFF_MAX_MS;
  let failures = 0;
  let retryAt = 0;
  return {
    allowed: () => failures === 0 || now() >= retryAt,
    failed() {
      failures += 1;
      const delay = Math.min(maxMs, baseMs * 2 ** Math.min(failures - 1, 30));
      retryAt = now() + delay;
    },
    succeeded() {
      failures = 0;
      retryAt = 0;
    },
  };
}
