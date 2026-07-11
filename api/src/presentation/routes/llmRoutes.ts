/**
 * builderforceLLM routes — OpenAI-compatible LLM proxy.
 *
 * POST  /v1/chat/completions   – proxied chat completion (multi-vendor cascade)
 * GET   /v1/models             – list the active model pool + cooldown state
 * GET   /v1/usage              – tenant token consumption analytics
 * GET   /v1/health             – health check
 */
import { Hono, type Context } from 'hono';
import { and, desc, eq, gte, inArray, notInArray, sql } from 'drizzle-orm';
import type { Env, HonoEnv } from '../../env';
import {
  llmProxyForPlan,
  newTraceId,
  productNameForPlan,
  modelPoolForPlan,
  codingModelsForPlan,
  resolveStrictPin,
  estimateRequestTokens,
  CODING_BACKSTOP_MODELS,
  FREE_MODEL_POOL,
  PRO_MODEL_POOL,
  type ChatCompletionRequest,
  type LlmUsage,
} from '../../application/llm/LlmProxyService';
import { resolvePaidOverflowCapMillicents } from '../../application/llm/usageLedger';
import { classifyReplyAccount } from '../../application/llm/replyProvenance';
import { USAGE_KIND } from '../../application/llm/usageSource';
import { logTrace, backfillTraceUsage } from '../../application/llm/traceLogger';
import { recordUsageRow, type UsageAttribution, type RecordUsageRow, type UsageSurface } from '../../application/llm/usageLedger';
import { pickUsage, vendorForModel, getCatalog } from '../../application/llm/vendors';
import {
  dispatchEmbeddingVendor,
  EmbeddingCascadeExhaustedError,
} from '../../application/llm/embeddingVendors';
import { VendorFatalError } from '../../application/llm/vendors/types';
import { getCatalogCached } from '../../application/llm/modelCatalog';
import {
  imageProxyForPlan,
  imageProductNameForPlan,
  FREE_IMAGE_MODEL_POOL,
  PAID_IMAGE_MODEL_POOL,
  IMAGE_TOKEN_COST,
  IMAGE_PRODUCT_NAMES,
  type ImageGenerationRequest,
} from '../../application/llm/ImageProxyService';
import { buildDatabase } from '../../infrastructure/database/connection';
import { resolveTenantModel, TENANT_MODEL_REF_PREFIX } from '../../application/llm/tenantModelService';
import { resolveProjectEvermindModelPin, PROJECT_EVERMIND_MODEL_PREFIX } from '../../application/llm/projectEvermind';
import { recordClientRunOutcome, type OutcomeSource, type TerminalStatus } from '../../application/runtime/scoreRunOutcome';
import { resolveWorkforceModel, WORKFORCE_MODEL_REF_PREFIX } from '../../application/agent/agentPrompt';
import { llmUsageLog, llmFailoverLog, tenants, tenantMembers, agentHosts, tenantApiKeys, users, projects, tasks, runModelOutcomes } from '../../infrastructure/database/schema';
import { getRoutingTable, parseScopeToken, scopeToken } from '../../application/llm/routingTable';
import { actionTypeLabel, type ActionType } from '../../application/llm/actionTypes';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import {
  buildBuilderInsightsSnapshot,
  getCachedBuilderInsightsSnapshot,
} from '../../application/insights/builderInsights';
import { originAllowed, deserializeScopes } from '../../application/llm/tenantApiKeyService';
import { listToolsForTenant, callMcpTool } from '../../application/llm/mcpExtensionService';
import { listBuiltinTools, callBuiltinTool, BUILTIN_EXTENSION_ID } from '../../application/llm/builtinMcpService';
import {
  setTenantProviderKey,
  setTenantProviderOAuth,
  resolveAnthropicAuth,
  resolveTenantVendorKeys,
  resolveTenantLlmCredentials,
  listTenantProviderKeys,
  deleteTenantProviderKey,
  isSupportedProvider,
  byoVendorIdSet,
  providersFromCredentials,
  formatByoUnresolvedHeader,
  providersConnectedInOtherWorkspaces,
  SUPPORTED_PROVIDERS,
  type TenantVendorKeys,
  type LlmProvider,
} from '../../application/llm/tenantProviderKeyService';
import {
  generatePkce,
  generateState,
  buildAuthorizeUrl,
  parsePastedCode,
  exchangeAnthropicCode,
  withClaudeCodeSystemPrompt,
  ANTHROPIC_OAUTH_BETA,
} from '../../application/llm/anthropicOAuth';
import { parseAnthropicSseUsage } from '../../application/llm/anthropicSseUsage';
import {
  anthropicToOpenAiRequest,
  openAiToAnthropicMessage,
  createAnthropicStreamEncoder,
  pipeOpenAiSseToAnthropic,
  type AnthropicMessagesRequest,
} from '../../application/llm/anthropicMessagesBridge';
import { resolveKeyCached, jwtMembershipHash } from '../../infrastructure/auth/keyResolutionCache';
import type { FailoverEvent } from '../../application/llm/LlmProxyService';
import { verifyJwt, signJwt } from '../../infrastructure/auth/JwtService';
import { hashSecret } from '../../infrastructure/auth/HashService';
import { TenantRole, TenantPlan, TenantBillingStatus } from '../../domain/shared/types';
import { getLimits, resolveImageCreditsDailyLimit, GUEST_CHAT_LIMITS } from '../../domain/tenant/PlanLimits';
import { evaluateFrontierAccess } from '../../domain/tenant/planFeatures';
import { GuestChatService } from '../../application/guest/GuestChatService';
import { verifyGuestToken, guestBrainEnabled, GUEST_TOKEN_PREFIX } from '../../application/guest/guestToken';
import { resolveEffectivePlan } from '../../domain/tenant/effectivePlan';
import {
  utcDayStart,
  secondsUntilNextUtcMonth,
  sumTenantTextTokens,
} from '../../application/llm/tokenUsage';
import { getTenantTokenAvailability, tokenGateUpgradeHint } from '../../application/llm/tenantTokenAvailability';

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
/** KV key for an idempotency-replay cache entry [1232] — tenant-scoped so keys
 *  never collide across tenants. Value: `{ status, body }` of the original 2xx. */
const idempotencyCacheKey = (tenantId: number, key: string): string => `idem:${tenantId}:${key}`;

// Fire-and-forget usage write. Takes the RecordUsageRow object directly (named
// fields) — was 14 positional params, refactored to an options object so adding
// fields like `traceId` [1299] can't silently misalign a call site (tsc checks
// each named field). The hot logging path stays inside ctx.waitUntil.
function logUsage(
  env: HonoEnv['Bindings'],
  ctx: ExecutionContext,
  row: RecordUsageRow,
): void {
  ctx.waitUntil(recordUsageRow(buildDatabase(env), env as Env, row));
}

/**
 * Which modality produced a gateway call, for the usage row's `surface` (drives
 * the BYO metering exemption — own-machine on-prem/VSIX BYO is free, cloud is
 * charged). A client may hint via `X-Builderforce-Surface`; otherwise an
 * agentHost-authenticated call is on-prem by definition, and everything else is
 * treated as web. (Cloud runs never come through this HTTP path — they record via
 * recordCloudUsage with surface 'cloud'.) */
const KNOWN_SURFACES: readonly UsageSurface[] = ['web', 'vsix', 'on_prem', 'cloud', 'sdk'];
function resolveUsageSurface(c: Context<HonoEnv>, access: TenantAccess): UsageSurface {
  const hinted = (c.req.header('x-builderforce-surface') ?? '').toLowerCase();
  if ((KNOWN_SURFACES as readonly string[]).includes(hinted)) return hinted as UsageSurface;
  return access.agentHostId != null ? 'on_prem' : 'web';
}

/** A tenant's connected-provider list → the pinnable BYO models (best-effort
 *  catalog projection) their picker should offer, as `<vendor>/<id>` refs. */
