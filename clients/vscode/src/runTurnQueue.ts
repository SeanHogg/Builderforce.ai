/**
 * Turns that arrive for a key whose run is still live — never dropped.
 *
 * A re-submitted steer turn races the run that woke for it: the later `run.start` found
 * the key claimed and returned at once, and the person's turn was silently lost. Now a turn
 * for a key THIS host is carrying parks here and runs, in order, once the live run has
 * settled; a turn for a key another path owns (the native participant) waits for the key to
 * go idle. A Stop ends the work, waiting turns included. No `vscode` import.
 */

export interface TurnQueueDeps<S> {
  /** Whether a run holds the key in the run store (any path). */
  isRunning(key: number): boolean;
  /** Be told when the key's run state changes; returns the unsubscribe. */
  subscribe(key: number, listener: () => void): () => void;
  /** The host's one run entry. */
  run(spec: S): Promise<void>;
}

export interface TurnQueue<S> {
  /** Park a turn behind the key's live run. Resolves when that turn has run (or was dropped by a Stop). */
  park(key: number, spec: S): Promise<void>;
  /** Resolves when no run holds the key. */
  whenIdle(key: number): Promise<void>;
  /** The key's run settled: start the next parked turn — or, after a Stop, drop them all. */
  settled(key: number, stopped: boolean): void;
}

export function createTurnQueue<S>(deps: TurnQueueDeps<S>): TurnQueue<S> {
  const parked = new Map<number, Array<{ spec: S; resolve: () => void; reject: (e: unknown) => void }>>();

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
        const off = deps.subscribe(key, () => {
          if (deps.isRunning(key)) return;
          off();
          resolve();
        });
      });
    },

    settled(key, stopped) {
      const line = parked.get(key);
      if (!line?.length) return;
      if (stopped) {
        // Stop ends the conversation's work: the turns that waited behind it are dropped.
        parked.delete(key);
        for (const turn of line) turn.resolve();
        return;
      }
      const next = line.shift()!;
      if (line.length === 0) parked.delete(key);
      void deps.run(next.spec).then(next.resolve, next.reject);
    },
  };
}
