/**
 * The background indexer's long passes (the whole-tree map pass, L3) — one at a time per root, each with its OWN abort
 * signal, so it can be stopped without stopping the indexer:
 *
 *   - a keystroke aborts it ({@link PassGuard.abort}); the indexer reruns it once the person is quiet, and the manifest makes
 *     the rerun incremental (the files it finished are not extracted again);
 *   - a person's review, Retry or Exclude preempts it ({@link PassGuard.preempt}): abort, wait until it has stopped, and hold
 *     background passes off until the caller releases the hold (its own review hold is taken, or it ended);
 *   - it excludes the per-file slices both ways: `beforePass` waits for the slice in flight, and the slices wait (the queue
 *     keeps every path seen meanwhile) until `afterPass` lets them go on.
 *
 * Pure over a clock.
 */

import type { Clock } from "./indexBudget";

export type PassKind = "map" | "l3";

export type PassOutcome<T> = { value: T } | { aborted: true };

export class PassGuard {
  private current: { kind: PassKind; abort: AbortController; done: Promise<void> } | undefined;
  /** Preemptions not yet released: while any is held, no pass starts. */
  private holds = 0;
  private disposed = false;

  constructor(
    private readonly clock: Clock,
    /** Waits for the per-file slice in flight (the slices already see {@link running} and stop at their next boundary). */
    private readonly beforePass: () => Promise<void>,
    /** The pass ended: the slices go on. */
    private readonly afterPass: () => void,
  ) {}

  get running(): PassKind | undefined { return this.current?.kind; }

  /** A person's review preempted the passes and has not released them yet: none starts. */
  held(): boolean { return this.holds > 0; }

  /** Runs one pass under its own signal. Aborted (by a keystroke, a preemption or dispose) ⇒ `{ aborted: true }`, never a throw. */
  async run<T>(kind: PassKind, work: (signal: AbortSignal) => Promise<T>): Promise<PassOutcome<T>> {
    if (this.current) throw new Error(`index pass ${this.current.kind} is running`);
    const abort = new AbortController();
    if (this.disposed) abort.abort();
    let finish!: () => void;
    this.current = { kind, abort, done: new Promise<void>((resolve) => { finish = resolve; }) };
    try {
      await this.beforePass();
      if (abort.signal.aborted) return { aborted: true };
      const value = await work(abort.signal);
      // A pass that saw its signal mid-way returns what it finished; the rest is still owed.
      return abort.signal.aborted ? { aborted: true } : { value };
    } catch (error) {
      if (abort.signal.aborted) return { aborted: true };
      throw error;
    } finally {
      this.current = undefined;
      finish();
      this.afterPass();
    }
  }

  /** Stops the running pass (a keystroke); it reruns when the indexer is quiet again. */
  abort(): void {
    this.current?.abort.abort();
  }

  /**
   * Stops the running pass and holds new ones off until the returned release is called (the person's review has taken its
   * own hold, or ended). Resolves once the pass has stopped. A release never called expires after `maxHoldMs`, so a caller
   * that fails cannot stall the indexer for good.
   */
  async preempt(maxHoldMs: number): Promise<() => void> {
    this.holds += 1;
    let released = false;
    const expiry = this.clock.setTimeout(() => release(), maxHoldMs);
    const release = (): void => {
      if (released) return;
      released = true;
      this.clock.clearTimeout(expiry);
      this.holds -= 1;
    };
    const current = this.current;
    if (current) {
      current.abort.abort();
      await current.done;
    }
    return release;
  }

  /** Resolves when no pass runs. */
  settled(): Promise<void> {
    return this.current?.done ?? Promise.resolve();
  }

  dispose(): void {
    this.disposed = true;
    this.abort();
  }
}
