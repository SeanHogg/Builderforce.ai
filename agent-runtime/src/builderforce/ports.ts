/**
 * Domain port interfaces — abstractions the orchestrator depends on.
 *
 * These interfaces live in the domain layer (builderforce/) so the orchestrator
 * has zero direct imports from infra/. Concrete adapters in infra/ implement
 * them and are injected at gateway startup (server-startup.ts).
 *
 * Port taxonomy (Hexagonal Architecture):
 *   - ITelemetryService  — emit workflow/task lifecycle spans
 *   - IAgentMemoryService — recall similar memories, build team memory context
 *   - IAgentTransport — unified discover + dispatch for local/remote agentNodes
 *   - ILocalResultBroker — await results from locally-spawned subagents
 */

// ── Telemetry ─────────────────────────────────────────────────────────────────

export interface ITelemetryService {
  init(opts: {
    projectRoot: string;
    agentNodeId?: string | null;
    linkApiUrl?: string | null;
    linkApiKey?: string | null;
  }): void;
  emitWorkflowStart(workflowId: string, description?: string): void;
  emitWorkflowEnd(workflowId: string, failed: boolean): void;
  emitTaskStart(workflowId: string, taskId: string, agentRole: string, description: string): void;
  emitTaskEnd(
    workflowId: string,
    taskId: string,
    agentRole: string,
    startedAt: Date,
    error?: string,
    metrics?: {
      model?: string;
      inputTokens?: number;
      outputTokens?: number;
      estimatedCostUsd?: number;
    },
  ): void;
}

// ── Memory ────────────────────────────────────────────────────────────────────

export interface IAgentMemoryService {
  buildTeamMemoryContext(): Promise<string>;
  recallSimilar(query: string, limit: number): Promise<Array<{ key: string; content: string }>>;
  /** Optional: persist a memory entry. Builder `memory:write` nodes use this when
   *  the adapter provides it; absent → the node records intent and no-ops. */
  store?(key: string, content: string): Promise<void>;
  /** Optional: ingest source text into the knowledge base; returns the number of
   *  chunks ingested. Builder `knowledge:ingest` nodes use this when present. */
  ingest?(source: string, namespace?: string): Promise<number>;
  /** Optional: fine-tune/distil the hippocampus on `dataset` for `epochs` passes
   *  and persist the adapted weights. Builder `train` nodes use this when present;
   *  returns a short human-readable summary of what was trained. */
  train?(opts: { model: string; dataset: string; epochs: number }): Promise<string>;
}

// ── Limbic system (dynamic affective/motivational layer) ──────────────────────

import type { CompiledLimbic, LimbicEvent, LimbicState } from "./limbic.js";

/**
 * The agent's limbic system — the dynamic counterpart to the static psychometric
 * personality. Tracks a live affective state and drives it through the brain
 * regions (amygdala/hypothalamus/thalamus/basal-ganglia) in response to
 * experience. Optional: absent → the agent runs at a flat neutral affect.
 */
export interface ILimbicSystem {
  /** Amygdala: appraise an event and update the live affective state. */
  appraise(event: LimbicEvent): Promise<LimbicState>;
  /** Current affective state (a copy). */
  snapshot(): LimbicState;
  /** Hypothalamus: relax drives toward personality setpoints; optional fatigue. */
  tick(opts?: { fatigue?: number }): LimbicState;
  /** Thalamus: current attention-gate gain in [0,1]. */
  attention(): number;
  /** Compile the current state into prompt directives + execution levers. */
  compile(): CompiledLimbic;
  /** Optional: train the affective model on observed experiences and persist. */
  train?(): Promise<number[] | null>;
}

// ── LLM platform calls (builder `llm` nodes) ──────────────────────────────────

export interface LlmCompletionRequest {
  /** Provider id (openai, anthropic, gemini…); the gateway routes/maps it. */
  provider?: string;
  model?: string;
  system?: string;
  prompt: string;
  temperature?: number;
}

/** Calls an LLM platform — implemented over the Builderforce OpenAI-compatible
 *  gateway. Builder `llm` nodes use this; absent → the node records intent. */
export interface ILlmService {
  complete(req: LlmCompletionRequest): Promise<string>;
}

// ── MCP / SaaS integration invocation (builder `mcp` nodes) ───────────────────

export interface McpInvocation {
  integration: string;
  operation: string;
  params: Record<string, unknown>;
}

/** Invokes an MCP-server / SaaS integration tool. Builder `mcp` nodes use this;
 *  absent → the node records intent. */
export interface IMcpService {
  invoke(call: McpInvocation): Promise<string>;
}

// ── Agent transport (unified local + remote dispatch) ─────────────────────────

export type AgentTransportKind = "local" | "remote";

export interface AgentTransportEntry {
  id: string;
  name: string;
  online: boolean;
  capabilities: string[];
  kind: AgentTransportKind;
}

export interface AgentTransportDispatchPayload {
  target: string;
  input: string;
  requiredCapabilities?: string[];
  correlationId?: string;
  callbackAgentNodeId?: string;
  timeoutMs?: number;
}

export type AgentTransportDispatchResult =
  | { status: "accepted"; targetId: string; output?: string; childSessionKey?: string }
  | { status: "failed"; error: string; targetId?: string };

/** Unified transport interface for local + remote agentNode dispatch. */
export interface IAgentTransport {
  discover(requiredCapabilities?: string[]): Promise<AgentTransportEntry[]>;
  dispatch(payload: AgentTransportDispatchPayload): Promise<AgentTransportDispatchResult>;
  register?(entry: AgentTransportEntry): Promise<void> | void;
}

// ── Local result broker ───────────────────────────────────────────────────────

export interface ILocalResultBroker {
  awaitResult(runId: string, childSessionKey: string, timeoutMs: number): Promise<string>;
}
