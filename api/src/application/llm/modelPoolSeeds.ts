/**
 * Connected-account (BYO) seeding — which of the tenant's OWN models lead
 * auto-select, whether an explicit model preempts them, and whether a seed id is
 * dispatchable at all.
 *
 * Part of the `modelPool` split (see `modelPool.ts`, the public barrel).
 */

import { catalogEntry, parseVendorPrefix, tierForModel, vendorForModel } from './vendors';
import { tierRank } from '@builderforce/model-catalog';
import { providerFrontierFlagship } from './modelPoolComposition';

/**
 * The connected owner's OWN premium frontier models to lead auto-select with — ONE
 * flagship per connected provider, so an auto-select turn (no explicit model) uses the
 * owner's account(s) before the free/paid gateway tiers (the "connect your account →
 * it gets used" guarantee the settings/api-keys UI implies).
 *
 * Purely REGISTRATION-DRIVEN and multi-provider: it reflects exactly what the tenant
 * connected — connect only OpenAI → GPT leads; connect all three → all three frontier
 * flagships lead. Ordering: the tenant's own BYO PRECEDENCE (`opts.vendorPriority`,
 * most-preferred gateway vendor id first — e.g. Meta first) wins, with catalog TIER
 * (ULTRA → PREMIUM → STANDARD) as the tiebreak for un-ranked vendors. With no precedence
 * set it degrades to pure tier order (the prior behaviour). The cascade then fails over
 * across the owner's OTHER connected accounts in that order before ever touching a
 * free/paid pool model. It is a SOFT seed: the plan pool stays behind the list as fallback.
 *
 * `byoVendors` is the gateway VENDOR-id set the tenant can serve from their own
 * account (see `byoVendorIdsFromCredentials` / the proxy's connected set). Returns `[]` when
 * nothing is connected — plan routing is then unchanged. Single source both the
 * gateway completion seed ({@link LlmProxyService.complete}) and the cloud-agent pin
 * ({@link pickCloudModel}, which leads with `[0]`) use, so the surfaces never diverge.
 * Every id is a real catalog entry on its direct vendor (`byo` → $0), asserted in
 * `LlmProxyService.codingPool.test`.
 */
export function byoAutoSeedModels(
  byoVendors: ReadonlySet<string> | null | undefined,
  opts: {
    agentic: boolean;
    vendorPriority?: readonly string[];
    demotedVendors?: ReadonlySet<string>;
    /** Each connected vendor's SELECTED models (1165) as tenant-keyed refs, keyed by
     *  dispatch vendor. A selected vendor contributes its whole ordered list — lead model
     *  first, then its own failover — in place of its single flagship. */
    selectedModels?: Readonly<Record<string, readonly string[]>>;
  },
): string[] {
  if (!byoVendors || byoVendors.size === 0) return [];
  // One GROUP per connected vendor: the tenant's ordered selection when they made one,
  // else the vendor's frontier flagship. A selection is taken as given — its refs route
  // by their `direct/<vendor>/` prefix, not catalog membership, which is the whole point
  // of choosing a model the static catalog never listed. Only the flagship constant is
  // guarded, because only it can drift out from under the catalog.
  const groups = [...byoVendors]
    .map((v): string[] => {
      const selected = opts.selectedModels?.[v];
      if (selected?.length) return [...selected];
      const flagship = providerFrontierFlagship(v, opts.agentic);
      return flagship !== null && isDispatchableSeed(flagship) ? [flagship] : [];
    })
    .filter((group) => group.length > 0);
  // TENANT PRECEDENCE first, catalog tier as tiebreak. `vendorPriority` is the tenant's
  // ordered gateway vendor ids (most-preferred first — e.g. Meta first); a flagship's
  // vendor is matched via vendorForModel so `direct/meta/…` → 'meta' lines up. A vendor
  // NOT in the list sorts after every ranked one (Infinity), then falls back to tier —
  // so with NO precedence set this is exactly the prior tier-only order. Array.prototype
  // .sort is stable in V8, so equal keys keep the connected-set iteration order.
  const priority = opts.vendorPriority ?? [];
  // A vendor NOT in the precedence ranks AFTER every ranked one — but with a FINITE
  // sentinel (`priority.length`), not Infinity: two un-ranked vendors must compare
  // EQUAL (rank − rank = 0 → tier tiebreak), and Infinity − Infinity is NaN, which
  // corrupts Array.sort. With no precedence set every rank is 0 → pure tier order.
  const priorityRank = (m: string): number => {
    const i = priority.indexOf(vendorForModel(m));
    return i === -1 ? priority.length : i;
  };
  // UPSTREAM HEALTH is the OUTERMOST sort key — it outranks tenant precedence.
  //
  // This is not a precedence override; it is what makes precedence usable. A
  // vendor on a 5xx streak (see `vendorHealth`) still gets called, still ahead of
  // the plan pool, and still first when it is the ONLY connected account — but it
  // stops LEADING while it is faulting, because leading is precisely what costs a
  // full vendor timeout on every cascade before anything else is tried. Honouring
  // "Meta first" literally through a Meta outage means every request pays 25s to
  // reach the account the tenant would have picked second anyway.
  //
  // Distinct from the COST cooldown by design: that gate REMOVES a capped/broken
  // vendor from the chain, this only REORDERS a healthy-but-flaky one. A demoted
  // vendor clears on its next successful call, not on a timer.
  const demoted = opts.demotedVendors;
  const healthRank = (m: string): number => (demoted?.has(vendorForModel(m)) ? 1 : 0);
  // Groups sort by their LEAD model and never interleave: a selected vendor's failover
  // stays directly behind its own lead, in exactly the order the tenant chose.
  return groups.sort((groupA, groupB) => {
    const a = groupA[0]!;
    const b = groupB[0]!;
    const h = healthRank(a) - healthRank(b);
    if (h !== 0) return h;
    const p = priorityRank(a) - priorityRank(b);
    if (p !== 0) return p;
    return tierRank(tierForModel(a)) - tierRank(tierForModel(b));
  }).flat();
}

