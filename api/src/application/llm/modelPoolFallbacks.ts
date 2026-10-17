/**
 * Fallback chains, backstops, attempt budgets and timeouts — what the cascade
 * reaches for once the plan pool is exhausted, and how far it walks first.
 *
 * Part of the `modelPool` split (see `modelPool.ts`, the public barrel).
 */

import { autoRoutableModelsByTier } from './vendors';
import type { EffectivePlan } from '../../domain/tenant/effectivePlan';
import {
  ANTHROPIC_DIRECT_MODEL_IDS,
  CODING_MODEL_POOL,
  FREE_MODEL_POOL,
  PAID_LEAD_VENDOR,
  flagshipsOf,
  leadPoolWithVendor,
} from './modelPoolComposition';

/**
 * Premium routing pool — top PREMIUM-tier models only, used when a tenant has
 * `premium_override` set. Skips FREE and STANDARD entirely so a single attempt
 * lands on a high-quality model. Three candidates so the cascade has fallback
 * room within the extended outer budget (180s SDK / 60s per-vendor).
 *
 * Derived from `autoRoutableModelsByTier('PREMIUM')` so adding a new PREMIUM model to any
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
 *
 * This is the DISPATCH budget, not every model's: a vendor that declares
 * `attemptTimeoutMs` (frontier Claude/Gemini, the large NIM Nemotrons) raises it for
 * its own attempts — see `vendors/attemptTimeout.ts`.
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
// Credited OpenRouter safety net after the zero-priced pool is exhausted.
// Muse Glimmer is intentionally NOT in a FREE catalog tier: the live endpoint
// costs $0.35/M input and $1.50/M output, so it must remain paid-overflow only.
export const GUARANTEED_BACKSTOP_MODEL = 'meta/muse-glimmer-30b';

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
 * the Anthropic flagships (Sonnet, then Opus) call Claude DIRECTLY on CLAUDE_API_KEY
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
  ...flagshipsOf('openrouter', 'agentic'),       // strongest agentic coder (via OpenRouter)
  // Direct-Anthropic last-resort floor (CLAUDE_API_KEY): the chat flagship (Sonnet,
  // cheaper) before the agentic one (Opus).
  ...flagshipsOf('anthropic', 'chat', 'agentic'),
], PAID_LEAD_VENDOR);

/**
 * Coding-capable backstop chain — the reliability floor for a *coding* run,
 * dispatched on the credited key after the primary coding cascade fails.
 *
 * `GUARANTEED_BACKSTOP_MODEL` (Muse Glimmer 30B) is a general agentic model,
 * but it is not part of the curated coding pool. Flooring a coding run onto a
 * non-coder means the run flails and gives up without writing code (observed in
 * execution #59), so the coding floor is *coders only* — no general backstop
 * tail. If every paid coder is also down the run surfaces `cascade_exhausted`
 * rather than silently degrading onto a non-coder, because an honest failure
 * beats a coding agent that loops on search and ships nothing.
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
 * coders (`xiaomi/mimo-v2.5`, `anthropic/claude-sonnet-5`) are Pro plan-pool
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
  // Direct-Anthropic floor — unlike `anthropic/claude-sonnet-5` (a Pro plan-pool
  // model whose normal use must NOT be metered as overflow), these bare-id direct
  // models live in NO plan pool: any resolution onto them is Builderforce funding a
  // call on its own CLAUDE_API_KEY, so they are overflow spend by id on every path
  // (primary appended-fallback OR credited backstop) and count against the cap.
  // Superseded-but-catalogued ids included: a run that resolves onto one is still
  // Builderforce funding its own key.
  ...ANTHROPIC_DIRECT_MODEL_IDS,
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
