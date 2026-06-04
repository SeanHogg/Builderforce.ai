export type ContinuationPolicyInput = {
  userPrompt: string;
  assistantTexts: string[];
  payloadTexts?: string[];
  toolNames: string[];
  hasToolError?: boolean;
  aborted?: boolean;
  timedOut?: boolean;
  promptErrored?: boolean;
  hasPendingClientToolCall?: boolean;
};

export type ContinuationPolicyDecision = {
  shouldContinue: boolean;
  reason?: string;
};

export type AutoContinuePromptInput = {
  originalPrompt: string;
  lastAssistantText?: string;
  reason?: string;
};

import { logDebug } from "../../logger.js";

const INVESTIGATION_TOOLS = new Set([
  "read",
  "grep",
  "find",
  "ls",
  "git_history",
  "sessions_history",
]);

const EXECUTION_TASK_PATTERN =
  /\b(implement|wire|fix|update|refactor|create|modify|build|patch|test|roadmap|prd|task|phase|start:)\b/i;

const DIRECT_USER_QUESTION_PATTERN =
  /\b(can you|could you|would you|do you want|which|what|where|when|should i|please provide|need your)\b/i;

const COMPLETION_PATTERN =
  /\b(all tasks? complete[d]?|all work (is|are) complete|everything (is|are) done|implementation complete|tasks? complete|all steps? finished|fully implemented|all set and ready|final answer)\b/i;

const DEFERRAL_PATTERN =
  /\b(let me|i\s*'ll|i will|next step|going to|check .* first|understand .* first)\b/i;

function normalizeLastAssistantText(assistantTexts: string[], payloadTexts: string[] = []): string {
  for (let i = assistantTexts.length - 1; i >= 0; i -= 1) {
    const text = assistantTexts[i]?.trim();
    if (text) {
      return text;
    }
  }
  for (let i = payloadTexts.length - 1; i >= 0; i -= 1) {
    const text = payloadTexts[i]?.trim();
    if (text) {
      return text;
    }
  }
  return "";
}

function isQuestionForUser(text: string): boolean {
  if (!text || !text.includes("?")) {
    return false;
  }
  return DIRECT_USER_QUESTION_PATTERN.test(text) || /\?\s*$/.test(text);
}

function looksLikeExecutionTask(prompt: string): boolean {
  return EXECUTION_TASK_PATTERN.test(prompt);
}

function isInvestigationOnly(toolNames: string[]): boolean {
  if (toolNames.length === 0) {
    return false;
  }
  return toolNames.every((name) => INVESTIGATION_TOOLS.has(name));
}

export function shouldAutoContinueRun(input: ContinuationPolicyInput): ContinuationPolicyDecision {
  if (input.aborted || input.timedOut || input.promptErrored || input.hasPendingClientToolCall) {
    logDebug(
      `[auto-continue] blocked: abort/timeout/error status (aborted=${input.aborted} timedOut=${input.timedOut})`,
    );
    return { shouldContinue: false };
  }

  if (!looksLikeExecutionTask(input.userPrompt)) {
    logDebug(`[auto-continue] blocked: user prompt doesn't look like execution task`);
    return { shouldContinue: false };
  }

  const lastAssistantText = normalizeLastAssistantText(input.assistantTexts, input.payloadTexts);
  if (!lastAssistantText) {
    if (input.hasToolError && input.toolNames.length > 0) {
      logDebug(`[auto-continue] continue: tool error with no assistant text`);
      return { shouldContinue: true, reason: "tool_error_no_progress" };
    }
    if (input.toolNames.length > 0) {
      logDebug(`[auto-continue] continue: tools called but no assistant text`);
      return { shouldContinue: true, reason: "tool_activity_no_progress" };
    }
    if (isInvestigationOnly(input.toolNames)) {
      logDebug(`[auto-continue] continue: investigation-only tools`);
      return { shouldContinue: true, reason: "investigation_only_tools" };
    }
    logDebug(`[auto-continue] blocked: no assistant text and no tool activity`);
    return { shouldContinue: false };
  }

  if (input.hasToolError && !isQuestionForUser(lastAssistantText)) {
    logDebug(`[auto-continue] continue: tool error recovery`);
    return { shouldContinue: true, reason: "tool_error_retry" };
  }

  if (isQuestionForUser(lastAssistantText)) {
    logDebug(`[auto-continue] blocked: agent asked user a question`);
    return { shouldContinue: false, reason: "asked_user_question" };
  }

  if (COMPLETION_PATTERN.test(lastAssistantText)) {
    logDebug(`[auto-continue] blocked: completion pattern matched`);
    return { shouldContinue: false, reason: "looks_complete" };
  }

  if (DEFERRAL_PATTERN.test(lastAssistantText)) {
    logDebug(`[auto-continue] continue: deferral language detected`);
    return { shouldContinue: true, reason: "deferral_language" };
  }

  if (isInvestigationOnly(input.toolNames)) {
    logDebug(`[auto-continue] continue: investigation-only tools`);
    return { shouldContinue: true, reason: "investigation_only_tools" };
  }

  if (input.toolNames.length > 0) {
    logDebug(`[auto-continue] continue: tools were called (${input.toolNames.join(", ")})`);
    return { shouldContinue: true, reason: "tools_called" };
  }

  logDebug(
    `[auto-continue] blocked: no continuation signal (last text: "${lastAssistantText.slice(0, 100)}...")`,
  );
  return { shouldContinue: false };
}

export const AUTO_CONTINUE_PROMPT =
  "Continue executing the user's requested tasks now. Do not summarize your plan. Perform concrete implementation and test steps. Only stop if you need a specific user decision or missing required information.";

export function buildAutoContinuePrompt(input: AutoContinuePromptInput): string {
  const sections = [
    "Your previous turn ended before the requested work was complete.",
    input.reason ? `Continuation reason: ${input.reason}.` : "",
    "Original user request:",
    input.originalPrompt.trim(),
    input.lastAssistantText?.trim()
      ? ["Your previous incomplete response:", input.lastAssistantText.trim()].join("\n")
      : "",
    AUTO_CONTINUE_PROMPT,
  ].filter(Boolean);

  return sections.join("\n\n");
}
