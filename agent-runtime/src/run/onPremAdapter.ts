/**
 * onPremAdapter — the ON-PREM entry point of the one agent for TICKETS (PRD 35 WS5, §3.1).
 *
 * It BUILDS PORTS and calls `runAgent`; it has no loop, no policy and no branch on
 * behaviour. `RunPolicy.entryPoint` is the telemetry label `on-prem` and is never read
 * here. Every difference between this machine and the cloud or the editor arrives as a
 * port:
 *
 *   model        — the gateway (`gatewayModelTransport`), observed so the portal gets
 *                  its chat and tool-audit frames (`onPremEvents`);
 *   capabilities — node fs + a real shell + memory + delegation (`onPremProvider`);
 *   store        — in memory for the invocation: an on-prem ticket run is one invocation
 *                  and nothing ever resumes it (a late steer starts a NEW follow-up run);
 *   events       — relay frames through the host's {@link OnPremRunSinks}, plus the
 *                  uniform outcome row;
 *   human        — the process-wide approval gate, through the provider's `human` capability;
 *   steering     — the relay's steering queue (`SteeringChannel`): a steer reaches the next
 *                  model call, one that lands during the last turn is taken too, and what
 *                  is still queued when the run settles goes back to the host as a late steer;
 *   context      — the host's pack (empty when it builds none).
 *
 * Only the relay's ticket path calls {@link runOnPremAgent} today. Channels, cron and the
 * CLI still run on the embedded runner's native loop (`builderforce/agent-loop/agent-loop.ts`,
 * which keeps its place on the `check:one-execution` baseline) until the contract carries
 * what that loop needs (native message blocks, provider-contributed tools, a model-fallback
 * port); they are NOT routed through this adapter.
 */

import { randomUUID } from "node:crypto";
import { RUN_CANCELLED_REASON, asksForSubagents, runAgent } from "@builderforce/agent-run";
import type { ContextSource, HumanAnswer, HumanChannel, ModelTransport, RunOutcome, RunPolicy, RunPorts, RunState, RunStore } from "@builderforce/agent-run";
import { RunKnowledgeRecorder, type CapabilityProvider, type PolicyGate, type RunKnowledgeLog } from "@builderforce/agent-tools";
import type { QueuedSteer, SteeringChannel } from "../infra/relay-steering.js";
import { logWarn } from "../logger.js";
import { gatewayModelTransport } from "./gatewayModelTransport.js";
import { acknowledgedSteering, observedModel, relayEventSink, type OnPremRunSinks } from "./onPremEvents.js";
import { buildOnPremProvider } from "./onPremProvider.js";
import { childRunner } from "./onPremSubagents.js";

export type { OnPremRunSinks } from "./onPremEvents.js";

/** What a run is given. The names are the relay's: they predate the gateway wire change. */
export interface OnPremRunParams {
  prompt: string;
  model?: string;
  /** Working directory the agent operates in (the repo/workspace). */
  cwd: string;
  /** Gateway base (`<host>/llm`); the transport appends `/v1/chat/completions`. */
  anthropicBaseUrl: string;
  /** Auth key the gateway resolves the tenant from. */
  gatewayAuthKey: string;
  /** Which surface this run executes on, stamped on every gateway request (default `on_prem`). */
  surface?: string;
  /** The execution this run belongs to, stamped on every gateway request. */
  executionId?: number;
  /** Assigned persona / skill / content block, ahead of the task in the system prompt. */
  appendSystemPrompt?: string;
  /** Compiled governance gates: blocked tools leave the catalog, matching calls are refused. */
  policyGates?: PolicyGate[];
  /** Stopping the run: aborting reaches the model call and kills the command in flight. */
  abortController?: AbortController;
  /** Mid-run steering: closed when the run settles, so a late steer is refused, not queued forever. */
  steering?: SteeringChannel;
  /** Steers accepted but never reached by the run: handed back so they continue as a follow-up run. */
  onLateSteers?: (steers: QueuedSteer[]) => void;
  /** Where the run's consolidated memory (its `codemap:` write-back) goes at the end. */
  commitMemory?: (consolidated: unknown) => Promise<void> | void;
  /**
   * The run's record at its end — what it read, searched and changed, and the task — for a
   * host that consolidates or reports it itself (`commitMemory` is the agent's own write-back).
   */
  onRunRecord?: (record: RunKnowledgeLog) => void;
  /** Steps this invocation may take before yielding; omitted ⇒ unbounded. */
  maxSteps?: number;
  /** The context window of a model id, when the host knows it (sizes compaction and result caps). */
  window?: (model: string) => number | undefined;
  /** The host's context pack, built once before turn 1 with no model call. */
  context?: ContextSource;
  /** Seam: a model transport / capability provider the host already built. */
  transport?: ModelTransport;
  capabilities?: CapabilityProvider;
}

/**
 * The result every on-prem caller already reads. The flags are present only when true, so
 * a run that simply finished is exactly `{ ok, text }`.
 */
export interface OnPremRunResult {
  ok: boolean;
  text: string;
  /** The run was stopped (Stop, an abort, or a steered stop command). */
  cancelled?: true;
  /** The invocation's step budget ran out; the run is not over. */
  yielded?: true;
  /** The run parked on a person and is waiting for the answer. */
  awaitingInput?: { approvalId: string; question: string };
}

