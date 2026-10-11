import { desc, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { replayVisits } from '../../infrastructure/database/schema';

/** Newest-first page the Sessions canvas and admin list share. */
export const REPLAY_VISIT_LIST_LIMIT = 50;

const SITE_ID = /^[A-Za-z0-9._:-]{1,64}$/;

/**
 * Opaque recorder site key. Rejects empty, oversized, or punctuation that
 * would not be a recorder id — the query string is otherwise a free filter
 * against every tenant's recordings.
 */
export function parseReplaySiteId(raw: string): string | null {
  const trimmed = raw.trim();
  return SITE_ID.test(trimmed) ? trimmed : null;
}

/**
 * VisitRow (domain/replay/visitSummary) as JSON, plus the site the recording
 * belongs to. Dates are ISO strings because that is what the wire carries.
 */
export interface AdminReplayVisit {
  visitId: string;
  siteId: string;
  startedAt: string;
  lastEventAt: string;
  endedAt: string | null;
  durationMs: number;
  activeMs: number;
  entryPath: string;
  exitPath: string;
  pageCount: number;
  clickCount: number;
  rageCount: number;
  deadCount: number;
  errorCount: number;
  quickbackCount: number;
  excessiveScrollCount: number;
  converted: boolean;
  chunkCount: number;
}

function iso(value: Date | string | null): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function toAdminReplayVisit(row: {
  visitId: string;
  siteId: string;
  startedAt: Date | string;
  lastEventAt: Date | string;
  endedAt: Date | string | null;
  durationMs: number;
  activeMs: number;
  entryPath: string;
  exitPath: string;
  pageCount: number;
  clickCount: number;
  rageCount: number;
  deadCount: number;
  errorCount: number;
  quickbackCount: number;
  excessiveScrollCount: number;
  converted: boolean;
  chunkCount: number;
}): AdminReplayVisit {
  return {
    visitId: row.visitId,
    siteId: row.siteId,
    startedAt: iso(row.startedAt) ?? '',
    lastEventAt: iso(row.lastEventAt) ?? '',
    endedAt: iso(row.endedAt),
    durationMs: row.durationMs,
    activeMs: row.activeMs,
    entryPath: row.entryPath,
    exitPath: row.exitPath,
    pageCount: row.pageCount,
    clickCount: row.clickCount,
    rageCount: row.rageCount,
    deadCount: row.deadCount,
    errorCount: row.errorCount,
    quickbackCount: row.quickbackCount,
    excessiveScrollCount: row.excessiveScrollCount,
    converted: Boolean(row.converted),
    chunkCount: row.chunkCount,
  };
}

/**
 * Superadmin read of recorded visits. Ingest that folds chunks into this
 * table is a later slice; this service is the list the Sessions canvas
 * already needs.
 */
export class ReplayVisitService {
  constructor(private readonly db: Db) {}

  async listVisits(siteId?: string): Promise<AdminReplayVisit[]> {
    const rows = await this.db
      .select({
        visitId: replayVisits.visitId,
        siteId: replayVisits.siteId,
        tenantId: replayVisits.tenantId,
        startedAt: replayVisits.startedAt,
        lastEventAt: replayVisits.lastEventAt,
        endedAt: replayVisits.endedAt,
        durationMs: replayVisits.durationMs,
        activeMs: replayVisits.activeMs,
        entryPath: replayVisits.entryPath,
        exitPath: replayVisits.exitPath,
        pageCount: replayVisits.pageCount,
        clickCount: replayVisits.clickCount,
        rageCount: replayVisits.rageCount,
        deadCount: replayVisits.deadCount,
        errorCount: replayVisits.errorCount,
        quickbackCount: replayVisits.quickbackCount,
        excessiveScrollCount: replayVisits.excessiveScrollCount,
        converted: replayVisits.converted,
        chunkCount: replayVisits.chunkCount,
      })
      .from(replayVisits)
      .where(siteId ? eq(replayVisits.siteId, siteId) : undefined)
      .orderBy(desc(replayVisits.lastEventAt))
      .limit(REPLAY_VISIT_LIST_LIMIT);
    return rows.map(toAdminReplayVisit);
  }
}
