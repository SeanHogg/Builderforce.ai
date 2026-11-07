/**
 * knowledgeLedger — the Postgres tables that make pack sync bounded per pack and exact per root (PRD 41 A11 rules
 * 4a and 4b):
 *
 *   knowledge_extracted_index  hash → { bundle_key, byte_offset, byte_length, source_refs }: where a body lives in a
 *                              content-addressed bundle object, and which sources its entries name
 *   knowledge_sources          the current sources of a root, one row each (not one R2 object each). A row with hash ''
 *                              is a REMOVAL MARKER: it hides a legacy per-source object and is swept once that is gone
 *   knowledge_sync_leaves      the leaf digests of the rows a root synced, as the client computed them (leaves + buckets:
 *                              `knowledgeLedgerLeaves.ts`)
 *   knowledge_sync_buckets     the digest of each of the root's 4,096 manifest buckets
 *   knowledge_sync_roots       a root's acknowledged `{ generation, digest }`, advanced by a conditional UPDATE
 *
 * Every statement here is ONE statement for any number of rows: the rows ride in a single JSON parameter and are
 * expanded in SQL (`jsonb_to_recordset`), so a 20,000-hash have-check or a 20,000-leaf upsert is one query. Bound
 * to one (tenant, project) like every knowledge port; pass a transaction handle as `db` to make a write atomic with
 * the pack's other rows.
 *
 * `lock()` takes the PROJECT's sync advisory lock for the rest of the transaction: packs of one project run one at a
 * time (about one pack per root per minute, so this costs nothing), which is what makes "no other root names it" and the
 * read-merge-write of a body true when they are acted on. It must be the first statement of the transaction.
 */
import { sql } from 'drizzle-orm';
import { inTransaction, type Db } from '../../infrastructure/database/connection';
import { bucketsLedger, leavesLedger, type BucketsPort, type LeavesPort } from './knowledgeLedgerLeaves';

export type { BucketsPort, LeafRow, LeavesPort } from './knowledgeLedgerLeaves';

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

export interface SyncRootRow { generation: number; digest: string }

/** A removal marker: the source `sourceId` of `rootId` was removed and its legacy object may still exist. */
export interface SourceMarker { rootId: string; sourceId: string }

export interface ExtractedIndexPort {
  /** Where each of `hashes` lives; a hash with no row is absent. ONE query. */
  locate(hashes: readonly string[]): Promise<ExtractedLoc[]>;
  /** Which of `pairs` (by position) the stored body of `hash` has an entry for `sourceRef`. ONE indexed query (`source_refs` is on the row). */
  holds(pairs: ReadonlyArray<{ hash: string; sourceRef: string }>): Promise<Set<number>>;
  /**
   * Records locations. With `expected` (hash → the bundle key the caller's merge was built from, null = no row), a row
   * is written only if the hash still names that key; the number written is returned, and fewer than `rows.length`
   * means a concurrent change. Without it, a later write of a hash replaces it.
   */
  upsert(rows: readonly ExtractedLoc[], expected?: ReadonlyMap<string, string | null>): Promise<number>;
  /** Forgets these hashes (a body replaced by a legacy upload). */
  drop(hashes: readonly string[]): Promise<void>;
  /** Forgets every hash located in these bundles (the objects are gone). */
  dropBundles(bundleKeys: readonly string[]): Promise<void>;
}

export interface SourcesLedgerPort {
  /** Every row of the root, markers included (`hash` ''). */
  list(rootId: string): Promise<SourceRow[]>;
  /** Records sources (a later write of a source replaces it, a marker included). ONE statement. */
  upsert(rootId: string, rows: readonly SourceRow[]): Promise<void>;
  /** Marks sources removed (a row with hash ''): the source is gone even if its legacy object could not be deleted. */
  mark(rootId: string, sourceIds: readonly string[]): Promise<void>;
  /** Removal markers across the project, for the sweep's legacy deletes. */
  markers(limit: number): Promise<SourceMarker[]>;
  /** Forgets markers once their legacy objects are deleted. */
  dropMarkers(markers: readonly SourceMarker[]): Promise<void>;
  /** Forgets every source row of the root. Returns rows removed. */
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
  buckets: BucketsPort;
  roots: SyncRootsPort;
  /** Takes the project's sync advisory lock until the transaction ends. The first statement of a pack's transaction. */
  lock(): Promise<void>;
  /** Runs `work` in ONE transaction that holds the project's sync lock, on a ledger bound to that transaction. */
  exclusive<T>(work: (ledger: KnowledgeLedgerPort) => Promise<T>): Promise<T>;
}

const json = (value: unknown): string => JSON.stringify(value);
/** The rows of a `db.execute` result, whichever driver shape it has. */
export const rowsOf = <T>(result: unknown): T[] => ((result as { rows?: T[] }).rows ?? (result as T[])) as T[];
const countOf = (result: unknown): number => (result as { rowCount?: number }).rowCount ?? 0;

