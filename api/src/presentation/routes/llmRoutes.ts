/**
 * builderforceLLM routes — OpenAI-compatible LLM proxy.
 *
 * POST  /v1/chat/completions   – proxied chat completion (multi-vendor cascade)
 * GET   /v1/models             – list the active model pool + cooldown state
 * GET   /v1/usage              – tenant token consumption analytics
 * GET   /v1/health             – health check
 */
import { Hono, type Context } from 'hono';
import { and, eq, gte, sql, sum } from 'drizzle-orm';
import type { HonoEnv } from '../../env';
import {
  llmProxyForPlan,
  productNameForPlan,
  modelPoolForPlan,
  FREE_MODEL_POOL,
  PRO_MODEL_POOL,
  type ChatCompletionRequest,
  type LlmUsage,
  type ProductName,
} from '../../application/llm/LlmProxyService';
import { callOpenRouterEmbeddings } from '../../application/llm/vendors';
import { buildDatabase } from '../../infrastructure/database/connection';
import { llmUsageLog, llmFailoverLog, tenants, tenantMembers, coderclawInstances, tenantApiKeys } from '../../infrastructure/database/schema';
import { originAllowed } from '../../application/llm/tenantApiKeyService';
import { resolveKeyCached } from '../../infrastructure/auth/keyResolutionCache';
import type { FailoverEvent } from '../../application/llm/LlmProxyService';
import { verifyJwt } from '../../infrastructure/auth/JwtService';
import { hashSecret } from '../../infrastructure/auth/HashService';
import { TenantRole, TenantPlan } from '../../domain/shared/types';
import { getLimits } from '../../domain/tenant/PlanLimits';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Bulk-insert failover events into llm_failover_log, fire-and-forget. */
function logFailovers(
  env: HonoEnv['Bindings'],
  ctx: ExecutionContext,
  failovers: FailoverEvent[],
): void {
  if (failovers.length === 0) return;
  ctx.waitUntil(
    buildDatabase(env)
      .insert(llmFailoverLog)
      .values(failovers.map(f => ({ model: f.model, errorCode: f.code })))
      .catch(() => { /* never let logging fail the request */ }),
  );
}

/** Write one row to llm_usage_log, fire-and-forget via ctx.waitUntil. */
function logUsage(
  env: HonoEnv['Bindings'],
  ctx: ExecutionContext,
  tenantId: number,
  userId: string | null,
  llmProduct: ProductName,
  model: string,
  retries: number,
  streamed: boolean,
  usage: LlmUsage,
  metadata: Record<string, unknown> | null,
  idempotencyKey: string | null,
  useCase: string | null,
): void {
  ctx.waitUntil(
    buildDatabase(env)
      .insert(llmUsageLog)
      .values({
        tenantId,
        userId,
        llmProduct,
        model,
        promptTokens:     usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens:      usage.totalTokens,
        retries,
        streamed,
        metadata: metadata ? JSON.stringify(metadata) : null,
        idempotencyKey,
        useCase,
      })
      .catch(() => { /* never let logging fail the request */ }),
  );
}

type TenantAccess = {
  userId: string | null;
  tenantId: number;
  /** Numeric claw ID, set when request authenticates via claw API key. */
  clawId: number | null;
  /** Per-claw daily token budget (null = no per-claw cap). */
  clawTokenDailyLimit: number | null;
  role: TenantRole;
  plan: 'free' | 'pro' | 'teams';
  billingStatus: 'none' | 'pending' | 'active' | 'past_due' | 'cancelled';
  effectivePlan: 'free' | 'pro' | 'teams';
};

/** Map the string effectivePlan to TenantPlan enum for plan limits lookup. */
function toTenantPlan(ep: TenantAccess['effectivePlan']): TenantPlan {
  if (ep === 'pro') return TenantPlan.PRO;
  if (ep === 'teams') return TenantPlan.TEAMS;
  return TenantPlan.FREE;
}

/**
 * Resolve a tenant id to its plan/billing snapshot and derive the
 * effective plan (downgrades to 'free' when billing isn't active).
 * Shared between every API-key-style auth path on this route.
 */
