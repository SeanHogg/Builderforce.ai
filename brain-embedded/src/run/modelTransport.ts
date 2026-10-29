/**
 * The Brain's MODEL PORT (PRD 35 §3.2 `ModelTransport`).
 *
 * `BrainStreamFn` is the surface's one way to a model: the gateway, or — behind the same
 * function — the local-first transport (`localFirstTransport.ts`: the on-device model first,
 * then the cloud) and the XML tool-call lifting (`xmlToolCalls.ts`) that turns a dialect's
 * call markup back into structured calls. This wraps that function as the agent's port:
 * it translates the agent's request into the stream's options, passes the streamed deltas to
 * the surface's live view, and translates the result back. It decides nothing about WHICH
 * model, WHEN to retry or WHAT to offer — those are the agent's (`policy/model`, `policy/tools`).
 *
 * Also answers the two questions the agent asks of a transport:
 *   - `window(model)` — the model's context window from what the host already knows (its
 *     gateway catalog, the shipped local catalog), sync; `undefined` keeps today's caps;
 *   - `preflight(model)` — the host's BYO health check (PRD 35 E7), run once before turn 1.
 */

import type { ModelCompletion, ModelPreflightResult, ModelRequest, ModelTransport, RunMessage } from '@builderforce/agent-run';
import type { ChatCompletionMessage, CompletionMetadata, StreamChatOptions, StreamChatResult, StreamHandlers } from '../streamChatCompletion';
import type { BrainStreamFn } from '../runStore/runTypes';
import { contextWindowOf, type RunWindowSources } from '../windowFit/modelWindow';

/** What the surface fixes for every call of the run (the request's own routing choices). */
export type BrainCallDefaults = Partial<
  Pick<StreamChatOptions, 'routingMode' | 'modelStrict' | 'reasoning' | 'metadata' | 'role' | 'excludeModels' | 'prompt_cache_key' | 'conversationKey'>
>;

export interface BrainModelTransportDeps {
  /** The surface's streaming completion — gateway, local-first and XML lifting behind it. */
  stream: BrainStreamFn;
  /** Where a turn's streamed deltas, serving model and connect retries go (the live view). */
  handlers?: () => StreamHandlers;
  /** Per-call routing the request fixed for the whole run. */
  call?: BrainCallDefaults;
  /** What the host knows about model windows — its gateway catalog and live local runtimes. */
  windows?: Pick<RunWindowSources, 'cloud'>;
  /** The host's BYO health check — awaited once before the first turn. */
  preflight?: () => Promise<ModelPreflightResult | undefined>;
}

/** The agent's transcript row in the stream's wire shape. */
export function toStreamMessage(message: RunMessage): ChatCompletionMessage {
  if (message.role === 'tool') {
    return { role: 'tool', content: message.content, ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}) };
  }
  if (message.role === 'assistant' && message.toolCalls && message.toolCalls.length > 0) {
    return {
      role: 'assistant',
      content: message.content,
      tool_calls: message.toolCalls.map((call) => ({ id: call.id, type: 'function' as const, function: { name: call.name, arguments: call.arguments } })),
    };
  }
  return { role: message.role, content: message.content };
}

/** The stream's result in the agent's completion shape. */
export function toCompletion(result: StreamChatResult): ModelCompletion {
  return {
    content: result.text,
    // The call's arguments stay the RAW JSON string — the kernel parses them, and a
    // malformed one is the kernel's to report.
    toolCalls: result.toolCalls.map((call) => ({ id: call.id, name: call.name, arguments: call.args })),
    ...(result.usage
      ? {
          usage: {
            ...(result.usage.prompt !== undefined ? { inputTokens: result.usage.prompt } : {}),
            ...(result.usage.completion !== undefined ? { outputTokens: result.usage.completion } : {}),
            ...(result.usage.cacheRead !== undefined ? { cacheReadTokens: result.usage.cacheRead } : {}),
          },
        }
      : {}),
    ...(result.resolvedModel ? { model: result.resolvedModel } : {}),
  };
}

/** Build the Brain's `ModelTransport` over its streaming function. */
export function brainModelTransport(deps: BrainModelTransportDeps): ModelTransport {
  const { stream, handlers, call, windows, preflight } = deps;
  return {
    async complete(request: ModelRequest, signal?: AbortSignal): Promise<ModelCompletion> {
      const tools = request.tools && request.tools.length > 0 ? request.tools : undefined;
      const result = await stream(
        {
          ...call,
          messages: request.messages.map(toStreamMessage),
          ...(tools ? { tools, tool_choice: 'auto' as const } : {}),
          ...(request.model ? { model: request.model } : {}),
          ...(request.maxTokens !== undefined ? { maxTokens: request.maxTokens } : {}),
          ...(signal ? { signal } : {}),
        },
        handlers?.(),
      );
      return toCompletion(result);
    },
    window: (model) => contextWindowOf(model, windows?.cloud ? { cloud: windows.cloud } : {}),
    ...(preflight ? { preflight: () => preflight() } : {}),
  };
}

/** The call metadata a run fixes — re-exported so an adapter names one type for it. */
export type { CompletionMetadata };
