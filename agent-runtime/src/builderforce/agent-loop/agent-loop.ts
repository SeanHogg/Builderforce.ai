/**
 * Native agent loop — the pi-free replacement for `@mariozechner/pi-agent-core`'s
 * `agentLoop` + `Agent` (PI cutover, loop stage). Drives a turn loop over an injected
 * {@link StreamFn}: stream an assistant message, execute its tool calls against the
 * provided {@link AgentTool}s, append results, repeat until no tool calls — honoring
 * mid-run steering + queued follow-ups. Emits the `AgentEvent` protocol the on-prem
 * surfaces subscribe to. Faithful to pi-agent-core 0.54's loop semantics.
 */

import type {
  AgentContext,
  AgentEvent,
  AgentMessage,
  AgentTool,
  AgentToolResult,
  ThinkingLevel,
} from "../model/agent-types.js";
import type { Message, Model, ToolResultMessage } from "../model/types.js";
import { EventStream } from "./event-stream.js";
import type { StreamFn } from "./stream.js";

export interface AgentLoopConfig {
  model: Model;
  /** Converts AgentMessage[] to LLM-compatible Message[] before each LLM call. */
  convertToLlm: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;
  /** Optional AgentMessage[] → AgentMessage[] transform applied before conversion. */
  transformContext?: (
    messages: AgentMessage[],
    signal?: AbortSignal,
  ) => AgentMessage[] | Promise<AgentMessage[]>;
  getSteeringMessages?: () => AgentMessage[] | Promise<AgentMessage[]>;
  getFollowUpMessages?: () => AgentMessage[] | Promise<AgentMessage[]>;
  getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
  apiKey?: string;
  temperature?: number;
  maxTokens?: number;
}

type ToolResultLike = AgentToolResult<unknown>;

function isToolCall(c: { type: string }): c is import("../model/types.js").ToolCall {
  return c.type === "toolCall";
}

/** Default identity conversion: fold non-LLM AgentMessages into plain LLM messages. */
export function defaultConvertToLlm(messages: AgentMessage[]): Message[] {
  const out: Message[] = [];
  for (const m of messages) {
    switch (m.role) {
      case "user":
      case "assistant":
      case "toolResult":
        out.push(m);
        break;
      case "compactionSummary":
        out.push({ role: "user", content: m.summary, timestamp: m.timestamp });
        break;
      case "branchSummary":
        out.push({ role: "user", content: m.summary, timestamp: m.timestamp });
        break;
      case "custom":
        if (m.display !== false) {
          const content = typeof m.content === "string" ? m.content : m.content;
          out.push({ role: "user", content, timestamp: m.timestamp });
        }
        break;
      case "bashExecution":
        if (!m.excludeFromContext) {
          out.push({
            role: "user",
            content: `\$ ${m.command}\n${m.output}`,
            timestamp: m.timestamp,
          });
        }
        break;
    }
  }
  return out;
}

function createAgentStream(): EventStream<AgentEvent, AgentMessage[]> {
  return new EventStream<AgentEvent, AgentMessage[]>(
    (event) => event.type === "agent_end",
    (event) => (event.type === "agent_end" ? event.messages : []),
  );
}

async function executeToolCalls(
  tools: AgentTool[] | undefined,
  assistantMessage: import("../model/types.js").AssistantMessage,
  signal: AbortSignal | undefined,
  stream: EventStream<AgentEvent, AgentMessage[]>,
  getSteeringMessages?: () => AgentMessage[] | Promise<AgentMessage[]>,
): Promise<{ toolResults: ToolResultMessage[]; steeringMessages?: AgentMessage[] }> {
  const toolCalls = assistantMessage.content.filter(isToolCall);
  const results: ToolResultMessage[] = [];
  let steeringMessages: AgentMessage[] | undefined;

  for (let index = 0; index < toolCalls.length; index++) {
    const toolCall = toolCalls[index];
    const tool = tools?.find((t) => t.name === toolCall.name);
    stream.push({
      type: "tool_execution_start",
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      args: toolCall.arguments,
    });

    let result: ToolResultLike;
    let isError = false;
    try {
      if (!tool) throw new Error(`Tool ${toolCall.name} not found`);
      result = await tool.execute(toolCall.id, toolCall.arguments, signal, (partialResult) => {
        stream.push({
          type: "tool_execution_update",
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          args: toolCall.arguments,
          partialResult,
        });
      });
    } catch (e) {
      result = {
        content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }],
        details: {},
      };
      isError = true;
    }

    stream.push({
      type: "tool_execution_end",
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      result,
      isError,
    });
    const toolResultMessage: ToolResultMessage = {
      role: "toolResult",
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      content: result.content,
      details: result.details,
      isError,
      timestamp: Date.now(),
    };
    results.push(toolResultMessage);
    stream.push({ type: "message_start", message: toolResultMessage });
    stream.push({ type: "message_end", message: toolResultMessage });

    if (getSteeringMessages) {
      const steering = await getSteeringMessages();
      if (steering.length > 0) {
        steeringMessages = steering;
        for (const skipped of toolCalls.slice(index + 1))
          results.push(skipToolCall(skipped, stream));
        break;
      }
    }
  }
  return { toolResults: results, steeringMessages };
}

