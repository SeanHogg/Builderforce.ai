/**
 * Which model to try NEXT when the current one has proven it cannot do the job.
 *
 * The motivating case: a model that answers fluently but never emits structured
 * `tool_calls` (measured on `xai-oauth/grok-4.3`). Re-prompting it does not help —
 * the detectors in `./index` already spend a bounded recovery budget doing exactly
 * that. Once that budget is gone the only remedy left is a DIFFERENT model, and
 * telling the user to go pick one by hand is a worse product than the run picking one
 * and saying so.
 *
 * ── WHY IT LIVES HERE ────────────────────────────────────────────────────────────
 * It started in `brain-embedded` (a React package), so the only loops that could
 * reach it were the ones running in a browser. The SERVER-side addressed-agent loop
 * — `BrainService.agentReply`, the path the manager's accountability chat runs on —
 * could not import it, and hand-rolled the decision instead as "drop the model pin
 * and let the cascade re-route". That looks equivalent and is not: on the DEFAULT
 * path for any tenant with a connected account the reply is never pinned in the first
 * place, so there was no pin to drop, the failover branch was unreachable, and the
 * run gave up after one model with a notice telling the user to go pick another
 * (project 11 / chat 86: 11 model turns, ONE model, zero tool calls, zero failovers).
 *
 * The failover POLICY (budget, notices) already lived in this package. The failover
 * SELECTION belongs with it, or the two drift — which is exactly what happened.
 *
 * Pure + host-agnostic: it reads the model surface a caller already holds, so nothing
 * re-fetches a catalog to fail over.
 */

/**
 * The gateway model surface, as `/llm/v1/models` returns it and both browser hosts
 * cache it. Structurally a superset of what `classifyModelFunding` takes, so one
 * cached object feeds both. A SERVER caller composes the same shape from the pool
 * constants it already has (see `BrainService.agentReply`).
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
 * A caller driving an AGENTIC turn should leave `data` unset: tier 4 is the general
 * plan pool, and falling a tool-loop onto a non-coder produces a run that flails and
 * ships nothing (the same reasoning as the gateway's coding-only backstop chain).
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

/**
 * How many times ONE run may swap MODELS after a model burns its whole stall budget.
 * Small on purpose: each switch replays the turn, and a run that two different models
 * have already failed to act on is not going to be rescued by a third — at that point
 * the honest move is to stop and say so, not to walk the catalog on the tenant's money.
 *
 * Lives beside the selector it bounds (and is re-exported from `./index`), so a caller
 * cannot reach the budget without also reaching the picker that spends it — which is how
 * one loop ended up enforcing the budget over a failover that never happened.
 */
export const MAX_MODEL_FAILOVERS = 2;

/** What a loop knows when a model has just burned its whole stall budget. */
export interface StallFailoverInput {
  /** The model the loop ASKED for this turn — undefined on a gateway auto-select turn. */
  activeModel?: string | null;
  /** The model that actually ANSWERED, as the gateway resolved it. */
  resolvedModel?: string | null;
  /** Models already burned this run. MUTATED: the two above are appended. */
  tried: string[];
  /** Failovers already spent this run. */
  failoversUsed: number;
  /**
   * Where a replacement comes from. A caller that HOLDS the model surface passes
   * `surface`; a caller whose host owns the choice (the browser run loop, which is
   * handed a `pickFallbackModel` by whichever app mounted it) passes `pick`. `pick`
   * wins when both are present. Neither ⇒ no failover, which is the correct answer for
   * a host that never wired one up.
   */
  surface?: ModelFallbackSurface | null;
  pick?: ((tried: readonly string[]) => string | undefined) | undefined;
}

/**
 * The whole "this model is spent — who takes over?" decision, in one place.
 *
 * Three steps that must happen together, and did not:
 *
 *  1. **Record both ids.** An unpinned turn asked for nothing, so `activeModel` is
 *     undefined and `resolvedModel` is the ONLY id naming the model to skip. Recording
 *     just one leaves the failover free to hand back the model that just failed.
 *  2. **Check the budget.** {@link MAX_MODEL_FAILOVERS}: a run two models have already
 *     failed is not rescued by a third, and walking the catalog costs the tenant money.
 *  3. **Pick a genuinely different model** — never "unpin and hope the cascade differs".
 *
 * Both the browser run loop and the server addressed-reply loop had hand-written copies
 * of this. The server's got step 3 wrong (`if (budget && activeModel) { activeModel =
 * undefined }`), which reads as a failover and is unreachable on the unpinned default
 * path — the ONE path a tenant with a connected account takes. The observable result was
 * a chat that burned 11 turns on a single model, never failed over, and closed by telling
 * the user to go pick a different model by hand.
 *
 * Returns the model to switch to, or `undefined` when the run should stop and say so.
 */
export function chooseStallFailover(input: StallFailoverInput): string | undefined {
  for (const m of [input.activeModel, input.resolvedModel]) {
    if (m && m !== 'default' && !input.tried.includes(m)) input.tried.push(m);
  }
  if (input.failoversUsed >= MAX_MODEL_FAILOVERS) return undefined;
  const next = input.pick
    ? input.pick(input.tried)
    : nextFallbackModel(input.surface, input.tried);
  // A `pick` supplied by a host is outside this package's control, so the promise the
  // caller relies on — "never the model that just failed" — is enforced here rather
  // than assumed of every implementation.
  return next && !input.tried.includes(next) ? next : undefined;
}
