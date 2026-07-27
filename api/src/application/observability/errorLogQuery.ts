/**
 * Read model for `api_error_log` — the platform's own caught/unhandled
 * exception stream written by {@link persistCaughtError}.
 *
 * This is the single source of truth for reading that stream. The superadmin
 * Logs page (`GET /api/admin/errors`) and the built-in MCP `errors.*` tools
 * both call these functions, so filter semantics, redaction and rollup shape
 * can never drift between the human surface and the agent surface.
 *
 * Everything here reads the OPERATIONAL database (`buildTransactionalDatabase`)
 * because that is where persistCaughtError writes.
 */

import { and, desc, eq, gte, ilike, isNotNull, or, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { apiErrorLog } from '../../infrastructure/database/schema';

export const ERROR_LOG_MAX_LIMIT = 200;
export const ERROR_LOG_DEFAULT_LIMIT = 50;

export interface ErrorLogFilters {
  /** Substring match against source, operation, path or message. */
  q?: string;
  /** Exact `source` (the reporting module path). */
  source?: string;
  /** Exact `operation` (the reporting function). */
  operation?: string;
  /** Exact request path. */
  path?: string;
  /** true = intentionally caught, false = became an HTTP 500. */
  handled?: boolean;
  /** Scope hint written by the reporter; not an enforced foreign key. */
  tenantId?: number;
  /** Only entries newer than this many hours. */
  sinceHours?: number;
  limit?: number;
  offset?: number;
}

export interface ErrorLogEntry {
  id: number;
  tenantId: number | null;
  method: string | null;
  path: string | null;
  source: string | null;
  operation: string | null;
  handled: boolean;
  context: Record<string, unknown>;
  message: string | null;
  stack: string | null;
  createdAt: string;
}

export interface ErrorLogGroup {
  source: string | null;
  operation: string | null;
  /** Most recent message seen for the group — the human-readable label. */
  sampleMessage: string | null;
  /** Id of the most recent entry, so a caller can jump straight to detail. */
  sampleId: number;
  count: number;
  handledCount: number;
  unhandledCount: number;
  tenantCount: number;
  firstSeen: string;
  lastSeen: string;
}

export interface ErrorLogSummary {
  /** Total entries matching the filters within the window. */
  total: number;
  unhandled: number;
  handled: number;
  /** Distinct source+operation pairs — how many *distinct* faults, not events. */
  distinctFaults: number;
  windowHours: number | null;
  /** Loudest faults first: this is the answer, the rows are the evidence. */
  groups: ErrorLogGroup[];
}

export function clampErrorLogLimit(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return ERROR_LOG_DEFAULT_LIMIT;
  return Math.min(Math.floor(n), ERROR_LOG_MAX_LIMIT);
}

function clampOffset(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Escape the LIKE metacharacters so a user-typed `_` or `%` stays literal. */
function likeTerm(term: string): string {
  return `%${term.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

function buildConditions(filters: ErrorLogFilters): SQL[] {
  const conds: SQL[] = [];

  if (filters.source) conds.push(eq(apiErrorLog.source, filters.source));
  if (filters.operation) conds.push(eq(apiErrorLog.operation, filters.operation));
  if (filters.path) conds.push(eq(apiErrorLog.path, filters.path));
  if (typeof filters.handled === 'boolean') conds.push(eq(apiErrorLog.handled, filters.handled));
  if (typeof filters.tenantId === 'number' && Number.isFinite(filters.tenantId)) {
    conds.push(eq(apiErrorLog.scopeTenantId, filters.tenantId));
  }

  if (typeof filters.sinceHours === 'number' && filters.sinceHours > 0) {
    const since = new Date(Date.now() - filters.sinceHours * 3_600_000);
    conds.push(gte(apiErrorLog.createdAt, since));
  }

  const q = filters.q?.trim();
  if (q) {
    const term = likeTerm(q);
    const matched = or(
      ilike(apiErrorLog.source, term),
      ilike(apiErrorLog.operation, term),
      ilike(apiErrorLog.path, term),
      ilike(apiErrorLog.message, term),
    );
    if (matched) conds.push(matched);
  }

  return conds;
}

function whereClause(filters: ErrorLogFilters): SQL | undefined {
  const conds = buildConditions(filters);
  if (conds.length === 0) return undefined;
  return conds.length === 1 ? conds[0] : and(...conds);
}

function toEntry(row: typeof apiErrorLog.$inferSelect): ErrorLogEntry {
  return {
    id: row.id,
    tenantId: row.scopeTenantId ?? null,
    method: row.method ?? null,
    path: row.path ?? null,
    source: row.source ?? null,
    operation: row.operation ?? null,
    handled: row.handled,
    context: (row.context ?? {}) as Record<string, unknown>,
    message: row.message ?? null,
    stack: row.stack ?? null,
    createdAt: (row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt)).toISOString(),
  };
}

/** One page of raw entries, newest first, plus the unpaged total. */
export async function queryErrorLog(
  db: Db,
  filters: ErrorLogFilters = {},
): Promise<{ errors: ErrorLogEntry[]; total: number; returned: number; offset: number; hasMore: boolean }> {
  const where = whereClause(filters);
  const limit = clampErrorLogLimit(filters.limit);
  const offset = clampOffset(filters.offset);

  const rowsQuery = db.select().from(apiErrorLog);
  const countQuery = db.select({ n: sql<number>`count(*)::int` }).from(apiErrorLog);

  const [rows, counted] = await Promise.all([
    (where ? rowsQuery.where(where) : rowsQuery)
      .orderBy(desc(apiErrorLog.createdAt), desc(apiErrorLog.id))
      .limit(limit)
      .offset(offset),
    where ? countQuery.where(where) : countQuery,
  ]);

  const total = counted[0]?.n ?? 0;
  const errors = rows.map(toEntry);
  return { errors, total, returned: errors.length, offset, hasMore: offset + errors.length < total };
}

/** Answer-first rollup: which faults are loudest, before the raw rows. */
export async function summarizeErrorLog(
  db: Db,
  filters: ErrorLogFilters = {},
): Promise<ErrorLogSummary> {
  const where = whereClause(filters);
  const groupLimit = clampErrorLogLimit(filters.limit);

  const totalsQuery = db
    .select({
      total: sql<number>`count(*)::int`,
      unhandled: sql<number>`count(*) filter (where ${apiErrorLog.handled} = false)::int`,
      distinctFaults: sql<number>`count(distinct (${apiErrorLog.source}, ${apiErrorLog.operation}))::int`,
    })
    .from(apiErrorLog);

  // DISTINCT ON gives the newest message per fault in the same pass — no N+1
  // follow-up query per group.
  const groupsQuery = db
    .select({
      source: apiErrorLog.source,
      operation: apiErrorLog.operation,
      count: sql<number>`count(*)::int`,
      handledCount: sql<number>`count(*) filter (where ${apiErrorLog.handled} = true)::int`,
      unhandledCount: sql<number>`count(*) filter (where ${apiErrorLog.handled} = false)::int`,
      tenantCount: sql<number>`count(distinct ${apiErrorLog.scopeTenantId})::int`,
      firstSeen: sql<string>`min(${apiErrorLog.createdAt})`,
      lastSeen: sql<string>`max(${apiErrorLog.createdAt})`,
      sampleId: sql<number>`(array_agg(${apiErrorLog.id} order by ${apiErrorLog.createdAt} desc))[1]`,
      sampleMessage: sql<string | null>`(array_agg(${apiErrorLog.message} order by ${apiErrorLog.createdAt} desc))[1]`,
    })
    .from(apiErrorLog);

  const [totals, groups] = await Promise.all([
    where ? totalsQuery.where(where) : totalsQuery,
    (where ? groupsQuery.where(where) : groupsQuery)
      .groupBy(apiErrorLog.source, apiErrorLog.operation)
      .orderBy(sql`count(*) desc`, sql`max(${apiErrorLog.createdAt}) desc`)
      .limit(groupLimit),
  ]);

  const total = totals[0]?.total ?? 0;
  const unhandled = totals[0]?.unhandled ?? 0;

  return {
    total,
    unhandled,
    handled: total - unhandled,
    distinctFaults: totals[0]?.distinctFaults ?? 0,
    windowHours: typeof filters.sinceHours === 'number' && filters.sinceHours > 0 ? filters.sinceHours : null,
    groups: groups.map((g) => ({
      source: g.source ?? null,
      operation: g.operation ?? null,
      sampleMessage: g.sampleMessage ?? null,
      sampleId: Number(g.sampleId ?? 0),
      count: g.count,
      handledCount: g.handledCount,
      unhandledCount: g.unhandledCount,
      tenantCount: g.tenantCount,
      firstSeen: new Date(g.firstSeen).toISOString(),
      lastSeen: new Date(g.lastSeen).toISOString(),
    })),
  };
}

/** One entry with its full stack and context, or null. */
export async function getErrorLogEntry(db: Db, id: number): Promise<ErrorLogEntry | null> {
  if (!Number.isFinite(id)) return null;
  const [row] = await db.select().from(apiErrorLog).where(eq(apiErrorLog.id, Math.floor(id))).limit(1);
  return row ? toEntry(row) : null;
}

/** Distinct sources present in the window — powers the filter dropdown. */
export async function listErrorLogSources(db: Db, sinceHours?: number): Promise<string[]> {
  const conds: SQL[] = [isNotNull(apiErrorLog.source)];
  if (typeof sinceHours === 'number' && sinceHours > 0) {
    conds.push(gte(apiErrorLog.createdAt, new Date(Date.now() - sinceHours * 3_600_000)));
  }
  const rows = await db
    .selectDistinct({ source: apiErrorLog.source })
    .from(apiErrorLog)
    .where(and(...conds))
    .orderBy(apiErrorLog.source)
    .limit(ERROR_LOG_MAX_LIMIT);
  return rows.map((r) => r.source).filter((s): s is string => Boolean(s));
}
