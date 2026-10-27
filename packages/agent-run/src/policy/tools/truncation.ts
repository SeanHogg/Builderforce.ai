/**
 * truncation — the window-sized result cap applied to a tool result's text, ported
 * from `agent-runtime/src/agents/embedded-runner/tool-result-truncation.ts`.
 *
 * The budget and the cut are THE shared tool-output policy (`@builderforce/tool-output-policy`,
 * PRD C7): 30% of the context window (~4 chars per token), a hard cap, a floor, cut at a
 * line boundary. This module is the pure, session-free core the on-prem persistence
 * guard and the in-memory pre-send guard both use; the session-file walk and the
 * cost-lever log summarizer stay in the adapters (the lever hook is injected, never
 * imported, so this stays worker-/browser-safe).
 *
 * No `node:*` imports, no DOM: this file is compiled into the Worker, the browser
 * and Node.
 */

import {
  DEFAULT_TRUNCATION_SUFFIX,
  HARD_MAX_TOOL_RESULT_CHARS,
  MIN_KEEP_CHARS,
  cutHead,
  fitToolText,
  windowToolResultCap,
} from "@builderforce/tool-output-policy";

export { HARD_MAX_TOOL_RESULT_CHARS };

/** One text block of a tool result message. */
export interface TextBlock {
  type: "text";
  text: string;
  [key: string]: unknown;
}

/** The minimal shape of a tool-result message this module operates on. */
export interface ToolResultMessage {
  role?: string;
  content?: unknown;
  [key: string]: unknown;
}

/** How a shell/test/build log is summarized when the C7 lever is on. */
export interface TruncateHooks {
  /** Return true to summarize log-like text instead of head-cutting it. */
  summarize?: (text: string) => boolean;
}

/**
 * Truncate a single text string to fit within maxChars, preserving the beginning — or,
 * when the summarize hook fires, summarizing it. `suffix` is the notice a head cut ends
 * with. THE line-snapped head cut comes from the shared `cutHead`.
 */
export function truncateToolResultText(
  text: string,
  maxChars: number,
  suffix: string = DEFAULT_TRUNCATION_SUFFIX,
  hooks: TruncateHooks = {},
): string {
  return fitToolText(text, maxChars, {
    summarize: hooks.summarize?.(text) ?? false,
    fallback: (t, max) => cutHead(t, max, { suffix, minKeep: MIN_KEEP_CHARS }),
  });
}

/** The max chars a single tool result may take, from the model's context window. */
export function calculateMaxToolResultChars(contextWindowTokens: number): number {
  return windowToolResultCap(contextWindowTokens);
}

function isTextBlock(block: unknown): block is TextBlock {
  return !!block && typeof block === "object" && (block as { type?: unknown }).type === "text";
}

/** Total length of the text blocks in a tool-result message. */
export function toolResultTextLength(msg: ToolResultMessage): number {
  if (!msg || msg.role !== "toolResult") return 0;
  const content = msg.content;
  if (!Array.isArray(content)) return 0;
  let total = 0;
  for (const block of content) {
    if (isTextBlock(block) && typeof block.text === "string") total += block.text.length;
  }
  return total;
}

/**
 * Truncate a tool-result message's text blocks to fit within maxChars, each block given
 * its proportional share of the budget (never below the policy floor). Returns a NEW
 * message — the original is not mutated. THE message-level cut.
 */
export function truncateToolResultMessage(
  msg: ToolResultMessage,
  maxChars: number,
  opts: { suffix?: string; hooks?: TruncateHooks } = {},
): ToolResultMessage {
  const content = msg.content;
  if (!Array.isArray(content)) return msg;

  const totalTextChars = toolResultTextLength(msg);
  if (totalTextChars <= maxChars) return msg;

  const newContent = content.map((block: unknown) => {
    if (!isTextBlock(block) || typeof block.text !== "string") return block;
    const blockShare = block.text.length / totalTextChars;
    const blockBudget = Math.max(MIN_KEEP_CHARS, Math.floor(maxChars * blockShare));
    return { ...block, text: truncateToolResultText(block.text, blockBudget, opts.suffix, opts.hooks) };
  });

  return { ...msg, content: newContent };
}

/**
 * Truncate oversized tool results in an array of messages (in-memory). Returns a NEW
 * array. Used as a pre-send guard before handing messages to the model.
 */
export function truncateOversizedToolResultsInMessages(
  messages: ToolResultMessage[],
  contextWindowTokens: number,
  opts: { hooks?: TruncateHooks } = {},
): { messages: ToolResultMessage[]; truncatedCount: number } {
  const maxChars = calculateMaxToolResultChars(contextWindowTokens);
  let truncatedCount = 0;
  const result = messages.map((msg) => {
    if (msg.role !== "toolResult") return msg;
    if (toolResultTextLength(msg) <= maxChars) return msg;
    truncatedCount += 1;
    return truncateToolResultMessage(msg, maxChars, { hooks: opts.hooks });
  });
  return { messages: result, truncatedCount };
}

/** True when a tool-result message exceeds the size limit for a context window. */
export function isOversizedToolResult(msg: ToolResultMessage, contextWindowTokens: number): boolean {
  if (msg.role !== "toolResult") return false;
  return toolResultTextLength(msg) > calculateMaxToolResultChars(contextWindowTokens);
}

/**
 * Estimate whether the session likely has oversized tool results that caused a context
 * overflow — the heuristic that decides whether to attempt truncation before giving up.
 */
export function sessionLikelyHasOversizedToolResults(params: {
  messages: ToolResultMessage[];
  contextWindowTokens: number;
}): boolean {
  const maxChars = calculateMaxToolResultChars(params.contextWindowTokens);
  for (const msg of params.messages) {
    if (msg.role !== "toolResult") continue;
    if (toolResultTextLength(msg) > maxChars) return true;
  }
  return false;
}
