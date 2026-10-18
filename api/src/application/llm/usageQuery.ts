/**
 * THE usage query use case — every read of `llm_usage_log` that answers "how much
 * did <scope> use / cost over <window>, broken down by <dimension>".
 *
 * Extracted from `usageCostSummary.ts` (the cached predicate-sum that ticket and run
 * spend already shared) and generalised with the breakdowns `gatewayUsageReport.ts`,
 * `dashboardRoutes.ts`, `projectRoutes.ts`, the admin `/llm-usage` handler and
 * `queryTenantApiKeyUsage` each hand-wrote. Those copies had drifted in ways a user
 * could see:
 *   • the dashboard counted requests with `COUNT(*)`, so past the grain rollup it
 *     under-reported every folded day while `/llm/v1/usage` (SUM(calls)) did not;
 *   • the admin page built its own transactional handle while the tenant pages used
 *     `resolveUsageDatabase`, which is how one of them once summed an empty table;
 *   • two of five surfaces cached and three hit the ledger on every poll.
 * One filter → one predicate → one aggregate is the cure: a figure can only differ
 * between two surfaces if their FILTERS differ, and that is visible at the call site.
 *
 * Deliberately NOT here: the plan-allowance counter (`tokenUsage.ts`). That sums a
 * cache-WEIGHTED, billable-only token figure — the number the gate enforces — which
 * is a different quantity from the raw ledger totals below, and folding the two
 * together would make "tokens used" mean two things in one module.
 *
 * Every read resolves the ledger's own database (`usageDatabaseOf`) — the
 * operational one in production — so no caller can point it at the core copy.
 */

