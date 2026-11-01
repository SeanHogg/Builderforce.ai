/**
 * The channel path's MESSAGE codec: the embedded runner's `AgentMessage` rows to and from the agent's `RunMessage` rows.
 *
 * `content` stays the row's TEXT, so the agent's policy (compaction, the stall judgement, token counts) reads what it always
 * reads. Everything a row has beyond its text rides `RunMessage.parts` (the native blocks: signed text, thinking, tool calls with
 * their signatures, pictures) and `RunMessage.meta` (the message-level fields: provider, usage, stop reason, timestamp, a tool's
 * details), so a row reads back as the exact message it was. The roles the model never sees as such (a bash execution, a branch
 * or compaction summary, an extension's custom message) ride whole in `meta.agentMessage`.
 *
 * Pure: no I/O, no policy.
 */

import type { RunMessage, RunPart } from "@builderforce/agent-run";
import type { AgentMessage } from "../builderforce/model/agent-types.js";
import type {
  AssistantMessage,
  ImageContent,
  Model,
  TextContent,
  ThinkingContent,
  ToolCall,
  ToolResultMessage,
  Usage,
  UserMessage,
} from "../builderforce/model/types.js";

const ZERO_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const DATA_URL = /^data:([^;,]+);base64,(.*)$/s;

/** A picture block as the part that carries it (a data URL: the block's bytes are inline). */
function imagePart(image: ImageContent): RunPart {
  return { type: "image", url: `data:${image.mimeType};base64,${image.data}` };
}

/** The picture block a part carries, when it is an inline picture. */
function imageBlock(part: RunPart): ImageContent | undefined {
  if (part.type !== "image") return undefined;
  const match = DATA_URL.exec(part.url);
  return match ? { type: "image", mimeType: match[1]!, data: match[2]! } : undefined;
}

/** The text of a content value (a string, or blocks). */
export function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((b: { type?: string; text?: string }) => (b.type === "text" ? b.text ?? "" : "")).join("");
}

/** The parts a tool result's content blocks become. */
export function resultParts(content: readonly (TextContent | ImageContent)[]): RunPart[] {
  return content.map((b) => (b.type === "image" ? imagePart(b) : { type: "text" as const, text: b.text }));
}

/** The blocks a tool result's parts read back as. */
function resultBlocks(parts: readonly RunPart[]): (TextContent | ImageContent)[] {
  const out: (TextContent | ImageContent)[] = [];
  for (const part of parts) {
    if (part.type === "text") out.push({ type: "text", text: part.text });
    else {
      const image = imageBlock(part);
      if (image) out.push(image);
    }
  }
  return out;
}

/** An `AgentMessage` as the row the agent carries. */
export function toRunRow(message: AgentMessage): RunMessage {
  switch (message.role) {
    case "user": {
      const images = typeof message.content === "string" ? [] : message.content.filter((b): b is ImageContent => b.type === "image").map(imagePart);
      return { role: "user", content: textOf(message.content), ...(images.length > 0 ? { parts: images } : {}), meta: { timestamp: message.timestamp } };
    }
    case "assistant": {
      const { content, role: _role, ...fields } = message;
      const parts: RunPart[] = content.map((b) =>
        b.type === "text"
          ? { type: "text" as const, text: b.text, ...(b.textSignature ? { signature: b.textSignature } : {}) }
          : b.type === "thinking"
            ? { type: "thinking" as const, thinking: b.thinking, ...(b.thinkingSignature ? { signature: b.thinkingSignature } : {}) }
            : { type: "toolCall" as const, id: b.id, name: b.name, arguments: b.arguments, ...(b.thoughtSignature ? { signature: b.thoughtSignature } : {}) },
      );
      const calls = content.filter((b): b is ToolCall => b.type === "toolCall");
      return {
        role: "assistant",
        content: content.filter((b): b is TextContent => b.type === "text").map((b) => b.text).join("\n"),
        parts,
        ...(calls.length > 0 ? { toolCalls: calls.map((c) => ({ id: c.id, name: c.name, arguments: c.rawArguments ?? JSON.stringify(c.arguments ?? {}) })) } : {}),
        meta: fields,
      };
    }
    case "toolResult":
      return {
        role: "tool",
        toolCallId: message.toolCallId,
        content: textOf(message.content),
        parts: resultParts(message.content),
        ...(message.isError ? { isError: true as const } : {}),
        meta: { toolName: message.toolName, details: message.details, timestamp: message.timestamp },
      };
    default:
      // bash executions, branch / compaction summaries and custom messages: the model reads them through `convertToLlm`, so they
      // ride whole and come back as they were.
      return { role: "user", content: textOf((message as { content?: unknown }).content) || (message as { summary?: string }).summary || "", custom: true, meta: { agentMessage: message } };
  }
}

