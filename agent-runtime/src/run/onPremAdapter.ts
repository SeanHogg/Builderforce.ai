/**
 * onPremAdapter — the ON-PREM entry point of the one agent (PRD 35 WS5, §3.1).
 *
 * It BUILDS PORTS and calls `runAgent`; it has no loop, no policy and no branch on
 * behaviour. `RunPolicy.entryPoint` is the telemetry label `on-prem` and is never read
 * here. Every difference between this machine and the cloud or the editor arrives as a
 * port:
 *
 *   model        — the gateway (`gatewayModelTransport`), observed so the portal gets
 *                  its chat and tool-audit frames (`onPremEvents`);
 *   capabilities — node fs + a real shell + memory + delegation (`onPremProvider`);
 *   store        — the session file (`onPremSessionFile`);
 *   events       — relay frames through the host's {@link OnPremRunSinks}, plus the
 *                  uniform outcome row;
 *   human        — the process-wide approval gate, through the provider's `human` capability;
 *   steering     — the relay's steering queue (`SteeringChannel`); a steer reaches the
 *                  next model call, and one that lands during the last turn is taken too;
 *   context      — the host's pack (empty when it builds none).
 *
 * Tickets (the relay), and every other on-prem surface that runs a task, call
 * {@link runOnPremAgent}. The result keeps the shape the relay's run path has always read.
 */

import { asksForSubagents, runAgent } from "@builderforce/agent-run";
import type {
  ContextSource,
  HumanAnswer,
  HumanChannel,
  ModelTransport,
  RunOutcome,
  RunPolicy,
  RunPorts,
} from "@builderforce/agent-run";
import type { CapabilityProvider, PolicyGate } from "@builderforce/agent-tools";
import type { SteeringChannel } from "../infra/relay-steering.js";
import { logWarn } from "../logger.js";
import { gatewayModelTransport } from "./gatewayModelTransport.js";
import { acknowledgedSteering, observedModel, relayEventSink, type OnPremRunSinks } from "./onPremEvents.js";
import { buildOnPremProvider } from "./onPremProvider.js";
import { sessionFileStore } from "./onPremSessionFile.js";
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
  /** Mid-run steering: closed when the run ends, so a late steer is refused, not queued forever. */
  steering?: SteeringChannel;
  /** Where the run's consolidated memory (its `codemap:` write-back) goes at the end. */
  commitMemory?: (consolidated: unknown) => Promise<void> | void;
  /** The session file the run's state lives in; absent ⇒ in memory for this invocation. */
  sessionFile?: string;
  /** Steps this invocation may take before yielding; omitted ⇒ unbounded. */
  maxSteps?: number;
  /** The context window of a model id, when the host knows it (sizes compaction and caps). */
  window?: (model: string) => number | undefined;
  /** The host's context pack, built once before turn 1 with no model call. */
  context?: ContextSource;
  /** Seam: a model transport / capability provider the host already built. */
  transport?: ModelTransport;
  capabilities?: CapabilityProvider;
}

/** The result every on-prem caller already reads. The state a later invocation resumes from is in the session file. */
export interface OnPremRunResult {
  ok: boolean;
  text: string;
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

/** A run's outcome as the result the relay reads. */
function resultOf(outcome: RunOutcome): OnPremRunResult {
  switch (outcome.kind) {
    case "finished":
      return { ok: true, text: outcome.output };
    case "paused":
      return { ok: false, text: `The run stopped to ask a person: ${outcome.question}` };
    case "yielded":
      return { ok: true, text: "" };
    case "failed":
      return { ok: false, text: outcome.reason };
  }
}

/**
 * Run one on-prem task through the one agent. Never throws: a run that cannot start or
 * crashes is reported through the sinks and the result, like every outcome.
 */
export async function runOnPremAgent(params: OnPremRunParams, sinks: OnPremRunSinks): Promise<OnPremRunResult> {
  const signal = params.abortController?.signal;
  const steering = params.steering ? acknowledgedSteering(params.steering) : undefined;
  const store = sessionFileStore(params.sessionFile, params.commitMemory);
  let result: OnPremRunResult;
  try {
    const policy = policyOf(params);
    const model = observedModel(
      params.transport ??
        gatewayModelTransport({
          baseUrl: params.anthropicBaseUrl,
          apiKey: params.gatewayAuthKey,
          ...(params.surface ? { surface: params.surface } : {}),
          ...(params.executionId !== undefined ? { executionId: params.executionId } : {}),
          ...(params.window ? { window: params.window } : {}),
        }),
      sinks,
    );
    // The provider is built after the ports that need it, so those read it late.
    let capabilities!: CapabilityProvider;
    const human: HumanChannel = { ask: (question, options) => askHuman(capabilities, question, options) };
    const events = relayEventSink(sinks, steering?.takeApplied ?? (() => ""));
    const spawn = childRunner({
      model,
      get capabilities() {
        return capabilities;
      },
      human,
      policy,
      events,
      ...(signal ? { signal } : {}),
      ...(params.executionId !== undefined ? { parentRunId: String(params.executionId) } : {}),
    });
    capabilities =
      params.capabilities ?? (await buildOnPremProvider({ workspaceRoot: params.cwd, spawn }));

    const ports: RunPorts = {
      model,
      capabilities,
      store,
      events,
      human,
      ...(steering ? { steering: steering.source } : {}),
      context: params.context ?? EMPTY_PACK,
    };
    const resume = await store.load();
    const outcome = await runAgent({
      task: {
        prompt: params.prompt,
        ...(params.appendSystemPrompt?.trim() ? { persona: params.appendSystemPrompt.trim() } : {}),
        dispatch: { source: "manual" },
        workspace: { defaultRepo: params.cwd },
      },
      policy,
      ports,
      ...(resume ? { resume } : {}),
      ...(params.maxSteps !== undefined ? { maxSteps: params.maxSteps } : {}),
      ...(signal ? { signal } : {}),
    });
    result = resultOf(outcome);
    // A run that ended has nothing to resume; one that parked or yielded keeps its file.
    if (outcome.kind === "finished" || outcome.kind === "failed") await store.clear();
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logWarn(`[on-prem] run failed: ${reason}`);
    result = { ok: false, text: reason };
  } finally {
    params.steering?.close();
  }
  if (!result.ok) sinks.onResult(false, result.text, { inputTokens: 0, outputTokens: 0 });
  return result;
}
