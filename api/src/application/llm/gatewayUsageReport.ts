/**
 * Tenant LLM consumption report — the reads behind `GET /llm/v1/usage`.
 *
 * Carved out of `presentation/routes/llmRoutes.ts`, which ran every one of these
 * statements inline. Every figure is read from the database that owns the usage
 * ledger (`resolveUsageDatabase` — the operational one in production); only the
 * API-key NAMES come from the core database, since the two live in different Neon
 * accounts and cannot be one JOIN.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Env } from '../../env';
import type { DbHandle } from '../shared/dbHandle';
import { resolveUsageDatabase, usageRequestCountSql } from './usageLedger';
import { USAGE_KIND } from './usageSource';
import { tenantApiKeys } from '../../infrastructure/database/schema';

/**
 * Detail mode — row-level pageable per-call ledger for reconciliation against the
 * caller's own usage table. Same tenant scoping as the summary.
 */
export async function tenantUsageDetail(
  env: Env,
  core: DbHandle,
  tenantId: number,
  opts: { days: number; limit: number; page: number },
) {
  const db = resolveUsageDatabase(env, core);
  const { days, limit, page } = opts;
  const offset = (page - 1) * limit;

  const rows = await db.execute(sql`
    SELECT
      id,
      created_at::text  AS "createdAt",
      user_id           AS "userId",
      llm_product       AS "llmProduct",
      model,
      prompt_tokens     AS "promptTokens",
      completion_tokens AS "completionTokens",
      total_tokens      AS "totalTokens",
      retries,
      streamed,
      use_case          AS "useCase",
      metadata,
      idempotency_key   AS "idempotencyKey"
    FROM llm_usage_log
    WHERE tenant_id = ${tenantId}
      AND created_at >= NOW() - (${days} || ' days')::interval
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `);

  // COUNT(*) here and NOT `usageRequestCountSql()`, deliberately: this is the page
  // count for the ROW LISTING above, so it has to count rows the way LIMIT/OFFSET
  // walks them. A folded row is one row on this page however many calls it stands
  // for, and paging by call count would ask for records that do not exist.
  const [count] = (await db.execute(sql`
    -- usage-count-ok: rows, not calls, is the right unit for a page total.
    SELECT COUNT(*)::int AS total
    FROM llm_usage_log
    WHERE tenant_id = ${tenantId}
      AND created_at >= NOW() - (${days} || ' days')::interval
  `)).rows as Array<{ total: number }>;

  // Parse JSON metadata column for caller convenience.
  const parsed = (rows.rows as Array<{ metadata?: string | null } & Record<string, unknown>>).map((r) => {
    const md = r.metadata ?? null;
    const out: Record<string, unknown> = { ...r };
    if (md != null) {
      try { out.metadata = JSON.parse(md as string); } catch { out.metadata = md; }
    }
    return out;
  });

  return { days, page, limit, total: Number(count?.total ?? 0), rows: parsed };
}

type TotalsRow = {
  requests: number;
  total_tokens: bigint;
  prompt_tokens: bigint;
  completion_tokens: bigint;
};

