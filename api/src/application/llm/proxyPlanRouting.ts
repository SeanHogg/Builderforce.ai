/**
 * Plan → routing: which product name, model pool and vendor timeout a plan gets, the
 * plan's reachable coding models, and the premium-selection rule. Pure. Split out of
 * `LlmProxyService.ts`, which re-exports every symbol here.
 */

import type { EffectivePlan } from '../../domain/tenant/effectivePlan';
import { vendorForModel } from './vendors';
import {
  CODING_DEFAULT_MODEL,
  CODING_MODEL_POOL,
  FREE_MODEL_POOL,
  FREE_VENDOR_CALL_TIMEOUT_MS,
  PREMIUM_PRIORITY_POOL,
  PREMIUM_VENDOR_CALL_TIMEOUT_MS,
  PRO_MODEL_POOL,
} from './modelPool';
import type { ProductName } from './proxyTypes';

/**
 * Resolve the (productName, modelPool, vendorCallTimeoutMs) triple for a
 * given (plan, premiumOverride) pair. Single source of truth so the proxy
 * factory, the model-listing endpoint, and the response header logic stay
 * aligned. Per the DRY rule: callers consume this rather than recomputing
 * any of the three branches independently.
 *
 *   premiumOverride=true → top PREMIUM-tier models + extended 60s vendor
 *     timeout + Pro OpenRouter key. Plan/billing irrelevant — superadmin
 *     grant overrides them so comped / beta access works without flipping
 *     the billing plan.
 *
 *   premiumOverride=false → plan-driven routing as before.
 */
export function resolveRouting(
  effectivePlan: EffectivePlan,
  premiumOverride: boolean,
): { productName: ProductName; modelPool: readonly string[]; vendorCallTimeoutMs?: number } {
  if (premiumOverride) {
    return {
      productName: 'builderforceLLMPro',
      modelPool: PREMIUM_PRIORITY_POOL,
      vendorCallTimeoutMs: PREMIUM_VENDOR_CALL_TIMEOUT_MS,
    };
  }
  const productName: ProductName =
    effectivePlan === 'teams' ? 'builderforceLLMTeams'
    : effectivePlan === 'pro' ? 'builderforceLLMPro'
    :                            'builderforceLLM';
  if (effectivePlan === 'free') {
    // Free pool fails fast (15s/attempt) so it reaches the guaranteed paid
    // backstop within the caller's deadline. Paid plans keep the default budget.
    return { productName, modelPool: FREE_MODEL_POOL, vendorCallTimeoutMs: FREE_VENDOR_CALL_TIMEOUT_MS };
  }
  return { productName, modelPool: PRO_MODEL_POOL };
}

export function productNameForPlan(effectivePlan: EffectivePlan, premiumOverride = false): ProductName {
  return resolveRouting(effectivePlan, premiumOverride).productName;
}

export function modelPoolForPlan(effectivePlan: EffectivePlan, premiumOverride = false): readonly string[] {
  return resolveRouting(effectivePlan, premiumOverride).modelPool;
}

/**
 * Curated coding/tool-calling models the given plan can actually reach, best-first
 * — `CODING_MODEL_POOL` intersected with the plan's pool. The single source of
 * truth for "which coding models to offer / default to" on a plan: a free tenant
 * gets only the free coding models, a Pro tenant also gets the premium ones.
 * Consumed by `/llm/v1/models` (the cloud-agent picker) AND `codingDefaultForPlan`
 * (the cloud runtime default) so the picker and the runtime never diverge.
 */
export function codingModelsForPlan(effectivePlan: EffectivePlan, premiumOverride = false): string[] {
  const pool = new Set(modelPoolForPlan(effectivePlan, premiumOverride));
  return CODING_MODEL_POOL.filter((m) => pool.has(m));
}

/** Best coding model the plan can reach (Pro → premium, Free → free coding model),
 *  falling back to the global free default if the plan pool somehow excludes all. */
export function codingDefaultForPlan(effectivePlan: EffectivePlan, premiumOverride = false): string {
  return codingModelsForPlan(effectivePlan, premiumOverride)[0] ?? CODING_DEFAULT_MODEL;
}

/**
 * Is `model` a PREMIUM OpenRouter selection — i.e. an explicit pin on a PAID
 * OpenRouter model that is NOT already in the tenant's curated in-plan pool? This
 * is the "leverage OpenRouter → any paid model" tier: it routes on OUR metered
 * OpenRouter key, so selecting it is gated behind premium access (billing details + a
 * validated card) and billed at OpenRouter cost + a flat 1¢/request.
 *
 * Excluded (return false):
 *   • empty / no pin — nothing selected;
 *   • non-OpenRouter vendors (`@cf/*`, `direct/*`, `googleai/*`, `evermind/*`,
 *     `cerebras/*`, …) — those are plan-pool or BYO paths, not premium;
 *   • `:free` OpenRouter ids — the free tier;
 *   • ids already in the plan's auto-route pool (the curated PREMIUM coders like
 *     `anthropic/claude-sonnet-5` a paid plan already reaches for free).
 * Everything else that resolves to the OpenRouter vendor is the premium long tail.
 *
 * Pure so the gateway gate, the surcharge decision, and any picker filter share ONE
 * definition of "premium selection".
 */
export function isPremiumModelSelection(
  model: string | undefined | null,
  effectivePlan: EffectivePlan,
  premiumOverride = false,
): boolean {
  const id = typeof model === 'string' ? model.trim() : '';
  if (!id) return false;
  if (vendorForModel(id) !== 'openrouter') return false;
  if (id.endsWith(':free')) return false;
  return !modelPoolForPlan(effectivePlan, premiumOverride).includes(id);
}
