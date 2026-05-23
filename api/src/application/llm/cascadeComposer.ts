/**
 * Shared cascade composer for the 2-free-then-premium-fallback chain that both
 * the chat surface (`LlmProxyService.buildCandidateChain`) and the image
 * surface (`ImageProxyService.buildCandidateChain`) use.
 *
 * Why a helper instead of inline logic in each proxy: the cap + round-robin +
 * premium-fallback-dedup rules are identical across surfaces, but the *inputs*
 * differ (chat has per-model + per-vendor cooldown filtering; image only has
 * key-bound filtering). Extracting the shared shape behind a single function
 * with pluggable predicates means a future change to the "2 free then premium"
 * contract lands once, not twice.
 *
 * Single source of truth for: the cap-then-pass-through walk, the round-robin
 * within the FREE slice, dedup, and the empty-chain return contract.
 */

export interface ComposeCascadeOptions {
  /** Caller-hint + pool, in the order the gateway intends to try. */
  seed: readonly string[];
  /** Premium fallback chain, always appended after the seed slice. */
  premiumFallback: readonly string[];
  /** Maximum number of FREE-tier seed entries to keep before falling through. */
  freeBudget: number;
  /**
   * Per-model availability gate. Returns true when the model should be skipped
   * entirely (either its vendor key isn't bound, or it's on cooldown). Single
   * predicate so the caller composes cooldown / key-bound / etc. as needed.
   */
  isUnavailable: (model: string) => boolean;
  /** Tier classification for the FREE-vs-paid split. */
  tierOf: (model: string) => 'FREE' | 'STANDARD' | 'PREMIUM' | 'ULTRA';
  /**
   * Round-robin cursor reference. Caller owns the integer so this helper is
   * stateless. The cursor is incremented once per call regardless of FREE
   * slice size — matches the historical behaviour of both proxies.
   */
  cursor: { value: number };
}

/**
 * Build the `isUnavailable` predicate fed into `composeFreeCappedCascade`,
 * combining per-model cooldown, per-vendor cooldown, and the
 * "caller-pinned bypasses vendor cooldown" rule.
 *
 * Why pinned bypasses vendor cooldown but not per-model cooldown:
 *   - Per-vendor cooldown is global: e.g. an OpenRouter free-tier 429-storm
 *     trips it, then the cascade skips *every* OpenRouter model — including
 *     paid ones the caller explicitly asked for. That's wrong: the caller's
 *     hint is an explicit choice and should at least be tried.
 *   - Per-model cooldown is specific: the exact model the caller named has
 *     already failed recently. Retrying it immediately would burn the
 *     cascade budget on a known-broken endpoint. So the pinned model still
 *     respects its own cooldown.
 *
 * Single source of truth for this gate — extracted so it's unit-testable in
 * isolation (no need to spin up LlmProxyService + vendor mocks just to verify
 * "pinned paid model gets through even when free vendor is cooled").
 */
export function buildCooldownPredicate(opts: {
  /** Set of `<vendor>/<model>` keys that recently failed. */
  cooledModels: Set<string>;
  /** Vendors fully cooled (free-key 429-storm etc.). */
  cooledVendors: Set<string>;
  /** Catalog lookup — `(model) => vendorId`. */
  vendorOf: (m: string) => string;
  /**
   * Caller's `body.model` hint (non-strict). When matched, per-vendor cooldown
   * is bypassed so an explicit paid pin gets a chance to run. Per-model
   * cooldown still applies. Pass `undefined` when caller didn't pin.
   */
  pinnedModel?: string;
}): (m: string) => boolean {
  const { cooledModels, cooledVendors, vendorOf, pinnedModel } = opts;
  return (m) => {
    const v = vendorOf(m);
    if (cooledModels.has(`${v}/${m}`)) return true;
    if (pinnedModel !== undefined && m === pinnedModel) return false;
    return cooledVendors.has(v);
  };
}

/**
 * Compose a candidate chain that honours the FREE attempt cap, round-robins
 * within the FREE slice for load spreading, keeps all non-FREE seed entries
 * verbatim, appends the premium fallback chain, and dedups (preserving first
 * occurrence so caller-pinned models still get priority).
 *
 * Empty return = every candidate (seed + fallback) is unavailable. Caller
 * decides whether to fail fast or surface a specific error.
 */
export function composeFreeCappedCascade(opts: ComposeCascadeOptions): string[] {
  const { seed, premiumFallback, freeBudget, isUnavailable, tierOf, cursor } = opts;

  // Walk seed once: cap FREE-tier at `freeBudget`, keep paid verbatim.
  let freeKept = 0;
  const freeSlice: string[] = [];
  const paidSlice: string[] = [];
  for (const m of seed) {
    if (isUnavailable(m)) continue;
    if (tierOf(m) === 'FREE') {
      if (freeKept >= freeBudget) continue;
      freeSlice.push(m);
      freeKept++;
    } else {
      paidSlice.push(m);
    }
  }

  // Round-robin within the FREE slice (load-spread across the (up to N) entries).
  let freeRotated: string[];
  if (freeSlice.length > 0) {
    const start = cursor.value % freeSlice.length;
    freeRotated = [...freeSlice.slice(start), ...freeSlice.slice(0, start)];
  } else {
    freeRotated = [];
  }
  cursor.value++;

  const premium = premiumFallback.filter((m) => !isUnavailable(m));

  const composed = [...freeRotated, ...paidSlice, ...premium];
  const seen = new Set<string>();
  return composed.filter((m) => (seen.has(m) ? false : (seen.add(m), true)));
}
