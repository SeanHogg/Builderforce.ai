/**
 * The explicit retry's FRESH hold (`builderforce.knowledge.retryAnalyzers`), for the shared analysis (`l3SharedAnalysis.ts`):
 * "ran again" must mean the analyzers ran, not that a cached result (in memory or on disk) came back.
 *
 * While a root is held, each distinct analysis key of it asked for gets exactly ONE fresh run — the ticket is taken AFTER the
 * key is known, so a prefetch with other layers (another key) never uses up the retry's. Every other ask of that key meanwhile
 * joins the fresh run through the cache, so no second worker starts. A fresh run that lacks what a later ask needs — the
 * on-disk cache's write-through (`equipped`: the job binds `l3RootPath`), which the retry's own pass has and a prefetch has
 * not — does not satisfy that ask: it gets its own fresh run. A run that is stopped (every asker left) or fails gives its
 * ticket back, so the next ask of that key under the hold runs fresh again.
 */

/** One fresh run started under a hold. `live` false ⇒ given back. */
interface Started { equipped: boolean; live: boolean }

interface FreshHold { holders: number; started: Map<string, Started> }

/** Roots held fresh. */
const holds = new Map<string, FreshHold>();

/** A fresh run's claim on its key under the hold. */
export interface FreshTicket {
  /** The run stopped or failed: the next ask of the key under the hold runs fresh again. */
  reopen(): void;
}

/**
 * The fresh ticket of `key` (null: a tree git cannot name) for an ask of `rootId`, when the root is held and no fresh run of
 * that key has started under the hold — or the one that did is not `equipped` and this ask is.
 */
export function takeFreshTicket(rootId: string, key: string | null, equipped: boolean): FreshTicket | undefined {
  const hold = holds.get(rootId);
  if (!hold) return undefined;
  const id = key ?? "";
  const prior = hold.started.get(id);
  if (prior && (prior.equipped || !equipped)) return undefined;
  const mine: Started = { equipped, live: true };
  hold.started.set(id, mine);
  return {
    reopen: () => {
      if (!mine.live) return;
      mine.live = false;
      if (hold.started.get(id) !== mine) return;
      if (prior?.live) hold.started.set(id, prior);
      else hold.started.delete(id);
    },
  };
}

/**
 * While the returned release is not called, the root's analyses run the worker afresh — once per key (see above). A run in
 * progress when the hold is released goes on, and its result replaces the stale one in both caches.
 */
export function holdFreshAnalysis(rootId: string): () => void {
  const hold = holds.get(rootId) ?? { holders: 0, started: new Map<string, Started>() };
  hold.holders += 1;
  holds.set(rootId, hold);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    hold.holders -= 1;
    if (hold.holders <= 0 && holds.get(rootId) === hold) holds.delete(rootId);
  };
}
