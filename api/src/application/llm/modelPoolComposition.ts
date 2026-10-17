/**
 * Model pool composition — the plan pools and the coding pool, derived from the
 * vendor catalogs, plus the supersession rewrite and the coder-recognition set.
 *
 * Part of the `modelPool` split (see `modelPool.ts`, the public barrel). A LEAF over
 * the vendor catalogs: the pool sets are built eagerly at import, so nothing here may
 * import back through `LlmProxyService`.
 */

import {
  anthropicModule,
  catalogSupersessions,
  vendorFlagship,
  autoRoutableModelsByTier,
  vendorForModel,
  type VendorId,
} from './vendors';
import { BYO_VENDOR_IDS } from './llmProviderCatalog';

// ---------------------------------------------------------------------------
// Pool composition (derived from vendor catalogs — single source of truth)
//
// Multi-vendor by construction. `autoRoutableModelsByTier` walks every registered vendor
// in registry MODULES order (cerebras → ollama → nvidia → openrouter), so the
// free pool naturally starts with sub-200ms TTFT Cerebras entries and ends
// with the highest-variance OpenRouter free tier. When a vendor's key isn't
// bound, its models stay in the pool but are filtered out at dispatch by
// `dispatchVendor`'s no-key skip — and surfaced as `available: false` in
// `status()` so the admin UI doesn't claim availability for unbound vendors.
// ---------------------------------------------------------------------------

// `autoRoutableModelsByTier` (not `modelsByTier`) is the pool composer: it walks
// the same registry order but DROPS vendors that opt out of auto-routing
// (`autoRoute: false`, currently Ollama). A non-auto-route vendor stays in the
// catalog — reachable via an explicit `ollama/<id>` pin — but is never a model a
// FREE/PRO cascade can silently fall onto. (Fixes: a cloud coding agent cascading
// into `ollama/gpt-oss:120b`, which 400s on the tool payload.)

/**
 * The vendor whose models lead every PAID list. Cloudflare Workers AI bills in
 * "neurons" with the first ~10,000/day FREE, so draining a paid pool through
 * Cloudflare BEFORE any metered vendor makes that overflow effectively free up to
 * the daily allowance. Single source for the lead-vendor choice so the general
 * paid pool and the coding pools never disagree on which vendor to prefer.
 */
export const PAID_LEAD_VENDOR: VendorId = 'cloudflare';

/**
 * Reorder a model pool so `vendor`'s models lead, preserving each group's relative
 * order. Used to surface the free-daily-allowance vendor ({@link PAID_LEAD_VENDOR})
 * first in PAID pools so metered spend is deferred until its allowance is spent.
 * No-op for a vendor with no models in the pool (e.g. an unbound Cloudflare key
 * still leaves the rest of the pool in registry order).
 */
export function leadPoolWithVendor(pool: readonly string[], vendor: VendorId): string[] {
  const lead = pool.filter((m) => vendorForModel(m) === vendor);
  if (lead.length === 0) return [...pool];
  const rest = pool.filter((m) => vendorForModel(m) !== vendor);
  return [...lead, ...rest];
}

/** Auto-routable free-tier model ids across every registered cloud vendor. */
export const FREE_MODEL_POOL: readonly string[] = autoRoutableModelsByTier('FREE');

/**
 * Auto-routable paid-tier model ids (STANDARD / PREMIUM / ULTRA) across vendors,
 * LED BY {@link PAID_LEAD_VENDOR} (Cloudflare) so its free daily neuron allowance
 * is spent before any metered vendor; the remaining paid models follow in registry
 * (TTFT) order.
 */
export const PRO_PAID_MODEL_POOL: readonly string[] =
  leadPoolWithVendor(autoRoutableModelsByTier('STANDARD', 'PREMIUM', 'ULTRA'), PAID_LEAD_VENDOR);

/** Pro tries free first (cost-optimized), falls over to paid. */
export const PRO_MODEL_POOL: readonly string[] = [...FREE_MODEL_POOL, ...PRO_PAID_MODEL_POOL];

/** Every direct-Anthropic model the `anthropic` vendor catalogs (bare `claude-*` ids on
 *  CLAUDE_API_KEY). Read from the catalog so a model bump is one catalog edit, not a
 *  hunt for every hand-copied list. */
export const ANTHROPIC_DIRECT_MODEL_IDS: readonly string[] = anthropicModule.catalog.map((entry) => entry.id);

/** A vendor's declared flagship for each requested turn shape, de-duplicated, in the
 *  order asked — `[]` when the vendor declares none. The routing lists below name a
 *  vendor's ROLE through this, never a model version, so a release is a catalog edit. */