async function resolveTenantPlan(
  c: Context<HonoEnv>,
  tenantId: number,
): Promise<Pick<TenantAccess, 'plan' | 'billingStatus' | 'effectivePlan'>> {
  const db = buildDatabase(c.env);
  const [tenantRow] = await db
    .select({ id: tenants.id, plan: tenants.plan, billingStatus: tenants.billingStatus })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  if (!tenantRow) throw new Error('Tenant not found');

  const plan = (tenantRow.plan ?? 'free') as TenantAccess['plan'];
  const billingStatus = (tenantRow.billingStatus ?? 'none') as TenantAccess['billingStatus'];
  const effectivePlan: TenantAccess['effectivePlan'] =
    billingStatus === 'active' && (plan === 'pro' || plan === 'teams') ? plan : 'free';

  return { plan, billingStatus, effectivePlan };
}

export async function requireTenantAccess(c: Context<HonoEnv>): Promise<TenantAccess> {
  const authHeader = c.req.header('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    throw new Error('Missing or malformed Authorization header');
  }

  const token = authHeader.slice(7);

  // Claw API key path: local CoderClaw instances send their raw clk_xxx key
  // directly as the Bearer token rather than exchanging it for a JWT first.
  if (token.startsWith('clk_')) {
    const keyHash = await hashSecret(token);

    const resolved = await resolveKeyCached(c.env, 'clk', keyHash, async () => {
      const db = buildDatabase(c.env);
      const [r] = await db
        .select({
          id:               coderclawInstances.id,
          tenantId:         coderclawInstances.tenantId,
          status:           coderclawInstances.status,
          tokenDailyLimit:  coderclawInstances.tokenDailyLimit,
        })
        .from(coderclawInstances)
        .where(eq(coderclawInstances.apiKeyHash, keyHash))
        .limit(1);
      if (!r || r.status !== 'active') return { ok: false, reason: 'Invalid or inactive claw API key' };
      return {
        ok: true,
        payload: { id: r.id, tenantId: r.tenantId, tokenDailyLimit: r.tokenDailyLimit ?? null },
      };
    });

    if (!resolved.ok) throw new Error(resolved.reason);
    const claw = resolved.payload as { id: number; tenantId: number; tokenDailyLimit: number | null };

    return {
      userId: null,
      tenantId: claw.tenantId,
      clawId: claw.id,
      clawTokenDailyLimit: claw.tokenDailyLimit,
      role: TenantRole.DEVELOPER,
      ...(await resolveTenantPlan(c, claw.tenantId)),
    };
  }

  // Tenant API key path (bfk_*): self-service tenant credential issued from
  // the portal; gateway-only. No claw context — plan-level cap still applies.
  if (token.startsWith('bfk_')) {
    const keyHash = await hashSecret(token);

    // KV-cached lookup: ~1ms hit, ~30-80ms miss. Cache entry covers everything
    // the auth path needs (id, tenantId, allowedOrigins, revoked flag) so a hit
    // requires zero DB calls. Falls through to DB when AUTH_CACHE_KV is unbound.
    const resolved = await resolveKeyCached(c.env, 'bfk', keyHash, async () => {
      const db = buildDatabase(c.env);
      const [r] = await db
        .select({
          id:              tenantApiKeys.id,
          tenantId:        tenantApiKeys.tenantId,
          revokedAt:       tenantApiKeys.revokedAt,
          allowedOrigins:  tenantApiKeys.allowedOrigins,
        })
        .from(tenantApiKeys)
        .where(eq(tenantApiKeys.keyHash, keyHash))
        .limit(1);
      if (!r || r.revokedAt) return { ok: false, reason: 'Invalid or revoked tenant API key' };
      // Pre-parse allowedOrigins so cache hit doesn't have to.
      let allowlist: string[] | null = null;
      if (r.allowedOrigins) {
        try {
          const parsed = JSON.parse(r.allowedOrigins);
          if (Array.isArray(parsed)) allowlist = parsed.filter((s) => typeof s === 'string');
        } catch { /* malformed → server-only */ }
      }
      return { ok: true, payload: { id: r.id, tenantId: r.tenantId, allowedOrigins: allowlist } };
    });

    if (!resolved.ok) throw new Error(resolved.reason);
    const { id: keyId, tenantId: keyTenantId, allowedOrigins: allowlist } =
      resolved.payload as { id: string; tenantId: number; allowedOrigins: string[] | null };

    // Origin allowlist enforcement (single source: tenantApiKeyService.originAllowed).
    const origin = c.req.header('Origin') ?? null;
    if (!originAllowed(allowlist, origin)) {
      throw new Error(
        `Origin '${origin}' is not authorized for this tenant API key. ` +
        `This key is server-only — to use it from a browser, register the origin in the portal under Settings → API keys.`,
      );
    }

    c.executionCtx.waitUntil(
      buildDatabase(c.env)
        .update(tenantApiKeys)
        .set({ lastUsedAt: new Date() })
        .where(eq(tenantApiKeys.id, keyId))
        .catch(() => { /* never let bookkeeping fail the request */ }),
    );

    return {
      userId: null,
      tenantId: keyTenantId,
      clawId: null,
      clawTokenDailyLimit: null,
      role: TenantRole.DEVELOPER,
      ...(await resolveTenantPlan(c, keyTenantId)),
    };
  }

  // JWT path: web users and claws that exchanged their API key for a JWT
  const payload = await verifyJwt(token, c.env.JWT_SECRET);
  if (payload.tid == null) {
    throw new Error('Workspace token is required');
  }

  const isClawToken = payload.sub.startsWith('claw:');
  if (!isClawToken) {
    const db = buildDatabase(c.env);
    const [membership] = await db
      .select({ userId: tenantMembers.userId })
      .from(tenantMembers)
      .where(and(
        eq(tenantMembers.tenantId, payload.tid),
        eq(tenantMembers.userId, payload.sub),
        eq(tenantMembers.isActive, true),
      ))
      .limit(1);

    if (!membership) {
      throw new Error('User is not an active member of this tenant');
    }
  }

  return {
    userId: isClawToken ? null : payload.sub,
    tenantId: payload.tid,
    clawId: null,
    clawTokenDailyLimit: null,
    role: payload.role,
    ...(await resolveTenantPlan(c, payload.tid)),
  };
}

