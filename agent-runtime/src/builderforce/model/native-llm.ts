/**
 * Native, framework-free LLM client — the pi-ai replacement core (cutover stage 2).
 *
 * pi-ai is a multi-provider SDK (provider adapters, model catalogs, OpenAI/Codex
 * auth, streaming). The on-prem runtime reaches every model THROUGH the gateway's
 * OpenAI-compatible endpoint, so the native replacement does NOT re-implement provider
 * adapters — it speaks the one OpenAI wire format the gateway already normalizes for
 * the whole `CODING_MODEL_POOL`. This module provides the two primitives the agent
 * loop needs — non-streaming `complete` and token-streaming `stream` (SSE).
 *
 * The request body, error mapping and SSE reading are the package chat client's
 * (`@seanhogg/builderforce-memory/wire`), the same one the package bridges use; this
 * module only binds it to the gateway (`/v1` base, default model, error text).
 *
 * Auth is a bearer key (the gateway brokers per-tenant provider credentials), so
 * pi-ai's per-provider login (`loginOpenAICodex`/`getEnvApiKey`) collapses to one key.
 */

import {
  chatComplete,
  chatStream,
  ChatCompletionError,
  type ChatClient,
  type ChatMessage,
  type ChatRequest,
  type ChatToolCall,
  type ChatToolSchema,
} from "@seanhogg/builderforce-memory/wire";
import { normalizeBaseUrl } from "../../utils/normalize-base-url.js";

/** An OpenAI-compatible chat message (the wire shape the gateway accepts). */
export type LlmMessage = ChatMessage;

/** An OpenAI-compatible function-tool schema. */
export type LlmToolSchema = ChatToolSchema;

export type RawToolCall = ChatToolCall;

export interface LlmRequest {
  messages: LlmMessage[];
  tools?: LlmToolSchema[];
  model?: string;
  temperature?: number;
  /** Pass-through extras (max_tokens, top_p, …) merged into the request body. */
  extra?: Record<string, unknown>;
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

function chatClientOf(client: NativeLlmClientOptions): ChatClient {
  return { baseUrl: `${normalizeBaseUrl(client.baseUrl)}/v1`, apiKey: client.apiKey };
}

function chatRequestOf(client: NativeLlmClientOptions, req: LlmRequest): ChatRequest {
  const model = req.model ?? client.defaultModel;
  return {
    messages: req.messages,
    ...(req.tools ? { tools: req.tools } : {}),
    ...(model ? { model } : {}),
    ...(typeof req.temperature === "number" ? { temperature: req.temperature } : {}),
    ...(req.extra ? { extra: req.extra } : {}),
  };
}

/** The gateway's non-2xx answer as the `gateway {status}: {body}` error callers log. */
function gatewayError(err: unknown): unknown {
  return err instanceof ChatCompletionError ? new Error(`gateway ${err.status}: ${err.body}`) : err;
}

function toLlmResult(result: LlmResult): LlmResult {
  return { content: result.content, toolCalls: result.toolCalls, finishReason: result.finishReason };
}

/** Non-streaming completion (pi-ai `complete`/`completeSimple` replacement). */
export async function nativeComplete(
  client: NativeLlmClientOptions,
  req: LlmRequest,
  signal?: AbortSignal,
): Promise<LlmResult> {
  try {
    return toLlmResult(await chatComplete(chatClientOf(client), chatRequestOf(client, req), signal));
  } catch (err) {
    throw gatewayError(err);
  }
}

/**
 * Streaming completion (pi-ai `streamSimple`/`createAssistantMessageEventStream`
 * replacement). Emits text/tool-call deltas via `onEvent`, then `done`, and resolves
 * with the fully-assembled {@link LlmResult}.
 */
export async function nativeStream(
  client: NativeLlmClientOptions,
  req: LlmRequest,
  onEvent: (event: LlmStreamEvent) => void,
  signal?: AbortSignal,
): Promise<LlmResult> {
  let result: LlmResult = { content: "", toolCalls: [] };
  try {
    for await (const event of chatStream(chatClientOf(client), chatRequestOf(client, req), signal)) {
      if (event.type === "done") {
        result = toLlmResult(event.result);
        onEvent({ type: "done", result });
      } else {
        onEvent(event);
      }
    }
  } catch (err) {
    throw gatewayError(err);
  }
  return result;
}
