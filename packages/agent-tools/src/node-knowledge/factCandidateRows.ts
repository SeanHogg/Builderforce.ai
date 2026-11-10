/**
 * node-knowledge/factCandidateRows.ts — the RAW candidate mounts of a root's files (PRD 41 §C5.1), beside its fact store in
 * the folder's G03 `index.sqlite`.
 *
 * The fact store holds RESOLVED facts, where an Express `use(path, imported)` candidate is already decided (a mount, or a
 * `use` of the binding) and its provenance is gone. A host that resumes from the store re-decides those files against the
 * router set it restored — so the raw candidates are kept here, per file, under the content hash they were extracted from
 * (a row of another hash is stale and ignored). Expand-only `fact_candidate(root_id, path, hash, json)`, created on the
 * first write; reads tolerate a file without it. Writes are one `BEGIN IMMEDIATE` each (`writeOwn`).
 */

import type { MountFact } from '@seanhogg/builderforce-memory/knowledge';
import type { SqliteKnowledgeDb } from './sqliteRows.js';

/** One file's raw candidate mounts, at the content hash they were extracted from. */
export interface StoredCandidates {
    path: string;
    hash: string;
    mounts: MountFact[];
}

export interface CandidateRowsPort {
    load(): Promise<Map<string, StoredCandidates>>;
    write(puts: readonly StoredCandidates[], deletes: readonly string[]): Promise<void>;
}

const SCHEMA = 'CREATE TABLE IF NOT EXISTS fact_candidate(root_id TEXT NOT NULL, path TEXT NOT NULL, hash TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY(root_id, path)) WITHOUT ROWID;';
const missingTable = (err: unknown): boolean => /no such table: fact_candidate/i.test(err instanceof Error ? err.message : String(err));

/** The candidate rows of one root in the folder's knowledge file. */
export function sqliteCandidateRows(persistence: SqliteKnowledgeDb, rootId: string): CandidateRowsPort {
    return {
        load: () => persistence.readOwn((db) => {
            let rows: Array<{ path: string; hash: string; json: string }> = [];
            try {
                rows = db.prepare('SELECT path, hash, json FROM fact_candidate WHERE root_id = ?').all(rootId) as typeof rows;
            } catch (err) {
                if (!missingTable(err)) throw err;
            }
            return new Map(rows.map((r) => [r.path, { path: r.path, hash: r.hash, mounts: JSON.parse(r.json) as MountFact[] }] as const));
        }),
        write: (puts, deletes) => (puts.length === 0 && deletes.length === 0 ? Promise.resolve() : persistence.writeOwn((db) => {
            db.exec(SCHEMA);
            const put = db.prepare('INSERT INTO fact_candidate(root_id, path, hash, json) VALUES (?, ?, ?, ?) ON CONFLICT(root_id, path) DO UPDATE SET hash = excluded.hash, json = excluded.json');
            const del = db.prepare('DELETE FROM fact_candidate WHERE root_id = ? AND path = ?');
            for (const c of puts) put.run(rootId, c.path, c.hash, JSON.stringify(c.mounts));
            for (const path of deletes) del.run(rootId, path);
        })),
    };
}

/** The in-memory port (tests, a host with no SQLite). */
export function memoryCandidateRows(): CandidateRowsPort {
    const rows = new Map<string, string>();
    return {
        load: async () => new Map([...rows].map(([p, json]) => [p, JSON.parse(json) as StoredCandidates] as const)),
        write: async (puts, deletes) => {
            for (const c of puts) rows.set(c.path, JSON.stringify(c));
            for (const p of deletes) rows.delete(p);
        },
    };
}