export function flagshipsOf(vendor: string, ...shapes: Array<'agentic' | 'chat'>): string[] {
  const ids = shapes.map((shape) => vendorFlagship(vendor, shape === 'agentic'));
  return [...new Set(ids.filter((id): id is string => id !== null))];
}

/**
 * Curated agentic-coding pool — models that reliably (a) honour multi-turn
 * `tools` / `tool_choice` round-trips AND (b) write competent code. This is the
 * SINGLE SOURCE OF TRUTH for "what can drive a cloud coding agent":
 *   - a cloud execution pins its model from here (see `runCloudToolLoop`),
 *   - the user-facing cloud-agent model picker is filtered to this list,
 *   - `TOOL_CAPABLE_MODELS` / `STRUCTURED_OUTPUT_MODELS` are DERIVED from it,
 * so the picker, the runtime default, and the capability-reorder can never drift
 * apart again (the bug this replaces: the capability sets pinned the retired
 * `anthropic/claude-3.7-sonnet`, scoring every current Anthropic model 0 so it
 * never floated up for a tools request).
 *
 * Ordered best-first across plans: PREMIUM coding models lead (Pro tenants land
 * here), then the strongest FREE tool-capable models as the Free-plan / fallback
 * tail. Every id MUST exist in a vendor catalog — `LlmProxyService.codingPool.test`
 * asserts this so a catalog rename trips CI instead of silently degrading routing.
 */
// Every id below is verified against the live OpenRouter /models API (all are
// tool-capable). The cloud gateway dispatches free runs on the OpenRouter free
// key, so the FREE tail must be real OpenRouter `:free` slugs — NOT vendor-direct
// NIM/Cerebras ids that 404 there. Keep this in sync with the live API, not from
// memory (`LlmProxyService.codingPool.test` asserts every id is in the catalog).
export const CODING_MODEL_POOL: readonly string[] = [
  // PAID, CLOUDFLARE FIRST — every `@cf/*` coder is FREE up to the daily neuron
  // allowance (Cloudflare = PAID_LEAD_VENDOR), so a paid coding run spends that
  // free allowance BEFORE any metered coder. This is also why Anthropic is no
  // longer the lead: the metered coders (OpenRouter-routed Anthropic/OpenAI/etc.)
  // follow the free Cloudflare neurons. All `@cf/*` ids are verified function-
  // calling-capable against the live Cloudflare catalog (see cloudflare.ts).
  //
  // Ordered BIG-CONTEXT-FIRST, not just by quality: a coding context routinely
  // exceeds a small window, so a small-window model leading the pool 413s on the
  // first turn (the 97K-into-32K bug). glm-4.7-flash (128K) leads as the cost-
  // effective big-window coder; kimi (256K) handles the largest contexts; the 32K
  // qwen3-30b is LAST (a 413 there cascades up, see CASCADE_STATUSES).
  '@cf/zai-org/glm-4.7-flash',                 // 128K ctx, STANDARD — big-window coder (Cloudflare) — Pro coding default
  '@cf/moonshotai/kimi-k2.7-code',             // 256K ctx, PREMIUM — frontier code model for huge contexts (Cloudflare)
  '@cf/qwen/qwen3-30b-a3b-fp8',                // 32K ctx, STANDARD — small/fast; great first pass for SMALL tasks
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast',  // 24K ctx, STANDARD — small/fast; great first pass for SMALL tasks
  // PAID, METERED — strong agentic coders reachable by Pro tenants on the credited key.
  ...flagshipsOf('openrouter', 'agentic'),     // the OpenRouter catalog's flagship coder (Claude)
  'openai/gpt-4.1',
  'xiaomi/mimo-v2.5',                          // Programming #1 on OpenRouter, $0.14/$0.28
  'qwen/qwen3.7-plus',                         // agentic coder + vision, $0.40/$1.60
  'deepseek/deepseek-v4-flash',               // fast cheap coder, $0.10/$0.20
  // FREE — strong agentic coders on the OpenRouter free key (the cloud default).
  //
  // NO MiniMax ENTRY, deliberately. The lead used to be `minimaxai/minimax-m2.7` on
  // NVIDIA NIM, rolled back from M3 on 2026-08-17 because M3's NIM endpoint either
  // 404s or accepts a request and then hangs mid-stream — which the Canvas Brain
  // agentic loop cannot route around (it soft-pins whichever model answers the FIRST
  // tool call for the rest of the turn, so a stall on the pool leader exhausts both
  // retries with no proven fallback and kills the turn — see `creationCanvasAi.ts`'s
  // `switchToProvenModel`). NIM has since retired M2.7 entirely: its live `/models`
  // payload carries only M3. Bumping back to M3 would reinstate a model we already
  // measured as unreliable at the head of the free coding pool, so the entry is
  // dropped instead and the pool leads with the OpenRouter Nemotron 3 Ultra free
  // slug below — a live, tool-capable, 1M-context coder on the key the cloud gateway
  // already dispatches on. Reinstate a MiniMax id only with fresh evidence.
  // (`modelDrift.test.ts` is what caught the retirement; it fails the build for the
  // next one rather than letting a dead id sit at the head of the cascade.)
  'nvidia/nemotron-3-ultra-550b-a55b:free',   // free agentic-coding lead — Programming #6, 1M context
  'poolside/laguna-s-2.1:free',               // current flagship coding-agent model
  'cohere/north-mini-code:free',              // code-specialized, 256K context
  'nvidia/nemotron-3-super-120b-a12b:free',   // agentic reasoning fallback
  'google/gemma-4-26b-a4b-it:free',           // multimodal tools + structured output
  'nvidia/nemotron-3.5-lightning:free',       // compact tool-capable reliability tail
  // DIRECT-ANTHROPIC reliability floor (NVIDIA-of-last-resort). Served by the
  // `anthropic` vendor on the operator's CLAUDE_API_KEY — a vendor-diverse path
  // independent of OpenRouter. These are `autoRoute: false`, so they never enter a
  // plan pool or the user-facing picker (codingModelsForPlan excludes them); they
  // are listed here ONLY so the cloud loop recognises them as real coders (not a
  // "degraded onto a non-coder" backstop) and so the capability-reorder sets treat
  // them as tool/structured-output capable. Routing onto them happens via
  // CODING_PREMIUM_FALLBACK_MODELS, never auto-selection.
  ...ANTHROPIC_DIRECT_MODEL_IDS,
];

