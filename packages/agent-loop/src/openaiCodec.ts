/**
 * The codec for every surface whose transcript is OpenAI chat-completion rows — the
 * cloud loop, the server Brain, the embedded Brain and the creation canvas. The tool
 * row's content is produced by the `serialize` the surface hands in, so payload
 * budgeting (the Brain trims, the cloud stringifies, the Brain reply slices) stays
 * with the surface while the ROW SHAPE lives here once.
 */

import type { LoopCodec, LoopDispatchResult, LoopToolCall, LoopTurn, ParsedToolCall } from "./types.js";

export interface OpenAiToolCallRow {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface OpenAiAssistantRow {
  role: "assistant";
  content: string;
  tool_calls: OpenAiToolCallRow[];
}

export interface OpenAiToolRow {
  role: "tool";
  tool_call_id: string;
  content: string;
}

export function toOpenAiToolCall(call: LoopToolCall): OpenAiToolCallRow {
  // An empty / whitespace-only `arguments` string is not valid JSON; strict vendors
  // (Gemini) reject it. Normalize a no-arg call to an empty object.
  return { id: call.id, type: "function", function: { name: call.name, arguments: call.arguments?.trim() ? call.arguments : "{}" } };
}

export type ToolRowSerializer = (result: LoopDispatchResult, call: ParsedToolCall) => string;

export const defaultToolRowSerializer: ToolRowSerializer = (result) => JSON.stringify(result.data ?? null);

/**
 * `M` is the surface's row type; it must be assignable FROM the assistant/tool rows
 * above (an `Array<Record<string, unknown>>` transcript qualifies).
 */
export function openAiChatCodec<M = OpenAiAssistantRow | OpenAiToolRow>(
  serialize: ToolRowSerializer = defaultToolRowSerializer,
): LoopCodec<M> {
  return {
    assistant(turn: LoopTurn): M {
      const row: OpenAiAssistantRow = {
        role: "assistant",
        content: turn.content ?? "",
        tool_calls: turn.toolCalls.map(toOpenAiToolCall),
      };
      return row as unknown as M;
    },
    tool(call: ParsedToolCall, result: LoopDispatchResult): M {
      const row: OpenAiToolRow = { role: "tool", tool_call_id: call.id, content: serialize(result, call) };
      return row as unknown as M;
    },
  };
}

/** Reads the model's tool calls off an OpenAI-shape assistant message into the kernel's raw form. */
export function readOpenAiToolCalls(message: unknown): LoopToolCall[] {
  const raw = (message as { tool_calls?: unknown } | null)?.tool_calls;
  if (!Array.isArray(raw)) return [];
  const out: LoopToolCall[] = [];
  for (const tc of raw) {
    const fn = (tc as { function?: { name?: unknown; arguments?: unknown } } | null)?.function;
    const name = typeof fn?.name === "string" ? fn.name : "";
    if (!name) continue;
    const idRaw = (tc as { id?: unknown }).id;
    const id = typeof idRaw === "string" && idRaw ? idRaw : `call_${out.length}`;
    const args = typeof fn?.arguments === "string" ? fn.arguments : fn?.arguments == null ? "" : JSON.stringify(fn.arguments);
    out.push({ id, name, arguments: args });
  }
  return out;
}
