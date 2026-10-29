/**
 * The cloud's tier ladder for the D1 verifier cascade and A3's escalation (PRD 35 WS3). The cascade itself —
 * the weak-first seed, the verdicts, the reasoning boost — is the one agent's (`policy/guards`); what the CLOUD
 * supplies is the ladder it moves along, built from the tenant's connected flagships and the plan's coding pool.
 */
import { MODEL_TIERS, type ModelTier } from '@builderforce/model-catalog';
import type { TierLadder } from '@builderforce/run-policy';
import { tierForModel } from '../../llm/vendors/registry';
import { codingFallbackSurface } from '../../llm/codingFallbackSurface';
import type { EffectivePlan } from '../../llm/LlmProxyService';

/** A coding run's tier ladder: the tenant's connected flagships and the plan's coding
 *  pool — the same successors a stall failover may take (`codingFallbackSurface`). A
 *  tenant that connected providers runs on THEIR models only, so its ladder is theirs. */
export function cloudTierLadder(byoVendors: ReadonlySet<string>, plan: EffectivePlan, premiumOverride: boolean, byoStrict: boolean): TierLadder {
  const surface = codingFallbackSurface(byoVendors, plan, premiumOverride);
  const byo = (surface.byo?.models ?? []).map((m) => m.id).filter((id): id is string => !!id);
  const candidates = byoStrict && byo.length > 0 ? byo : surface.codingModels ?? [];
  return {
    candidates,
    rankOf: (model) => {
      const i = MODEL_TIERS.indexOf(tierForModel(model) as ModelTier);
      return i < 0 ? 1 : i;
    },
  };
}
