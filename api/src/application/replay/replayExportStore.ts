/**
 * `replay_exports` rows and their R2 objects (PRD 33 §8 S4b) — the storage half of
 * `replayVideoExport.ts`. Every statement carries the tenant; reads a member makes
 * carry the site as well (D17). Status moves only along {@link EXPORT_TRANSITIONS}.
 *
 *   R2: replay-exports/t<tenantId>/<exportId>.<mp4|webm>
 */

import { and, desc, eq, gte, inArray, lt } from 'drizzle-orm';
import {
  REPLAY_PATHS,
  type ReplayExportDto,
  type ReplayExportStatus,
} from '@builderforce/interaction-contract';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { replayExports } from '../../infrastructure/database/schema';
import { acrossTenants } from '../../infrastructure/database/tenantScope';
import { DAY_MS } from '../../domain/shared/time';
import type { ReplayScope } from '../../domain/replay/replayScope';

export type ExportRow = typeof replayExports.$inferSelect;
export type ExportFormat = 'mp4' | 'webm';

export const REPLAY_EXPORT_PREFIX = 'replay-exports/';
/** An export (row and file) is kept this long, then the daily retention pass drops it. */
export const EXPORT_RETENTION_DAYS = 7;
const ERROR_MAX = 400;

/** The content type each format is stored and served with. */
export const EXPORT_CONTENT_TYPES: Record<ExportFormat, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
};

/** The format a runner upload's Content-Type names, or null when it is not a video we keep. */
export function formatOfContentType(contentType: string | null | undefined): ExportFormat | null {
  const type = (contentType ?? '').split(';', 1)[0]?.trim().toLowerCase() ?? '';
  const found = (Object.entries(EXPORT_CONTENT_TYPES) as Array<[ExportFormat, string]>).find(([, t]) => t === type);
  return found ? found[0] : null;
}

/** Which status each move may start from. `done`, `failed` and `unavailable` are terminal. */
export const EXPORT_TRANSITIONS: Record<'running' | 'done' | 'failed', ReplayExportStatus[]> = {
  running: ['queued'],
  done: ['queued', 'running'],
  failed: ['queued', 'running'],
};

/** Statuses a new request for the same recording reuses instead of rendering again. */
const REUSABLE: ReplayExportStatus[] = ['queued', 'running', 'done'];

export function exportObjectKey(tenantId: number, exportId: string, format: ExportFormat): string {
  return `${REPLAY_EXPORT_PREFIX}t${tenantId}/${exportId}.${format}`;
}

const isStatus = (value: string): value is ReplayExportStatus =>
  ['queued', 'running', 'done', 'failed', 'unavailable'].includes(value);

export function toExportDto(row: ExportRow): ReplayExportDto {
  const status: ReplayExportStatus = isStatus(row.status) ? row.status : 'failed';
  const format = row.format === 'mp4' || row.format === 'webm' ? row.format : null;
  const downloadUrl = status === 'done' && row.r2Key
    ? `${REPLAY_PATHS.exportDownload.replace(':exportId', encodeURIComponent(row.id))}?site=${encodeURIComponent(row.siteId)}`
    : null;
  return {
    id: row.id,
    recordingId: row.recordingId,
    status,
    format,
    downloadUrl,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function insertExport(
  db: Db,
  input: { scope: ReplayScope; recordingId: string; requestedBy: string | null; status: ReplayExportStatus; error?: string | null },
): Promise<ExportRow> {
  const [row] = await db
    .insert(replayExports)
    .values({
      tenantId: input.scope.tenantId,
      siteId: input.scope.siteId,
      recordingId: input.recordingId,
      status: input.status,
      error: input.error ? input.error.slice(0, ERROR_MAX) : null,
      requestedBy: input.requestedBy,
    })
    .returning();
  if (!row) throw new Error('replay export insert returned no row');
  return row;
}

/** A member's read: the export inside the scope, or null. */
export async function findExport(db: Db, scope: ReplayScope, exportId: string): Promise<ExportRow | null> {
  const [row] = await db
    .select()
    .from(replayExports)
    .where(and(
      eq(replayExports.tenantId, scope.tenantId),
      eq(replayExports.siteId, scope.siteId),
      eq(replayExports.id, exportId),
    ))
    .limit(1);
  return row ?? null;
}

/** The runner's read: its token names the tenant and the export, nothing else. */
export async function findExportForRunner(db: Db, tenantId: number, exportId: string): Promise<ExportRow | null> {
  const [row] = await db
    .select()
    .from(replayExports)
    .where(and(eq(replayExports.tenantId, tenantId), eq(replayExports.id, exportId)))
    .limit(1);
  return row ?? null;
}

/** A live or finished export of this recording requested since `since` — reused, never re-charged. */
export async function findReusableExport(db: Db, scope: ReplayScope, recordingId: string, since: Date): Promise<ExportRow | null> {
  const [row] = await db
    .select()
    .from(replayExports)
    .where(and(
      eq(replayExports.tenantId, scope.tenantId),
      eq(replayExports.siteId, scope.siteId),
      eq(replayExports.recordingId, recordingId),
      inArray(replayExports.status, REUSABLE),
      gte(replayExports.createdAt, since),
    ))
    .orderBy(desc(replayExports.createdAt))
    .limit(1);
  return row ?? null;
}

/**
 * Move an export to `to` if — and only if — it is still in one of the statuses that
 * move may start from. Returns the updated row, or null when another writer (a retried
 * callback) already moved it.
 */
export async function moveExport(
  db: Db,
  tenantId: number,
  exportId: string,
  to: keyof typeof EXPORT_TRANSITIONS,
  patch: { format?: ExportFormat; r2Key?: string; error?: string | null } = {},
): Promise<ExportRow | null> {
  const [row] = await db
    .update(replayExports)
    .set({
      status: to,
      ...(patch.format ? { format: patch.format } : {}),
      ...(patch.r2Key ? { r2Key: patch.r2Key } : {}),
      ...(patch.error !== undefined ? { error: patch.error ? patch.error.slice(0, ERROR_MAX) : null } : {}),
      updatedAt: new Date(),
    })
    .where(and(
      eq(replayExports.tenantId, tenantId),
      eq(replayExports.id, exportId),
      inArray(replayExports.status, EXPORT_TRANSITIONS[to]),
    ))
    .returning();
  return row ?? null;
}

/**
 * Retention (§6 "Privacy"): drop exports older than {@link EXPORT_RETENTION_DAYS} —
 * the rows and their files. A video of a recording must not outlive the window in
 * which the recording itself is a short-lived artefact. Returns rows removed.
 */
export async function purgeExpiredExports(env: Env | undefined, db: Db, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - EXPORT_RETENTION_DAYS * DAY_MS);
  const removed = await db
    .delete(replayExports)
    .where(acrossTenants(replayExports, 'scheduled_sweep', lt(replayExports.createdAt, cutoff)))
    .returning({ r2Key: replayExports.r2Key });
  const keys = removed.map((row) => row.r2Key).filter((key): key is string => Boolean(key));
  const bucket = env?.UPLOADS;
  if (bucket) {
    for (let i = 0; i < keys.length; i += 1_000) await bucket.delete(keys.slice(i, i + 1_000));
  }
  return removed.length;
}
