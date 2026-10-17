/**
 * Request-FIT helpers shared by the gateway completion seed and `pickCloudModel`:
 * caller exclusions, the funded-floor hint demotion, the token estimate, and the
 * context-window fit filter. Pure. Split out of `LlmProxyService.ts`, which
 * re-exports them.
 */

import { catalogEntry } from './vendors';
import { canonicalModelId, isPaidOverflowModel } from './modelPool';
import { estimateTokensFromChars } from './tokenUsage';

/** Headroom over the prompt estimate to reserve for the model's OUTPUT tokens +
 *  estimate error, when checking whether a context window fits. */
const CONTEXT_FIT_HEADROOM = 1.25;

/**
 * Route AROUND models the caller has already proved unusable for this work.
 *
 * A soft de-selection with one hard rule: never return an empty chain. "The only
 * model I have left is one that just disappointed me" is still strictly better than
 * "I refuse to run" — which is the failure this exists to prevent, where a free-plan
 * Canvas session disabled its one auto-selected model and then told the visitor to
 * select a different one they had no ability to select.
 *
 * Pure + unit-testable.
 */
export function applyExcludedModels(candidates: string[], exclude: unknown): string[] {
  const excluded = new Set(
    (Array.isArray(exclude) ? exclude : [])
      .filter((m): m is string => typeof m === 'string' && m.trim().length > 0)
      .map((m) => canonicalModelId(m)),
  );
  if (excluded.size === 0) return candidates;
  const kept = candidates.filter((model) => !excluded.has(canonicalModelId(model)));
  return kept.length > 0 ? kept : candidates;
}

/**
 * Should a NON-STRICT caller `model` hint stay OUT of the chain's lead because it names
 * a model Builderforce funds on its own key ({@link isPaidOverflowModel}) and the
 * caller is on the free plan? True ⇒ the hint joins the chain BEHIND the plan pool
 * instead of ahead of it, so the free coders are tried first and the funded floor is
 * still the fallback it was designed to be. A paid/teams/override caller, a plan-pool
 * model, or no hint at all leads exactly as before. Pure + unit-testable.
 */
export function fundedFloorHintDemoted(callerModel: string | undefined, isPro: boolean): boolean {
  return !!callerModel && !isPro && isPaidOverflowModel(callerModel);
}

/**
 * Rough token estimate for a chat request (~4 chars/token over the serialized
 * messages + tools). For MODEL-FIT selection only, NOT billing — a cheap heuristic
 * that errs slightly high (JSON punctuation), which is the safe direction for a fit
 * check. Pure + unit-testable.
 */
export function estimateRequestTokens(messages: unknown, tools?: unknown): number {
  const chars = JSON.stringify(messages ?? '').length + (tools != null ? JSON.stringify(tools).length : 0);
  return estimateTokensFromChars(chars);
}

/**
 * Drop models whose catalog `contextWindow` can't hold `estimatedTokens` (+ output
 * headroom) — the context-aware FIRST-PASS filter. Unknown-window models pass
 * (assumed large enough, e.g. OpenRouter ids carry no window in our catalog). NEVER
 * returns empty: if NOTHING fits (the request is larger than every window) the full
 * set is returned so the normal cascade + the 413 failover handle the oversized
 * request honestly instead of this silently picking nothing. Pure + unit-testable.
 */
export function modelsFittingContext(models: readonly string[], estimatedTokens?: number): string[] {
  if (!estimatedTokens || estimatedTokens <= 0) return [...models];
  const need = Math.ceil(estimatedTokens * CONTEXT_FIT_HEADROOM);
  const fit = models.filter((m) => {
    const cw = catalogEntry(m)?.contextWindow;
    return cw == null || cw >= need;
  });
  return fit.length > 0 ? fit : [...models];
}