export function byoModelsFor(providers: readonly LlmProvider[]): Array<{ id: string; vendor: string; tier: string; contextWindow?: number }> {
  const vendorIds = byoVendorIdSet(providers);
  if (vendorIds.size === 0) return [];
  return getCatalog()
    .filter((e) => vendorIds.has(e.vendor))
    .map((e) => ({ id: `${e.vendor}/${e.id}`, vendor: e.vendor, tier: e.tier, ...(e.contextWindow ? { contextWindow: e.contextWindow } : {}) }));
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
  billingStatus: 'none' | 'pending' | 'active' | 'trialing' | 'past_due' | 'cancelled';
  effectivePlan: 'free' | 'pro' | 'teams';
  /**
   * Superadmin override for the plan-level daily token cap.
   *   null → use plan default
   *   -1   → unlimited (skip the gate)
   *   >= 0 → use this value
   */
  tokenDailyLimitOverride: number | null;
  /**
   * Per-tenant daily ceiling on paid-overflow spend (millicents), or null to use
   * the plan default. -1 = unlimited (gate skipped). See migration 0130 and
   * DEFAULT_PAID_OVERFLOW_CAP_MILLICENTS.
   */
  paidOverflowDailyCap: number | null;
  /**
   * Per-tenant daily image-generation credit override (1 credit = 1 returned
   * image), or null to use the plan default. -1 = unlimited. Metered separately
   * from the text token budget (migration 0131). See resolveImageCreditsDailyLimit.
   */
  imageCreditsDailyLimit: number | null;
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
export async function resolveTenantPlan(
  env: Env,
  tenantId: number,
): Promise<Pick<TenantAccess, 'plan' | 'billingStatus' | 'effectivePlan' | 'tokenDailyLimitOverride' | 'paidOverflowDailyCap' | 'imageCreditsDailyLimit' | 'premiumOverride'>> {
  const db = buildDatabase(env);
  const [tenantRow] = await db
    .select({
      id: tenants.id,
      plan: tenants.plan,
      billingStatus: tenants.billingStatus,
      trialEndsAt: tenants.trialEndsAt,
      tokenDailyLimitOverride: tenants.tokenDailyLimitOverride,
      paidOverflowDailyCap: tenants.paidOverflowDailyCap,
      imageCreditsDailyLimit: tenants.imageCreditsDailyLimit,
      premiumOverride: tenants.premiumOverride,
    })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  if (!tenantRow) throw new Error('Tenant not found');

  const plan = (tenantRow.plan ?? 'free') as TenantAccess['plan'];
  const billingStatus = (tenantRow.billingStatus ?? 'none') as TenantAccess['billingStatus'];
  // One shared resolver: 'active' (paid) OR an unexpired trial → the tenant's
  // plan; everything else → free. Keeps the gateway aligned with the plan guard.
  const effectivePlan = resolveEffectivePlan({
    plan: plan as TenantPlan,
    billingStatus: billingStatus as TenantBillingStatus,
    trialEndsAt: tenantRow.trialEndsAt ?? null,
  }) as TenantAccess['effectivePlan'];

  return {
    plan,
    billingStatus,
    effectivePlan,
    tokenDailyLimitOverride: tenantRow.tokenDailyLimitOverride ?? null,
    paidOverflowDailyCap: tenantRow.paidOverflowDailyCap ?? null,
    imageCreditsDailyLimit: tenantRow.imageCreditsDailyLimit ?? null,
    premiumOverride: tenantRow.premiumOverride === true,
  };
}

// The psychometric-persona entitlement check moved to the shared feature gate
// (`presentation/middleware/featureGate.ts` → `tenantHasFeature(..., 'psychometricPersona')`)
// so every paid-plan gate — plan grant, premium override, AND superadmin bypass —
// runs through one evaluator. `resolveTenantPlan` (below/above) stays here as the
// gateway's plan resolver; the gate imports it.

/** What a passing {@link enforceTokenCaps} returns for the response headers/body. */
interface TokenCapUsage {
  usageToday: number;
  planDailyLimit: number;
  usageMonth: number;
  planMonthlyLimit: number;
}

/**
 * Enforce the per-tenant token caps — daily (plan + optional per-agentHost) AND
 * monthly (the plan allowance the sidebar meter fills against). Shared by
 * `/v1/chat/completions` and the our-models branch of `/v1/messages` so neither
 * surface can bill on our pool without the gate. Returns the 429 `Response` to
 * send (a cap exceeded), or the usage numbers for the response headers when the
 * request may proceed.
 *
 * The plan cap decision + the superadmin(-owned-account) bypass are NOT implemented
 * here — they come from the ONE shared entry {@link getTenantTokenAvailability} (the
 * same the cron sweeps + Run-now use), so there is no parallel cap logic to drift.
 * This function only layers the gateway-specific per-agentHost daily cap on top and
 * shapes the 429 bodies. Usage totals are **cache-discounted** (cache_read ~0.1x,
 * cache_creation ~1.25x) inside the shared accountant.
 */
async function enforceTokenCaps(
  c: Context<HonoEnv>,
  access: TenantAccess,
): Promise<{ blocked: Response } | TokenCapUsage> {
  const db = buildDatabase(c.env);

  // Plan-level caps + the superadmin(-owned-account) bypass come from the ONE shared
  // entry — the SAME `getTenantTokenAvailability` the cron manager sweep, autonomous
  // executor, and Run-now gate use — so there is a single definition of "out of
  // tokens" and the superadmin rule can never diverge between paths. We hand it the
  // already-resolved principal superadmin flag (`access.isSuperadmin` — covers the
  // `bfk_*` key-creator that has no user row, so no user query is issued) and the
  // acting user id; the resolver additionally treats a tenant OWNED by a superadmin as
  // unlimited (cached), and only scans usage for a genuinely capped tenant.
  const availability = await getTenantTokenAvailability(
    db,
    access.tenantId,
    {
      actingUserId: access.userId,
      actingIsSuperadmin: access.isSuperadmin,
      // The gateway already resolved the plan snapshot on `access` — reuse it so the
      // shared resolver skips a redundant tenant-row read on this hot path.
      planSnapshot: { effectivePlan: access.effectivePlan, tokenDailyLimitOverride: access.tokenDailyLimitOverride },
    },
    c.env,
  );

  // Header/meter convention: `-1` (unlimited) surfaces as 0.
  const planDailyLimit = availability.dailyLimit > 0 ? availability.dailyLimit : 0;
  const planMonthlyLimit = availability.monthlyLimit > 0 ? availability.monthlyLimit : 0;
  const planUnlimited = availability.dailyLimit <= 0 && availability.monthlyLimit <= 0;

  // Per-agentHost daily cap — a gateway-only operational limit set per agentHost in the
  // portal, INDEPENDENT of the tenant plan (so it still applies even to an unlimited /
  // superadmin tenant, unchanged from before). It needs today's usage: the shared
  // resolver already scanned it for a capped tenant; for an unlimited tenant it returns
  // 0, so scan once here only when a host cap is actually set.
  const hasHostCap = access.agentHostId !== null && access.agentHostTokenDailyLimit !== null;
  let usageToday = availability.usageToday;
  const usageMonth = availability.usageMonth;
  if (hasHostCap && planUnlimited) {
    usageToday = await sumTenantTextTokens(db, access.tenantId, utcDayStart());
  }
  if (hasHostCap && usageToday >= (access.agentHostTokenDailyLimit as number)) {
    return {
      blocked: c.json({
        error: `Per-agentHost daily token limit reached (${(access.agentHostTokenDailyLimit as number).toLocaleString()} tokens). Increase the limit in the Builderforce portal under AgentHosts → Settings.`,
        code: 'agent_host_token_limit_exceeded',
        terminal: true,
        retryAfter: secondsUntilNextUtcMidnight(),
      }, 429),
    };
  }

  // Plan caps — the exhaustion verdict is the shared resolver's (daily precedence).
  if (!availability.hasTokens && availability.reason === 'daily_exhausted') {
    const upgradeHint = tokenGateUpgradeHint(access.effectivePlan, 'daily');
    return {
      blocked: c.json({
        error: `Plan daily token limit reached (${planDailyLimit.toLocaleString()} tokens).${upgradeHint}`,
        code: 'plan_token_limit_exceeded',
        plan: access.effectivePlan,
        dailyLimit: planDailyLimit,
        usedToday: usageToday,
        terminal: true,
        retryAfter: secondsUntilNextUtcMidnight(),
      }, 429, { 'Retry-After': String(secondsUntilNextUtcMidnight()) }),
    };
  }

  // Plan monthly cap — the consumption-meter allowance. Graceful backpressure:
  // the tenant's already-processed data stays fully queryable; only NEW gateway
  // spend on our pool is paused until the month resets (or they upgrade).
  if (!availability.hasTokens && availability.reason === 'monthly_exhausted') {
    const upgradeHint = tokenGateUpgradeHint(access.effectivePlan, 'monthly');
    const retryAfter = secondsUntilNextUtcMonth();
    return {
      blocked: c.json({
        error: `Plan monthly token allowance reached (${planMonthlyLimit.toLocaleString()} tokens).${upgradeHint}`,
        code: 'plan_monthly_token_limit_exceeded',
        plan: access.effectivePlan,
        monthlyLimit: planMonthlyLimit,
        usedThisMonth: usageMonth,
        terminal: true,
        retryAfter,
      }, 429, { 'Retry-After': String(retryAfter) }),
    };
  }

  return { usageToday, planDailyLimit, usageMonth, planMonthlyLimit };
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
async function isPaidOverflowExhausted(
  c: Context<HonoEnv>,
  access: TenantAccess,
): Promise<boolean> {
  if (access.isSuperadmin) return false;
  const cap = resolvePaidOverflowCapMillicents(access.paidOverflowDailyCap, access.effectivePlan);
  if (cap < 0) return false; // unlimited
  try {
    const db = buildDatabase(c.env);
    const [row] = await db
      .select({ spent: sql<number>`COALESCE(SUM(${llmUsageLog.costUsdMillicents}), 0)` })
      .from(llmUsageLog)
      .where(and(
        eq(llmUsageLog.tenantId, access.tenantId),
        eq(llmUsageLog.paidOverflow, true),
        gte(llmUsageLog.createdAt, utcDayStart()),
      ));
    return Math.max(0, Number(row?.spent ?? 0)) >= cap;
  } catch {
    return false; // fail open — never let the cap query break a request
  }
}

/**
 * Image-generation daily credit gate (migration 0131). Returns a blocking JSON
 * Response when the tenant has spent its full image-credit budget for the UTC
 * day, else null. Credits = returned images; counted from today's image-product
 * usage rows (`total_tokens / IMAGE_TOKEN_COST`). Independent of the chat token
 * cap — heavy image use no longer starves the text budget, and vice-versa.
 * Best-effort: a query error fails OPEN (availability over a perfectly precise
 * cap), matching `isPaidOverflowExhausted`.
 */
async function enforceImageCreditCap(
  c: Context<HonoEnv>,
  access: TenantAccess,
): Promise<Response | null> {
  if (access.isSuperadmin) return null;
  const limit = resolveImageCreditsDailyLimit(access.imageCreditsDailyLimit, toTenantPlan(access.effectivePlan));
  if (limit < 0) return null; // unlimited
  try {
    const db = buildDatabase(c.env);
    const [row] = await db
      .select({ tokens: sql<number>`COALESCE(SUM(${llmUsageLog.totalTokens}), 0)` })
      .from(llmUsageLog)
      .where(and(
        eq(llmUsageLog.tenantId, access.tenantId),
        inArray(llmUsageLog.llmProduct, [...IMAGE_PRODUCT_NAMES]),
        gte(llmUsageLog.createdAt, utcDayStart()),
      ));
    const usedCredits = Math.floor(Number(row?.tokens ?? 0) / IMAGE_TOKEN_COST);
    if (usedCredits >= limit) {
      const upgradeHint = access.effectivePlan === 'free'
        ? ' Upgrade to Pro at builderforce.ai/pricing for a higher image budget.'
        : '';
      return c.json({
        error: `Daily image generation limit reached (${limit} image${limit === 1 ? '' : 's'} / day).${upgradeHint}`,
        code: 'image_credit_limit_exceeded',
        plan: access.effectivePlan,
        dailyLimit: limit,
        usedToday: usedCredits,
        terminal: true,
        retryAfter: secondsUntilNextUtcMidnight(),
      }, 429, { 'Retry-After': String(secondsUntilNextUtcMidnight()) });
    }
    return null;
  } catch {
    return null; // fail open
  }
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
      ...(await resolveTenantPlan(c.env, agentHost.tenantId)),
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
          // A key minted by a superadmin (e.g. the IDE editor key) inherits the
          // superadmin's unlimited budget — mirrors the JWT path's users.isSuperadmin.
          creatorIsSuperadmin: users.isSuperadmin,
        })
        .from(tenantApiKeys)
        .leftJoin(users, eq(users.id, tenantApiKeys.createdByUserId))
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
      return { ok: true, payload: { id: r.id, tenantId: r.tenantId, allowedOrigins: allowlist, scopes: deserializeScopes(r.scopes), isSuperadmin: r.creatorIsSuperadmin === true } };
    });

    if (!resolved.ok) throw new Error(resolved.reason);
    const { id: keyId, tenantId: keyTenantId, allowedOrigins: allowlist, scopes: keyScopes, isSuperadmin: keyIsSuperadmin } =
      resolved.payload as { id: string; tenantId: number; allowedOrigins: string[] | null; scopes?: string[] | null; isSuperadmin?: boolean };

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
      isSuperadmin: keyIsSuperadmin === true,
      ...(await resolveTenantPlan(c.env, keyTenantId)),
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
    // KV-cached membership resolution (~1ms hit vs ~30-80ms Neon round-trip).
    // Keyed on tenant+user (not the raw token) so every JWT the user holds for
    // this tenant shares one entry. Short TTL — see `JWT_TTL_SECONDS` — because
    // tenant_members has no single mutation hook; a removed/demoted member
    // keeps cached access for at most that window. Falls through to DB when
    // AUTH_CACHE_KV is unbound.
    const resolved = await resolveKeyCached(
      c.env,
      'jwt',
      jwtMembershipHash(payload.tid, payload.sub),
      async () => {
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
        if (!membership) return { ok: false, reason: 'User is not an active member of this tenant' };
        return { ok: true, payload: { isSuperadmin: membership.isSuperadmin === true } };
      },
    );

    if (!resolved.ok) throw new Error(resolved.reason);
    dbIsSuperadmin = (resolved.payload as { isSuperadmin: boolean }).isSuperadmin === true;
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
    ...(await resolveTenantPlan(c.env, payload.tid)),
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

