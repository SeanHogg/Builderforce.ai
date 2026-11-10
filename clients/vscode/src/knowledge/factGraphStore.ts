/**
 * The fact index's persistence (PRD 41 §B4) over memory's `FactStorePort` — the folder's G03 `index.sqlite`
 * (`sqliteFactStore`). It follows memory's HOST CONTRACT (`factStore.ts` header):
 *
 *   - saves to one store are SERIALIZED in this process (one queue); each writes only the delta (`saveFactGraph`);
 *   - `fact_store_generation_conflict` (another window, or a sweep, wrote): load, re-apply the changes not yet saved on the
 *     loaded graph, save that — at most {@link SAVE_ATTEMPTS} times, then give up until the next change;
 *   - a corrupt store (`fact_store_object_missing` / `…_corrupt`) is a disposable cache: `reset()` and rebuild — on load the
 *     index starts empty and its sync re-extracts; on save the whole current graph is written to the fresh store.
 *
 * Load verifies the manifest only (`verify: 'manifest'`): each entry against its object, not every object's address.
 */

import {
  emptyFactGraph, loadFactGraph, saveFactGraph, sweepFactStore, type FactGraph, type FactStorePort, type FactStoreVersion, type StoredFactGraph,
} from "@seanhogg/builderforce-memory/knowledge";

/** How many times one save resolves a conflict before it gives up (the next change saves again). */
export const SAVE_ATTEMPTS = 3;

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
export const isStoreConflict = (error: unknown): boolean => /^fact_store_generation_conflict\b/.test(message(error));
export const isStoreCorrupt = (error: unknown): boolean => /^fact_store_(object_missing|object_corrupt|manifest_corrupt|derived_corrupt)\b/.test(message(error));

/** One save's view of its index: the graph now, how to re-apply the unsaved changes on a loaded graph, what was saved. */
export interface SaveSource {
  current(): FactGraph;
  /** The unsaved changes re-applied on a graph another writer left (a conflict). */
  reapply(loaded: FactGraph): FactGraph;
  /** The merged graph became the index's own (after a conflict). */
  adopt(graph: FactGraph): void;
  /** The save landed. */
  saved(): void;
}

export class FactGraphStore {
  private stored: StoredFactGraph | undefined;
  private queue: Promise<void> = Promise.resolve();
  private swept = false;
  /** The store version right after the last sweep (a store that has not moved since holds nothing to sweep). */
  private lastSweep: FactStoreVersion | undefined;

  /**
   * `lastSweep`: the version after a previous sweep of this store, when the host carried it over (absent: never swept
   * this session).
   */
  constructor(private readonly port: FactStorePort, private readonly log: (what: string, error: unknown) => void, lastSweep?: FactStoreVersion) {
    this.lastSweep = lastSweep;
  }

  /** The store version after this session's sweep (undefined before it): what a host carries to the next store object. */
  get sweptAt(): FactStoreVersion | undefined { return this.lastSweep; }

  /** The stored graph (manifest verified), or undefined for an empty store — and for a corrupt one, which is reset first. */
  async load(): Promise<FactGraph | undefined> {
    try {
      this.stored = await loadFactGraph(this.port, { verify: "manifest" });
      return this.stored.graph.manifest.size > 0 || this.stored.graph.derived.size > 0 ? this.stored.graph : undefined;
    } catch (error) {
      if (!isStoreCorrupt(error)) throw error;
      this.log("fact store corrupt: reset, rebuilding from the files", error);
      await this.port.reset();
      this.stored = undefined;
      return undefined;
    }
  }

  /**
   * Removes the store's unreferenced objects (memory `sweepFactStore`, §B4), behind the save queue (never beside a save).
   * At most ONCE per session (this store's life), and only when the store's version moved since the last sweep — an
   * unchanged store holds nothing to sweep. A conflict (a write landed) is skipped: the next session sweeps.
   */
  sweep(): Promise<number> {
    if (this.swept) return Promise.resolve(0);
    this.swept = true;
    let removed = 0;
    this.queue = this.queue.then(async () => {
      const version = await this.port.readVersion();
      if (version.generation === 0 || (this.lastSweep && this.lastSweep.epoch === version.epoch && this.lastSweep.generation === version.generation)) return;
      try {
        removed = await sweepFactStore(this.port);
      } catch (error) {
        if (!isStoreConflict(error)) throw error;
        this.log("fact store sweep skipped (a write landed)", error);
      }
      this.lastSweep = await this.port.readVersion();
    }).catch((error: unknown) => this.log("fact store sweep", error));
    return this.queue.then(() => removed);
  }

  /** Resolves once every save queued so far has settled (writes nothing itself). */
  settled(): Promise<void> {
    return this.queue;
  }

  /** Queues a save of `source.current()`; resolves once it (and every save before it) settled. Failures are logged. */
  save(source: SaveSource): Promise<void> {
    this.queue = this.queue.then(() => this.saveNow(source)).catch((error: unknown) => this.log("fact store save", error));
    return this.queue;
  }

  private async saveNow(source: SaveSource): Promise<void> {
    let graph = source.current();
    let previous = this.stored;
    for (let attempt = 0; attempt < SAVE_ATTEMPTS; attempt++) {
      try {
        this.stored = await saveFactGraph(this.port, graph, previous);
        source.saved();
        return;
      } catch (error) {
        if (isStoreConflict(error)) {
          previous = await this.loadForMerge();
          graph = source.reapply(previous.graph);
          source.adopt(graph);
          continue;
        }
        if (!isStoreCorrupt(error)) throw error;
        this.log("fact store corrupt on save: reset, writing the whole graph", error);
        await this.port.reset();
        previous = undefined;
      }
    }
    this.log("fact store save", new Error(`fact_store_generation_conflict: gave up after ${SAVE_ATTEMPTS} attempts; the next change saves again`));
  }

  /** The graph another writer left, to merge onto; a corrupt store is reset to an empty one. */
  private async loadForMerge(): Promise<StoredFactGraph> {
    try {
      return await loadFactGraph(this.port, { verify: "manifest" });
    } catch (error) {
      if (!isStoreCorrupt(error)) throw error;
      await this.port.reset();
      const v = await this.port.readVersion();
      return { ...v, graph: emptyFactGraph() };
    }
  }
}
