/**
 * Infrastructure — the READ side of sync pull (`SyncPullStore`, G18, migration 1304).
 *
 * Committed reads on the request handle; none of them writes. Every statement is
 * tenant-scoped, and the delta reads are destination-scoped too.
 *
 * The delta order is the commit-ordered watermark `(txid, seq)` (see
 * `domain/sync/deltaWatermark`): a page only reads rows with
 * `txid < pg_snapshot_xmin(pg_current_snapshot())`, and returns that `xmin` from the SAME
 * statement, so the caller advances its cursor against the snapshot the rows were read in.
 * `minChangeWatermark` / `changesAfter` are served by
 * `idx_sync_changes_destination_txid (tenant_id, destination_key, txid, seq)`.
 */

import { and, asc, eq, gt, or, sql } from 'drizzle-orm';
import type { SyncChangeRow, SyncPullStore, SyncRecordRow } from '../../application/sync/syncPorts';
import type { LocalEntityType, LocalRecord } from '../../domain/sync/syncProtocol';
import { reportCaughtError } from '../../application/observability/caughtErrorReporter';
import type { Db } from '../database/connection';
import { syncChanges, syncRecords } from '../database/schema/sync';
import { scopedToTenant } from '../database/tenantScope';

const toSeq = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(n) ? n : null;
};

export const RECORD_COLUMNS = {
  entityType: syncRecords.entityType,
  clientEntityId: syncRecords.clientEntityId,
  serverId: syncRecords.serverId,
  schemaVersion: syncRecords.schemaVersion,
  version: syncRecords.version,
  destinationKey: syncRecords.destinationKey,
  occurredAt: syncRecords.occurredAt,
  updatedAt: syncRecords.updatedAt,
  deletedAt: syncRecords.deletedAt,
  payload: syncRecords.payload,
  provenance: syncRecords.provenance,
};

/** Transactions the oldest open one may lag the next xid before pull reports it (delivery is delayed, not lost). */
const XMIN_AGE_WARN_XIDS = 10_000;

/**
 * The threshold above counts XIDS (transactions begun since the oldest open one), NOT time: a busy
 * database can cross it in seconds, a quiet one never. The report is throttled to once per isolate per
 * 60 s so a held-back xmin does not log on every pull. The module-level timestamp is a log throttle,
 * not a data cache.
 */
const XMIN_REPORT_INTERVAL_MS = 60_000;
let lastXminReportAt = 0;

interface DeltaRow {
  xmin: string;
  xmin_age?: string | number | null;
  txid: string | null;
  seq: string | number | null;
  record: unknown;
}

export function createSyncPullStore(db: Db, options: { xminWarnAge?: number } = {}): SyncPullStore {
  const xminWarnAge = options.xminWarnAge ?? XMIN_AGE_WARN_XIDS;
  return {
    async databaseXmin() {
      const result = await db.execute(sql`SELECT pg_snapshot_xmin(pg_current_snapshot())::text AS xmin`);
      return String((result.rows[0] as { xmin: string }).xmin);
    },

    async minChangeWatermark(tenantId, destinationKey) {
      const [row] = await db
        .select({ txid: sql<string>`${syncChanges.txid}::text`, seq: syncChanges.seq })
        .from(syncChanges)
        .where(scopedToTenant(syncChanges, tenantId, eq(syncChanges.destinationKey, destinationKey)))
        .orderBy(asc(syncChanges.txid), asc(syncChanges.seq))
        .limit(1);
      const seq = toSeq(row?.seq);
      return row && seq !== null ? { txid: String(row.txid), seq } : null;
    },

    async changesAfter(tenantId, destinationKey, after, limit) {
      // ONE statement: the xmin row is always returned (the LEFT JOIN keeps it when the page is
      // empty) and `txid < x.xmin` is evaluated against that very snapshot.
      const result = await db.execute(sql`
        SELECT x.xmin::text AS xmin,
               (pg_snapshot_xmax(pg_current_snapshot())::text::numeric - x.xmin::text::numeric)::text AS xmin_age,
               c.txid::text AS txid, c.seq AS seq, c.record AS record
        FROM (SELECT pg_snapshot_xmin(pg_current_snapshot()) AS xmin) x
        LEFT JOIN LATERAL (
          SELECT ${syncChanges.txid} AS txid, ${syncChanges.seq} AS seq, ${syncChanges.record} AS record
          FROM ${syncChanges}
          WHERE ${syncChanges.tenantId} = ${tenantId}
            AND ${syncChanges.destinationKey} = ${destinationKey}
            AND (${syncChanges.txid}, ${syncChanges.seq}) > (${after.txid}::xid8, ${after.seq}::bigint)
            AND ${syncChanges.txid} < x.xmin
          ORDER BY ${syncChanges.txid}, ${syncChanges.seq}
          LIMIT ${limit}
        ) c ON true
      `);
      const delta = result.rows as unknown as DeltaRow[];
      const xmin = String(delta[0]?.xmin ?? '0');
      const age = Number(delta[0]?.xmin_age ?? 0);
      if (age > xminWarnAge && Date.now() - lastXminReportAt >= XMIN_REPORT_INTERVAL_MS) {
        lastXminReportAt = Date.now();
        // Any long-held transaction anywhere in the database delays delivery (rows are withheld, never lost).
        reportCaughtError(new Error(`sync pull: database xmin is ${age} transactions behind`), {
          source: 'infrastructure/repositories/SyncPullRepository.ts',
          operation: 'syncPull:xminHeldBack',
          level: 'warning',
          context: { xmin, xminAge: age, tenantId },
        });
      }
      const rows: SyncChangeRow[] = [];
      for (const row of delta) {
        if (row.txid === null || row.seq === null) continue;
        rows.push({ txid: String(row.txid), seq: Number(row.seq), record: row.record as unknown as LocalRecord });
      }
      return { rows, xmin };
    },

    async snapshotAfter(tenantId, destinationKey, after, limit): Promise<SyncRecordRow[]> {
      const afterKeyset = after
        ? or(
          gt(syncRecords.entityType, after.entityType),
          and(eq(syncRecords.entityType, after.entityType), gt(syncRecords.clientEntityId, after.clientEntityId)),
        )
        : undefined;
      const rows = await db
        .select(RECORD_COLUMNS)
        .from(syncRecords)
        .where(scopedToTenant(syncRecords, tenantId, eq(syncRecords.destinationKey, destinationKey), afterKeyset))
        .orderBy(asc(syncRecords.entityType), asc(syncRecords.clientEntityId))
        .limit(limit);
      return rows.map((row) => ({
        ...row,
        entityType: row.entityType as LocalEntityType,
        provenance: (row.provenance ?? {}) as Record<string, unknown>,
      }));
    },
  };
}
