/**
 * Per-model reasoning-capability registry.
 *
 * The persona/psychometric compiler ({@link compilePsychometricProfile}) emits
 * execution levers — `thinkLevel` / `reasoningLevel` / `temperature` — that should
 * change how an agent *reasons*, not just its prompt text. `temperature` is a
 * universal vendor param, but the reasoning levers are NOT: the correct vendor
 * field differs per model family, and a blanket `reasoning_effort` (or Anthropic
 * `thinking`) sent to a strict OpenAI-compatible coder that doesn't understand it
 * 400s the whole run.
 *
 * This module is the SINGLE, conservative mapping from a model id + desired
 * `AgentExecParams` to the CORRECT vendor param, emitted ONLY for model families
 * KNOWN to support it. Everything unrecognised returns `undefined` (drop the lever
 * rather than risk a 400) — so wiring this into a vendor call is always safe: an
 * empty registry result means "no change", keeping the V2 cloud loop byte-identical
 * when no persona/exec params are present.
 *
 * Detection is deliberately conservative and grounded in THIS gateway's model-id
 * conventions (see `CODING_MODEL_POOL` in LlmProxyService):
 *
 *   • Anthropic extended thinking — bare `claude-*` ids ONLY. Those dispatch to the
 *     direct Anthropic Messages vendor (`vendors/anthropic.ts`), the one path whose
 *     translator we wire the `thinking` param through. OpenRouter-routed
 *     `anthropic/claude-*` slugs speak the OpenAI shape and don't accept Anthropic's
 *     `thinking` param, so they are NOT matched (dropped).
 *
 *   • OpenAI reasoning — the o-series (o1/o3/o4…) and gpt-5* families, with or
 *     without an `openai/` (OpenRouter) prefix. Both the native OpenAI param and
 *     OpenRouter forward `reasoning_effort`. Non-reasoning OpenAI models (gpt-4.1 /
 *     gpt-4o) are deliberately excluded.
 *
 *   • Everything else (generic OpenAI-compatible coders, Cloudflare `@cf/*`,
 *     deepseek, qwen, minimax, …) → `undefined`.
 *
 * Pure and dependency-light (only the shared exec-param type), so it is unit-tested
 * without a live vendor.
 */
import type { AgentExecParams, AgentThinkLevel } from '@builderforce/agent-tools';

/** Which reasoning param, if any, a model family accepts. */
export type ModelReasoningSupport =
  /** Direct Anthropic Messages vendor — native extended `thinking`. */
  | { kind: 'anthropic-thinking' }
  /** OpenAI o-series / gpt-5 — `reasoning_effort`. */
  | { kind: 'openai-reasoning' }
  /** Unknown/unsupported family — no reasoning param is safe to send. */
  | { kind: 'none' };

// Bare `claude-*` ids only (the direct Anthropic Messages vendor). `anthropic/…`
// (OpenRouter) and colon registry forms are intentionally excluded — see file docs.
const ANTHROPIC_THINKING_RE = /^claude-/i;

// OpenAI reasoning families, with an optional `openai/` (OpenRouter) prefix:
//   o1 | o3 | o4 | o4-mini | o3-mini | gpt-5 | gpt-5-mini | gpt-5-codex …
// `gpt-4.1` / `gpt-4o` (non-reasoning) do NOT match.
const OPENAI_REASONING_RE = /^(?:openai\/)?(?:o[1-9](?:-|$)|gpt-5)/i;

/**
 * Classify a model id into its reasoning-capability family. Pure string inspection;
 * returns `{ kind: 'none' }` for an empty/unknown id so callers can switch safely.
 */
export function detectReasoningSupport(modelId: string | undefined | null): ModelReasoningSupport {
  const id = (modelId ?? '').trim();
  if (!id) return { kind: 'none' };
  if (ANTHROPIC_THINKING_RE.test(id)) return { kind: 'anthropic-thinking' };
  if (OPENAI_REASONING_RE.test(id)) return { kind: 'openai-reasoning' };
  return { kind: 'none' };
}

/** Anthropic extended-thinking token budget per think level. Scales with intensity;
 *  `medium` is the default when only `reasoningLevel: 'on'` asked (no explicit level). */
