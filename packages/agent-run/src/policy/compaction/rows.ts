/**
 * policy/compaction/rows - the transcript row the packer reads and the row it hands back.
 *
 * The packers speak the OpenAI message shape; the run's transcript is `RunMessage`. These are the three mappings between them:
 * the compaction view ({@link toPackRow}), the row back ({@link toRunRow}), and the hand-off view ({@link toHandoffView}), which
 * MEASURES a row's whole content - its thinking blocks and its pictures - because a context handed to a smaller window must not
 * look like it fits just because its text does.
 */

import type { RunMessage } from "../../contract.js";
import type { HandoffAccessor } from "./handoff.js";
import type { PackMessage } from "./pack.js";

/** Map a RunMessage row to the packer's OpenAI shape. Its `content` is the row's TEXT: a row's parts ride along but are not counted. */
export function toPackRow(m: RunMessage): PackMessage {
  const row: PackMessage & { task?: true; parts?: RunMessage["parts"]; meta?: RunMessage["meta"] } = { role: m.role, content: m.content };
  if (m.task) row.task = true;
  if (m.parts && m.parts.length > 0) row.parts = m.parts;
  if (m.meta) row.meta = m.meta;
  if (m.toolCalls && m.toolCalls.length > 0) {
    row.tool_calls = m.toolCalls.map((tc) => ({
      id: tc.id,
      type: "function",
      function: { name: tc.name, arguments: tc.arguments },
    }));
  }
  if (m.toolCallId != null) row.tool_call_id = m.toolCallId;
  return row;
}

/** Map a packed OpenAI row back to the RunMessage row shape. */
export function toRunRow(m: PackMessage | Record<string, unknown>): RunMessage {
  const src = m as PackMessage & { task?: unknown; parts?: RunMessage["parts"]; meta?: RunMessage["meta"] };
  const toolCalls = Array.isArray(src.tool_calls)
    ? (src.tool_calls as Array<{ id?: string; function?: { name?: string; arguments?: string } }>).map((tc) => ({
        id: tc.id ?? "",
        name: tc.function?.name ?? "",
        arguments: tc.function?.arguments ?? "",
      }))
    : undefined;
  const out: RunMessage = {
    role: src.role as RunMessage["role"],
    content: typeof src.content === "string" ? src.content : JSON.stringify(src.content ?? ""),
  };
  if (toolCalls && toolCalls.length > 0) out.toolCalls = toolCalls;
  if (src.tool_call_id != null) out.toolCallId = src.tool_call_id;
  if (src.task === true) out.task = true;
  if (Array.isArray(src.parts) && src.parts.length > 0) out.parts = src.parts;
  if (src.meta) out.meta = src.meta;
  return out;
}

/**
 * What one picture costs the context, in characters of the packer's estimate: one fixed figure, never the length of its base64 (a
 * photo is worth a few thousand tokens to a model, not its byte count). The runner's own context guard and pruner use the same figure.
 */
export const IMAGE_CHAR_ESTIMATE = 8_000;

const IMAGE_STAND_IN = "#".repeat(IMAGE_CHAR_ESTIMATE);

/**
 * The hand-off packer's view of a row, for MEASURING it: the text, plus the blocks the row carries beyond its text - a thinking block
 * (counted whole) and a picture (counted at {@link IMAGE_CHAR_ESTIMATE}). A text part is left out - `content` already is that text,
 * and a channel row carries it in both - and so is a tool call's block, which the view's `tool_calls` already counts. A surface's
 * custom row is context, not the person's words: it reads as the assistant's, so it can never be the latest directive.
 */
export function toHandoffView(m: RunMessage): PackMessage {
  const view = toPackRow(m);
  const role = m.custom ? "assistant" : view.role;
  const blocks = (m.parts ?? [])
    .filter((p) => p.type === "thinking" || p.type === "image")
    .map((p) => (p.type === "image" ? { type: "image", estimate: IMAGE_STAND_IN } : p));
  if (blocks.length === 0) return role === view.role ? view : { ...view, role };
  return { ...view, role, content: [...(m.content ? [{ type: "text", text: m.content }] : []), ...blocks] };
}

/**
 * The run's rows as the hand-off packer reads them. A note comes back as a plain row in the role the packer chose for it (that role
 * keeps turns alternating, and keeps the note from standing in for the latest directive): it stays in the run's own transcript, where
 * the incoming model reads it.
 */
export function runRowHandoff(): HandoffAccessor<RunMessage> {
  return { toHandoff: toHandoffView, summary: (text, role) => ({ role: role as RunMessage["role"], content: text }) };
}
