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
  newTraceId,
  productNameForPlan,
  modelPoolForPlan,
  FREE_MODEL_POOL,
  PRO_MODEL_POOL,
  type ChatCompletionRequest,
  type LlmUsage,
} from '../../application/llm/LlmProxyService';
import { logTrace } from '../../application/llm/traceLogger';
import { callOpenRouterEmbeddings, pickUsage } from '../../application/llm/vendors';
import { getCatalogCached } from '../../application/llm/modelCatalog';
import {
  imageProxyForPlan,
  imageProductNameForPlan,
  FREE_IMAGE_MODEL_POOL,
  PAID_IMAGE_MODEL_POOL,
  type ImageGenerationRequest,
} from '../../application/llm/ImageProxyService';
import { buildDatabase } from '../../infrastructure/database/connection';
import { llmUsageLog, llmFailoverLog, tenants, tenantMembers, agentHosts, tenantApiKeys, users } from '../../infrastructure/database/schema';
import { originAllowed, deserializeScopes } from '../../application/llm/tenantApiKeyService';
import { listToolsForTenant, callMcpTool } from '../../application/llm/mcpExtensionService';
import { resolveKeyCached } from '../../infrastructure/auth/keyResolutionCache';
import type { FailoverEvent } from '../../application/llm/LlmProxyService';
import { verifyJwt, signJwt } from '../../infrastructure/auth/JwtService';
import { hashSecret } from '../../infrastructure/auth/HashService';
import { TenantRole, TenantPlan } from '../../domain/shared/types';
import { getLimits } from '../../domain/tenant/PlanLimits';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Seconds remaining until the next UTC midnight — when the daily token
 * counter resets. Surfaced on cap-exhausted 429s as both a `Retry-After`
 * header and a `retryAfter` field so consumers can sleep precisely
 * instead of polling.
 */
function secondsUntilNextUtcMidnight(): number {
  const now = Date.now();
  const next = new Date();
  next.setUTCHours(24, 0, 0, 0); // midnight tomorrow UTC
  return Math.max(1, Math.ceil((next.getTime() - now) / 1000));
}

/** Bulk-insert failover events into llm_failover_log, fire-and-forget.
 *  Accepts the minimal shape used by both chat (`FailoverEvent`) and image
 *  (`ImageFailoverEvent`) surfaces — only `model` + `code` are persisted, the
 *  `vendor` label rides along on the typed event but isn't written here. */
function logFailovers(
  env: HonoEnv['Bindings'],
  ctx: ExecutionContext,
  failovers: ReadonlyArray<{ model: string; code: number }>,
): void {
  if (failovers.length === 0) return;
  ctx.waitUntil(
    buildDatabase(env)
      .insert(llmFailoverLog)
      .values(failovers.map(f => ({ model: f.model, errorCode: f.code })))
      .catch(() => { /* never let logging fail the request */ }),
  );
}

/** Write one row to llm_usage_log, fire-and-forget via ctx.waitUntil.
 *  `llmProduct` accepts any product label — chat (`builderforceLLM*`) or
 *  image (`builderforceImage*`) — since the DB column is `varchar(32)` and
 *  this function is the single insert site shared by both surfaces. */
function logUsage(
  env: HonoEnv['Bindings'],
  ctx: ExecutionContext,
  tenantId: number,
  userId: string | null,
  llmProduct: string,
  model: string,
  retries: number,
  streamed: boolean,
  usage: LlmUsage,
  metadata: Record<string, unknown> | null,
  idempotencyKey: string | null,
  useCase: string | null,
  tenantApiKeyId: string | null,
): void {
  ctx.waitUntil(
    buildDatabase(env)
      .insert(llmUsageLog)
      .values({
        tenantId,
        userId,
        llmProduct,
        model,
        promptTokens:        usage.promptTokens,
        completionTokens:    usage.completionTokens,
        totalTokens:         usage.totalTokens,
        cacheReadTokens:     usage.cacheReadTokens     ?? 0,
        cacheCreationTokens: usage.cacheCreationTokens ?? 0,
        retries,
        streamed,
        metadata: metadata ? JSON.stringify(metadata) : null,
        idempotencyKey,
        useCase,
        tenantApiKeyId,
      })
      .catch(() => { /* never let logging fail the request */ }),
  );
}

