/**
 * node-knowledge/manifestBuffer.ts — the SQLite write of the review's buffered manifest (G03, C3). The buffer and the
 * `IngestManifest` over it are pure and live in `knowledge/manifestBuffer.ts` (a browser reuses them); they are
 * re-exported here so node callers are unchanged.
 */

import type { LocalSqliteDb } from '../node-local-sqlite.js';
import type { PendingManifest } from '../knowledge/manifestBuffer.js';

export { ManifestBuffer, bufferedManifest, type ManifestSink, type PendingManifest } from '../knowledge/manifestBuffer.js';

/** Writes drained manifest entries (inside the caller's transaction). */
export function writeManifestEntries(db: LocalSqliteDb, entries: PendingManifest, mode: 'update' | 'keep' = 'update'): void {
    // `keep` (a legacy import) never overwrites an entry a newer review already wrote.
    const upsert = db.prepare(`INSERT INTO manifest(source_id, json) VALUES (?, ?) ON CONFLICT(source_id) DO ${mode === 'keep' ? 'NOTHING' : 'UPDATE SET json = excluded.json'}`);
    const del = db.prepare('DELETE FROM manifest WHERE source_id = ?');
    for (const [id, v] of entries) { if (v === null) del.run(id); else upsert.run(id, JSON.stringify(v)); }
}
