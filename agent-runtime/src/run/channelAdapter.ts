/**
 * channelAdapter — the ON-PREM entry point of the one agent for CHANNELS, cron and the embedded runner (PRD 35 WS5, §3.1).
 *
 * It BUILDS PORTS and calls `runAgent`; it has no loop, no policy and no branch on behaviour. `RunPolicy.entryPoint` is the
 * telemetry label `on-prem` and is never read. Every difference between a channel run and a ticket, a cloud run or the editor
 * arrives as a port:
 *
 *   model        — the runner's provider stream (`channelModel`), its events forwarded to the surface as the answer is written;
 *   platform     — the runner's own tools as the run's closed catalog (`channelTools`);
 *   store        — in memory: a channel run is one invocation; it announces each row so the surface hears it (`agentEventBridge`);
 *   events       — the agent's trace, told as the `AgentEvent` protocol the session and the subscribers speak, and the uniform
 *                  outcome row, reported to the fleet (`outcomeReporter`);
 *   human        — the process-wide approval gate (`onPremHuman`), as for tickets;
 *   steering     — the Agent's steering and follow-up queues;
 *   context      — the PreFetch gate (an ANSWER settles the run, PREFETCH facts ride the tail) and the run's ledger brief.
 *
 * The seam the embedded runner keeps: {@link runChannelAgent} returns the `EventStream<AgentEvent, AgentMessage[]>` that
 * `agent-loop.ts`'s `agentLoop` always returned, so the Agent, the session and the runner are unchanged.
 */

import { RUN_CANCELLED_REASON, asksForSubagents, compactionReserve, runAgent } from "@builderforce/agent-run";
import type { ContextSource, RunPolicy, RunPorts, RunTask, SteeringSource, SteerInput } from "@builderforce/agent-run";
import { RunKnowledgeRecorder, type CapabilityProvider } from "@builderforce/agent-tools";
import { randomUUID } from "node:crypto";
import type { AgentLoopConfig } from "../builderforce/agent-loop/agent-loop-config.js";
import type { EventStream } from "../builderforce/agent-loop/event-stream.js";
import { promptText, runPrefetchPreamble, type PrefetchPreamble } from "../builderforce/agent-loop/prefetch-preamble.js";
import { modelRef } from "../builderforce/agent-loop/stall-recovery.js";
import type { StreamFn } from "../builderforce/agent-loop/stream.js";
import type { AgentContext, AgentEvent, AgentMessage } from "../builderforce/model/agent-types.js";
import { resolveContextWindowTokens } from "../agents/context-window.js";
import { requestHumanInput } from "../infra/approval-gate.js";
import { onDeviceCostLeverOn } from "../infra/cost-levers.js";
import { logWarn } from "../logger.js";
import { AgentEventBridge } from "./agentEventBridge.js";
import { textOf, toRunRow } from "./channelMessages.js";
import { ChannelModels, channelModelTransport } from "./channelModel.js";
import { channelTools } from "./channelTools.js";
import { onPremHuman } from "./onPremHuman.js";
import { reportRunRow } from "./outcomeReporter.js";

export interface ChannelRunInput {
  prompts: AgentMessage[];
  context: AgentContext;
  config: AgentLoopConfig;
  signal: AbortSignal | undefined;
  streamFn: StreamFn;
}

/** The queued messages of the Agent as the agent's steered input: their text, and the pictures they carry. */
function steered(messages: readonly AgentMessage[]): SteerInput[] {
  return messages.map((m) => {
    const row = toRunRow(m);
    return { text: row.content || textOf((m as { content?: unknown }).content), ...(row.parts?.length ? { parts: row.parts } : {}) };
  });
}

/** The policy DATA of a channel run. How the run behaves is the agent's. */
function policyOf(config: AgentLoopConfig, request: string): RunPolicy {
  return {
    entryPoint: "on-prem",
    toolScope: "chat-work",
    role: "code",
    // Cost lever C9 (compaction under a long-context price tier) is read the on-device way: a partial rollout buckets by install.
    levers: onDeviceCostLeverOn("c9_price_tier_budget") ? ["c9_price_tier_budget"] : [],
    // The history is cut at the model's WINDOW, not the cloud's cost cap, and the reply reserve is on-prem's (its floor, or the turn's max_tokens).
    budgets: { tokens: resolveContextWindowTokens(config.model), reserveTokens: compactionReserve(config.maxTokens) },
    pinnedModel: modelRef(config.model),
    inference: "hybrid",
    verify: "none",
    approvalGates: [...(config.policyGates ?? [])],
    delegation: { requested: asksForSubagents(request), readsBeforeNudge: 6 },
    // A stall with nothing left to try ends the run, and the conversation says why it produced nothing.
    stallExhausted: "note",
  };
}