/**
 * Typed error thrown by `requireTenantAccess` so callers can return the right
 * HTTP status + code without each catch site re-implementing the mapping.
 * Single source of truth for "auth-related rejection" surface.
 */
export class TenantAccessError extends Error {
  constructor(
    public readonly status: 401 | 403,
    public readonly code: string,
    message: string,
  ) { super(message); this.name = 'TenantAccessError'; }
}

/** Convert any throwable from `requireTenantAccess` into a Hono JSON response. */
export function respondToAccessError(c: Context<HonoEnv>, err: unknown) {
  if (err instanceof TenantAccessError) {
    return c.json({ error: err.message, code: err.code }, err.status);
  }
  return c.json({ error: (err as Error).message || 'Unauthorized' }, 401);
}

type TenantAccess = {
  userId: string | null;
  tenantId: number;
  /** Numeric agentHost ID, set when request authenticates via agentHost API key. */
  agentHostId: number | null;
  /** Per-agentHost daily token budget (null = no per-agentHost cap). */
  agentHostTokenDailyLimit: number | null;
  /** UUID of the `bfk_*` tenant API key that authenticated, when applicable. */
  tenantApiKeyId: string | null;
  /** Endpoint scopes of the authenticating `bfk_*` key. null = unrestricted
   *  (full-tenant key) or a non-key auth path (agentHost / JWT). See migration 0070. */
  tenantApiKeyScopes: string[] | null;
  role: TenantRole;
  plan: 'free' | 'pro' | 'teams';
  billingStatus: 'none' | 'pending' | 'active' | 'past_due' | 'cancelled';
  effectivePlan: 'free' | 'pro' | 'teams';
  /**
   * Superadmin override for the plan-level daily token cap.
   *   null → use plan default
   *   -1   → unlimited (skip the gate)
   *   >= 0 → use this value
   */
  tokenDailyLimitOverride: number | null;
  /** Superadmin grant of premium routing — when true the LLM proxy uses the
   *  premium model pool (top PREMIUM-tier models) and the extended per-vendor
   *  timeout regardless of plan/billingStatus. Comped / beta access. */
  premiumOverride: boolean;
  /** True when the JWT carries `sa: true`. Bypasses plan-cap and strict-pin
   *  gates so platform admins can use the gateway without hitting tenant caps.
   *  Always false for `clk_*` and `bfk_*` machine-credential paths. */
  isSuperadmin: boolean;
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
): Promise<Pick<TenantAccess, 'plan' | 'billingStatus' | 'effectivePlan' | 'tokenDailyLimitOverride' | 'premiumOverride'>> {
  const db = buildDatabase(c.env);
  const [tenantRow] = await db
    .select({
      id: tenants.id,
      plan: tenants.plan,
      billingStatus: tenants.billingStatus,
      tokenDailyLimitOverride: tenants.tokenDailyLimitOverride,
      premiumOverride: tenants.premiumOverride,
    })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  if (!tenantRow) throw new Error('Tenant not found');

  const plan = (tenantRow.plan ?? 'free') as TenantAccess['plan'];
  const billingStatus = (tenantRow.billingStatus ?? 'none') as TenantAccess['billingStatus'];
  const effectivePlan: TenantAccess['effectivePlan'] =
    billingStatus === 'active' && (plan === 'pro' || plan === 'teams') ? plan : 'free';

  return {
    plan,
    billingStatus,
    effectivePlan,
    tokenDailyLimitOverride: tenantRow.tokenDailyLimitOverride ?? null,
    premiumOverride: tenantRow.premiumOverride === true,
  };
}

