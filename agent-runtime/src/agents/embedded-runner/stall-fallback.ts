/**
 * WHO takes over when a self-hosted model burns its whole stall budget — the on-prem
 * answer to a question the gateway loops already answered.
 *
 * The Brain run loop and the server addressed-reply loop both swap models through the
 * shared `chooseStallFailover`: a turn that ends with zero tool calls while tools were
 * available is a model-behaviour failure, and once the re-prompt budget is spent the
 * only remedy that works is a DIFFERENT model. Those loops pick one from the tenant's
 * gateway catalog. This loop has no catalog: its `Model` is an operator's explicit pin
 * on their own hardware, and substituting an arbitrary model for it is a different
 * product decision from re-routing a gateway request.
 *
 * So the successor comes from the ONE place the operator has already declared it:
 * `agents.defaults.model.fallbacks`, read through {@link resolveFallbackCandidates} —
 * the very chain the transport-level failover (`runWithModelFallback`) walks when a
 * provider 429s, and the one learned routing re-orders. Nothing new to configure, and
 * nothing the operator did not already name.
 *
 * That is also why this returns `undefined` for a single-candidate chain: an operator
 * who declared no alternative gets the loud `stallExhaustedNotice`, unchanged. A stall
 * failover is only ever a move BETWEEN models the operator listed.
 */

import { modelRef } from "../../builderforce/agent-loop/stall-recovery.js";
import type { Model } from "../../builderforce/model/types.js";
import type { BuilderForceAgentsConfig } from "../../config/config.js";
import { resolveFallbackCandidates } from "../model-fallback.js";
import { resolveModel } from "./model.js";

interface StallFallbackPickerParams {
  cfg: BuilderForceAgentsConfig | undefined;
  /** The provider the run STARTED on (the pin), as `resolveModel` was called with. */
  provider: string;
  /** The model id the run STARTED on. */
  modelId: string;
  agentDir?: string;
}

/**
 * Build the `pickFallbackModel` seam for a run, or `undefined` when this operator's
 * configuration offers nowhere to fail over to (a single-candidate chain).
 *
 * The returned picker walks the operator's declared chain IN ORDER, skips every ref
 * already burned this run, and resolves each candidate to a full {@link Model} the way
 * the runner resolved the primary — a candidate whose provider is unregistered (no key,
 * no inline definition) simply is not offered, exactly as `runWithModelFallback` would
 * find at request time. Returns undefined once the chain is exhausted, which is the
 * signal the loop needs to stop and explain rather than keep switching.
 */
export function createStallFallbackPicker(
  params: StallFallbackPickerParams,
): ((tried: readonly string[]) => Model | undefined) | undefined {
  const candidates = resolveFallbackCandidates({
    cfg: params.cfg,
    provider: params.provider,
    model: params.modelId,
  });
  // One candidate = the pin itself. Nothing was declared to fall over to, so the loop
  // keeps its previous behaviour and never substitutes a model the operator did not name.
  if (candidates.length <= 1) {
    return undefined;
  }

  return (tried: readonly string[]): Model | undefined => {
    const used = new Set(tried);
    for (const candidate of candidates) {
      const resolved = resolveModel(
        candidate.provider,
        candidate.model,
        params.agentDir,
        params.cfg,
      ) as { model?: Model };
      if (!resolved.model) {
        continue;
      }
      if (used.has(modelRef(resolved.model))) {
        continue;
      }
      return resolved.model;
    }
    return undefined;
  };
}
