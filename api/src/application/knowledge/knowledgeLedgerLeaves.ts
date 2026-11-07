/**
 * knowledgeLedgerLeaves — the leaf table and the bucket table of a root's manifest (PRD 41 A11 rule 4b; migration 1302).
 *
 *   knowledge_sync_leaves   the digest of each row a root synced. Keyed by `sha256(leaf_key)` (bytea): the text key is
 *                           stored, never indexed, so a relation key of two long refs cannot overflow an index entry.
 *                           Each row carries its manifest `bucket`, so a pack reads only the buckets it touched.
 *   knowledge_sync_buckets  the digest of each non-empty bucket; the root digest is `rootDigestOfBuckets` of the 4,096
 *                           (an absent row is an empty bucket).
 *
 * One statement per call for any number of keys (rows ride in one JSON parameter). Keys never reach SQL as an index key:
 * the hash is computed IN the statement from the key, so the client cannot supply a hash that disagrees with its key.
 */
import { sql } from 'drizzle-orm';
import { bucketDigest, bucketOf, MANIFEST_BUCKETS } from '@seanhogg/builderforce-memory/knowledge/pack';
import type { Db } from '../../infrastructure/database/connection';

export interface LeafRow { key: string; digest: string }

export interface LeavesPort {
  /** Every leaf of the root, read in keyset pages by key hash — never capped. Unordered by key: sort in the caller. */
  all(rootId: string): Promise<LeafRow[]>;
  /** The leaves whose key falls in these manifest buckets (rows not yet bucketed are filled by `ensureBuckets` first). */
  inBuckets(rootId: string, buckets: readonly number[]): Promise<LeafRow[]>;
  /** Whether the root holds any leaf. */
  any(rootId: string): Promise<boolean>;
  upsert(rootId: string, rows: readonly LeafRow[]): Promise<void>;
  remove(rootId: string, keys: readonly string[]): Promise<void>;
  /** Which of `keys` this root holds as leaves. */
  existing(rootId: string, keys: readonly string[]): Promise<Set<string>>;
  /** Which of `keys` some OTHER root of the project holds as leaves. */
  namedByOthers(rootId: string, keys: readonly string[]): Promise<Set<string>>;
  /** Sets `bucket` on rows that have none (written before migration 1302). Returns rows filled. */
  fillBuckets(rootId: string): Promise<number>;
  clear(rootId: string): Promise<number>;
}

export interface BucketRow { bucket: number; digest: string }

export interface BucketsPort {
  /** The `MANIFEST_BUCKETS` digests (hex) in bucket order; a bucket with no row is the empty digest. */
  digests(rootId: string): Promise<string[]>;
  /** Whether any bucket row exists for the root. */
  has(rootId: string): Promise<boolean>;
  /** Stores bucket digests; a bucket whose digest is the empty one has its row deleted. */
  put(rootId: string, rows: readonly BucketRow[]): Promise<void>;
  clear(rootId: string): Promise<void>;
}

const json = (value: unknown): string => JSON.stringify(value);
const rowsOf = <T>(result: unknown): T[] => ((result as { rows?: T[] }).rows ?? (result as T[])) as T[];
const countOf = (result: unknown): number => (result as { rowCount?: number }).rowCount ?? 0;
const PAGE = 5000;
const EMPTY = bucketDigest([]);