import { and, asc, desc, eq, gte, inArray, isNull, lt, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { Db } from '../../infrastructure/database/connection';
import { llmUsageLog } from '../../infrastructure/database/schema';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { millicentsToUsd } from '../../domain/shared/money';
import type { Env } from '../../env';
import { usageDatabaseOf, usageRequestCount } from './usageLedger';
import { USAGE_KIND, type UsageSourceKind } from './usageSource';
import { coerceJsonObject } from '../../domain/shared/jsonColumn';

// ── Filter ────────────────────────────────────────────────────────────────────

/**
 * Whose rows. `platform` (every row) and `orphaned` (rows whose tenant was deleted —
 * `tenant_id` is ON DELETE SET NULL) exist only for the superadmin report; a tenant
 * surface must pass `tenant`, which is why scope is a required tagged value rather
 * than an optional tenant id that a forgotten argument would silently widen.
 */
export type UsageScope =
  | { kind: 'tenant'; tenantId: number }
  | { kind: 'platform' }
  | { kind: 'orphaned' };

export interface UsageFilter {
  scope: UsageScope;
  /** Inclusive lower bound of the window. */
  since: Date;
  /** Exclusive upper bound; omitted = up to now. */
  until?: Date;
  projectId?: number;
  /** Any of these projects — a portfolio / initiative rollup's project set. Empty
   *  means "none", not "all": a caller with no projects gets zero rows. */
  projectIds?: readonly number[];
  agentHostId?: number;
  tenantApiKeyId?: string;
  taskId?: number;
  executionId?: number;
  model?: string;
  userId?: string;
}

export const tenantScope = (tenantId: number): UsageScope => ({ kind: 'tenant', tenantId });

/** The ONE predicate every usage read is built from. */
export function usageWhere(f: UsageFilter): SQL {
  const parts: SQL[] = [gte(llmUsageLog.createdAt, f.since)];
  if (f.until) parts.push(lt(llmUsageLog.createdAt, f.until));
  if (f.scope.kind === 'tenant') parts.push(eq(llmUsageLog.tenantId, f.scope.tenantId));
  else if (f.scope.kind === 'orphaned') parts.push(isNull(llmUsageLog.tenantId));
  if (f.projectId != null) parts.push(eq(llmUsageLog.projectId, f.projectId));
  if (f.projectIds != null) parts.push(f.projectIds.length ? inArray(llmUsageLog.projectId, [...f.projectIds]) : sql`false`);
  if (f.agentHostId != null) parts.push(eq(llmUsageLog.agentHostId, f.agentHostId));
  if (f.tenantApiKeyId != null) parts.push(eq(llmUsageLog.tenantApiKeyId, f.tenantApiKeyId));
  if (f.taskId != null) parts.push(eq(llmUsageLog.taskId, f.taskId));
  if (f.executionId != null) parts.push(eq(llmUsageLog.executionId, f.executionId));
  if (f.model != null) parts.push(eq(llmUsageLog.model, f.model));
  if (f.userId != null) parts.push(eq(llmUsageLog.userId, f.userId));
  return and(...parts) as SQL;
}

// ── Windows ───────────────────────────────────────────────────────────────────

/** The named windows the dashboard and project spend pages offer (UTC). */
export type NamedUsageWindow = 'today' | 'week' | 'month';

/** Start of a named window: today = UTC midnight, week = the last 7 days incl.
 *  today, month = the 1st. Anything unrecognised reads as `today`, which is what
 *  both routes did with an unknown value before they shared this. */
export function namedWindowStart(window: string, now: Date = new Date()): Date {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  if (window === 'week') start.setUTCDate(start.getUTCDate() - 6);
  else if (window === 'month') start.setUTCDate(1);
  return start;
}

/**
 * Start of a rolling `days` window, floored to the minute. The floor is what lets a
 * rolling window be cached at all: an unfloored `now - N days` changes every
 * millisecond, so every request would mint a fresh key.
 */
export function rollingWindowStart(days: number, now: number = Date.now()): Date {
  const floored = Math.floor(now / 60_000) * 60_000;
  return new Date(floored - days * 86_400_000);
}

// ── Caching ───────────────────────────────────────────────────────────────────

/**
 * Read-through cache for a usage aggregate (KV 60s / L1 30s). The ledger is
 * append-only and written on every LLM call, so invalidate-on-write is impractical;
 * the short TTL bounds staleness instead. Keys carry a version so a shape change
 * never serves an old payload.
 */
export function cachedUsage<T>(env: Env | undefined, key: string, load: () => Promise<T>): Promise<T> {
  return getOrSetCached(env, `usage:v1:${key}`, load, { kvTtlSeconds: 60, l1TtlMs: 30_000 });
}

/** A stable cache-key fragment for a filter. */
export function usageFilterKey(f: UsageFilter): string {
  const scope = f.scope.kind === 'tenant' ? `t${f.scope.tenantId}` : f.scope.kind;
  return [
    scope, f.since.toISOString(), f.until?.toISOString() ?? '',
    f.projectId ?? '', f.projectIds?.join(',') ?? '', f.agentHostId ?? '', f.tenantApiKeyId ?? '', f.taskId ?? '',
    f.executionId ?? '', f.model ?? '', f.userId ?? '',
  ].join(':');
}

// ── Aggregates ────────────────────────────────────────────────────────────────

export interface UsageTotals {
  requests: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  costMc: number;
  /** Tokens served by the tenant's own credential (cost recorded as 0 by design). */
  byoTokens: number;
  retries: number;
  /** Calls that streamed — `SUM(calls)` over streamed rows, the same unit as `requests`. */
  streamedRequests: number;
}

/** ::bigint comes back as a STRING from the driver, ::int as a number — every
 *  aggregate is COALESCEd and cast so `Number()` normalises both. */
const aggregates = () => ({
  requests: usageRequestCount(),
  totalTokens: sql<string>`coalesce(sum(${llmUsageLog.totalTokens}), 0)::bigint`,
  promptTokens: sql<string>`coalesce(sum(${llmUsageLog.promptTokens}), 0)::bigint`,
  completionTokens: sql<string>`coalesce(sum(${llmUsageLog.completionTokens}), 0)::bigint`,
  costMc: sql<string>`coalesce(sum(${llmUsageLog.costUsdMillicents}), 0)::bigint`,
  byoTokens: sql<string>`coalesce(sum(case when ${llmUsageLog.byo} then ${llmUsageLog.totalTokens} else 0 end), 0)::bigint`,
  retries: sql<number>`coalesce(sum(${llmUsageLog.retries}), 0)::int`,
  streamedRequests: sql<number>`coalesce(sum(${llmUsageLog.calls}) filter (where ${llmUsageLog.streamed}), 0)::int`,
});

type RawTotals = { [K in keyof UsageTotals]: unknown };

function totalsOf(r: Partial<RawTotals> | undefined): UsageTotals {
  return {
    requests: Number(r?.requests ?? 0),
    totalTokens: Number(r?.totalTokens ?? 0),
    promptTokens: Number(r?.promptTokens ?? 0),
    completionTokens: Number(r?.completionTokens ?? 0),
    costMc: Number(r?.costMc ?? 0),
    byoTokens: Number(r?.byoTokens ?? 0),
    retries: Number(r?.retries ?? 0),
    streamedRequests: Number(r?.streamedRequests ?? 0),
  };
}

export const EMPTY_USAGE_TOTALS: UsageTotals = totalsOf(undefined);

/** Totals over the filter, plus how many distinct models served it — one statement. */
export async function readUsageTotals(db: Db, f: UsageFilter): Promise<UsageTotals & { modelCount: number }> {
  const [row] = await usageDatabaseOf(db)
    .select({ ...aggregates(), modelCount: sql<number>`count(distinct ${llmUsageLog.model})::int` })
    .from(llmUsageLog)
    .where(usageWhere(f));
  return { ...totalsOf(row), modelCount: Number(row?.modelCount ?? 0) };
}

/**
 * The group-by dimensions. Each names the columns it selects and, where the
 * dimension only means something for some rows (an agent host, a credential), the
 * predicate that restricts to those rows — so "per agent host" never grows a null
 * bucket that is really "not an agent host".
 */
const memberRefExpr = sql<string | null>`coalesce(${llmUsageLog.userId}, ${llmUsageLog.cloudAgentRef}, cast(${llmUsageLog.agentHostId} as text))`;
const dayExpr = sql<string>`to_char(date_trunc('day', ${llmUsageLog.createdAt}), 'YYYY-MM-DD')`;

const DIMENSIONS = {
  model: { keys: { model: llmUsageLog.model } },
  productModel: { keys: { llmProduct: llmUsageLog.llmProduct, model: llmUsageLog.model } },
  day: { keys: { day: dayExpr } },
  user: { keys: { userId: llmUsageLog.userId } },
  kind: { keys: { kind: USAGE_KIND } },
  agentHost: { keys: { agentHostId: llmUsageLog.agentHostId }, only: sql`${llmUsageLog.agentHostId} is not null` },
  project: { keys: { projectId: llmUsageLog.projectId }, only: sql`${llmUsageLog.projectId} is not null` },
  task: { keys: { taskId: llmUsageLog.taskId }, only: sql`${llmUsageLog.taskId} is not null` },
  memberRef: { keys: { memberRef: memberRefExpr }, only: sql`${memberRefExpr} is not null` },
  credential: {
    keys: {
      type: sql<'integration' | 'api_key'>`case when ${llmUsageLog.byoProvider} is not null then 'integration' else 'api_key' end`,
      id: sql<string>`coalesce(${llmUsageLog.byoProvider}, ${llmUsageLog.tenantApiKeyId}::text)`,
    },
    only: sql`(${llmUsageLog.byoProvider} is not null or ${llmUsageLog.tenantApiKeyId} is not null)`,
  },
} as const;

export interface UsageDimensionKeys {
  model: { model: string };
  productModel: { llmProduct: string; model: string };
  day: { day: string };
  user: { userId: string | null };
  kind: { kind: UsageSourceKind };
  agentHost: { agentHostId: number };
  project: { projectId: number };
  task: { taskId: number };
  memberRef: { memberRef: string };
  credential: { type: 'integration' | 'api_key'; id: string };
}

export type UsageDimension = keyof UsageDimensionKeys;
export type UsageGroup<D extends UsageDimension> = UsageDimensionKeys[D] & UsageTotals & { modelCount: number };

export interface UsageBreakdownOptions {
  /** Largest first by this measure; `key` = ascending by the dimension (a day series). */
  orderBy?: 'tokens' | 'cost' | 'requests' | 'key';
  limit?: number;
  /** Drop the null group (e.g. calls with no user) instead of reporting it. */
  skipNull?: boolean;
}

const ORDER: Record<Exclude<NonNullable<UsageBreakdownOptions['orderBy']>, 'key'>, SQL> = {
  tokens: sql`sum(${llmUsageLog.totalTokens}) desc nulls last`,
  cost: sql`sum(${llmUsageLog.costUsdMillicents}) desc nulls last`,
  requests: sql`sum(${llmUsageLog.calls}) desc nulls last`,
};

/** One grouped aggregate over the filter. */
export async function readUsageBreakdown<D extends UsageDimension>(
  db: Db,
  f: UsageFilter,
  dimension: D,
  opts: UsageBreakdownOptions = {},
): Promise<Array<UsageGroup<D>>> {
  const dim: { keys: Record<string, SQL | AnyPgColumn>; only?: SQL } = DIMENSIONS[dimension];
  const keyCols = Object.values(dim.keys);
  const where = [usageWhere(f)];
  if (dim.only) where.push(dim.only);
  if (opts.skipNull) for (const col of keyCols) where.push(sql`${col} is not null`);

  const order = opts.orderBy ?? 'tokens';
  const query = usageDatabaseOf(db)
    .select({ ...dim.keys, ...aggregates(), modelCount: sql<number>`count(distinct ${llmUsageLog.model})::int` })
    .from(llmUsageLog)
    .where(and(...where))
    .groupBy(...keyCols)
    .orderBy(...(order === 'key' ? keyCols.map((c) => asc(c)) : [ORDER[order]]));
  const rows = (opts.limit != null ? await query.limit(opts.limit) : await query) as Array<Record<string, unknown>>;

  return rows.map((r) => {
    const keys: Record<string, unknown> = {};
    for (const k of Object.keys(dim.keys)) keys[k] = r[k];
    return { ...keys, ...totalsOf(r as Partial<RawTotals>), modelCount: Number(r.modelCount ?? 0) } as unknown as UsageGroup<D>;
  });
}

// ── Row listing ───────────────────────────────────────────────────────────────

export interface UsageLedgerRow {
  id: number;
  createdAt: string;
  userId: string | null;
  llmProduct: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  retries: number;
  streamed: boolean;
  useCase: string | null;
  metadata: Record<string, unknown> | null;
  idempotencyKey: string | null;
}

/**
 * The pageable per-call ledger, newest first, for reconciliation against a caller's
 * own records. `total` counts ROWS, not calls, deliberately: it is the page total for
 * this listing, and paging by call count would ask for records that do not exist (a
 * folded row is one row on the page however many calls it stands for).
 */
export async function readUsageRows(
  db: Db,
  f: UsageFilter,
  page: { limit: number; page: number },
): Promise<{ total: number; rows: UsageLedgerRow[] }> {
  const usageDb = usageDatabaseOf(db);
  const where = usageWhere(f);
  const [rows, [count]] = await Promise.all([
    usageDb
      .select({
        id: llmUsageLog.id,
        createdAt: llmUsageLog.createdAt,
        userId: llmUsageLog.userId,
        llmProduct: llmUsageLog.llmProduct,
        model: llmUsageLog.model,
        promptTokens: llmUsageLog.promptTokens,
        completionTokens: llmUsageLog.completionTokens,
        totalTokens: llmUsageLog.totalTokens,
        retries: llmUsageLog.retries,
        streamed: llmUsageLog.streamed,
        useCase: llmUsageLog.useCase,
        metadata: llmUsageLog.metadata,
        idempotencyKey: llmUsageLog.idempotencyKey,
      })
      .from(llmUsageLog)
      .where(where)
      .orderBy(desc(llmUsageLog.createdAt))
      .limit(page.limit)
      .offset((page.page - 1) * page.limit),
    usageDb.select({
      // usage-count-ok: rows, not calls, is the right unit for a page total.
      total: sql<number>`count(*)::int`,
    }).from(llmUsageLog).where(where),
  ]);
  return {
    total: Number(count?.total ?? 0),
    rows: rows.map((r) => ({
      ...r,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
      // jsonb comes back parsed, but rows written before the column became jsonb can
      // still surface as a string; the ONE shared coercer handles both. Null stays
      // null: an absent metadata blob is not an empty one.
      metadata: r.metadata == null ? null : coerceJsonObject(r.metadata),
    })),
  };
}

// ── Spend summaries (ticket / run) ────────────────────────────────────────────

export interface UsageCostSummary {
  estimatedCostUsd: number;
  totalTokens: number;
  requests: number;
}

export const EMPTY_USAGE_COST: UsageCostSummary = { estimatedCostUsd: 0, totalTokens: 0, requests: 0 };

/** Spend over all time for one attribution id — the ticket and run grains. */
async function costOf(env: Env | undefined, db: Db, f: UsageFilter): Promise<UsageCostSummary> {
  return cachedUsage(env, `cost:${usageFilterKey(f)}`, async () => {
    const t = await readUsageTotals(db, f);
    return { estimatedCostUsd: millicentsToUsd(t.costMc), totalTokens: t.totalTokens, requests: t.requests };
  });
}

/** The ledger's first possible row — the `since` for an all-time attribution read
 *  (a ticket's, a run's, a project's lifetime spend). */
export const ALL_TIME = new Date(0);

/** Ticket-level spend: the finest grain in the ticket → project → account rollup (0104). */
export function taskUsageCost(env: Env | undefined, db: Db, tenantId: number, taskId: number): Promise<UsageCostSummary> {
  if (!Number.isFinite(taskId)) return Promise.resolve(EMPTY_USAGE_COST);
  return costOf(env, db, { scope: tenantScope(tenantId), since: ALL_TIME, taskId });
}

/** Run-level spend: every usage row stamped with this `execution_id` (0096). */
export function executionUsageCost(env: Env | undefined, db: Db, tenantId: number, executionId: number): Promise<UsageCostSummary> {
  if (!Number.isFinite(executionId)) return Promise.resolve(EMPTY_USAGE_COST);
  return costOf(env, db, { scope: tenantScope(tenantId), since: ALL_TIME, executionId });
}
