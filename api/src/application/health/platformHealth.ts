/**
 * THE health / probe use case — every "is the platform OK" read, as named SECTIONS a
 * route selects. Five endpoints used to answer overlapping parts of that question
 * with their own copies (admin `/health` and `/llm/v1/health` both resolved LLM pool
 * status; admin `/health` and `/system-health` both counted hosts and executions;
 * the database ping lived in one handler and the database inspection in another).
 *
 *   GET /health                    → none: a static liveness answer, deliberately NO
 *                                    I/O, so an uptime check never wakes a database.
 *   GET /llm/v1/health             → planPools            (public, any caller)
 *   GET /api/admin/health          → database, platform, operatorPools
 *   GET /api/admin/system-health   → worker, runtime, databases
 *   GET /api/admin/llm-health      → vendorProbes
 *
 * Each section is independent and failure-contained: one that cannot be read
 * reports itself degraded rather than failing the whole report.
 */
import { sql } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { buildTransactionalDatabase } from '../../infrastructure/database/connection';
import {
  adminPoolProxy,
  llmProxyForPlan,
  FREE_MODEL_POOL,
  PRO_MODEL_POOL,
  PRO_PAID_MODEL_POOL,
  PREMIUM_FALLBACK_MODELS,
} from '../llm/LlmProxyService';
import { FREE_IMAGE_MODEL_POOL, PAID_IMAGE_MODEL_POOL } from '../llm/ImageProxyService';
import { storageCeilingBytes, tierFor } from '../maintenance/storagePressure';
import { screenshotConfigured } from '../web/webScreenshot';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { parseJsonArray } from '../../domain/shared/json';
import { API_VERSION } from '../../version';

const SOURCE = 'application/health/platformHealth.ts';

// ── database: a round-trip ping on the core database ──────────────────────────

export async function databaseSection(db: Db): Promise<{ ok: boolean; latencyMs: number }> {
  const t0 = Date.now();
  try {
    await db.execute(sql`SELECT 1`);
    return { ok: true, latencyMs: Date.now() - t0 };
  } catch (error) {
    reportCaughtError(error, { source: SOURCE, operation: 'databaseSection' });
    return { ok: false, latencyMs: 0 };
  }
}

// ── platform: whole-platform counts for the operator ──────────────────────────

export async function platformSection(db: Db, env: Env) {
  const [counts] = (await db.execute(sql`
    SELECT
      (SELECT COUNT(*)::int FROM users)       AS "userCount",
      (SELECT COUNT(*)::int FROM tenants)     AS "tenantCount",
      (SELECT COUNT(*)::int FROM agent_hosts) AS "agentHostCount",
      (SELECT COUNT(*)::int FROM executions)  AS "executionCount",
      (SELECT COUNT(*)::int FROM tenants WHERE plan = 'pro' AND billing_status = 'active') AS "paidTenantCount"
  `)).rows as Array<{
    userCount: number; tenantCount: number; agentHostCount: number;
    executionCount: number; paidTenantCount: number;
  }>;

  // api_error_log lives in the operational database, not the primary one.
  let errorCount = 0;
  try {
    const [row] = (await buildTransactionalDatabase(env)
      .execute(sql`SELECT COUNT(*)::int AS "errorCount" FROM api_error_log`))
      .rows as Array<{ errorCount: number }>;
    errorCount = row?.errorCount ?? 0;
  } catch (error) {
    reportCaughtError(error, { source: SOURCE, operation: 'platformSection.errorCount' });
  }
  return { ...counts, errorCount };
}

// ── LLM pools ─────────────────────────────────────────────────────────────────
//
// Two views of the same per-model availability (cooldown / vendor key / vendor
// cooldown, all resolved inside LlmProxyService.status()), because they answer two
// different questions:
//   planPools     — the chain a FREE / PRO tenant's request actually walks (public).
//   operatorPools — the raw pool partition an operator manages: the free pool, the
//                   paid-only pro pool, and the premium-fallback tail that is appended
//                   to EVERY chain but belongs to neither pool [1430].

