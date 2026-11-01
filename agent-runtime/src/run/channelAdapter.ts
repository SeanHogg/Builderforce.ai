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

import { DEFAULT_READS_BEFORE_NUDGE, RUN_CANCELLED_REASON, asksForSubagents, runAgent } from "@builderforce/agent-run";
import type { ContextSource, RunEvent, RunMessage, RunPolicy, RunPorts, RunTask, SteeringSource, SteerInput } from "@builderforce/agent-run";
import { RunKnowledgeRecorder, renderPolicyDirectives, type CapabilityProvider } from "@builderforce/agent-tools";
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
import { channelDeliveryRungs } from "./channelTruncatedReply.js";
import { channelTools } from "./channelTools.js";
import { onPremHuman } from "./onPremHuman.js";
import { reportRunRow } from "./outcomeReporter.js";

/**
 * The longest a channel or cron run waits on a governance approval. A person is reading a chat (or nobody is, in a cron job),
 * and the session's lane queues behind the call, so a wait that runs to the approval gate's 10 minutes stalls every later message.
 * Past it the call is refused and the model says so in its reply.
 */
export const CHANNEL_APPROVAL_WAIT_MS = 60_000;

export interface ChannelRunInput {
  prompts: AgentMessage[];
  context: AgentContext;
  config: AgentLoopConfig;
  signal: AbortSignal | undefined;
  streamFn: StreamFn;
}

/** The bare model id behind a `<provider>/<id>` ref this run met; a name it never met is left as it is. */
function bareModelId(models: ChannelModels, ref: string): string {
  const model = models.resolve(ref);
  return modelRef(model) === ref ? model.id : ref;
}

/** The queued messages of the Agent as the agent's steered input: their text, and the pictures they carry. */
function steered(messages: readonly AgentMessage[]): SteerInput[] {
  return messages.map((m) => {
    const row = toRunRow(m);
    return { text: row.content || textOf((m as { content?: unknown }).content), ...(row.parts?.length ? { parts: row.parts } : {}) };
  });
}

/**
 * What a run says when it ended on its budget or its failure breaker: what happened (a spent step budget is not failing tool calls),
 * and which governance gate refused its calls when one did.
 */
export function noReplyMessage(reason: string, gateIds: ReadonlySet<string>, wrote: boolean): string {
  const gates = [...gateIds].join(", ");
  const lead = wrote ? "The run stopped before it finished" : "The run ended without a reply";
  const what =
    reason === "tool calls kept failing"
      ? gateIds.size > 0
        ? "its tool calls were refused or failed"
        : "its tool calls failed"
      : reason === "step budget spent"
        ? "it used up its step budget"
        : reason;
  return `${lead}: ${what}.${gateIds.size > 0 ? ` Governance gate ${gates} refused some of its tool calls.` : ""}`;
}

