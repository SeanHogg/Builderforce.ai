/**
 * The browser's LOCAL knowledge: the store the review writes, the review manifest that rides with its facts, and the files
 * the replica host keeps its queue in. It replaces the old IndexedDB-only manifest (`manifestStore.ts`).
 *
 *   IndexedDB  `localSnapshotStore(undefined, { rows })` over {@link indexedDbKnowledgeRows}; the manifest is buffered and
 *              committed inside the same `apply` as the facts (the way `nodeKnowledgeStore` builds it).
 *   fallback   Best-effort: when IndexedDB is unavailable or fails to open, an in-memory store, manifest and files, reported
 *              through `onDegraded`, never thrown. `degraded` is true then: that root's local store is empty after every
 *              reload, so the caller marks the root ADDITIVE (an empty local store must never delete server data).
 */

import { localSnapshotStore, type LocalSnapshotStore } from '@seanhogg/builderforce-memory/knowledge';
import type { ChunkFingerprint, IngestManifest } from '@seanhogg/builderforce-memory/ingest';
import { bufferedManifest, type KnowledgeFiles } from '@builderforce/agent-tools/knowledge';
import type { KnowledgeDegradedReporter } from './directorySourceKit';
import { knowledgeDb, type KnowledgeDbOptions } from './knowledgeDb';
import { indexedDbKnowledgeFiles, memoryKnowledgeFiles } from './knowledgeFiles';
import { indexedDbKnowledgeRows } from './knowledgeRows';

export interface BrowserKnowledge {
  store: LocalSnapshotStore;
  manifest: IngestManifest;
  files: KnowledgeFiles;
  /** True on the in-memory fallback. */
  degraded: boolean;
  close(): void;
}

function memoryKnowledge(): BrowserKnowledge {
  let snapshot: string | undefined;
  const entries = new Map<string, ChunkFingerprint[]>();
  return {
    store: localSnapshotStore({ read: async () => snapshot, write: async (text) => { snapshot = text; } }),
    manifest: {
      get: async (sourceId) => entries.get(sourceId),
      set: async (sourceId, fingerprints) => { entries.set(sourceId, fingerprints); },
      delete: async (sourceId) => { entries.delete(sourceId); },
    },
    files: memoryKnowledgeFiles(),
    degraded: true,
    close: () => undefined,
  };
}

export async function openBrowserKnowledge(onDegraded: KnowledgeDegradedReporter, opts: KnowledgeDbOptions = {}): Promise<BrowserKnowledge> {
  const db = knowledgeDb({ ...opts, report: onDegraded });
  try {
    await db.open();
  } catch (error) {
    db.close();
    onDegraded('knowledge storage', error);
    return memoryKnowledge();
  }
  const rows = indexedDbKnowledgeRows({ db });
  const store = localSnapshotStore(undefined, { rows });
  // A manifest write rides with the facts: persist whatever is dirty now (the apply drains the buffer); with nothing dirty it commits alone.
  const manifest = bufferedManifest(rows.buffer, rows, () => store.batched((flush) => flush()));
  return { store, manifest, files: indexedDbKnowledgeFiles({ db }), degraded: false, close: () => db.close() };
}