export async function planPoolsSection(env: Env) {
  const [free, pro] = await Promise.all([
    llmProxyForPlan(env, 'free').status(),
    llmProxyForPlan(env, 'pro').status(),
  ]);
  return {
    free,
    pro,
    // Pool sizes, retained for non-UI consumers of the historical shape.
    pool: FREE_MODEL_POOL.length,
    proPool: PRO_MODEL_POOL.length,
    imagePool: FREE_IMAGE_MODEL_POOL.length,
    imageProPool: PAID_IMAGE_MODEL_POOL.length,
  };
}

export async function operatorPoolsSection(env: Env) {
  const [free, pro, premiumFallback] = await Promise.all([
    adminPoolProxy(env, FREE_MODEL_POOL, 'builderforceLLM').status(),
    adminPoolProxy(env, PRO_PAID_MODEL_POOL, 'builderforceLLMPro').status(),
    adminPoolProxy(env, PREMIUM_FALLBACK_MODELS, 'builderforceLLMPro').status(),
  ]);
  const models = [...free, ...pro];
  return { pool: models.length, models, free, pro, premiumFallback };
}

// ── vendorProbes: the latest scheduled/manual probe per vendor ────────────────

export async function vendorProbesSection(env: Env) {
  const rows = (await buildTransactionalDatabase(env).execute(sql`
    SELECT DISTINCT ON (vendor)
      vendor, status, probed_count AS "probedCount", ok_count AS "okCount",
      failed_count AS "failedCount", latency_ms AS "latencyMs",
      models_json AS "modelsJson", trigger,
      created_at AS "createdAt"
    FROM llm_health_probes
    ORDER BY vendor, created_at DESC
  `)).rows as Array<{
    vendor: string; status: string;
    probedCount: number; okCount: number; failedCount: number; latencyMs: number;
    modelsJson: unknown; trigger: string; createdAt: Date | string;
  }>;
  return rows.map((r) => ({
    vendor: r.vendor,
    status: r.status,
    probedCount: r.probedCount,
    okCount: r.okCount,
    failedCount: r.failedCount,
    latencyMs: r.latencyMs,
    // `models_json` is jsonb now [1449], but legacy rows written while it was
    // mis-handled as text can still come back as a JSON string — accept both.
    models: parseJsonArray(r.modelsJson),
    trigger: r.trigger,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
  }));
}

// ── worker: this deployment's identity and bindings ───────────────────────────

export function workerSection(env: Env) {
  return {
    version: API_VERSION,
    environment: env.ENVIRONMENT ?? 'unknown',
    bindings: {
      analysisRunner: Boolean(env.ANALYSIS_RUNNER),
      agentContainer: Boolean(env.AGENT_CONTAINER),
      qaRunnerContainer: Boolean(env.QA_RUNNER_CONTAINER),
      cloudRunner: Boolean(env.CLOUD_RUNNER),
      cloudflareAi: Boolean(env.CLOUDFLARE_AI_API_TOKEN && env.CLOUDFLARE_ACCOUNT_ID),
      // Live-page capture (a redesign's "before" screenshot). Reported here because
      // its absence is an OPERATOR fact the canvas relays to users verbatim. Asks the
      // service rather than restating its token list — a health report claiming
      // "configured" while a capture reports "unconfigured" is worse than no report.
      browserCapture: screenshotConfigured(env),
    },
  };
}

// ── runtime: live host + execution load ───────────────────────────────────────

export async function runtimeSection(db: Db) {
  const result = await db.execute(sql`
    SELECT
      (SELECT COUNT(*)::int FROM agent_hosts) AS "agentHosts",
      (SELECT COUNT(*)::int FROM agent_hosts WHERE connected_at IS NOT NULL AND last_seen_at > now() - interval '5 minutes') AS "onlineAgentHosts",
      (SELECT COUNT(*)::int FROM executions WHERE status IN ('pending', 'running')) AS "activeExecutions",
      (SELECT COUNT(*)::int FROM executions WHERE status = 'failed' AND updated_at > now() - interval '24 hours') AS "failedExecutions24h"
  `).catch((error: unknown) => {
    reportCaughtError(error, { source: SOURCE, operation: 'runtimeSection' });
    return { rows: [] };
  });
  const row = (result.rows[0] ?? {}) as Record<string, number>;
  return {
    agentHosts: Number(row.agentHosts ?? 0),
    onlineAgentHosts: Number(row.onlineAgentHosts ?? 0),
    activeExecutions: Number(row.activeExecutions ?? 0),
    failedExecutions24h: Number(row.failedExecutions24h ?? 0),
  };
}

