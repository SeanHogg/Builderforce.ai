/**
 * builderforceLLM — multi-vendor LLM proxy.
 *
 * Routes chat completions through the vendor registry (`./vendors/`) so the
 * Free pool and Pro pool can cascade across OpenRouter / Cerebras / Ollama
 * without changes to callers.
 *
 * Responsibilities of this service (vs the vendor modules):
 *   - Plan-aware key selection: Pro plan prefers OPENROUTER_API_KEY_PRO,
 *     Free plan uses OPENROUTER_API_KEY. The vendor module itself is
 *     plan-agnostic.
 *   - Per-(vendor,model) cooldowns after any provider error (60s).
 *   - Round-robin within a small "preferred" sub-pool so repeated calls
 *     spread across the top-N quality models.
 *   - Streaming with first-chunk error peek (delegated to the streaming
 *     transport in vendors/types.ts).
 *
 * Single entry point:
 *   - `complete(body)` — chat completion. Routing is shape-driven: presence of
 *     `tools`, `response_format`, image content blocks, etc., influences the
 *     candidate chain inside the pool. Callers do not pass routing intents.
 */

import {
  CascadeExhaustedError,
  catalogEntry,
  dispatchVendor,
  dispatchVendorStream,
  kindForStatus,
  autoRoutableModelsByTier,
  parseVendorPrefix,
  tierForModel,
  vendorForModel,
  vendorKeyBound,
  passthroughVendorKeys,
  MAX_VENDOR_CALL_TIMEOUT_MS,
  SCHEMA_TOO_COMPLEX_REASON,
  WorkerSubrequestExhaustedError,
  RequestAbortedError,
  VendorFatalError,
  type AiCapability,
  type DispatchAttempt,
  type VendorEnv,
  type VendorId,
} from './vendors';
import { composeFreeCappedCascade, buildCooldownPredicate } from './cascadeComposer';
import { sanitizeRequestToolCalls, restoreResponseToolNames, restoreStreamToolNames } from './toolNameSanitizer';
import {
  loadCooldownExpiries,
  loadCooldowns,
  loadCooledVendors,
  loadCooledVendorExpiries,
  recordFailure,
} from '../../infrastructure/auth/cooldownStore';
import { validateJsonSchema } from './jsonSchemaValidator';
import { estimateTokensFromChars } from './tokenUsage';
import type { ActionType } from './actionTypes';
import { PROVIDER_VENDOR_MAP, type TenantVendorKeys } from './tenantProviderKeyService';

// ---------------------------------------------------------------------------
// Pool composition (derived from vendor catalogs — single source of truth)
//
// Multi-vendor by construction. `modelsByTier` walks every registered vendor
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
  'anthropic/claude-sonnet-4.6',
  'openai/gpt-4.1',
  'xiaomi/mimo-v2.5',                          // Programming #1 on OpenRouter, $0.14/$0.28
  'qwen/qwen3.7-plus',                         // agentic coder + vision, $0.40/$1.60
  'deepseek/deepseek-v4-flash',               // fast cheap coder, $0.10/$0.20
  // FREE — strong agentic coders on the OpenRouter free key (the cloud default).
  // Standardized lead: MiniMax M2.7 is the top free SWE-bench agentic coder, so it
  // sits first here and becomes CODING_DEFAULT_MODEL (the first FREE pool entry).
  // Sourced from NVIDIA NIM (`minimaxai/minimax-m2.7`), where M2.7 is FREE — on
  // OpenRouter it's a PAID slug, so NIM is the only free home. This needs
  // NVIDIA_API_KEY bound on the gateway; if it's unbound the NIM default no-key-
  // skips at dispatch and the run fails over to the OpenRouter `:free` tail below,
  // so M2.5:free sits immediately after as the always-reachable failover.
  'minimaxai/minimax-m2.7',                   // SWE-bench-leading free coder (NVIDIA NIM) — standardized default
  'minimax/minimax-m2.5:free',                // prior-gen MiniMax (OpenRouter free) — always-reachable failover
  'z-ai/glm-5.1',                             // strong agentic coder (NVIDIA NIM, free)
  'nex-agi/nex-n2-pro:free',                  // agentic MoE (Qwen3.5 arch), tool use
  'nvidia/nemotron-3-ultra-550b-a55b:free',   // Programming #6, 1M context
  'openrouter/owl-alpha',                     // agentic, Claude Code-compatible
  'poolside/laguna-m.1:free',                 // flagship coding-agent model
  'qwen/qwen3-coder:free',
  'qwen/qwen3-next-80b-a3b-instruct:free',
  // DIRECT-ANTHROPIC reliability floor (NVIDIA-of-last-resort). Served by the
  // `anthropic` vendor on the operator's CLAUDE_API_KEY — a vendor-diverse path
  // independent of OpenRouter. These are `autoRoute: false`, so they never enter a
  // plan pool or the user-facing picker (codingModelsForPlan excludes them); they
  // are listed here ONLY so the cloud loop recognises them as real coders (not a
  // "degraded onto a non-coder" backstop) and so the capability-reorder sets treat
  // them as tool/structured-output capable. Routing onto them happens via
  // CODING_PREMIUM_FALLBACK_MODELS, never auto-selection.
  'claude-sonnet-4-6',
  'claude-opus-4-8',
];

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
function providerFrontierFlagship(vendor: string, agentic: boolean): string | null {
  switch (vendor) {
    case 'anthropic': return agentic ? 'claude-opus-4-8' : 'claude-sonnet-4-6';
    case 'openai':    return 'direct/openai/gpt-4.1';
    case 'googleai':  return 'googleai/gemini-2.5-pro';
    default:          return null;
  }
}

/** Best-first rank of a model's catalog tier (ULTRA → PREMIUM → STANDARD → FREE),
 *  used to order the connected providers' flagships by frontier strength from catalog
 *  DATA rather than a hardcoded vendor hierarchy. Unknown tier sorts last. */
function frontierTierRank(model: string): number {
  const order: Record<string, number> = { ULTRA: 0, PREMIUM: 1, STANDARD: 2, FREE: 3 };
  return order[tierForModel(model)] ?? 4;
}

/**
 * The connected owner's OWN premium frontier models to lead auto-select with — ONE
 * flagship per connected provider, so an auto-select turn (no explicit model) uses the
 * owner's account(s) before the free/paid gateway tiers (the "connect your account →
 * it gets used" guarantee the settings/api-keys UI implies).
 *
 * Purely REGISTRATION-DRIVEN and multi-provider: it reflects exactly what the tenant
 * connected — connect only OpenAI → GPT leads; connect all three → all three frontier
 * flagships lead, ordered by catalog TIER (ULTRA → PREMIUM → STANDARD) so the
 * strongest frontier model is tried first and the cascade then fails over across the
 * owner's OTHER connected accounts before ever touching a free/paid pool model. There
 * is NO hardcoded vendor preference — a tie in tier keeps the vendor set's iteration
 * order. It is a SOFT seed: the plan pool stays behind the list as fallback.
 *
 * `byoVendors` is the gateway VENDOR-id set the tenant can serve from their own
 * account (see `byoVendorIdSet` / the proxy's connected set). Returns `[]` when
 * nothing is connected — plan routing is then unchanged. Single source both the
 * gateway completion seed ({@link LlmProxyService.complete}) and the cloud-agent pin
 * ({@link pickCloudModel}, which leads with `[0]`) use, so the surfaces never diverge.
 * Every id is a real catalog entry on its direct vendor (`byo` → $0), asserted in
 * `LlmProxyService.codingPool.test`.
 */
export function byoAutoSeedModels(
  byoVendors: ReadonlySet<string> | null | undefined,
  opts: { agentic: boolean },
): string[] {
  if (!byoVendors || byoVendors.size === 0) return [];
  const flagships = [...byoVendors]
    .map((v) => providerFrontierFlagship(v, opts.agentic))
    .filter((m): m is string => m !== null && isDispatchableSeed(m));
  // Stable sort by frontier tier (strongest first); Array.prototype.sort is stable in
  // V8, so same-tier flagships keep the connected-set order (no vendor value judgement).
  return flagships.sort((a, b) => frontierTierRank(a) - frontierTierRank(b));
}

/**
 * Does an explicit model choice preempt the tenant's connected-BYO auto-seed?
 *
 * Connecting your own frontier account is a strong "use MY account" signal, so it
 * leads auto-select UNLESS the explicit model is a deliberate choice ON that account.
 * Returns true (honor the explicit model) when:
 *   • the tenant connected nothing (`byoVendors` empty) — normal plan routing, OR
 *   • the explicit model is itself served by a connected BYO vendor (a deliberate pick
 *     on the owner's own account — e.g. they connected Claude AND pinned claude-opus).
 * Returns false (let the connected flagship lead) for a NON-BYO explicit model while an
 * account is connected — e.g. a default agent base model of `@cf/qwen` must NOT shadow
 * a connected Claude subscription (the exact bug where Ada ran on `@cf/qwen` despite a
 * live subscription). This is the SINGLE branching rule the gateway cloud pin
 * ({@link pickCloudModel}) and the Brain addressed-reply path share, so "the connected
 * account wins over a non-BYO pin" can never drift between the two surfaces again.
 */