/** The aggregate breakdowns (model / day / user / source / credential) plus totals. */
export async function tenantUsageSummary(
  env: Env,
  core: DbHandle,
  tenantId: number,
  userId: string | null,
  days: number,
) {
  const db = resolveUsageDatabase(env, core);

  const byModel = await db.execute(sql`
    SELECT
      llm_product AS "llmProduct",
      model,
      ${sql.raw(usageRequestCountSql())} AS requests,
      SUM(prompt_tokens)::bigint       AS prompt_tokens,
      SUM(completion_tokens)::bigint   AS completion_tokens,
      SUM(total_tokens)::bigint        AS total_tokens,
      SUM(retries)::int                AS retries
    FROM llm_usage_log
    WHERE tenant_id = ${tenantId}
      AND created_at >= NOW() - (${days} || ' days')::interval
    GROUP BY llm_product, model
    ORDER BY requests DESC
  `);

  const byDay = await db.execute(sql`
    SELECT
      DATE_TRUNC('day', created_at)::date::text AS day,
      ${sql.raw(usageRequestCountSql())}                                       AS requests,
      SUM(total_tokens)::bigint                 AS total_tokens
    FROM llm_usage_log
    WHERE tenant_id = ${tenantId}
      AND created_at >= NOW() - (${days} || ' days')::interval
    GROUP BY DATE_TRUNC('day', created_at)
    ORDER BY DATE_TRUNC('day', created_at)
  `);

  const byUser = await db.execute(sql`
    SELECT
      COALESCE(user_id, 'agentHost-runtime') AS user_id,
      ${sql.raw(usageRequestCountSql())}                               AS requests,
      SUM(total_tokens)::bigint         AS total_tokens
    FROM llm_usage_log
    WHERE tenant_id = ${tenantId}
      AND created_at >= NOW() - (${days} || ' days')::interval
    GROUP BY COALESCE(user_id, 'agentHost-runtime')
    ORDER BY requests DESC
    LIMIT 25
  `);

  // Source split (cloud / on-prem / web) — the gateway's `/v1/usage` can now
  // break consumption down by who produced it, not just per-model/per-user.
  // Uses the SAME classifier the dashboard does (shared USAGE_KIND, 0096 cols).
  const bySource = await db.execute(sql`
    SELECT
      ${USAGE_KIND}                  AS source,
      ${sql.raw(usageRequestCountSql())} AS requests,
      SUM(prompt_tokens)::bigint     AS prompt_tokens,
      SUM(completion_tokens)::bigint AS completion_tokens,
      SUM(total_tokens)::bigint      AS total_tokens
    FROM llm_usage_log
    WHERE tenant_id = ${tenantId}
      AND created_at >= NOW() - (${days} || ' days')::interval
    GROUP BY ${USAGE_KIND}
    ORDER BY total_tokens DESC NULLS LAST
  `);

  // Credential attribution is independent of model attribution: a single BYO
  // integration or bfk_* API key may consume several models in this window.
  // Aggregated on the ledger's database, then named from the core `tenant_api_keys`
  // (the two are in different Neon accounts, so this cannot be one JOIN).
  const credentialRows = (await db.execute(sql`
    SELECT
      CASE WHEN byo_provider IS NOT NULL THEN 'integration' ELSE 'api_key' END AS "type",
      COALESCE(byo_provider, tenant_api_key_id::text) AS "id",
      ${sql.raw(usageRequestCountSql())} AS requests,
      COUNT(DISTINCT model)::int AS "modelCount",
      SUM(total_tokens)::bigint AS tokens
    FROM llm_usage_log
    WHERE tenant_id = ${tenantId}
      AND created_at >= NOW() - (${days} || ' days')::interval
      AND (byo_provider IS NOT NULL OR tenant_api_key_id IS NOT NULL)
    GROUP BY 1, 2
    ORDER BY tokens DESC NULLS LAST
  `)).rows as Array<{ type: 'integration' | 'api_key'; id: string; requests: number; modelCount: number; tokens: unknown }>;
  const keyIds = credentialRows.flatMap((r) => (r.type === 'api_key' ? [r.id] : []));
  const keyNames = new Map(keyIds.length === 0 ? [] : (await core
    .select({ id: tenantApiKeys.id, name: tenantApiKeys.name })
    .from(tenantApiKeys)
    .where(and(eq(tenantApiKeys.tenantId, tenantId), inArray(tenantApiKeys.id, keyIds))))
    .map((k) => [k.id, k.name] as const));
  const byCredential = credentialRows.map((r) => ({
    type: r.type,
    id: r.id,
    name: r.type === 'integration' ? r.id : keyNames.get(r.id) ?? 'Unnamed API key',
    requests: r.requests,
    modelCount: r.modelCount,
    tokens: r.tokens,
  }));

  const [totals] = (await db.execute(sql`
    SELECT
      ${sql.raw(usageRequestCountSql())} AS requests,
      SUM(total_tokens)::bigint      AS total_tokens,
      SUM(prompt_tokens)::bigint     AS prompt_tokens,
      SUM(completion_tokens)::bigint AS completion_tokens
    FROM llm_usage_log
    WHERE tenant_id = ${tenantId}
      AND created_at >= NOW() - (${days} || ' days')::interval
  `)).rows as TotalsRow[];

  const [mine] = userId
    ? (await db.execute(sql`
        SELECT
          ${sql.raw(usageRequestCountSql())} AS requests,
          SUM(total_tokens)::bigint      AS total_tokens,
          SUM(prompt_tokens)::bigint     AS prompt_tokens,
          SUM(completion_tokens)::bigint AS completion_tokens
        FROM llm_usage_log
        WHERE tenant_id = ${tenantId}
          AND user_id = ${userId}
          AND created_at >= NOW() - (${days} || ' days')::interval
      `)).rows as TotalsRow[]
    : [{ requests: 0, total_tokens: 0n, prompt_tokens: 0n, completion_tokens: 0n }];

  return {
    totals: {
      requests: Number(totals?.requests ?? 0),
      totalTokens: Number(totals?.total_tokens ?? 0),
      promptTokens: Number(totals?.prompt_tokens ?? 0),
      completionTokens: Number(totals?.completion_tokens ?? 0),
    },
    mine: {
      userId,
      requests: Number(mine?.requests ?? 0),
      totalTokens: Number(mine?.total_tokens ?? 0),
      promptTokens: Number(mine?.prompt_tokens ?? 0),
      completionTokens: Number(mine?.completion_tokens ?? 0),
    },
    byModel: byModel.rows,
    byCredential,
    byDay: byDay.rows,
    byUser: byUser.rows,
    bySource: bySource.rows,
  };
}
