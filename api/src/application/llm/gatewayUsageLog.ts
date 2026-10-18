/**
 * Gateway ledger writes and reads — the failover log, provider auth alerts, the
 * usage-row write, and the small per-tenant `llm_usage_log` reads the gateway
 * routes gate on (overflow spend today, an Idempotency-Key's prior row, BYO usage
 * per provider).
 *
 * Carved out of `presentation/routes/llmRoutes.ts`, which built databases and ran
 * these statements inline in the presentation layer.
 */
import { and, eq, gte, sql } from 'drizzle-orm';
import type { Env } from '../../env';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { getTenantUsageTotalsForEnv } from './tokenUsage';
import { recordUsageRow, resolvePaidOverflowCapMillicents, usageRequestCountSql, type RecordUsageRow } from './usageLedger';
import { raiseProviderAuthAlertsFromFailovers } from './byoCredentialAlerting';
import { USAGE_WINDOW_DAYS } from './openRouterConnectionService';
import type { FailoverEvent } from './LlmProxyService';
import type { TenantAccess } from './gatewayAccess';
import { buildDatabase, buildTransactionalDatabase } from '../../infrastructure/database/connection';
import { llmUsageLog, llmFailoverLog } from '../../infrastructure/database/schema';

/**
 * Bulk-insert failover events into `llm_failover_log`, fire-and-forget.
 *
 * Accepts the minimal shape shared by the chat (`FailoverEvent`) and image
 * (`ImageFailoverEvent`) surfaces. Since 0946 the row carries the three facts that
 * make the log answerable rather than merely voluminous:
 *   • `tenantId`  — WHOSE cascade. Null for guest/unauthenticated traffic, which
 *     genuinely has no tenant; inventing one would be worse than a null.
 *   • `kind`      — the failure CLASS the dispatcher already computed. `auth` is the
 *     class provider alerts derive from, and without it an expired credential and a
 *     saturated free tier are indistinguishable rows.
 *   • `requestId` — the gateway trace id, shared by every attempt of one cascade, so
 *     a four-attempt failover is a GROUP BY instead of a guess from timestamps.
 * The `vendor` label still rides along on the typed event without being written: it
 * is derivable from `model` (`vendorForModel`), so storing it would be a second copy
 * of a fact that can go stale.
 */
export function logFailovers(
  env: Env,
  ctx: ExecutionContext,
  failovers: ReadonlyArray<{ model: string; code: number; kind?: string }>,
  attribution?: { tenantId?: number | null; requestId?: string | null },
): void {
  if (failovers.length === 0) return;
  ctx.waitUntil(
    buildTransactionalDatabase(env)
      .insert(llmFailoverLog)
      .values(failovers.map(f => ({
        model: f.model,
        errorCode: f.code,
        tenantId: attribution?.tenantId ?? null,
        kind: f.kind ?? null,
        requestId: attribution?.requestId ?? null,
      })))
      .catch((error) => { /* never let logging fail the request */
        reportCaughtError(error, { source: 'application/llm/gatewayUsageLog.ts', operation: 'logFailovers' });
      }),
  );
}

/**
 * Record any AUTH-class failover as a per-tenant "reconnect this account" alert AND
 * email the workspace's admins the first time it breaks — fire-and-forget alongside
 * {@link logFailovers}.
 *
 * This is the seam that makes a rejected BYO credential VISIBLE. The cascade
 * already handles it correctly — cool the vendor, fail over, succeed elsewhere —
 * which is exactly why nothing ever reached the operator: the request looks fine
 * and `llm_failover_log` persists only `model` + `errorCode` (no tenant, no kind),
 * so the signal died at the DB boundary. Writing it here, where tenant identity is
 * in scope and the typed `FailoverEvent` still carries its `detail`, is the last
 * point at which the alert can be attributed to the account that needs fixing.
 *
 * Notification lives in `raiseProviderAuthAlertsFromFailovers` rather than here so a
 * mid-day breakage observed by a LIVE RUN reaches the owner immediately, on exactly the
 * same transition rule the daily sweep uses — instead of waiting up to 24h for the next
 * sweep to rediscover it. `authAlertsFromFailovers` no-ops for a cascade with no
 * owner-actionable failure, so the common path costs one array scan and zero writes.
 */
export function logProviderAuthAlerts(
  env: Env,
  ctx: ExecutionContext | undefined,
  tenantId: number,
  failovers: ReadonlyArray<FailoverEvent>,
): void {
  if (failovers.length === 0) return;
  const promise = raiseProviderAuthAlertsFromFailovers(env, tenantId, failovers)
    .catch((error) => { /* advisory — never let alerting fail the request */
      reportCaughtError(error, { source: 'application/llm/gatewayUsageLog.ts', operation: 'logProviderAuthAlerts' });
    });
  if (ctx) ctx.waitUntil(promise); else void promise;
}