export function drizzleLedger(db: Db, tenantId: number, projectId: number): KnowledgeLedgerPort {
  const scope = sql`tenant_id = ${tenantId} AND project_id = ${projectId}`;
  const ledger: KnowledgeLedgerPort = {
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

      async holds(pairs) {
        if (pairs.length === 0) return new Set();
        const payload = pairs.map((p, i) => ({ i, hash: p.hash, ref: p.sourceRef }));
        const rows = rowsOf<{ i: number }>(await db.execute(sql`
          SELECT p.i FROM jsonb_to_recordset(${json(payload)}::jsonb) AS p(i integer, hash text, ref text)
          JOIN knowledge_extracted_index x ON x.tenant_id = ${tenantId} AND x.project_id = ${projectId} AND x.hash = p.hash AND p.ref = ANY (x.source_refs)`));
        return new Set(rows.map((r) => r.i));
      },

      async upsert(rows, expected) {
        if (rows.length === 0) return 0;
        const payload = rows.map((r) => ({
          hash: r.hash, bundle_key: r.bundleKey, byte_offset: r.byteOffset, byte_length: r.byteLength, source_refs: r.sourceRefs,
          prior_key: expected ? (expected.get(r.hash) ?? null) : null,
        }));
        if (!expected) {
          await db.execute(sql`
            INSERT INTO knowledge_extracted_index (tenant_id, project_id, hash, bundle_key, byte_offset, byte_length, source_refs)
            SELECT ${tenantId}, ${projectId}, r.hash, r.bundle_key, r.byte_offset, r.byte_length, ARRAY(SELECT jsonb_array_elements_text(r.source_refs))
            FROM jsonb_to_recordset(${json(payload)}::jsonb)
              AS r(hash text, bundle_key text, byte_offset integer, byte_length integer, source_refs jsonb, prior_key text)
            ON CONFLICT (tenant_id, project_id, hash) DO UPDATE SET
              bundle_key = excluded.bundle_key, byte_offset = excluded.byte_offset,
              byte_length = excluded.byte_length, source_refs = excluded.source_refs`);
          return rows.length;
        }
        // Conditional: a hash that had a row is updated only while it still names the key the merge was built from; a
        // hash that had none is inserted only if nobody inserted it since. The loser of either is simply not counted.
        const updated = rowsOf<unknown>(await db.execute(sql`
          UPDATE knowledge_extracted_index i SET
            bundle_key = r.bundle_key, byte_offset = r.byte_offset, byte_length = r.byte_length,
            source_refs = ARRAY(SELECT jsonb_array_elements_text(r.source_refs))
          FROM jsonb_to_recordset(${json(payload)}::jsonb)
            AS r(hash text, bundle_key text, byte_offset integer, byte_length integer, source_refs jsonb, prior_key text)
          WHERE i.tenant_id = ${tenantId} AND i.project_id = ${projectId} AND i.hash = r.hash
            AND r.prior_key IS NOT NULL AND i.bundle_key = r.prior_key
          RETURNING i.hash`)).length;
        const inserted = rowsOf<unknown>(await db.execute(sql`
          INSERT INTO knowledge_extracted_index (tenant_id, project_id, hash, bundle_key, byte_offset, byte_length, source_refs)
          SELECT ${tenantId}, ${projectId}, r.hash, r.bundle_key, r.byte_offset, r.byte_length, ARRAY(SELECT jsonb_array_elements_text(r.source_refs))
          FROM jsonb_to_recordset(${json(payload)}::jsonb)
            AS r(hash text, bundle_key text, byte_offset integer, byte_length integer, source_refs jsonb, prior_key text)
          WHERE r.prior_key IS NULL
          ON CONFLICT (tenant_id, project_id, hash) DO NOTHING
          RETURNING hash`)).length;
        return updated + inserted;
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

      async mark(rootId, sourceIds) {
        if (sourceIds.length === 0) return;
        await db.execute(sql`
          INSERT INTO knowledge_sources (tenant_id, project_id, root_id, source_id, path, hash)
          SELECT ${tenantId}, ${projectId}, ${rootId}, s, '', '' FROM jsonb_array_elements_text(${json(sourceIds)}::jsonb) AS s
          ON CONFLICT (tenant_id, project_id, root_id, source_id) DO UPDATE SET path = '', hash = '', updated_at = now()`);
      },

      async markers(limit) {
        const rows = rowsOf<{ root_id: string; source_id: string }>(await db.execute(sql`
          SELECT root_id, source_id FROM knowledge_sources WHERE ${scope} AND hash = '' ORDER BY root_id, source_id LIMIT ${limit}`));
        return rows.map((r) => ({ rootId: r.root_id, sourceId: r.source_id }));
      },

      async dropMarkers(markers) {
        if (markers.length === 0) return;
        await db.execute(sql`
          DELETE FROM knowledge_sources k USING jsonb_to_recordset(${json(markers)}::jsonb) AS m("rootId" text, "sourceId" text)
          WHERE k.tenant_id = ${tenantId} AND k.project_id = ${projectId} AND k.hash = ''
            AND k.root_id = m."rootId" AND k.source_id = m."sourceId"`);
      },

      async clear(rootId) {
        return countOf(await db.execute(sql`DELETE FROM knowledge_sources WHERE ${scope} AND root_id = ${rootId}`));
      },
    },

    leaves: leavesLedger(db, tenantId, projectId),
    buckets: bucketsLedger(db, tenantId, projectId),

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

    async lock() {
      await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('knowledge-sync:' || ${String(tenantId)}::text || ':' || ${String(projectId)}::text, 0))`);
    },

    exclusive: (work) => inTransaction(db, async (tx) => {
      const bound = drizzleLedger(tx as unknown as Db, tenantId, projectId);
      await bound.lock();
      return work(bound);
    }),
  };
  return ledger;
}
