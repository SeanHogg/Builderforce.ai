/**
 * The usage REPORTS — each public usage surface's response shape, built on the ONE
 * usage query use case (`usageQuery.ts`). A report owns only its shape; every
 * figure comes from `readUsageTotals` / `readUsageBreakdown` / `readUsageRows`, so
 * two reports can disagree only when their filters do.
 *
 *   tenantUsageSummary / tenantUsageDetail → GET /llm/v1/usage (public SDK contract)
 *   platformUsageReport                    → GET /api/admin/llm-usage (superadmin)
 *   projectSpend                           → GET /api/projects/:id/spend
 *
 * Replaces `gatewayUsageReport.ts`, which ran nine hand-written statements for the
 * gateway alone while the admin page and the project page each wrote their own.
 *
 * The snake_case keys in the gateway and admin shapes are the published contract
 * (`@builderforce/sdk` UsageByModel, the admin `LlmModelStat`) and are kept verbatim;
 * the values are now numbers throughout, where the raw `::bigint` reads used to send
 * numeric strings — every client already coerced with `Number()`.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Env } from '../../env';
import type { DbHandle } from '../shared/dbHandle';
import { tenantApiKeys } from '../../infrastructure/database/schema';
import { millicentsToUsd } from '../../domain/shared/money';
import { usageDatabaseOf } from './usageLedger';
import { vendorForModel } from './vendors';
import {
  cachedUsage,
  EMPTY_USAGE_TOTALS,
  readUsageBreakdown,
  readUsageRows,
  readUsageTotals,
  rollingWindowStart,
  tenantScope,
  usageFilterKey,
  type UsageFilter,
  type UsageTotals,
} from './usageQuery';

const tokenTotals = (t: UsageTotals) => ({
  requests: t.requests,
  totalTokens: t.totalTokens,
  promptTokens: t.promptTokens,
  completionTokens: t.completionTokens,
});

// ── GET /llm/v1/usage ─────────────────────────────────────────────────────────

/** Detail mode — the row-level pageable per-call ledger. */
export async function tenantUsageDetail(
  core: DbHandle,
  tenantId: number,
  opts: { days: number; limit: number; page: number },
) {
  const { days, limit, page } = opts;
  const listing = await readUsageRows(core, { scope: tenantScope(tenantId), since: rollingWindowStart(days) }, { limit, page });
  return { days, page, limit, total: listing.total, rows: listing.rows };
}

/** The aggregate breakdowns (model / day / user / source / credential) plus totals. */
export function tenantUsageSummary(
  env: Env | undefined,
  core: DbHandle,
  tenantId: number,
  userId: string | null,
  days: number,
) {
  const f: UsageFilter = { scope: tenantScope(tenantId), since: rollingWindowStart(days) };
  // Keyed by caller as well as filter: `mine` is per user.
  return cachedUsage(env, `gateway:${usageFilterKey(f)}:${userId ?? ''}`, async () => {
    const [totals, mine, byModel, byDay, byUser, bySource, byCredentialRaw] = await Promise.all([
      readUsageTotals(core, f),
      userId ? readUsageTotals(core, { ...f, userId }) : null,
      readUsageBreakdown(core, f, 'productModel', { orderBy: 'requests' }),
      readUsageBreakdown(core, f, 'day', { orderBy: 'key' }),
      readUsageBreakdown(core, f, 'user', { orderBy: 'requests', limit: 25 }),
      readUsageBreakdown(core, f, 'kind', { orderBy: 'tokens' }),
      // Credential attribution is independent of model attribution: a single BYO
      // integration or bfk_* key may consume several models in this window.
      readUsageBreakdown(core, f, 'credential', { orderBy: 'tokens' }),
    ]);

    // Key NAMES live in the core `tenant_api_keys`; the ledger is in a different Neon
    // account, so this is a second read, not a JOIN.
    const keyIds = byCredentialRaw.flatMap((r) => (r.type === 'api_key' ? [r.id] : []));
    const keyNames = new Map(keyIds.length === 0 ? [] : (await core
      .select({ id: tenantApiKeys.id, name: tenantApiKeys.name })
      .from(tenantApiKeys)
      .where(and(eq(tenantApiKeys.tenantId, tenantId), inArray(tenantApiKeys.id, keyIds))))
      .map((k) => [k.id, k.name] as const));

    return {
      totals: tokenTotals(totals),
      mine: { userId, ...tokenTotals(mine ?? EMPTY_USAGE_TOTALS) },
      byModel: byModel.map((m) => ({
        llmProduct: m.llmProduct,
        model: m.model,
        requests: m.requests,
        prompt_tokens: m.promptTokens,
        completion_tokens: m.completionTokens,
        total_tokens: m.totalTokens,
        retries: m.retries,
      })),
      byCredential: byCredentialRaw.map((r) => ({
        type: r.type,
        id: r.id,
        name: r.type === 'integration' ? r.id : keyNames.get(r.id) ?? 'Unnamed API key',
        requests: r.requests,
        modelCount: r.modelCount,
        tokens: r.totalTokens,
      })),
      byDay: byDay.map((d) => ({ day: d.day, requests: d.requests, total_tokens: d.totalTokens })),
      // A null user is a fully autonomous agent-host call; the contract names that bucket.
      byUser: byUser.map((u) => ({ user_id: u.userId ?? 'agentHost-runtime', requests: u.requests, total_tokens: u.totalTokens })),
      bySource: bySource.map((s) => ({
        source: s.kind,
        requests: s.requests,
        prompt_tokens: s.promptTokens,
        completion_tokens: s.completionTokens,
        total_tokens: s.totalTokens,
      })),
    };
  });
}