const EMPTY_PACK: ContextSource = { pack: () => ({ focus: [], facts: [], recall: [] }) };

/** Ask through the provider's `human` capability (the approval gate answers inline). */
async function askHuman(caps: CapabilityProvider, question: string, options?: readonly string[]): Promise<HumanAnswer> {
  if (!caps.human) return { kind: "paused" };
  const result = await caps.human.ask(question, options?.length ? `Options: ${options.join(" | ")}` : undefined);
  if (result.paused) return { kind: "paused" };
  return { kind: "answered", answer: result.answer ?? result.note ?? result.error ?? "" };
}

/** The policy DATA of an on-prem ticket run. How the run behaves is the agent's. */
function policyOf(params: OnPremRunParams): RunPolicy {
  return {
    entryPoint: "on-prem",
    toolScope: "ticket",
    role: "code",
    levers: [],
    budgets: {},
    ...(params.model ? { pinnedModel: params.model } : {}),
    inference: "hybrid",
    verify: "none",
    approvalGates: params.policyGates ?? [],
    delegation: { requested: asksForSubagents(params.prompt), readsBeforeNudge: 6 },
  };
}

/** A run's outcome as the result the relay reads: each real state is its own state. */
function resultOf(outcome: RunOutcome): OnPremRunResult {
  switch (outcome.kind) {
    case "finished":
      return { ok: true, text: outcome.output };
    case "paused":
      return {
        ok: false,
        text: `The run stopped to ask a person: ${outcome.question}`,
        awaitingInput: { approvalId: outcome.approvalId, question: outcome.question },
      };
    case "yielded":
      return { ok: true, text: "", yielded: true };
    case "failed":
      return outcome.reason === RUN_CANCELLED_REASON
        ? { ok: false, text: outcome.reason, cancelled: true }
        : { ok: false, text: outcome.reason };
  }
}

/**
 * Run one on-prem task through the one agent. Never throws: a run that cannot start or
 * crashes is reported through the sinks and the result, like every outcome.
 */
export async function runOnPremAgent(params: OnPremRunParams, sinks: OnPremRunSinks): Promise<OnPremRunResult> {
  const signal = params.abortController?.signal;
  const steering = params.steering ? acknowledgedSteering(params.steering) : undefined;
  let settled: RunState | undefined;
  const store: RunStore = {
    load: () => undefined,
    save: (state) => {
      settled = state;
    },
    ...(params.commitMemory ? { commitMemory: params.commitMemory } : {}),
  };
  /** The run has settled: refuse further steers and hand back the ones it never reached. */
  const settleSteering = (): void => {
    if (!params.steering) return;
    const leftover = params.steering.takeAll();
    params.steering.close();
    if (leftover.length > 0) params.onLateSteers?.(leftover);
  };

  let result: OnPremRunResult;
  try {
    const policy = policyOf(params);
    const transport =
      params.transport ??
      gatewayModelTransport({
        baseUrl: params.anthropicBaseUrl,
        apiKey: params.gatewayAuthKey,
        ...(params.surface ? { surface: params.surface } : {}),
        ...(params.executionId !== undefined ? { executionId: params.executionId } : {}),
        ...(params.window ? { window: params.window } : {}),
      });
    const model = observedModel(transport, sinks);
    // The provider is built after the ports that need it, so those read it late.
    let capabilities!: CapabilityProvider;
    const human: HumanChannel = { ask: (question, options) => askHuman(capabilities, question, options) };
    const events = relayEventSink(sinks, steering?.takeApplied ?? (() => ""));
    const spawn = childRunner({
      model: transport,
      get capabilities() {
        return capabilities;
      },
      policy,
      sinks,
      ...(signal ? { signal } : {}),
      parentRunId: params.executionId !== undefined ? String(params.executionId) : randomUUID(),
    });
    capabilities = params.capabilities ?? (await buildOnPremProvider({ workspaceRoot: params.cwd, spawn }));

    const ports: RunPorts = {
      model,
      capabilities,
      store,
      events,
      human,
      ...(steering ? { steering: steering.source } : {}),
      context: params.context ?? EMPTY_PACK,
    };
    const outcome = await runAgent({
      task: {
        prompt: params.prompt,
        ...(params.appendSystemPrompt?.trim() ? { persona: params.appendSystemPrompt.trim() } : {}),
        dispatch: { source: "manual" },
        workspace: { defaultRepo: params.cwd },
      },
      policy,
      ports,
      ...(params.maxSteps !== undefined ? { maxSteps: params.maxSteps } : {}),
      ...(signal ? { signal } : {}),
    });
    // Settled: before anything else can await, so no steer slips between the run's last
    // drain and the channel closing.
    settleSteering();
    if (settled) params.onRunRecord?.(RunKnowledgeRecorder.restore(settled.memory));
    result = resultOf(outcome);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logWarn(`[on-prem] run failed: ${reason}`);
    result = { ok: false, text: reason };
  } finally {
    settleSteering();
  }
  if (!result.ok) sinks.onResult(false, result.text, { inputTokens: 0, outputTokens: 0 });
  return result;
}
