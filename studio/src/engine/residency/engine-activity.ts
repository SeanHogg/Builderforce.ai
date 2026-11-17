/**
 * EngineActivity — whether a VideoEngine is generating right now.
 *
 * `run(work)` marks the engine busy for the duration of `work` (re-entrant: a
 * busy counter, decremented in `finally`, so a storyboard that renders shots
 * through nested runs stays busy until the outermost run settles). Background
 * work — the refinement weight warm — reads it to yield to generation:
 * `whenIdle()` waits for the engine to go idle, and `onBusy(listener)` fires
 * on every idle → busy transition so a warm already in flight can be cancelled.
 */

/** The read side of {@link EngineActivity} that background work depends on. */
export interface ActivitySignal {
  isBusy(): boolean;
  /** Resolves once the engine is idle — immediately when it already is. */
  whenIdle(): Promise<void>;
  /** Subscribe to idle → busy transitions. Returns the unsubscribe function. */
  onBusy(listener: () => void): () => void;
}

export class EngineActivity implements ActivitySignal {
  private busy = 0;
  private readonly busyListeners = new Set<() => void>();
  private idleWaiters: Array<() => void> = [];

  /** Run `work` with the engine marked busy. */
  async run<T>(work: () => Promise<T>): Promise<T> {
    this.busy += 1;
    if (this.busy === 1) {
      for (const listener of [...this.busyListeners]) listener();
    }
    try {
      return await work();
    } finally {
      this.busy -= 1;
      if (this.busy === 0) {
        const waiters = this.idleWaiters;
        this.idleWaiters = [];
        for (const resolve of waiters) resolve();
      }
    }
  }

  isBusy(): boolean {
    return this.busy > 0;
  }

  whenIdle(): Promise<void> {
    if (this.busy === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  onBusy(listener: () => void): () => void {
    this.busyListeners.add(listener);
    return () => {
      this.busyListeners.delete(listener);
    };
  }
}