export async function requireTenantAccess(c: Context<HonoEnv>): Promise<TenantAccess> {
  const authHeader = c.req.header('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    throw new Error('Missing or malformed Authorization header');
  }

  const token = authHeader.slice(7);

  // BuilderForce Agent API key path: agent instances send their raw key directly
  // as the Bearer token rather than exchanging it for a JWT first. New keys are
  // `bfa_*`; legacy `clk_*` keys (retired "claw" brand) are still accepted.
  if (token.startsWith('bfa_') || token.startsWith('clk_')) {
    const keyHash = await hashSecret(token);

    const resolved = await resolveKeyCached(c.env, 'clk', keyHash, async () => {
      const db = buildDatabase(c.env);
      const [r] = await db
        .select({
          id:               agentHosts.id,
          tenantId:         agentHosts.tenantId,
          status:           agentHosts.status,
          tokenDailyLimit:  agentHosts.tokenDailyLimit,
        })
        .from(agentHosts)
        .where(eq(agentHosts.apiKeyHash, keyHash))
        .limit(1);
      if (!r || r.status !== 'active') return { ok: false, reason: 'Invalid or inactive agentHost API key' };
      return {
        ok: true,
        payload: { id: r.id, tenantId: r.tenantId, tokenDailyLimit: r.tokenDailyLimit ?? null },
      };
    });

    if (!resolved.ok) throw new Error(resolved.reason);
    const agentHost = resolved.payload as { id: number; tenantId: number; tokenDailyLimit: number | null };

    return {
      userId: null,
      tenantId: agentHost.tenantId,
      agentHostId: agentHost.id,
      agentHostTokenDailyLimit: agentHost.tokenDailyLimit,
      tenantApiKeyId: null,
      tenantApiKeyScopes: null,
      role: TenantRole.DEVELOPER,
      isSuperadmin: false,
      ...(await resolveTenantPlan(c, agentHost.tenantId)),
    };
  }

  // Tenant API key path (bfk_*): self-service tenant credential issued from
  // the portal; gateway-only. No agentHost context — plan-level cap still applies.
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
          scopes:          tenantApiKeys.scopes,
        })
        .from(tenantApiKeys)
        .where(eq(tenantApiKeys.keyHash, keyHash))
        .limit(1);
      if (!r || r.revokedAt) return { ok: false, reason: 'Invalid or revoked tenant API key' };
      // Pre-parse allowedOrigins + scopes so a cache hit doesn't have to.
      let allowlist: string[] | null = null;
      if (r.allowedOrigins) {
        try {
          const parsed = JSON.parse(r.allowedOrigins);
          if (Array.isArray(parsed)) allowlist = parsed.filter((s) => typeof s === 'string');
        } catch { /* malformed → server-only */ }
      }
      return { ok: true, payload: { id: r.id, tenantId: r.tenantId, allowedOrigins: allowlist, scopes: deserializeScopes(r.scopes) } };
    });

    if (!resolved.ok) throw new Error(resolved.reason);
    const { id: keyId, tenantId: keyTenantId, allowedOrigins: allowlist, scopes: keyScopes } =
      resolved.payload as { id: string; tenantId: number; allowedOrigins: string[] | null; scopes?: string[] | null };

    // Origin allowlist enforcement (single source: tenantApiKeyService.originAllowed).
    const origin = c.req.header('Origin') ?? null;
    if (!originAllowed(allowlist, origin)) {
      throw new TenantAccessError(
        403,
        'origin_not_authorized',
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
      agentHostId: null,
      agentHostTokenDailyLimit: null,
      tenantApiKeyId: keyId,
      tenantApiKeyScopes: keyScopes ?? null,
      role: TenantRole.DEVELOPER,
      isSuperadmin: false,
      ...(await resolveTenantPlan(c, keyTenantId)),
    };
  }

  // JWT path: web users and agentHosts that exchanged their API key for a JWT
  const payload = await verifyJwt(token, c.env.JWT_SECRET);
  if (payload.tid == null) {
    throw new Error('Workspace token is required');
  }

  // Service tokens carry no real user: agentHost instances (`agentHost:*`) and short-lived
  // embed-session tokens (`embed:*`) minted server-to-server from a bfk_* key.
  // Neither has a tenant_members row, so both skip the membership check.
  const isAgentHostToken = payload.sub.startsWith('agentHost:');
  const isEmbedToken = payload.sub.startsWith('embed:');
  const isServiceToken = isAgentHostToken || isEmbedToken;
  // Join `users.isSuperadmin` into the membership check so we don't depend on
  // the JWT carrying `sa: true`. Old JWTs minted before the `sa` claim was
  // added still grant superadmin bypass — no re-login required. New JWTs that
  // already carry the claim still benefit (the join is one DB round trip the
  // membership check was already paying for).
  let dbIsSuperadmin = false;
  if (!isServiceToken) {
    const db = buildDatabase(c.env);
    const [membership] = await db
      .select({
        userId: tenantMembers.userId,
        isSuperadmin: users.isSuperadmin,
      })
      .from(tenantMembers)
      .innerJoin(users, eq(users.id, tenantMembers.userId))
      .where(and(
        eq(tenantMembers.tenantId, payload.tid),
        eq(tenantMembers.userId, payload.sub),
        eq(tenantMembers.isActive, true),
      ))
      .limit(1);

    if (!membership) {
      throw new Error('User is not an active member of this tenant');
    }
    dbIsSuperadmin = membership.isSuperadmin === true;
  }

  return {
    userId: isServiceToken ? null : payload.sub,
    tenantId: payload.tid,
    agentHostId: null,
    agentHostTokenDailyLimit: null,
    tenantApiKeyId: null,
    tenantApiKeyScopes: null,
    role: payload.role,
    // `users.isSuperadmin` (joined into the membership query above) is the
    // sole source of truth — fresh on every call, instant revocation.
    // Service tokens (agentHost / embed) are never superadmin.
    isSuperadmin: !isServiceToken && dbIsSuperadmin,
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
            const rawUsage = parsed['usage'];
            if (rawUsage) {
              // Reuse the vendor usage normalizer so the streaming path captures
              // the same prompt-cache breakdown (cache_read/creation) as JSON.
              const u = pickUsage(rawUsage);
              onUsage({
                promptTokens:     u.prompt_tokens     ?? 0,
                completionTokens: u.completion_tokens ?? 0,
                totalTokens:      u.total_tokens      ?? 0,
                ...(u.cache_read_tokens     != null ? { cacheReadTokens:     u.cache_read_tokens     } : {}),
                ...(u.cache_creation_tokens != null ? { cacheCreationTokens: u.cache_creation_tokens } : {}),
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
  // POST /v1/embed-session
  // -----------------------------------------------------------------------
  // Server-to-server relay token mint. A customer's backend calls this with its
  // `bfk_*` key (no browser Origin — requireTenantAccess enforces the origin
  // allowlist, so a server-only key is rejected from a browser) and receives a
  // SHORT-LIVED tenant-scoped JWT. The customer hands that token to its browser,
  // which then calls the gateway directly — the bfk_* secret never leaves the
  // server. The minted token's `sub` is `embed:<keyId>`, recognised as a
  // service token by requireTenantAccess (no tenant_members row required).
  const EMBED_SESSION_TTL_SECONDS = 600; // 10 minutes; the relay refreshes.
  router.post('/v1/embed-session', async (c) => {
    let access: TenantAccess;
    try {
      access = await requireTenantAccess(c);
    } catch (err) {
      return respondToAccessError(c, err);
    }

    // Only a tenant API key may mint embed sessions. A JWT (web/agentHost/embed)
    // can't — that would let a browser token bootstrap fresh tokens forever.
    if (!access.tenantApiKeyId) {
      return c.json(
        {
          error: 'embed-session requires a tenant API key (bfk_*) sent server-to-server.',
          code: 'embed_requires_api_key',
        },
        403,
      );
    }

    const token = await signJwt(
      { sub: `embed:${access.tenantApiKeyId}`, tid: access.tenantId, role: TenantRole.DEVELOPER },
      c.env.JWT_SECRET,
      EMBED_SESSION_TTL_SECONDS,
    );
    return c.json({
      token,
      expiresInSeconds: EMBED_SESSION_TTL_SECONDS,
      expiresAt: new Date(Date.now() + EMBED_SESSION_TTL_SECONDS * 1000).toISOString(),
    });
  });

  // -----------------------------------------------------------------------
  // GET /v1/mcp/tools — advertise the caller's tenant MCP extension tools
  // -----------------------------------------------------------------------
  // The Brain's tool loop runs client-side, so it fetches the tenant's enabled
  // MCP tools here and registers each as a BrainAction whose run() posts to
  // /v1/mcp/call below. The customer's MCP secret is decrypted + used only
  // server-side (in listToolsForTenant / callMcpTool) — never sent to the browser.
  router.get('/v1/mcp/tools', async (c) => {
    let access: TenantAccess;
    try {
      access = await requireTenantAccess(c);
    } catch (err) {
      return respondToAccessError(c, err);
    }
    const db = buildDatabase(c.env);
    const tools = await listToolsForTenant(db, access.tenantId, c.env.JWT_SECRET);
    return c.json({ tools });
  });

  // -----------------------------------------------------------------------
  // POST /v1/mcp/call — relay one MCP tool call server-to-server
  // -----------------------------------------------------------------------
  router.post('/v1/mcp/call', async (c) => {
    let access: TenantAccess;
    try {
      access = await requireTenantAccess(c);
    } catch (err) {
      return respondToAccessError(c, err);
    }
    const body = await c.req
      .json<{ extensionId?: string; tool?: string; arguments?: unknown }>()
      .catch(() => ({} as { extensionId?: string; tool?: string; arguments?: unknown }));
    if (!body.extensionId || !body.tool) {
      return c.json({ error: 'extensionId and tool are required' }, 400);
    }
    const db = buildDatabase(c.env);
    try {
      const result = await callMcpTool(db, {
        tenantId: access.tenantId,
        extensionId: body.extensionId,
        tool: body.tool,
        arguments: body.arguments,
        keyMaterial: c.env.JWT_SECRET,
      });
      return c.json({ result });
    } catch (e) {
      // Recoverable: hand the model a tool-error result, don't 500 the loop.
      return c.json({ error: e instanceof Error ? e.message : 'MCP call failed' }, 502);
    }
  });

  // -----------------------------------------------------------------------
  // POST /v1/chat/completions
  // -----------------------------------------------------------------------
  router.post('/v1/chat/completions', async (c) => {
    let access: TenantAccess;
    try {
      access = await requireTenantAccess(c);
    } catch (err) {
      return respondToAccessError(c, err);
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

    // ── Strict-pin entitlement gate ─────────────────────────────────────────
    // Free tenants can't request modelStrict — a single misbehaving model
    // would otherwise drain their daily budget with retries. Paid plans,
    // superadmin-issued daily-limit overrides, and superadmin callers bypass.
    const wantsStrict = bodyAny.modelStrict === true
                     && typeof bodyAny.model === 'string'
                     && (bodyAny.model as string).length > 0;
    if (wantsStrict) {
      const strictAllowed = access.isSuperadmin
                         || access.effectivePlan !== 'free'
                         || access.tokenDailyLimitOverride !== null;
      if (!strictAllowed) {
        return c.json({
          error: 'modelStrict requires a paid plan (Pro/Teams) or a superadmin-issued daily-limit override.',
          code: 'strict_pin_not_allowed',
        }, 403);
      }
    }

    // ── Daily token usage + limit checks ────────────────────────────────────
    // Single query — value is reused for both the 429 gate and the
    // X-Builderforce-Daily-Tokens-* response headers callers use to
    // pre-emptively throttle before they hit the gate.
    //
    // Effective plan-level cap (per tenant, per UTC day):
    //   override === -1   → unlimited (gate skipped, no headers emitted)
    //   override >= 0     → use override
    //   override === null → use plan default
    //   Superadmins (sa: true) also bypass — admin diagnostic tools (e.g. the
    //   /admin?tab=usage AI Analyze button) must not be gated by tenant caps.
    const planLimitDefault = getLimits(toTenantPlan(access.effectivePlan)).tokenDailyLimit;
    const override = access.tokenDailyLimitOverride;
    const planUnlimited = override === -1 || access.isSuperadmin;
    const planDailyLimit = planUnlimited
      ? 0  // 0 disables the plan gate below; real "unlimited" is encoded by planUnlimited
      : (override !== null && override >= 0 ? override : planLimitDefault);
    const needsTenantUsageQuery =
      planDailyLimit > 0 || (access.agentHostId !== null && access.agentHostTokenDailyLimit !== null);

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

      // Per-agentHost cap (optional, set per-agentHost in portal)
      if (access.agentHostId !== null && access.agentHostTokenDailyLimit !== null) {
        if (usageToday >= access.agentHostTokenDailyLimit) {
          return c.json({
            error: `Per-agentHost daily token limit reached (${access.agentHostTokenDailyLimit.toLocaleString()} tokens). Increase the limit in the Builderforce portal under AgentHosts → Settings.`,
            code: 'agent_host_token_limit_exceeded',
            // `terminal` tells consumer-side fallback chains "no point retrying
            // this on a different model — the cap is per-tenant/agentHost, not per-model."
            terminal: true,
            retryAfter: secondsUntilNextUtcMidnight(),
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
          terminal: true,
          retryAfter: secondsUntilNextUtcMidnight(),
        }, 429, { 'Retry-After': String(secondsUntilNextUtcMidnight()) });
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

    const llmProduct = productNameForPlan(access.effectivePlan, access.premiumOverride);
    // Premium override forces the Pro OpenRouter key path; otherwise plan-driven.
    const isPro = access.premiumOverride || access.effectivePlan !== 'free';

    // ── Output cap ───────────────────────────────────────────────────────────
    // Clamp max_tokens to the plan ceiling so a misconfigured client can't ask
    // for a giant generation and bill a full 128K-token output in one shot.
    // Clamp down rather than reject (the request still succeeds, just bounded).
    // Superadmins and unlimited daily-limit overrides (-1) bypass.
    const maxTokensCeiling = getLimits(toTenantPlan(access.effectivePlan)).maxTokensPerRequest;
    const maxTokensExempt = access.isSuperadmin || access.tokenDailyLimitOverride === -1;
    if (!maxTokensExempt && maxTokensCeiling > 0
        && typeof body.max_tokens === 'number' && body.max_tokens > maxTokensCeiling) {
      body.max_tokens = maxTokensCeiling;
    }

    // Validate required key for the active plan up-front so callers get a clear 503.
    const requiredKey = isPro ? c.env.OPENROUTER_API_KEY_PRO ?? c.env.OPENROUTER_API_KEY : c.env.OPENROUTER_API_KEY;
    if (!requiredKey) {
      return c.json({
        error: isPro
          ? 'LLM proxy not configured (missing OPENROUTER_API_KEY_PRO or OPENROUTER_API_KEY)'
          : 'LLM proxy not configured (missing OPENROUTER_API_KEY)',
      }, 503);
    }

    const traceId = newTraceId();
    const consumerRequestId = c.req.header('x-request-id') ?? c.req.header('x-correlation-id') ?? null;
    const requestIp = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? null;
    const reqOrigin = c.req.header('Origin') ?? null;
    const reqUserAgent = c.req.header('User-Agent') ?? null;

    const service = llmProxyForPlan(c.env, access.effectivePlan, access.premiumOverride);
    const result = await service.complete(body, undefined, traceId);

    // Clone upstream headers we care about
    const upstreamHeaders = new Headers();
    const contentType = result.response.headers.get('content-type');
    if (contentType) upstreamHeaders.set('content-type', contentType);
    upstreamHeaders.set('x-builderforce-model', result.resolvedModel);
    upstreamHeaders.set('x-builderforce-trace-id', traceId);
    upstreamHeaders.set('x-builderforce-vendor', result.resolvedVendor);
    upstreamHeaders.set('x-builderforce-retries', String(result.retries));
    upstreamHeaders.set('x-builderforce-product', llmProduct);
    upstreamHeaders.set('x-builderforce-effective-plan', access.effectivePlan);
    if (access.premiumOverride) upstreamHeaders.set('x-builderforce-premium', 'true');
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

      // Full diagnostic trace (builder-side only). For streams the completion
      // body isn't captured here; identity, timing, attempts, and the chain are.
      logTrace(c.env, c.executionCtx, {
        traceId, surface: 'chat',
        tenantId: access.tenantId, userId: access.userId, agentHostId: access.agentHostId,
        tenantApiKeyId: access.tenantApiKeyId, llmProduct,
        effectivePlan: access.effectivePlan, premiumOverride: access.premiumOverride,
        result, streamed: true, useCase: callerUseCase, idempotencyKey,
        consumerRequestId, requestIp, origin: reqOrigin, userAgent: reqUserAgent,
        requestBody: body as unknown as Record<string, unknown>, callerMetadata,
        responseBody: null, errorMessage: null,
      });

      // Wrap the stream to capture usage from the final SSE chunk
      const instrumentedStream = wrapStreamForUsage(
        result.response.body,
        (usage) => logUsage(
          c.env, c.executionCtx, access.tenantId, access.userId, llmProduct,
          result.resolvedModel, result.retries, true, usage,
          callerMetadata, idempotencyKey, callerUseCase, access.tenantApiKeyId,
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
      access.tenantApiKeyId,
    );

    // Surface the trace id inside the error envelope too, so a consumer hitting
    // a failure can quote `error.details.correlationId` straight back for a
    // superadmin lookup. Full diagnostics stay builder-side.
    const upstreamErr = (upstream as { error?: { message?: unknown; details?: Record<string, unknown> } }).error;
    const traceErrorMessage = upstreamErr ? String(upstreamErr.message ?? '') : null;
    if (upstreamErr) {
      upstreamErr.details = { ...(upstreamErr.details ?? {}), correlationId: traceId, traceId };
    }

    // Full diagnostic trace (builder-side only).
    logTrace(c.env, c.executionCtx, {
      traceId, surface: 'chat',
      tenantId: access.tenantId, userId: access.userId, agentHostId: access.agentHostId,
      tenantApiKeyId: access.tenantApiKeyId, llmProduct,
      effectivePlan: access.effectivePlan, premiumOverride: access.premiumOverride,
      result, streamed: false,
      usage: result.usage ?? null,
      useCase: callerUseCase, idempotencyKey,
      consumerRequestId, requestIp, origin: reqOrigin, userAgent: reqUserAgent,
      requestBody: body as unknown as Record<string, unknown>, callerMetadata,
      responseBody: upstream, errorMessage: traceErrorMessage,
    });

    return c.json(
      {
        ...upstream,
        _builderforce: {
          traceId,
          resolvedModel:  result.resolvedModel,
          resolvedVendor: result.resolvedVendor,
          retries:        result.retries,
          // Per-attempt breakdown (model + vendor + code) when the cascade
          // retried before this success. Empty when the first model answered.
          // Lets callers see which vendor recovered the request and detect
          // single-vendor concentration patterns over time.
          ...(result.failovers.length > 0 ? { failovers: result.failovers } : {}),
          pool:          modelPoolForPlan(access.effectivePlan, access.premiumOverride).length,
          product:       llmProduct,
          effectivePlan: access.effectivePlan,
          ...(access.premiumOverride ? { premium: true } : {}),
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
  // GET /v1/catalog — PUBLIC model catalog for the marketing /models page.
  // No auth: this is the same OpenRouter catalog we proxy, served through the
  // read-through cache so the browser never calls OpenRouter directly and we
  // keep one shared, invalidatable copy. Pricing is OpenRouter's verbatim —
  // our Pro plan proxies these models at the same per-token price.
  // -----------------------------------------------------------------------
  router.get('/v1/catalog', async (c) => {
    const data = await getCatalogCached(c.env);
    // Cache at the edge too — the payload is identical for every visitor.
    c.header('Cache-Control', 'public, max-age=300, s-maxage=3600');
    return c.json({ object: 'list', data });
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
    const premiumOverride = access?.premiumOverride === true;
    const productName = productNameForPlan(effectivePlan, premiumOverride);
    // Premium override implies the Pro key path (same as in /v1/chat/completions).
    const isPro = premiumOverride || effectivePlan !== 'free';

    const requiredKey = isPro ? c.env.OPENROUTER_API_KEY_PRO ?? c.env.OPENROUTER_API_KEY : c.env.OPENROUTER_API_KEY;
    if (!requiredKey) {
      return c.json({
        configured: false,
        product: productName,
        effectivePlan,
        ...(premiumOverride ? { premium: true } : {}),
        models: modelPoolForPlan(effectivePlan, premiumOverride),
      });
    }

    const service = llmProxyForPlan(c.env, effectivePlan, premiumOverride);
    return c.json({
      configured: true,
      object: 'list',
      product: productName,
      effectivePlan,
      ...(premiumOverride ? { premium: true } : {}),
      data: await service.status(),
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
      return respondToAccessError(c, err);
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
        COALESCE(user_id, 'agentHost-runtime') AS user_id,
        COUNT(*)::int                     AS requests,
        SUM(total_tokens)::bigint         AS total_tokens
      FROM llm_usage_log
      WHERE tenant_id = ${access.tenantId}
        AND created_at >= NOW() - (${days} || ' days')::interval
      GROUP BY COALESCE(user_id, 'agentHost-runtime')
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
      return respondToAccessError(c, err);
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
        ? { ...(result.body as Record<string, unknown>), _builderforce: { product: productNameForPlan(access.effectivePlan, access.premiumOverride), effectivePlan: access.effectivePlan, ...(access.premiumOverride ? { premium: true } : {}) } }
        : result.body,
      result.status as 200,
    );
  });

  // -----------------------------------------------------------------------
  // POST /v1/images/generations — OpenAI-compatible image generation.
  // Cascades free Together → premium FluxAPI fallback.
  // -----------------------------------------------------------------------
  router.post('/v1/images/generations', async (c) => {
    let access: TenantAccess;
    try {
      access = await requireTenantAccess(c);
    } catch (err) {
      return respondToAccessError(c, err);
    }

    const body = await c.req.json<ImageGenerationRequest>().catch(() => null);
    if (!body || typeof body.prompt !== 'string' || body.prompt.trim().length === 0) {
      return c.json({ error: '`prompt` is required and must be a non-empty string' }, 400);
    }

    // Validate that at least one image vendor key is bound before dispatching.
    if (!c.env.TOGETHER_API_KEY && !c.env.FLUX_API_KEY) {
      return c.json({
        error: 'Image generation not configured (missing TOGETHER_API_KEY and FLUX_API_KEY)',
      }, 503);
    }

    // Capture SDK transport metadata for usage logging — stripped before vendor dispatch
    // by `stripStandardFields` in ImageProxyService.
    const bodyAny = body as Record<string, unknown>;
    const callerMetadata = (bodyAny.metadata as Record<string, unknown> | undefined) ?? null;
    const callerUseCase  = typeof bodyAny.useCase === 'string' ? bodyAny.useCase : null;
    const idempotencyKey = c.req.header('Idempotency-Key') ?? null;

    const productName = imageProductNameForPlan(access.effectivePlan, access.premiumOverride);
    const service = imageProxyForPlan(c.env, access.effectivePlan, access.premiumOverride);
    const result = await service.generate(body);

    // Image accounting: charge a flat per-image token estimate against the
    // tenant's daily token budget. Keeps image-gen subject to the same
    // `plan_token_limit_exceeded` gate as chat without needing a separate
    // image-only ledger. ~1000 tokens per generated image is a deliberate
    // overestimate vs the actual compute cost — favours conservative caps.
    const IMAGE_TOKEN_COST = 1000;
    const imagesReturned = Math.max(result.body.data.length, 0);
    const billedTokens = imagesReturned > 0 ? imagesReturned * IMAGE_TOKEN_COST : 0;
    const cascadeExhausted = result.body.data.length === 0;

    // Log usage (always, even on cascade-exhausted runs so failure rates are visible).
    logFailovers(c.env, c.executionCtx, result.failovers);
    logUsage(
      c.env,
      c.executionCtx,
      access.tenantId,
      access.userId,
      productName,
      result.resolvedModel,
      result.retries,
      false,
      { promptTokens: 0, completionTokens: 0, totalTokens: billedTokens },
      callerMetadata,
      idempotencyKey,
      callerUseCase,
      access.tenantApiKeyId,
    );

    if (cascadeExhausted) {
      // All vendors failed — surface a 429 with the failover breakdown so callers
      // can decide whether to retry on a different prompt.
      return c.json({
        error: {
          message: 'Image vendor cascade exhausted. Retry shortly or simplify the prompt.',
          code: 429,
          type: 'rate_limit_error',
          details: { failovers: result.failovers },
        },
      }, 429);
    }

    return c.json({
      created: result.body.created,
      data: result.body.data,
      model: result.body.model,
      _builderforce: {
        resolvedModel: result.resolvedModel,
        resolvedVendor: result.resolvedVendor,
        retries: result.retries,
        ...(result.failovers.length > 0 ? { failovers: result.failovers } : {}),
        product: productName,
        effectivePlan: access.effectivePlan,
        ...(access.premiumOverride ? { premium: true } : {}),
        ...(callerUseCase  ? { useCase:  callerUseCase  } : {}),
        ...(callerMetadata ? { metadata: callerMetadata as Record<string, string> } : {}),
        ...(c.req.header('x-request-id') ? { requestId: c.req.header('x-request-id') } : {}),
      },
    });
  });

  // -----------------------------------------------------------------------
  // GET /v1/health
  // -----------------------------------------------------------------------
  router.get('/v1/health', (c) =>
    c.json({
      status: 'ok',
      service: 'builderforceLLM',
      pool: FREE_MODEL_POOL.length,
      proPool: PRO_MODEL_POOL.length,
      imagePool: FREE_IMAGE_MODEL_POOL.length,
      imageProPool: PAID_IMAGE_MODEL_POOL.length,
    }),
  );

  return router;
}