export function explicitModelPreemptsByo(
  explicit: string | undefined | null,
  byoVendors: ReadonlySet<string> | null | undefined,
): boolean {
  const trimmed = typeof explicit === 'string' ? explicit.trim() : '';
  if (!trimmed) return false;
  if (!byoVendors || byoVendors.size === 0) return true;
  return byoVendors.has(vendorForModel(trimmed));
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

/**
 * Canonical strict-pin resolver — the single source of truth for "did this
 * request ask to hard-pin its model?" Both the request body (`modelStrict`
 * — the gateway-internal flag cloud coding agents set, OR `strict` — the
 * public SDK alias) and an optional `?strict=true` query param feed in here.
 *
 * Strict pin only applies when a non-empty `model` is also present; without a
 * named model there's nothing to pin, so it's a no-op (the gateway routes
 * by shape as usual). Callers normalize via this helper so the entitlement
 * gate, `complete()`'s dispatch branch, and the trace logger never diverge on
 * what counts as strict.
 */
export function resolveStrictPin(
  body: { model?: unknown; modelStrict?: unknown; strict?: unknown },
  queryStrict?: boolean,
): boolean {
  const hasModel = typeof body.model === 'string' && body.model.length > 0;
  if (!hasModel) return false;
  return body.modelStrict === true || body.strict === true || queryStrict === true;
}

/**
 * Per-request inner-timeout override — lets a NON-premium tenant opt a single
 * long call into the extended vendor budget without flipping plans or premium
 * routing. Carried as `body._builderforce.vendorTimeoutMs` (the gateway-internal
 * passthrough envelope, stripped before vendor dispatch).
 *
 * Returns the requested value clamped to `(0, MAX_VENDOR_CALL_TIMEOUT_MS]`, or
 * `undefined` when absent / non-positive / non-numeric — in which case the
 * caller falls back to the proxy's configured `vendorCallTimeoutMs` (plan
 * default). The clamp keeps a one-off override from holding a Worker isolate
 * open longer than the premium path's own ceiling.
 */
export function resolveVendorTimeoutOverride(
  body: Record<string, unknown>,
): number | undefined {
  const envelope = body['_builderforce'];
  if (!envelope || typeof envelope !== 'object') return undefined;
  const raw = (envelope as Record<string, unknown>).vendorTimeoutMs;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.min(Math.floor(n), MAX_VENDOR_CALL_TIMEOUT_MS);
}

/**
 * Per-request prompt-cache retention opt-in — lets a bursty tenant with a large
 * stable prefix keep it warm across idle gaps longer than the 5-minute ephemeral
 * default. Carried as `body._builderforce.cacheTtl` ('1h'); any other value
 * (including absent) resolves to the 5-minute default. Honoured only for
 * caching-capable (Anthropic-family) models by the OpenRouter vendor module —
 * see promptCaching.ts. Returns `'1h'` or `undefined` (= default 5m).
 */
export function resolveCacheTtl(body: Record<string, unknown>): '1h' | undefined {
  const envelope = body['_builderforce'];
  if (!envelope || typeof envelope !== 'object') return undefined;
  return (envelope as Record<string, unknown>).cacheTtl === '1h' ? '1h' : undefined;
}

/**
 * Premium routing pool — top PREMIUM-tier models only, used when a tenant has
 * `premium_override` set. Skips FREE and STANDARD entirely so a single attempt
 * lands on a high-quality model. Three candidates so the cascade has fallback
 * room within the extended outer budget (180s SDK / 60s per-vendor).
 *
 * Derived from `modelsByTier('PREMIUM')` so adding a new PREMIUM model to any
 * vendor catalog automatically extends the candidate list — and the first three
 * in registry order become the active premium cascade.
 */
const PREMIUM_PRIORITY_COUNT = 3;
export const PREMIUM_PRIORITY_POOL: readonly string[] =
  autoRoutableModelsByTier('PREMIUM').slice(0, PREMIUM_PRIORITY_COUNT);

/**
 * Per-vendor-call timeout for premium routing. PREMIUM-tier models on long-
 * context inputs (resume tailoring, structured job extraction) routinely take
 * 30-50s end-to-end; the default 25s budget kills these prematurely. Paired
 * with the extended SDK outer budget so all three premium candidates can be
 * tried within one request.
 */
export const PREMIUM_VENDOR_CALL_TIMEOUT_MS = 60_000;

/**
 * Per-vendor-call timeout for the FREE plan. Free-tier upstreams that haven't
 * started streaming within ~15s are, empirically, going to burn the full 25s
 * default and time out anyway (see the all-`408` free attempts in trace
 * `llm-71b468dd-...`, 2026-06-07). Shrinking the per-attempt budget lets a
 * saturated free pool fail fast so the request reaches the guaranteed paid
 * backstop within the caller's deadline instead of spending 2×25s up front.
 * Paid/premium routing keeps the longer budget — those calls are worth waiting
 * for. The backstop itself overrides this with `PREMIUM_VENDOR_CALL_TIMEOUT_MS`.
 */
export const FREE_VENDOR_CALL_TIMEOUT_MS = 15_000;

/**
 * Guaranteed paid backstop — a single low-cost, low-variance paid model
 * dispatched on the *credited* (Pro) OpenRouter key after the primary cascade
 * fails (or every candidate is on cooldown), regardless of the request's plan.
 *
 * Why this exists separately from `PREMIUM_FALLBACK_MODELS`: that chain runs on
 * whatever key the plan resolves to. On the FREE plan that's the free
 * OpenRouter key, which may lack the credit to actually pay for the paid Gemini
 * entry — so the only "safety net" 402s and the request hard-fails (the
 * `AI_UNAVAILABLE` symptom on hired.video's tailor endpoint). The backstop
 * closes that hole: Builderforce funds this one cheap call (~$0.0001) as the
 * reliability floor so a saturated free pool never surfaces a hard failure.
 */
export const GUARANTEED_BACKSTOP_MODEL = 'google/gemini-2.5-flash-lite';

/**
 * Cheapest reliable paid coder — the head of the coding reliability floor and the
 * ONLY coding model treated as paid-overflow by id (see `PAID_OVERFLOW_MODELS`).
 * A `CODING_MODEL_POOL` member reachable on the credited OpenRouter key.
 */
export const CHEAPEST_PAID_CODER = 'deepseek/deepseek-v4-flash'; // $0.10/$0.20

/**
 * Coding-capable premium fallback chain — the coding analogue of
 * `PREMIUM_FALLBACK_MODELS`. A coding run must NEVER fall through to a general
 * non-coder (the gemini-flash family loops on search and ships no edits — see
 * execution #59), so when the curated coding pool is exhausted the cascade
 * escalates to *paid coders* on the credited key instead of the non-coder gemini
 * chain. Vendor-diverse (Cloudflare / DeepSeek / Xiaomi / Anthropic) so one
 * upstream outage doesn't sink the floor. Every id is a paid `CODING_MODEL_POOL`
 * member, so `LlmProxyService.codingPool.test` trips if a rename drifts it off
 * catalog.
 *
 * `leadPoolWithVendor(…, PAID_LEAD_VENDOR)` floats the Cloudflare coder to the
 * head: its first ~10K neurons/day are free, so an exhausted coding cascade spends
 * that allowance before any metered coder. The remaining entries stay cheapest-
 * reliable-first (DeepSeek → Xiaomi → OpenRouter-routed Claude), then the
 * DIRECT-ANTHROPIC last-resort floor: the OpenRouter-routed coders all share
 * OpenRouter's availability, so an OpenRouter-wide outage sinks them together —
 * `claude-sonnet-4-6` / `claude-opus-4-8` call Claude DIRECTLY on CLAUDE_API_KEY
 * (independent availability), Sonnet first (cheaper). Any vendor whose key is
 * unbound no-key-skips at dispatch, so the chain degrades cleanly to whatever is
 * reachable and surfaces an honest exhaustion only if nothing is.
 */
export const CODING_PREMIUM_FALLBACK_MODELS: readonly string[] = leadPoolWithVendor([
  CHEAPEST_PAID_CODER,           // $0.10/$0.20 — cheapest reliable paid coder (OpenRouter)
  'xiaomi/mimo-v2.5',            // $0.14/$0.28 — OpenRouter Programming #1
  // Cloudflare Workers AI coders — FREE up to the daily neuron allowance; `leadPoolWithVendor`
  // floats all of these to the head so the free neurons are spent before any metered coder.
  // Ordered FAST-FIRST behind a big-window lead: glm-4.7-flash (128K) leads — it fits the
  // cloud loop's compacted (~15-20K) contexts and is the cost-effective big-window coder;
  // the small/fast qwen (32K) + llama (24K) are the quick failovers (a fast 413 there just
  // cascades). The 256K kimi is LAST among the CF coders: it is the slowest by far — a
  // single completion ran 93s and got a live durable tick orphan-reaped (execution #136) —
  // so it is reached only when a genuinely huge (>128K) context needs it, never auto-picked
  // ahead of a faster coder for a normal turn.
  '@cf/zai-org/glm-4.7-flash',                 // 128K ctx — big-window lead
  '@cf/qwen/qwen3-30b-a3b-fp8',                // 32K ctx — small/fast failover
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast',  // 24K ctx — small/fast failover
  '@cf/moonshotai/kimi-k2.7-code',             // 256K ctx — slowest; huge-context last resort
  'anthropic/claude-sonnet-4.6', // strongest agentic coder (via OpenRouter)
  'claude-sonnet-4-6',           // direct-Anthropic last-resort floor (CLAUDE_API_KEY)
  'claude-opus-4-8',
], PAID_LEAD_VENDOR);

/**
 * Coding-capable backstop chain — the reliability floor for a *coding* run,
 * dispatched on the credited key after the primary coding cascade fails.
 *
 * `GUARANTEED_BACKSTOP_MODEL` (gemini-2.5-flash-lite) is a cheap general model
 * chosen for low variance, NOT for code. Flooring a coding run onto a non-coder
 * means the run flails and gives up without writing code (observed in execution
 * #59), so the coding floor is *coders only* — no general backstop tail. If every
 * paid coder is also down the run surfaces `cascade_exhausted` rather than
 * silently degrading onto a non-coder, because an honest failure beats a coding
 * agent that loops on search and ships nothing.
 */
export const CODING_BACKSTOP_MODELS: readonly string[] = CODING_PREMIUM_FALLBACK_MODELS;

/**
 * Premium fallback chain — appended to *every* non-strict candidate chain so a
 * fully-saturated free pool never surfaces an `LLM_UNAVAILABLE` / cascade-
 * exhausted 429 to the caller. Direct Google AI (`googleai/*`) is tried first
 * because it has the lowest variance and isn't subject to OpenRouter's shared
 * rate limits; the OpenRouter Gemini entry is the vendor-diverse backup so a
 * Google AI outage still resolves through a different upstream.
 *
 * Each entry is skipped at chain-build time when its vendor key is unbound or
 * the model is on cooldown.
 */
export const PREMIUM_FALLBACK_MODELS: readonly string[] = [
  'googleai/gemini-2.5-flash',
  'googleai/gemini-2.5-flash-lite',
  'google/gemini-2.5-flash-lite', // via OpenRouter — vendor-diverse backup
];

/**
 * Paid-overflow model set — the models Builderforce funds on its OWN keys when a
 * tenant's primary cascade is exhausted: the premium fallback chain, the general
 * reliability backstop, and the cheap coding floor (`CHEAPEST_PAID_CODER`). A
 * usage row resolved to one of these is "overflow spend" — metered against a
 * per-tenant daily $ cap so a Free tenant in a tight retry loop can't run up
 * arbitrary spend on our keys (the cap is enforced in the gateway route; see
 * `paid_overflow_daily_cap`).
 *
 * By-id detection is deliberately conservative here: the *stronger* coding-floor
 * coders (`xiaomi/mimo-v2.5`, `anthropic/claude-sonnet-4.6`) are Pro plan-pool
 * models, so flagging them by id would mis-meter a Pro tenant's legitimate plan
 * usage as overflow. Their genuine overflow case — resolving via the funded
 * coding *backstop* — is metered directly by `complete()` (which sets
 * `paidOverflow = true` on any backstop hit), not by this set. Every id that IS
 * in this set resolves only via the funded path (the gemini fallbacks live in no
 * plan pool; `CHEAPEST_PAID_CODER` is the historically-funded coding floor).
 */
export const PAID_OVERFLOW_MODELS: ReadonlySet<string> = new Set<string>([
  ...PREMIUM_FALLBACK_MODELS,
  CHEAPEST_PAID_CODER,
  GUARANTEED_BACKSTOP_MODEL,
  // Direct-Anthropic floor — unlike `anthropic/claude-sonnet-4.6` (a Pro plan-pool
  // model whose normal use must NOT be metered as overflow), these bare-id direct
  // models live in NO plan pool: any resolution onto them is Builderforce funding a
  // call on its own CLAUDE_API_KEY, so they are overflow spend by id on every path
  // (primary appended-fallback OR credited backstop) and count against the cap.
  'claude-sonnet-4-6',
  'claude-opus-4-8',
]);

/** True when `model` resolved via the funded overflow path (premium fallback or
 *  a reliability-floor backstop) — i.e. Builderforce paid for it, not the tenant
 *  via their plan pool. Drives the `paid_overflow` usage flag + per-tenant cap. */
export function isPaidOverflowModel(model: string | undefined | null): boolean {
  return model != null && PAID_OVERFLOW_MODELS.has(model);
}

/**
 * Maximum number of FREE-tier attempts the cascade walks before falling through
 * to the premium fallback chain. Caps "we cycled 20 free models and still
 * 429'd" failure modes: every request now ends with at most 2 free attempts +
 * the premium fallback list, so callers reliably get a successful response
 * even when the free pool is saturated.
 *
 * Non-FREE models in the seed (Pro/Teams paid models, premium-priority routing)
 * are not affected by this cap — they're kept verbatim in the chain so paying
 * tenants still get the models their plan unlocks.
 */
export const FREE_ATTEMPT_BUDGET = 2;

/**
 * Pro/Teams free-tier breadth: paying tenants try MORE free models before the
 * cascade escalates to their paid premium pool. The 2-attempt cap above is
 * tuned for latency-sensitive Free-plan traffic (reach the guaranteed paid
 * backstop fast); a Pro tenant who is *already paying* benefits more from extra
 * free-tier coverage (a wider shot at a $0 model) than from a few hundred ms of
 * latency. Still bounded so the cascade can't walk the whole 40-model free pool.
 */
export const PRO_FREE_ATTEMPT_BUDGET = 5;

/**
 * Plan-aware general FREE-attempt budget (NON-coding). Free → the latency-tuned
 * 2; Pro/Teams → the wider {@link PRO_FREE_ATTEMPT_BUDGET}. Single source so the
 * proxy factory doesn't hardcode the constant — closes the "Pro plan's free-tier
 * section is also capped at 2 attempts, no Pro-specific carve-out" gap.
 *
 * Coding runs are unaffected: they pass `CODING_FREE_ATTEMPT_BUDGET` (the whole
 * free coding pool) explicitly and never consult this.
 */
export function freeAttemptBudgetForPlan(effectivePlan: EffectivePlan): number {
  return effectivePlan === 'free' ? FREE_ATTEMPT_BUDGET : PRO_FREE_ATTEMPT_BUDGET;
}

/**
 * FREE-attempt budget for a CODING run — deliberately the WHOLE free coding pool,
 * not the 2-attempt general cap.
 *
 * A coding run is a long-lived background job (container / durable loop, ~180s
 * outer budget), so unlike an interactive request it values COST over a few
 * seconds of latency. The general 2-attempt cap escalates to PAID coders — and
 * ultimately the funded direct-Anthropic floor on a METERED key — after only two
 * free coders, which is how a $10 Anthropic cap got drained while ~9 free coders
 * (minimax / glm / nemotron / qwen-coder / …) sat untried. Budgeting the entire
 * free coding pool means every free coder is attempted BEFORE any paid coder, so
 * the metered floor is genuinely last-resort (10+ models tried first), not a
 * second-attempt default.
 *
 * Derived from the pool so it tracks automatically as free coders are added.
 */
export const CODING_FREE_ATTEMPT_BUDGET: number =
  CODING_MODEL_POOL.filter((m) => FREE_MODEL_POOL.includes(m)).length;

/** First N models of the active pool form the round-robin "preferred" group.
 *  Aligned with FREE_ATTEMPT_BUDGET so the round-robin window matches the cap. */
export const PREFERRED_POOL_SIZE = 2;

/**
 * Hard cap on how many seed models get a cooldown KV read up-front.
 *
 * The model pool can contain 40+ FREE entries across all vendors. Without this
 * cap, every `complete()` call issued one KV `get` per pool entry just to
 * prefetch cooldown state — ~50 subrequests *before* the first vendor fetch.
 * Cloudflare's per-invocation subrequest cap (50 free / 1000 paid) was being
 * exhausted by the bookkeeping path alone (production trace
 * `llm-2cc6ba1b-...`, 2026-05-26: cooldown reads + 6 vendor attempts =
 * cascade collapse with `Too many subrequests by single Worker invocation`).
 *
 * Why 12: `FREE_ATTEMPT_BUDGET` (=2) + `PREMIUM_FALLBACK_MODELS.length` (3) +
 * caller-pinned hint (1) is the minimum the chain composer can use; 12 leaves
 * headroom for ~6 cooled-and-skipped FREE entries before the composer's
 * walking-the-pool-looking-for-non-cooled loop runs dry — which is far more
 * skips than we've ever observed simultaneously, since cooldowns expire on
 * 5–30 minute windows. The shape-reorder + caller-hint prefix ensures the
 * 12 entries actually queried are the most likely to be tried.
 *
 * Trade-off: a model past index 12 that *is* cooled won't be filtered out of
 * the chain composer's view, so it could be attempted at dispatch time and
 * fail. The dispatcher records the failure and re-cools the model — the next
 * request sees the cooldown if the same model lands in the leading 12. Net
 * effect: a one-request lag on a stale cooldown, in exchange for a hard
 * upper bound on KV subrequests per gateway call.
 */
export const COOLDOWN_PREFETCH_LIMIT = 12;

// ---------------------------------------------------------------------------
// Public types — kept stable for callers (llmRoutes, ideAiRoutes)
// ---------------------------------------------------------------------------

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
}

export interface ChatCompletionRequest {
  /** Preferred model. By default a soft hint: seeded at the head of the cascade,
   *  but the chain may fall through to other pool models on failure. Set
   *  `modelStrict: true` to enforce it as a hard single-model pin (no failover). */
  model?: string;
  /** When true (and `model` is set), dispatch ONLY `model` — no cascade, no
   *  failover. Used by cloud coding agents to honour an explicit user/agent model
   *  selection for the whole run instead of silently swapping models per turn.
   *  `strict` (below) is the public SDK alias for the same behaviour. */
  modelStrict?: boolean;
  /** Public SDK alias for `modelStrict`. Eval / reproducibility callers set
   *  `strict: true` (or pass `?strict=true`) so the gateway pins the named
   *  `model` with NO substitution — an unavailable model 503s rather than
   *  silently swapping. Normalized onto `modelStrict` by `resolveStrictPin`. */
  strict?: boolean;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stream?: boolean;
  /** Any extra passthrough params for the vendor. */
  [key: string]: unknown;
}

export interface LlmUsage {
  promptTokens:     number;
  completionTokens: number;
  totalTokens:      number;
  /** Prompt-cache breakdown (subset of promptTokens). Present only for caching
   *  upstreams. Persisted so cost accounting can discount cache reads (~0.1x). */
  cacheReadTokens?:     number;
  cacheCreationTokens?: number;
}

/** One model attempt that failed before the resolved model succeeded. */
export interface FailoverEvent {
  model: string;
  /** Vendor that owns this model — lets callers see if failures concentrate
   *  on one upstream (e.g. all OpenRouter free-tier saturated) vs are
   *  distributed across vendors. */
  vendor: VendorId;
  /** HTTP status, or 0 for embedded errors / network failures. */
  code: number;
  /** Wall-clock time spent on this attempt, ms (diagnostic tracing). */
  durationMs?: number;
  /** Coarse failure class — rate_limit | timeout | auth | server_error |
   *  schema | network | skipped (diagnostic tracing). */
  kind?: string;
  /** Stable machine-readable cause slug when one applies (e.g. `schema_too_complex`).
   *  Lets consumers branch on structured data instead of regex-sniffing the message. */
  reason?: string;
  /** The REAL upstream HTTP status before the gateway normalized it into its own
   *  failure class (e.g. a Gemini schema 400 normalized to the 422 request-error
   *  class records `upstreamStatus: 400`). Absent when `code` IS the upstream status. */
  upstreamStatus?: number;
  /** Human-readable failure detail (the vendor error message / thrown `Error.message`,
   *  truncated). Critical for the `code: 0` case, where the status alone ("no response")
   *  hides WHY the vendor `fetch()` threw — e.g. `network: <cause>` or a rejected body.
   *  Surfaced in diagnostics so a connected-account failure names its own cause. */
  detail?: string;
}

