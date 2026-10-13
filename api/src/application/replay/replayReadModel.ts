/**
 * Row → DTO mapping, cursors and the S1 recording filter for the Insights reads
 * (PRD 33 §3.4 `api.ts`). Kept beside `ReplayReadService` so the service stays about
 * scope and caching.
 *
 * THE FILTER HERE IS THE S1 SUBSET. It compiles the clauses that map straight onto
 * one `replay_recordings` column or array (device, browser, os, country, release,
 * variant, converted, entry/exit path, durations, page count, visited path,
 * frustration, smart event, clicked selector, tag) and ignores the rest. S4c's
 * `replayFilterCompiler` replaces this function wholesale; it is the only caller.
 */

import { and, arrayContains, arrayOverlaps, eq, gte, ilike, inArray, lte, ne, sql, type SQL } from 'drizzle-orm';
import {
  fnv1a64,
  type ReplayDeviceClass,
  type ReplayFilter,
  type ReplayFilterClause,
  type ReplayIssueDto,
  type ReplayIssueStatus,
  type ReplayKeepReason,
  type ReplayMark,
  type ReplayRecordingDto,
  type ReplayRecordingSummaryDto,
} from '@builderforce/interaction-contract';
import { replayRecordings } from '../../infrastructure/database/schema';
import type { RecordingRow } from './replayRecordingWriter';

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

export function toRecordingDto(row: RecordingRow, marks: ReplayMark[]): ReplayRecordingDto {
  return {
    ...toRecordingSummary(row),
    recorderVersion: row.recorderVersion,
    viewport: { w: row.viewportW, h: row.viewportH },
    variant: row.variant,
    traits: row.traits ? stringMap(row.traits) : null,
    chunkCount: row.chunkCount,
    marks,
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

// ── The S1 recording filter ─────────────────────────────────────────────────

/** A short stable key for a filter, for cache keys. */
export function filterCacheKey(filter: ReplayFilter | null | undefined): string {
  if (!filter || filter.all.length === 0) return '';
  return fnv1a64(JSON.stringify(filter.all));
}

function list(value: ReplayFilterClause['value']): Array<string | number> {
  return Array.isArray(value) ? [...value] : [value as string | number];
}

const COLUMNS = {
  device: replayRecordings.deviceClass,
  browser: replayRecordings.browser,
  os: replayRecordings.os,
  country: replayRecordings.country,
  referrer: replayRecordings.referrerHost,
  release: replayRecordings.releaseKey,
  variant: replayRecordings.variant,
  entryPath: replayRecordings.entryPath,
  exitPath: replayRecordings.exitPath,
} as const;

const NUMBERS = {
  durationMs: replayRecordings.durationMs,
  activeMs: replayRecordings.activeMs,
  pageCount: replayRecordings.pageCount,
} as const;

const ARRAYS = {
  visitedPath: replayRecordings.routes,
  frustration: replayRecordings.frustrations,
  smartEvent: replayRecordings.events,
  clickedSelector: replayRecordings.clicked,
} as const;

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function clauseWhere(clause: ReplayFilterClause): SQL | undefined {
  const { field, op, value } = clause;
  if (field in COLUMNS) {
    const column = COLUMNS[field as keyof typeof COLUMNS];
    if (op === 'eq') return eq(column, String(value));
    if (op === 'neq') return ne(column, String(value));
    if (op === 'in') return inArray(column, list(value).map(String));
    if (op === 'contains') return ilike(column, `%${escapeLike(String(value))}%`);
    if (op === 'prefix') return ilike(column, `${escapeLike(String(value))}%`);
    return undefined;
  }
  if (field in NUMBERS) {
    const column = NUMBERS[field as keyof typeof NUMBERS];
    const n = Number(value);
    if (!Number.isFinite(n)) return undefined;
    if (op === 'gte') return gte(column, n);
    if (op === 'lte') return lte(column, n);
    if (op === 'eq') return eq(column, n);
    return undefined;
  }
  if (field in ARRAYS) {
    const column = ARRAYS[field as keyof typeof ARRAYS];
    const items = list(value).map(String);
    if (op === 'eq') return arrayContains(column, items);
    if (op === 'in') return arrayOverlaps(column, items);
    if (op === 'neq') return sql`not (${arrayContains(column, items)})`;
    return undefined;
  }
  if (field === 'converted' && op === 'eq') return eq(replayRecordings.converted, value === true);
  if (field === 'tag' && typeof value === 'string') {
    const at = value.indexOf('=');
    if (at <= 0) return undefined;
    const match = sql`${replayRecordings.tags} ->> ${value.slice(0, at)} = ${value.slice(at + 1)}`;
    return op === 'neq' ? sql`not (${match})` : match;
  }
  return undefined;
}

/** The S1 subset of a filter as one AND-ed predicate (undefined when nothing applies). */
export function recordingFilterWhere(filter: ReplayFilter | null | undefined): SQL | undefined {
  if (!filter) return undefined;
  const parts = filter.all.map(clauseWhere).filter((part): part is SQL => part !== undefined);
  return parts.length ? and(...parts) : undefined;
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
  for (let i = days - 1; i >= 0; i--) out.push(new Date(today - i * 86_400_000).toISOString().slice(0, 10));
  return out;
}

/** Clamp a `days` query value to 1..90 (default 30). */
export function clampDays(raw: unknown, fallback = 30): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(90, Math.max(1, Math.round(n)));
}
