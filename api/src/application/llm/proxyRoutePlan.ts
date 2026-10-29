/**
 * The candidate chain a completion request WOULD walk — split out of `proxyCompletion.ts`
 * so the dispatching path and a no-call preview read the SAME composition.
 *
 *   `callerModelOf` — the request's model hint, rewritten to its live successor.
 *   `planRoute`     — seed composition → cooldown prefetch → candidate chain (+ exclusions).
 *   `previewRoute`  — the models the request would try, in order, without dispatching
 *                     (a strict pin is its single model). Used to price a call BEFORE it is
 *                     made (PRD 38 §3.1 confirm chip) — cooldown reads only, no model call.
 */

import { canonicalModelId, resolveStrictPin } from './modelPool';
import { buildCandidateChain, composeCompletionSeed, loadSeedCooldowns } from './proxySeed';
import { applyExcludedModels } from './requestFit';
import type { VendorId } from './vendors';
import type { ProxyRuntime } from './proxyConfig';
import type { ChatCompletionRequest } from './proxyTypes';
import type { CompleteOptions } from './proxyCompletion';

/**
 * Rewrite a superseded pin to its live successor BEFORE anything reads it. `body.model` is
 * whatever the caller had stored (an agent base_model, a lane default, an SDK pin), and that
 * can be months old; a retired id must never reach dispatch or be filtered out of the BYO
 * seed as "not dispatchable".
 */
export function callerModelOf(body: ChatCompletionRequest): unknown {
  const raw = (body as { model?: unknown }).model;
  return typeof raw === 'string' && raw.trim() ? canonicalModelId(raw) : raw;
}

export interface RoutePlan {
  seed: readonly string[];
  seedHead: readonly string[];
  /** The seed's head (caller pin OR the strongest connected flagship): bypasses vendor cooldown. */
  pinnedHint: string | undefined;
  cooledSet: Set<string>;
  cooledVendors: Set<VendorId>;
  candidates: string[];
}

export async function planRoute(
  rt: ProxyRuntime,
  body: ChatCompletionRequest,
  callerModel: unknown,
  opts?: CompleteOptions,
): Promise<RoutePlan> {
  const { seed, seedHead } = await composeCompletionSeed(rt, body, callerModel, opts);
  const [cooledSet, cooledVendors] = await loadSeedCooldowns(rt, seed);
  // Pinned hint bypasses vendor-level cooldown so a caller-explicit paid model gets tried
  // even when the same vendor's free key has 429'd into vendor cooldown; per-model cooldown
  // still applies. The seed's head (pin OR strongest connected flagship) is the cascade HEAD
  // so a deliberately-seeded connected account leads verbatim (see composeFreeCappedCascade).
  const pinnedHint = seedHead.length > 0 ? seedHead[0] : undefined;
  const candidates = applyExcludedModels(
    buildCandidateChain(rt, seed, cooledSet, cooledVendors, pinnedHint, seedHead),
    body.excludeModels,
  );
  return { seed, seedHead, pinnedHint, cooledSet, cooledVendors, candidates };
}

/** The models `body` would try, first to last, without dispatching anything. */
export async function previewRoute(rt: ProxyRuntime, body: ChatCompletionRequest, opts?: CompleteOptions): Promise<string[]> {
  const callerModel = callerModelOf(body);
  if (resolveStrictPin(body as { model?: unknown; modelStrict?: unknown; strict?: unknown })) return [callerModel as string];
  return (await planRoute(rt, body, callerModel, opts)).candidates;
}