export interface ProxyResult {
  /** Final upstream Response (may be streamed). */
  response: Response;
  /** Which model actually served the request. */
  resolvedModel: string;
  /** Vendor that owns `resolvedModel` — sourced from the catalog. Always set
   *  (every successful or failed response has *some* model the cascade landed
   *  on); routes echo it back to consumers as `_builderforce.resolvedVendor`
   *  and on errors as the top-level `vendor` field. */
  resolvedVendor: VendorId;
  /** How many failovers happened before success. */
  retries: number;
  failovers: FailoverEvent[];
  /** Token usage from non-streaming responses; undefined for streams (route intercepts). */
  usage?: LlmUsage;
  /** True when the request resolved via the funded overflow path (premium
   *  fallback / backstop on Builderforce's own key) rather than a plan-pool
   *  model. The route stamps this onto the usage row so overflow spend can be
   *  capped per tenant. See {@link isPaidOverflowModel}. */
  paidOverflow?: boolean;
  /** True when the tenant's OWN provider credential (a connected subscription or
   *  a BYO vendor key) served this call — so the platform pays nothing. The route
   *  stamps it onto the usage row as `byo`, which forces cost 0 and (for on-prem /
   *  VSIX surfaces) exempts the row from the plan token allowance. Stamped by
   *  finalize() via {@link isTenantFunded}. */
  byoFunded?: boolean;
  /** Number of times the gateway re-dispatched on non-conforming JSON output
   *  (only applies when `body.response_format.type` is `json_object`/`json_schema`). */
  schemaRetries?: number;
  /** True when the gateway AUTO-DOWNGRADED a too-complex `response_format.json_schema`
   *  to loose `json_object` and re-ran the cascade so the caller still got a
   *  structured result instead of a terminal `schema_too_complex`. The strict
   *  schema guarantee was relaxed — the caller should validate the JSON itself. */
  schemaDowngraded?: boolean;
  // --- Diagnostic tracing (stamped by complete() via finalize) -------------
  /** Authoritative gateway trace id (`llm-<uuid>`) echoed to the consumer and
   *  used by the superadmin trace lookup. */
  traceId?: string;
  /** Total gateway wall-clock time for this call, ms. */
  durationMs?: number;
  /** Final HTTP status returned to the caller (mirrors `response.status`). */
  status?: number;
  /** The model chain the gateway actually walked for this request. */
  candidateChain?: string[];
  /** success | cascade_exhausted | all_cooldown | subrequest_exhausted |
   *  strict_unavailable | schema_nonconforming | request_error |
   *  schema_too_complex (every candidate rejected the json_schema as too complex). */
  outcome?: string;
  /** Rolled-up failure class across attempts — rate_limit | timeout | auth |
   *  server_error | mixed | none. */
  classification?: string;
  /** Raw per-attempt diagnostics (model, vendor, status, error text, durationMs,
   *  kind). Server-side ONLY — written to the superadmin trace, NEVER serialized
   *  back to the caller (the per-attempt error text can contain raw upstream
   *  provider payloads). */
  attempts?: DispatchAttempt[];
}

/** Assistant message shape carried in a chat-completion choice. */
export interface ProxyChoiceMessage {
  role?: string;
  content?: string | null;
  tool_calls?: Array<{ id: string; type?: string; function: { name: string; arguments?: string } }>;
}

/** The unwrapped first choice of a {@link ProxyResult}. */
export interface ProxyChoice {
  /** The raw assistant message (undefined on a non-JSON / error body). */
  message: ProxyChoiceMessage | undefined;
  /** Trimmed assistant text — `''` when the turn was tool-only, genuinely empty, or the
   *  body was a non-2xx/non-JSON envelope. */
  content: string;
  /** Tool calls the model requested (empty array when none). */
  toolCalls: NonNullable<ProxyChoiceMessage['tool_calls']>;
  /** OpenAI `finish_reason` (`stop` | `tool_calls` | `length` | …), `''` when absent. */
  finishReason: string;
  /** Full parsed OpenAI-shaped body, for callers that also need `usage`/`error`/etc. */
  body: Record<string, unknown> | null;
}

/**
 * THE single place a {@link ProxyResult}'s HTTP Response body is unwrapped into its first
 * chat choice. `ProxyResult.response` is an HTTP `Response` (a JSON body), NOT the parsed
 * object — every consumer MUST `await` its `.json()`. Reading `.choices` straight off the
 * Response (as several call sites historically did) silently yields `undefined` and
 * empties EVERY reply regardless of what the model returned. Centralising the unwrap here
 * kills that whole class of bug and the extraction duplication that let it hide in one
 * surface while working in others.
 *
 * The Response is CLONED, so callers may still read `result.response` (`.status` / `.ok`)
 * and background metering may re-read the original body. A non-2xx or non-JSON body yields
 * empty fields (never throws), so a caller can gate on `result.response.status` first and
 * treat `content === ''` as "no usable output".
 */
export async function readProxyChoice(result: { response: Response }): Promise<ProxyChoice> {
  const body = (await result.response.clone().json().catch(() => null)) as
    | { choices?: Array<{ message?: ProxyChoiceMessage; finish_reason?: string }> }
    | null;
  const choice = body?.choices?.[0];
  const message = choice?.message;
  return {
    message,
    content: (typeof message?.content === 'string' ? message.content : '').trim(),
    toolCalls: message?.tool_calls ?? [],
    finishReason: choice?.finish_reason ?? '',
    body: body as Record<string, unknown> | null,
  };
}

export type ProductName = 'builderforceLLM' | 'builderforceLLMPro' | 'builderforceLLMTeams';

export interface ProxyEnv extends VendorEnv {
  /** Pro-tier OpenRouter key. Used in place of OPENROUTER_API_KEY when the
   *  proxy was constructed with a Pro/Teams productName. */
  OPENROUTER_API_KEY_PRO?: string | null;
  /** Optional KV namespace for persistent cooldown + key-resolution caching.
   *  When unset, both fall back to in-memory per-isolate state. */
  AUTH_CACHE_KV?: KVNamespace;
  /** R2 bucket holding published `.evermind` model artifacts. Threaded into the
   *  vendor dispatch so the `evermind` vendor can load + run a tenant's own model.
   *  Absent in environments without R2 (the evermind vendor then errors cleanly). */
  UPLOADS?: R2Bucket;
}

// ---------------------------------------------------------------------------
// Cooldown tracking lives in `infrastructure/auth/cooldownStore.ts` — KV-backed
// when the namespace is bound, in-memory fallback otherwise. See that module
// for the classification → TTL table.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Round-robin cursor (per-isolate)
// ---------------------------------------------------------------------------

/** Round-robin cursor (per-isolate). Boxed in an object so it can be shared
 *  by reference with `composeFreeCappedCascade` — the helper increments it
 *  in place, so chat and image cascades both contribute to the same rotation
 *  on a single Worker isolate (no contention, just a counter). */
const chatRequestCursor: { value: number } = { value: 0 };

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface LlmProxyOptions {
  modelPool?: readonly string[];
  preferredPoolSize?: number;
  productName?: ProductName;
  /** Per-vendor-call deadline. Defaults to `DEFAULT_VENDOR_CALL_TIMEOUT_MS`
   *  in the vendor transport. The premium routing path sets this to
   *  `PREMIUM_VENDOR_CALL_TIMEOUT_MS` so PREMIUM-tier long-context calls
   *  aren't killed by the free-tier 25s budget. */
  vendorCallTimeoutMs?: number;
  /** Reliability-floor chain dispatched (on the credited key) after the primary
   *  cascade fails. Defaults to `[GUARANTEED_BACKSTOP_MODEL]`. Coding runtimes
   *  pass `CODING_BACKSTOP_MODELS` so an exhausted coding cascade floors onto a
   *  coder, not the general-purpose backstop. Tried in order. */
  backstopModels?: readonly string[];
  /** When true, the cascade drops the premium fallback chain AND skips the paid
   *  backstop — so an exhausted primary pool surfaces `cascade_exhausted` instead
   *  of falling through to a model Builderforce funds on its own key. Set by the
   *  gateway route once a tenant has exceeded its daily paid-overflow $ cap, to
   *  put a hard ceiling on overflow spend (a Free tenant's primary free pool
   *  still runs — only the funded overflow path is closed). */
  disablePaidOverflow?: boolean;
  /** When true, this proxy is serving a CODING run: the appended premium fallback
   *  chain is the coding-capable one (`CODING_PREMIUM_FALLBACK_MODELS`, paid
   *  coders) instead of the general non-coder gemini chain, so an exhausted coding
   *  cascade never resolves onto a generalist. Set by `llmProxyForPlan({codingOnly})`.
   *  Pairs with `backstopModels: CODING_BACKSTOP_MODELS` for the credited-key floor. */
  codingOnly?: boolean;
  /** Max FREE-tier seed models the cascade tries before falling through to the
   *  premium fallback. Defaults to `FREE_ATTEMPT_BUDGET` (2) for latency-sensitive
   *  general requests; coding runs pass `CODING_FREE_ATTEMPT_BUDGET` (the whole
   *  free coding pool) so every free coder is exhausted before any paid/metered
   *  coder. */
  freeBudget?: number;
  /** A connected tenant's Claude Pro/Max SUBSCRIPTION access token. When set, the
   *  `anthropic` vendor authenticates with it (Bearer + oauth) instead of the
   *  operator key, so any direct-Claude resolution in the cascade rides the
   *  tenant's own subscription — and is NOT metered as paid-overflow (it's $0 to
   *  us). Resolved per request from `resolveAnthropicOAuthToken`. */
  anthropicOAuthToken?: string | null;
  /** A tenant's BYO api-key credentials (OpenAI / Google / Anthropic) keyed by
   *  provider. When set, vendorEnv overrides the matching operator env key with
   *  the tenant's key for that vendor and marks the vendor tenant-funded (byo) —
   *  so its usage is $0 to us and metered per the BYO rules. Resolved per request
   *  from {@link resolveTenantVendorKeys}. */
  tenantVendorKeys?: TenantVendorKeys | null;
}

export class LlmProxyService {
  private readonly env: ProxyEnv;
  private readonly modelPool: readonly string[];
  private readonly preferredPoolSize: number;
  private readonly productName: ProductName;
  private readonly isPro: boolean;
  private readonly vendorCallTimeoutMs: number | undefined;
  private readonly backstopModels: readonly string[];
  private readonly disablePaidOverflow: boolean;
  private readonly codingOnly: boolean;
  private readonly freeBudget: number;
  private readonly anthropicOAuthToken: string | null;
  private readonly tenantVendorKeys: TenantVendorKeys;

  constructor(env: ProxyEnv, options?: LlmProxyOptions) {
    this.env = env;
    this.modelPool = options?.modelPool ?? FREE_MODEL_POOL;
    this.preferredPoolSize = Math.min(options?.preferredPoolSize ?? PREFERRED_POOL_SIZE, this.modelPool.length);
    this.productName = options?.productName ?? 'builderforceLLM';
    this.isPro = this.productName === 'builderforceLLMPro' || this.productName === 'builderforceLLMTeams';
    this.vendorCallTimeoutMs = options?.vendorCallTimeoutMs;
    this.backstopModels = options?.backstopModels?.length ? options.backstopModels : [GUARANTEED_BACKSTOP_MODEL];
    this.disablePaidOverflow = options?.disablePaidOverflow ?? false;
    this.codingOnly = options?.codingOnly ?? false;
    this.freeBudget = options?.freeBudget && options.freeBudget > 0 ? options.freeBudget : FREE_ATTEMPT_BUDGET;
    this.anthropicOAuthToken = options?.anthropicOAuthToken ?? null;
    this.tenantVendorKeys = options?.tenantVendorKeys ?? {};
    // Mark every vendor a BYO key overrides as tenant-funded up front, so any
    // resolution landing on that vendor this request is stamped byo (cost 0,
    // on-prem/VSIX exempt). vendorEnv() applies the matching key override.
    for (const provider of Object.keys(this.tenantVendorKeys) as Array<keyof TenantVendorKeys>) {
      if (this.tenantVendorKeys[provider]) this.tenantFundedVendors.add(PROVIDER_VENDOR_MAP[provider].vendorId as VendorId);
    }
  }

  /** True when this result was served by the tenant's connected Claude SUBSCRIPTION
   *  (the `anthropic` vendor with an OAuth token bound) — so it's free to us and
   *  must NOT be metered as paid-overflow. The vendor only ever uses OAuth when the
   *  token is present, so vendor=anthropic + token bound ⇒ subscription-funded. */
  private isSubscriptionFunded(result: ProxyResult): boolean {
    return this.anthropicOAuthToken != null && result.resolvedVendor === 'anthropic';
  }

  /** Gateway vendor ids the tenant can serve from their OWN connected account this
   *  request — a BYO api-key (any provider, populated into {@link tenantFundedVendors}
   *  by the constructor) OR a connected Anthropic subscription (OAuth). Drives the
   *  auto-select BYO flagship seed in {@link complete} via {@link byoAutoSeedModels}. */
  private get connectedByoVendors(): Set<string> {
    const set = new Set<string>(this.tenantFundedVendors);
    if (this.anthropicOAuthToken) set.add('anthropic');
    return set;
  }

  /** Vendors whose call was served with a tenant's OWN BYO credential this
   *  request (populated by {@link vendorEnv} when it overlays a per-tenant key on
   *  the operator env). Combined with the Anthropic-subscription case, this is the
   *  full "the tenant funded it" signal for any provider. */
  private readonly tenantFundedVendors = new Set<VendorId>();

  /** True when the tenant's OWN provider credential served the call — a connected
   *  Claude subscription OR a BYO vendor key (OpenAI/Google/Anthropic). The single
   *  source of truth for ProxyResult.byoFunded, generalizing isSubscriptionFunded
   *  across every provider. */
  private isTenantFunded(result: ProxyResult): boolean {
    return this.isSubscriptionFunded(result) || this.tenantFundedVendors.has(result.resolvedVendor);
  }

  /** The premium fallback chain appended to every cascade — empty when the tenant
   *  has exhausted its paid-overflow cap, so the chain composer won't fall through
   *  to a funded model. A CODING run uses the coding-capable chain (paid coders)
   *  so it never resolves onto a general non-coder. Single source for both the
   *  cooldown-prefetch and the chain. */
  private get premiumFallback(): readonly string[] {
    if (this.disablePaidOverflow) return [];
    return this.codingOnly ? CODING_PREMIUM_FALLBACK_MODELS : PREMIUM_FALLBACK_MODELS;
  }

  // --- Public entry points --------------------------------------------------

