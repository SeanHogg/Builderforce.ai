/**
 * Which model to try NEXT when the current one has proven it cannot do the job.
 *
 * The motivating case: a model that answers fluently but never emits structured
 * `tool_calls` (measured on `xai-oauth/grok-4.3`). Re-prompting it does not help —
 * `@builderforce/agent-stall` already spends a bounded recovery budget doing exactly
 * that. Once that budget is gone the only remedy left is a DIFFERENT model, and
 * telling the user to go pick one by hand is a worse product than the run picking one
 * and saying so.
 *
 * Pure + host-agnostic: it reads the same model surface the funding classifier and the
 * model pickers already hold, so no surface re-fetches `/llm/v1/models` to fail over.
 */

/**
 * The gateway model surface, as `/llm/v1/models` returns it and both hosts cache it.
 * Structurally a superset of what `classifyModelFunding` takes, so one cached object
 * feeds both.
 */
export interface ModelFallbackSurface {
  /** The plan pool — every model this tenant may select. */
  data?: Array<{ id?: string }>;
  /** The curated tool-calling / coding subset of the pool. */
  codingModels?: string[];
  /** Models reachable through the tenant's OWN connected accounts (BYO). */
  byo?: { models?: Array<{ id?: string; vendor?: string }> };
}

/** Non-empty ids from a list of `{ id }` records, in surface order. */
function ids(list: Array<{ id?: string }> | undefined): string[] {
  return (list ?? []).map((m) => m.id).filter((id): id is string => !!id);
}

/**
 * The next model to try, or undefined when nothing untried is left.
 *
 * Preference order, and why:
 *  1. **BYO ∩ coding pool** — the tenant's own connected account (so the retry costs
 *     nothing against the plan allowance) AND curated for tool calling, which is the
 *     capability that just failed. Best on both axes.
 *  2. **Coding pool** — curated for tool calling, plan-funded. We are failing over
 *     *because of* tool calling, so this outranks an arbitrary BYO model.
 *  3. **Anything else untried** — BYO first, then the rest of the plan pool.
 *
 * `tried` holds every model already attempted this run, including the original pin.
 * A caller that pinned nothing (gateway auto-select) should pass its resolved model,
 * so the failover cannot hand back the model that just failed.
 */
export function nextFallbackModel(
  surface: ModelFallbackSurface | null | undefined,
  tried: readonly string[],
): string | undefined {
  if (!surface) return undefined;
  const used = new Set(tried.filter(Boolean));
  const byo = ids(surface.byo?.models);
  const byoSet = new Set(byo);
  const coding = (surface.codingModels ?? []).filter(Boolean);
  const pool = ids(surface.data);

  const tiers = [
    coding.filter((m) => byoSet.has(m)),
    coding,
    byo,
    pool,
  ];
  for (const tier of tiers) {
    const hit = tier.find((m) => !used.has(m));
    if (hit) return hit;
  }
  return undefined;
}