/** The policy DATA of a channel run. How the run behaves is the agent's. */
export function policyOf(config: AgentLoopConfig, request: string): RunPolicy {
  return {
    entryPoint: "on-prem",
    toolScope: "chat-work",
    role: "code",
    // Cost lever C9 (compaction under a long-context price tier) is read the on-device way: a partial rollout buckets by install.
    levers: onDeviceCostLeverOn("c9_price_tier_budget") ? ["c9_price_tier_budget"] : [],
    // The session owns the folding of a long conversation (a provider's overflow reaches it): the agent only re-packs the context when a
    // stall fails the run over onto another model, for that model's window, and the model is told it took over. Its reply reserve
    // follows whichever model is serving, so a failover onto a small window keeps its history.
    budgets: {},
    modelHandoff: true,
    pinnedModel: modelRef(config.model),
    inference: "hybrid",
    verify: "none",
    approvalGates: [...(config.policyGates ?? [])],
    delegation: { requested: asksForSubagents(request), readsBeforeNudge: DEFAULT_READS_BEFORE_NUDGE },
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
      // What the run wrote to the person, and which governance gates refused its calls: an exhausted run with no reply says why.
      let replied = false;
      const refusedBy = new Set<string>();
      const tools = context.tools ?? [];
      const capabilities: CapabilityProvider = { capabilities: new Set() };
      const ports: RunPorts = {
        model: channelModelTransport({ models, streamFn, config, tools, bridge }),
        capabilities,
        store: {
          load: () => undefined,
          save: () => undefined,
          appended: (row: RunMessage) => {
            if (row.role === "assistant" && row.content.trim().length > 0) replied = true;
            bridge.appended(row);
          },
        },
        // The run's uniform outcome row (§8.2), written once at its end. A channel run has no execution id: the row is keyed by the
        // run's own id (`task.runId`) and carries the model that served it; nothing else is claimed.
        events: {
          emit: (event: RunEvent) => {
            if (event.kind === "policy.blocked") {
              refusedBy.add(event.gateId);
              config.onGovernanceRefusal?.(event.gateId);
            }
            bridge.emit(event);
          },
          // The row groups runs by model, and every other entry point reports the bare model id the gateway served. The run itself
          // names a model `<provider>/<id>` (the policy keys its pins and fallbacks on it), so the ref is turned back into the id here.
          outcome: (row) => reportRunRow(row.model ? { ...row, model: bareModelId(models, row.model) } : row),
        },
        // A governance gate guards an act: with no approver to reach, the call is refused (the ticket path keeps its standalone default).
        // The wait is bounded and ends with the run (see CHANNEL_APPROVAL_WAIT_MS).
        human: onPremHuman(() => capabilities, (request) => requestHumanInput({ ...request, failClosed: true }), {
          approvalTimeoutMs: CHANNEL_APPROVAL_WAIT_MS,
          ...(signal ? { signal } : {}),
        }),
        // The channel's runs close with what the model said: no forced no-tools turn after a tripped breaker (the runner never had one).
        // The one rung: a reply the output limit cut short continues (twice), then is delivered with a line saying it was cut off.
        delivery: { rungs: channelDeliveryRungs, owns: { synthesis: true } },
        steering: steeringOf(config),
        context: contextOf(config, prompts, signal, knowledge),
        platform: channelTools({ tools, bridge, knowledge: config.knowledge ?? knowledge, query: request, window: (ref) => resolveContextWindowTokens(models.resolve(ref)) }),
      };
      // The opening rows are the conversation so far: the system prompt, the session's history, then the prompts (the last is the task).
      // The transcript is handed over whole, so the kernel's own opening rows never render the governance directives: the system row carries
      // them here, through the ONE renderer, or an `inject-directive` gate would never reach the model on a channel.
      const system = [renderPolicyDirectives(config.policyGates), context.systemPrompt ?? ""].filter((part) => part.length > 0).join("\n\n");
      const rows = [
        ...(system ? [{ role: "system" as const, content: system }] : []),
        ...context.messages.map(toRunRow),
        ...prompts.map((prompt) => ({ ...toRunRow(prompt), person: true as const })),
      ];
      const last = rows.at(-1);
      if (last) last.task = true;
      const task: RunTask = { runId: randomUUID(), prompt: request, request, dispatch: { source: "chat" }, transcript: rows };
      const outcome = await runAgent({ task, policy: policyOf(config, request), ports, ...(signal ? { signal } : {}) });
      // A failure with no model turn behind it must still reach the runner as the errored message it reads (it fails over on it).
      // A run stopped by a breaker or a budget ended as the runner always saw it: on its last tool result.
      if (outcome.kind === "failed" && !outcome.exhausted) bridge.fail(outcome.reason, outcome.reason === RUN_CANCELLED_REASON ? "aborted" : "error");
      // A run that spent its budget or tripped its breaker never reaches a closing reply (the channel owns its synthesis). If it wrote
      // nothing it would end silently; if a governance gate refused its calls, whatever it wrote before is not an honest account of
      // why it stopped. Either way, say what stopped it and which gate refused its calls. It is told as the run's REPLY, not as an
      // errored turn (the runner regex-classifies an errored message's text, so a gate keyed like `forbidden-paths` would put a healthy
      // profile in cooldown), and marked `runFailed` so the lifecycle still ends as a failure.
      else if (outcome.kind === "failed" && (!replied || refusedBy.size > 0)) bridge.failedReply(noReplyMessage(outcome.reason, refusedBy, replied));
    } catch (err) {
      logWarn(`[on-prem] channel run failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      bridge.finish();
    }
  })();

  return bridge.stream;
}