/** A completion whose body carries `tools` IS an agentic tool-loop (the VS Code
 *  Brain chat, on-prem hosts, any tool-calling SDK caller) — as opposed to a plain
 *  chat completion. This is the discriminator for the coding capability floor. */
function isAgenticToolTurn(body: { tools?: unknown }): boolean {
  const tools = (body as { tools?: unknown[] }).tools;
  return Array.isArray(tools) && tools.length > 0;
}

/**
 * Build the gateway completion proxy, applying the agentic capability floor when
 * the turn carries tools. `codingOnly` keeps the failover cascade inside the
 * curated coder pool and `CODING_BACKSTOP_MODELS` floors an exhausted cascade onto
 * a PAID coder — never the general `gemini-flash-lite` guaranteed backstop, which
 * "loops on search and ships no edits" for tool loops. That is the same
 * "free coders first → funded paid floor" ladder the cloud coding agent uses, so
 * an auto-select agentic turn (e.g. the Brain chat) never degrades onto a lite
 * non-coder that narrates edits it never makes. `disablePaidOverflow` still caps
 * paid spend. A plain (non-tool) chat completion keeps the plan-aware general pool
 * (cost over capability) unchanged. Shared by /v1/chat/completions and the
 * /v1/messages our-models branch so both honour the identical ladder.
 */
function proxyForCompletion(
  env: Env,
  access: TenantAccess,
  body: ChatCompletionRequest,
  opts: { disablePaidOverflow: boolean; anthropicOAuthToken?: string | null; tenantVendorKeys?: TenantVendorKeys | null },
): ReturnType<typeof llmProxyForPlan> {
  return llmProxyForPlan(env, access.effectivePlan, access.premiumOverride, {
    disablePaidOverflow: opts.disablePaidOverflow,
    ...(isAgenticToolTurn(body as { tools?: unknown }) ? { codingOnly: true, backstopModels: CODING_BACKSTOP_MODELS } : {}),
    ...(opts.anthropicOAuthToken ? { anthropicOAuthToken: opts.anthropicOAuthToken } : {}),
    ...(opts.tenantVendorKeys ? { tenantVendorKeys: opts.tenantVendorKeys } : {}),
  });
}

/**
 * Guest (logged-out) chat handler for `POST /v1/chat/completions`.
 *
 * A LOGGED-OUT visitor can try the Brain before signing up. Their request
 * carries a `bfguest_*` token (minted at `/api/guest/session`) instead of a
 * tenant JWT, so the main handler routes here BEFORE `requireTenantAccess` — the
 * tenant auth/metering path never sees anonymous traffic. Deliberately minimal
 * and isolated from the tenant machinery:
 *   • cheapest FREE pool, no tool loop, small max_tokens (cost containment);
 *   • metered per visitorId AND per IP (GuestChatService) with a tiny cap;
 *   • NO tenant usage rows written (a guest has no tenant), so guest spend never
 *     touches `llm_usage_log` or any tenant meter.
 * Cap exhaustion returns a 402 the UI turns into a "sign up free to keep going"
 * wall — the whole point of the funnel.
 */