const THINK_BUDGET_TOKENS: Record<AgentThinkLevel, number> = {
  off: 0,
  minimal: 2048,
  low: 2048,
  medium: 8192,
  high: 16384,
  xhigh: 16384,
};

/** OpenAI `reasoning_effort` per think level. */
const REASONING_EFFORT: Record<AgentThinkLevel, 'low' | 'medium' | 'high'> = {
  off: 'low',
  minimal: 'low',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'high',
};

/** Did the persona ask for reasoning via the on/stream reasoning switch? */
function reasoningSwitchedOn(execParams: AgentExecParams): boolean {
  return execParams.reasoningLevel === 'on' || execParams.reasoningLevel === 'stream';
}

/**
 * Anthropic extended thinking is comparatively expensive, so it is gated tighter:
 * only when the think level is `high`/`xhigh` OR reasoning is explicitly switched on.
 */
function anthropicThinkingParams(execParams: AgentExecParams): Record<string, unknown> | undefined {
  const level = execParams.thinkLevel;
  const wants = level === 'high' || level === 'xhigh' || reasoningSwitchedOn(execParams);
  if (!wants) return undefined;
  const budget = level && level !== 'off' ? THINK_BUDGET_TOKENS[level] : THINK_BUDGET_TOKENS.medium;
  return { thinking: { type: 'enabled', budget_tokens: budget } };
}

/**
 * OpenAI `reasoning_effort` follows the full think-level ladder — emitted whenever a
 * meaningful level is set (low+) or reasoning is switched on. `off`/absent → dropped.
 */
function openaiReasoningParams(execParams: AgentExecParams): Record<string, unknown> | undefined {
  const level = execParams.thinkLevel;
  const active = (!!level && level !== 'off') || reasoningSwitchedOn(execParams);
  if (!active) return undefined;
  const effort = level && level !== 'off' ? REASONING_EFFORT[level] : 'medium';
  return { reasoning_effort: effort };
}

/** Per-call hints that refine the reasoning param beyond the model + exec levers. */
export interface ReasoningParamOpts {
  /** True when this is the FIRST (planning) turn of a tool loop — the request carries
   *  no prior assistant/thinking turn. ONLY meaningful for the direct-Anthropic
   *  `thinking` path: it is threaded to `vendors/anthropic.ts` as a `firstTurn` hint so
   *  the vendor can safely enable extended thinking on that planning turn even though
   *  tools are present (a continuation turn, whose thinking block was lost in the
   *  OpenAI round-trip, would 400 — so thinking stays off there). Ignored by the OpenAI
   *  `reasoning_effort` path (valid on every turn). Because the hint only rides the
   *  anthropic branch, it never reaches an OpenAI-compatible vendor. */
  isFirstTurn?: boolean;
}

/**
 * Map a model id + desired execution levers to the CORRECT vendor reasoning param,
 * or `undefined` when the model family is unknown OR the levers don't ask for
 * reasoning. The returned object is spread verbatim into the gateway request body;
 * it survives to the vendor as `extraBody` (non-standard fields pass through
 * {@link stripStandardFields}), where the anthropic / OpenAI-compatible translators
 * consume it. Returning `undefined` (the common case with no persona) leaves the
 * request unchanged.
 */
export function reasoningParamsForModel(
  modelId: string | undefined | null,
  execParams: AgentExecParams | undefined,
  opts?: ReasoningParamOpts,
): Record<string, unknown> | undefined {
  if (!execParams) return undefined;
  switch (detectReasoningSupport(modelId).kind) {
    case 'anthropic-thinking': {
      const params = anthropicThinkingParams(execParams);
      if (!params) return undefined;
      // Thread the first-turn hint to vendors/anthropic.ts. It rides ONLY this
      // (anthropic) branch, so it can never leak to an OpenAI-compatible vendor.
      return opts?.isFirstTurn != null ? { ...params, firstTurn: opts.isFirstTurn } : params;
    }
    case 'openai-reasoning':
      return openaiReasoningParams(execParams);
    default:
      return undefined;
  }
}
