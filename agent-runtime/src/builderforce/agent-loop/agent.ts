/**
 * Stateful agent — the pi-free analogue of pi-agent-core's `Agent`: holds a session's
 * conversation state and an injected {@link StreamFn}, and drives one native
 * {@link agentLoop} run per `prompt()`, with steering and follow-up queues.
 */

import type { PolicyGate, RunKnowledgeLog } from "@builderforce/agent-tools";
import type { PrefetchPort } from "@builderforce/prefetch";
import type {
  AgentContext,
  AgentEvent,
  AgentMessage,
  AgentTool,
  ThinkingLevel,
} from "../model/agent-types.js";
import type { Message, Model } from "../model/types.js";
import { agentLoop } from "./agent-loop.js";
import type { AgentLoopConfig } from "./agent-loop-config.js";
import { defaultConvertToLlm } from "./convert-to-llm.js";
import type { StreamFn } from "./stream.js";

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
  /** See {@link AgentLoopConfig.pickFallbackModel}. Omitted ⇒ no model substitution. */
  pickFallbackModel?: (tried: readonly string[]) => Model | undefined;
  /** See {@link AgentLoopConfig.onModelFallback}. The agent updates its own
   *  `state.model` on a swap regardless, so a host only needs this to persist it. */
  onModelFallback?: (from: Model, to: Model, notice: string) => void;
  /** See {@link AgentLoopConfig.policyGates}. */
  policyGates?: readonly PolicyGate[];
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
  /** THE run's record (see {@link AgentLoopConfig.knowledge}); set by the host per run. */
  knowledge?: RunKnowledgeLog;
  /** The PreFetch port (see {@link AgentLoopConfig.prefetch}); set by the host per run. */
  prefetch?: PrefetchPort;
  private pickFallbackModel?: (tried: readonly string[]) => Model | undefined;
  private onModelFallback?: (from: Model, to: Model, notice: string) => void;
  private policyGates?: readonly PolicyGate[];

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
    this.pickFallbackModel = opts.pickFallbackModel;
    this.onModelFallback = opts.onModelFallback;
    this.policyGates = opts.policyGates;
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
      ...(this.pickFallbackModel ? { pickFallbackModel: this.pickFallbackModel } : {}),
      // A stall failover changes who is answering for the REST of the session, not just
      // the rest of the turn: `setModel` here is what makes the next `prompt()` (and any
      // surface reading `state.model`) start from the model that actually works.
      onModelFallback: (from: Model, to: Model, notice: string) => {
        this.setModel(to);
        this.onModelFallback?.(from, to, notice);
      },
      ...(this.policyGates?.length ? { policyGates: this.policyGates } : {}),
      ...(this.knowledge ? { knowledge: this.knowledge } : {}),
      ...(this.prefetch ? { prefetch: this.prefetch } : {}),
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
