/**
 * What one run of the native agent loop (`agent-loop.ts`) is configured with — the
 * contract the loop, its stateful {@link Agent} wrapper (`agent.ts`) and the PreFetch
 * preamble (`prefetch-preamble.ts`) share.
 */

import type { PolicyGate, RunKnowledgeLog } from "@builderforce/agent-tools";
import type { PrefetchPort } from "@builderforce/prefetch";
import type { AgentMessage } from "../model/agent-types.js";
import type { Message, Model } from "../model/types.js";

export interface AgentLoopConfig {
  model: Model;
  /**
   * The next model to try once the current one has burned its whole stall budget
   * without emitting a single tool call — i.e. re-prompting it is spent and only a
   * DIFFERENT model can finish the request. `tried` holds every {@link modelRef}
   * already attempted this run, the run's original pin included.
   *
   * OMITTED — or returning undefined — keeps the previous behaviour exactly: the run
   * ends on {@link stallExhaustedNotice} rather than switching. That default is the
   * point. An on-prem model is an operator's explicit pin, not a gateway auto-select,
   * so this loop never reaches for a catalog of its own: the HOST decides whether a
   * successor exists and what it may be (on-prem that is the operator's own configured
   * `agents.defaults.model.fallbacks` chain — see `createStallFallbackPicker`), and a
   * host that wired nothing up gets no substitution.
   *
   * The swap is never silent: it is announced on the transcript through
   * {@link AgentLoopConfig.onModelFallback} and bounded by `MAX_MODEL_FAILOVERS`.
   */
  pickFallbackModel?: (tried: readonly string[]) => Model | undefined;
  /**
   * Called when the loop switches models mid-run, with the user-facing notice that
   * says which model gave up and why. The loop also appends the notice to the
   * transcript; this is the seam a host uses to update its own "current model" state
   * and persist the swap (see {@link Agent}).
   */
  onModelFallback?: (from: Model, to: Model, notice: string) => void;
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
  /**
   * Compiled governance gates evaluated at tool dispatch (`beforeDispatch`).
   * A `block` / `require-approval` hit short-circuits `ports.dispatch` so the
   * tool never runs; the model sees the refusal as an error tool result.
   */
  policyGates?: readonly PolicyGate[];
  /**
   * THE run's record (`infra/run-knowledge-registry.ts`), when the host keeps one — so
   * this loop's per-turn brief and the run's note and code map are one record. Omitted
   * ⇒ the loop keeps its own for the brief.
   */
  knowledge?: RunKnowledgeLog;
  /** The deterministic-first PreFetch port (`prefetch-preamble.ts`); omitted ⇒ no gate. */
  prefetch?: PrefetchPort;
  /** PREFETCH output for this run's volatile tail — set by `agentLoop` from the gate. */
  prefetchTail?: readonly string[];
}