/** The steering port: the Agent's own queues. */
function steeringOf(config: AgentLoopConfig): SteeringSource {
  return {
    drain: async () => steered((await config.getSteeringMessages?.()) ?? []),
    followUp: async () => steered((await config.getFollowUpMessages?.()) ?? []),
    ...(config.hasSteeringMessages ? { hasInterrupt: config.hasSteeringMessages } : {}),
    ...(config.onSteeringMessage ? { onInterrupt: config.onSteeringMessage } : {}),
  };
}

/** The context port: the PreFetch gate before turn 1, and the sections every request's tail carries. */
function contextOf(config: AgentLoopConfig, prompts: readonly AgentMessage[], signal: AbortSignal | undefined, knowledge: RunKnowledgeRecorder): ContextSource {
  let gate: PrefetchPreamble = { tail: [], pass: null };
  return {
    pack: async () => {
      gate = await runPrefetchPreamble(config.prefetch, prompts, signal);
      return { focus: [], facts: [], recall: [], ...(gate.answer !== undefined ? { answer: gate.answer } : {}) };
    },
    // What this run has read, searched and changed (the host's record), restated in front of each request, then the PREFETCH facts.
    turnSections: () => [(config.knowledge ?? knowledge).brief(), ...gate.tail].filter((s): s is string => typeof s === "string" && s.length > 0),
  };
}

/**
 * Run one channel prompt through the one agent. The stream settles on the run's new messages, exactly as the native loop's did.
 * Never throws: a run that crashes still ends its stream, with the messages it had.
 */
export function runChannelAgent(input: ChannelRunInput): EventStream<AgentEvent, AgentMessage[]> {
  const { prompts, context, config, signal, streamFn } = input;
  const models = new ChannelModels(config.model);
  const bridge = new AgentEventBridge({
    activeModel: () => models.active,
    onSwap: (swap) => {
      const from = models.resolve(swap.from);
      const to = models.resolve(swap.to);
      models.active = to;
      config.onModelFallback?.(from, to, swap.notice);
    },
  });

  void (async () => {
    try {
      bridge.start(prompts);
      const request = promptText(prompts);
      const knowledge = new RunKnowledgeRecorder();
      const tools = context.tools ?? [];
      const capabilities: CapabilityProvider = { capabilities: new Set() };
      const ports: RunPorts = {
        model: channelModelTransport({ models, streamFn, config, tools, bridge }),
        capabilities,
        store: { load: () => undefined, save: () => undefined, appended: bridge.appended },
        // The run's uniform outcome row (§8.2), written once at its end. A channel run has no execution id: the row is keyed by the
        // run's own id (`task.runId`) and carries the model that served it; nothing else is claimed.
        events: { emit: bridge.emit, outcome: (row) => reportRunRow(row) },
        // A governance gate guards an act: with no approver to reach, the call is refused (the ticket path keeps its standalone default).
        human: onPremHuman(() => capabilities, (request) => requestHumanInput({ ...request, failClosed: true })),
        // The channel's runs close with what the model said: no forced no-tools turn after a tripped breaker (the runner never had one).
        delivery: { rungs: () => [], owns: { synthesis: true } },
        steering: steeringOf(config),
        context: contextOf(config, prompts, signal, knowledge),
        platform: channelTools({ tools, bridge, knowledge: config.knowledge ?? knowledge, query: request, window: (ref) => resolveContextWindowTokens(models.resolve(ref)) }),
      };
      // The opening rows are the conversation so far: the system prompt, the session's history, then the prompts (the last is the task).
      const rows = [
        ...(context.systemPrompt ? [{ role: "system" as const, content: context.systemPrompt }] : []),
        ...context.messages.map(toRunRow),
        ...prompts.map(toRunRow),
      ];
      const last = rows.at(-1);
      if (last) last.task = true;
      const task: RunTask = { runId: randomUUID(), prompt: request, request, dispatch: { source: "chat" }, transcript: rows };
      const outcome = await runAgent({ task, policy: policyOf(config, request), ports, ...(signal ? { signal } : {}) });
      // A failure with no model turn behind it must still reach the runner as the errored message it reads (it fails over on it).
      // A run stopped by a breaker or a budget ended as the runner always saw it: on its last tool result.
      if (outcome.kind === "failed" && !outcome.exhausted) bridge.fail(outcome.reason, outcome.reason === RUN_CANCELLED_REASON ? "aborted" : "error");
    } catch (err) {
      logWarn(`[on-prem] channel run failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      bridge.finish();
    }
  })();

  return bridge.stream;
}