  /**
   * Forward a chat-completion request through the configured pool.
   *
   * Routing is gateway-owned. The caller's `body.model` (if any) is treated
   * as a *hint* — the gateway puts it at the head of the candidate chain so
   * it's tried first, but the gateway retains the right to advance through
   * its own failover chain when that model is unavailable, on cooldown, or
   * fails. The actual model used is reported via `_builderforce.resolvedModel`
   * so callers can detect substitution and decide whether to retry on their
   * own.
   *
   * Vendor prefixes (`openrouter/<id>`, `cerebras/<id>`, `ollama/<id>`) route
   * to the named vendor explicitly. Bare ids fall back to catalog lookup.
   *
   * When `body.model` is unset, shape-based reordering (tools / response_format
   * / vision content) ranks the most-capable models in the pool first.
   */
  async complete(
    body: ChatCompletionRequest,
    requestHeaders?: Record<string, string>,
    traceId?: string,
    signal?: AbortSignal,
    opts?: { estimatedTokens?: number },
  ): Promise<ProxyResult> {
    const startedAt = Date.now();
    const tid = traceId ?? newTraceId();
    const callerModel = (body as { model?: unknown }).model;
    // `modelStrict` OR the public `strict` alias → single-model hard pin. Both
    // funnel through `resolveStrictPin` (which also enforces the "model present"
    // precondition) so the service can't disagree with the route's gate.
    const wantsStrict = resolveStrictPin(body as { model?: unknown; modelStrict?: unknown; strict?: unknown });

    // Strict-pin path: single-model dispatch, no chain, no failover. Cooldown
    // and missing-vendor-key are the only pre-flight gates; if either fails
    // the request returns 503 `model_unavailable` instead of falling through.
    if (wantsStrict) {
      return this.finalize(
        await this.dispatchStrict(callerModel as string, body, requestHeaders),
        tid, startedAt, [callerModel as string],
      );
    }

    // 1) Pool composition is already TTFT-ordered (Cerebras → Ollama → NVIDIA
    //    → OpenRouter) because `modelsByTier` walks the registry's MODULES
    //    array in priority order. Shape-based reorder then floats capable
    //    models (tools / structured / vision) to the head within that order.
    const reorderedPool = reorderPoolByShape(body, this.modelPool);

    // 1b) Quality-critical useCase (resume tailoring, cover letters, …): re-rank
    //     the shape-sorted pool so the best models the PLAN unlocks lead (premium
    //     writers for paid; a no-op within a free pool). For a strict json_schema
    //     it still keeps a low-ceiling model (Gemini) last within its tier, so the
    //     two routing rules compose. The capability order from the shape sort is
    //     preserved as the within-tier tiebreak.
    const useCase = (body as { useCase?: unknown }).useCase;
    const useCaseStr = typeof useCase === 'string' ? useCase : undefined;
    const qualityCritical = isQualityCriticalUseCase(useCaseStr);
    let routedPool: readonly string[] = qualityCritical
      ? reorderPoolForQuality(reorderedPool, {
          strictSchema: (body as { response_format?: { type?: string } }).response_format?.type === 'json_schema',
        })
      : reorderedPool;

    // 1b2) Agentic tool-loop (the request carries `tools`) is coding-critical: a
    //      long tool-calling analysis turn served by a cheap generalist loops
    //      without converging. `reorderPoolByShape` above floats every tools-capable
    //      model equally, so a merely-tool-advertising generalist can still lead its
    //      bucket; this pass promotes the real CODING_MODEL_POOL drivers ahead of
    //      them. A pure permutation of the plan pool — free tenants only float their
    //      own free coding models (no plan escalation). Skipped for quality-critical
    //      traffic (output-quality writers, ranked by tier just above).
    if (!qualityCritical && inferShape(body).hasTools) {
      routedPool = reorderPoolForCoding(routedPool);
    }

    // 1c) Context-fit first pass: when the caller estimates how many tokens the
    //     turn will send, drop pool models whose catalog window can't hold it, so
    //     a small-window model isn't SEEDED into a context it would 413 on (the
    //     97K-into-32K bug — the exact "Brain dies after several executions"
    //     failover). Never empties the pool (see modelsFittingContext); oversized
    //     requests still fall through to the normal cascade + 413 failover.
    const fittedPool = modelsFittingContext(routedPool, opts?.estimatedTokens);

    // 2) Caller hint goes at the head; rest of the pool follows.
    //    `callerModel` was extracted at the top of this function for the strict-pin
    //    branch; reuse it here for the chained path. With NO caller model, the
    //    owner's connected accounts lead the pool (soft seed) so an auto-select turn
    //    uses the tenant's OWN premium frontier model(s) before the free/paid tiers —
    //    registration-driven (one flagship per connected provider, strongest tier
    //    first), NOT a fixed vendor; Opus/Sonnet for Anthropic per turn shape. The
    //    cascade then fails over across the owner's other connected accounts, and the
    //    plan pool stays behind them all as final fallback. See byoAutoSeedModels.
    // A non-strict caller `model` is a HINT, not an override of the tenant's connected
    // account. Honour it at the head ONLY when it PREEMPTS the BYO seed — nothing
    // connected, or the model is itself served by a connected BYO vendor (see
    // {@link explicitModelPreemptsByo}). A NON-BYO caller model (the VS Code Brain's
    // configured `defaultModel`, a stale coder default, any SDK caller's pin) must NOT
    // shadow the connected flagship: otherwise a tenant with a connected Claude account
    // silently runs a weak free coder — the "should have selected Opus" regression. This
    // is the SAME invariant `byoAwareModel`/`explicitModelPreemptsByo` enforce on the
    // tenantProxy + /v1/messages paths; applying it centrally HERE stops the gateway
    // completion seed from drifting from them (a caller model bypassed the gate before).
    // A shadowed hint still joins the pool just BEHIND the flagship, so it's the first
    // failover after the connected account rather than being dropped.
    const hasCallerModel = typeof callerModel === 'string' && callerModel.length > 0;
    const callerLeads = hasCallerModel && explicitModelPreemptsByo(callerModel as string, this.connectedByoVendors);
    const byoSeeds = callerLeads ? [] : byoAutoSeedModels(this.connectedByoVendors, { agentic: this.codingOnly });
    const seedHead: readonly string[] = callerLeads ? [callerModel as string] : byoSeeds;
    const basePool: readonly string[] = (hasCallerModel && !callerLeads && !fittedPool.includes(callerModel as string))
      ? [callerModel as string, ...fittedPool]
      : fittedPool;
    const seed: readonly string[] = seedHead.length > 0
      ? [...seedHead, ...basePool.filter((m) => !seedHead.includes(m))]
      : basePool;

    // 3) Pre-fetch cooldown state for the leading seed slice + premium fallback
    //    (KV-backed when bound, in-memory fallback otherwise). The seed is
    //    truncated to `COOLDOWN_PREFETCH_LIMIT` entries to bound subrequest
    //    cost — see that constant for the trade-off rationale. Vendor
    //    cooldown short-circuits the per-model walk when one upstream's key
    //    is globally throttled; the fallback models are included so the
    //    chain composer skips any individually cooled entry instead of
    //    firing a doomed retry against a saturated endpoint.
    const seedPrefix = seed.slice(0, COOLDOWN_PREFETCH_LIMIT);
    const fallbackPairs = this.premiumFallback.map((m) => ({ vendor: vendorForModel(m), model: m }));
    const seedVendors = Array.from(new Set([
      ...seedPrefix.map((m) => vendorForModel(m)),
      ...fallbackPairs.map((p) => p.vendor),
    ]));
    const [cooledSet, cooledVendors] = await Promise.all([
      loadCooldowns(this.env, [
        ...seedPrefix.map((m) => ({ vendor: vendorForModel(m), model: m })),
        ...fallbackPairs,
      ]),
      loadCooledVendors(this.env, seedVendors),
    ]);
    // Pinned hint bypasses vendor-level cooldown so a caller-explicit paid model
    // (`anthropic/claude-3-haiku`) gets tried even when the same vendor's free
    // key has 429'd its way into vendor cooldown. Per-model cooldown still
    // applies — we won't retry a model that *itself* just failed.
    // The seed's head (caller pin OR the strongest connected-BYO flagship) bypasses
    // vendor-level cooldown so the owner's own account is still tried even when that
    // vendor's operator key has 429'd its way into vendor cooldown. Per-model cooldown
    // still applies.
    const pinnedHint = seedHead.length > 0 ? seedHead[0] : undefined;
    // Pass seedHead as the cascade HEAD so a deliberately-seeded connected-BYO flagship
    // (or explicit pin) leads verbatim — otherwise a PREMIUM/ULTRA seed falls behind the
    // free pool and the connected account is tried last (or never). See composeFreeCappedCascade.
    const candidates = this.buildCandidateChain(seed, cooledSet, cooledVendors, pinnedHint, seedHead);
    if (candidates.length === 0) {
      // Every model in the seed + premium fallback list is on cooldown. The
      // guaranteed paid backstop (credited key) is the last chance before we
      // surface a hard failure — unless the tenant has exhausted its paid-overflow
      // cap, in which case we don't fund another paid call.
      const backstop = this.disablePaidOverflow ? null : await this.dispatchBackstop(body, requestHeaders);
      if (backstop) {
        // Tenant-funded (a connected subscription OR a BYO api-key) is free to us →
        // never meter it as overflow.
        backstop.paidOverflow = !this.isTenantFunded(backstop);
        return this.finalize(backstop, tid, startedAt, [...this.backstopModels], 'success');
      }
      return this.finalize(
        this.exhaustedResponse(
          seed.slice(),
          0,
          new Error('All candidate models are on cooldown. Retry in a minute or two.'),
        ),
        tid, startedAt, seed.slice(), 'all_cooldown',
      );
    }

    let primary = await this.dispatch(candidates, body, requestHeaders, { signal });
    if (primary.response.status < 400) {
      // Mark overflow when the primary cascade itself landed on an appended
      // premium-fallback model (vs a plan-pool model) so the route meters it —
      // UNLESS the tenant's OWN account served it (a connected subscription OR a BYO
      // api-key — free to us; see isTenantFunded), e.g. an owner whose connected-BYO
      // flagship (claude-*) seeded the head and served the turn on their own account.
      primary.paidOverflow = isPaidOverflowModel(primary.resolvedModel) && !this.isTenantFunded(primary);
      return this.finalize(primary, tid, startedAt, candidates);
    }

    // A genuine malformed request (400/422) can't be fixed by failover OR by
    // relaxing the schema — surface it straight away.
    if (primary.outcome === 'request_error') {
      return this.finalize(primary, tid, startedAt, candidates);
    }

    // AUTO-DOWNGRADE: every candidate rejected the `response_format.json_schema`
    // as too complex for its constrained-decoding engine. Rather than hard-fail a
    // feature that just needs a structured answer (hired.video's resume-tailor),
    // relax the request to loose `json_object` mode — no schema, so no
    // constrained-decoding ceiling — and re-run the cascade. The model still
    // returns JSON (the schema is carried into the prompt as guidance); the caller
    // validates it client-side. This is what turns a terminal schema rejection
    // into a delivered result. The downgraded body also feeds the backstop below,
    // so even a saturated pool floors onto a funded model in json_object mode.
    let effectiveBody = body;
    if (primary.outcome === 'schema_too_complex') {
      const downgraded = downgradeResponseFormat(body);
      if (!downgraded) {
        // No strict json_schema to relax (shouldn't happen for this outcome) —
        // surface the terminal error honestly.
        return this.finalize(primary, tid, startedAt, candidates);
      }
      effectiveBody = downgraded;
      const retry = await this.dispatch(candidates, downgraded, requestHeaders, { signal });
      // Carry the schema-rejection trace in front of the retry's own attempts so
      // the diagnostic record shows BOTH the rejection and the recovery.
      retry.failovers = [...primary.failovers, ...retry.failovers];
      retry.attempts  = [...(primary.attempts ?? []), ...(retry.attempts ?? [])];
      retry.schemaDowngraded = true;
      if (retry.response.status < 400) {
        retry.paidOverflow = isPaidOverflowModel(retry.resolvedModel) && !this.isTenantFunded(retry);
        return this.finalize(retry, tid, startedAt, candidates, 'success');
      }
      // Downgraded cascade still failed for a NON-schema reason (saturation, etc.)
      // — fall through to the funded backstop with the downgraded body.
      primary = retry;
    }

    // Primary cascade failed (saturated free pool, cascade-exhausted 429, etc.).
    // Fire the guaranteed paid backstop on the credited key before giving up so
    // the caller gets a real answer instead of `AI_UNAVAILABLE`. On success,
    // splice the primary cascade's diagnostics in front of the backstop's so the
    // trace still records everything that was tried. Uses `effectiveBody` so a
    // schema-downgraded request floors onto the backstop in json_object mode too.
    const backstop = this.disablePaidOverflow ? null : await this.dispatchBackstop(effectiveBody, requestHeaders);
    if (backstop) {
      backstop.failovers = [...primary.failovers, ...backstop.failovers];
      backstop.retries   = primary.retries + backstop.retries;
      backstop.attempts  = [...(primary.attempts ?? []), ...(backstop.attempts ?? [])];
      backstop.paidOverflow = !this.isTenantFunded(backstop);
      if (effectiveBody !== body) backstop.schemaDowngraded = true;
      return this.finalize(backstop, tid, startedAt, [...candidates, ...this.backstopModels], 'success');
    }
    return this.finalize(primary, tid, startedAt, candidates);
  }

  /** Stamp request-level diagnostics onto a ProxyResult before it leaves
   *  complete(). Single place that owns the trace id, total duration, candidate
   *  chain, final status, rolled-up classification, and outcome — so every
   *  return path (strict / cooldown / dispatched) is uniform. */
  private finalize(
    result: ProxyResult,
    traceId: string,
    startedAt: number,
    candidateChain: readonly string[],
    outcomeOverride?: string,
  ): ProxyResult {
    result.traceId = traceId;
    result.durationMs = Date.now() - startedAt;
    result.status = result.response.status;
    if (!result.candidateChain) result.candidateChain = [...candidateChain];
    if (!result.classification) result.classification = classificationFromFailovers(result.failovers);
    if (outcomeOverride) result.outcome = outcomeOverride;
    else if (!result.outcome) result.outcome = result.response.status < 400 ? 'success' : 'cascade_exhausted';
    // Stamp the tenant-funding signal once, on the single path every result
    // leaves complete() through, so the route can mark the usage row `byo`.
    if (result.byoFunded === undefined) result.byoFunded = this.isTenantFunded(result);
    return result;
  }

  /**
   * Strict-pin dispatch — single model, no chain, no failover. Used when
   * `body.modelStrict === true`. Pre-flight gates:
   *   - vendor key bound? otherwise 503 `model_unavailable` (reason: `vendor_key_unconfigured`)
   *   - model on cooldown?  otherwise 503 `model_unavailable` (reason: `cooldown`)
   * If both pass, dispatches a chain of length 1. Vendor errors propagate
   * verbatim instead of being absorbed into a chain-exhausted envelope.
   */
  private async dispatchStrict(
    model: string,
    body: ChatCompletionRequest,
    requestHeaders?: Record<string, string>,
  ): Promise<ProxyResult> {
    const vendor = vendorForModel(model);
    if (!vendorKeyBound(this.vendorEnv(), vendor)) {
      return strictUnavailableResult(model, 'vendor_key_unconfigured');
    }

    const [cooledSet, cooledVendors] = await Promise.all([
      loadCooldowns(this.env, [{ vendor, model }]),
      loadCooledVendors(this.env, [vendor]),
    ]);
    if (cooledVendors.has(vendor) || cooledSet.has(`${vendor}/${model}`)) {
      return strictUnavailableResult(model, 'cooldown');
    }

    return this.dispatch([model], body, requestHeaders);
  }

  /** Per-model status with cooldown + key-bound info — used by /v1/models.
   *  `capabilities` lets SDK consumers discover image/PDF-reading models
   *  (`vision` / `ocr`) and tool/structured-output support without hard-coding ids. */
  async status(): Promise<Array<{ model: string; preferred: boolean; available: boolean; cooldownUntil?: number; vendor: VendorId; vendorCooledUntil?: number; keyBound: boolean; capabilities: AiCapability[] }>> {
    const env = this.vendorEnv();
    const poolVendors = Array.from(new Set(this.modelPool.map((m) => vendorForModel(m))));
    const [cooledMap, vendorCooledMap] = await Promise.all([
      // `'display'` mode (not the default `'gate'`) so a model still inside its
      // cooldown TTL but past its `trialAfter` half-open instant ([1235]) keeps
      // reporting its full `until` — the admin UI can show the "cooling, probing"
      // countdown for that ~5-min tail instead of flipping to `available:true`.
      loadCooldownExpiries(this.env, this.modelPool.map((m) => ({ vendor: vendorForModel(m), model: m })), 'display'),
      loadCooledVendorExpiries(this.env, poolVendors),
    ]);
    return this.modelPool.map((model, i) => {
      const vendor      = vendorForModel(model);
      const until       = cooledMap.get(`${vendor}/${model}`);
      const vendorUntil = vendorCooledMap.get(vendor);
      const keyBound    = vendorKeyBound(env, vendor);
      return {
        model,
        vendor,
        preferred: i < this.preferredPoolSize,
        keyBound,
        available: keyBound && vendorUntil === undefined && until === undefined,
        capabilities: capabilitiesForModel(model),
        ...(until       !== undefined && until       > 0 ? { cooldownUntil:       until       } : {}),
        ...(vendorUntil !== undefined && vendorUntil > 0 ? { vendorCooledUntil:   vendorUntil } : {}),
      };
    });
  }

