/**
 * Native, framework-free LLM client — the pi-ai replacement core (cutover stage 2).
 *
 * pi-ai is a multi-provider SDK (provider adapters, model catalogs, OpenAI/Codex
 * auth, streaming). The on-prem runtime reaches every model THROUGH the gateway's
 * OpenAI-compatible endpoint, so the native replacement does NOT re-implement provider
 * adapters — it speaks the one OpenAI wire format the gateway already normalizes for
 * the whole `CODING_MODEL_POOL`. This module provides the two primitives the agent
 * loop needs — non-streaming `complete` and token-streaming `stream` (SSE) — with zero
 * third-party deps, so call sites can migrate off `pi-ai`'s `complete`/`completeSimple`/
 * `streamSimple`/`createAssistantMessageEventStream` onto it.
 *
 * Auth is a bearer key (the gateway brokers per-tenant provider credentials), so
 * pi-ai's per-provider login (`loginOpenAICodex`/`getEnvApiKey`) collapses to one key.
 */

/** An OpenAI-compatible chat message (the wire shape the gateway accepts). */
export interface LlmMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: unknown;
  tool_call_id?: string;
  [k: string]: unknown;
}

/** An OpenAI-compatible function-tool schema. */
export interface LlmToolSchema {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface LlmRequest {
  messages: LlmMessage[];
  tools?: LlmToolSchema[];
  model?: string;
  temperature?: number;
  /** Pass-through extras (max_tokens, top_p, …) merged into the request body. */
  extra?: Record<string, unknown>;
}

export interface RawToolCall {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

export interface LlmResult {
  content: string;
  toolCalls: RawToolCall[];
  finishReason?: string;
}

export interface NativeLlmClientOptions {
  /** Gateway base URL; `/v1/chat/completions` is appended. */
  baseUrl: string;
  apiKey: string;
  /** Default model when a request omits one. */
  defaultModel?: string;
}

/** Incremental stream events — the `createAssistantMessageEventStream` replacement. */
export type LlmStreamEvent =
  | { type: "text-delta"; delta: string }
  | { type: "tool-call"; index: number; id?: string; name?: string; argsDelta?: string }
  | { type: "done"; result: LlmResult };

function buildBody(client: NativeLlmClientOptions, req: LlmRequest, stream: boolean): string {
  const model = req.model ?? client.defaultModel;
  return JSON.stringify({
    ...(model ? { model } : {}),
    messages: req.messages,
    ...(req.tools?.length ? { tools: req.tools, tool_choice: "auto" } : {}),
    ...(typeof req.temperature === "number" ? { temperature: req.temperature } : {}),
    ...(stream ? { stream: true } : {}),
    ...(req.extra ?? {}),
  });
}

function endpointOf(client: NativeLlmClientOptions): string {
  return `${client.baseUrl.replace(/\/$/, "")}/v1/chat/completions`;
}

function headersOf(client: NativeLlmClientOptions): Record<string, string> {
  return { "content-type": "application/json", authorization: `Bearer ${client.apiKey}` };
}

/** Non-streaming completion (pi-ai `complete`/`completeSimple` replacement). */
export async function nativeComplete(
  client: NativeLlmClientOptions,
  req: LlmRequest,
  signal?: AbortSignal,
): Promise<LlmResult> {
  const res = await fetch(endpointOf(client), {
    method: "POST",
    headers: headersOf(client),
    body: buildBody(client, req, false),
    signal,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`gateway ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = (await res.json().catch(() => null)) as {
    choices?: Array<{ message?: { content?: unknown; tool_calls?: unknown }; finish_reason?: string }>;
  } | null;
  const choice = json?.choices?.[0];
  const msg = choice?.message;
  return {
    content: typeof msg?.content === "string" ? msg.content : "",
    toolCalls: Array.isArray(msg?.tool_calls) ? (msg.tool_calls as RawToolCall[]) : [],
    finishReason: choice?.finish_reason,
  };
}

interface ToolCallAccumulator {
  id?: string;
  name?: string;
  args: string;
}

/**
 * Streaming completion (pi-ai `streamSimple`/`createAssistantMessageEventStream`
 * replacement). Parses the OpenAI SSE `data:` frames, emits text/tool-call deltas via
 * `onEvent`, and resolves with the fully-assembled {@link LlmResult}.
 */
export async function nativeStream(
  client: NativeLlmClientOptions,
  req: LlmRequest,
  onEvent: (event: LlmStreamEvent) => void,
  signal?: AbortSignal,
): Promise<LlmResult> {
  const res = await fetch(endpointOf(client), {
    method: "POST",
    headers: { ...headersOf(client), accept: "text/event-stream" },
    body: buildBody(client, req, true),
    signal,
  });
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    throw new Error(`gateway ${res.status}: ${body.slice(0, 300)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let finishReason: string | undefined;
  const toolCalls: ToolCallAccumulator[] = [];

  const handleData = (data: string): boolean => {
    if (data === "[DONE]") return true;
    let parsed: {
      choices?: Array<{
        delta?: { content?: unknown; tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }> };
        finish_reason?: string;
      }>;
    };
    try {
      parsed = JSON.parse(data);
    } catch {
      return false;
    }
    const choice = parsed.choices?.[0];
    if (!choice) return false;
    if (choice.finish_reason) finishReason = choice.finish_reason;
    const delta = choice.delta;
    if (typeof delta?.content === "string" && delta.content) {
      content += delta.content;
      onEvent({ type: "text-delta", delta: delta.content });
    }
    if (Array.isArray(delta?.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const index = typeof tc.index === "number" ? tc.index : 0;
        const acc = (toolCalls[index] ??= { args: "" });
        if (tc.id) acc.id = tc.id;
        if (tc.function?.name) acc.name = tc.function.name;
        const argsDelta = tc.function?.arguments;
        if (typeof argsDelta === "string") acc.args += argsDelta;
        onEvent({ type: "tool-call", index, id: tc.id, name: tc.function?.name, argsDelta });
      }
    }
    return false;
  };

  let done = false;
  while (!done) {
    const { value, done: streamDone } = await reader.read();
    if (streamDone) break;
    buffer += decoder.decode(value, { stream: true });
    // SSE frames are separated by blank lines; each frame has one or more `data:` lines.
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      for (const line of frame.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("data:")) {
          if (handleData(trimmed.slice(5).trim())) {
            done = true;
          }
        }
      }
      if (done) break;
    }
  }

  const result: LlmResult = {
    content,
    finishReason,
    toolCalls: toolCalls
      .filter(Boolean)
      .map((t) => ({ id: t.id, type: "function", function: { name: t.name, arguments: t.args } })),
  };
  onEvent({ type: "done", result });
  return result;
}

/** Build a reusable client bound to one gateway + key. */
export function createNativeLlmClient(options: NativeLlmClientOptions): {
  complete: (req: LlmRequest, signal?: AbortSignal) => Promise<LlmResult>;
  stream: (req: LlmRequest, onEvent: (e: LlmStreamEvent) => void, signal?: AbortSignal) => Promise<LlmResult>;
} {
  return {
    complete: (req, signal) => nativeComplete(options, req, signal),
    stream: (req, onEvent, signal) => nativeStream(options, req, onEvent, signal),
  };
}