/**
 * Wrap a ReadableStream to intercept OpenRouter SSE usage data from the final
 * chunk before [DONE], then call onUsage with the extracted counts.
 *
 * OpenRouter emits usage in the second-to-last data line:
 *   data: {...,"usage":{"prompt_tokens":N,"completion_tokens":M,"total_tokens":P}}
 *   data: [DONE]
 */
function wrapStreamForUsage(
  source: ReadableStream<Uint8Array>,
  onUsage: (usage: LlmUsage) => void,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  let lastDataJson = '';

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      const text = decoder.decode(chunk, { stream: true });
      // Track the last non-[DONE] data line in this chunk
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data: ') && trimmed !== 'data: [DONE]') {
          lastDataJson = trimmed.slice(6);
        } else if (trimmed === 'data: [DONE]' && lastDataJson) {
          try {
            const parsed = JSON.parse(lastDataJson) as Record<string, unknown>;
            const raw = parsed['usage'] as { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined;
            if (raw) {
              onUsage({
                promptTokens:     raw.prompt_tokens     ?? 0,
                completionTokens: raw.completion_tokens ?? 0,
                totalTokens:      raw.total_tokens      ?? 0,
              });
            }
          } catch { /* ignore parse errors */ }
        }
      }
      controller.enqueue(chunk);
    },
  });

  source.pipeTo(writable).catch(() => { /* stream may be cancelled by client */ });
  return readable;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function createLlmRoutes(): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  // -----------------------------------------------------------------------
  // POST /v1/chat/completions
  // -----------------------------------------------------------------------
  router.post('/v1/chat/completions', async (c) => {
    let access: TenantAccess;
    try {
      access = await requireTenantAccess(c);
    } catch (err) {
      return c.json({ error: (err as Error).message || 'Unauthorized' }, 401);
    }

    const body = await c.req.json<ChatCompletionRequest>();
    if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
      return c.json({ error: 'messages array is required' }, 400);
    }

    // Capture SDK transport metadata for usage logging — the body's `metadata`
    // and `useCase` are consumed here and stripped before vendor dispatch
    // (see STANDARD_BODY_FIELDS).
    const bodyAny = body as Record<string, unknown>;
    const callerMetadata = (bodyAny.metadata as Record<string, unknown> | undefined) ?? null;
    const callerUseCase  = typeof bodyAny.useCase === 'string' ? bodyAny.useCase : null;
    const idempotencyKey = c.req.header('Idempotency-Key') ?? null;

    // ── Daily token usage + limit checks ────────────────────────────────────
    // Single query — value is reused for both the 429 gate and the
    // X-Builderforce-Daily-Tokens-* response headers callers use to
    // pre-emptively throttle before they hit the gate.
    const { tokenDailyLimit: planDailyLimit } = getLimits(toTenantPlan(access.effectivePlan));
    const needsTenantUsageQuery =
      planDailyLimit > 0 || (access.clawId !== null && access.clawTokenDailyLimit !== null);

    let usageToday = 0;
    if (needsTenantUsageQuery) {
      const todayStart = new Date();
      todayStart.setUTCHours(0, 0, 0, 0);
      const db = buildDatabase(c.env);
      const [usageRow] = await db
        .select({ used: sum(llmUsageLog.totalTokens) })
        .from(llmUsageLog)
        .where(
          and(
            eq(llmUsageLog.tenantId, access.tenantId),
            gte(llmUsageLog.createdAt, todayStart),
          ),
        );
      usageToday = Number(usageRow?.used ?? 0);

      // Per-claw cap (optional, set per-claw in portal)
      if (access.clawId !== null && access.clawTokenDailyLimit !== null) {
        if (usageToday >= access.clawTokenDailyLimit) {
          return c.json({
            error: `Per-claw daily token limit reached (${access.clawTokenDailyLimit.toLocaleString()} tokens). Increase the limit in the Builderforce portal under Claws → Settings.`,
            code: 'claw_token_limit_exceeded',
          }, 429);
        }
      }

      // Plan-level cap (always enforced)
      if (planDailyLimit > 0 && usageToday >= planDailyLimit) {
        const upgradeHint = access.effectivePlan === 'free'
          ? ' Upgrade to Pro at builderforce.ai/pricing.'
          : access.effectivePlan === 'pro'
          ? ' Upgrade to Teams for a 5× higher daily budget.'
          : '';
        return c.json({
          error: `Plan daily token limit reached (${planDailyLimit.toLocaleString()} tokens).${upgradeHint}`,
          code: 'plan_token_limit_exceeded',
          plan: access.effectivePlan,
          dailyLimit: planDailyLimit,
          usedToday: usageToday,
        }, 429);
      }
    }

    // ── Idempotency-Key replay guard (10-min window) ────────────────────────
    // MVP: detect that this exact (tenant, key) was already used recently and
    // refuse to re-dispatch. Returns 409 with the original request id so the
    // caller can no-op their retry without double-charging. Does NOT cache
    // and replay the response body — that requires Cloudflare KV (separate
    // wrangler.toml change; see Gap Register).
    if (idempotencyKey) {
      const tenMinAgo = new Date(Date.now() - 10 * 60_000);
      const db = buildDatabase(c.env);
      const [prior] = await db
        .select({ id: llmUsageLog.id, createdAt: llmUsageLog.createdAt })
        .from(llmUsageLog)
        .where(
          and(
            eq(llmUsageLog.tenantId, access.tenantId),
            eq(llmUsageLog.idempotencyKey, idempotencyKey),
            gte(llmUsageLog.createdAt, tenMinAgo),
          ),
        )
        .limit(1);
      if (prior) {
        return c.json({
          error: `Idempotency-Key '${idempotencyKey}' was used at ${prior.createdAt?.toISOString()}. Treat this as a no-op retry.`,
          code: 'idempotent_replay',
          previousRequest: { id: prior.id, createdAt: prior.createdAt?.toISOString() },
        }, 409);
      }
    }

    const llmProduct = productNameForPlan(access.effectivePlan);
    const isPro = access.effectivePlan !== 'free';

    // Validate required key for the active plan up-front so callers get a clear 503.
    const requiredKey = isPro ? c.env.OPENROUTER_API_KEY_PRO ?? c.env.OPENROUTER_API_KEY : c.env.OPENROUTER_API_KEY;
    if (!requiredKey) {
      return c.json({
        error: isPro
          ? 'LLM proxy not configured (missing OPENROUTER_API_KEY_PRO or OPENROUTER_API_KEY)'
          : 'LLM proxy not configured (missing OPENROUTER_API_KEY)',
      }, 503);
    }

    const service = llmProxyForPlan(c.env, access.effectivePlan);
    const result = await service.complete(body);

    // Clone upstream headers we care about
    const upstreamHeaders = new Headers();
    const contentType = result.response.headers.get('content-type');
    if (contentType) upstreamHeaders.set('content-type', contentType);
    upstreamHeaders.set('x-builderforce-model', result.resolvedModel);
    upstreamHeaders.set('x-builderforce-retries', String(result.retries));
    upstreamHeaders.set('x-builderforce-product', llmProduct);
    upstreamHeaders.set('x-builderforce-effective-plan', access.effectivePlan);
    // Daily-token-limit headers — let callers pre-emptively throttle before
    // they hit the 429 plan_token_limit_exceeded gate.
    if (planDailyLimit > 0) {
      upstreamHeaders.set('x-builderforce-daily-tokens-used', String(usageToday));
      upstreamHeaders.set('x-builderforce-daily-tokens-limit', String(planDailyLimit));
      upstreamHeaders.set('x-builderforce-daily-tokens-remaining', String(Math.max(planDailyLimit - usageToday, 0)));
    }

    // ── Streaming ────────────────────────────────────────────────────────────
    if (body.stream && result.response.body) {
      upstreamHeaders.set('cache-control', 'no-cache');
      upstreamHeaders.set('connection', 'keep-alive');

      // Log any failovers that happened before this successful model
      logFailovers(c.env, c.executionCtx, result.failovers);

      // Wrap the stream to capture usage from the final SSE chunk
      const instrumentedStream = wrapStreamForUsage(
        result.response.body,
        (usage) => logUsage(
          c.env, c.executionCtx, access.tenantId, access.userId, llmProduct,
          result.resolvedModel, result.retries, true, usage,
          callerMetadata, idempotencyKey, callerUseCase,
        ),
      );

      return new Response(instrumentedStream, {
        status: result.response.status,
        headers: upstreamHeaders,
      });
    }

    // ── Non-streaming ────────────────────────────────────────────────────────
    const upstream = await result.response.json() as Record<string, unknown>;

    // Log any failovers, then log usage
    logFailovers(c.env, c.executionCtx, result.failovers);
    logUsage(
      c.env,
      c.executionCtx,
      access.tenantId,
      access.userId,
      llmProduct,
      result.resolvedModel,
      result.retries,
      false,
      result.usage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      callerMetadata,
      idempotencyKey,
      callerUseCase,
    );

    return c.json(
      {
        ...upstream,
        _builderforce: {
          resolvedModel: result.resolvedModel,
          retries:       result.retries,
          pool:          modelPoolForPlan(access.effectivePlan).length,
          product:       llmProduct,
          effectivePlan: access.effectivePlan,
          ...(result.schemaRetries != null ? { schemaRetries: result.schemaRetries } : {}),
          ...(callerUseCase     ? { useCase:    callerUseCase  } : {}),
          ...(callerMetadata    ? { metadata:   callerMetadata as Record<string, string> } : {}),
          ...(c.req.header('x-request-id') ? { requestId: c.req.header('x-request-id') } : {}),
          ...(planDailyLimit > 0 ? {
            dailyTokens: {
              used:      usageToday,
              limit:     planDailyLimit,
              remaining: Math.max(planDailyLimit - usageToday, 0),
            },
          } : {}),
        },
      },
      result.response.status as 200,
    );
  });

  // -----------------------------------------------------------------------
  // GET /v1/models — pool status
  // -----------------------------------------------------------------------
  router.get('/v1/models', async (c) => {
    let access: TenantAccess | null = null;
    try {
      access = await requireTenantAccess(c);
    } catch {
      access = null;
    }

    const effectivePlan = access?.effectivePlan ?? 'free';
    const productName = productNameForPlan(effectivePlan);
    const isPro = effectivePlan !== 'free';

    const requiredKey = isPro ? c.env.OPENROUTER_API_KEY_PRO ?? c.env.OPENROUTER_API_KEY : c.env.OPENROUTER_API_KEY;
    if (!requiredKey) {
      return c.json({
        configured: false,
        product: productName,
        effectivePlan,
        models: modelPoolForPlan(effectivePlan),
      });
    }

    const service = llmProxyForPlan(c.env, effectivePlan);
    return c.json({
      configured: true,
      object: 'list',
      product: productName,
      effectivePlan,
      data: service.status(),
    });
  });

  // -----------------------------------------------------------------------
  // GET /v1/usage?days=30
  // Tenant-scoped LLM consumption visible to all workspace members
  // -----------------------------------------------------------------------
  router.get('/v1/usage', async (c) => {
    let access: TenantAccess;
    try {
      access = await requireTenantAccess(c);
    } catch (err) {
      return c.json({ error: (err as Error).message || 'Unauthorized' }, 401);
    }

    const days = Math.min(Number(c.req.query('days') ?? '30'), 90);
    const db = buildDatabase(c.env);

    // ── Detail mode — row-level pageable per-call ledger for reconciliation
    // against the caller's own usage table. Same auth, same tenant scoping.
    if (c.req.query('detail') === 'true') {
      const limit  = Math.min(Math.max(Number(c.req.query('limit') ?? '100'), 1), 500);
      const page   = Math.max(Number(c.req.query('page') ?? '1'), 1);
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
        WHERE tenant_id = ${access.tenantId}
          AND created_at >= NOW() - (${days} || ' days')::interval
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `);

      const [count] = (await db.execute(sql`
        SELECT COUNT(*)::int AS total
        FROM llm_usage_log
        WHERE tenant_id = ${access.tenantId}
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

      return c.json({
        days, page, limit, total: Number(count?.total ?? 0),
        rows: parsed,
      });
    }

    const byModel = await db.execute(sql`
      SELECT
        llm_product AS "llmProduct",
        model,
        COUNT(*)::int                    AS requests,
        SUM(prompt_tokens)::bigint       AS prompt_tokens,
        SUM(completion_tokens)::bigint   AS completion_tokens,
        SUM(total_tokens)::bigint        AS total_tokens,
        SUM(retries)::int                AS retries
      FROM llm_usage_log
      WHERE tenant_id = ${access.tenantId}
        AND created_at >= NOW() - (${days} || ' days')::interval
      GROUP BY llm_product, model
      ORDER BY requests DESC
    `);

    const byDay = await db.execute(sql`
      SELECT
        DATE_TRUNC('day', created_at)::date::text AS day,
        COUNT(*)::int                             AS requests,
        SUM(total_tokens)::bigint                 AS total_tokens
      FROM llm_usage_log
      WHERE tenant_id = ${access.tenantId}
        AND created_at >= NOW() - (${days} || ' days')::interval
      GROUP BY DATE_TRUNC('day', created_at)
      ORDER BY DATE_TRUNC('day', created_at)
    `);

    const byUser = await db.execute(sql`
      SELECT
        COALESCE(user_id, 'claw-runtime') AS user_id,
        COUNT(*)::int                     AS requests,
        SUM(total_tokens)::bigint         AS total_tokens
      FROM llm_usage_log
      WHERE tenant_id = ${access.tenantId}
        AND created_at >= NOW() - (${days} || ' days')::interval
      GROUP BY COALESCE(user_id, 'claw-runtime')
      ORDER BY requests DESC
      LIMIT 25
    `);

    const [totals] = (await db.execute(sql`
      SELECT
        COUNT(*)::int                  AS requests,
        SUM(total_tokens)::bigint      AS total_tokens,
        SUM(prompt_tokens)::bigint     AS prompt_tokens,
        SUM(completion_tokens)::bigint AS completion_tokens
      FROM llm_usage_log
      WHERE tenant_id = ${access.tenantId}
        AND created_at >= NOW() - (${days} || ' days')::interval
    `)).rows as Array<{
      requests: number;
      total_tokens: bigint;
      prompt_tokens: bigint;
      completion_tokens: bigint;
    }>;

    const [mine] = access.userId
      ? (await db.execute(sql`
          SELECT
            COUNT(*)::int                  AS requests,
            SUM(total_tokens)::bigint      AS total_tokens,
            SUM(prompt_tokens)::bigint     AS prompt_tokens,
            SUM(completion_tokens)::bigint AS completion_tokens
          FROM llm_usage_log
          WHERE tenant_id = ${access.tenantId}
            AND user_id = ${access.userId}
            AND created_at >= NOW() - (${days} || ' days')::interval
        `)).rows as Array<{
          requests: number;
          total_tokens: bigint;
          prompt_tokens: bigint;
          completion_tokens: bigint;
        }>
      : [{ requests: 0, total_tokens: 0n, prompt_tokens: 0n, completion_tokens: 0n }];

    return c.json({
      days,
      tenantId: access.tenantId,
      plan: access.plan,
      effectivePlan: access.effectivePlan,
      billingStatus: access.billingStatus,
      totals: {
        requests: Number(totals?.requests ?? 0),
        totalTokens: Number(totals?.total_tokens ?? 0),
        promptTokens: Number(totals?.prompt_tokens ?? 0),
        completionTokens: Number(totals?.completion_tokens ?? 0),
      },
      mine: {
        userId: access.userId,
        requests: Number(mine?.requests ?? 0),
        totalTokens: Number(mine?.total_tokens ?? 0),
        promptTokens: Number(mine?.prompt_tokens ?? 0),
        completionTokens: Number(mine?.completion_tokens ?? 0),
      },
      byModel: byModel.rows,
      byDay: byDay.rows,
      byUser: byUser.rows,
    });
  });

  // -----------------------------------------------------------------------
  // POST /v1/embeddings — OpenAI-compatible. Wired to OpenRouter.
  // -----------------------------------------------------------------------
  router.post('/v1/embeddings', async (c) => {
    let access: TenantAccess;
    try {
      access = await requireTenantAccess(c);
    } catch (err) {
      return c.json({ error: (err as Error).message || 'Unauthorized' }, 401);
    }

    const apiKey = access.effectivePlan === 'free'
      ? c.env.OPENROUTER_API_KEY
      : (c.env.OPENROUTER_API_KEY_PRO ?? c.env.OPENROUTER_API_KEY);
    if (!apiKey) {
      return c.json({ error: 'Embeddings vendor not configured (missing OPENROUTER_API_KEY)' }, 503);
    }

    const body = await c.req.json<{
      model?: string;
      input: string | string[];
      metadata?: Record<string, unknown>;
      [key: string]: unknown;
    }>().catch(() => null);

    if (!body || (typeof body.input !== 'string' && !Array.isArray(body.input))) {
      return c.json({ error: '`input` must be a string or array of strings' }, 400);
    }

    // Strip gateway-only fields before forwarding to the vendor.
    const { metadata, model, input, ...extraBody } = body;
    const result = await callOpenRouterEmbeddings({ apiKey, model, input, extraBody });

    return c.json(
      typeof result.body === 'object' && result.body !== null
        ? { ...(result.body as Record<string, unknown>), _builderforce: { product: productNameForPlan(access.effectivePlan), effectivePlan: access.effectivePlan } }
        : result.body,
      result.status as 200,
    );
  });

  // -----------------------------------------------------------------------
  // GET /v1/health
  // -----------------------------------------------------------------------
  router.get('/v1/health', (c) =>
    c.json({ status: 'ok', service: 'builderforceLLM', pool: FREE_MODEL_POOL.length, proPool: PRO_MODEL_POOL.length }),
  );

  return router;
}
