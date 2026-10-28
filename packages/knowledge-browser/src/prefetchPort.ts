/**
 * THE browser `PrefetchPort` (docs/design/deterministic-prefetch.md; PRD 38 §3.1 "from any
 * host") — what the web chat and Rovr hand a Brain run as `BrainRunRequest.prefetch`, so
 * `/review <dir>`, `/graph` and knowledge questions settle in brain-embedded's gate
 * (`prefetchGate.ts`) the way they do in the editor. ONE port for both browser hosts; each
 * supplies only its knowledge client (over its own authenticated fetch) and where the
 * gate's calibration is kept.
 *
 * The rows are the shared ones (`@builderforce/agent-tools`), offered on the `web`
 * surface; the executors are the shared ones over this host:
 *
 *   - `knowledge.graph` (read)      → an **Open in graph** chip on the project's newest
 *                                     reviewed root, focused on the paths the request names;
 *   - `knowledge.review-dir` (write) → a **Choose a folder to review** chip: a folder
 *                                     picker needs the person's gesture, so the review is
 *                                     started — and its plan confirmed — in the view;
 *   - `knowledge.ask` (read)         → the ONE `knowledgeAskExecutor` over the platform's
 *                                     search plus one graph hop (`searchRecall`), so the
 *                                     answer, its confidence and its PREFETCH fallback read
 *                                     exactly as the editor's.
 *
 * Chips are routed by the host (`knowledgeChipIntent`): the web opens the canvas's
 * `knowledge` surface, Rovr switches to its Knowledge tab.
 */

import {
  defineRegistry, deserializeCalibration, serializeCalibration, updateHead,
  type CalibrationState, type PrefetchPort,
} from '@builderforce/prefetch';
import {
  KNOWLEDGE_PREFETCH_ROWS, KNOWLEDGE_REVIEW_DIR, OPEN_KNOWLEDGE_GRAPH_COMMAND, knowledgePrefetchExecutors, openInGraphChip,
  reviewInViewExecutor, type KnowledgeRowsHost,
} from '@builderforce/agent-tools/prefetch';
import { KNOWLEDGE_ASK, KNOWLEDGE_ASK_ROW, knowledgeAskExecutor, searchRecall } from '@builderforce/agent-tools/knowledge-index';
import type { KnowledgeClient, KnowledgeScopeRecord } from '@builderforce/knowledge-client';

export { knowledgeChipIntent, type KnowledgeChipIntent } from '@builderforce/agent-tools/prefetch';

/** Where the gate's calibration is kept (a serialized string), per host. */
export interface CalibrationStore {
  read(): string | undefined;
  write(serialized: string): void;
}

/** The browser's calibration store: `localStorage` under `key`; a blocked store learns nothing. */
export function localStorageCalibration(key: string): CalibrationStore {
  return {
    read() {
      try {
        return globalThis.localStorage?.getItem(key) ?? undefined;
      } catch {
        return undefined;
      }
    },
    write(serialized) {
      try {
        globalThis.localStorage?.setItem(key, serialized);
      } catch {
        // Private mode / blocked storage: the gate runs cold next time, never wrong.
      }
    },
  };
}

/** The ONE key both browser hosts keep the knowledge gate's calibration under. */
export const BROWSER_PREFETCH_CALIBRATION_KEY = 'builderforce.prefetch.calibration';

export interface BrowserKnowledgePrefetchOptions {
  /** The project's knowledge client (the host's authenticated fetch). */
  client: KnowledgeClient;
  calibration?: CalibrationStore;
}

/** The root a browser question is about: the project's most recently reviewed one. */
export function newestReviewedRoot(scopes: readonly KnowledgeScopeRecord[]): KnowledgeScopeRecord | undefined {
  return [...scopes].sort((a, b) => (b.lastReviewedAt ?? '').localeCompare(a.lastReviewedAt ?? ''))[0];
}

/** The rows a browser host runs: the shared knowledge rows and `knowledge.ask`. */
export const BROWSER_KNOWLEDGE_REGISTRY = defineRegistry([...KNOWLEDGE_PREFETCH_ROWS, KNOWLEDGE_ASK_ROW]);

export function createBrowserKnowledgePrefetchPort(opts: BrowserKnowledgePrefetchOptions): PrefetchPort {
  const { client } = opts;
  const read = (): CalibrationState => deserializeCalibration(opts.calibration?.read());
  const newest = async () => newestReviewedRoot(await client.scopes());

  // `/graph`: the shared executor over a host that shows a graph with a chip. A browser
  // host never opens a folder here (`/review` is the in-view executor below).
  const host: KnowledgeRowsHost = {
    openReview: async () => null,
    rootId: async () => (await newest())?.rootId ?? '',
    async showGraph(rootId, focus) {
      // No reviewed root: the chip opens the view (on its review launcher's empty state).
      const args = rootId ? { rootId, focus } : { focus: [] };
      const title = rootId ? (await newest())?.title ?? rootId : undefined;
      const text = !rootId
        ? 'No folder of this project has been reviewed yet. Open the knowledge graph to review one.'
        : focus.length > 0
          ? `The knowledge graph of **${title}**, focused on ${focus.length} file(s).`
          : `The knowledge graph of **${title}**.`;
      return { text, chip: openInGraphChip(OPEN_KNOWLEDGE_GRAPH_COMMAND, args) };
    },
  };

  const ask = knowledgeAskExecutor({
    async index() {
      const root = await newest();
      if (!root) return undefined;
      return searchRecall({
        search: (q, k) => client.search(root.rootId, q, k),
        graph: (focus) => client.graph(root.rootId, { focus }),
      });
    },
  });

  return {
    registry: BROWSER_KNOWLEDGE_REGISTRY,
    executors: {
      ...knowledgePrefetchExecutors(host),
      [KNOWLEDGE_REVIEW_DIR]: reviewInViewExecutor(),
      [KNOWLEDGE_ASK]: ask,
    },
    ports: {
      surface: 'web',
      get calibration() {
        return read();
      },
    },
    // `/review` here writes nothing — it answers with the view's launcher, whose plan chip
    // is the review's confirm — so it is not asked twice. Every other row is a read.
    confirm: async (action) => action.id === KNOWLEDGE_REVIEW_DIR,
    record: (outcome) => {
      if (!opts.calibration) return;
      opts.calibration.write(serializeCalibration(updateHead(read(), outcome)));
    },
  };
}
