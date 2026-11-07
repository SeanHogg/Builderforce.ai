/**
 * knowledgeLedger — the Postgres tables that make pack sync bounded per pack and exact per root (PRD 41 A11 rules
 * 4a and 4b):
 *
 *   knowledge_extracted_index  hash → { bundle_key, byte_offset, byte_length, source_refs }: where a body lives in a
 *                              content-addressed bundle object, and which sources its entries name
 *   knowledge_sources          the current sources of a root, one row each (not one R2 object each)
 *   knowledge_sync_leaves      the leaf digests of the rows a root synced, as the client computed them: the ONLY
 *                              input of the server's manifest tree
 *   knowledge_sync_roots       a root's acknowledged `{ generation, digest }`, advanced by a conditional UPDATE
 *
 * Every statement here is ONE statement for any number of rows: the rows ride in a single JSON parameter and are
 * expanded in SQL (`jsonb_to_recordset`), so a 20,000-hash have-check or a 20,000-leaf upsert is one query. Bound
 * to one (tenant, project) like every knowledge port; pass a transaction handle as `db` to make a write atomic with
 * the pack's other rows.
 */
import { sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';

export interface ExtractedLoc {
  hash: string;
  bundleKey: string;
  byteOffset: number;
  byteLength: number;
  /** The `sourceRef` of each entry of the stored body. */
  sourceRefs: string[];
}

export interface SourceRow {
  /** The path, or `~tag|path` for a root-level output. */
  sourceId: string;
  path: string;
  hash: string;
}

export interface LeafRow { key: string; digest: string }

export interface SyncRootRow { generation: number; digest: string }

export interface ExtractedIndexPort {
  /** Where each of `hashes` lives; a hash with no row is absent. ONE query. */
  locate(hashes: readonly string[]): Promise<ExtractedLoc[]>;
  /** Records locations (a later write of a hash replaces it). ONE statement. */
  upsert(rows: readonly ExtractedLoc[]): Promise<void>;
  /** Forgets these hashes (a body replaced by a legacy upload). */
  drop(hashes: readonly string[]): Promise<void>;
  /** Forgets every hash located in these bundles (the objects are gone). */
  dropBundles(bundleKeys: readonly string[]): Promise<void>;
}

export interface SourcesLedgerPort {
  list(rootId: string): Promise<SourceRow[]>;
  /** Records sources (a later write of a source replaces it). ONE statement. */
  upsert(rootId: string, rows: readonly SourceRow[]): Promise<void>;
  remove(rootId: string, sourceIds: readonly string[]): Promise<void>;
  /** Forgets every source of the root. Returns rows removed. */
  clear(rootId: string): Promise<number>;
}

export interface LeavesPort {
  /** Every leaf of the root, in key order, read in pages — never capped. */
  all(rootId: string): Promise<LeafRow[]>;
  upsert(rootId: string, rows: readonly LeafRow[]): Promise<void>;
  remove(rootId: string, keys: readonly string[]): Promise<void>;
  /** Which of `keys` this root holds as leaves. */
  existing(rootId: string, keys: readonly string[]): Promise<Set<string>>;
  /** Which of `keys` some OTHER root of the project holds as leaves. */
  namedByOthers(rootId: string, keys: readonly string[]): Promise<Set<string>>;
  clear(rootId: string): Promise<number>;
}

export interface SyncRootsPort {
  get(rootId: string): Promise<SyncRootRow | null>;
  /** Creates the row from an older state (the `sync.json` object) unless one exists. */
  seed(rootId: string, row: SyncRootRow): Promise<void>;
  /**
   * Moves the root to `base + 1` with `digest` only if it is still at `base` (0 = it has no row yet). Resolves to the
   * new generation, or null when another pack won: the caller throws and its transaction rolls back.
   */
  advance(rootId: string, base: number, digest: string): Promise<number | null>;
  clear(rootId: string): Promise<void>;
}

export interface KnowledgeLedgerPort {
  index: ExtractedIndexPort;
  sources: SourcesLedgerPort;
  leaves: LeavesPort;
  roots: SyncRootsPort;
}

const json = (value: unknown): string => JSON.stringify(value);
/** The rows of a `db.execute` result, whichever driver shape it has. */
export const rowsOf = <T>(result: unknown): T[] => ((result as { rows?: T[] }).rows ?? (result as T[])) as T[];
const countOf = (result: unknown): number => (result as { rowCount?: number }).rowCount ?? 0;
const LEAF_PAGE = 5000;

export function drizzleLedger(db: Db, tenantId: number, projectId: number): KnowledgeLedgerPort {
  const scope = sql`tenant_id = ${tenantId} AND project_id = ${projectId}`;
  return {
    index: {
      async locate(hashes) {
        if (hashes.length === 0) return [];
        const result = await db.execute(sql`
          SELECT hash, bundle_key, byte_offset, byte_length, source_refs
          FROM knowledge_extracted_index
          WHERE ${scope} AND hash IN (SELECT jsonb_array_elements_text(${json(hashes)}::jsonb))`);
        return rowsOf<{ hash: string; bundle_key: string; byte_offset: number; byte_length: number; source_refs: string[] | null }>(result).map((r) => ({
          hash: r.hash, bundleKey: r.bundle_key, byteOffset: r.byte_offset, byteLength: r.byte_length, sourceRefs: r.source_refs ?? [],
        }));
      },

      async upsert(rows) {
        if (rows.length === 0) return;
        const payload = rows.map((r) => ({ hash: r.hash, bundle_key: r.bundleKey, byte_offset: r.byteOffset, byte_length: r.byteLength, source_refs: r.sourceRefs }));
        await db.execute(sql`
          INSERT INTO knowledge_extracted_index (tenant_id, project_id, hash, bundle_key, byte_offset, byte_length, source_refs)
          SELECT ${tenantId}, ${projectId}, r.hash, r.bundle_key, r.byte_offset, r.byte_length,
                 ARRAY(SELECT jsonb_array_elements_text(r.source_refs))
          FROM jsonb_to_recordset(${json(payload)}::jsonb)
            AS r(hash text, bundle_key text, byte_offset integer, byte_length integer, source_refs jsonb)
          ON CONFLICT (tenant_id, project_id, hash) DO UPDATE SET
            bundle_key = excluded.bundle_key, byte_offset = excluded.byte_offset,
            byte_length = excluded.byte_length, source_refs = excluded.source_refs`);
      },

      async drop(hashes) {
        if (hashes.length === 0) return;
        await db.execute(sql`DELETE FROM knowledge_extracted_index WHERE ${scope} AND hash IN (SELECT jsonb_array_elements_text(${json(hashes)}::jsonb))`);
      },

      async dropBundles(bundleKeys) {
        if (bundleKeys.length === 0) return;
        await db.execute(sql`DELETE FROM knowledge_extracted_index WHERE ${scope} AND bundle_key IN (SELECT jsonb_array_elements_text(${json(bundleKeys)}::jsonb))`);
      },
    },

    sources: {
      async list(rootId) {
        const result = await db.execute(sql`SELECT source_id, path, hash FROM knowledge_sources WHERE ${scope} AND root_id = ${rootId}`);
        return rowsOf<{ source_id: string; path: string; hash: string }>(result).map((r) => ({ sourceId: r.source_id, path: r.path, hash: r.hash }));
      },

      async upsert(rootId, rows) {
        if (rows.length === 0) return;
        const payload = rows.map((r) => ({ source_id: r.sourceId, path: r.path, hash: r.hash }));
        await db.execute(sql`
          INSERT INTO knowledge_sources (tenant_id, project_id, root_id, source_id, path, hash)
          SELECT ${tenantId}, ${projectId}, ${rootId}, r.source_id, r.path, r.hash
          FROM jsonb_to_recordset(${json(payload)}::jsonb) AS r(source_id text, path text, hash text)
          ON CONFLICT (tenant_id, project_id, root_id, source_id) DO UPDATE SET
            path = excluded.path, hash = excluded.hash, updated_at = now()`);
      },

      async remove(rootId, sourceIds) {
        if (sourceIds.length === 0) return;
        await db.execute(sql`
          DELETE FROM knowledge_sources WHERE ${scope} AND root_id = ${rootId}
            AND source_id IN (SELECT jsonb_array_elements_text(${json(sourceIds)}::jsonb))`);
      },

      async clear(rootId) {
        return countOf(await db.execute(sql`DELETE FROM knowledge_sources WHERE ${scope} AND root_id = ${rootId}`));
      },
    },

    leaves: {
      async all(rootId) {
        const out: LeafRow[] = [];
        let after = '';
        for (;;) {
          // Keyset pages: no OFFSET to rescan, no cap — the tree must see EVERY leaf of the root.
          const page = rowsOf<{ leaf_key: string; digest: string }>(await db.execute(sql`
            SELECT leaf_key, digest FROM knowledge_sync_leaves
            WHERE ${scope} AND root_id = ${rootId} AND leaf_key > ${after}
            ORDER BY leaf_key LIMIT ${LEAF_PAGE}`));
          for (const r of page) out.push({ key: r.leaf_key, digest: r.digest });
          if (page.length < LEAF_PAGE) return out;
          after = page[page.length - 1]!.leaf_key;
        }
      },

      async upsert(rootId, rows) {
        if (rows.length === 0) return;
        await db.execute(sql`
          INSERT INTO knowledge_sync_leaves (tenant_id, project_id, root_id, leaf_key, digest)
          SELECT ${tenantId}, ${projectId}, ${rootId}, r.leaf_key, r.digest
          FROM jsonb_to_recordset(${json(rows.map((r) => ({ leaf_key: r.key, digest: r.digest })))}::jsonb) AS r(leaf_key text, digest text)
          ON CONFLICT (tenant_id, project_id, root_id, leaf_key) DO UPDATE SET digest = excluded.digest`);
      },

      async remove(rootId, keys) {
        if (keys.length === 0) return;
        await db.execute(sql`DELETE FROM knowledge_sync_leaves WHERE ${scope} AND root_id = ${rootId} AND leaf_key IN (SELECT jsonb_array_elements_text(${json(keys)}::jsonb))`);
      },

      async existing(rootId, keys) {
        if (keys.length === 0) return new Set();
        const rows = rowsOf<{ leaf_key: string }>(await db.execute(sql`
          SELECT leaf_key FROM knowledge_sync_leaves WHERE ${scope} AND root_id = ${rootId} AND leaf_key IN (SELECT jsonb_array_elements_text(${json(keys)}::jsonb))`));
        return new Set(rows.map((r) => r.leaf_key));
      },

      async namedByOthers(rootId, keys) {
        if (keys.length === 0) return new Set();
        const rows = rowsOf<{ leaf_key: string }>(await db.execute(sql`
          SELECT DISTINCT leaf_key FROM knowledge_sync_leaves WHERE ${scope} AND root_id <> ${rootId} AND leaf_key IN (SELECT jsonb_array_elements_text(${json(keys)}::jsonb))`));
        return new Set(rows.map((r) => r.leaf_key));
      },

      async clear(rootId) {
        return countOf(await db.execute(sql`DELETE FROM knowledge_sync_leaves WHERE ${scope} AND root_id = ${rootId}`));
      },
    },

    roots: {
      async get(rootId) {
        const [row] = rowsOf<{ generation: number; digest: string }>(await db.execute(sql`SELECT generation, digest FROM knowledge_sync_roots WHERE ${scope} AND root_id = ${rootId}`));
        return row ? { generation: row.generation, digest: row.digest } : null;
      },

      async seed(rootId, row) {
        await db.execute(sql`
          INSERT INTO knowledge_sync_roots (tenant_id, project_id, root_id, generation, digest)
          VALUES (${tenantId}, ${projectId}, ${rootId}, ${row.generation}, ${row.digest}) ON CONFLICT DO NOTHING`);
      },

      async advance(rootId, base, digest) {
        const result = base === 0
          // A full pack: accepted only when the root has no row (a concurrent first pack loses on the conflict).
          ? await db.execute(sql`
              INSERT INTO knowledge_sync_roots (tenant_id, project_id, root_id, generation, digest)
              VALUES (${tenantId}, ${projectId}, ${rootId}, 1, ${digest}) ON CONFLICT DO NOTHING RETURNING generation`)
          : await db.execute(sql`
              UPDATE knowledge_sync_roots SET generation = generation + 1, digest = ${digest}, updated_at = now()
              WHERE ${scope} AND root_id = ${rootId} AND generation = ${base} RETURNING generation`);
        const [row] = rowsOf<{ generation: number }>(result);
        return row ? row.generation : null;
      },

      async clear(rootId) {
        await db.execute(sql`DELETE FROM knowledge_sync_roots WHERE ${scope} AND root_id = ${rootId}`);
      },
    },
  };
}
