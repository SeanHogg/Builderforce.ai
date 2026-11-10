/**
 * node-knowledge-store.ts — the Node knowledge store: one SQLite file per workspace folder is the system of record for the
 * local knowledge graph (G03, PRD 41 B4). Node-only; published behind its own export condition.
 *
 * - {@link nodeKnowledgeStore}: memory's `localSnapshotStore` in row mode over `<folder>/.builderforce/cache/knowledge/index.sqlite`,
 *   plus the review's `IngestManifest` on the same connection (its writes commit in the same transaction as the facts).
 * - {@link nodeIngestManifest}: the manifest alone, for a host with no local fact store (on-prem reviews into the platform).
 * - {@link migrateLegacyKnowledge}: imports a root's old `.builderforce/knowledge/<stem>.*` files, once.
 * - `hashCache` (the plan's stat manifest, `node-knowledge/statRows.ts`) and {@link gitIndexHints} (the git fast path): what a
 *   Node host hands `createFsDirectorySource` so a re-plan re-reads only what changed (PRD 41 B2).
 *
 * A folder holds every root reviewed in it (rows carry their root id), so a host opens ONE store per folder and shares it.
 */

import { localSnapshotStore, type LocalSnapshotStore } from '@seanhogg/builderforce-memory/knowledge';
import type { IngestManifest } from '@seanhogg/builderforce-memory/ingest';
import { bufferedManifest } from './node-knowledge/manifestBuffer.js';
import { openKnowledgeDb, KNOWLEDGE_BUSY_TIMEOUT_MS } from './node-knowledge/openKnowledgeDb.js';
import type { SqliteKnowledgeDb } from './node-knowledge/sqliteRows.js';
import { sqliteHashCache } from './node-knowledge/statRows.js';
import type { HashCache } from './knowledge/statManifest.js';

export { gitBlobId, gitIndexHints } from './node-knowledge/gitIndexHints.js';
export { migrateLegacyKnowledge, type MigrationOptions, type MigrationResult } from './node-knowledge/legacyMigration.js';
export { knowledgeDbPath, KNOWLEDGE_BUSY_TIMEOUT_MS } from './node-knowledge/openKnowledgeDb.js';
export { PREIMAGE_RETENTION_MS, putPreimages, readPreimages, sweepPreimages, unpinPreimages, type PreimageWrite } from './node-knowledge/preimageRows.js';
export type { SqliteKnowledgeDb } from './node-knowledge/sqliteRows.js';
export { sqliteFactStore } from './node-knowledge/factStoreRows.js';
export { memoryCandidateRows, sqliteCandidateRows, type CandidateRowsPort, type StoredCandidates } from './node-knowledge/factCandidateRows.js';

export interface NodeKnowledgeStore {
    store: LocalSnapshotStore;
    manifest: IngestManifest;
    /** The file's persistence: what {@link migrateLegacyKnowledge} imports into. */
    persistence: SqliteKnowledgeDb;
    /** The plan's stat manifest in the same file (PRD 41 B2): a directory source's `hashCache`. Never written on a newer format. */
    hashCache: HashCache;
    /** `wal`, or `delete` on a network share. */
    journalMode: string;
    /** Set when the file was corrupt: where its bytes were moved. The store started empty; the next review re-indexes. */
    recoveredFrom?: string;
    /** True when the file was written by a newer format: it is read-only here (every write throws `knowledge_index_format_newer`). */
    formatNewer: boolean;
    close(): void;
}

export function nodeKnowledgeStore(folderDir: string, opts: { busyTimeoutMs?: number } = {}): NodeKnowledgeStore {
    const { persistence, buffer, journalMode, recoveredFrom } = openKnowledgeDb(folderDir, opts.busyTimeoutMs ?? KNOWLEDGE_BUSY_TIMEOUT_MS);
    const store = localSnapshotStore(undefined, { rows: persistence });
    // A manifest write rides with the facts: persist whatever is dirty now (the apply drains the buffer); with nothing dirty it commits alone.
    const manifest = bufferedManifest(buffer, persistence, () => store.batched((flush) => flush()));
    return { store, manifest, persistence, hashCache: sqliteHashCache(persistence), journalMode, formatNewer: persistence.formatNewer, ...(recoveredFrom ? { recoveredFrom } : {}), close: () => persistence.close() };
}

/** The manifest alone, committing directly (no fact store to ride with). */
export function nodeIngestManifest(folderDir: string, opts: { busyTimeoutMs?: number } = {}): IngestManifest & { persistence: SqliteKnowledgeDb; close(): void } {
    const { persistence, buffer } = openKnowledgeDb(folderDir, opts.busyTimeoutMs ?? KNOWLEDGE_BUSY_TIMEOUT_MS);
    return { ...bufferedManifest(buffer, persistence), persistence, close: () => persistence.close() };
}