  // --- Internals ------------------------------------------------------------

  /**
   * Compose the candidate chain for one request via the shared
   * `composeFreeCappedCascade` helper.
   *
   * Per-model cooldown excludes specific models that recently failed. Per-vendor
   * cooldown is the wider net: when one upstream key is globally throttled
   * (e.g. all OpenRouter free-tier 429s), the vendor itself is cooled and we
   * skip every model owned by that vendor in one pass — instead of walking
   * many models on the saturated key one 429 at a time. See
   * `maybeTripVendorCooldown` in cooldownStore.ts for the trip conditions.
   *
   * The FREE cap is the headline guarantee: regardless of how saturated the
   * upstream free pool is, every cascade tries at most 2 free models before
   * falling through to the premium fallback — so callers always see a
   * successful response instead of `cascade-exhausted` 429s.
   */
  private buildCandidateChain(
    seed: readonly string[],
    cooledSet: Set<string>,
    cooledVendors: Set<VendorId>,
    pinnedModel?: string,
    head?: readonly string[],
  ): string[] {
    return composeFreeCappedCascade({
      seed,
      ...(head && head.length ? { head } : {}),
      premiumFallback: this.premiumFallback,
      freeBudget: this.freeBudget,
      tierOf: tierForModel,
      isUnavailable: buildCooldownPredicate({
        cooledModels:  cooledSet,
        cooledVendors,
        vendorOf:      vendorForModel,
        ...(pinnedModel !== undefined ? { pinnedModel } : {}),
      }),
      cursor: chatRequestCursor,
    });
  }

  /** Synthesize the env passed to vendors — picks the Pro OpenRouter key when applicable. */
  private vendorEnv(): VendorEnv {
    return {
      OPENROUTER_API_KEY: this.isPro
        ? (this.env.OPENROUTER_API_KEY_PRO ?? this.env.OPENROUTER_API_KEY ?? null)
        : (this.env.OPENROUTER_API_KEY ?? null),
      CEREBRAS_API_KEY:         this.env.CEREBRAS_API_KEY         ?? null,
      NVIDIA_API_KEY:           this.env.NVIDIA_API_KEY           ?? null,
      OLLAMA_API_KEY:           this.env.OLLAMA_API_KEY           ?? null,
      // A tenant BYO Google key overrides the operator key for the `googleai`
      // vendor (marked tenant-funded in the constructor → byo, $0 to us).
      GOOGLE_API_KEY:           this.tenantVendorKeys.google      ?? this.env.GOOGLE_API_KEY ?? null,
      // Direct-Anthropic floor key. Flows through creditedVendorEnv() too (which
      // spreads this) so the coding backstop can reach Claude regardless of plan.
      // A tenant BYO Anthropic api-key overrides it (the subscription/OAuth path
      // is separate, via CLAUDE_OAUTH_TOKEN below).
      CLAUDE_API_KEY:           this.tenantVendorKeys.anthropic   ?? this.env.CLAUDE_API_KEY ?? null,
      // A connected tenant's Claude subscription token — when present the anthropic
      // vendor prefers it over CLAUDE_API_KEY (tenant-funded, $0 to us). Spread into
      // creditedVendorEnv() too, so a backstop landing on Claude also uses it.
      CLAUDE_OAUTH_TOKEN:       this.anthropicOAuthToken         ?? null,
      CLOUDFLARE_AI_API_TOKEN:  this.env.CLOUDFLARE_AI_API_TOKEN  ?? null,
      CLOUDFLARE_ACCOUNT_ID:    this.env.CLOUDFLARE_ACCOUNT_ID    ?? null,
      // OpenAI-compatible commercial vendor keys (openai / groq / deepseek / …).
      // Passed straight through so an explicit `<vendor>/<id>` pin (e.g. from the
      // dataset wizard or model picker) reaches the vendor via the SAME dispatch
      // machinery. Each is autoRoute:false, so an unbound key just means that
      // vendor is skipped — it never affects the default FREE/PRO cascade. The
      // list is derived from `OPENAI_COMPATIBLE_VENDOR_KEYS` so it can't drift
      // from the registered vendors.
      ...passthroughVendorKeys(this.env),
      // A tenant BYO OpenAI key overrides the operator OpenAI key (spread above)
      // for the `openai` vendor — marked tenant-funded → byo, $0 to us.
      ...(this.tenantVendorKeys.openai ? { OPENAI_API_KEY: this.tenantVendorKeys.openai } : {}),
    };
  }

  /**
   * Vendor env that forces the *credited* (Pro) OpenRouter key regardless of the
   * proxy's plan, so the guaranteed backstop can reach paid models even when the
   * request itself came in on the free key. Falls back to the standard key when
   * no Pro key is bound (single-key deployments still get a backstop attempt).
   */
  private creditedVendorEnv(): VendorEnv {
    return {
      ...this.vendorEnv(),
      OPENROUTER_API_KEY: this.env.OPENROUTER_API_KEY_PRO ?? this.env.OPENROUTER_API_KEY ?? null,
    };
  }

  /**
   * Guaranteed paid backstop — see `GUARANTEED_BACKSTOP_MODEL`. Dispatched only
   * after the primary cascade has failed (or every candidate was cooled). Forces
   * the credited key + the extended premium timeout so one low-variance paid
   * model can answer even on the free plan with a saturated free pool.
   *
   * Returns the successful `ProxyResult`, or `null` when no credited key is bound
   * or the backstop itself fails — the caller then surfaces the original failure.
   */
  private async dispatchBackstop(
    body: ChatCompletionRequest,
    requestHeaders?: Record<string, string>,
  ): Promise<ProxyResult | null> {
    const creditedEnv = this.creditedVendorEnv();
    if (!creditedEnv.OPENROUTER_API_KEY) return null; // no paid key to fall back to
    const result = await this.dispatch([...this.backstopModels], body, requestHeaders, {
      vendorEnv: creditedEnv,
      timeoutMs: PREMIUM_VENDOR_CALL_TIMEOUT_MS,
    });
    return result.response.status < 400 ? result : null;
  }

  private async dispatch(
    candidates: string[],
    body: ChatCompletionRequest,
    requestHeaders?: Record<string, string>,
    overrides?: { vendorEnv?: VendorEnv; timeoutMs?: number; signal?: AbortSignal },
  ): Promise<ProxyResult> {
    // Sanitize tool names (`governance.snapshot` → `governance__DOT__snapshot`)
    // AND tool-call ids (foreign ids with `:` `/` `.` → `^[a-zA-Z0-9_-]+$`)
    // before the body reaches a vendor — Anthropic / some Cerebras configs
    // reject both. Walks `tools`, `tool_choice`, message `tool_calls` (name+id),
    // and tool-message `name`/`tool_call_id`. Names are restored in dispatchJson
    // before returning to the caller; ids are opaque and are not restored.
    const sanitizedBody = sanitizeRequestToolCalls(body as unknown as Record<string, unknown>) as unknown as ChatCompletionRequest;
    const messages = sanitizedBody.messages as unknown as Array<Record<string, unknown>>;
    const extraBody = stripStandardFields(sanitizedBody);
    // Timeout precedence: an explicit dispatch override (e.g. the paid backstop
    // forcing the premium budget) wins; otherwise a per-request caller override
    // (`_builderforce.vendorTimeoutMs`, clamped) lets even a free-plan one-off
    // long call escape the short plan default; otherwise the proxy's configured
    // plan default. Reuses the existing `overrides.timeoutMs` plumbing — no
    // parallel path.
    const effectiveTimeoutMs =
      overrides?.timeoutMs
      ?? resolveVendorTimeoutOverride(sanitizedBody as unknown as Record<string, unknown>)
      ?? this.vendorCallTimeoutMs;
    const vendorEnv = overrides?.vendorEnv ?? this.vendorEnv();
    const cacheTtl = resolveCacheTtl(sanitizedBody as unknown as Record<string, unknown>);
    const callParams = {
      messages,
      ...(sanitizedBody.max_tokens  != null ? { maxTokens:   sanitizedBody.max_tokens  } : {}),
      ...(sanitizedBody.temperature != null ? { temperature: sanitizedBody.temperature } : {}),
      ...(sanitizedBody.top_p       != null ? { topP:        sanitizedBody.top_p       } : {}),
      ...(Object.keys(extraBody).length > 0 ? { extraBody } : {}),
      ...(cacheTtl ? { cacheTtl } : {}),
      title: this.productName,
      ...(effectiveTimeoutMs ? { timeoutMs: effectiveTimeoutMs } : {}),
      ...(overrides?.signal ? { signal: overrides.signal } : {}),
      // Thread the R2 artifact store so the `evermind` vendor can load a
      // published model. Harmless for every other (HTTP) vendor — they ignore it.
      ...(this.env.UPLOADS ? { uploads: this.env.UPLOADS } : {}),
    };

    if (sanitizedBody.stream) {
      return this.dispatchStream(candidates, callParams, vendorEnv, requestHeaders);
    }
    return this.dispatchJson(candidates, callParams, vendorEnv, sanitizedBody);
  }

  /**
   * Non-streaming dispatch with optional `response_format` conformance retry.
   *
   * When the request asks for `json_object` or `json_schema` output, the
   * gateway parses the assistant message after each successful vendor call.
   * If parsing fails (or, for strict `json_schema`, the document is missing
   * a required field) the gateway advances past the model that just answered
   * and re-dispatches on the remaining suffix. The total non-conforming
   * round-trips are surfaced via `_builderforce.schemaRetries`.
   */
  private async dispatchJson(
    candidates: string[],
    callParams: Omit<Parameters<typeof dispatchVendor>[0], 'env' | 'modelChain'>,
    vendorEnv: VendorEnv,
    body: ChatCompletionRequest,
  ): Promise<ProxyResult> {
    let chain = candidates;
    let totalAttempts = 0;
    const totalFailovers: FailoverEvent[] = [];
    let schemaRetries = 0;
    let lastResult: Awaited<ReturnType<typeof dispatchVendor>> | null = null;

    while (chain.length > 0) {
      let result: Awaited<ReturnType<typeof dispatchVendor>>;
      try {
        result = await dispatchVendor({
          env: vendorEnv,
          modelChain: chain,
          ...callParams,
        });
      } catch (err) {
        // Worker subrequest cap exhausted — every later fetch from this isolate
        // throws the same thing. Surface a distinct 503 envelope and SKIP
        // cooldown writes (each is another subrequest that would compound the
        // problem and may itself throw the same error). The 503 lets the
        // caller distinguish "infrastructure ceiling" from "vendor rate limit"
        // and back off rather than retrying a doomed loop.
        if (err instanceof WorkerSubrequestExhaustedError) {
          return this.subrequestExhaustedResponse(candidates, schemaRetries, err);
        }
        // Caller cancelled — propagate so complete() stops immediately instead of
        // firing the paid backstop and spending more tokens on a cancelled run.
        if (err instanceof RequestAbortedError) throw err;
        // Fatal bad-payload (400/422) short-circuits the cascade in the vendor
        // dispatcher (failover can't fix a malformed request). Surface it as a
        // FATAL 4xx carrying the upstream diagnostic — NOT a 429 — and write no
        // cooldown (recordFailure no-ops request_error anyway). Mirrors the
        // all-request-error branch in exhaustedResponse for the cascaded case.
        if (err instanceof VendorFatalError && isRequestErrorStatus(err.status)) {
          const att = fatalErrorAttempt(err, chain);
          return this.requestErrorResponse([att], att.model, att.vendor, attemptsToFailovers([att]), schemaRetries);
        }
        const errAttempts = err instanceof CascadeExhaustedError ? err.attempts : [];
        await this.applyCooldowns(errAttempts);
        return this.exhaustedResponse(candidates, schemaRetries, err, errAttempts);
      }

      await this.applyCooldowns(result.attempts);
      totalAttempts += result.attempts.length;
      totalFailovers.push(...attemptsToFailovers(result.attempts));
      lastResult = result;

      const conformanceErr = checkResponseFormatConformance(body, result.raw);
      if (!conformanceErr) {
        return this.successJsonResult(result, totalAttempts, totalFailovers, schemaRetries);
      }

      // Non-conforming: advance past the model that just answered.
      schemaRetries++;
      const idx = chain.indexOf(result.modelUsed);
      chain = idx >= 0 ? chain.slice(idx + 1) : [];
    }

    // Chain exhausted with all candidates non-conforming. Return the last
    // body so callers see whatever the most-capable model produced, but
    // surface the retry count so they can detect the conformance failure.
    if (lastResult) {
      return this.successJsonResult(lastResult, totalAttempts, totalFailovers, schemaRetries);
    }
    return this.exhaustedResponse(candidates, schemaRetries);
  }