// ── GET /api/admin/llm-usage ──────────────────────────────────────────────────

/**
 * The platform-wide report. Same aggregates as the tenant report with the scope
 * widened, plus the two things only an operator needs:
 *
 *   • ORPHANED rows — `tenant_id` is ON DELETE SET NULL, so usage survives tenant
 *     deletion but matches no tenant filter. Reporting that bucket makes the
 *     platform total reconcile BY CONSTRUCTION: platform = Σ(tenants) + orphaned.
 *     Deleting the rows would destroy the record of spend; hiding them would keep
 *     the discrepancy.
 *   • failovers — `llm_failover_log`, which lives beside the ledger.
 */
export function platformUsageReport(env: Env | undefined, core: DbHandle, days: number) {
  const since = rollingWindowStart(days);
  const f: UsageFilter = { scope: { kind: 'platform' }, since };
  return cachedUsage(env, `platform:${usageFilterKey(f)}`, async () => {
    const [totals, orphaned, byModel, daily, failovers] = await Promise.all([
      readUsageTotals(core, f),
      readUsageTotals(core, { scope: { kind: 'orphaned' }, since }),
      readUsageBreakdown(core, f, 'model', { orderBy: 'requests' }),
      readUsageBreakdown(core, f, 'day', { orderBy: 'key' }),
      usageDatabaseOf(core).execute(sql`
        SELECT model, error_code AS "errorCode", COUNT(*)::int AS count
        FROM llm_failover_log
        WHERE created_at >= ${since}
        GROUP BY model, error_code
        ORDER BY count DESC
      `),
    ]);
    // `vendor` is enriched here so the admin UI can group by vendor without
    // re-deriving prefix→vendor mappings client-side.
    return {
      days,
      totals: { ...tokenTotals(totals), modelCount: totals.modelCount },
      /** Usage whose tenant was deleted. Counted in `totals` and in NO tenant's view. */
      orphaned: { requests: orphaned.requests, totalTokens: orphaned.totalTokens, costMillicents: orphaned.costMc },
      byModel: byModel.map((m) => ({
        model: m.model,
        vendor: vendorForModel(m.model),
        requests: m.requests,
        prompt_tokens: m.promptTokens,
        completion_tokens: m.completionTokens,
        total_tokens: m.totalTokens,
        retries: m.retries,
        streamed_requests: m.streamedRequests,
      })),
      daily: daily.map((d) => ({ day: d.day, requests: d.requests, total_tokens: d.totalTokens })),
      failovers: (failovers.rows as Array<{ model: string; errorCode: number; count: number }>)
        .map((r) => ({ ...r, vendor: vendorForModel(r.model) })),
    };
  });
}

// ── GET /api/projects/:id/spend ───────────────────────────────────────────────

/**
 * One project's spend over a window — the scoped answer to "what has this board
 * cost me" that `/api/dashboard/usage` only gives as one row of an account-wide
 * payload. BYO rows record cost 0 by design (the tenant's own account paid), so
 * `costUsd` is platform-funded spend and `byoTokens` reports the rest separately
 * rather than letting a BYO-heavy project look free.
 */
export function projectSpend(env: Env | undefined, core: DbHandle, tenantId: number, projectId: number, since: Date) {
  const f: UsageFilter = { scope: tenantScope(tenantId), since, projectId };
  return cachedUsage(env, `project-spend:${usageFilterKey(f)}`, async () => {
    const [totals, topModels] = await Promise.all([
      readUsageTotals(core, f),
      readUsageBreakdown(core, f, 'model', { orderBy: 'cost', limit: 5 }),
    ]);
    return {
      totalTokens: totals.totalTokens,
      byoTokens: totals.byoTokens,
      requests: totals.requests,
      costUsd: millicentsToUsd(totals.costMc),
      topModels: topModels.map((m) => ({ model: m.model, totalTokens: m.totalTokens, costUsd: millicentsToUsd(m.costMc) })),
    };
  });
}
