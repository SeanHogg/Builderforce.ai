/**
 * Per-request gateway guards shared by the LLM route modules — the usage surface,
 * work-attribution hints, the token-cap gate and the premium/image budget bodies.
 * Each answers from the request plus a {@link TenantAccess}; the reads behind them
 * are application-layer calls.
 */
import type { Context } from 'hono';
import type { Env, HonoEnv } from '../../../env';
import { reportCaughtError } from '../../../application/observability/caughtErrorReporter';
import { readUsageWorkHints, resolveUsageWorkHints, type UsageWorkHints } from '../../../application/llm/usageWorkHints';
import { isUsageSurface, type UsageSurface } from '../../../application/llm/usageLedger';
import { IMAGE_PRODUCT_NAMES, IMAGE_TOKEN_COST } from '../../../application/llm/mediaProducts';
import { toTenantPlan } from '../../../application/tenant/featureEntitlements';
import { requestDb } from '../../../application/shared/dbHandle';
import {
  utcDayStart,
  secondsUntilNextUtcMidnight,
  secondsUntilNextUtcMonth,
  sumTenantTextTokens,
} from '../../../application/llm/tokenUsage';
import { getTenantTokenAvailability, tokenGateUpgradeHint } from '../../../application/llm/tenantTokenAvailability';
import { getMemberSpendAvailability, maybeEmitSpendNotification, millicentsToUsd } from '../../../application/consumption/memberSpend';
import { resolveImageCreditsDailyLimit } from '../../../domain/tenant/PlanLimits';
import { freePlanUpgradeHint, type MediaCreditPolicy } from '../mediaCreditGate';
import type { TenantAccess } from './access';

/**
 * Which modality produced a gateway call, for the usage row's `surface` (drives
 * the BYO metering exemption — own-machine on-prem/VSIX BYO is free, cloud is
 * charged). A client may hint via `X-Builderforce-Surface`, but the header is
 * NEVER trusted to grant an own-machine (on_prem/vsix) surface unless the auth
 * path corroborates it: only an agentHost-key–authenticated call (`bfa_*`/`clk_*`,
 * i.e. `access.agentHostId != null`) is on the user's own machine by definition.
 * A web JWT or `bfk_*` tenant key may NOT self-declare on_prem/vsix — otherwise a
 * BYO caller could set the header and dodge the plan cap (the exemption in
 * tokenUsage.notFreeByoRow keys off surface∈{on_prem,vsix}). Such callers are
 * clamped to 'web' (still billable). Funded (byo=false) calls are billable
 * regardless of surface, so this only tightens the BYO exemption.
 * (Cloud runs never come through this HTTP path — they record via
 * recordCloudUsage with surface 'cloud'.) */
export function resolveUsageSurface(c: Context<HonoEnv>, access: TenantAccess): UsageSurface {
  const hinted = (c.req.header('x-builderforce-surface') ?? '').toLowerCase();
  const isKnown = isUsageSurface(hinted);
  // An agentHost credential authenticated → the call genuinely originates on the
  // user's own machine, so honor the client hint (on_prem/vsix/…) or default to
  // on_prem.
  if (access.agentHostId != null) {
    return isKnown ? (hinted as UsageSurface) : 'on_prem';
  }
  // Web JWT / bfk_* machine key: the auth path does NOT corroborate an own-machine
  // surface, so an own-machine hint is ignored (clamped to 'web'). Non-exempt
  // hints (web/cloud/sdk/rovr) are still honored for accurate attribution.
  if (isKnown && hinted !== 'on_prem' && hinted !== 'vsix') return hinted as UsageSurface;
  return 'web';
}

/**
 * Resolve validated work-attribution hints for THIS request.
 *
 * Gateway, image and on-prem rows previously wrote `attribution: { agentHostId }`
 * and nothing else, so every one of them landed with a NULL ticket and project and
 * disappeared from the per-ticket / per-project cost rollups — which is to say
 * "what did this ticket cost" quietly excluded the surface most spend goes through.
 * The hints are validated against the authenticated tenant (see `usageWorkHints`),
 * so a caller cannot attribute its spend to somebody else's ticket, and a hint that
 * does not check out is dropped rather than allowed to fail the completion.
 */
export async function resolveWorkHints(c: Context<HonoEnv>, access: TenantAccess, metadata?: unknown): Promise<UsageWorkHints> {
  return resolveUsageWorkHints(
    c.env,
    access.tenantId,
    readUsageWorkHints((name) => c.req.header(name), metadata),
  );
}

/** What a passing {@link enforceTokenCaps} returns for the response headers/body. */
export interface TokenCapUsage {
  usageToday: number;
  planDailyLimit: number;
  usageMonth: number;
  planMonthlyLimit: number;
}