  private successJsonResult(
    result: Awaited<ReturnType<typeof dispatchVendor>>,
    totalAttempts: number,
    totalFailovers: FailoverEvent[],
    schemaRetries: number,
  ): ProxyResult {
    // Restore dotted tool names that the request-side sanitizer escaped, so
    // `tool_calls[*].function.name` round-trips to the caller's namespace.
    const restoredRaw = restoreResponseToolNames(result.raw);
    return {
      response: new Response(JSON.stringify(restoredRaw), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
      resolvedModel: result.modelUsed,
      resolvedVendor: result.vendorUsed,
      retries: totalAttempts,
      failovers: totalFailovers,
      outcome: 'success',
      attempts: result.attempts,
      ...(result.usage ? {
        usage: {
          promptTokens:     result.usage.prompt_tokens     ?? 0,
          completionTokens: result.usage.completion_tokens ?? 0,
          totalTokens:      result.usage.total_tokens      ?? 0,
          ...(result.usage.cache_read_tokens     != null ? { cacheReadTokens:     result.usage.cache_read_tokens     } : {}),
          ...(result.usage.cache_creation_tokens != null ? { cacheCreationTokens: result.usage.cache_creation_tokens } : {}),
        },
      } : {}),
      ...(schemaRetries > 0 ? { schemaRetries } : {}),
    };
  }

  /**
   * Build the cascade-exhausted 429 envelope. When real `attempts[]` are
   * available (from `CascadeExhaustedError`), use them for `failovers` so the
   * downstream `llm_failover_log` row carries the actual upstream status —
   * not a synthetic `code: 0`. Without this, the per-model rate-limit panel
   * cannot distinguish "model 429'd 50 times" from "model wasn't tried."
   */
  private exhaustedResponse(
    candidates: string[],
    schemaRetries: number,
    err?: unknown,
    attempts?: ReadonlyArray<DispatchAttempt>,
  ): ProxyResult {
    const message = err instanceof Error ? err.message : (err ? String(err) : 'All candidates produced non-conforming output');
    const failovers: FailoverEvent[] = attempts && attempts.length > 0
      ? attempts.map(attemptToFailover)
      : candidates.map((model) => ({ model, vendor: vendorForModel(model), code: 0, durationMs: 0, kind: 'skipped' }));
    // Pick the *last* dispatched attempt as the "model the gateway was on when
    // it gave up" — that's the most informative attribution for consumers
    // doing per-vendor saturation rollups. Falls back to the last candidate
    // when no attempts ran (every model on cooldown / no key bound).
    const resolvedModel = attempts && attempts.length > 0
      ? attempts[attempts.length - 1]!.model
      : (candidates[candidates.length - 1] ?? this.modelPool[0] ?? FREE_MODEL_POOL[0] ?? '');
    const resolvedVendor: VendorId = attempts && attempts.length > 0
      ? attempts[attempts.length - 1]!.vendor
      : vendorForModel(resolvedModel);

    // All-request-error short-circuit: when EVERY dispatched attempt failed with
    // a 400/422 (caller-side schema / validation bug), the cascade isn't
    // "exhausted" in the rate-limit sense — no amount of failover or backstop
    // will fix a malformed request. Surface a FATAL 4xx carrying the upstream's
    // own diagnostic so the caller can fix their payload, instead of a generic
    // 429 that invites a doomed retry loop. Mirrors the no-cooldown decision in
    // cooldownStore.classifyFailure('request_error').
    if (attempts && attempts.length > 0 && attempts.every((a) => isRequestErrorStatus(a.status))) {
      return this.requestErrorResponse(attempts, resolvedModel, resolvedVendor, failovers, schemaRetries);
    }

    // Failover breakdown lives under `error.details.failovers` — OpenAI-style
    // envelope so the SDK's existing `details` accessor on BuilderforceApiError
    // picks it up without a parser change. Top-level `vendor` + `model` give
    // consumers a single field to group by without parsing the model-id prefix
    // (which fails silently for OpenRouter-routed families like `qwen/*`,
    // `google/*`, `anthropic/*` that share the prefix with the model family,
    // not the upstream vendor).
    const exhaustedBody = JSON.stringify({
      error: {
        message,
        code: 429,
        type: 'rate_limit_error',
        vendor: resolvedVendor,
        model: resolvedModel,
        details: { failovers },
      },
    });
    return {
      response: new Response(exhaustedBody, {
        status: 429,
        headers: { 'content-type': 'application/json' },
      }),
      resolvedModel,
      resolvedVendor,
      retries: attempts?.length ?? candidates.length,
      failovers,
      outcome: 'cascade_exhausted',
      attempts: attempts ? [...attempts] : [],
      ...(schemaRetries > 0 ? { schemaRetries } : {}),
    };
  }

  /**
   * Build the FATAL request-error envelope — used when every dispatched
   * candidate failed with a 400/422 (caller-side schema / validation bug).
   *
   * Surfaces the upstream's status verbatim (400 or 422) and its diagnostic
   * message so the caller gets an actionable "your request is malformed"
   * signal instead of a 429 cascade-exhausted (which implies "retry later" and
   * invites a doomed loop on a request that can never succeed). No cooldown was
   * written for these attempts — see `cooldownStore.classifyFailure`.
   */
  private requestErrorResponse(
    attempts: ReadonlyArray<DispatchAttempt>,
    resolvedModel: string,
    resolvedVendor: VendorId,
    failovers: FailoverEvent[],
    schemaRetries: number,
  ): ProxyResult {
    // Echo the *last* attempt's status (400 vs 422 are both caller-fixable) and
    // its error text — that's the model the gateway gave up on, and its body
    // carries the most specific validation diagnostic.
    const last   = attempts[attempts.length - 1]!;
    const status = isRequestErrorStatus(last.status) ? last.status : 400;

    // Distinguish a SCHEMA-too-complex cascade from a generic malformed-payload
    // one: when every dispatched attempt rejected the request because the
    // `response_format.json_schema` exceeded its constrained-decoding ceiling
    // (Gemini "too many states", etc.), surface a distinct, actionable code so
    // the caller knows to simplify the schema or drop to `json_object` mode —
    // NOT a generic `invalid_request_error` that reads like a payload bug.
    const allSchema = attempts.length > 0 && attempts.every((a) => a.kind === 'schema');
    const code: string | number = allSchema ? SCHEMA_TOO_COMPLEX_REASON : status;
    const message = allSchema
      ? `Every candidate model rejected the supplied response_format.json_schema as too complex for its constrained-decoding engine. Simplify the schema (fewer/optional fields, shallower nesting, fewer enums) or use response_format { type: 'json_object' }. Upstream: ${last.error || 'schema too complex'}`
      : (last.error || 'Request rejected by every candidate model as malformed (400/422).');
    const body = JSON.stringify({
      error: {
        message,
        code,
        type: 'invalid_request_error',
        // Both classes are TERMINAL: retrying the SAME request on a DIFFERENT
        // model won't help — every candidate already rejected it. The SDK honours
        // `terminal` to short-circuit its own failover loop (no more burning the
        // chain on a request that can never succeed as-is).
        terminal: true,
        ...(allSchema ? { reason: SCHEMA_TOO_COMPLEX_REASON } : {}),
        vendor: resolvedVendor,
        model: resolvedModel,
        details: { failovers },
      },
    });
    return {
      response: new Response(body, {
        status,
        headers: { 'content-type': 'application/json' },
      }),
      resolvedModel,
      resolvedVendor,
      retries: attempts.length,
      failovers,
      outcome: allSchema ? 'schema_too_complex' : 'request_error',
      attempts: [...attempts],
      ...(schemaRetries > 0 ? { schemaRetries } : {}),
    };
  }

  /**
   * Build the 503 `worker_subrequest_exhausted` envelope. Distinct from
   * `exhaustedResponse` because the failure mode is infrastructure
   * (Cloudflare's per-invocation subrequest cap), not vendor saturation —
   * callers should back off and retry rather than walk their own failover
   * chain across more models. Skips cooldown writes deliberately: each KV
   * `put` is another subrequest that would compound the problem and may
   * itself throw the same error.
   */
  private subrequestExhaustedResponse(
    candidates: string[],
    schemaRetries: number,
    err: WorkerSubrequestExhaustedError,
  ): ProxyResult {
    const resolvedModel  = err.model || (candidates[candidates.length - 1] ?? this.modelPool[0] ?? FREE_MODEL_POOL[0] ?? '');
    const resolvedVendor = vendorForModel(resolvedModel);
    const body = JSON.stringify({
      error: {
        message: `Gateway hit Cloudflare's per-invocation subrequest cap; retry the request to land on a fresh Worker isolate. (${err.message})`,
        code: 503,
        type: 'service_unavailable',
        reason: 'worker_subrequest_exhausted',
        vendor: resolvedVendor,
        model:  resolvedModel,
        details: { failovers: [{ model: resolvedModel, vendor: resolvedVendor, code: 0, durationMs: 0, kind: 'network' }] },
      },
    });
    return {
      response: new Response(body, {
        status: 503,
        headers: { 'content-type': 'application/json', 'retry-after': '1' },
      }),
      resolvedModel,
      resolvedVendor,
      retries: 1,
      failovers: [{ model: resolvedModel, vendor: resolvedVendor, code: 0, durationMs: 0, kind: 'network' }],
      outcome: 'subrequest_exhausted',
      attempts: [{ model: resolvedModel, vendor: resolvedVendor, status: 0, error: err.message, durationMs: 0, kind: 'network' }],
      ...(schemaRetries > 0 ? { schemaRetries } : {}),
    };
  }

  private async dispatchStream(
    candidates: string[],
    callParams: Omit<Parameters<typeof dispatchVendorStream>[0], 'env' | 'modelChain'>,
    vendorEnv: VendorEnv,
    _requestHeaders?: Record<string, string>,
  ): Promise<ProxyResult> {
    try {
      const result = await dispatchVendorStream({
        env: vendorEnv,
        modelChain: candidates,
        ...callParams,
      });
      this.applyCooldowns(result.attempts);
      // Restore dotted tool names in the streamed SSE deltas — symmetric to the
      // non-streaming `restoreResponseToolNames` in successJsonResult. Names can
      // arrive in fragments, so a stateful restorer buffers per tool-call index.
      const restoredBody = result.response.body
        ? restoreStreamToolNames(result.response.body)
        : result.response.body;
      const response = restoredBody && restoredBody !== result.response.body
        ? new Response(restoredBody, {
            status: result.response.status,
            headers: result.response.headers,
          })
        : result.response;
      return {
        response,
        resolvedModel: result.modelUsed,
        resolvedVendor: result.vendorUsed,
        retries: result.attempts.length,
        failovers: attemptsToFailovers(result.attempts),
        outcome: 'success',
        attempts: result.attempts,
      };
    } catch (err) {
      if (err instanceof WorkerSubrequestExhaustedError) {
        return this.subrequestExhaustedResponse(candidates, 0, err);
      }
      if (err instanceof RequestAbortedError) throw err;
      // Fatal bad-payload (400/422) — surface as a fatal 4xx, not a 429. See the
      // non-streaming dispatchJson branch for rationale.
      if (err instanceof VendorFatalError && isRequestErrorStatus(err.status)) {
        const att = fatalErrorAttempt(err, candidates);
        return this.requestErrorResponse([att], att.model, att.vendor, attemptsToFailovers([att]), 0);
      }
      const errAttempts = err instanceof CascadeExhaustedError ? err.attempts : [];
      await this.applyCooldowns(errAttempts);
      return this.exhaustedResponse(candidates, 0, err, errAttempts);
    }
  }

  /**
   * Record cooldowns for every failed attempt. Classification (5 min for
   * transient, 30 min for auth) lives in `cooldownStore.classifyFailure`.
   *
   * Awaited (not fire-and-forget): on Cloudflare Workers a `void` promise can
   * be aborted when the request lifecycle ends, leaving the cooldown unwritten.
   * KV writes are ~50–200ms in parallel — only on the failure path — so the
   * extra latency is acceptable in exchange for cooldowns that actually stick.
   */
  private async applyCooldowns(attempts: ReadonlyArray<DispatchAttempt>): Promise<void> {
    if (attempts.length === 0) return;
    await Promise.all(
      attempts.map((a) => recordFailure(this.env, a.vendor, a.model, a.status, a.error)),
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A request-validation status (400/422) — caller-side schema bug. Mirrors the
 *  `request_error` branch in `cooldownStore.classifyFailure`: these write no
 *  cooldown and, when they're the ONLY failure across the cascade, surface as a
 *  fatal 4xx rather than a 429. Single source of truth for the gateway's
 *  "caller's fault, not the model's" status set. */
export function isRequestErrorStatus(status: number): boolean {
  return status === 400 || status === 422;
}

/**
 * Relax a too-complex `response_format.json_schema` to loose `json_object` so a
 * re-dispatch escapes the vendor's constrained-decoding ceiling while still
 * returning JSON — the gateway's auto-recovery for `schema_too_complex` (so a
 * structured feature like resume-tailoring returns a result instead of a terminal
 * 422). Returns a shallow-cloned body, or `null` when there's no strict
 * json_schema to downgrade (a genuine malformed request, or already loose mode).
 *
 * The original schema is appended to `messages` as a SYSTEM hint so the model
 * still targets the expected shape now that the constrained decoder is gone —
 * the caller validates the JSON client-side. Pure + unit-testable.
 */
export function downgradeResponseFormat(body: ChatCompletionRequest): ChatCompletionRequest | null {
  const rf = (body as { response_format?: { type?: string; json_schema?: { schema?: unknown } } }).response_format;
  if (!rf || rf.type !== 'json_schema') return null;
  const clone: ChatCompletionRequest = { ...body, response_format: { type: 'json_object' } };
  const schema = rf.json_schema?.schema;
  if (schema && typeof schema === 'object' && Array.isArray(clone.messages)) {
    clone.messages = [
      ...clone.messages,
      {
        role: 'system',
        content:
          'Respond with a SINGLE JSON object that conforms to this JSON Schema. ' +
          'Output only the JSON — no markdown, no code fences, no prose:\n' +
          JSON.stringify(schema),
      },
    ];
  }
  return clone;
}

/** Synthesize the single `DispatchAttempt` for a `VendorFatalError` (400/422) that
 *  short-circuited the cascade in the vendor dispatcher before it could be recorded
 *  as an attempt. `VendorFatalError` carries the status + message + vendor but NOT
 *  the model id, so the failing model is recovered as the first chain entry owned by
 *  that vendor (earlier entries may have been no-key-skipped) — falling back to the
 *  chain head when none matches. */
function fatalErrorAttempt(err: VendorFatalError, chain: readonly string[]): DispatchAttempt {
  const model = chain.find((m) => vendorForModel(m) === err.vendorId) ?? chain[0] ?? '';
  const vendor = vendorForModel(model);
  return { model, vendor, status: err.status, error: err.message, durationMs: 0, kind: kindForStatus(err.status, err.message) };
}

function attemptsToFailovers(attempts: DispatchAttempt[]): FailoverEvent[] {
  return attempts.map(attemptToFailover);
}

/** One {@link DispatchAttempt} → {@link FailoverEvent}, carrying the structured
 *  `reason`/`upstreamStatus` when present so consumers branch on data, not prose.
 *  Single source for both `attemptsToFailovers` and `exhaustedResponse`'s mapper. */
export function attemptToFailover(a: DispatchAttempt): FailoverEvent {
  return {
    model: a.model,
    vendor: a.vendor,
    code: a.status,
    ...(a.durationMs != null ? { durationMs: a.durationMs } : {}),
    ...(a.kind ? { kind: a.kind } : {}),
    ...(a.reason ? { reason: a.reason } : {}),
    ...(a.upstreamStatus != null ? { upstreamStatus: a.upstreamStatus } : {}),
    ...(a.error ? { detail: a.error.slice(0, 240) } : {}),
  };
}

/** Authoritative gateway trace id. Prefix `llm-` mirrors what consumers already
 *  surface as `correlationId`, so a customer can quote it straight back to a
 *  superadmin for lookup. */
export function newTraceId(): string {
  return `llm-${crypto.randomUUID()}`;
}

/** Roll a set of per-attempt `kind`s up into one classification for the trace.
 *  `skipped` attempts (cooldown / no key) don't count toward the class. */
function classificationFromFailovers(failovers: ReadonlyArray<FailoverEvent>): string {
  const kinds = new Set(
    failovers.map((f) => f.kind).filter((k): k is string => !!k && k !== 'skipped'),
  );
  if (kinds.size === 0) return 'none';
  if (kinds.size === 1) return [...kinds][0]!;
  return 'mixed';
}

// ---------------------------------------------------------------------------
// Plan → proxy factory  (eliminates duplicated isPro/pool/productName wiring)
// ---------------------------------------------------------------------------

export type EffectivePlan = 'free' | 'pro' | 'teams';

/**
 * Resolve the (productName, modelPool, vendorCallTimeoutMs) triple for a
 * given (plan, premiumOverride) pair. Single source of truth so the proxy
 * factory, the model-listing endpoint, and the response header logic stay
 * aligned. Per the DRY rule: callers consume this rather than recomputing
 * any of the three branches independently.
 *
 *   premiumOverride=true → top PREMIUM-tier models + extended 60s vendor
 *     timeout + Pro OpenRouter key. Plan/billing irrelevant — superadmin
 *     grant overrides them so comped / beta access works without flipping
 *     the billing plan.
 *
 *   premiumOverride=false → plan-driven routing as before.
 */
export function resolveRouting(
  effectivePlan: EffectivePlan,
  premiumOverride: boolean,
): { productName: ProductName; modelPool: readonly string[]; vendorCallTimeoutMs?: number } {
  if (premiumOverride) {
    return {
      productName: 'builderforceLLMPro',
      modelPool: PREMIUM_PRIORITY_POOL,
      vendorCallTimeoutMs: PREMIUM_VENDOR_CALL_TIMEOUT_MS,
    };
  }
  const productName: ProductName =
    effectivePlan === 'teams' ? 'builderforceLLMTeams'
    : effectivePlan === 'pro' ? 'builderforceLLMPro'
    :                            'builderforceLLM';
  if (effectivePlan === 'free') {
    // Free pool fails fast (15s/attempt) so it reaches the guaranteed paid
    // backstop within the caller's deadline. Paid plans keep the default budget.
    return { productName, modelPool: FREE_MODEL_POOL, vendorCallTimeoutMs: FREE_VENDOR_CALL_TIMEOUT_MS };
  }
  return { productName, modelPool: PRO_MODEL_POOL };
}

/** Map an effective plan to its productName + model pool, then construct the proxy.
 *  When `premiumOverride` is true the routing is forced to the premium pool
 *  + extended vendor timeout regardless of plan. Single entry point so
 *  /v1/chat/completions and /v1/models stay aligned. */
export function llmProxyForPlan(
  env: ProxyEnv,
  effectivePlan: EffectivePlan,
  premiumOverride = false,
  opts?: { backstopModels?: readonly string[]; disablePaidOverflow?: boolean; codingOnly?: boolean; anthropicOAuthToken?: string | null; tenantVendorKeys?: TenantVendorKeys | null; vendorCallTimeoutMs?: number },
): LlmProxyService {
  const routing = resolveRouting(effectivePlan, premiumOverride);
  const { productName, modelPool } = routing;
  // A caller may override the per-vendor timeout — used to lift the free plan's 15s
  // fast-fail budget for a tenant's CONNECTED BYO account, whose (non-streaming) call
  // is the primary path and worth waiting for (a frontier completion routinely exceeds
  // 15s). Override wins over the plan-resolved value.
  const vendorCallTimeoutMs = opts?.vendorCallTimeoutMs ?? routing.vendorCallTimeoutMs;
  // A CODING run restricts its failover cascade to the curated coding pool, so an
  // exhausted/failed primary escalates to the paid CODING backstop (deepseek-v4-flash)
  // — NOT to a random free non-coder (gemini-flash-lite) or a tool-unreliable vendor.
  // Without this the cascade walks the whole plan pool and "degrades" off the coders.
  const pool = opts?.codingOnly ? codingModelsForPlan(effectivePlan, premiumOverride) : modelPool;
  return new LlmProxyService(env, {
    modelPool: pool,
    preferredPoolSize: PREFERRED_POOL_SIZE,
    productName,
    ...(vendorCallTimeoutMs ? { vendorCallTimeoutMs } : {}),
    ...(opts?.backstopModels ? { backstopModels: opts.backstopModels } : {}),
    ...(opts?.disablePaidOverflow ? { disablePaidOverflow: true } : {}),
    // A coding run walks the WHOLE free coding pool before any paid/metered coder
    // (cost over latency), so the funded direct-Anthropic floor is genuine last-resort.
    // A general (non-coding) run uses the PLAN-AWARE free budget: Free → 2 (latency),
    // Pro/Teams → wider free-tier breadth before escalating to their paid pool.
    ...(opts?.codingOnly
      ? { codingOnly: true, freeBudget: CODING_FREE_ATTEMPT_BUDGET }
      : { freeBudget: freeAttemptBudgetForPlan(effectivePlan) }),
    // A connected tenant subscription token powers any direct-Claude resolution.
    ...(opts?.anthropicOAuthToken ? { anthropicOAuthToken: opts.anthropicOAuthToken } : {}),
    // BYO api-keys (OpenAI/Google/Anthropic) override the operator keys for their
    // vendors and mark those calls tenant-funded (byo).
    ...(opts?.tenantVendorKeys ? { tenantVendorKeys: opts.tenantVendorKeys } : {}),
  });
}

export function productNameForPlan(effectivePlan: EffectivePlan, premiumOverride = false): ProductName {
  return resolveRouting(effectivePlan, premiumOverride).productName;
}

export function modelPoolForPlan(effectivePlan: EffectivePlan, premiumOverride = false): readonly string[] {
  return resolveRouting(effectivePlan, premiumOverride).modelPool;
}

/**
 * Curated coding/tool-calling models the given plan can actually reach, best-first
 * — `CODING_MODEL_POOL` intersected with the plan's pool. The single source of
 * truth for "which coding models to offer / default to" on a plan: a free tenant
 * gets only the free coding models, a Pro tenant also gets the premium ones.
 * Consumed by `/llm/v1/models` (the cloud-agent picker) AND `codingDefaultForPlan`
 * (the cloud runtime default) so the picker and the runtime never diverge.
 */
export function codingModelsForPlan(effectivePlan: EffectivePlan, premiumOverride = false): string[] {
  const pool = new Set(modelPoolForPlan(effectivePlan, premiumOverride));
  return CODING_MODEL_POOL.filter((m) => pool.has(m));
}

/** Best coding model the plan can reach (Pro → premium, Free → free coding model),
 *  falling back to the global free default if the plan pool somehow excludes all. */
export function codingDefaultForPlan(effectivePlan: EffectivePlan, premiumOverride = false): string {
  return codingModelsForPlan(effectivePlan, premiumOverride)[0] ?? CODING_DEFAULT_MODEL;
}

/**
 * Decide the model a cloud-agent run should use for a turn, shared by every cloud
 * executor (durable loop + container op) so the "explicit pick = hard pin, else
 * plan's best coding model" rule lives in ONE place.
 *   • PAID plan (Pro/Teams, or a premium override) + explicit real catalog id →
 *     hard pin (`strict`), dispatched as-is.
 *   • FREE plan → model selection is NOT offered (the picker is hidden, see
 *     RunAgentControl) and is ALSO enforced here server-side: any explicit pick
 *     (a user choice OR an agent's pinned base_model) is IGNORED and the run uses
 *     the free plan's managed coding default. Builderforce manages which model
 *     free tenants run on; this is the authoritative gate (the UI hide is cosmetic).
 *   • absent / typo'd / off-catalog → the plan's default coding model, soft (so a
 *     cold model can fail over once before the run locks onto what resolved).
 */
/** Minimal per-model stat shape the learned router ranks on — a structural subset
 *  of `routingTable.ActionModelStat`, declared here so this pure module never imports
 *  the routing-table/DB layer (keeps `rankModelsForAction` I/O-free + unit-testable). */
export interface ActionModelRankStat {
  model: string;
  n: number;
  avgScore: number;
  avgCostMc: number;
}

export interface RankModelsOptions {
  /** Minimum samples a (action_type, model) bucket needs before it can lead. */
  minSamples?: number;
  /** Optional client-computed SSM recall nudge (model → +/- weight) applied to the
   *  learned score BEFORE the sort. Personalization on top of the shared table. */
  bias?: Record<string, number>;
}

export const DEFAULT_MIN_SAMPLES = 8;

/**
 * Learned-routing reorder (PURE — no I/O). Stable-reorders the curated, plan-reachable
 * coding pool so the empirically-best model for this action type leads:
 *   • a model is ELIGIBLE to lead only with `n >= minSamples` samples;
 *   • eligible models sort by `avgScore (+ bias)` desc, ties broken by lower
 *     `avgCostMc`, then by the curated index (stable);
 *   • every model below the sample floor keeps the curated order, appended after;
 *   • when NO model clears the floor, the curated order is returned UNCHANGED
 *     (cold-start safety — routing degrades to today's static order).
 * The optional `bias` only nudges ordering AMONG already-eligible models (a nudge on
 * top of the table, never a way to surface a cold model). Never invents a model: the
 * output is always a permutation of `reachable`.
 */
export function rankModelsForAction(
  reachable: readonly string[],
  stats: ReadonlyArray<ActionModelRankStat> | undefined,
  opts?: RankModelsOptions,
): string[] {
  const minSamples = opts?.minSamples ?? DEFAULT_MIN_SAMPLES;
  const bias = opts?.bias ?? {};
  const statByModel = new Map<string, ActionModelRankStat>();
  for (const s of stats ?? []) statByModel.set(s.model, s);

  const curatedIndex = new Map<string, number>();
  reachable.forEach((m, i) => curatedIndex.set(m, i));

  const eligible: string[] = [];
  const rest: string[] = [];
  for (const m of reachable) {
    const s = statByModel.get(m);
    if (s && s.n >= minSamples) eligible.push(m);
    else rest.push(m);
  }
  if (eligible.length === 0) return [...reachable]; // cold-start: static order unchanged.

  const scoreOf = (m: string): number => (statByModel.get(m)!.avgScore) + (bias[m] ?? 0);
  eligible.sort((a, b) => {
    const d = scoreOf(b) - scoreOf(a);
    if (d !== 0) return d;
    const c = statByModel.get(a)!.avgCostMc - statByModel.get(b)!.avgCostMc;
    if (c !== 0) return c;
    return (curatedIndex.get(a)! - curatedIndex.get(b)!);
  });
  return [...eligible, ...rest];
}

export interface PickCloudModelOptions {
  actionType?: ActionType;
  /** The `byAction[actionType]` slice of the resolved scope's routing blob. */
  actionStats?: ReadonlyArray<ActionModelRankStat>;
  /** Client SSM recall nudge (interactive runs only; absent/ignored headless). */
  bias?: Record<string, number>;
  minSamples?: number;
  /** Estimated tokens the first turn will send (prompt + tools). When set, models
   *  whose catalog `contextWindow` can't hold it are dropped from the FIRST-PASS seed
   *  (they remain in the cascade as failover) so a small-window model isn't SEEDED
   *  into a context it would 413 on — the 97K-into-32K bug. Composes with the SSM
   *  learned ranking: fit FIRST, then rank the fitting set. */
  estimatedTokens?: number;
  /** Gateway vendor ids the tenant can serve from their OWN connected providers
   *  (BYO). A free tenant may pin a model owned by one of these — they pay their
   *  own provider — so the free-plan "can't choose a model" gate is lifted for it. */
  byoVendors?: ReadonlySet<string>;
}

/** Headroom over the prompt estimate to reserve for the model's OUTPUT tokens +
 *  estimate error, when checking whether a context window fits. */
const CONTEXT_FIT_HEADROOM = 1.25;

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

export interface PickCloudModelResult {
  model: string;
  strict: boolean;
  /** The learned reorder of the plan-reachable coding pool (soft-seed branch only) —
   *  surfaced so the caller can explain the choice on the timeline. */
  ranked?: string[];
  /** Samples behind the chosen seed (the leading ranked model), 0 when cold/curated. */
  seedSamples?: number;
  /** True when the SSM bias map was non-empty and could affect ordering. */
  biasApplied?: boolean;
}

export function pickCloudModel(
  explicit: string | undefined,
  effectivePlan: EffectivePlan,
  premiumOverride = false,
  opts?: PickCloudModelOptions,
): PickCloudModelResult {
  // An explicit pin is honored (strict) ONLY when it PREEMPTS the connected-BYO seed
  // (shared rule — see explicitModelPreemptsByo): nothing connected, or the pin is on
  // the tenant's OWN account. A non-BYO pin while an account is connected (e.g. a
  // default agent base model of `@cf/qwen`) does NOT shadow it — the connected flagship
  // leads instead. Within the honored branch the free-plan gate still applies: a free
  // tenant may pin ONLY a model their own connected provider serves; paid / premium /
  // override may pin anything.
  const explicitIsByo = !!explicit && !!opts?.byoVendors?.has(vendorForModel(explicit.trim()));
  if (explicitModelPreemptsByo(explicit, opts?.byoVendors)) {
    const canChooseModel = premiumOverride || effectivePlan !== 'free' || explicitIsByo;
    if (canChooseModel && isKnownModel(explicit)) return { model: (explicit as string).trim(), strict: true };
  }

  // No honored explicit pin: when the tenant has connected their OWN provider(s), lead
  // with the strongest connected frontier flagship as the soft seed so an auto-select
  // cloud run uses the owner's account before the free/paid coding pool.
  // Registration-driven (byoAutoSeedModels orders the connected providers' flagships by
  // tier — a cloud run is always an agentic tool-loop, so Anthropic contributes Opus);
  // the run locks onto whatever this seed resolves on turn 1. Shared with the gateway
  // completion seed so both surfaces agree. Soft (not strict) so a transient provider
  // error still fails over.
  const byoSeed = byoAutoSeedModels(opts?.byoVendors, { agentic: true })[0];
  if (byoSeed) return { model: byoSeed, strict: false };

  // Soft-seed branch — the ONLY place learned routing changes anything. Reorder the
  // plan-reachable coding pool by the learned stats (+ optional bias) and seed the
  // leader. With no stats this is the curated order, so the seed equals
  // codingDefaultForPlan(...) — the prior behaviour. The free-plan gate is intact:
  // an explicit pick was already ignored above, and the reorder stays WITHIN the
  // plan's reachable coding pool (free tenants only ever reorder free coding models).
  const reachable = codingModelsForPlan(effectivePlan, premiumOverride);
  // Context-aware first pass: keep only models whose window fits this request, THEN
  // let the SSM learned routing rank the survivors. Small-window models stay in the
  // pool (great first pass for small tasks) but aren't seeded into an oversized one.
  const fitting = modelsFittingContext(reachable, opts?.estimatedTokens);
  const bias = opts?.bias && Object.keys(opts.bias).length > 0 ? opts.bias : undefined;
  const ranked = rankModelsForAction(fitting, opts?.actionStats, { minSamples: opts?.minSamples, bias });
  const seed = ranked[0] ?? reachable[0] ?? CODING_DEFAULT_MODEL;
  const seedSamples = opts?.actionStats?.find((s) => s.model === seed)?.n ?? 0;
  return { model: seed, strict: false, ranked, seedSamples, biasApplied: !!bias };
}

/** Free-tier proxy for IDE-internal callers (chat, dataset gen, agent inference, brain).
 *  Always uses FREE_MODEL_POOL and productName='builderforceLLM'. */
export function ideProxy(env: ProxyEnv): LlmProxyService {
  return new LlmProxyService(env, {
    modelPool: FREE_MODEL_POOL,
    preferredPoolSize: PREFERRED_POOL_SIZE,
    productName: 'builderforceLLM',
    vendorCallTimeoutMs: FREE_VENDOR_CALL_TIMEOUT_MS,
  });
}

/** Build a proxy over a specific pool (admin /status etc. — for displaying cooldowns).
 *  Use llmProxyForPlan when you have an effectivePlan. */
export function adminPoolProxy(
  env: ProxyEnv,
  modelPool: readonly string[],
  productName: ProductName,
): LlmProxyService {
  return new LlmProxyService(env, {
    modelPool,
    preferredPoolSize: Math.min(PREFERRED_POOL_SIZE, modelPool.length),
    productName,
  });
}

/**
 * Build the 503 `model_unavailable` envelope used by strict-pin dispatch
 * when the requested model can't be honoured. The reason string is exposed
 * to the caller so they can decide whether to retry on a different model or
 * surface the error directly.
 */
function strictUnavailableResult(
  model: string,
  reason: 'cooldown' | 'vendor_key_unconfigured' | 'plan_tier' | 'vendor_outage',
): ProxyResult {
  const vendor = vendorForModel(model);
  const body = JSON.stringify({
    error: `Strict-pin: model '${model}' is unavailable (${reason}).`,
    code: 'model_unavailable',
    // Top-level `vendor` + `model` so SDK consumers' per-vendor rollups pick
    // up strict-pin 503s without parsing the model id prefix. `details`
    // retains `requestedModel` for backward compat.
    vendor,
    model,
    details: { requestedModel: model, reason },
  });
  return {
    response: new Response(body, {
      status: 503,
      headers: { 'content-type': 'application/json' },
    }),
    resolvedModel: model,
    resolvedVendor: vendor,
    retries: 0,
    failovers: [],
    outcome: 'strict_unavailable',
    attempts: [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Response-format conformance — used by dispatchJson to detect non-conforming
// model output (broken JSON, missing required fields) and retry across the
// failover chain. Returns null when the response conforms (or no constraint
// was requested), or a short reason string when retry is warranted.
//
// This is a deliberately *minimal* validator. Full JSON-Schema validation
// is out of scope here — we don't want a runtime dependency. The two checks
// catch the most common failure modes:
//   1. `response_format: { type: 'json_object' }` — content doesn't parse.
//   2. `response_format: { type: 'json_schema', json_schema: { strict: true,
//      schema: { required: [...] } } }` — content parses but is missing a
//      top-level required field.
// ─────────────────────────────────────────────────────────────────────────────

function extractAssistantContent(raw: unknown): string | null {
  const choices = (raw as { choices?: Array<{ message?: { content?: unknown } }> } | null)?.choices;
  const content = choices?.[0]?.message?.content;
  return typeof content === 'string' ? content : null;
}

function checkResponseFormatConformance(body: ChatCompletionRequest, raw: unknown): string | null {
  const rf = (body as { response_format?: { type?: string; json_schema?: { strict?: boolean; schema?: unknown } } }).response_format;
  if (!rf || (rf.type !== 'json_object' && rf.type !== 'json_schema')) return null;

  const content = extractAssistantContent(raw);
  if (content === null) return null; // Tool-call assistant turns legitimately have no content.

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return 'content is not valid JSON';
  }

  // Full draft-07-subset validation when strict json_schema is requested.
  // Catches nested type / enum / required / additionalProperties violations
  // that the consumer's downstream Zod (or equivalent) would otherwise
  // bounce back as a 4xx — letting the gateway retry the chain instead.
  if (rf.type === 'json_schema' && rf.json_schema?.strict === true && rf.json_schema.schema) {
    const errs = validateJsonSchema(parsed, rf.json_schema.schema, { maxErrors: 5 });
    if (errs.length > 0) {
      const summary = errs.map((e) => `${e.path || '<root>'}: ${e.message}`).join('; ');
      return `schema mismatch (${errs.length}${errs.length >= 5 ? '+' : ''} errors): ${summary}`;
    }
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shape-driven routing — single source of truth for "which capability does
// the request need?" answers. Each capability lists models known to handle
// that capability well; reorderPoolByShape stable-sorts the configured pool
// so capable models float to the front, then everything else follows.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Models that reliably honour `tools` / `tool_choice` round-trips. Derived from
 * the curated coding pool (every coding model is tool-capable) plus a few models
 * that handle tool-use well without being coding drivers. Deriving from
 * CODING_MODEL_POOL is what keeps this set from drifting off the live catalog.
 */
const TOOL_ONLY_EXTRA_MODELS: readonly string[] = [
  'x-ai/grok-3-mini',
];
const TOOL_CAPABLE_MODELS: ReadonlySet<string> = new Set([
  ...CODING_MODEL_POOL,
  ...TOOL_ONLY_EXTRA_MODELS,
]);

/** Models that reliably emit valid JSON / honour json_schema. The coding pool
 *  doubles as the structured-output set — all of these honour json_schema. */
const STRUCTURED_OUTPUT_MODELS: ReadonlySet<string> = new Set(CODING_MODEL_POOL);

/** Models with image-input (vision) capability. */
const VISION_MODELS: ReadonlySet<string> = new Set([
  'anthropic/claude-sonnet-4.6',
  'openai/gpt-4.1',
  'google/gemini-2.5-pro',
  'nvidia/nemotron-nano-12b-v2-vl:free',
  'microsoft/phi-4-multimodal-instruct',
]);

/**
 * OCR-specialized models. Deliberately disjoint from VISION_MODELS — these
 * are tuned for text extraction, not general visual reasoning, so they should
 * only float up when the request explicitly signals OCR (via a `useCase`
 * slug containing "ocr"). On a generic vision request they stay in the pool
 * at base rank.
 */
const OCR_MODELS: ReadonlySet<string> = new Set([
  'baidu/qianfan-ocr-fast:free',
]);

/**
 * Canonical capability set for a model — the single source of truth shared by
 * the shape-router (`reorderPoolByShape`) and the public `/v1/models` surface
 * (so SDK consumers like hired.video can discover which models read images /
 * PDFs without hard-coding ids). Merges the model's catalog-declared
 * `capabilities` with the legacy literal id sets above, which still carry the
 * capability facts for OpenRouter-routed models whose catalog entries predate
 * the `capabilities` field. Output order is stable: tools, structured_output,
 * vision, ocr.
 */
export function capabilitiesForModel(model: string): AiCapability[] {
  const set = new Set<AiCapability>(catalogEntry(model)?.capabilities ?? []);
  if (TOOL_CAPABLE_MODELS.has(model)) set.add('tools');
  if (STRUCTURED_OUTPUT_MODELS.has(model)) set.add('structured_output');
  if (VISION_MODELS.has(model)) set.add('vision');
  if (OCR_MODELS.has(model)) set.add('ocr');
  return (['tools', 'structured_output', 'vision', 'ocr'] as const).filter((c) => set.has(c));
}

/**
 * Models whose constrained-decoding engine has a LOW schema-complexity ceiling —
 * the Gemini family is the canonical case ("too many states for serving"). For a
 * STRICT `json_schema` request these are de-prioritized in the cascade so a
 * higher-ceiling model (OpenAI / Anthropic / Cerebras) leads and the request
 * doesn't hit `schema_too_complex` in the first place — preventing the failure
 * rather than recovering from it via the auto-downgrade. Matched by family name
 * so it catches both `googleai/gemini-*` (direct) and `google/gemini-*`
 * (OpenRouter-routed), which share the Gemini decoder regardless of vendor.
 *
 * Deliberately narrow (Gemini only) — the authoritative per-vendor ceilings
 * belong in the model catalog (see the ROADMAP "advertise strict-schema
 * capability" item); this is the known-bad case wired into routing now.
 */
export function isLowSchemaCeilingModel(model: string): boolean {
  return /gemini/i.test(model);
}

interface ShapeFlags {
  hasTools: boolean;
  hasStructuredOutput: boolean;
  hasVision: boolean;
  hasOcr: boolean;
  /** A STRICT `json_schema` request (constrained decoding) — distinct from loose
   *  `json_object`. Drives the low-schema-ceiling de-prioritization below. */
  hasStrictSchema: boolean;
}

function inferShape(body: ChatCompletionRequest): ShapeFlags {
  const b = body as unknown as Record<string, unknown>;
  const hasTools = Array.isArray(b.tools) && (b.tools as unknown[]).length > 0;

  const rf = b.response_format as { type?: string } | undefined;
  const hasStructuredOutput = rf?.type === 'json_object' || rf?.type === 'json_schema';
  // Only `json_schema` engages constrained decoding (and its complexity ceiling);
  // `json_object` is loose and never trips `schema_too_complex`.
  const hasStrictSchema = rf?.type === 'json_schema';

  const hasVision = Array.isArray(body.messages) && body.messages.some((m) => {
    const content = (m as unknown as { content?: unknown }).content;
    return Array.isArray(content) && content.some(
      (part) => (part as { type?: string } | null)?.type === 'image_url',
    );
  });

  // OCR is signalled via `useCase` slug — the SDK's free-form telemetry tag.
  // Substring match on /ocr/i so tenant slugs like `invoice_ocr` or
  // `receipt_ocr_extract` light up the route without needing an enum.
  const useCase = typeof b.useCase === 'string' ? b.useCase : '';
  const hasOcr = /ocr/i.test(useCase);

  return { hasTools, hasStructuredOutput, hasVision, hasOcr, hasStrictSchema };
}

/**
 * Stable-sort the pool so models that match the request's required capabilities
 * come first. A model that matches every required capability ranks above one
 * that matches some, which ranks above one that matches none.
 *
 * Vision is treated as a *hard* requirement — non-vision models are filtered
 * out of the front rank and only kept as last-resort fallbacks (vendor will
 * usually error rather than silently drop the image, which is the right
 * failure mode for the cross-vendor fallback to recover from).
 */
export function reorderPoolByShape(
  body: ChatCompletionRequest,
  pool: readonly string[],
): readonly string[] {
  const shape = inferShape(body);
  if (!shape.hasTools && !shape.hasStructuredOutput && !shape.hasVision && !shape.hasOcr) {
    return pool;
  }

  // A model has a capability if it's in the legacy literal id-set (OpenRouter-
  // centric) OR its catalog entry declares it — `capabilitiesForModel` merges
  // both, so non-OpenRouter models (e.g. NVIDIA NIM vision models) are promoted
  // too, not silently excluded [1429].
  const score = (model: string): number => {
    const mc = capabilitiesForModel(model);
    let s = 0;
    if (shape.hasOcr              && mc.includes('ocr'))               s += 8;
    if (shape.hasVision           && mc.includes('vision'))            s += 4;
    if (shape.hasTools            && mc.includes('tools'))             s += 2;
    if (shape.hasStructuredOutput && mc.includes('structured_output')) s += 1;
    return s;
  };

  // Schema-ceiling tiebreaker: for a STRICT json_schema, a low-ceiling model
  // (Gemini) is de-prioritized WITHIN its capability bucket — it stays a valid
  // candidate (and the auto-downgrade still covers it) but a higher-ceiling
  // structured model leads, so a complex schema doesn't hit `too many states`.
  const lowCeilingPenalty = (model: string): number =>
    shape.hasStrictSchema && isLowSchemaCeilingModel(model) ? 1 : 0;

  // Stable sort: capability score desc, then low-ceiling last within ties,
  // then original pool order.
  return [...pool]
    .map((m, i) => ({ m, i, s: score(m), p: lowCeilingPenalty(m) }))
    .sort((a, b) => (b.s - a.s) || (a.p - b.p) || (a.i - b.i))
    .map((x) => x.m);
}

// ─────────────────────────────────────────────────────────────────────────────
// Quality-critical routing — "select the best models for this request" when the
// generated text IS the product (resume tailoring, cover letters, …). Leads with
// the highest-tier models the tenant's PLAN unlocks (premium writers for paid; a
// no-op within a free pool, whose premium floor is the funded backstop). Plan-
// respecting + catalog-driven, so it never hardcodes ids or funds premium for a
// free tenant — that boundary stays the plan's job.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `useCase` slugs that mark OUTPUT-QUALITY-CRITICAL traffic. Substring/regex match
 * on the free-form `useCase` tag (same mechanism as the OCR signal), so tenant
 * slugs like `resume_tailoring`, `cover_letter_gen`, or `proposal_draft` light up
 * without an enum. Single source so the detector can't drift across call sites.
 */
export function isQualityCriticalUseCase(useCase: string | undefined | null): boolean {
  if (!useCase) return false;
  return /resume|cover[_\s-]?letter|tailor|proposal|cv\b|headline|profile[_\s-]?summary/i.test(useCase);
}

/** Tier → quality rank (higher = better model). Drives {@link reorderPoolForQuality}. */
const QUALITY_TIER_RANK: Record<string, number> = { ULTRA: 3, PREMIUM: 2, STANDARD: 1, FREE: 0 };

/**
 * Stable-reorder a pool so the HIGHEST-tier models lead (ULTRA → PREMIUM →
 * STANDARD → FREE), used for {@link isQualityCriticalUseCase} traffic. Within-tier
 * order is preserved from the input (so the capability ordering from
 * `reorderPoolByShape` survives as the tiebreak). When `strictSchema` is set, a
 * low-schema-ceiling model (Gemini) sorts LAST within its tier — so a quality
 * premium request still prefers a high-ceiling premium writer (Claude/GPT) over
 * gemini-pro. Plan-respecting by construction: a Free pool is all FREE tier, so
 * this is a no-op there. Catalog-driven via `tierForModel`. Pure + unit-testable.
 */
export function reorderPoolForQuality(
  pool: readonly string[],
  opts?: { strictSchema?: boolean },
): readonly string[] {
  const penalty = (m: string): number =>
    opts?.strictSchema && isLowSchemaCeilingModel(m) ? 1 : 0;
  return [...pool]
    .map((m, i) => ({ m, i, r: QUALITY_TIER_RANK[tierForModel(m)] ?? 0, p: penalty(m) }))
    .sort((a, b) => (b.r - a.r) || (a.p - b.p) || (a.i - b.i))
    .map((x) => x.m);
}

/** Membership set for {@link reorderPoolForCoding} — real coding drivers, distinct
 *  from the broader {@link TOOL_CAPABLE_MODELS} (which also admits generalists that
 *  merely advertise `tools`). Derived from CODING_MODEL_POOL so it never drifts. */
const CODING_MODEL_SET: ReadonlySet<string> = new Set(CODING_MODEL_POOL);

/**
 * Stable-reorder a pool so real coding drivers (`CODING_MODEL_POOL` members) lead,
 * used for AGENTIC tool-loop traffic (a request carrying `tools`). This is the fix
 * for Brain codebase-analysis turns being served by a merely-tool-advertising
 * generalist: {@link reorderPoolByShape} floats every `tools`-capable model equally
 * (coding drivers AND weak generalists share the +2 bucket, so the original pool
 * order — which can lead with a cheap generalist — wins within it). Layering this
 * pass on top promotes the coding drivers above those generalists.
 *
 * Plan-respecting by construction: it is a pure PERMUTATION of the given pool (no
 * model is added or removed), so a Free pool only floats its own free coding models
 * — plan reachability is never escalated here. Within-coding and within-non-coding
 * order is preserved from the input, so the capability/quality ordering from the
 * upstream passes survives as the tiebreak. Pure + unit-testable.
 */
export function reorderPoolForCoding(pool: readonly string[]): readonly string[] {
  return [...pool]
    .map((m, i) => ({ m, i, c: CODING_MODEL_SET.has(m) ? 0 : 1 }))
    .sort((a, b) => (a.c - b.c) || (a.i - b.i))
    .map((x) => x.m);
}

const STANDARD_BODY_FIELDS: ReadonlySet<string> = new Set([
  'model', 'messages', 'temperature', 'max_tokens', 'top_p', 'stream',
  // Gateway-side only — stripped before vendor dispatch:
  'useCase',     // opaque telemetry slug; persisted to llm_usage_log.use_case, echoed back
  'metadata',    // free-form trace-back kv; persisted to llm_usage_log.metadata, echoed back
  'modelStrict', // strict-pin flag — gateway-only; controls failover behaviour
  'strict',      // public SDK alias for modelStrict — gateway-only; stripped here
  '_builderforce', // gateway-internal passthrough envelope (per-call vendorTimeoutMs override); consumed in dispatch(), never sent upstream
  // OpenAI-compatible pass-throughs (`tools`, `tool_choice`, `response_format`)
  // travel via the `extraBody` catch-all and reach the vendor verbatim.
]);

/** Pick out non-standard fields from the request body so they can be passed
 *  through as `extraBody` to the vendor. */
function stripStandardFields(body: ChatCompletionRequest): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(body)) {
    if (STANDARD_BODY_FIELDS.has(key)) continue;
    out[key] = (body as Record<string, unknown>)[key];
  }
  return out;
}