export function leavesLedger(db: Db, tenantId: number, projectId: number): LeavesPort {
  const scope = sql`tenant_id = ${tenantId} AND project_id = ${projectId}`;
  const keyList = (keys: readonly string[]) => sql`SELECT sha256(convert_to(k, 'UTF8')) FROM jsonb_array_elements_text(${json(keys)}::jsonb) AS k`;
  return {
    async all(rootId) {
      const out: LeafRow[] = [];
      let after = '';
      for (;;) {
        // Keyset pages over the primary key: no OFFSET to rescan, no cap — the tree must see EVERY leaf of the root.
        const page = rowsOf<{ leaf_key: string; digest: string; h: string }>(await db.execute(sql`
          SELECT leaf_key, digest, encode(leaf_key_hash, 'hex') AS h FROM knowledge_sync_leaves
          WHERE ${scope} AND root_id = ${rootId} AND leaf_key_hash > decode(${after}, 'hex')
          ORDER BY leaf_key_hash LIMIT ${PAGE}`));
        for (const r of page) out.push({ key: r.leaf_key, digest: r.digest });
        if (page.length < PAGE) return out;
        after = page[page.length - 1]!.h;
      }
    },

    async inBuckets(rootId, buckets) {
      if (buckets.length === 0) return [];
      const rows = rowsOf<{ leaf_key: string; digest: string }>(await db.execute(sql`
        SELECT leaf_key, digest FROM knowledge_sync_leaves
        WHERE ${scope} AND root_id = ${rootId} AND bucket IN (SELECT jsonb_array_elements_text(${json([...new Set(buckets)])}::jsonb)::int)`));
      return rows.map((r) => ({ key: r.leaf_key, digest: r.digest }));
    },

    async any(rootId) {
      return rowsOf<unknown>(await db.execute(sql`SELECT 1 FROM knowledge_sync_leaves WHERE ${scope} AND root_id = ${rootId} LIMIT 1`)).length > 0;
    },

    async upsert(rootId, rows) {
      if (rows.length === 0) return;
      const payload = rows.map((r) => ({ leaf_key: r.key, bucket: bucketOf(r.key), digest: r.digest }));
      await db.execute(sql`
        INSERT INTO knowledge_sync_leaves (tenant_id, project_id, root_id, leaf_key, leaf_key_hash, bucket, digest)
        SELECT ${tenantId}, ${projectId}, ${rootId}, r.leaf_key, sha256(convert_to(r.leaf_key, 'UTF8')), r.bucket, r.digest
        FROM jsonb_to_recordset(${json(payload)}::jsonb) AS r(leaf_key text, bucket integer, digest text)
        ON CONFLICT (tenant_id, project_id, root_id, leaf_key_hash) DO UPDATE SET
          leaf_key = excluded.leaf_key, bucket = excluded.bucket, digest = excluded.digest`);
    },

    async remove(rootId, keys) {
      if (keys.length === 0) return;
      await db.execute(sql`DELETE FROM knowledge_sync_leaves WHERE ${scope} AND root_id = ${rootId} AND leaf_key_hash IN (${keyList(keys)})`);
    },

    async existing(rootId, keys) {
      if (keys.length === 0) return new Set();
      const rows = rowsOf<{ leaf_key: string }>(await db.execute(sql`
        SELECT leaf_key FROM knowledge_sync_leaves WHERE ${scope} AND root_id = ${rootId} AND leaf_key_hash IN (${keyList(keys)})`));
      return new Set(rows.map((r) => r.leaf_key));
    },

    async namedByOthers(rootId, keys) {
      if (keys.length === 0) return new Set();
      const rows = rowsOf<{ leaf_key: string }>(await db.execute(sql`
        SELECT DISTINCT leaf_key FROM knowledge_sync_leaves WHERE ${scope} AND root_id <> ${rootId} AND leaf_key_hash IN (${keyList(keys)})`));
      return new Set(rows.map((r) => r.leaf_key));
    },

    async fillBuckets(rootId) {
      let filled = 0;
      for (;;) {
        // Filled rows leave the predicate, so the "first page" is always the next one.
        const page = rowsOf<{ leaf_key: string; h: string }>(await db.execute(sql`
          SELECT leaf_key, encode(leaf_key_hash, 'hex') AS h FROM knowledge_sync_leaves
          WHERE ${scope} AND root_id = ${rootId} AND bucket IS NULL LIMIT ${PAGE}`));
        if (page.length === 0) return filled;
        await db.execute(sql`
          UPDATE knowledge_sync_leaves l SET bucket = r.bucket
          FROM jsonb_to_recordset(${json(page.map((p) => ({ h: p.h, bucket: bucketOf(p.leaf_key) })))}::jsonb) AS r(h text, bucket integer)
          WHERE l.tenant_id = ${tenantId} AND l.project_id = ${projectId} AND l.root_id = ${rootId} AND l.leaf_key_hash = decode(r.h, 'hex')`);
        filled += page.length;
      }
    },

    async clear(rootId) {
      return countOf(await db.execute(sql`DELETE FROM knowledge_sync_leaves WHERE ${scope} AND root_id = ${rootId}`));
    },
  };
}

export function bucketsLedger(db: Db, tenantId: number, projectId: number): BucketsPort {
  const scope = sql`tenant_id = ${tenantId} AND project_id = ${projectId}`;
  return {
    async digests(rootId) {
      const out: string[] = new Array(MANIFEST_BUCKETS).fill(EMPTY);
      const rows = rowsOf<{ bucket: number; d: string }>(await db.execute(sql`
        SELECT bucket, encode(digest, 'hex') AS d FROM knowledge_sync_buckets WHERE ${scope} AND root_id = ${rootId}`));
      for (const r of rows) out[r.bucket] = r.d;
      return out;
    },

    async has(rootId) {
      return rowsOf<unknown>(await db.execute(sql`SELECT 1 FROM knowledge_sync_buckets WHERE ${scope} AND root_id = ${rootId} LIMIT 1`)).length > 0;
    },

    async put(rootId, rows) {
      const live = rows.filter((r) => r.digest !== EMPTY);
      const empty = rows.filter((r) => r.digest === EMPTY).map((r) => r.bucket);
      if (live.length > 0) {
        await db.execute(sql`
          INSERT INTO knowledge_sync_buckets (tenant_id, project_id, root_id, bucket, digest)
          SELECT ${tenantId}, ${projectId}, ${rootId}, r.bucket, decode(r.d, 'hex')
          FROM jsonb_to_recordset(${json(live.map((r) => ({ bucket: r.bucket, d: r.digest })))}::jsonb) AS r(bucket integer, d text)
          ON CONFLICT (tenant_id, project_id, root_id, bucket) DO UPDATE SET digest = excluded.digest`);
      }
      if (empty.length > 0) {
        await db.execute(sql`
          DELETE FROM knowledge_sync_buckets WHERE ${scope} AND root_id = ${rootId}
            AND bucket IN (SELECT jsonb_array_elements_text(${json(empty)}::jsonb)::int)`);
      }
    },

    async clear(rootId) {
      await db.execute(sql`DELETE FROM knowledge_sync_buckets WHERE ${scope} AND root_id = ${rootId}`);
    },
  };
}
