/**
 * The run keys a host relays to its panels: which ones a newly attached panel is
 * brought up to date on, and which ones are subscribed for live changes.
 *
 * A subscriber pins its run cell. The run store never evicts a cell that has a
 * listener, so a host that stayed subscribed to every key it ever ran kept every
 * chat's and sub-agent's cell (each with up to 500 trace events) for the editor's
 * whole session. A key is subscribed only while its run can change, and released when
 * it settles. The keys a panel is caught up on are capped at the store's own cell
 * bound, oldest dropped first, along with each panel's delta bookkeeping for them.
 */

import { subscribeRun } from "@seanhogg/builderforce-brain-embedded";

/** The run store keeps at most this many cells (`MAX_CELLS`); older ones are gone anyway. */
const KNOWN_CAP = 50;

export interface RunWatches {
  /** Subscribe to a run key, and remember it for panels that attach later. */
  watch(key: number): void;
  /** Stop listening to a settled run, so the store may evict its cell. */
  release(key: number): void;
  /** The keys a newly attached panel is brought up to date on, oldest first. */
  known(): readonly number[];
  dispose(): void;
}

export function createRunWatches(onChange: (key: number) => void, onForget: (key: number) => void): RunWatches {
  const subscriptions = new Map<number, () => void>();
  const known = new Set<number>();

  const remember = (key: number): void => {
    // Re-inserted so the most recently run key is the last to be dropped.
    known.delete(key);
    known.add(key);
    for (const oldest of known) {
      if (known.size <= KNOWN_CAP) break;
      if (subscriptions.has(oldest)) continue;
      known.delete(oldest);
      onForget(oldest);
    }
  };

  return {
    watch(key) {
      remember(key);
      if (!subscriptions.has(key)) subscriptions.set(key, subscribeRun(key, () => onChange(key)));
    },
    release(key) {
      subscriptions.get(key)?.();
      subscriptions.delete(key);
    },
    known: () => [...known],
    dispose() {
      for (const off of subscriptions.values()) off();
      subscriptions.clear();
      known.clear();
    },
  };
}