/** Registered OpenRouter connection refs (`openrouter/<org>/<slug>`), in either shape. */
export type ModelRefs = ReadonlySet<string> | readonly string[] | null | undefined;

/** Membership test that accepts either shape a caller already holds — the proxy keeps
 *  the registered refs as a Set, the credentials resolver as an array — so neither has
 *  to allocate a copy on the hot path just to ask this question. */
function refsHave(refs: ModelRefs, id: string): boolean {
  if (!refs) return false;
  // `Array.isArray` does not narrow a `readonly string[]` union member, so discriminate
  // on the Set surface instead — which is also the cheaper check for the hot-path shape.
  return refs instanceof Set ? refs.has(id) : (refs as readonly string[]).includes(id);
}

function refsCount(refs: ModelRefs): number {
  if (!refs) return 0;
  return refs instanceof Set ? refs.size : (refs as readonly string[]).length;
}

/**
 * Does an explicit model choice preempt the tenant's connected-BYO auto-seed?
 *
 * Connecting your own frontier account is a strong "use MY account" signal, so it
 * leads auto-select UNLESS the explicit model is a deliberate choice ON that account.
 * Returns true (honor the explicit model) when:
 *   • the tenant has NOTHING rankable — no connected provider AND no registered
 *     OpenRouter connection — so normal plan routing applies, OR
 *   • the explicit model is itself served by a connected BYO vendor, OR is one of the
 *     tenant's REGISTERED OpenRouter connection refs (both are deliberate picks on the
 *     owner's own list — e.g. they connected Claude AND pinned claude-opus).
 * Returns false (let the tenant's own precedence lead) for a NON-BYO explicit model
 * while anything is connected — e.g. a default agent base model of `@cf/qwen` must NOT
 * shadow a connected Claude subscription (the exact bug where Ada ran on `@cf/qwen`
 * despite a live subscription).
 *
 * `registeredModels` is load-bearing, not an optimisation. An OpenRouter CONNECTION
 * (0382) contributes no provider row and therefore no BYO *vendor*, so a rule that only
 * consults `byoVendors` is blind to it in BOTH directions: a deliberately-pinned
 * connection ref gets discarded as "not BYO", and a tenant whose ONLY rankable account is
 * a connection has every stale caller default treated as preempting. Both are how a
 * precedence list with an OpenRouter connection at #1 could be silently ignored.
 *
 * This is the SINGLE branching rule the gateway seed ({@link LlmProxyService.complete}),
 * the cloud pin ({@link pickCloudModel}), `byoAwareModel` and the Brain addressed-reply
 * path share, so "the tenant's own account wins over a non-BYO pin" can never drift
 * between the surfaces again.
 */
export function explicitModelPreemptsByo(
  explicit: string | undefined | null,
  byoVendors: ReadonlySet<string> | null | undefined,
  registeredModels?: ModelRefs,
): boolean {
  const trimmed = typeof explicit === 'string' ? explicit.trim() : '';
  if (!trimmed) return false;
  if (refsHave(registeredModels, trimmed)) return true;
  const rankable = (byoVendors?.size ?? 0) + refsCount(registeredModels);
  if (rankable === 0) return true;
  return !!byoVendors?.has(vendorForModel(trimmed));
}

/**
 * A {@link byoAutoSeedModels} output is dispatchable when it's a known bare catalog id
 * (the Anthropic direct ids `claude-*`) OR a vendor-prefixed id (`direct/openai/…`,
 * `googleai/…`) whose PREFIX-STRIPPED model id is a real catalog entry — `isKnownModel`
 * alone looks up the bare index and would false-negative the prefixed BYO seeds.
 * Guards the seed list against a drifted flagship constant. Asserted in
 * `LlmProxyService.codingPool.test`.
 */
export function isDispatchableSeed(id: string): boolean {
  if (isKnownModel(id)) return true;
  const parsed = parseVendorPrefix(id);
  return !!parsed && isKnownModel(parsed.modelId);
}

/**
 * True when `model` is a real catalog id (any vendor, any tier). Callers that
 * hard-pin a model (`modelStrict`) use this to avoid enforcing a typo'd / retired
 * id — which would 503 with no failover — and fall back to a safe default instead.
 */
export function isKnownModel(model: string | undefined): boolean {
  return typeof model === 'string' && model.trim().length > 0 && catalogEntry(model.trim()) !== null;
}