/**
 * Superseded model ids → the live successor the gateway dispatches instead.
 *
 * A pinned model id is DURABLE STATE: it is written onto an agent's `base_model`, a
 * workflow node config, a lane's coding default, and every execution row that ran on
 * it. Vendors ship a new frontier model every few months and eventually 404 the old
 * id — so without a rewrite layer, state pinned months ago starts failing, and the
 * failure surfaces far from its cause (an empty BYO flagship seed reading as "no
 * configured provider is currently usable", never "that model id is retired").
 *
 * DERIVED, never hand-edited: each vendor catalog entry lists the ids it replaces in
 * `supersedes` (see `VendorModelEntry.supersedes`), and this is their fold. A model
 * release is one catalog edit; every stored pin, seed constant, and strict dispatch
 * follows on the next request. Rules live on the field: within a vendor, across a
 * version, never across tiers. The old id stays in its vendor catalog while the vendor
 * still serves it — this map changes what we DISPATCH, the catalog what we RECOGNISE.
 */
export const SUPERSEDED_MODEL_IDS: Readonly<Record<string, string>> = catalogSupersessions();

/** Hard ceiling on {@link SUPERSEDED_MODEL_IDS} chain-following — a mis-edit that
 *  introduces a cycle (`a -> b -> a`) must degrade to "return what we have", never
 *  hang the request thread. */
const SUPERSESSION_MAX_HOPS = 8;

/**
 * Resolve a model id through {@link SUPERSEDED_MODEL_IDS} to the id the gateway
 * should actually dispatch. Returns the input unchanged for a live id, an unknown
 * id (the premium OpenRouter long tail is off our catalog by definition and must
 * pass through untouched), or a blank/non-string value.
 *
 * Apply this at every seam where a STORED or CALLER-SUPPLIED model id enters the
 * dispatch path — never to the curated pool constants, which are edited directly.
 * Pure + unit-testable.
 */
export function canonicalModelId(model: string | undefined | null): string {
  const id = typeof model === 'string' ? model.trim() : '';
  if (!id) return '';
  let current = id;
  for (let hop = 0; hop < SUPERSESSION_MAX_HOPS; hop += 1) {
    const next = SUPERSEDED_MODEL_IDS[current];
    if (!next || next === current) return current;
    current = next;
  }
  return current;
}

/**
 * Default driver for a cloud run that has no explicit model selection. The cloud
 * gateway (`ideProxy`) dispatches on the FREE key, so the default must be a model
 * that is actually reachable there — the highest-priority CODING_MODEL_POOL entry
 * that also lives in FREE_MODEL_POOL. Paid coding models stay available via an
 * explicit (strict-pinned) user/agent selection.
 */
