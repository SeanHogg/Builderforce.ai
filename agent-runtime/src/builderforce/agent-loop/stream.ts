/**
 * Native streaming — the pi-free replacement for `@mariozechner/pi-ai`'s `streamSimple`
 * (PI cutover, loop stage). `createGatewayStreamFn` returns a {@link StreamFn} that runs a
 * model turn through the gateway's OpenAI-compatible endpoint ({@link nativeStream}) and
 * translates the raw text/tool-call deltas into the `AssistantMessageEvent` protocol the
 * native Agent loop consumes, assembling the terminal `AssistantMessage`.
 */

import {
  type LlmMessage,
  type LlmToolSchema,
  type NativeLlmClientOptions,
  nativeStream,
} from "../model/native-llm.js";
import type {
  AssistantMessage,
  Context,
  Model,
  SimpleStreamOptions,
  TextContent,
  ToolCall,
  Usage,
} from "../model/types.js";
import { AssistantMessageEventStream } from "./event-stream.js";

/** A model-turn streaming function (faithful to pi-agent-core's `StreamFn` shape, but
 *  native: returns the native {@link AssistantMessageEventStream}). */
export type StreamFn = (
  model: Model,
  context: Context,
  options?: SimpleStreamOptions,
) => AssistantMessageEventStream | Promise<AssistantMessageEventStream>;

const ZERO_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

/** Map the native domain `Context.messages` onto the OpenAI wire shape the gateway accepts. */
function toLlmMessages(context: Context): LlmMessage[] {
  const messages: LlmMessage[] = [];
  if (context.systemPrompt) messages.push({ role: "system", content: context.systemPrompt });
  for (const m of context.messages) {
    if (m.role === "user") {
      const content =
        typeof m.content === "string"
          ? m.content
          : m.content.map((c) => (c.type === "text" ? c.text : "")).join("");
      messages.push({ role: "user", content });
    } else if (m.role === "assistant") {
      const text = m.content
        .filter((c): c is TextContent => c.type === "text")
        .map((c) => c.text)
        .join("");
      const toolCalls = m.content.filter((c): c is ToolCall => c.type === "toolCall");
      messages.push({
        role: "assistant",
        content: text || null,
        ...(toolCalls.length
          ? {
              tool_calls: toolCalls.map((tc) => ({
                id: tc.id,
                type: "function",
                function: { name: tc.name, arguments: JSON.stringify(tc.arguments ?? {}) },
              })),
            }
          : {}),
      });
    } else if (m.role === "toolResult") {
      const content = m.content.map((c) => (c.type === "text" ? c.text : "")).join("");
      messages.push({ role: "tool", tool_call_id: m.toolCallId, content });
    }
  }
  return messages;
}

function toLlmTools(context: Context): LlmToolSchema[] | undefined {
  if (!context.tools?.length) return undefined;
  return context.tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters as Record<string, unknown>,
    },
  }));
}

/**
 * A self-resolving default {@link StreamFn} — the native `streamSimple` replacement. Each
 * call routes through the gateway derived from the model's `baseUrl` (gateway-routed in the
 * native runtime) + the per-call `apiKey`. Used as the fallback where the embedded runner
 * doesn't pre-bind a gateway client.
 */
export const nativeStreamSimple: StreamFn = (model, context, options) =>
  createGatewayStreamFn({ baseUrl: model.baseUrl, apiKey: options?.apiKey ?? "" })(
    model,
    context,
    options,
  );

/**
 * Build a {@link StreamFn} bound to a gateway client. The returned fn streams a turn and
 * emits the `AssistantMessageEvent` sequence (text_start/delta/end, toolcall_*, done/error).
 */
export function createGatewayStreamFn(client: NativeLlmClientOptions): StreamFn {
  return (model, context, options) => {
    const stream = new AssistantMessageEventStream();
    const partial: AssistantMessage = {
      role: "assistant",
      content: [],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: { ...ZERO_USAGE },
      stopReason: "stop",
      timestamp: Date.now(),
    };

    const run = async () => {
      let textIndex = -1;
      let textBuf = "";
      const toolBuf = new Map<
        number,
        { contentIndex: number; id?: string; name?: string; args: string }
      >();
      try {
        const result = await nativeStream(
          { ...client, apiKey: options?.apiKey || client.apiKey, defaultModel: model.id },
          { model: model.id, messages: toLlmMessages(context), tools: toLlmTools(context) },
          (ev) => {
            if (ev.type === "text-delta") {
              if (textIndex < 0) {
                textIndex = partial.content.length;
                partial.content.push({ type: "text", text: "" } as TextContent);
                stream.push({ type: "text_start", contentIndex: textIndex, partial });
              }
              textBuf += ev.delta;
              (partial.content[textIndex] as TextContent).text = textBuf;
              stream.push({
                type: "text_delta",
                contentIndex: textIndex,
                delta: ev.delta,
                partial,
              });
            } else if (ev.type === "tool-call") {
              let entry = toolBuf.get(ev.index);
              if (!entry) {
                const contentIndex = partial.content.length;
                entry = { contentIndex, id: ev.id, name: ev.name, args: "" };
                toolBuf.set(ev.index, entry);
                partial.content.push({
                  type: "toolCall",
                  id: ev.id ?? "",
                  name: ev.name ?? "",
                  arguments: {},
                } as ToolCall);
                stream.push({ type: "toolcall_start", contentIndex, partial });
              }
              if (ev.id) entry.id = ev.id;
              if (ev.name) entry.name = ev.name;
              if (ev.argsDelta) {
                entry.args += ev.argsDelta;
                stream.push({
                  type: "toolcall_delta",
                  contentIndex: entry.contentIndex,
                  delta: ev.argsDelta,
                  partial,
                });
              }
            }
          },
          options?.signal,
        );

        if (textIndex >= 0) {
          stream.push({ type: "text_end", contentIndex: textIndex, content: textBuf, partial });
        }
        for (const entry of toolBuf.values()) {
          let args: Record<string, unknown> = {};
          try {
            args = entry.args ? (JSON.parse(entry.args) as Record<string, unknown>) : {};
          } catch {
            args = {};
          }
          const toolCall: ToolCall = {
            type: "toolCall",
            id: entry.id ?? "",
            name: entry.name ?? "",
            arguments: args,
          };
          partial.content[entry.contentIndex] = toolCall;
          stream.push({
            type: "toolcall_end",
            contentIndex: entry.contentIndex,
            toolCall,
            partial,
          });
        }

        partial.stopReason = result.toolCalls.length ? "toolUse" : "stop";
        stream.push({
          type: "done",
          reason: partial.stopReason as "stop" | "toolUse" | "length",
          message: partial,
        });
      } catch (err) {
        const aborted = options?.signal?.aborted || (err as Error)?.name === "AbortError";
        partial.stopReason = aborted ? "aborted" : "error";
        partial.errorMessage = err instanceof Error ? err.message : String(err);
        stream.push({ type: "error", reason: aborted ? "aborted" : "error", error: partial });
      } finally {
        stream.end();
      }
    };

    queueMicrotask(() => void run());
    return stream;
  };
}
