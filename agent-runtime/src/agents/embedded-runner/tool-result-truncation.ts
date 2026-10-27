import type { AgentMessage } from "../../builderforce/model/agent-types.js";
import type { TextContent } from "../../builderforce/model/types.js";
import { SessionManager } from "../../builderforce/agent-loop/index.js";
import { log } from "./logger.js";
import { onDeviceCostLeverOn } from "../../infra/cost-levers.js";
import {
  DEFAULT_TRUNCATION_SUFFIX,
  HARD_MAX_TOOL_RESULT_CHARS,
  MIN_KEEP_CHARS,
  cutHead,
  fitToolText,
  windowToolResultCap,
} from "@builderforce/tool-output-policy";

/**
 * The budgets and the cut are THE shared tool-output policy
 * (`@builderforce/tool-output-policy`, PRD C7): 30% of the context window (~4 chars per
 * token), a 400K hard cap, a 2K floor, cut at a line boundary. With the C7 lever on, a
 * shell/test/build log is summarized (failing tests, error lines, assertion diffs, the
 * tail) instead of head-cut, so the verdict at the end of a long run is never the part
 * that is dropped.
 */
export { HARD_MAX_TOOL_RESULT_CHARS };

/** The C7 lever for an on-device host (bucketed by the install id). */
function summarizeLogs(): boolean {
  return onDeviceCostLeverOn("c7_tool_output_policy");
}

/**
 * Truncate a single text string to fit within maxChars, preserving the beginning — or,
 * with the C7 lever on, summarizing it when it reads as a shell/test/build log.
 * `suffix` is the notice a head cut ends with (the persistence guard says so in its own words).
 */
export function truncateToolResultText(
  text: string,
  maxChars: number,
  suffix: string = DEFAULT_TRUNCATION_SUFFIX,
): string {
  return fitToolText(text, maxChars, {
    summarize: summarizeLogs(),
    fallback: (t, max) => cutHead(t, max, { suffix, minKeep: MIN_KEEP_CHARS }),
  });
}

/**
 * Calculate the maximum allowed characters for a single tool result
 * based on the model's context window tokens.
 */
export function calculateMaxToolResultChars(contextWindowTokens: number): number {
  return windowToolResultCap(contextWindowTokens);
}

/**
 * Get the total character count of text content blocks in a tool result message.
 */
function getToolResultTextLength(msg: AgentMessage): number {
  if (!msg || (msg as { role?: string }).role !== "toolResult") {
    return 0;
  }
  const content = (msg as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return 0;
  }
  let totalLength = 0;
  for (const block of content) {
    if (block && typeof block === "object" && (block as { type?: string }).type === "text") {
      const text = (block as TextContent).text;
      if (typeof text === "string") {
        totalLength += text.length;
      }
    }
  }
  return totalLength;
}

/**
 * Truncate a tool result message's text content blocks to fit within maxChars, each
 * block given its proportional share of the budget (never below the policy floor).
 * Returns a new message (does not mutate the original). THE message-level cut: the
 * context-overflow recovery below and the persistence guard
 * (`session-tool-result-guard.ts`) both use it.
 */
export function truncateToolResultMessage(
  msg: AgentMessage,
  maxChars: number,
  opts: { suffix?: string } = {},
): AgentMessage {
  const content = (msg as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return msg;
  }

  // Calculate total text size
  const totalTextChars = getToolResultTextLength(msg);
  if (totalTextChars <= maxChars) {
    return msg;
  }

  // Distribute the budget proportionally among text blocks
  const newContent = content.map((block: unknown) => {
    if (!block || typeof block !== "object" || (block as { type?: string }).type !== "text") {
      return block; // Keep non-text blocks (images) as-is
    }
    const textBlock = block as TextContent;
    if (typeof textBlock.text !== "string") {
      return block;
    }
    // Proportional budget for this block
    const blockShare = textBlock.text.length / totalTextChars;
    const blockBudget = Math.max(MIN_KEEP_CHARS, Math.floor(maxChars * blockShare));
    return {
      ...textBlock,
      text: truncateToolResultText(textBlock.text, blockBudget, opts.suffix),
    };
  });

  return { ...msg, content: newContent } as AgentMessage;
}

/**
 * Find oversized tool result entries in a session and truncate them.
 *
 * This operates on the session file by:
 * 1. Opening the session manager
 * 2. Walking the current branch to find oversized tool results
 * 3. Branching from before the first oversized tool result
 * 4. Re-appending all entries from that point with truncated tool results
 *
 * @returns Object indicating whether any truncation was performed
 */
