/**
 * The Live lens's feed (PRD 38 §4.7): a directory's `watch` → a debounced reload of the
 * root's server graph, with the changed paths overlaid as badges (`applyLiveOverlay`).
 * One function, so the source's "watch a directory I already opened" and "watch one I had
 * to re-open" are the same code.
 */

import type { DirectorySource, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { applyLiveOverlay } from './liveOverlay';
import type { KnowledgeDegradedReporter } from './directorySourceKit';

export const LIVE_DEBOUNCE_MS = 800;

export interface LiveWatchPorts {
  /** The root's current server graph (the same read `load` makes). */
  graph(rootId: string): Promise<KnowledgeGraph | null>;
  /**
   * The paths changed since the root's last review. The SOURCE owns it per root, so stopping
   * one watcher and starting another (Live re-subscribes after a review) keeps what is pending.
   */
  changed: Set<string>;
  onDegraded: KnowledgeDegradedReporter;
}

/** Starts watching `dir`; returns the stop function. A directory that cannot watch returns a no-op. */
export function watchDirectory(dir: DirectorySource, rootId: string, cb: (g: KnowledgeGraph) => void, ports: LiveWatchPorts): () => void {
  if (!dir.watch) return () => undefined;
  const { changed } = ports;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  const stop = dir.watch((paths) => {
    for (const p of paths) changed.add(p);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void ports.graph(rootId).then((g) => { if (g && !stopped) cb(applyLiveOverlay(g, changed)); })
        .catch((error: unknown) => ports.onDegraded('live refresh', error, { rootId }));
    }, LIVE_DEBOUNCE_MS);
  });
  return () => { stopped = true; if (timer) clearTimeout(timer); stop(); };
}