/** What a row needs to read back as a message: who is answering, and the tool names the run's calls carry. */
export interface RowContext {
  model: Model;
  /** Tool name by call id, learned from the assistant rows read so far. */
  toolNames: Map<string, string>;
  /**
   * The row is read for the MODEL: a tool result whose text the agent changed (capped, annotated) reads as that text, and the
   * row's blocks keep only their pictures. Absent ⇒ the row reads as it was written (what the session records).
   */
  forModel?: boolean;
}

/** A row as the `AgentMessage` it is, or nothing for a row that is the agent's own note (a system row). */
export function toAgentMessage(row: RunMessage, ctx: RowContext): AgentMessage | undefined {
  const whole = row.meta?.agentMessage as AgentMessage | undefined;
  if (whole) return whole;
  const meta = (row.meta ?? {}) as Record<string, unknown>;
  const timestamp = typeof meta.timestamp === "number" ? meta.timestamp : Date.now();
  switch (row.role) {
    case "system":
      return undefined;
    case "user": {
      const images = (row.parts ?? []).map(imageBlock).filter((b): b is ImageContent => b !== undefined);
      const content: UserMessage["content"] = images.length > 0 ? [{ type: "text", text: row.content }, ...images] : row.content;
      return { role: "user", content, timestamp };
    }
    case "assistant": {
      const blocks: (TextContent | ThinkingContent | ToolCall)[] = [];
      for (const part of row.parts ?? []) {
        if (part.type === "text") blocks.push({ type: "text", text: part.text, ...(part.signature ? { textSignature: part.signature } : {}) });
        else if (part.type === "thinking") blocks.push({ type: "thinking", thinking: part.thinking, ...(part.signature ? { thinkingSignature: part.signature } : {}) });
        else if (part.type === "toolCall") blocks.push({ type: "toolCall", id: part.id, name: part.name, arguments: part.arguments, ...(part.signature ? { thoughtSignature: part.signature } : {}) });
      }
      if (blocks.length === 0) {
        if (row.content) blocks.push({ type: "text", text: row.content });
        for (const call of row.toolCalls ?? []) blocks.push({ type: "toolCall", id: call.id, name: call.name, arguments: parseArguments(call.arguments) });
      }
      for (const block of blocks) if (block.type === "toolCall") ctx.toolNames.set(block.id, block.name);
      const message: AssistantMessage = {
        role: "assistant",
        content: blocks,
        api: ctx.model.api,
        provider: ctx.model.provider,
        model: ctx.model.id,
        usage: ZERO_USAGE,
        stopReason: blocks.some((b) => b.type === "toolCall") ? "toolUse" : "stop",
        timestamp,
        ...(meta as Partial<AssistantMessage>),
      };
      return message;
    }
    case "tool": {
      const id = row.toolCallId ?? "";
      const native = resultBlocks(row.parts ?? []);
      const nativeText = textOf(native);
      const edited = ctx.forModel === true && native.length > 0 && nativeText !== row.content;
      const content: ToolResultMessage["content"] = native.length === 0 || edited ? [{ type: "text", text: row.content }, ...native.filter((b) => b.type === "image")] : native;
      return {
        role: "toolResult",
        toolCallId: id,
        toolName: typeof meta.toolName === "string" ? meta.toolName : ctx.toolNames.get(id) ?? "",
        content,
        details: meta.details ?? {},
        isError: row.isError === true,
        timestamp,
      };
    }
  }
}

function parseArguments(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** The usage of a message as the agent's `ModelUsage`. */
export function modelUsageOf(usage: Usage): { inputTokens: number; outputTokens: number; cacheReadTokens: number; pricedMc?: number } {
  return {
    inputTokens: usage.input,
    outputTokens: usage.output,
    cacheReadTokens: usage.cacheRead,
    ...(usage.cost.total > 0 ? { pricedMc: Math.round(usage.cost.total * 100_000) } : {}),
  };
}
