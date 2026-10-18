/**
 * Row → DTO mapping, cursors and the filter cache key for the Insights reads
 * (PRD 33 §3.4 `api.ts`). Kept beside `ReplayReadService` so the service stays about
 * scope and caching. The filter itself compiles in `replayFilterCompiler.ts` — the
 * one compiler.
 */

import { sql, type SQL } from 'drizzle-orm';
import {
  fnv1a64,
  type ReplayDeviceClass,
  type ReplayFilter,
  type ReplayIssueDto,
  type ReplayIssueStatus,
  type ReplayKeepReason,
  type ReplayMark,
  type ReplayRecordingDto,
  type ReplayRecordingSummaryDto,
} from '@builderforce/interaction-contract';
import { replayRecordings } from '../../infrastructure/database/schema';
import type { RecordingRow } from './replayRecordingWriter';
import { DAY_MS } from '../../domain/shared/time';

export const RECORDINGS_PAGE = 50;
export const ISSUES_PAGE = 50;

const iso = (value: Date | string): string => (value instanceof Date ? value : new Date(String(value))).toISOString();

function stringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) if (typeof item === 'string') out[key] = item;
  return out;
}

export function toRecordingSummary(row: RecordingRow): ReplayRecordingSummaryDto {
  return {
    id: row.id,
    visitId: row.visitId,
    visitorId: row.visitorId,
    startedAt: iso(row.startedAt),
    durationMs: row.durationMs,
    activeMs: row.activeMs,
    entryPath: row.entryPath,
    exitPath: row.exitPath,
    pageCount: row.pageCount,
    releaseKey: row.releaseKey,
    deviceClass: row.deviceClass as ReplayDeviceClass,
    browser: row.browser,
    os: row.os,
    country: row.country,
    referrerHost: row.referrerHost,
    counts: {
      clicks: row.clickCount,
      rage: row.rageCount,
      dead: row.deadCount,
      errors: row.errorCount,
      quickbacks: row.quickbackCount,
      excessiveScrolls: row.excessiveScrollCount,
    },
    converted: row.converted,
    keepReason: row.keepReason as ReplayKeepReason,
    sampleWeight: row.sampleWeight,
    identifiedId: row.identifiedId,
    tags: stringMap(row.tags),
  };
}

export function toRecordingDto(row: RecordingRow, marks: ReplayMark[], chunkSeqs: number[]): ReplayRecordingDto {
  return {
    ...toRecordingSummary(row),
    recorderVersion: row.recorderVersion,
    viewport: { w: row.viewportW, h: row.viewportH },
    variant: row.variant,
    traits: row.traits ? stringMap(row.traits) : null,
    chunkCount: row.chunkCount,
    chunkSeqs,
    marks,
    ended: row.endedAt != null,
  };
}

// ── Keyset cursor over (started_at desc, id desc) ───────────────────────────

export function encodeRecordingCursor(row: Pick<RecordingRow, 'startedAt' | 'id'>): string {
  return `${new Date(row.startedAt).getTime()}.${row.id}`;
}

export function decodeRecordingCursor(cursor: string | null | undefined): { at: Date; id: string } | null {
  const match = cursor ? /^(\d{1,15})\.([0-9a-f-]{36})$/i.exec(cursor) : null;
  if (!match) return null;
  return { at: new Date(Number(match[1])), id: match[2]! };
}

/** The predicate "strictly after the cursor" in (started_at desc, id desc) order. */
export function afterRecordingCursor(cursor: { at: Date; id: string } | null): SQL | undefined {
  if (!cursor) return undefined;
  return sql`(${replayRecordings.startedAt}, ${replayRecordings.id}) < (${cursor.at.toISOString()}::timestamp, ${cursor.id}::uuid)`;
}

/** Offset cursors for ranked lists (issues rank by sessions, not by a key). */
export function decodeOffsetCursor(cursor: string | null | undefined): number {
  const n = cursor && /^\d{1,6}$/.test(cursor) ? Number(cursor) : 0;
  return Number.isFinite(n) ? n : 0;
}

// ── Filter cache key ────────────────────────────────────────────────────────

/** A short stable key for a filter, for cache keys. */
export function filterCacheKey(filter: ReplayFilter | null | undefined): string {
  if (!filter || filter.all.length === 0) return '';
  return fnv1a64(JSON.stringify(filter.all));
}

// ── Issues ──────────────────────────────────────────────────────────────────

export interface IssueRow {
  id: string;
  fingerprint: string;
  kind: string;
  route: string;
  subject: string;
  title: string;
  status: string;
  firstRelease: string | null;
  lastRelease: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  prescriptionId: string | null;
}

export function toIssueDto(row: IssueRow, stats: { sessions: number; routeSessions: number; sparkline: number[] }): ReplayIssueDto {
  return {
    id: row.id,
    fingerprint: row.fingerprint,
    kind: row.kind,
    route: row.route,
    subject: row.subject,
    title: row.title,
    status: row.status as ReplayIssueStatus,
    sessions: stats.sessions,
    share: stats.routeSessions > 0 ? Math.min(1, stats.sessions / stats.routeSessions) : 0,
    sparkline: stats.sparkline,
    firstRelease: row.firstRelease,
    lastRelease: row.lastRelease,
    firstSeenAt: iso(row.firstSeenAt),
    lastSeenAt: iso(row.lastSeenAt),
    prescriptionId: row.prescriptionId,
  };
}

/** `days` UTC days ending today, oldest first, as `YYYY-MM-DD`. */
export function windowDays(now: Date, days: number): string[] {
  const out: string[] = [];
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (let i = days - 1; i >= 0; i--) out.push(new Date(today - i * DAY_MS).toISOString().slice(0, 10));
  return out;
}

/** Clamp a `days` query value to 1..90 (default 30). */
export function clampDays(raw: unknown, fallback = 30): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(90, Math.max(1, Math.round(n)));
}
