/**
 * The pre-dispatch gates of `POST /v1/chat/completions` — strict-pin entitlement,
 * premium (any-paid-OpenRouter) selection, and the Idempotency-Key replay / no-op
 * guard. Each returns the refusal `Response` to send, or what the handler needs to
 * carry on; none of them dispatches anything.
 */
import type { Context } from 'hono';
import type { HonoEnv } from '../../../env';
import { reportCaughtError } from '../../../application/observability/caughtErrorReporter';
import { resolveStrictPin, isPremiumModelSelection, type ChatCompletionRequest } from '../../../application/llm/LlmProxyService';
import { resolvePremiumDailyCapMillicents, isPremiumCapExhausted } from '../../../application/llm/usageLedger';
import { vendorForModel } from '../../../application/llm/vendors';
import { toTenantPlan } from '../../../application/tenant/featureEntitlements';
import { secondsUntilNextUtcMidnight } from '../../../application/llm/tokenUsage';
import { findRecentIdempotentUsage } from '../../../application/llm/gatewayUsageLog';
import { decideReplay, IDEMPOTENT_REPLAY_HEADER, type IdempotencyStore } from '../../../application/shared/idempotentReplay';
import { TenantPlan } from '../../../domain/shared/types';
import { evaluatePremiumModelAccess, premiumModelGateBody } from '../../../domain/tenant/planFeatures';
import { upgradeRequiredBody } from '../../../domain/tenant/paymentRequired';
import { premiumCapExceededBody } from './gatewayGuards';
import type { TenantAccess } from './access';

/**
 * ── Strict-pin entitlement gate ─────────────────────────────────────────
 * Strict pin = dispatch ONLY the named `model`, NO substitution; an
 * unavailable model 503s instead of silently swapping (eval / reproducibility
 * runs). Accepts the public `strict: true` body flag, the `?strict=true`
 * query param, or the gateway-internal `modelStrict` cloud agents set — all
 * resolved by `resolveStrictPin`, then normalized onto `body.modelStrict` so
 * the proxy dispatch + trace logger see one canonical flag.
 *
 * Free tenants can't strict-pin — a single misbehaving model would otherwise
 * drain their daily budget with retries. Paid plans, superadmin-issued
 * daily-limit overrides, superadmin callers, and a pin on the tenant's OWN
 * connected provider bypass. Returns the 402 to send, or null.
 */
export function gateStrictPin(
  c: Context<HonoEnv>,
  access: TenantAccess,
  body: ChatCompletionRequest,
  byoVendors: ReadonlySet<string>,
): Response | null {
  const bodyAny = body as Record<string, unknown>;
  const queryStrict = c.req.query('strict') === 'true';
  const wantsStrict = resolveStrictPin(bodyAny, queryStrict);
  if (!wantsStrict) return null;
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
    return c.json(upgradeRequiredBody({
      error: 'Strict model pinning requires a paid plan (Pro/Teams), a connected provider (BYO), or a superadmin-issued daily-limit override.',
      code: 'strict_pin_not_allowed',
      currentPlan: access.effectivePlan,
      requiredPlan: TenantPlan.PRO,
    }), 402);
  }
  // Canonicalize: downstream (LlmProxyService.complete dispatch branch,
  // traceLogger) keys off `modelStrict`, so set it once here.
  body.modelStrict = true;
  return null;
}

/**
 * ── Premium (any-paid-OpenRouter) model selection ────────────────────────
 * Picking an OpenRouter model OUTSIDE the plan's curated pool is the premium
 * tier: it routes on OUR metered OpenRouter key, so it needs billing details and
 * a validated card (superadmin / premium override bypass). A model the tenant's
 * OWN connected provider serves is NOT premium — that's BYO, funded by them, so
 * it stays on the frontier-access rule and never reaches this gate.
 */
export async function gatePremiumSelection(
  c: Context<HonoEnv>,
  access: TenantAccess,
  body: ChatCompletionRequest,
  byoVendors: ReadonlySet<string>,
): Promise<{ blocked: Response } | { premiumSelected: boolean; pinnedModel: string }> {
  const bodyAny = body as Record<string, unknown>;
  const pinnedModel = typeof bodyAny.model === 'string' ? bodyAny.model.trim() : '';
  const pinnedIsByoVendor = !!pinnedModel && byoVendors.has(vendorForModel(pinnedModel));
  const premiumSelected = !pinnedIsByoVendor
    && isPremiumModelSelection(pinnedModel, access.effectivePlan, access.premiumOverride);
  if (premiumSelected) {
    const premium = evaluatePremiumModelAccess({
      effectivePlan: toTenantPlan(access.effectivePlan),
      premiumOverride: access.premiumOverride,
      isSuperadmin: access.isSuperadmin,
      cardValidated: access.cardValidated,
    });
    if (!premium.entitled) return { blocked: c.json(premiumModelGateBody(premium), 402) };
    // ENTITLED IS NOT UNBOUNDED. Premium is the metered long tail — an Opus-class id
    // at ~$75/M output — and until 0952 nothing capped it: the overflow cap is -1 for
    // paid plans and premium models are deliberately not in PAID_OVERFLOW_MODELS, so
    // a runaway agent pinned to an expensive model could bill without bound inside a
    // single UTC day. 429, not 402: the tenant IS entitled and has simply spent
    // today's budget — that distinction is what tells a client to retry tomorrow
    // rather than to go and buy something.
    if (await isPremiumCapExhausted(c.env, access.tenantId, access.premiumDailyCap, { isSuperadmin: access.isSuperadmin })) {
      const cap = resolvePremiumDailyCapMillicents(access.premiumDailyCap);
      return {
        blocked: c.json(premiumCapExceededBody(cap), 429, {
          'Retry-After': String(secondsUntilNextUtcMidnight()),
        }),
      };
    }
  }
  return { premiumSelected, pinnedModel };
}

/**
 * ── Idempotency-Key replay (shared store; 10-min usage-log guard) ───────
 * First choice: REPLAY the cached original response body (200) so a cron
 * retry gets the original answer transparently [1232]. Fallback (no cached
 * body — e.g. the original was streamed, or is still in-flight, or KV is
 * unbound): the DB no-op guard returns 409 so the retry can't double-charge.
 * Returns the replay / 409 to send, or null to proceed.
 */
export async function replayIdempotentRequest(
  c: Context<HonoEnv>,
  tenantId: number,
  idempotencyKey: string,
  store: IdempotencyStore,
  fingerprint: string,
): Promise<Response | null> {
  try {
    const decision = decideReplay(await store.get(tenantId, idempotencyKey), fingerprint);
    if (decision.kind === 'replay') {
      return new Response(decision.response.body, {
        status: decision.response.status,
        headers: {
          'content-type': decision.response.contentType ?? 'application/json',
          [IDEMPOTENT_REPLAY_HEADER]: 'true',
        },
      });
    }
  } catch (error) { /* store miss/error → fall through to the no-op guard */
    reportCaughtError(error, { source: 'presentation/routes/llm/chatCompletionGates.ts', operation: 'replayIdempotentRequest' });
  }
  const prior = await findRecentIdempotentUsage(c.env, tenantId, idempotencyKey);
  if (prior) {
    return c.json({
      error: `Idempotency-Key '${idempotencyKey}' was used at ${prior.createdAt?.toISOString()}. Treat this as a no-op retry.`,
      code: 'idempotent_replay',
      previousRequest: { id: prior.id, createdAt: prior.createdAt?.toISOString() },
    }, 409);
  }
  return null;
}