/**
 * Enforce the per-tenant token caps — daily (plan + optional per-agentHost) AND
 * monthly (the plan allowance the sidebar meter fills against). Shared by
 * `/v1/chat/completions`, the our-models branch of `/v1/messages` and
 * `/v1/embeddings` so no surface can bill on our pool without the gate. Returns the
 * 429 `Response` to send (a cap exceeded), or the usage numbers for the response
 * headers when the request may proceed.
 *
 * The plan cap decision + the superadmin(-owned-account) bypass are NOT implemented
 * here — they come from the ONE shared entry {@link getTenantTokenAvailability} (the
 * same the cron sweeps + Run-now use), so there is no parallel cap logic to drift.
 * This function only layers the gateway-specific per-agentHost daily cap on top and
 * shapes the 429 bodies. Usage totals are **cache-discounted** (cache_read ~0.1x,
 * cache_creation ~1.25x) inside the shared accountant.
 */
export async function enforceTokenCaps(
  c: Context<HonoEnv>,
  access: TenantAccess,
): Promise<{ blocked: Response } | TokenCapUsage> {
  const db = requestDb(c);

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

  // Per-seat monthly SPEND cap (Teams, owner-configured). A tenant that doesn't
  // BYO a key runs paid models on our OpenRouter account, metered at the OpenRouter
  // rate into `llm_usage_log.cost_usd_millicents` (BYO rows are 0). Once a seat's
  // month-to-date spend reaches its cap, pause NEW paid spend for that seat. Skipped
  // for non-Teams plans, seats with no cap, superadmin operators, and machine
  // credentials with no user (all handled inside getMemberSpendAvailability — the ONE
  // definition of the rule, shared with the owner overview + notifications). Fail-open
  // on any error so a scan blip never blocks a run.
  if (access.userId) {
    let spend: Awaited<ReturnType<typeof getMemberSpendAvailability>> | null = null;
    try {
      spend = await getMemberSpendAvailability(db, c.env, access.tenantId, access.userId, {
        effectivePlan: access.effectivePlan,
        actingUserId: access.userId,
        actingIsSuperadmin: access.isSuperadmin,
      });
    } catch { spend = null; }
    if (spend && spend.seatControlsEnabled && spend.capMillicents != null) {
      // Ping the seat + owners as they cross 50/80/100% — off the hot path.
      const notifyPromise = maybeEmitSpendNotification(db, c.env as Env, access.tenantId, access.userId, spend);
      try { c.executionCtx.waitUntil(notifyPromise); } catch { void notifyPromise.catch((error) => {
        reportCaughtError(error, { source: 'presentation/routes/llm/gatewayGuards.ts', operation: 'enforceTokenCaps' });
      }); }
      if (!spend.hasBudget) {
        const capUsd = millicentsToUsd(spend.capMillicents).toFixed(2);
        const retryAfter = secondsUntilNextUtcMonth();
        return {
          blocked: c.json({
            error: `Monthly AI spend cap reached for this seat ($${capUsd}). New paid model usage is paused until the cap resets or your workspace owner raises it. Connect your own model key to keep going at your own rate.`,
            code: 'member_spend_cap_exceeded',
            plan: access.effectivePlan,
            spendCapUsd: Number(capUsd),
            spentUsd: Number(millicentsToUsd(spend.spentMillicents).toFixed(2)),
            terminal: true,
            retryAfter,
          }, 429, { 'Retry-After': String(retryAfter) }),
        };
      }
    }
  }

  return { usageToday, planDailyLimit, usageMonth, planMonthlyLimit };
}

/** The 429 a premium pin gets once the day's premium budget is spent. Names the cap
 *  and when it resets, so the caller can retry precisely rather than poll. */
export function premiumCapExceededBody(cap: number) {
  return {
    error: {
      message:
        `Daily premium-model budget exhausted (cap $${(cap / 100_000).toFixed(2)}/day). `
        + 'Premium pins resume at UTC midnight; your plan pool is unaffected. '
        + 'Raise or remove the cap from workspace billing settings.',
      type: 'premium_daily_cap_exceeded',
      code: 'premium_daily_cap_exceeded',
      capMillicents: cap,
    },
  };
}

/**
 * Image-generation daily credit gate (migration 0131): 1 credit = 1 returned
 * image, counted from today's image-product usage rows. Independent of the chat
 * token cap. The query and the 429 live in the shared media gate, which video
 * generation uses too.
 */
export const IMAGE_CREDIT_POLICY: MediaCreditPolicy = {
  products: IMAGE_PRODUCT_NAMES,
  unitTokens: IMAGE_TOKEN_COST,
  code: 'image_credit_limit_exceeded',
  dailyLimit: (access) => resolveImageCreditsDailyLimit(access.imageCreditsDailyLimit, toTenantPlan(access.effectivePlan)),
  message: (limit, access) => `Daily image generation limit reached (${limit} image${limit === 1 ? '' : 's'} / day).${freePlanUpgradeHint(access, 'image')}`,
};
