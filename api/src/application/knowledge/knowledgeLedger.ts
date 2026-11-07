/**
 * knowledgeLedger — the two Postgres tables that make pack sync's storage bounded per pack (PRD 41 A11 rule 4a):
 *
 *   knowledge_extracted_index  hash → { bundle_key, byte_offset, byte_length, source_refs }: where a body lives
 *                              in a content-addressed bundle object, and which sources its entries name
 *   knowledge_sources          the current sources of a root, one row each (not one R2 object each)
 *
 * Every statement here is ONE statement for any number of rows: the rows ride in a single JSON parameter and are
 * expanded in SQL (`jsonb_to_recordset`), so a 20,000-hash have-check or a 20,000-source upsert is one query. Bound
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

export interface ExtractedIndexPort {
  /** Where each of `hashes` lives; a hash with no row is absent. ONE query. */
  locate(hashes: readonly string[]): Promise<ExtractedLoc[]>;
  /** Records locations (a later write of a hash replaces it). ONE statement. */
  upsert(rows: readonly ExtractedLoc[]): Promise<void>;
}

export interface SourcesLedgerPort {
  list(rootId: string): Promise<SourceRow[]>;
  /** Records sources (a later write of a source replaces it). ONE statement. */
  upsert(rootId: string, rows: readonly SourceRow[]): Promise<void>;
  remove(rootId: string, sourceIds: readonly string[]): Promise<void>;
  /** Forgets every source of the root. Returns rows removed. */
  clear(rootId: string): Promise<number>;
}

export interface KnowledgeLedgerPort {
  index: ExtractedIndexPort;
  sources: SourcesLedgerPort;
}

const json = (value: unknown): string => JSON.stringify(value);

export function drizzleLedger(db: Db, tenantId: number, projectId: number): KnowledgeLedgerPort {
  const rowsOf = <T>(result: unknown): T[] => ((result as { rows?: T[] }).rows ?? (result as T[])) as T[];
  return {
    index: {
      async locate(hashes) {
        if (hashes.length === 0) return [];
        const result = await db.execute(sql`
          SELECT hash, bundle_key, byte_offset, byte_length, source_refs
          FROM knowledge_extracted_index
          WHERE tenant_id = ${tenantId} AND project_id = ${projectId}
            AND hash IN (SELECT jsonb_array_elements_text(${json(hashes)}::jsonb))`);
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
    },

    sources: {
      async list(rootId) {
        const result = await db.execute(sql`
          SELECT source_id, path, hash FROM knowledge_sources
          WHERE tenant_id = ${tenantId} AND project_id = ${projectId} AND root_id = ${rootId}`);
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
          DELETE FROM knowledge_sources
          WHERE tenant_id = ${tenantId} AND project_id = ${projectId} AND root_id = ${rootId}
            AND source_id IN (SELECT jsonb_array_elements_text(${json(sourceIds)}::jsonb))`);
      },

      async clear(rootId) {
        const result = await db.execute(sql`
          DELETE FROM knowledge_sources WHERE tenant_id = ${tenantId} AND project_id = ${projectId} AND root_id = ${rootId}`);
        return (result as unknown as { rowCount?: number }).rowCount ?? 0;
      },
    },
  };
}