export async function truncateOversizedToolResultsInSession(params: {
  sessionFile: string;
  contextWindowTokens: number;
  sessionId?: string;
  sessionKey?: string;
}): Promise<{ truncated: boolean; truncatedCount: number; reason?: string }> {
  const { sessionFile, contextWindowTokens } = params;
  const maxChars = calculateMaxToolResultChars(contextWindowTokens);

  try {
    const sessionManager = SessionManager.open(sessionFile);
    const branch = sessionManager.getBranch();

    if (branch.length === 0) {
      return { truncated: false, truncatedCount: 0, reason: "empty session" };
    }

    // Find oversized tool result entries and their indices in the branch
    const oversizedIndices: number[] = [];
    for (let i = 0; i < branch.length; i++) {
      const entry = branch[i];
      if (entry.type !== "message") {
        continue;
      }
      const msg = entry.message;
      if ((msg as { role?: string }).role !== "toolResult") {
        continue;
      }
      const textLength = getToolResultTextLength(msg);
      if (textLength > maxChars) {
        oversizedIndices.push(i);
        log.info(
          `[tool-result-truncation] Found oversized tool result: ` +
            `entry=${entry.id} chars=${textLength} maxChars=${maxChars} ` +
            `sessionKey=${params.sessionKey ?? params.sessionId ?? "unknown"}`,
        );
      }
    }

    if (oversizedIndices.length === 0) {
      return { truncated: false, truncatedCount: 0, reason: "no oversized tool results" };
    }

    // Branch from the parent of the first oversized entry
    const firstOversizedIdx = oversizedIndices[0];
    const firstOversizedEntry = branch[firstOversizedIdx];
    const branchFromId = firstOversizedEntry.parentId;

    if (!branchFromId) {
      // The oversized entry is the root - very unusual but handle it
      sessionManager.resetLeaf();
    } else {
      sessionManager.branch(branchFromId);
    }

    // Re-append all entries from the first oversized one onwards,
    // with truncated tool results
    const oversizedSet = new Set(oversizedIndices);
    let truncatedCount = 0;

    for (let i = firstOversizedIdx; i < branch.length; i++) {
      const entry = branch[i];

      if (entry.type === "message") {
        let message = entry.message;

        if (oversizedSet.has(i)) {
          message = truncateToolResultMessage(message, maxChars);
          truncatedCount++;
          const newLength = getToolResultTextLength(message);
          log.info(
            `[tool-result-truncation] Truncated tool result: ` +
              `originalEntry=${entry.id} newChars=${newLength} ` +
              `sessionKey=${params.sessionKey ?? params.sessionId ?? "unknown"}`,
          );
        }

        // appendMessage expects Message | CustomMessage | BashExecutionMessage
        sessionManager.appendMessage(message as Parameters<typeof sessionManager.appendMessage>[0]);
      } else if (entry.type === "compaction") {
        sessionManager.appendCompaction(
          entry.summary,
          entry.firstKeptEntryId,
          entry.tokensBefore,
          entry.details,
          entry.fromHook,
        );
      } else if (entry.type === "thinking_level_change") {
        sessionManager.appendThinkingLevelChange(entry.thinkingLevel);
      } else if (entry.type === "model_change") {
        sessionManager.appendModelChange(entry.provider, entry.modelId);
      } else if (entry.type === "custom") {
        sessionManager.appendCustomEntry(entry.customType, entry.data);
      } else if (entry.type === "custom_message") {
        sessionManager.appendCustomMessageEntry(
          entry.customType,
          entry.content,
          entry.display,
          entry.details,
        );
      } else if (entry.type === "branch_summary") {
        // Branch summaries reference specific entry IDs - skip to avoid inconsistency
        continue;
      } else if (entry.type === "label") {
        // Labels reference specific entry IDs - skip to avoid inconsistency
        continue;
      } else if (entry.type === "session_info") {
        if (entry.name) {
          sessionManager.appendSessionInfo(entry.name);
        }
      }
    }

    log.info(
      `[tool-result-truncation] Truncated ${truncatedCount} tool result(s) in session ` +
        `(contextWindow=${contextWindowTokens} maxChars=${maxChars}) ` +
        `sessionKey=${params.sessionKey ?? params.sessionId ?? "unknown"}`,
    );

    return { truncated: true, truncatedCount };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    log.warn(`[tool-result-truncation] Failed to truncate: ${errMsg}`);
    return { truncated: false, truncatedCount: 0, reason: errMsg };
  }
}

/**
 * Truncate oversized tool results in an array of messages (in-memory).
 * Returns a new array with truncated messages.
 *
 * This is used as a pre-emptive guard before sending messages to the LLM,
 * without modifying the session file.
 */
export function truncateOversizedToolResultsInMessages(
  messages: AgentMessage[],
  contextWindowTokens: number,
): { messages: AgentMessage[]; truncatedCount: number } {
  const maxChars = calculateMaxToolResultChars(contextWindowTokens);
  let truncatedCount = 0;

  const result = messages.map((msg) => {
    if ((msg as { role?: string }).role !== "toolResult") {
      return msg;
    }
    const textLength = getToolResultTextLength(msg);
    if (textLength <= maxChars) {
      return msg;
    }
    truncatedCount++;
    return truncateToolResultMessage(msg, maxChars);
  });

  return { messages: result, truncatedCount };
}

/**
 * Check if a tool result message exceeds the size limit for a given context window.
 */
export function isOversizedToolResult(msg: AgentMessage, contextWindowTokens: number): boolean {
  if ((msg as { role?: string }).role !== "toolResult") {
    return false;
  }
  const maxChars = calculateMaxToolResultChars(contextWindowTokens);
  return getToolResultTextLength(msg) > maxChars;
}

/**
 * Estimate whether the session likely has oversized tool results that caused
 * a context overflow. Used as a heuristic to decide whether to attempt
 * tool result truncation before giving up.
 */
export function sessionLikelyHasOversizedToolResults(params: {
  messages: AgentMessage[];
  contextWindowTokens: number;
}): boolean {
  const { messages, contextWindowTokens } = params;
  const maxChars = calculateMaxToolResultChars(contextWindowTokens);

  for (const msg of messages) {
    if ((msg as { role?: string }).role !== "toolResult") {
      continue;
    }
    const textLength = getToolResultTextLength(msg);
    if (textLength > maxChars) {
      return true;
    }
  }

  return false;
}