async function handleGuestChat(c: Context<HonoEnv>): Promise<Response> {
  if (!guestBrainEnabled(c.env)) {
    return c.json({ error: 'Guest chat is disabled.', code: 'guest_brain_disabled' }, 503);
  }
  const authHeader = c.req.header('Authorization') ?? '';
  const token = authHeader.slice(7); // strip "Bearer "
  const visitorId = await verifyGuestToken(token, c.env.JWT_SECRET);
  if (!visitorId) {
    return c.json({ error: 'Invalid or expired guest session.', code: 'guest_token_invalid' }, 401);
  }

  const body = await c.req.json<ChatCompletionRequest>().catch(() => null);
  if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
    return c.json({ error: 'messages array is required' }, 400);
  }

  const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? null;
  const guest = new GuestChatService(buildDatabase(c.env));

  const cap = await guest.checkCap(c.env as Env, visitorId, ip);
  if (!cap.allowed) {
    // 429 (not 402) — a guest has no plan to upgrade, so this must NOT trip the
    // paid-plan upgrade modal. The UI shows a "sign up free to keep going" wall,
    // keyed off code `guest_limit_reached`. `terminal` so the client stops.
    return c.json({
      error: cap.reason === 'ip'
        ? 'This device has reached its free guest limit for today. Sign up free to keep going.'
        : `You've used your ${cap.limit} free guest messages for today. Sign up free to keep going.`,
      code: 'guest_limit_reached',
      reason: cap.reason,
      limit: cap.limit,
      terminal: true,
    }, 429);
  }

  // ── Cost containment: cheapest FREE pool, plain chat, clamped output ──────
  const bodyAny = body as Record<string, unknown>;
  delete bodyAny.tools;         // no agentic tool loop for guests (plain chat only)
  delete bodyAny.tool_choice;
  delete bodyAny.model;         // let the FREE pool pick its cheapest cascade
  delete bodyAny.modelStrict;
  if (typeof body.max_tokens !== 'number' || body.max_tokens > GUEST_CHAT_LIMITS.maxTokensPerRequest) {
    body.max_tokens = GUEST_CHAT_LIMITS.maxTokensPerRequest;
  }

  // Consume one message up-front so an aborted/streamed request still counts
  // (an abuser can't dodge the cap by killing the stream mid-flight).
  const remaining = await guest.consumeMessage(c.env as Env, visitorId, ip);

  const requiredKey = c.env.OPENROUTER_API_KEY;
  if (!requiredKey) {
    return c.json({ error: 'LLM proxy not configured (missing OPENROUTER_API_KEY)' }, 503);
  }

  const service = llmProxyForPlan(c.env, 'free');
  const traceId = newTraceId();
  const estimatedTokens = estimateRequestTokens(body.messages, undefined);
  const result = await service.complete(body, undefined, traceId, undefined, { estimatedTokens });

  const headers = new Headers();
  const contentType = result.response.headers.get('content-type');
  if (contentType) headers.set('content-type', contentType);
  headers.set('x-builderforce-model', result.resolvedModel);
  headers.set('x-builderforce-guest', 'true');
  headers.set('x-builderforce-guest-remaining', String(remaining));
  headers.set('x-builderforce-guest-limit', String(cap.limit));

  if (body.stream && result.response.body) {
    headers.set('cache-control', 'no-cache');
    headers.set('connection', 'keep-alive');
    logFailovers(c.env, c.executionCtx, result.failovers);
    const instrumented = wrapStreamForUsage(result.response.body, (usage) => {
      c.executionCtx.waitUntil(guest.addTokens(visitorId, usage.totalTokens ?? 0));
    });
    return new Response(instrumented, { status: result.response.status, headers });
  }

  const upstream = await result.response.json() as Record<string, unknown>;
  logFailovers(c.env, c.executionCtx, result.failovers);
  c.executionCtx.waitUntil(guest.addTokens(visitorId, result.usage?.totalTokens ?? 0));
  return c.json({ ...upstream, _builderforce: { guest: true, remaining, limit: cap.limit } }, result.response.status as 200);
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function createLlmRoutes(): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  // -----------------------------------------------------------------------
  // BYO provider credentials — tenant-managed Anthropic auth. Two shapes:
  //   • API key (paste `sk-ant-…`), or
  //   • Claude Pro/Max SUBSCRIPTION via OAuth (connect your own Claude account).
  // GET    /provider-keys                       → configured providers + auth type
  // PUT    /provider-keys/:provider             → set/replace the API key { apiKey }
  // DELETE /provider-keys/:provider             → remove the credential
  // POST   /provider-keys/anthropic/oauth/start    → begin subscription connect (PKCE)
  // POST   /provider-keys/anthropic/oauth/complete → finish connect { code }
  // -----------------------------------------------------------------------
  router.get('/provider-keys', async (c) => {
    let access: TenantAccess;
    try { access = await requireTenantAccess(c); } catch (err) { return respondToAccessError(c, err); }
    const details = await listTenantProviderKeys(c.env, access.tenantId);
    // `providers` (id array) kept for backward compatibility; `details` carries auth type.
    return c.json({ providers: details.map((d) => d.provider), details });
  });

  router.put('/provider-keys/:provider', async (c) => {
    let access: TenantAccess;
    try { access = await requireTenantAccess(c); } catch (err) { return respondToAccessError(c, err); }
    const provider = c.req.param('provider');
    if (!isSupportedProvider(provider)) return c.json({ error: 'unsupported provider' }, 400);
    const body = await c.req.json<{ apiKey?: string }>().catch(() => ({} as { apiKey?: string }));
    const apiKey = body.apiKey?.trim();
    if (!apiKey) return c.json({ error: 'apiKey is required' }, 400);
    await setTenantProviderKey(c.env, access.tenantId, provider, apiKey, access.userId);
    return c.json({ ok: true, provider });
  });

  // KV key for a pending PKCE verifier, scoped to tenant+state so concurrent
  // connect attempts (or tenants) never collide. Short TTL — the consent flow
  // is interactive but bounded.
  const oauthPkceKey = (tenantId: number, state: string): string => `anthropic_oauth:${tenantId}:${state}`;
  const OAUTH_PKCE_TTL_SECONDS = 900; // 15 min to complete the consent + paste.

  // Begin the Claude subscription connect: mint PKCE + state, stash the verifier
  // server-side (KV), and hand the browser the authorize URL to open. The verifier
  // never leaves the server — only the S256 challenge travels in the URL.
  router.post('/provider-keys/anthropic/oauth/start', async (c) => {
    let access: TenantAccess;
    try { access = await requireTenantAccess(c); } catch (err) { return respondToAccessError(c, err); }
    const kv = (c.env as { AUTH_CACHE_KV?: KVNamespace }).AUTH_CACHE_KV;
    if (!kv) return c.json({ error: 'OAuth connect unavailable (AUTH_CACHE_KV unbound)', code: 'oauth_unconfigured' }, 503);

    const { verifier, challenge } = await generatePkce();
    const state = generateState();
    await kv.put(oauthPkceKey(access.tenantId, state), verifier, { expirationTtl: OAUTH_PKCE_TTL_SECONDS });
    return c.json({ authorizeUrl: buildAuthorizeUrl({ state, challenge }), state });
  });

  // Finish the connect: take the pasted `code#state`, recover the verifier by
  // state (CSRF-checked), exchange for subscription tokens, and store them
  // encrypted. The `state` may ride inside the pasted code or be sent explicitly.
  router.post('/provider-keys/anthropic/oauth/complete', async (c) => {
    let access: TenantAccess;
    try { access = await requireTenantAccess(c); } catch (err) { return respondToAccessError(c, err); }
    const kv = (c.env as { AUTH_CACHE_KV?: KVNamespace }).AUTH_CACHE_KV;
    if (!kv) return c.json({ error: 'OAuth connect unavailable (AUTH_CACHE_KV unbound)', code: 'oauth_unconfigured' }, 503);

    const body = await c.req.json<{ code?: string; state?: string }>().catch(() => ({} as { code?: string; state?: string }));
    const rawCode = body.code?.trim();
    if (!rawCode) return c.json({ error: 'code is required' }, 400);
    const parsed = parsePastedCode(rawCode);
    const state = (parsed.state ?? body.state ?? '').trim();
    if (!state) return c.json({ error: 'state is required (paste the full code shown by Claude)', code: 'oauth_missing_state' }, 400);

    const pkceKvKey = oauthPkceKey(access.tenantId, state);
    const verifier = await kv.get(pkceKvKey);
    if (!verifier) {
      return c.json({ error: 'Connect session expired or invalid — start again.', code: 'oauth_state_expired' }, 400);
    }

    let tokens;
    try {
      tokens = await exchangeAnthropicCode({ code: parsed.code, state, verifier });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'OAuth exchange failed', code: 'oauth_exchange_failed' }, 502);
    }
    // Single-use verifier — drop it whether or not the store succeeds.
    await kv.delete(pkceKvKey).catch(() => { /* best effort */ });
    await setTenantProviderOAuth(c.env, access.tenantId, 'anthropic', tokens, access.userId);
    return c.json({ ok: true, provider: 'anthropic', authType: 'oauth' });
  });

  router.delete('/provider-keys/:provider', async (c) => {
    let access: TenantAccess;
    try { access = await requireTenantAccess(c); } catch (err) { return respondToAccessError(c, err); }
    const provider = c.req.param('provider');
    if (!isSupportedProvider(provider)) return c.json({ error: 'unsupported provider' }, 400);
    await deleteTenantProviderKey(c.env, access.tenantId, provider);
    return c.json({ ok: true });
  });

  // -----------------------------------------------------------------------
  // POST /v1/messages — Anthropic-Messages endpoint for the BuilderForce-V2
  // (Claude Agent SDK) runner, which points ANTHROPIC_BASE_URL at `${api}/llm`.
  // The Agent SDK only needs an Anthropic-Messages-compatible endpoint + any
  // auth token (the Ollama pattern), so a tenant Anthropic key is OPTIONAL:
  //   • BYO key present → pass through to api.anthropic.com with that key.
  //   • No key (default) → serve from OUR multi-vendor model pool by translating
  //     Messages ⇄ our OpenAI-compatible proxy.
  // Usage is metered on the tenant's ledger either way.
  // -----------------------------------------------------------------------
  router.post('/v1/messages', async (c) => {
    let access: TenantAccess;
    try { access = await requireTenantAccess(c); } catch (err) { return respondToAccessError(c, err); }

    const bodyText = await c.req.text();
    let parsed: AnthropicMessagesRequest & { stream?: boolean; model?: unknown };
    try { parsed = JSON.parse(bodyText) as AnthropicMessagesRequest & { stream?: boolean; model?: unknown }; }
    catch { return c.json({ error: 'invalid JSON body' }, 400); }
    const streamed = parsed.stream === true;
    const model = typeof parsed.model === 'string' ? parsed.model : 'unknown';
    const product = productNameForPlan(access.effectivePlan, access.premiumOverride);
    const idempotencyKey = c.req.header('idempotency-key') ?? null;

    // Resolve the tenant's Anthropic credential — an API key OR a connected
    // Claude Pro/Max subscription (OAuth, auto-refreshed). Both pass through to
    // real Anthropic; they differ only in the auth header and (for OAuth) the
    // required Claude Code system-prompt injection + oauth beta header.
    const anthropicAuth = await resolveAnthropicAuth(c.env, access.tenantId);

    // ── BYO Anthropic credential → pass through to real Anthropic ───────────
    if (anthropicAuth) {
      const isOAuth = anthropicAuth.mode === 'oauth';
      // OAuth subscription tokens require the Claude Code identity as the first
      // system block; an API key passes the caller's body through verbatim.
      const outboundBody = isOAuth
        ? JSON.stringify(withClaudeCodeSystemPrompt(parsed as unknown as Record<string, unknown>))
        : bodyText;
      // Merge any caller-supplied beta flags with the mandatory oauth beta.
      const callerBeta = c.req.header('anthropic-beta');
      const betaHeader = isOAuth
        ? (callerBeta && !callerBeta.includes(ANTHROPIC_OAUTH_BETA) ? `${callerBeta},${ANTHROPIC_OAUTH_BETA}` : ANTHROPIC_OAUTH_BETA)
        : callerBeta;
      const upstream = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(isOAuth
            ? { authorization: `Bearer ${anthropicAuth.accessToken}` }
            : { 'x-api-key': anthropicAuth.key }),
          'anthropic-version': c.req.header('anthropic-version') ?? '2023-06-01',
          ...(betaHeader ? { 'anthropic-beta': betaHeader } : {}),
        },
        body: outboundBody,
      });

      if (!streamed) {
        const json = (await upstream.json().catch(() => null)) as
          | { usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } }
          | null;
        if (upstream.ok && json?.usage) {
          const u = json.usage;
          logUsage(c.env, c.executionCtx, {
            tenantId: access.tenantId, userId: access.userId, llmProduct: product, model,
            retries: 0, streamed: false,
            usage: {
              promptTokens: u.input_tokens ?? 0,
              completionTokens: u.output_tokens ?? 0,
              totalTokens: (u.input_tokens ?? 0) + (u.output_tokens ?? 0),
              cacheReadTokens: u.cache_read_input_tokens ?? 0,
              cacheCreationTokens: u.cache_creation_input_tokens ?? 0,
            },
            metadata: { engine: 'agent' }, idempotencyKey, useCase: 'agent',
            tenantApiKeyId: access.tenantApiKeyId, attribution: { agentHostId: access.agentHostId },
            byo: true, surface: resolveUsageSurface(c, access),
          });
        }
        return new Response(JSON.stringify(json ?? { error: 'upstream_error' }), {
          status: upstream.status,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (!upstream.body) return c.json({ error: 'no upstream body' }, 502);
      const [toClient, toMeter] = upstream.body.tee();
      c.executionCtx.waitUntil((async () => {
        try {
          const text = await new Response(toMeter).text();
          logUsage(c.env, c.executionCtx, {
            tenantId: access.tenantId, userId: access.userId, llmProduct: product, model,
            retries: 0, streamed: true, usage: parseAnthropicSseUsage(text),
            metadata: { engine: 'agent' }, idempotencyKey, useCase: 'agent',
            tenantApiKeyId: access.tenantApiKeyId, attribution: { agentHostId: access.agentHostId },
            byo: true, surface: resolveUsageSurface(c, access),
          });
        } catch { /* metering is best-effort */ }
      })());
      return new Response(toClient, {
        status: upstream.status,
        headers: { 'content-type': upstream.headers.get('content-type') ?? 'text/event-stream', 'cache-control': 'no-cache' },
      });
    }

    // ── No BYO key → serve from our model pool via Messages ⇄ OpenAI translation ──
    const isPro = access.premiumOverride || access.effectivePlan !== 'free';
    const requiredKey = isPro ? c.env.OPENROUTER_API_KEY_PRO ?? c.env.OPENROUTER_API_KEY : c.env.OPENROUTER_API_KEY;
    if (!requiredKey) return c.json({ error: 'LLM proxy not configured', code: 'proxy_unconfigured' }, 503);

    // Our-models path bills US (not the tenant's Anthropic key), so apply the
    // SAME daily + monthly token caps as /v1/chat/completions — and close the
    // funded overflow path once the tenant's overflow $ cap is hit.
    const capResult = await enforceTokenCaps(c, access);
    if ('blocked' in capResult) return capResult.blocked;
    const disablePaidOverflow = await isPaidOverflowExhausted(c, access);

    const openaiBody = anthropicToOpenAiRequest(parsed);
    const traceId = newTraceId();
    const messageId = `msg_${traceId}`;
    // The tenant has no BYO Anthropic credential here (handled above), but may
    // still bring OpenAI/Google — overlay those so a translated turn landing on
    // their vendor rides the tenant's own account ($0 to us, metered byo).
    const tenantVendorKeys = await resolveTenantVendorKeys(c.env, access.tenantId);
    // Determinism for non-Anthropic on-prem BYO: if the requested model belongs to
    // a vendor the tenant has connected, HARD-PIN it (modelStrict) so the run rides
    // their own account instead of the gateway silently cascading onto our free
    // pool. Mirrors the Anthropic passthrough's "runs on the tenant's account, period"
    // guarantee for OpenAI/Google. A bare/mismatched model just stays a soft hint.
    const byoVendors = byoVendorIdSet((Object.keys(tenantVendorKeys) as LlmProvider[]).filter((p) => tenantVendorKeys[p]));
    if (typeof parsed.model === 'string' && byoVendors.has(vendorForModel(parsed.model))) {
      (openaiBody as { modelStrict?: boolean }).modelStrict = true;
    }
    // Same routing path as /v1/chat/completions: a translated Anthropic request that
    // carried `tools` is an agentic turn and floors onto the paid coder backstop
    // rather than the lite general backstop. (BYO-Claude turns were served above.)
    const service = proxyForCompletion(c.env, access, openaiBody as unknown as ChatCompletionRequest, { disablePaidOverflow, tenantVendorKeys });
    const result = await service.complete(openaiBody as unknown as ChatCompletionRequest, undefined, traceId);
    logFailovers(c.env, c.executionCtx, result.failovers);

    if (streamed && result.response.body) {
      const encoder = createAnthropicStreamEncoder({ messageId, model: result.resolvedModel });
      const stream = pipeOpenAiSseToAnthropic(result.response.body, encoder, (usage) => {
        logUsage(c.env, c.executionCtx, {
          tenantId: access.tenantId, userId: access.userId, llmProduct: product, model: result.resolvedModel,
          retries: result.retries, streamed: true, usage,
          metadata: { engine: 'agent', resolvedModel: result.resolvedModel }, idempotencyKey,
          useCase: 'agent', tenantApiKeyId: access.tenantApiKeyId,
          attribution: { agentHostId: access.agentHostId }, traceId,
          paidOverflow: result.paidOverflow,
          byo: result.byoFunded ?? false, surface: resolveUsageSurface(c, access),
        });
      });
      return new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'x-builderforce-model': result.resolvedModel },
      });
    }

    const openaiJson = await result.response.json().catch(() => null) as Record<string, unknown> | null;
    logUsage(c.env, c.executionCtx, {
      tenantId: access.tenantId, userId: access.userId, llmProduct: product, model: result.resolvedModel,
      retries: result.retries, streamed: false,
      usage: result.usage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      metadata: { engine: 'agent', resolvedModel: result.resolvedModel }, idempotencyKey,
      useCase: 'agent', tenantApiKeyId: access.tenantApiKeyId,
      attribution: { agentHostId: access.agentHostId }, traceId,
      paidOverflow: result.paidOverflow,
      byo: result.byoFunded ?? false, surface: resolveUsageSurface(c, access),
    });
    return new Response(JSON.stringify(openAiToAnthropicMessage(openaiJson, result.resolvedModel, messageId)), {
      status: result.response.status,
      headers: { 'content-type': 'application/json', 'x-builderforce-model': result.resolvedModel },
    });
  });

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
    // First-party platform tools (in-process) + the tenant's external MCP servers.
    const tools = [...listBuiltinTools(), ...await listToolsForTenant(db, access.tenantId, c.env.JWT_SECRET, fetch, c.env as Env)];
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
      // First-party platform tools run in-process; everything else relays to the
      // tenant's external MCP server.
      const result = body.extensionId === BUILTIN_EXTENSION_ID
        ? await callBuiltinTool(db, {
            tenantId: access.tenantId, tool: body.tool, arguments: body.arguments,
            env: c.env as Env, userId: access.userId, role: access.role,
            // Forwarded so route-replay tools run as the caller (JWT) or mint for gateway keys.
            authToken: (c.req.header('Authorization') ?? '').replace(/^Bearer\s+/i, '') || null,
            executionCtx: c.executionCtx,
          })
        : await callMcpTool(db, {
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
    // Logged-out guest chat: a `bfguest_*` bearer routes to the isolated guest
    // handler BEFORE the tenant auth path ever runs (see handleGuestChat).
    if ((c.req.header('Authorization') ?? '').startsWith(`Bearer ${GUEST_TOKEN_PREFIX}`)) {
      return handleGuestChat(c);
    }

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

    // ── Tenant "LLM" expansion (migration 0211) ────────────────────────────
    // A `tenant_model:<slug>` model ref expands into its configured base model +
    // system directives + sampling params. This is the gateway-side half of the
    // shared resolver, so the Designer Brain, on-prem hosts, and any external
    // /v1/chat/completions caller all honour a tenant's named model the same way
    // (the cloud agent loop resolves the same ref via runCloudToolLoop).
    const bodyAny = body as Record<string, unknown>;
    // A `project_evermind:<projectId>` pin expands to the project's CURRENT
    // Evermind version (evermind/<ref>) at call time — the cloud/IDE replica
    // pulling the latest learned model on each run (pull-on-boundary).
    if (typeof bodyAny.model === 'string' && bodyAny.model.startsWith(PROJECT_EVERMIND_MODEL_PREFIX)) {
      const expanded = await resolveProjectEvermindModelPin(c.env as Env, buildDatabase(c.env), access.tenantId, bodyAny.model);
      bodyAny.model = expanded.model; // undefined when unseeded → plan default
    }
    if (typeof bodyAny.model === 'string' && bodyAny.model.startsWith(TENANT_MODEL_REF_PREFIX)) {
      const tm = await resolveTenantModel(c.env as Env, buildDatabase(c.env), access.tenantId, bodyAny.model);
      // null base → let the plan default resolve; unknown ref → drop the bad id too.
      bodyAny.model = tm?.baseModel ?? undefined;
      if (tm?.directives) {
        const msgs = body.messages as Array<{ role?: string; content?: unknown }>;
        const sysIdx = msgs.findIndex((m) => m.role === 'system');
        const sysMsg = sysIdx >= 0 ? msgs[sysIdx] : undefined;
        if (sysMsg) {
          const prev = typeof sysMsg.content === 'string' ? sysMsg.content : '';
          msgs[sysIdx] = { ...sysMsg, content: `${tm.directives}\n\n${prev}`.trim() };
        } else {
          msgs.unshift({ role: 'system', content: tm.directives });
        }
      }
      if (tm) {
        if (typeof tm.params.temperature === 'number' && bodyAny.temperature == null) bodyAny.temperature = tm.params.temperature;
        if (typeof tm.params.top_p === 'number' && bodyAny.top_p == null) bodyAny.top_p = tm.params.top_p;
      }
    }

    // A resolved `evermind/<ref>` base is OUR OWN model (served in-Worker from R2,
    // see vendors/evermind.ts). Hard-pin it so the gateway serves Evermind itself
    // rather than silently cascading to an external frontier vendor on a hiccup —
    // calling a tenant's published Evermind must never bill or leak to OpenAI/Claude.
    if (typeof bodyAny.model === 'string' && bodyAny.model.startsWith('evermind/')) {
      bodyAny.modelStrict = true;
    }

    // ── Workforce model expansion ──────────────────────────────────────────
    // A `builderforce/workforce-<id>` model ref lets the stock OpenAI SDKs call a
    // user's PUBLISHED model by id: expand it into the agent's base model + its
    // persona/memory system directives (same builder the dedicated /api/ide/agents
    // chat + validate paths use), then dispatch normally. Unknown id → drop the
    // ref so the plan default resolves rather than erroring.
    if (typeof bodyAny.model === 'string' && bodyAny.model.startsWith(WORKFORCE_MODEL_REF_PREFIX)) {
      // The caller's latest user message grounds the agent's recall (Phase C3), so a
      // stock OpenAI-SDK call to a workforce model id gets the agent's own docs too.
      const msgsForRecall = body.messages as Array<{ role?: string; content?: unknown }>;
      const latestUser = [...msgsForRecall].reverse().find((m) => m.role === 'user');
      const recallQuery = typeof latestUser?.content === 'string' ? latestUser.content : undefined;
      const wf = await resolveWorkforceModel(c.env as Env, bodyAny.model, recallQuery);
      bodyAny.model = wf?.baseModel ?? undefined;
      if (wf?.directives) {
        const msgs = body.messages as Array<{ role?: string; content?: unknown }>;
        const sysIdx = msgs.findIndex((m) => m.role === 'system');
        const sysMsg = sysIdx >= 0 ? msgs[sysIdx] : undefined;
        if (sysMsg) {
          const prev = typeof sysMsg.content === 'string' ? sysMsg.content : '';
          msgs[sysIdx] = { ...sysMsg, content: `${wf.directives}\n\n${prev}`.trim() };
        } else {
          msgs.unshift({ role: 'system', content: wf.directives });
        }
      }
    }

    // Capture SDK transport metadata for usage logging — the body's `metadata`
    // and `useCase` are consumed here and stripped before vendor dispatch
    // (see STANDARD_BODY_FIELDS).
    const callerMetadata = (bodyAny.metadata as Record<string, unknown> | undefined) ?? null;
    const callerUseCase  = typeof bodyAny.useCase === 'string' ? bodyAny.useCase : null;
    const idempotencyKey = c.req.header('Idempotency-Key') ?? null;

    // ── Strict-pin entitlement gate ─────────────────────────────────────────
    // Strict pin = dispatch ONLY the named `model`, NO substitution; an
    // unavailable model 503s instead of silently swapping (eval / reproducibility
    // runs). Accepts the public `strict: true` body flag, the `?strict=true`
    // query param, or the gateway-internal `modelStrict` cloud agents set — all
    // resolved by `resolveStrictPin`, then normalized onto `body.modelStrict` so
    // the proxy dispatch + trace logger see one canonical flag.
    //
    // Free tenants can't strict-pin — a single misbehaving model would otherwise
    // drain their daily budget with retries. Paid plans, superadmin-issued
    // daily-limit overrides, and superadmin callers bypass.
    // Resolve the tenant's Claude subscription token AND BYO api-keys up front (one
    // round-trip) — needed both for the strict-pin gate below and for the proxy.
    // The subscription powers direct-Claude; the BYO keys override the operator
    // keys for their vendors so the tenant's own account serves the call ($0 to us,
    // metered byo). The connected vendors also unlock free-plan model choice.
    const tenantCreds = await resolveTenantLlmCredentials(c.env, access.tenantId);
    const { anthropicOAuthToken, vendorKeys: tenantVendorKeys } = tenantCreds;
    const byoVendors = byoVendorIdSet(providersFromCredentials(tenantCreds));

    const queryStrict = c.req.query('strict') === 'true';
    const wantsStrict = resolveStrictPin(bodyAny, queryStrict);
    if (wantsStrict) {
      // A free tenant may strict-pin a model their OWN connected provider serves —
      // they pay their provider directly, so the "a bad model drains the budget"
      // concern doesn't apply. Any other free-plan strict pin still needs a paid plan.
      const pinnedVendor = typeof bodyAny.model === 'string' ? vendorForModel(bodyAny.model) : null;
      const pinnedIsByo = pinnedVendor != null && byoVendors.has(pinnedVendor);
      const strictAllowed = access.isSuperadmin
                         || access.effectivePlan !== 'free'
                         || access.tokenDailyLimitOverride !== null
                         || pinnedIsByo;
      if (!strictAllowed) {
        // 402 Payment Required — uniform with the portal feature-gate standard
        // (the caller is authenticated + authorized; they just need a higher plan).
        return c.json({
          error: 'Strict model pinning requires a paid plan (Pro/Teams), a connected provider (BYO), or a superadmin-issued daily-limit override.',
          code: 'strict_pin_not_allowed',
          upgrade: true,
        }, 402);
      }
      // Canonicalize: downstream (LlmProxyService.complete dispatch branch,
      // traceLogger) keys off `modelStrict`, so set it once here.
      body.modelStrict = true;
    }

    // ── Token usage + limit checks (daily + monthly) ────────────────────────
    // Shared cache-discounted gate (per tenant) — also enforced on /v1/messages'
    // our-models branch. Returns the 429 to send, or the usage numbers reused
    // below for the X-Builderforce-*-Tokens-* headers.
    const capResult = await enforceTokenCaps(c, access);
    if ('blocked' in capResult) return capResult.blocked;
    const { usageToday, planDailyLimit, usageMonth, planMonthlyLimit } = capResult;

    // ── Idempotency-Key replay (10-min window) ──────────────────────────────
    // First choice: REPLAY the cached original response body (200) so a cron
    // retry gets the original answer transparently [1232]. Fallback (no cached
    // body — e.g. the original was streamed, or is still in-flight, or KV is
    // unbound): the DB no-op guard returns 409 so the retry can't double-charge.
    if (idempotencyKey) {
      const kv = (c.env as { AUTH_CACHE_KV?: KVNamespace }).AUTH_CACHE_KV;
      if (kv) {
        try {
          const cached = await kv.get(idempotencyCacheKey(access.tenantId, idempotencyKey), 'json') as
            | { status: number; body: unknown } | null;
          if (cached) {
            return c.json(cached.body as Record<string, unknown>, (cached.status as 200), {
              'x-builderforce-idempotent-replay': 'true',
            });
          }
        } catch { /* KV miss/error → fall through to the no-op guard */ }
      }
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

    // Close the funded overflow path once the tenant has hit its daily overflow
    // $ cap — the primary pool still runs, only the paid fallback/backstop is
    // disabled. Hard ceiling on what a tight retry loop can spend on our keys.
    const disablePaidOverflow = await isPaidOverflowExhausted(c, access);
    // Single routing path for every modality (chat + messages, VS Code Brain +
    // on-prem + SDK): an agentic tool-loop turn floors onto the paid coder backstop,
    // a plain chat keeps the general pool. Reuses the credentials resolved above so
    // any direct-Claude resolution rides the tenant subscription and BYO vendors
    // serve from the tenant's own account.
    const service = proxyForCompletion(c.env, access, body, { disablePaidOverflow, anthropicOAuthToken, tenantVendorKeys });
    // Context-fit seeding: estimate the turn's tokens so the proxy drops
    // small-window models from the first-pass seed. This is the preventive half
    // of the Brain "dies after several executions" fix — the reactive 413
    // failover still backstops, but a long transcript no longer gets SEEDED onto
    // a model it would immediately overflow (and the client now also bounds what
    // it sends; see brainRunStore windowing + tool-result trimming).
    const estimatedTokens = estimateRequestTokens(body.messages, (body as { tools?: unknown }).tools);
    const result = await service.complete(body, undefined, traceId, undefined, { estimatedTokens });

    // Clone upstream headers we care about
    const upstreamHeaders = new Headers();
    const contentType = result.response.headers.get('content-type');
    if (contentType) upstreamHeaders.set('content-type', contentType);
    upstreamHeaders.set('x-builderforce-model', result.resolvedModel);
    upstreamHeaders.set('x-builderforce-trace-id', traceId);
    upstreamHeaders.set('x-builderforce-vendor', result.resolvedVendor);
    // Which account served this turn (own / shared / shared_byo_unused) — the Brain
    // provenance chip reads this so a SUCCESSFUL turn shows whether the tenant's own
    // connected frontier account ran it, or the shared pool did despite one existing.
    upstreamHeaders.set('x-builderforce-account', classifyReplyAccount(result.byoFunded ?? false, byoVendors.size > 0));
    // A provider the tenant CONNECTED but that couldn't be resolved this call (revoked/
    // expired subscription, an undecryptable key) leaves `byoVendors` empty — the turn
    // degrades to the shared pool looking exactly like "nothing connected". Surface each
    // unresolved provider WITH its reason (`anthropic:revoked`) so the client/triage can
    // say precisely why + what to do, instead of a silent weak-coder run.
    // ALSO cover the tenant-mismatch case: if NOTHING is connected in THIS tenant on an
    // agentic (Brain) turn, check whether the same user connected a frontier provider in
    // ANOTHER workspace (reason `other-workspace`) — cached per user (~1 query per 5 min,
    // never on the common connected path) so it's not a per-request cost.
    let otherWorkspace: LlmProvider[] = [];
    if (byoVendors.size === 0 && tenantCreds.configuredProviders.length === 0 && isAgenticToolTurn(body as { tools?: unknown }) && access.userId) {
      const uid = access.userId;
      otherWorkspace = await getOrSetCached(
        c.env as Env,
        `byo-other-workspace:${uid}:${access.tenantId}`,
        () => providersConnectedInOtherWorkspaces(c.env as Env, uid, access.tenantId, SUPPORTED_PROVIDERS),
        { kvTtlSeconds: 300, l1TtlMs: 60_000 },
      ).catch(() => [] as LlmProvider[]);
    }
    const byoUnresolvedHeader = formatByoUnresolvedHeader(tenantCreds, otherWorkspace);
    if (byoUnresolvedHeader) upstreamHeaders.set('x-builderforce-byo-unresolved', byoUnresolvedHeader);
    upstreamHeaders.set('x-builderforce-retries', String(result.retries));
    upstreamHeaders.set('x-builderforce-product', llmProduct);
    upstreamHeaders.set('x-builderforce-effective-plan', access.effectivePlan);
    if (access.premiumOverride) upstreamHeaders.set('x-builderforce-premium', 'true');
    // Token-limit headers — let callers pre-emptively throttle before they hit
    // the 429 plan_token_(monthly_)limit_exceeded gates.
    if (planDailyLimit > 0) {
      upstreamHeaders.set('x-builderforce-daily-tokens-used', String(usageToday));
      upstreamHeaders.set('x-builderforce-daily-tokens-limit', String(planDailyLimit));
      upstreamHeaders.set('x-builderforce-daily-tokens-remaining', String(Math.max(planDailyLimit - usageToday, 0)));
    }
    if (planMonthlyLimit > 0) {
      upstreamHeaders.set('x-builderforce-monthly-tokens-used', String(usageMonth));
      upstreamHeaders.set('x-builderforce-monthly-tokens-limit', String(planMonthlyLimit));
      upstreamHeaders.set('x-builderforce-monthly-tokens-remaining', String(Math.max(planMonthlyLimit - usageMonth, 0)));
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
        (usage) => {
          logUsage(c.env, c.executionCtx, {
            tenantId: access.tenantId, userId: access.userId, llmProduct,
            model: result.resolvedModel, retries: result.retries, streamed: true, usage,
            metadata: callerMetadata, idempotencyKey, useCase: callerUseCase,
            tenantApiKeyId: access.tenantApiKeyId, attribution: { agentHostId: access.agentHostId }, traceId,
            paidOverflow: result.paidOverflow,
            byo: result.byoFunded ?? false, surface: resolveUsageSurface(c, access),
          });
          // Back-fill the streamed trace row (logged above with 0 tokens) [1298].
          backfillTraceUsage(c.env, c.executionCtx, traceId, usage);
        },
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
    logUsage(c.env, c.executionCtx, {
      tenantId: access.tenantId, userId: access.userId, llmProduct,
      model: result.resolvedModel, retries: result.retries, streamed: false,
      usage: result.usage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      metadata: callerMetadata, idempotencyKey, useCase: callerUseCase,
      tenantApiKeyId: access.tenantApiKeyId, attribution: { agentHostId: access.agentHostId }, traceId,
      paidOverflow: result.paidOverflow,
      byo: result.byoFunded ?? false, surface: resolveUsageSurface(c, access),
    });

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

    const responseEnvelope = {
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
        ...(result.schemaDowngraded ? { schemaDowngraded: true } : {}),
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
        ...(planMonthlyLimit > 0 ? {
          monthlyTokens: {
            used:      usageMonth,
            limit:     planMonthlyLimit,
            remaining: Math.max(planMonthlyLimit - usageMonth, 0),
          },
        } : {}),
      },
    };
    const responseStatus = result.response.status as 200;
    // Cache the successful body so a retry with the same Idempotency-Key REPLAYS
    // it (200) rather than getting a 409 [1232] — transparent cron retries.
    // Non-streaming 2xx only; 10-min TTL matches the replay-guard window.
    // Fire-and-forget — never delays the response; KV-absent → the 409 guard.
    if (idempotencyKey && responseStatus < 300) {
      const kv = (c.env as { AUTH_CACHE_KV?: KVNamespace }).AUTH_CACHE_KV;
      if (kv) {
        c.executionCtx.waitUntil(
          kv.put(
            idempotencyCacheKey(access.tenantId, idempotencyKey),
            JSON.stringify({ status: responseStatus, body: responseEnvelope }),
            { expirationTtl: 600 },
          ).catch(() => { /* cache write is best-effort */ }),
        );
      }
    }
    return c.json(responseEnvelope, responseStatus);
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

    // Curated coding/tool-calling models the tenant's plan can actually reach —
    // the list a cloud-agent run should pick from (free tenants see only the free
    // coding models, Pro tenants also see the premium ones).
    const codingModels = codingModelsForPlan(effectivePlan, premiumOverride);

    // BYO: the tenant's connected providers drive an additional pinnable model set
    // (their own account serves them, $0 to us). Connecting a provider ALSO unlocks
    // model choice on the free plan — "LLM choices are based on the connected
    // providers." Resolved only for an authenticated tenant.
    const byoProviders = access ? (await listTenantProviderKeys(c.env, access.tenantId)).map((d) => d.provider) : [];
    const byoModels = byoModelsFor(byoProviders);
    // THE single frontier-access rule (superadmin || premium override || connected BYO
    // account || paid plan) — shared with every backend gate via evaluateFrontierAccess,
    // so the client's model-choice / frontier-teacher unlock matches the server exactly.
    // `access.isSuperadmin` is the DB-resolved flag (requireTenantAccess), so a superadmin
    // unlocks frontier even without a premium override or a connected account.
    const canUseFrontierModels = evaluateFrontierAccess({
      effectivePlan: toTenantPlan(effectivePlan),
      premiumOverride,
      isSuperadmin: access?.isSuperadmin === true,
      hasConnectedByoFrontier: byoProviders.length > 0,
    }).entitled;
    // `canChooseModel` is an alias kept for existing clients; it IS frontier access.
    const canChooseModel = canUseFrontierModels;

    // Frontier TEACHER options — the models eligible to distil into an Evermind. A
    // connected BYO account means teaching with THEIR OWN frontier models (a BYO-Anthropic
    // tenant teaches with Opus/Sonnet on their account, NOT a free `@cf/*`/qwen coder), so
    // their BYO models lead. The platform's premium coders are added ONLY when the PLATFORM
    // funds frontier (paid / override / superadmin) — a free BYO tenant must not teach on
    // our premium pool for free. Empty when the tenant has no frontier access at all.
    const platformFundsFrontier = premiumOverride || effectivePlan !== 'free' || access?.isSuperadmin === true;
    const teacherModels = canUseFrontierModels
      ? Array.from(new Set([
          ...byoModels.map((m) => m.id),
          ...(platformFundsFrontier ? codingModelsForPlan(effectivePlan === 'free' ? 'pro' : effectivePlan, true) : []),
        ]))
      : [];

    const requiredKey = isPro ? c.env.OPENROUTER_API_KEY_PRO ?? c.env.OPENROUTER_API_KEY : c.env.OPENROUTER_API_KEY;
    if (!requiredKey) {
      return c.json({
        configured: false,
        product: productName,
        effectivePlan,
        ...(premiumOverride ? { premium: true } : {}),
        models: modelPoolForPlan(effectivePlan, premiumOverride),
        codingModels,
        teacherModels,
        canChooseModel,
        canUseFrontierModels,
        byo: { providers: byoProviders, models: byoModels },
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
      codingModels,
      teacherModels,
      canChooseModel,
      canUseFrontierModels,
      byo: { providers: byoProviders, models: byoModels },
    });
  });

  // -----------------------------------------------------------------------
  // GET /v1/model-analytics?scope=project:<id>|tenant|global
  // Learned Model Routing (PRD 13 §6.5): the per-action-type model ranking the
  // learned router seeds from. Reads the SAME cached `routing:<scope>` KV blob the
  // router reads (one source) — so it's O(1) and DB-free on a warm cache; a cold
  // scope reconciles once from the durable outcomes table. Tenant-scoped.
  // -----------------------------------------------------------------------
  router.get('/v1/model-analytics', async (c) => {
    let access: TenantAccess;
    try {
      access = await requireTenantAccess(c);
    } catch (err) {
      return respondToAccessError(c, err);
    }

    const rawScope = c.req.query('scope') ?? 'tenant';
    // `tenant` resolves to the caller's own tenant id; `global` and `project:<id>`
    // pass through. Anything malformed → 400.
    const scope = rawScope === 'tenant'
      ? ({ kind: 'tenant', id: access.tenantId } as const)
      : parseScopeToken(rawScope);
    if (!scope) return c.json({ error: `invalid scope '${rawScope}' (use project:<id> | tenant | global)` }, 400);

    const db = buildDatabase(c.env);
    // Ownership guard: a project scope must belong to the caller's tenant (the blob
    // is low-sensitivity aggregate model stats, but routing data still stays tenant-scoped).
    if (scope.kind === 'project') {
      const [proj] = await db
        .select({ tenantId: projects.tenantId })
        .from(projects)
        .where(eq(projects.id, scope.id))
        .limit(1);
      if (!proj || proj.tenantId !== access.tenantId) {
        return c.json({ error: 'project not found in this tenant' }, 404);
      }
    }

    const table = await getRoutingTable(c.env, db, scope);
    // Shape the blob into a stable, labelled ranking for the panel.
    const byAction = (Object.entries(table.byAction) as [ActionType, typeof table.byAction[ActionType]][])
      .filter(([, models]) => models && models.length > 0)
      .map(([actionType, models]) => ({
        actionType,
        label: actionTypeLabel(actionType),
        models: (models ?? []).map((m) => ({
          model: m.model,
          samples: m.n,
          avgScore: Math.round(m.avgScore * 1000) / 1000,
          mergeRate: Math.round(m.mergeRate * 1000) / 1000,
          avgCostMillicents: Math.round(m.avgCostMc),
        })),
      }));
    return c.json({ scope: scopeToken(scope), updatedAt: table.updatedAt, byAction });
  });

  // -----------------------------------------------------------------------
  // GET /v1/recall-seed?limit=50
  // Learned Model Routing (PRD 13 §6.6): warm a browser's LOCAL SSM recall memory
  // from the tenant's recently-scored outcomes (task text + winning model + score),
  // so an interactive run can compute a recall bias on the client GPU. The heavy
  // embed+kNN stays on the client; this is just the seed feed. Tenant-scoped, cached.
  // -----------------------------------------------------------------------
  router.get('/v1/recall-seed', async (c) => {
    let access: TenantAccess;
    try {
      access = await requireTenantAccess(c);
    } catch (err) {
      return respondToAccessError(c, err);
    }
    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? '50'), 1), 200);
    const db = buildDatabase(c.env);
    const seed = await getOrSetCached(
      c.env,
      `recallseed:${access.tenantId}:${limit}`,
      async () => {
        const rows = await db
          .select({
            executionId: runModelOutcomes.executionId,
            model: runModelOutcomes.resolvedModel,
            score: runModelOutcomes.score,
            title: tasks.title,
            description: tasks.description,
          })
          .from(runModelOutcomes)
          .leftJoin(tasks, eq(runModelOutcomes.taskId, tasks.id))
          .where(eq(runModelOutcomes.tenantId, access.tenantId))
          .orderBy(desc(runModelOutcomes.createdAt))
          .limit(limit);
        return rows
          .filter((r) => r.model && r.model !== 'unknown' && r.title)
          .map((r) => ({
            id: r.executionId,
            taskText: `${r.title}\n${r.description ?? ''}`.trim(),
            model: r.model,
            score: r.score,
          }));
      },
      { kvTtlSeconds: 120, l1TtlMs: 30_000 },
    );
    return c.json({ memories: seed });
  });

  // -----------------------------------------------------------------------
  // POST /v1/run-outcome
  // -----------------------------------------------------------------------
  // Learned Model Routing (PRD 13) write-back for NON-cloud runs. IDE-native,
  // on-prem, and external-SDK runs go through the gateway but never create a
  // cloud `executions` row, so their (action_type, model)→success signal never
  // reached the learner. This lets such a client report its terminal outcome so
  // the same routing table that cloud runs teach also learns from them.
  // Idempotent on `clientRunId`; best-effort (never blocks the caller).
  router.post('/v1/run-outcome', async (c) => {
    let access: TenantAccess;
    try {
      access = await requireTenantAccess(c);
    } catch (err) {
      return respondToAccessError(c, err);
    }
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

    const clientRunId = typeof body.clientRunId === 'string' ? body.clientRunId.trim() : '';
    const model = typeof body.model === 'string' ? body.model.trim() : '';
    if (!clientRunId || !model) {
      return c.json({ error: 'clientRunId and model are required' }, 400);
    }
    // `terminalStatus` wins; `success:boolean` is a friendly alias.
    const terminalStatus: TerminalStatus =
      body.terminalStatus === 'completed' || body.terminalStatus === 'failed' || body.terminalStatus === 'cancelled'
        ? body.terminalStatus
        : body.success === true ? 'completed' : body.success === false ? 'failed' : 'completed';
    const source: OutcomeSource =
      body.source === 'onprem' || body.source === 'ide' || body.source === 'external' ? body.source : 'external';
    const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

    const db = buildDatabase(c.env);
    await recordClientRunOutcome(c.env, db, access.tenantId, {
      clientRunId,
      source,
      model,
      terminalStatus,
      ...(typeof body.actionType === 'string' ? { actionType: body.actionType } : {}),
      ...(num(body.projectId) != null ? { projectId: num(body.projectId) } : {}),
      ...(num(body.taskId) != null ? { taskId: num(body.taskId) } : {}),
      ...(typeof body.merged === 'boolean' ? { merged: body.merged } : {}),
      ...(typeof body.ciGreen === 'boolean' ? { ciGreen: body.ciGreen } : {}),
      ...(typeof body.degraded === 'boolean' ? { degraded: body.degraded } : {}),
      ...(num(body.steps) != null ? { steps: num(body.steps) } : {}),
      ...(num(body.costMc) != null ? { costMc: num(body.costMc) } : {}),
      ...(typeof body.approved === 'boolean' ? { approved: body.approved } : {}),
    });
    return c.json({ ok: true });
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

    // Source split (cloud / on-prem / web) — the gateway's `/v1/usage` can now
    // break consumption down by who produced it, not just per-model/per-user.
    // Uses the SAME classifier the dashboard does (shared USAGE_KIND, 0096 cols).
    const bySource = await db.execute(sql`
      SELECT
        ${USAGE_KIND}                  AS source,
        COUNT(*)::int                  AS requests,
        SUM(prompt_tokens)::bigint     AS prompt_tokens,
        SUM(completion_tokens)::bigint AS completion_tokens,
        SUM(total_tokens)::bigint      AS total_tokens
      FROM llm_usage_log
      WHERE tenant_id = ${access.tenantId}
        AND created_at >= NOW() - (${days} || ' days')::interval
      GROUP BY ${USAGE_KIND}
      ORDER BY total_tokens DESC NULLS LAST
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
      bySource: bySource.rows,
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

    // Per-plan OpenRouter key (primary vendor) + Voyage failover key. The
    // embeddings cascade tries OpenRouter first, then falls over to Voyage if
    // OpenRouter's endpoint is down — so a single-vendor outage no longer fails
    // every vector workflow. Both vendors are optional; the cascade skips any
    // vendor without a key, and only 503s if NEITHER is configured.
    const openRouterKey = access.effectivePlan === 'free'
      ? c.env.OPENROUTER_API_KEY
      : (c.env.OPENROUTER_API_KEY_PRO ?? c.env.OPENROUTER_API_KEY);
    if (!openRouterKey && !c.env.VOYAGE_API_KEY) {
      return c.json({ error: 'Embeddings vendor not configured (missing OPENROUTER_API_KEY and VOYAGE_API_KEY)' }, 503);
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
    const envelope = (raw: Record<string, unknown>) => ({
      ...raw,
      _builderforce: {
        product: productNameForPlan(access.effectivePlan, access.premiumOverride),
        effectivePlan: access.effectivePlan,
        ...(access.premiumOverride ? { premium: true } : {}),
      },
    });

    try {
      const result = await dispatchEmbeddingVendor({
        env: { OPENROUTER_API_KEY: openRouterKey, VOYAGE_API_KEY: c.env.VOYAGE_API_KEY },
        model,
        input,
        extraBody,
      });
      // Forward the upstream's untouched OpenAI-shaped body so caller-side
      // fields survive; annotate which vendor actually resolved for diagnostics.
      const out: Record<string, unknown> = result.raw && typeof result.raw === 'object'
        ? { ...(result.raw as Record<string, unknown>) }
        : { object: result.object, data: result.data, model: result.model, ...(result.usage ? { usage: result.usage } : {}) };
      out._vendor = result.vendorUsed;
      return c.json(envelope(out), 200);
    } catch (err) {
      // 400 bad payload — failover won't help, surface as-is.
      if (err instanceof VendorFatalError) {
        return c.json(envelope({ error: err.message }), err.status as 400);
      }
      // Every vendor failed (outage on all configured providers).
      if (err instanceof EmbeddingCascadeExhaustedError) {
        return c.json(envelope({ error: err.message, attempts: err.attempts }), 502);
      }
      throw err;
    }
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

    // Independent image-credit budget (migration 0131) — gate BEFORE dispatch so
    // an over-budget tenant doesn't incur a vendor call. Separate from the chat
    // token cap.
    const imageCapBlocked = await enforceImageCreditCap(c, access);
    if (imageCapBlocked) return imageCapBlocked;

    // Capture SDK transport metadata for usage logging — stripped before vendor dispatch
    // by `stripStandardFields` in ImageProxyService.
    const bodyAny = body as Record<string, unknown>;
    const callerMetadata = (bodyAny.metadata as Record<string, unknown> | undefined) ?? null;
    const callerUseCase  = typeof bodyAny.useCase === 'string' ? bodyAny.useCase : null;
    const idempotencyKey = c.req.header('Idempotency-Key') ?? null;

    const productName = imageProductNameForPlan(access.effectivePlan, access.premiumOverride);
    // Same per-tenant funded-overflow ceiling as the chat path (migration 0130):
    // once a tenant exhausts its daily paid-overflow cap, drop the always-on
    // premium FluxAPI fallback so the free pool still serves but our funded key
    // stops. Reuses the shared `isPaidOverflowExhausted` gate.
    const disablePaidOverflow = await isPaidOverflowExhausted(c, access);
    const service = imageProxyForPlan(c.env, access.effectivePlan, access.premiumOverride, { disablePaidOverflow });
    const result = await service.generate(body);

    // Image accounting: still charge a flat per-image token estimate onto the
    // usage row (retained for cost rollups), but image generation is now gated by
    // its OWN daily credit budget (enforceImageCreditCap above), NOT the chat
    // token cap — the two budgets are independent (migration 0131). IMAGE_TOKEN_COST
    // is shared with the credit-count query so charge and count agree.
    const imagesReturned = Math.max(result.body.data.length, 0);
    const billedTokens = imagesReturned > 0 ? imagesReturned * IMAGE_TOKEN_COST : 0;
    const cascadeExhausted = result.body.data.length === 0;

    // Log usage (always, even on cascade-exhausted runs so failure rates are visible).
    logFailovers(c.env, c.executionCtx, result.failovers);
    logUsage(c.env, c.executionCtx, {
      tenantId: access.tenantId, userId: access.userId, llmProduct: productName,
      model: result.resolvedModel, retries: result.retries, streamed: false,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: billedTokens },
      metadata: callerMetadata, idempotencyKey, useCase: callerUseCase,
      tenantApiKeyId: access.tenantApiKeyId, attribution: { agentHostId: access.agentHostId },
      paidOverflow: result.paidOverflow,
    });

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
  router.get('/v1/health', async (c) => {
    // Per-model availability/cooldown for each pool, mirroring /v1/models'
    // `status()` shape (LlmModelStatus[]). The observability UI renders these
    // as the free/pro pool tabs, so the contract is `free`/`pro` arrays +
    // `timestamp` — NOT bare pool counts. Global pools, so no tenant needed.
    const [free, pro] = await Promise.all([
      llmProxyForPlan(c.env, 'free').status(),
      llmProxyForPlan(c.env, 'pro').status(),
    ]);
    return c.json({
      status: 'ok',
      service: 'builderforceLLM',
      free,
      pro,
      timestamp: new Date().toISOString(),
      // Retained for any non-UI consumer of the historical shape.
      pool: FREE_MODEL_POOL.length,
      proPool: PRO_MODEL_POOL.length,
      imagePool: FREE_IMAGE_MODEL_POOL.length,
      imageProPool: PAID_IMAGE_MODEL_POOL.length,
    });
  });

  // Parse an optional `?projectId=` filter for the insights surfaces. Bad/blank
  // values collapse to null (whole-tenant scope) rather than erroring — a wrong
  // id simply matches no rows since the ledger is already tenant-scoped.
  const parseProjectIdParam = (raw: string | undefined): number | null => {
    if (!raw) return null;
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : null;
  };

  // -----------------------------------------------------------------------
  // GET /v1/builder-insights
  // Builder-level Insights snapshot — the cheap, cacheable "current state"
  // the IDE/CLI poll-once or render on demand. Tenant (and caller) scoped,
  // optionally narrowed to one project via ?projectId=.
  // Mirrors the auth of /v1/usage.
  // -----------------------------------------------------------------------
  router.get('/v1/builder-insights', async (c) => {
    let access: TenantAccess;
    try {
      access = await requireTenantAccess(c);
    } catch (err) {
      return respondToAccessError(c, err);
    }
    const db = buildDatabase(c.env);
    const snapshot = await getCachedBuilderInsightsSnapshot(db, c.env, {
      tenantId: access.tenantId,
      userId: access.userId,
      projectId: parseProjectIdParam(c.req.query('projectId')),
    });
    return c.json(snapshot);
  });

  // -----------------------------------------------------------------------
  // GET /v1/builder-insights/stream
  // Server-Sent Events — the PUSH surface. Emits a snapshot immediately, then
  // a freshly-built snapshot every 30s (up to ~5 min), then closes. Aborts on
  // client disconnect. Each tick is wrapped so a transient DB error emits an
  // `event: error` frame rather than tearing down the stream. Cloudflare
  // Workers compatible (ReadableStream + new Response).
  // -----------------------------------------------------------------------
  router.get('/v1/builder-insights/stream', async (c) => {
    let access: TenantAccess;
    try {
      access = await requireTenantAccess(c);
    } catch (err) {
      return respondToAccessError(c, err);
    }

    const db = buildDatabase(c.env);
    const scope = {
      tenantId: access.tenantId,
      userId: access.userId,
      projectId: parseProjectIdParam(c.req.query('projectId')),
    };
    const signal = c.req.raw.signal;
    const MAX_TICKS = 10;
    const INTERVAL_MS = 30_000;

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const emit = (text: string) => {
          try {
            controller.enqueue(encoder.encode(text));
          } catch {
            /* controller already closed */
          }
        };

        for (let tick = 0; tick < MAX_TICKS; tick++) {
          if (signal?.aborted) break;
          try {
            const snapshot = await buildBuilderInsightsSnapshot(db, c.env, scope);
            emit(`data: ${JSON.stringify(snapshot)}\n\n`);
          } catch (err) {
            emit(`event: error\ndata: ${JSON.stringify({ error: (err as Error).message || 'tick_failed' })}\n\n`);
          }
          if (tick === MAX_TICKS - 1) break;
          // Wait for the next tick, but bail early if the client disconnects.
          await new Promise<void>((resolve) => {
            let done = false;
            const finish = () => {
              if (done) return;
              done = true;
              clearTimeout(timer);
              if (signal) signal.removeEventListener('abort', finish);
              resolve();
            };
            const timer = setTimeout(finish, INTERVAL_MS);
            if (signal) signal.addEventListener('abort', finish, { once: true });
          });
          if (signal?.aborted) break;
        }
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      },
    });
  });

  return router;
}
