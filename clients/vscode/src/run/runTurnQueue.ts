/**
 * Turns that arrive for a key whose run is still live - never dropped.
 *
 * A re-submitted steer turn races the run that woke for it: the later `run.start` found
 * the key claimed and returned at once, and the person's turn was silently lost. Now a turn
 * for a key THIS host is carrying parks here and runs, in order, once the live run has
 * settled; a turn for a key another path owns (the native participant) waits for the key to
 * go idle. A Stop ends the work, the turns parked behind it included (`drop`) - but a turn
 * typed AFTER the Stop is the person's new request and survives. No `vscode` import.
 */

export interface TurnQueueDeps<S> {
  /** Whether a run holds the key in the run store (any path). */
  isRunning(key: number): boolean;
  /** Whether the key is claimed - this host's run is setting up, running or unwinding. */
  isLive(key: number): boolean;
  /** Be told when the key's run state changes; returns the unsubscribe. */
  subscribe(key: number, listener: () => void): () => void;
  /** The host's one run entry. */
  run(spec: S): Promise<void>;
  /**
   * How often an idle wait re-checks the run store, ms. The store forgets a cell without
   * telling its subscribers (a reset, an eviction), and a wait on a forgotten cell must end.
   */
  recheckMs?: number;
}

export interface TurnQueue<S> {
  /** Park a turn behind the key's live run. Resolves when that turn has run (or was dropped by a Stop). */
  park(key: number, spec: S): Promise<void>;
  /** Resolves when no run holds the key. */
  whenIdle(key: number): Promise<void>;
  /** The key was stopped: the turns parked behind its run are dropped with it. */
  drop(key: number): void;
  /** The key's run settled: start the next parked turn, unless the key is claimed again. */
  settled(key: number): void;
  /** Settle every parked turn and idle wait - the host is going away. */
  dispose(): void;
}

const DEFAULT_RECHECK_MS = 1_000;

export function createTurnQueue<S>(deps: TurnQueueDeps<S>): TurnQueue<S> {
  const parked = new Map<number, Array<{ spec: S; resolve: () => void; reject: (e: unknown) => void }>>();
  const waiting = new Set<() => void>();

  const drop = (key: number): void => {
    const line = parked.get(key);
    if (!line) return;
    parked.delete(key);
    for (const turn of line) turn.resolve();
  };

  return {
    park(key, spec) {
      return new Promise<void>((resolve, reject) => {
        const line = parked.get(key) ?? [];
        line.push({ spec, resolve, reject });
        parked.set(key, line);
      });
    },

    whenIdle(key) {
      return new Promise<void>((resolve) => {
        if (!deps.isRunning(key)) return resolve();
        let off: () => void = () => undefined;
        let timer: ReturnType<typeof setInterval> | undefined;
        const end = (): void => {
          off();
          if (timer !== undefined) clearInterval(timer);
          waiting.delete(end);
          resolve();
        };
        const check = (): void => {
          if (!deps.isRunning(key)) end();
        };
        off = deps.subscribe(key, check);
        timer = setInterval(check, deps.recheckMs ?? DEFAULT_RECHECK_MS);
        waiting.add(end);
      });
    },

    drop,

    settled(key) {
      const line = parked.get(key);
      if (!line?.length) return;
      // Claimed again already (a wake started a run): the parked turns keep their place, and
      // that run asks again when IT settles. Re-parking the head would put it at the tail.
      if (deps.isLive(key)) return;
      const next = line.shift()!;
      if (line.length === 0) parked.delete(key);
      void deps.run(next.spec).then(next.resolve, next.reject);
    },

    dispose() {
      for (const key of [...parked.keys()]) drop(key);
      for (const end of [...waiting]) end();
    },
  };
}
