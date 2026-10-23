/**
 * Where one turn's input tokens went — the context-by-category breakdown A1 stamps on
 * each usage row (`metadata.context`) so A4 can say WHICH part of a prompt grew.
 *
 * Categories, all ESTIMATES (chars/4 via the shared workload estimator — the loop never
 * sees the provider's tokenizer; the provider-reported `prompt_tokens` stays the billed
 * truth):
 *   • system       system-role messages (instructions, injected briefs)
 *   • tools        the serialized tool schemas advertised on the call
 *   • history      user + assistant turns (assistant tool-call arguments included)
 *   • toolOutputs  tool-role messages — what tool results cost to carry forward
 *   • memory       recall the caller says it injected. A SUBSET of system/history,
 *                  reported beside them, never added to them.
 *
 * Pure: no env, no I/O.
 */
import { estimateTokensFromChars } from '@builderforce/workload';

/** The metadata key the breakdown rides under on `llm_usage_log.metadata`. */
export const CONTEXT_CATEGORIES_KEY = 'context';

export interface ContextCategoryTokens {
  system: number;
  tools: number;
  history: number;
  toolOutputs: number;
  memory: number;
  /** Always true — every figure here is a character estimate. */
  estimated: true;
}

export interface TurnInput {
  messages: readonly unknown[];
  tools?: readonly unknown[] | null;
  /** Tokens of recall the caller injected into this turn's prompt, when it knows. */
  memoryTokens?: number | null;
}

const charsOf = (v: unknown): number => {
  if (v == null) return 0;
  if (typeof v === 'string') return v.length;
  try { return JSON.stringify(v)?.length ?? 0; } catch { return 0; }
};

/** Estimated tokens the advertised tool schemas cost on one call. 0 for none. */
export function toolSchemaTokens(tools: readonly unknown[] | null | undefined): number {
  return tools && tools.length > 0 ? estimateTokensFromChars(charsOf(tools)) : 0;
}

/** Split one turn's input into the A1 categories. */
export function contextCategoryTokens(input: TurnInput): ContextCategoryTokens {
  let system = 0;
  let history = 0;
  let toolOutputs = 0;
  for (const m of input.messages) {
    const msg = (m ?? {}) as { role?: unknown; content?: unknown; tool_calls?: unknown };
    const chars = charsOf(msg.content) + charsOf(msg.tool_calls);
    if (msg.role === 'system') system += chars;
    else if (msg.role === 'tool') toolOutputs += chars;
    else history += chars;
  }
  const memory = Number.isFinite(input.memoryTokens) && (input.memoryTokens as number) > 0
    ? Math.round(input.memoryTokens as number) : 0;
  return {
    system: estimateTokensFromChars(system),
    tools: toolSchemaTokens(input.tools),
    history: estimateTokensFromChars(history),
    toolOutputs: estimateTokensFromChars(toolOutputs),
    memory,
    estimated: true,
  };
}