export const CODING_DEFAULT_MODEL: string =
  CODING_MODEL_POOL.find((m) => FREE_MODEL_POOL.includes(m)) ?? FREE_MODEL_POOL[0] ?? '';

/**
 * The frontier flagship a single connected provider leads auto-select with — the
 * "premium" model the owner's OWN account serves. NOT a value judgement between
 * vendors: it just maps a connected vendor id → its best in-catalog frontier model,
 * on the DIRECT tenant-keyed route so a resolution is $0 → byo. Anthropic splits by
 * turn shape per the product decision (Opus drives agentic tool-loops, Sonnet drives
 * plain chat). Returns null for a vendor with no mapped flagship. Extend here (one
 * place) when a new BYO provider is added.
 *
 * The OpenAI flagship uses the `direct/<vendor>/` prefix on purpose: a bare
 * `openai/…` id belongs to OpenRouter's `<org>/<slug>` namespace (operator-keyed) —
 * `direct/openai/…` is the only route to the tenant's OWN OpenAI key. `googleai/` is
 * a bespoke prefix already bound to the tenant Google key.
 */
/**
 * The connected-account vendors whose frontier flagship leads auto-select — ONE model
 * per vendor and turn shape, declared on the vendor module itself (`flagships`; Anthropic
 * splits by shape: Opus drives agentic tool-loops, Sonnet plain chat). Every flagship is
 * a real, tool- and structured-output-capable CODER served on the tenant's OWN key (the
 * `direct/<vendor>/` and bespoke `googleai/` prefixes route to that key, NOT the operator
 * OpenRouter pool — a bare `openai/…` id is OpenRouter's namespace). OpenRouter is
 * deliberately absent: its flagship is the OPERATOR pool's coder, not a tenant's.
 *
 * This list names VENDORS, never models — a model release moves the vendor's `flagships`
 * and nothing here. It is the SINGLE SOURCE for both {@link providerFrontierFlagship} and
 * the coder-recognition superset {@link RECOGNIZED_CODER_MODELS}. That closes the drift that
 * mislabelled `direct/meta/muse-spark-1.1` (Meta MUSE, a coder) as a "degraded onto a
 * non-coder backstop" — only Anthropic's direct floor had been hand-added to CODING_MODEL_POOL.
 *
 * It is DERIVED from the BYO provider catalog ({@link BYO_VENDOR_IDS}: every vendor a
 * connected account can dispatch on, both auth modes) rather than hand-listed beside it —
 * the hand list had already needed `kimi-code` added after a Kimi-funded run reported as
 * degraded. A vendor with no declared `flagships` (the self-hosted `ollama-local` /
 * `freetoken`, Ollama Cloud) contributes nothing, because {@link vendorFlagship} answers
 * null for it; so connecting a new provider whose vendor declares flagships makes them
 * lead auto-select and count as coders with no edit here.
 */
const BYO_FLAGSHIP_VENDORS: readonly string[] = BYO_VENDOR_IDS;

export function providerFrontierFlagship(vendor: string, agentic: boolean): string | null {
  return BYO_FLAGSHIP_VENDORS.includes(vendor) ? vendorFlagship(vendor, agentic) : null;
}

/**
 * Every BYO frontier coder id (both turn shapes, de-duped) — the connected-account
 * flagships that route only on a tenant's own key and so are (correctly) ABSENT from the
 * auto-routable {@link CODING_MODEL_POOL}. Folded into {@link RECOGNIZED_CODER_MODELS}.
 */
export const BYO_FRONTIER_CODERS: readonly string[] = [
  ...new Set(BYO_FLAGSHIP_VENDORS.flatMap((vendor) => flagshipsOf(vendor, 'agentic', 'chat'))),
];

/**
 * The ONE set of models the runtime recognises as real CODERS (tool- + structured-
 * output-capable): the auto-routable {@link CODING_MODEL_POOL} PLUS the BYO frontier
 * flagships ({@link BYO_FRONTIER_CODERS}) that only route on a tenant's own key. The
 * degradation check (`isCodingModelDegraded`), the seed "is this a coder" trace, and the
 * tool/structured-output capability sets all derive from THIS — so a connected-account
 * coding run (e.g. `direct/meta/muse-spark-1.1`) is never mislabelled a non-coder
 * backstop. DISTINCT from CODING_MODEL_POOL, which stays the AUTO-ROUTE/selection pool
 * (plan ordering + `codingModelsForPlan` are unchanged; recognition simply widens).
 */
export const RECOGNIZED_CODER_MODELS: ReadonlySet<string> = new Set<string>([
  ...CODING_MODEL_POOL,
  ...BYO_FRONTIER_CODERS,
]);
