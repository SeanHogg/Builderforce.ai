/**
 * The models a SERVER-side agent loop may fail over ONTO after a stall, as the shared
 * `ModelFallbackSurface` (`@builderforce/agent-stall`) — the tenant's own connected
 * flagships and the plan's curated coding pool.
 *
 * The browser hosts read this surface from `/llm/v1/models`; a server loop composes it
 * from the pool constants it already holds. Composed in one place so the addressed
 * reply (`BrainService.agentReply`), the cloud durable loop and the container `llm` op
 * offer the same successors in the same order.
 *
 * `data` (the general plan pool) is deliberately OMITTED: these are agentic tool turns,
 * and a tool loop that falls onto a non-coder flails and ships nothing — the same reason
 * their proxies are built `codingOnly`.
 */

import type { ModelFallbackSurface } from '@builderforce/agent-stall';
import { byoAutoSeedModels, codingModelsForPlan, type EffectivePlan } from './LlmProxyService';

export function codingFallbackSurface(
  byoVendors: ReadonlySet<string> | undefined,
  effectivePlan: EffectivePlan,
  premiumOverride: boolean,
): ModelFallbackSurface {
  const byoSeeds = byoAutoSeedModels(byoVendors, { agentic: true });
  return {
    // BYO agentic flagships fold into `codingModels` so BYO ∩ coding is non-empty —
    // `codingModelsForPlan` is the shared plan pool and correctly omits BYO-only ids.
    codingModels: [...new Set([...byoSeeds, ...codingModelsForPlan(effectivePlan, premiumOverride)])],
    byo: { models: byoSeeds.map((id) => ({ id })) },
  };
}
