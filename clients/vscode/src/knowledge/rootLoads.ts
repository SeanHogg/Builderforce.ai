/**
 * The ONE whole-graph build in flight per root, shared by every asker: the view's own loads (`KnowledgeBridge.load`, which a
 * review's growth re-read goes through) and the Live refresh (`knowledgeLive.ts`). A newer build of a root stops the one
 * running (so builds never queue up in the graph worker, and a review with Live on never builds the same graph twice
 * over), and the Live refresh, which is only ever a top-up, does not start while the view's own load of its root runs.
 */

const inFlight = new Map<string, AbortController>();
const whenEnded = new Map<string, Set<() => void>>();

export interface RootLoad {
  /** Aborted when a newer build of the same root starts. */
  signal: AbortSignal;
  /** The build settled (call from a `finally`). */
  end(): void;
}

/** Starts the build of `rootId`, stopping the one already running for it. */
export function beginRootLoad(rootId: string): RootLoad {
  inFlight.get(rootId)?.abort();
  const ctl = new AbortController();
  inFlight.set(rootId, ctl);
  return {
    signal: ctl.signal,
    end: () => {
      if (inFlight.get(rootId) !== ctl) return; // superseded: the build that superseded it ends the root's loading
      inFlight.delete(rootId);
      const waiting = whenEnded.get(rootId);
      whenEnded.delete(rootId);
      for (const fn of waiting ?? []) fn();
    },
  };
}

/** A build of `rootId` is running now. */
export const rootLoading = (rootId: string): boolean => inFlight.has(rootId);

/** Runs `fn` once when the build of `rootId` running now ends (it waits for the next end when none runs). Returns the cancel. */
export function onRootLoadEnd(rootId: string, fn: () => void): () => void {
  const set = whenEnded.get(rootId) ?? new Set<() => void>();
  set.add(fn);
  whenEnded.set(rootId, set);
  return () => { set.delete(fn); };
}
