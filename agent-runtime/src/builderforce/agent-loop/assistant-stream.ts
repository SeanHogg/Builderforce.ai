/**
 * One assistant turn of the native agent loop (`agent-loop.ts`): build the request —
 * the transcript, then the run's volatile tail (its ledger brief and any PREFETCH
 * facts) — stream it through the injected {@link StreamFn}, and relay the stream as the
 * `AgentEvent` protocol the on-prem surfaces subscribe to.
 */

import { volatileTail } from "@seanhogg/builderforce-memory/handoff";
import type { AgentContext, AgentEvent, AgentMessage } from "../model/agent-types.js";
import type { AssistantMessage, Model } from "../model/types.js";
import type { AgentLoopConfig } from "./agent-loop-config.js";
import { EventStream } from "./event-stream.js";
import type { StreamFn } from "./stream.js";

/** The run's event stream: it settles on `agent_end`, with the run's new messages. */
export function createAgentStream(): EventStream<AgentEvent, AgentMessage[]> {
  return new EventStream<AgentEvent, AgentMessage[]>(
    (event) => event.type === "agent_end",
    (event) => (event.type === "agent_end" ? event.messages : []),
  );
}

export async function streamAssistantResponse(
  context: AgentContext,
  config: AgentLoopConfig,
  /** The model THIS turn runs on — `config.model` for most runs, a successor after a
   *  stall failover. Passed explicitly rather than read off `config` so the loop never
   *  mutates a caller-owned config object to change who is answering. */
  model: Model,
  signal: AbortSignal | undefined,
  stream: EventStream<AgentEvent, AgentMessage[]>,
  streamFn: StreamFn,
  /** The run's record of what it already did (its `brief()`), on THIS request only. */
  ledger?: string | null,
): Promise<AssistantMessage> {
  // A tagged volatile tail: the cache breakpoint lands before it, and it rides last.
  const tail = volatileTail([ledger, ...(config.prefetchTail ?? [])]);
  let messages = context.messages;
  if (config.transformContext) messages = await config.transformContext(messages, signal);
  const llmMessages = await config.convertToLlm(messages);
  const llmContext = {
    systemPrompt: context.systemPrompt,
    messages: tail ? [...llmMessages, { ...tail, timestamp: Date.now() }] : llmMessages,
    tools: context.tools,
  };

  const resolvedApiKey =
    (config.getApiKey ? await config.getApiKey(model.provider) : undefined) || config.apiKey;
  const response = await streamFn(model, llmContext, {
    apiKey: resolvedApiKey,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    signal,
  });

  for await (const event of response) {
    if (event.type === "start") {
      stream.push({ type: "message_start", message: { ...event.partial } });
    } else if (event.type === "done" || event.type === "error") {
      const finalMessage = await response.result();
      stream.push({ type: "message_end", message: finalMessage });
      return finalMessage;
    } else {
      stream.push({
        type: "message_update",
        assistantMessageEvent: event,
        message: { ...event.partial },
      });
    }
  }
  return response.result();
}