// ── databases: size, headroom and largest relations of both endpoints ─────────

export type DatabaseTarget = 'primary' | 'transactional';

/**
 * Inspect one endpoint: its total size, the plan headroom that size is judged against,
 * and its hundred largest relations.
 *
 * `ceilingBytes` / `ratio` / `tier` come from the SAME functions the storage-pressure
 * sweep acts on ({@link storageCeilingBytes}, {@link tierFor}) rather than a second
 * threshold defined here. An operator looking at this panel and a sweep deciding to
 * compress a retention window must be reading one number; two would be a console that
 * says "fine" on the morning the nightly tick started deleting history.
 */
export async function inspectDatabase(db: Db, name: DatabaseTarget, env: Env) {
  const started = Date.now();
  const ceilingBytes = storageCeilingBytes(env);
  try {
    const [database] = (await db.execute(sql`
      SELECT current_database() AS "databaseName", pg_database_size(current_database())::bigint AS "totalBytes"
    `)).rows as Array<{ databaseName: string; totalBytes: number | string }>;
    const tables = (await db.execute(sql`
      SELECT relname AS name,
        pg_total_relation_size(relid)::bigint AS "totalBytes",
        COALESCE(n_live_tup, 0)::bigint AS "estimatedRows",
        COALESCE(n_tup_ins, 0)::bigint AS "insertsSinceStatsReset",
        COALESCE(n_tup_upd, 0)::bigint AS "updatesSinceStatsReset",
        COALESCE(n_tup_del, 0)::bigint AS "deletesSinceStatsReset",
        last_autovacuum AS "lastAutovacuum",
        last_analyze AS "lastAnalyze"
      FROM pg_stat_user_tables
      ORDER BY pg_total_relation_size(relid) DESC
      LIMIT 100
    `)).rows;
    const totalBytes = Number(database?.totalBytes ?? 0);
    return {
      name, ok: true, latencyMs: Date.now() - started,
      databaseName: database?.databaseName ?? null,
      totalBytes,
      ceilingBytes,
      ratio: ceilingBytes > 0 ? totalBytes / ceilingBytes : 0,
      tier: tierFor(ceilingBytes > 0 ? totalBytes / ceilingBytes : 0).tier,
      tables,
    };
  } catch (error) {
    return {
      name, ok: false, latencyMs: Date.now() - started, databaseName: null,
      totalBytes: 0, ceilingBytes, ratio: 0, tier: 'ok' as const,
      tables: [], error: error instanceof Error ? error.message : 'Database inspection failed',
    };
  }
}

export function databasesSection(primary: Db, env: Env) {
  return Promise.all([
    inspectDatabase(primary, 'primary', env),
    inspectDatabase(buildTransactionalDatabase(env), 'transactional', env),
  ]);
}

// ── Composed reports (the routes' response shapes) ────────────────────────────

/** GET /api/admin/health */
export async function adminHealthReport(db: Db, env: Env) {
  const [database, platform, llm] = await Promise.all([
    databaseSection(db),
    platformSection(db, env),
    operatorPoolsSection(env),
  ]);
  return {
    status: database.ok ? 'ok' : 'degraded',
    db: database,
    platform,
    llm,
    timestamp: new Date().toISOString(),
  };
}

/** GET /api/admin/system-health */
export async function systemHealthReport(db: Db, env: Env) {
  const [runtime, databases] = await Promise.all([runtimeSection(db), databasesSection(db, env)]);
  return { timestamp: new Date().toISOString(), worker: workerSection(env), runtime, databases };
}

/** GET /llm/v1/health — the `free`/`pro` arrays are the observability UI's contract. */
export async function llmHealthReport(env: Env) {
  const pools = await planPoolsSection(env);
  return {
    status: 'ok',
    service: 'builderforceLLM',
    free: pools.free,
    pro: pools.pro,
    timestamp: new Date().toISOString(),
    pool: pools.pool,
    proPool: pools.proPool,
    imagePool: pools.imagePool,
    imageProPool: pools.imageProPool,
  };
}
