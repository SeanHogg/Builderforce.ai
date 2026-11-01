import type { AgentMessage } from "../../builderforce/model/agent-types.js";
import { SessionManager } from "../../builderforce/agent-loop/index.js";
import { log } from "./logger.js";
import { onDeviceCostLeverOn } from "../../infra/cost-levers.js";
import {
  calculateMaxToolResultChars,
  toolResultTextLength,
  truncateOversizedToolResultsInMessages as capMessages,
  truncateToolResultMessage as capMessage,
  truncateToolResultText as capText,
  type TruncateHooks,
} from "@builderforce/agent-run";
import { DEFAULT_TRUNCATION_SUFFIX } from "@builderforce/tool-output-policy";

/**
 * The on-prem face of the window-sized tool-result cut.
 *
 * The budgets, the cut and the message-level proportional truncation are THE shared tool-output policy, once, in
 * `@builderforce/agent-run` (`policy/tools/truncation.ts`, over `@builderforce/tool-output-policy`, PRD C7); callers that need only
 * those (`calculateMaxToolResultChars`, `isOversizedToolResult`, `HARD_MAX_TOOL_RESULT_CHARS`) import them from there. What stays HERE
 * is what the agent may not have, because it is this host's:
 *   - the C7 lever for an on-device host (`onDeviceCostLeverOn`, bucketed by the install id): with it on, a shell/test/build log is
 *     summarized (failing tests, error lines, assertion diffs, the tail) instead of head-cut, so the verdict at the end of a long run
 *     is never the part that is dropped. The agent takes it as an injected hook, never an import;
 *   - the walk of the session FILE (`SessionManager`) that re-appends a branch with the oversized results cut.
 */

/** The C7 lever for an on-device host (bucketed by the install id). */
const LEVERS: TruncateHooks = { summarize: () => onDeviceCostLeverOn("c7_tool_output_policy") };

/**
 * Truncate a single text string to fit within maxChars, preserving the beginning - or, with the C7 lever on, summarizing it when it reads
 * as a shell/test/build log. `suffix` is the notice a head cut ends with (the persistence guard says so in its own words).
 */
export function truncateToolResultText(text: string, maxChars: number, suffix: string = DEFAULT_TRUNCATION_SUFFIX): string {
  return capText(text, maxChars, suffix, LEVERS);
}

/**
 * Truncate a tool result message's text content blocks to fit within maxChars (the agent's proportional cut, with this host's lever).
 * Returns a new message (does not mutate the original). THE message-level cut: the context-overflow recovery below and the persistence
 * guard (`session-tool-result-guard.ts`) both use it.
 */
export function truncateToolResultMessage(msg: AgentMessage, maxChars: number, opts: { suffix?: string } = {}): AgentMessage {
  return capMessage(msg, maxChars, { ...opts, hooks: LEVERS });
}

/**
 * Truncate oversized tool results in an array of messages (in-memory), as a pre-emptive guard before sending messages to the LLM,
 * without modifying the session file. Returns a new array with truncated messages.
 */
export function truncateOversizedToolResultsInMessages(
  messages: AgentMessage[],
  contextWindowTokens: number,
): { messages: AgentMessage[]; truncatedCount: number } {
  return capMessages(messages, contextWindowTokens, { hooks: LEVERS });
}

/**
 * The overflow-recovery check `run.ts` asks (and its test mocks, as it does {@link truncateOversizedToolResultsInSession}): the agent's
 * own estimate, named here only because this module is the seam that runner imports both from.
 */
export { sessionLikelyHasOversizedToolResults } from "@builderforce/agent-run";

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
      const textLength = toolResultTextLength(msg);
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
          const newLength = toolResultTextLength(message);
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
