/**
 * Native compaction — the pi-free replacement for `@mariozechner/pi-coding-agent`'s
 * `estimateTokens` + `generateSummary` (PI cutover, loop stage). `estimateTokens` is the
 * faithful char/4 heuristic; `generateSummary` serializes the conversation and asks the
 * model (via the gateway's OpenAI endpoint, {@link nativeComplete}) for a structured
 * checkpoint summary. Prompts are reproduced verbatim from pi 0.54 for output parity.
 */

import type { AgentMessage } from "../model/agent-types.js";
import { nativeComplete } from "../model/native-llm.js";
import type { AssistantMessage, Message, Model } from "../model/types.js";
import { defaultConvertToLlm } from "./agent-loop.js";

/** Result of a compaction pass (faithful to pi-coding-agent's `CompactionResult`). */
export interface CompactionResult<T = unknown> {
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  tokensAfter?: number;
  details?: T;
}

/** Faithful char/4 token heuristic over the native message union. */
export function estimateTokens(message: AgentMessage): number {
  let chars = 0;
  switch (message.role) {
    case "user": {
      const content = message.content;
      if (typeof content === "string") chars = content.length;
      else
        for (const block of content)
          if (block.type === "text" && block.text) chars += block.text.length;
      return Math.ceil(chars / 4);
    }
    case "assistant": {
      for (const block of (message as AssistantMessage).content) {
        if (block.type === "text") chars += block.text.length;
        else if (block.type === "thinking") chars += block.thinking.length;
        else if (block.type === "toolCall")
          chars += block.name.length + JSON.stringify(block.arguments).length;
      }
      return Math.ceil(chars / 4);
    }
    case "custom":
    case "toolResult": {
      const content = message.content;
      if (typeof content === "string") chars = content.length;
      else
        for (const block of content) {
          if (block.type === "text" && block.text) chars += block.text.length;
          if (block.type === "image") chars += 4800;
        }
      return Math.ceil(chars / 4);
    }
    case "bashExecution":
      return Math.ceil((message.command.length + message.output.length) / 4);
    case "branchSummary":
    case "compactionSummary":
      return Math.ceil(message.summary.length / 4);
  }
  return 0;
}

export function serializeConversation(messages: Message[]): string {
  const parts: string[] = [];
  for (const msg of messages) {
    if (msg.role === "user") {
      const content =
        typeof msg.content === "string"
          ? msg.content
          : msg.content
              .filter((c) => c.type === "text")
              .map((c) => (c as { text: string }).text)
              .join("");
      if (content) parts.push(`[User]: ${content}`);
    } else if (msg.role === "assistant") {
      const textParts: string[] = [];
      const thinkingParts: string[] = [];
      const toolCalls: string[] = [];
      for (const block of msg.content) {
        if (block.type === "text") textParts.push(block.text);
        else if (block.type === "thinking") thinkingParts.push(block.thinking);
        else if (block.type === "toolCall") {
          const argsStr = Object.entries(block.arguments ?? {})
            .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
            .join(", ");
          toolCalls.push(`${block.name}(${argsStr})`);
        }
      }
      if (thinkingParts.length) parts.push(`[Assistant thinking]: ${thinkingParts.join("\n")}`);
      if (textParts.length) parts.push(`[Assistant]: ${textParts.join("\n")}`);
      if (toolCalls.length) parts.push(`[Assistant tool calls]: ${toolCalls.join("; ")}`);
    } else if (msg.role === "toolResult") {
      const content = msg.content
        .filter((c) => c.type === "text")
        .map((c) => (c as { text: string }).text)
        .join("");
      if (content) parts.push(`[Tool result]: ${content}`);
    }
  }
  return parts.join("\n\n");
}

const SUMMARIZATION_SYSTEM_PROMPT = `You are a context summarization assistant. Your task is to read a conversation between a user and an AI coding assistant, then produce a structured summary following the exact format specified.

Do NOT continue the conversation. Do NOT respond to any questions in the conversation. ONLY output the structured summary.`;

const SUMMARIZATION_PROMPT = `The messages above are a conversation to summarize. Create a structured context checkpoint summary that another LLM will use to continue the work.

Use this EXACT format:

## Goal
[What is the user trying to accomplish? Can be multiple items if the session covers different tasks.]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned by user]
- [Or "(none)" if none were mentioned]

## Progress
### Done
- [x] [Completed tasks/changes]

### In Progress
- [ ] [Current work]

### Blocked
- [Issues preventing progress, if any]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Next Steps
1. [Ordered list of what should happen next]

## Critical Context
- [Any data, examples, or references needed to continue]
- [Or "(none)" if not applicable]

Keep each section concise. Preserve exact file paths, function names, and error messages.`;

const UPDATE_SUMMARIZATION_PROMPT = `The messages above are NEW conversation messages to incorporate into the existing summary provided in <previous-summary> tags.

Update the existing structured summary with new information. RULES:
- PRESERVE all existing information from the previous summary
- ADD new progress, decisions, and context from the new messages
- UPDATE the Progress section: move items from "In Progress" to "Done" when completed
- UPDATE "Next Steps" based on what was accomplished
- PRESERVE exact file paths, function names, and error messages
- If something is no longer relevant, you may remove it

Use the same structured format as the previous summary. Keep each section concise. Preserve exact file paths, function names, and error messages.`;

/**
 * Generate a structured checkpoint summary of `currentMessages`. Routes through the
 * gateway's OpenAI endpoint (`model.baseUrl` + `apiKey`). Signature-compatible with pi's
 * `generateSummary` so the call sites migrate unchanged.
 */
export async function generateSummary(
  currentMessages: AgentMessage[],
  model: Model,
  reserveTokens: number,
  apiKey: string,
  signal?: AbortSignal,
  customInstructions?: string,
  previousSummary?: string,
): Promise<string> {
  const maxTokens = Math.floor(0.8 * reserveTokens);
  let basePrompt = previousSummary ? UPDATE_SUMMARIZATION_PROMPT : SUMMARIZATION_PROMPT;
  if (customInstructions) basePrompt = `${basePrompt}\n\nAdditional focus: ${customInstructions}`;

  const conversationText = serializeConversation(defaultConvertToLlm(currentMessages));
  let promptText = `<conversation>\n${conversationText}\n</conversation>\n\n`;
  if (previousSummary)
    promptText += `<previous-summary>\n${previousSummary}\n</previous-summary>\n\n`;
  promptText += basePrompt;

  const result = await nativeComplete(
    { baseUrl: model.baseUrl, apiKey, defaultModel: model.id },
    {
      model: model.id,
      messages: [
        { role: "system", content: SUMMARIZATION_SYSTEM_PROMPT },
        { role: "user", content: promptText },
      ],
      extra: { max_tokens: maxTokens },
    },
    signal,
  );
  return result.content;
}
