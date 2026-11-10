/**
 * WHEN the editor's chat-sync pass runs (`chatSyncHost.ts` decides WHAT a pass does).
 *
 * Single-flight: a trigger during a pass asks for ONE more pass after it (`again`), never two at
 * once. Debounced: writes arrive in bursts. And a pass that stopped with work left says when the
 * next may start (`resumeAt`: a 429's `Retry-After`, or the tenant's request bucket at its
 * reserve) — nothing runs before then: not a queued `again`, not a store-change trigger, not the
 * heartbeat. The next pass is left to the timer, which fires at `resumeAt`.
 */

export interface PassOutcome {
  /** Work is left and the next pass must not start before this instant (ms epoch). */
  readonly resumeAt?: number;
}

export interface PassSchedulerPorts {
  pass(): Promise<PassOutcome | void>;
  /** Whether passes may run at all now (the `synchronize` grant). */
  enabled(): boolean;
  readonly debounceMs: number;
  onError(error: unknown): void;
  now?(): number;
  setTimer?(run: () => void, ms: number): unknown;
  clearTimer?(timer: unknown): void;
}

export interface PassScheduler {
  /** A trigger: run a pass soon (debounced, and never before `resumeAt`). */
  schedule(): void;
  /** Run now if allowed (a timer's tick). */
  run(): Promise<void>;
  /** When the next pass may start, if a pass deferred it. */
  resumeAt(): number | undefined;
  /** A pass is running now (a trigger then asks for one more: `run()`). */
  running(): boolean;
  dispose(): void;
}

export function createPassScheduler(ports: PassSchedulerPorts): PassScheduler {
  const now = ports.now ?? Date.now;
  const setTimer = ports.setTimer ?? ((run: () => void, ms: number) => setTimeout(run, ms));
  const clearTimer = ports.clearTimer ?? ((timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  let running = false;
  let again = false;
  let disposed = false;
  let resumeAt: number | undefined;
  let timer: unknown;

  const deferred = (): boolean => resumeAt !== undefined && resumeAt > now();

  const schedule = (): void => {
    if (disposed || !ports.enabled()) return;
    if (timer !== undefined) clearTimer(timer);
    const delay = Math.max(ports.debounceMs, (resumeAt ?? 0) - now());
    timer = setTimer(() => {
      timer = undefined;
      void run();
    }, delay);
  };

  const run = async (): Promise<void> => {
    if (disposed) return;
    if (running) {
      again = true;
      return;
    }
    // Deferred by the last pass: not before `resumeAt` — the timer comes back then.
    if (deferred()) {
      schedule();
      return;
    }
    running = true;
    try {
      do {
        again = false;
        const outcome = await ports.pass();
        resumeAt = outcome?.resumeAt;
      } while (again && !disposed && !deferred());
    } catch (error) {
      ports.onError(error);
    } finally {
      running = false;
    }
    // Work left (deferred), or a trigger that arrived while deferred: the timer takes it.
    if (resumeAt !== undefined || again) schedule();
  };

  return {
    schedule,
    run,
    resumeAt: () => resumeAt,
    running: () => running,
    dispose() {
      disposed = true;
      if (timer !== undefined) clearTimer(timer);
      timer = undefined;
    },
  };
}
