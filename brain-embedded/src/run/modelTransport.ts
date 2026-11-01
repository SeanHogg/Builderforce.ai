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
import { turnInterruption } from '../finishReason';
import { providerFailureEvent } from '../providerFailure';
import { withImages } from './runMessages';
import { turnPriceMc } from '../localChat/turnCost';
import type { BrainStreamFn } from '../runStore/runTypes';
import { contextWindowOf, type RunWindowSources } from '../windowFit/modelWindow';

/** What the surface fixes for every call of the run (the request's own routing choices). */
export type BrainCallDefaults = Partial<
  Pick<StreamChatOptions, 'routingMode' | 'modelStrict' | 'reasoning' | 'metadata' | 'role' | 'excludeModels' | 'prompt_cache_key' | 'conversationKey'>
>;

/**
 * One turn's session with the surface's live view and record: the stream's handlers, the call's extra metadata, the window
 * fit the request passes through, and what the turn leaves when it completes or fails. The surface builds it per request
 * (`loopTurn.ts` over the run cell); the transport only calls it.
 */
export interface TurnSession {
  handlers: StreamHandlers;
  metadata?: CompletionMetadata;
  /** Pack the wire messages for the model's window. */
  fit?(messages: ChatCompletionMessage[]): Promise<ChatCompletionMessage[]>;
  /** The call's per-conversation routing keys. */
  call?: BrainCallDefaults;
  /** Run the stream inside the surface's live-turn window (the serving model is recorded while it is open). */
  around?<T>(stream: () => Promise<T>): Promise<T>;
  completed(result: StreamChatResult): Promise<void> | void;
  /** The turn failed: record it and hand back the error to throw. */
  failed(error: unknown): unknown;
}

export interface TurnObserver {
  open(request: ModelRequest): TurnSession;
}

export interface BrainModelTransportDeps {
  /** The surface's live view and record of each turn. Absent ⇒ the stream runs bare. */
  turn?: TurnObserver;
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
  return { role: message.role, content: message.role === 'user' ? withImages(message.content, message.parts) : message.content };
}

/** The stream's result in the agent's completion shape. */
export function toCompletion(result: StreamChatResult, requested?: string): ModelCompletion {
  const interruption = turnInterruption(result.finishReason);
  const usage = result.usage;
  const pricedMc = turnPriceMc(result, requested);
  return {
    content: result.text,
    // The call's arguments stay the RAW JSON string — the kernel parses them, and a
    // malformed one is the kernel's to report.
    toolCalls: result.toolCalls.map((call) => ({ id: call.id, name: call.name, arguments: call.args })),
    ...(usage || pricedMc !== undefined
      ? {
          usage: {
            // What the turn is worth on the device (the run's USD cap reads it); absent when it has no known price.
            ...(pricedMc !== undefined ? { pricedMc } : {}),
            ...(usage?.prompt !== undefined ? { inputTokens: usage.prompt } : {}),
            ...(usage?.completion !== undefined ? { outputTokens: usage.completion } : {}),
            ...(usage?.cacheRead !== undefined ? { cacheReadTokens: usage.cacheRead } : {}),
          },
        }
      : {}),
    ...(result.resolvedModel ? { model: result.resolvedModel } : {}),
    // A cut-off turn is told apart from a finished one by the vendor's own finish reason (`finishReason.ts`).
    ...(interruption ? { interrupted: interruption } : {}),
  };
}

/**
 * The transport knows its own errors: a failure the model policy routes around (a model that broke mid-answer, a reset, a 429)
 * leaves carrying the policy's event, so the agent re-asks the turn on another model instead of ending the run
 * (`providerFailure.ts` is the ONE classifier, the Brain's loop asks it too). Any other error leaves as it is.
 */
function classified(error: unknown): unknown {
  const failure = providerFailureEvent(error);
  return failure && error instanceof Error ? Object.assign(error, { failure }) : error;
}

/** Build the Brain's `ModelTransport` over its streaming function. */
export function brainModelTransport(deps: BrainModelTransportDeps): ModelTransport {
  const { stream, handlers, call, windows, preflight } = deps;
  return {
    async complete(request: ModelRequest, signal?: AbortSignal): Promise<ModelCompletion> {
      const tools = request.tools && request.tools.length > 0 ? request.tools : undefined;
      const session = deps.turn?.open(request);
      const wire = request.messages.map(toStreamMessage);
      const messages = session?.fit ? await session.fit(wire) : wire;
      let result: StreamChatResult;
      try {
        const ask = () => stream(
          {
            ...call,
            ...session?.call,
            messages,
            ...(session?.metadata ? { metadata: session.metadata } : {}),
            ...(tools ? { tools, tool_choice: request.toolChoice ?? ('auto' as const) } : {}),
            ...(request.model ? { model: request.model } : {}),
            ...(request.strict !== undefined ? { modelStrict: request.strict } : {}),
            ...(request.role ? { role: request.role } : {}),
            ...(request.excludeModels && request.excludeModels.length > 0 ? { excludeModels: [...request.excludeModels] } : {}),
            ...(request.maxTokens !== undefined ? { maxTokens: request.maxTokens } : {}),
            ...(signal ? { signal } : {}),
          },
          session?.handlers ?? handlers?.(),
        );
        result = await (session?.around ? session.around(ask) : ask());
      } catch (e) {
        throw classified(session ? session.failed(e) : e);
      }
      await session?.completed(result);
      return toCompletion(result, request.model);
    },
    window: (model) => contextWindowOf(model, windows?.cloud ? { cloud: windows.cloud } : {}),
    ...(preflight ? { preflight: () => preflight() } : {}),
  };
}

/** The call metadata a run fixes — re-exported so an adapter names one type for it. */
export type { CompletionMetadata };