/**
 * Write one row to llm_usage_log, fire-and-forget via ctx.waitUntil.
 * `llmProduct` accepts any product label — chat (`builderforceLLM*`) or image
 * (`builderforceImage*`) — since the DB column is `varchar(32)` and this function is
 * the single insert site shared by both surfaces.
 *
 * Takes the RecordUsageRow object directly (named fields) — was 14 positional params,
 * refactored to an options object so adding fields like `traceId` [1299] can't
 * silently misalign a call site (tsc checks each named field).
 */
export function logUsage(
  env: Env,
  ctx: ExecutionContext,
  row: RecordUsageRow,
): void {
  ctx.waitUntil(recordUsageRow(buildDatabase(env), env, row));
}

/**
 * Decide whether to close the funded paid-overflow path for this tenant — true
 * once today's overflow spend (premium-fallback / backstop calls on our keys)
 * has reached the tenant's daily cap. When true the proxy keeps serving the
 * tenant's PRIMARY pool but won't fall through to a model we fund, putting a
 * hard ceiling on overflow cost (migration 0130). Superadmins and unlimited
 * caps (-1) are never disabled. Best-effort: a query error fails OPEN (the
 * reliability backstop matters more than a perfectly precise cap).
 */
export async function isPaidOverflowExhausted(
  env: Env,
  access: Pick<TenantAccess, 'isSuperadmin' | 'paidOverflowDailyCap' | 'effectivePlan' | 'tenantId'>,
): Promise<boolean> {
  if (access.isSuperadmin) return false;
  const cap = resolvePaidOverflowCapMillicents(access.paidOverflowDailyCap, access.effectivePlan);
  if (cap < 0) return false; // unlimited
  try {
    // Shared per-tenant cached totals (see tokenUsage) — not a SUM per request.
    const totals = await getTenantUsageTotalsForEnv(env, access.tenantId);
    return Math.max(0, totals.paidOverflowMillicents) >= cap;
  } catch {
    return false; // fail open — never let the cap query break a request
  }
}

/**
 * The usage row an Idempotency-Key already wrote in the last ten minutes, if any —
 * the DB no-op guard behind the gateway's 409 when no cached body can be replayed.
 */
export async function findRecentIdempotentUsage(
  env: Env,
  tenantId: number,
  idempotencyKey: string,
) {
  const tenMinAgo = new Date(Date.now() - 10 * 60_000);
  const db = buildTransactionalDatabase(env);
  const [prior] = await db
    .select({ id: llmUsageLog.id, createdAt: llmUsageLog.createdAt })
    .from(llmUsageLog)
    .where(
      and(
        eq(llmUsageLog.tenantId, tenantId),
        eq(llmUsageLog.idempotencyKey, idempotencyKey),
        gte(llmUsageLog.createdAt, tenMinAgo),
      ),
    )
    .limit(1);
  return prior;
}

/** One provider's BYO usage over a trailing window, as the provider cards show it. */
export interface ByoProviderUsage {
  periodDays: number;
  requests: number;
  tokens: number;
  lastUsedAt: unknown;
}

/**
 * BYO usage for every provider the tenant served calls on over the trailing
 * {@link USAGE_WINDOW_DAYS}, keyed by provider. Advisory: a failed read is an empty
 * map, never a failed list.
 */
export async function byoUsageByProvider(env: Env, tenantId: number): Promise<Map<string, ByoProviderUsage>> {
  const db = buildTransactionalDatabase(env);
  const usageResult = await db.execute(sql`
    SELECT byo_provider AS provider,
           ${sql.raw(usageRequestCountSql())} AS requests,
           COALESCE(SUM(total_tokens), 0)::bigint AS tokens,
           MAX(created_at) AS last_used_at
    FROM llm_usage_log
    WHERE tenant_id = ${tenantId}
      AND byo = true
      AND byo_provider IS NOT NULL
      AND created_at >= NOW() - (${USAGE_WINDOW_DAYS} || ' days')::interval
    GROUP BY byo_provider
  `).catch(() => ({ rows: [] }));
  return new Map(
    (usageResult.rows as Array<Record<string, unknown>>).map((row) => [String(row.provider), {
      periodDays: USAGE_WINDOW_DAYS,
      requests: Number(row.requests ?? 0),
      tokens: Number(row.tokens ?? 0),
      lastUsedAt: row.last_used_at ?? null,
    }]),
  );
}

/** One provider's BYO usage over the last 30 days, for the provider details drawer. */
export async function byoProviderUsage30d(env: Env, tenantId: number, provider: string): Promise<ByoProviderUsage> {
  const db = buildTransactionalDatabase(env);
  const usage = await db.execute(sql`
    SELECT ${sql.raw(usageRequestCountSql())} AS requests,
           COALESCE(SUM(total_tokens), 0)::bigint AS tokens,
           MAX(created_at) AS last_used_at
    FROM llm_usage_log
    WHERE tenant_id = ${tenantId}
      AND byo = true
      AND byo_provider = ${provider}
      AND created_at >= NOW() - interval '30 days'
  `);
  const row = (usage.rows?.[0] ?? {}) as Record<string, unknown>;
  return { periodDays: 30, requests: Number(row.requests ?? 0), tokens: Number(row.tokens ?? 0), lastUsedAt: row.last_used_at ?? null };
}
