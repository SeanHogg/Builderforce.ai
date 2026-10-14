/**
 * The KEPT half of ingest: store the chunk, fold the recording row, append the
 * timeline and debit the units it newly crosses (PRD 33 §3.3 step 4).
 *
 * Order is chosen so a retry is harmless:
 *   1. an existing recording whose chunk `seq` is already in R2 is a RETRY — nothing
 *      is folded, appended or charged again;
 *   2. a NEW recording needs the licence (`replayEntitledForSite`) and a free unit or
 *      a credit (`canKeepNewRecording`); one already in progress always continues;
 *   3. the chunk goes to R2 BEFORE the row moves, so a row never counts a chunk that
 *      is not stored;
 *   4. each unit index is charged under its own ledger reference, so a unit can only
 *      ever be charged once.
 */

import { and, eq, sql } from 'drizzle-orm';
import type { ReplayChunk, ReplayDeviceClass, ReplayKeepReason } from '@builderforce/interaction-contract';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { replayRecordings } from '../../infrastructure/database/schema';
import { foldVisit, type VisitRow } from '../../domain/replay/visitSummary';
import { appendMarks } from '../../domain/replay/visitMarks';
import { billableUnits, newUnitIndexes } from '../../domain/replay/billing';
import { replayTelemetryDb } from './replayDatabase';
import { chunkExists, deleteRecording, getMarks, putChunk, putMarks, type RecordingLocation } from './replayChunkStore';
import { canKeepNewRecording, chargeUnits, noteAllowanceExhausted } from './replayUsage';
import { replayEntitledForSite } from './replayEntitlement';
import type { ReplaySiteRecord } from './replaySites';

export type RecordingRow = typeof replayRecordings.$inferSelect;

function asStringMap(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === 'string') out[key] = item;
  }
  return out;
}

/** The stored row as the domain fold's input. */
export function rowToVisit(row: RecordingRow): VisitRow {
  return {
    visitId: row.visitId,
    visitorId: row.visitorId,
    startedAt: row.startedAt,
    lastEventAt: row.lastEventAt,
    endedAt: row.endedAt,
    durationMs: row.durationMs,
    activeMs: row.activeMs,
    entryPath: row.entryPath,
    exitPath: row.exitPath,
    pageCount: row.pageCount,
    releaseKey: row.releaseKey,
    recorderVersion: row.recorderVersion,
    deviceClass: row.deviceClass as ReplayDeviceClass,
    viewportW: row.viewportW,
    viewportH: row.viewportH,
    browser: row.browser,
    os: row.os,
    referrerHost: row.referrerHost,
    clickCount: row.clickCount,
    rageCount: row.rageCount,
    deadCount: row.deadCount,
    errorCount: row.errorCount,
    quickbackCount: row.quickbackCount,
    excessiveScrollCount: row.excessiveScrollCount,
    converted: row.converted,
    keepReason: row.keepReason as ReplayKeepReason,
    sampleWeight: row.sampleWeight,
    variant: row.variant,
    identifiedId: row.identifiedId,
    traits: asStringMap(row.traits),
    chunkCount: row.chunkCount,
    routes: row.routes,
    events: row.events,
    frustrations: row.frustrations,
    clicked: row.clicked,
    issueFps: row.issueFps,
    steps: row.steps,
    tags: asStringMap(row.tags) ?? {},
  };
}

export function recordingLocation(row: Pick<RecordingRow, 'tenantId' | 'siteId' | 'id' | 'startedAt'>): RecordingLocation {
  return { tenantId: row.tenantId, siteId: row.siteId, recordingId: row.id, startedAt: row.startedAt };
}

/** The visit's kept recording, if one exists. */
export async function loadRecordingForVisit(env: Env | undefined, db: Db, site: ReplaySiteRecord, visitId: string): Promise<RecordingRow | null> {
  const [row] = await replayTelemetryDb(env, db)
    .select()
    .from(replayRecordings)
    .where(and(
      eq(replayRecordings.tenantId, site.tenantId),
      eq(replayRecordings.siteId, site.id),
      eq(replayRecordings.visitId, visitId),
    ))
    .limit(1);
  return row ?? null;
}

function rowValues(visit: VisitRow, extra: { id: string; site: ReplaySiteRecord; country: string | null; bytes: number }) {
  return {
    id: extra.id,
    siteId: extra.site.id,
    tenantId: extra.site.tenantId,
    ...visit,
    country: extra.country ? extra.country.slice(0, 2) : null,
    bytes: extra.bytes,
    billableUnits: billableUnits(extra.bytes),
  };
}

export type KeepOutcome =
  | { kind: 'stored'; recordingId: string; prev: RecordingRow | null }
  | { kind: 'duplicate'; recordingId: string; prev: RecordingRow }
  | { kind: 'refused'; prev: null };

export async function keepChunk(
  env: Env,
  db: Db,
  input: { site: ReplaySiteRecord; chunk: ReplayChunk; gzipped: Uint8Array; country: string | null; now: Date },
): Promise<KeepOutcome> {
  const { site, chunk, gzipped, now } = input;
  const prev = await loadRecordingForVisit(env, db, site, chunk.visitId);

  if (prev) {
    if (await chunkExists(env, recordingLocation(prev), chunk.seq)) {
      return { kind: 'duplicate', recordingId: prev.id, prev };
    }
  } else {
    if (!(await replayEntitledForSite(env, db, site))) return { kind: 'refused', prev: null };
    if (!(await canKeepNewRecording(env, db, site.tenantId, now))) {
      await noteAllowanceExhausted(env, db, { tenantId: site.tenantId, siteId: site.id, now });
      return { kind: 'refused', prev: null };
    }
  }

  const visit = foldVisit(prev ? rowToVisit(prev) : null, chunk, now, site.id);
  const id = prev?.id ?? crypto.randomUUID();
  const location: RecordingLocation = { tenantId: site.tenantId, siteId: site.id, recordingId: id, startedAt: visit.startedAt };
  await putChunk(env, location, chunk.seq, gzipped);

  const bytes = (prev?.bytes ?? 0) + gzipped.byteLength;
  const values = rowValues(visit, { id, site, country: prev?.country ?? input.country, bytes });
  const { id: _id, siteId: _site, tenantId: _tenant, visitId: _visit, ...mutable } = values;
  const [saved] = await replayTelemetryDb(env, db)
    .insert(replayRecordings)
    .values(values)
    .onConflictDoUpdate({
      target: [replayRecordings.siteId, replayRecordings.visitId],
      set: { ...mutable, updatedAt: sql`now()` },
    })
    .returning({ id: replayRecordings.id, startedAt: replayRecordings.startedAt });

  let recordingId = saved?.id ?? id;
  let stored = location;
  if (saved && saved.id !== id) {
    // Two first chunks of one visit raced and the other insert won: file this chunk
    // under the winning recording and drop the orphan copy.
    stored = { ...location, recordingId: saved.id, startedAt: saved.startedAt };
    await putChunk(env, stored, chunk.seq, gzipped);
    await deleteRecording(env, location);
    recordingId = saved.id;
  }

  if (chunk.marks.length > 0) {
    const existing = await getMarks(env, stored);
    await putMarks(env, stored, appendMarks(existing, chunk.marks));
  }

  for (const unitIndex of newUnitIndexes(prev?.billableUnits ?? 0, bytes)) {
    await chargeUnits(env, db, { tenantId: site.tenantId, siteId: site.id, recordingId, unitIndex, now });
  }

  return { kind: 'stored', recordingId, prev };
}
