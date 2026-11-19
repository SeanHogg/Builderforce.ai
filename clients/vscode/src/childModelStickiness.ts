/**
 * A sub-agent keeps the model it was first routed to — for its whole life.
 *
 * WHY: a child whose owner did not pin a model sends every turn unpinned, so the gateway
 * routes each turn afresh by role. VS Code chat #273's child hopped almost every turn —
 * MiniMax-M3.1-Flash → MiniMax-M3 (a 408 failover) → Flash → Flash → kimi-for-coding ×4 —
 * and each new model restated a plan from scratch. Routing by role picks the FIRST model;
 * this keeps it.
 *
 * The rule, per call of the child's stream:
 *   - the first call routes by role; the model that SERVED it is held;
 *   - every later call that names no model of its own is sent naming the held one;
 *   - a call served by a different model (the gateway failed the held one over) moves the
 *     hold only when the new model is the same family on the role's ladder
 *     (`@builderforce/model-catalog` `ladderRankOf`) — and then STAYS on it; a cross-family
 *     substitute answers that one call and the next goes back to the held model;
 *   - a call that THREW (provider error, timeout) on the held model sends the next call
 *     routed by role around it (`excludeModels`), and adopts what serves it under the same
 *     same-family rule;
 *   - after {@link RELEASE_HOLD_AFTER_MISSES} consecutive misses (throws or cross-family
 *     substitutes) the hold is released to the model that served — a dead model is not
 *     re-named forever;
 *   - a call that names a model of its own (the run's failover pick, a strict owner pick)
 *     is the caller's decision: it is sent as is, and what serves it is held.
 */

import type { BrainStreamFn } from "@seanhogg/builderforce-brain-embedded";
import { ladderModelId, ladderRankOf } from "@builderforce/model-catalog";

/** Ladder used to tell model FAMILIES apart for a role with no ladder of its own (it names every family). */
const FAMILY_LADDER_ROLE = "code";

/**
 * Is `next` an acceptable failover for `held` in this role — the same model, or the same
 * family on the role's ladder (the family ladder for an unladdered role)? Off-ladder
 * models match only themselves.
 */
export function sameModelTier(role: string, held: string, next: string): boolean {
  if (ladderModelId(held) === ladderModelId(next)) return true;
  const ladderRole = ladderRankOf(role, held) !== undefined || ladderRankOf(role, next) !== undefined ? role : FAMILY_LADDER_ROLE;
  const a = ladderRankOf(ladderRole, held);
  const b = ladderRankOf(ladderRole, next);
  return a !== undefined && a === b;
}

/** What the sticky stream holds, for a caller that reports it (tests, diagnostics). */
export interface StickyModelState {
  /** The model the child is held on, once its first call has been served. */
  held?: string;
  /** The held model's last call threw: the next call routes by role around it. */
  failing?: string;
  /** Consecutive calls the held model did not serve (a throw, or a cross-family substitute). */
  misses?: number;
}

/**
 * Consecutive misses after which the hold is RELEASED to the model that served: a held
 * model that is dead, with only another family able to stand in, would otherwise be
 * re-named — and fail — on every other turn for the rest of the child's life.
 */
export const RELEASE_HOLD_AFTER_MISSES = 2;

/** Wrap a child run's stream so its turns stay on the model it was first routed to. */
export function stickyChildStream(stream: BrainStreamFn, role: string, state: StickyModelState = {}): BrainStreamFn {
  return async (opts, handlers) => {
    const named = opts.model;
    const failing = !named ? state.failing : undefined;
    const excluded = opts.excludeModels ?? [];
    let send = opts;
    if (failing) {
      send = { ...opts, excludeModels: [...new Set([...excluded, failing])] };
    } else if (!named && state.held && !excluded.includes(state.held)) {
      send = { ...opts, model: state.held };
    }
    let result: Awaited<ReturnType<BrainStreamFn>>;
    try {
      result = await stream(send, handlers);
    } catch (error) {
      // A Stop is not a provider failure; anything else on the held model routes the next call around it.
      if (!opts.signal?.aborted && !named && state.held) {
        state.failing = state.held;
        state.misses = (state.misses ?? 0) + 1;
      }
      throw error;
    }
    state.failing = undefined;
    const served = result.resolvedModel ?? send.model;
    if (!served) return result;
    if (named || !state.held || served === state.held || sameModelTier(role, state.held, served)) {
      state.held = served;
      state.misses = 0;
      return result;
    }
    // A cross-family substitute: it answers this call; the hold moves only once the held model keeps missing.
    state.misses = (state.misses ?? 0) + 1;
    if (state.misses >= RELEASE_HOLD_AFTER_MISSES) {
      state.held = served;
      state.misses = 0;
    }
    return result;
  };
}
