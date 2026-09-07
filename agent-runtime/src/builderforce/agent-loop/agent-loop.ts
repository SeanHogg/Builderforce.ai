/**
 * Native agent loop — the pi-free replacement for `@mariozechner/pi-agent-core`'s
 * `agentLoop` + `Agent` (PI cutover, loop stage). Drives THE shared agent loop
 * (`@builderforce/agent-loop`) over an injected
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
import type { AssistantMessage, Message, Model, ToolResultMessage } from "../model/types.js";
import { runAgentLoop, type LoopCodec, type LoopHooks, type LoopPorts } from "@builderforce/agent-loop";
import { EventStream } from "./event-stream.js";
import type { StreamFn } from "./stream.js";
import {
  shouldRecoverStalledTurn,
  isExhaustedStall,
  stallShape,
  stallRecoveryNudge,
  stallExhaustedNotice,
  MAX_ANNOUNCEMENT_RECOVERIES,
} from "@builderforce/agent-stall";

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

/** Visible text of an assistant turn — thinking blocks and tool calls excluded, since
 *  only what the USER was left holding decides whether the turn stalled. */
function assistantText(message: import("../model/types.js").AssistantMessage): string {
  return message.content
    .filter((c): c is import("../model/types.js").TextContent => c.type === "text")
    .map((c) => c.text)
    .join("\n");
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
  // Budget for the announced-but-untaken tool call recovery below, shared with the
  // Brain run loop via `@builderforce/agent-stall`.
  let announcementRecoveries = 0;
  // The run's own tool NAMES and the request it was given — the two facts the HANDOFF
  // shape needs. Captured once, before the loop starts pushing its own recovery
  // messages in as `user` turns: reading the newest user message later would ask
  // "did the user ask for a change?" of a nudge this loop wrote itself.
  const toolNames = (currentContext.tools ?? []).map((t) => t.name);
  const userRequest = [...currentContext.messages]
    .reverse()
    .find((m): m is Extract<AgentMessage, { role: "user" }> => m.role === "user")
    ?.content ?? "";

  // ── THE loop ────────────────────────────────────────────────────────────────
  // The model→tools→model skeleton lives ONCE in `@builderforce/agent-loop` (the same
  // kernel the cloud engine, the Brain and the canvas drive). The pi-shaped protocol —
  // `AgentMessage` rows, the event stream, steering that skips the rest of a turn,
  // follow-ups after the run would stop — is the codec and the hooks below.
  /** The model errored or was aborted: the whole run ends, follow-ups included. */
  let terminated = false as boolean;
  /** The assistant message of the turn in flight, and its tool results, for `turn_end`. */
  let turnMessage: AssistantMessage | null = null;
  let turnResults: ToolResultMessage[] = [];
  /** Steering that arrived mid-turn: the remaining calls of this turn are skipped. */
  let steeringAfterTools: AgentMessage[] | null = null;
  const skipped: ToolResultLike = {
    content: [{ type: "text", text: "Skipped due to queued user message." }],
    details: {},
  };
  const pushBoth = (m: AgentMessage): void => {
    currentContext.messages.push(m);
    newMessages.push(m);
  };
  const isTerminal = (m: AssistantMessage): boolean => m.stopReason === "error" || m.stopReason === "aborted";

  const codec: LoopCodec<AgentMessage> = {
    assistant: (turn) => turn.meta as AssistantMessage,
    tool: (call, result) => {
      const r = result.data as ToolResultLike;
      return {
        role: "toolResult",
        toolCallId: call.id,
        toolName: call.name,
        content: r.content,
        details: r.details,
        isError: result.isError === true,
        timestamp: Date.now(),
      };
    },
  };

  const ports: LoopPorts<AgentMessage> = {
    complete: async () => {
      const message = await streamAssistantResponse(currentContext, config, signal, stream, streamFn);
      // An errored / aborted turn never executes its calls: it is handed to the
      // no-tool-calls path, which records it and ends the run.
      const toolCalls = isTerminal(message)
        ? []
        : message.content.filter(isToolCall).map((tc) => ({ id: tc.id, name: tc.name, arguments: JSON.stringify(tc.arguments ?? {}) }));
      return { content: assistantText(message), toolCalls, meta: message };
    },
    dispatch: async (call) => {
      const tool = currentContext.tools?.find((t) => t.name === call.name);
      try {
        if (!tool) throw new Error(`Tool ${call.name} not found`);
        const result = await tool.execute(call.id, call.args, signal, (partialResult) => {
          stream.push({
            type: "tool_execution_update",
            toolCallId: call.id,
            toolName: call.name,
            args: call.args,
            partialResult,
          });
        });
        return { data: result };
      } catch (e) {
        const result: ToolResultLike = {
          content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }],
          details: {},
        };
        return { data: result, isError: true };
      }
    },
  };

  const hooks: LoopHooks<AgentMessage> = {
    beforeTurn: () => {
      if (!firstTurn) stream.push({ type: "turn_start" });
      else firstTurn = false;
      if (pendingMessages.length > 0) {
        for (const message of pendingMessages) {
          stream.push({ type: "message_start", message });
          stream.push({ type: "message_end", message });
          pushBoth(message);
        }
        pendingMessages = [];
      }
      turnMessage = null;
      turnResults = [];
      steeringAfterTools = null;
      return undefined;
    },
    onNoToolCalls: async (_ctx, turn) => {
      const message = turn.meta as AssistantMessage;
      pushBoth(message);
      stream.push({ type: "turn_end", message, toolResults: [] });
      if (isTerminal(message)) {
        terminated = true;
        return { action: "stop", ok: false };
      }
      pendingMessages = (await config.getSteeringMessages?.()) || [];
      // The model ANNOUNCED an action and then ended the turn without taking it
      // ("I'll search the codebase for the handler." → stopReason: stop, 0 tool
      // calls). Treating that as "no tool calls, therefore done" ends the run with a
      // promise as its result — for an autonomous run that is a silent no-op that
      // still burns the run. Re-prompt instead, bounded per run so a model that keeps
      // narrating can't spin. Nothing to do when steering already queued work.
      const stallInput = {
        text: assistantText(message),
        toolCallCount: 0,
        availableToolCount: currentContext.tools?.length ?? 0,
        recoveriesUsed: announcementRecoveries,
        availableToolNames: toolNames,
        requestText: typeof userRequest === "string" ? userRequest : "",
      };
      // An autonomous run has NOBODY to hand commands to — a turn that ends "now run
      // the tests and commit" is a no-op dressed as a completed step, and the ticket
      // ledger records it as done. Same budget, different correction; see `stallShape`.
      const shape = stallShape(stallInput);
      if (pendingMessages.length === 0 && shouldRecoverStalledTurn(stallInput)) {
        announcementRecoveries += 1;
        pendingMessages = [
          {
            role: "user",
            content: stallRecoveryNudge(announcementRecoveries >= MAX_ANNOUNCEMENT_RECOVERIES, shape),
            timestamp: Date.now(),
          },
        ];
      } else if (pendingMessages.length === 0 && isExhaustedStall(stallInput)) {
        // Every recovery spent and the model is STILL only describing calls. Ending
        // here silently leaves a promise as the run's result — for an autonomous run
        // that reads as a completed step that did nothing. Append the reason to the
        // transcript so the run output, the ticket ledger and any human reviewer see
        // WHY it produced nothing, instead of inferring success from a clean exit.
        pushBoth({
          role: "user",
          content: stallExhaustedNotice(config.model?.id, undefined, shape),
          timestamp: Date.now(),
        });
      }
      return pendingMessages.length > 0 ? { action: "continue" } : { action: "stop", ok: true };
    },
    beforeToolCalls: (_ctx, turn) => {
      // The kernel pushes the assistant row onto the context; the run's own
      // `newMessages` ledger gets it here.
      turnMessage = turn.meta as AssistantMessage;
      newMessages.push(turnMessage);
      return undefined;
    },
    beforeDispatch: (call) => {
      stream.push({
        type: "tool_execution_start",
        toolCallId: call.id,
        toolName: call.name,
        args: call.args,
      });
      if (steeringAfterTools) {
        // A queued user message outranks the rest of this turn's calls.
        stream.push({ type: "tool_execution_end", toolCallId: call.id, toolName: call.name, result: skipped, isError: true });
        return { result: { data: skipped, isError: true } };
      }
      return undefined;
    },
    afterDispatch: async (call, result, row) => {
      const toolResultMessage = row as ToolResultMessage;
      if (!steeringAfterTools) {
        stream.push({
          type: "tool_execution_end",
          toolCallId: call.id,
          toolName: call.name,
          result: result.data as ToolResultLike,
          isError: result.isError === true,
        });
      }
      turnResults.push(toolResultMessage);
      newMessages.push(toolResultMessage);
      stream.push({ type: "message_start", message: toolResultMessage });
      stream.push({ type: "message_end", message: toolResultMessage });
      if (!steeringAfterTools && config.getSteeringMessages) {
        const steering = await config.getSteeringMessages();
        if (steering.length > 0) steeringAfterTools = steering;
      }
      return undefined;
    },
    afterToolCalls: async () => {
      if (turnMessage) stream.push({ type: "turn_end", message: turnMessage, toolResults: turnResults });
      pendingMessages = steeringAfterTools ?? ((await config.getSteeringMessages?.()) || []);
      return undefined;
    },
  };

  while (true) {
    // No `signal` for the kernel: the stream and the tools receive it directly and an
    // abort surfaces as a `stopReason: "aborted"` message, recorded like any other.
    await runAgentLoop<AgentMessage>({
      messages: currentContext.messages,
      codec,
      ports,
      hooks,
      budget: { stepCap: Number.POSITIVE_INFINITY },
    });
    if (terminated) break;
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
