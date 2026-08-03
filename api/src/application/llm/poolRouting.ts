/**
 * Pool routing — shape-driven, quality-critical and coding reordering.
 *
 * Carved out of LlmProxyService for the same reason as `responseFormat`: this is
 * "given a request, which order should the model pool be tried in?", and it answers
 * that from static capability tables plus the caller's plan. It reads the pool
 * constants but touches none of the service's state, so it was only ever colocated
 * by history.
 *
 * `LlmProxyService` re-exports everything here, so no caller changed.
 */

import type { ChatCompletionRequest } from './LlmProxyService';
import { CODING_MODEL_POOL, CODING_DEFAULT_MODEL, RECOGNIZED_CODER_MODELS } from './modelPool';
import { catalogEntry, tierForModel, type AiCapability } from './vendors';

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
  ...RECOGNIZED_CODER_MODELS,
  ...TOOL_ONLY_EXTRA_MODELS,
]);

/** Models that reliably emit valid JSON / honour json_schema. The recognised-coder set
 *  doubles as the structured-output set — all of these honour json_schema (including the
 *  BYO frontier flagships that route on a tenant's own key). */
const STRUCTURED_OUTPUT_MODELS: ReadonlySet<string> = RECOGNIZED_CODER_MODELS;

/** Models with image-input (vision) capability. */
const VISION_MODELS: ReadonlySet<string> = new Set([
  'anthropic/claude-sonnet-5',
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

export function inferShape(body: ChatCompletionRequest): ShapeFlags {
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
 *  merely advertise `tools`). The recognised-coder superset (auto-route pool + BYO
 *  frontier flagships); reorder only ever sees plan-pool ids, so the BYO additions are
 *  inert here — they just keep "is a real coder" consistent across the module. */
const CODING_MODEL_SET: ReadonlySet<string> = RECOGNIZED_CODER_MODELS;

/**
 * Cheap "flash"-class coders that must NOT LEAD an agentic tool-loop when a stronger
 * coder is reachable. These are members of {@link CODING_MODEL_POOL} (so they remain
 * valid, catalog-backed coders and are NEVER removed — the {@link reorderPoolForCoding}
 * "pure permutation" + never-empty invariants hold), but a long multi-turn Brain
 * codebase-analysis loop served by one of them tends toward context exhaustion /
 * non-convergence (the chat #50 "LOOP EXHAUSTED" failure, where auto-select drove the
 * loop on deepseek-v4-flash / minimax-m2.7). The floor SOFT-demotes them behind the
 * real coding drivers so a strong coder leads whenever the plan pool has one; a
 * degenerate pool whose only coders are these still reaches them (last-resort), so a
 * Free tenant is never left without a coder.
 *
 * Curated by id, NOT a `/flash/` regex — the strong big-window `@cf/zai-org/glm-4.7-flash`
 * coder (the Pro coding default) is deliberately NOT here and keeps leading. This only
 * reorders the AGENTIC auto-select path; an explicit strict pin of one of these models
 * bypasses reordering entirely (see the wantsStrict branch in `complete`), and the
 * cloud-loop default (`CODING_DEFAULT_MODEL`) and free-budget count are untouched
 * because this is a permutation, not a pool edit.
 */
export const WEAK_FLASH_CODERS: ReadonlySet<string> = new Set<string>([
  'deepseek/deepseek-v4-flash',                // "fast cheap coder" — cheapest paid coder
  'minimaxai/minimax-m2.7',                    // free default, but flash-class on long loops
  'minimax/minimax-m2.5:free',                 // prior-gen MiniMax free failover
  '@cf/qwen/qwen3-30b-a3b-fp8',                // self-labelled "small/fast; first pass for SMALL tasks"
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast',  // self-labelled "small/fast; first pass for SMALL tasks"
]);

/** Coding-lead rank for {@link reorderPoolForCoding}: strong coding driver (0) leads a
 *  weak-flash coder (1), which still leads a non-coding generalist (2). A weak-flash
 *  CODER stays ahead of a mere tools-advertising generalist — it is still a real coder,
 *  just not one that should front a long agentic loop when a stronger coder exists. */
function codingLeadRank(m: string): 0 | 1 | 2 {
  if (!CODING_MODEL_SET.has(m)) return 2;
  return WEAK_FLASH_CODERS.has(m) ? 1 : 0;
}

/**
 * Stable-reorder a pool so real coding drivers (`CODING_MODEL_POOL` members) lead,
 * used for AGENTIC tool-loop traffic (a request carrying `tools`). This is the fix
 * for Brain codebase-analysis turns being served by a merely-tool-advertising
 * generalist: {@link reorderPoolByShape} floats every `tools`-capable model equally
 * (coding drivers AND weak generalists share the +2 bucket, so the original pool
 * order — which can lead with a cheap generalist — wins within it). Layering this
 * pass on top promotes the coding drivers above those generalists.
 *
 * Within the coding drivers it applies the {@link WEAK_FLASH_CODERS} floor: a strong
 * coder leads a cheap flash coder, so an agentic loop never auto-selects a flash model
 * while a stronger coder is reachable (the chat #50 regression). Weak-flash coders are
 * demoted, NOT removed, so a pool whose only coders are flash still reaches them.
 *
 * Plan-respecting by construction: it is a pure PERMUTATION of the given pool (no
 * model is added or removed), so a Free pool only floats its own free coding models
 * — plan reachability is never escalated here. Within each rank order is preserved
 * from the input, so the capability/quality ordering from the upstream passes survives
 * as the tiebreak. Pure + unit-testable.
 */
export function reorderPoolForCoding(pool: readonly string[]): readonly string[] {
  return [...pool]
    .map((m, i) => ({ m, i, c: codingLeadRank(m) }))
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
  'routingMode', // interactive auto vs ordered-BYO-pool choice — gateway-only
  '_builderforce', // gateway-internal passthrough envelope (per-call vendorTimeoutMs override); consumed in dispatch(), never sent upstream
  'reasoning',   // vendor-neutral client reasoning intent ({ level }); consumed in dispatch() via
                 // reasoningCapability and translated to the per-family vendor param. Listed here so
                 // the raw client value can NEVER reach a vendor as an unvalidated passthrough.
  // OpenAI-compatible pass-throughs (`tools`, `tool_choice`, `response_format`)
  // travel via the `extraBody` catch-all and reach the vendor verbatim.
  //
  // Reasoning levers (`reasoning_effort` for OpenAI o-series/gpt-5, `thinking` for
  // direct-Anthropic `claude-*`) are DELIBERATELY not listed here: they are
  // non-standard, so `stripStandardFields` routes them through `extraBody` to the
  // vendor untouched. That is safe because their ONLY producer is
  // `reasoningCapability.reasoningParamsForModel`, which emits them exclusively for
  // model families known to accept them — the OpenAI-compatible factory spreads
  // `extraBody` into the body (so `reasoning_effort` lands), and `vendors/anthropic.ts`
  // consumes `extraBody.thinking`. A generic coder never receives either key.
]);

/** Pick out non-standard fields from the request body so they can be passed
 *  through as `extraBody` to the vendor. */
export function stripStandardFields(body: ChatCompletionRequest): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(body)) {
    if (STANDARD_BODY_FIELDS.has(key)) continue;
    out[key] = (body as Record<string, unknown>)[key];
  }
  return out;
}