function skipToolCall(
  toolCall: import("../model/types.js").ToolCall,
  stream: EventStream<AgentEvent, AgentMessage[]>,
): ToolResultMessage {
  const result: ToolResultLike = {
    content: [{ type: "text", text: "Skipped due to queued user message." }],
    details: {},
  };
  stream.push({
    type: "tool_execution_start",
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    args: toolCall.arguments,
  });
  stream.push({
    type: "tool_execution_end",
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    result,
    isError: true,
  });
  const toolResultMessage: ToolResultMessage = {
    role: "toolResult",
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    content: result.content,
    details: {},
    isError: true,
    timestamp: Date.now(),
  };
  stream.push({ type: "message_start", message: toolResultMessage });
  stream.push({ type: "message_end", message: toolResultMessage });
  return toolResultMessage;
}

async function streamAssistantResponse(
  context: AgentContext,
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  stream: EventStream<AgentEvent, AgentMessage[]>,
  streamFn: StreamFn,
): Promise<import("../model/types.js").AssistantMessage> {
  let messages = context.messages;
  if (config.transformContext) messages = await config.transformContext(messages, signal);
  const llmMessages = await config.convertToLlm(messages);
  const llmContext = {
    systemPrompt: context.systemPrompt,
    messages: llmMessages,
    tools: context.tools,
  };

  const resolvedApiKey =
    (config.getApiKey ? await config.getApiKey(config.model.provider) : undefined) || config.apiKey;
  const response = await streamFn(config.model, llmContext, {
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

async function runLoop(
  currentContext: AgentContext,
  newMessages: AgentMessage[],
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  stream: EventStream<AgentEvent, AgentMessage[]>,
  streamFn: StreamFn,
): Promise<void> {
  let firstTurn = true;
  let pendingMessages: AgentMessage[] = (await config.getSteeringMessages?.()) || [];

  while (true) {
    let hasMoreToolCalls = true;
    while (hasMoreToolCalls || pendingMessages.length > 0) {
      if (!firstTurn) stream.push({ type: "turn_start" });
      else firstTurn = false;

      if (pendingMessages.length > 0) {
        for (const message of pendingMessages) {
          stream.push({ type: "message_start", message });
          stream.push({ type: "message_end", message });
          currentContext.messages.push(message);
          newMessages.push(message);
        }
        pendingMessages = [];
      }

      const message = await streamAssistantResponse(
        currentContext,
        config,
        signal,
        stream,
        streamFn,
      );
      currentContext.messages.push(message);
      newMessages.push(message);

      if (message.stopReason === "error" || message.stopReason === "aborted") {
        stream.push({ type: "turn_end", message, toolResults: [] });
        stream.push({ type: "agent_end", messages: newMessages });
        stream.end(newMessages);
        return;
      }

      const toolCalls = message.content.filter(isToolCall);
      hasMoreToolCalls = toolCalls.length > 0;
      const toolResults: ToolResultMessage[] = [];
      let steeringAfterTools: AgentMessage[] | null = null;
      if (hasMoreToolCalls) {
        const exec = await executeToolCalls(
          currentContext.tools,
          message,
          signal,
          stream,
          config.getSteeringMessages,
        );
        toolResults.push(...exec.toolResults);
        steeringAfterTools = exec.steeringMessages ?? null;
        for (const result of toolResults) {
          currentContext.messages.push(result);
          newMessages.push(result);
        }
      }
      stream.push({ type: "turn_end", message, toolResults });

      if (steeringAfterTools && steeringAfterTools.length > 0) pendingMessages = steeringAfterTools;
      else pendingMessages = (await config.getSteeringMessages?.()) || [];
    }

    const followUpMessages = (await config.getFollowUpMessages?.()) || [];
    if (followUpMessages.length > 0) {
      pendingMessages = followUpMessages;
      continue;
    }
    break;
  }
  stream.push({ type: "agent_end", messages: newMessages });
  stream.end(newMessages);
}

/** Start an agent loop with new prompt message(s). */
export function agentLoop(
  prompts: AgentMessage[],
  context: AgentContext,
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  streamFn: StreamFn,
): EventStream<AgentEvent, AgentMessage[]> {
  const stream = createAgentStream();
  void (async () => {
    const newMessages = [...prompts];
    const currentContext: AgentContext = {
      ...context,
      messages: [...context.messages, ...prompts],
    };
    stream.push({ type: "agent_start" });
    stream.push({ type: "turn_start" });
    for (const prompt of prompts) {
      stream.push({ type: "message_start", message: prompt });
      stream.push({ type: "message_end", message: prompt });
    }
    await runLoop(currentContext, newMessages, config, signal, stream, streamFn);
  })();
  return stream;
}

// ── Agent — stateful wrapper over agentLoop ──────────────────────────────────

export interface AgentState {
  systemPrompt: string;
  model: Model;
  thinkingLevel: ThinkingLevel;
  tools: AgentTool[];
  messages: AgentMessage[];
  isStreaming: boolean;
}

export interface AgentOptions {
  systemPrompt?: string;
  model: Model;
  thinkingLevel?: ThinkingLevel;
  tools?: AgentTool[];
  convertToLlm?: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;
  transformContext?: (
    messages: AgentMessage[],
    signal?: AbortSignal,
  ) => AgentMessage[] | Promise<AgentMessage[]>;
  getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
}

/**
 * Stateful agent — holds conversation state + an injected {@link StreamFn}, exposes
 * `subscribe`/`prompt`/`steer`/`abort`. The pi-free analogue of pi-agent-core's `Agent`.
 */
export class Agent {
  streamFn!: StreamFn;
  private _state: AgentState;
  private listeners = new Set<(e: AgentEvent) => void>();
  private abortController?: AbortController;
  private convertToLlm: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;
  private transformContext?: (
    messages: AgentMessage[],
    signal?: AbortSignal,
  ) => AgentMessage[] | Promise<AgentMessage[]>;
  private steeringQueue: AgentMessage[] = [];
  private followUpQueue: AgentMessage[] = [];
  getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
  sessionId?: string;

  constructor(opts: AgentOptions) {
    this._state = {
      systemPrompt: opts.systemPrompt ?? "",
      model: opts.model,
      thinkingLevel: opts.thinkingLevel ?? "off",
      tools: opts.tools ?? [],
      messages: [],
      isStreaming: false,
    };
    this.convertToLlm = opts.convertToLlm ?? defaultConvertToLlm;
    this.transformContext = opts.transformContext;
    this.getApiKey = opts.getApiKey;
  }

  get state(): AgentState {
    return this._state;
  }
  get isStreaming(): boolean {
    return this._state.isStreaming;
  }
  subscribe(fn: (e: AgentEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(e: AgentEvent): void {
    for (const fn of this.listeners) fn(e);
  }
  setSystemPrompt(v: string): void {
    this._state.systemPrompt = v;
  }
  setModel(m: Model): void {
    this._state.model = m;
  }
  setThinkingLevel(l: ThinkingLevel): void {
    this._state.thinkingLevel = l;
  }
  setTools(t: AgentTool[]): void {
    this._state.tools = t;
  }
  replaceMessages(ms: AgentMessage[]): void {
    this._state.messages = [...ms];
  }
  appendMessage(m: AgentMessage): void {
    this._state.messages.push(m);
  }
  /** Queue a steering message to interrupt the agent mid-run. */
  steer(m: AgentMessage): void {
    this.steeringQueue.push(m);
  }
  /** Queue a follow-up message processed after the current run would stop. */
  followUp(m: AgentMessage): void {
    this.followUpQueue.push(m);
  }
  abort(): void {
    this.abortController?.abort();
  }

  /** Resolve once the agent is not mid-stream (best-effort idle barrier for flush points). */
  async waitForIdle(): Promise<void> {
    while (this._state.isStreaming) await new Promise((r) => setTimeout(r, 10));
  }

  /** Run the loop with new prompt message(s); resolves when the agent stops. */
  async prompt(prompts: AgentMessage[]): Promise<AgentMessage[]> {
    this.abortController = new AbortController();
    this._state.isStreaming = true;
    const config: AgentLoopConfig = {
      model: this._state.model,
      convertToLlm: this.convertToLlm,
      transformContext: this.transformContext,
      getApiKey: this.getApiKey,
      getSteeringMessages: () => {
        const q = this.steeringQueue;
        this.steeringQueue = [];
        return q;
      },
      getFollowUpMessages: () => {
        const q = this.followUpQueue;
        this.followUpQueue = [];
        return q;
      },
    };
    const context: AgentContext = {
      systemPrompt: this._state.systemPrompt,
      messages: this._state.messages,
      tools: this._state.tools,
    };
    const stream = agentLoop(prompts, context, config, this.abortController.signal, this.streamFn);
    try {
      for await (const event of stream) this.emit(event);
      const all = await stream.result();
      this._state.messages = [...this._state.messages, ...all];
      return all;
    } finally {
      this._state.isStreaming = false;
    }
  }
}
