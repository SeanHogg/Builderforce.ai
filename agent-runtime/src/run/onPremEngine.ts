/**
 * OnPremAgentEngine — the on-prem runner expressed as the SHARED {@link AgentEngine}
 * contract (`@builderforce/agent-tools`), the same interface the cloud engine implements.
 *
 * **Why this exists (engine convergence — PRD 12).** Both surfaces drive one
 * `AgentEngine` (`run(input) → AgentRunResult`), so "swap in a V4" is a one-line
 * construction swap on either surface, not a rewrite. The loop behind it is now THE one
 * agent (`runAgent`, PRD 35) on both: this class only maps the contract onto the on-prem
 * adapter's inputs ({@link runOnPremAgent}).
 *
 * **Layering.** This is the pure per-task run (drives model + tools, returns a result).
 * The relay's `RelayTaskEngine` is the ORCHESTRATION layer around it (workspace lifecycle,
 * change attribution, commit/push/PR, execution-state report). Surface-specific
 * collaborators (workspace cwd, gateway URL/key, sinks, the abort handle) are
 * CONSTRUCTION concerns here, not per-run arguments.
 */

import type { AgentEngine, AgentRunInput, AgentRunResult } from "@builderforce/agent-tools";
import { CURRENT_ENGINE_ID } from "@builderforce/agent-tools";
import type { QueuedSteer, SteeringChannel } from "../infra/relay-steering.js";
import { runOnPremAgent, type OnPremRunSinks } from "./onPremAdapter.js";

/** Runtime collaborators an on-prem run needs, supplied once at construction. */
export interface OnPremEngineDeps {
  /** Working directory the agent operates in (the cloned ticket workspace). */
  cwd: string;
  /** Gateway base (`<host>/llm`); model calls go to `${anthropicBaseUrl}/v1/chat/completions`. */
  anthropicBaseUrl: string;
  /** Auth key the gateway resolves the tenant from. */
  gatewayAuthKey: string;
  /** Abort handle so an `execution.cancel` can stop the run; also read for `cancelled`. */
  abortController: AbortController;
  /** Normalized event sinks (assistant text / tool use / result / outcome) the relay forwards. */
  sinks: OnPremRunSinks;
  /** Execution surface declared to the gateway (`on_prem` for the self-hosted relay,
   *  `cloud` for a cloud-hosted runner — the gateway's fail-closed BYO rule reads it). */
  surface?: string;
  /** The execution this loop is running, stamped onto gateway requests. */
  executionId?: number;
  /** Mid-run steering: an `execution.message` frame pushes into it and the run takes it
   *  as the next user turn. Omitted ⇒ nothing can be steered in. */
  steering?: SteeringChannel;
  /** Where the run's consolidated memory (its `codemap:` write-back) is committed at the end. */
  commitMemory?: (consolidated: unknown) => Promise<void> | void;
  /** Steers accepted but never reached by the run: handed back so they continue as a follow-up run. */
  onLateSteers?: (steers: QueuedSteer[]) => void;
  /** The context window of a model id, when the host knows it (sizes compaction and result caps). */
  window?: (model: string) => number | undefined;
}

/** The on-prem agent, behind the shared {@link AgentEngine} seam. */
export class OnPremAgentEngine implements AgentEngine {
  // Read from the shared source so the id never drifts — one current engine id
  // across every surface (mirrors the cloud CloudLimbicEngine).
  readonly id = CURRENT_ENGINE_ID;

  constructor(private readonly deps: OnPremEngineDeps) {}

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    // The contract splits systemPrompt (assigned persona/skills) from userContent (the
    // task); the adapter takes the first as the persona that precedes the task.
    const r = await runOnPremAgent(
      {
        prompt: input.userContent,
        model: input.model,
        cwd: this.deps.cwd,
        anthropicBaseUrl: this.deps.anthropicBaseUrl,
        gatewayAuthKey: this.deps.gatewayAuthKey,
        appendSystemPrompt: input.systemPrompt,
        ...(input.policy?.gates ? { policyGates: [...input.policy.gates] } : {}),
        ...(this.deps.surface ? { surface: this.deps.surface } : {}),
        ...(this.deps.executionId != null ? { executionId: this.deps.executionId } : {}),
        abortController: this.deps.abortController,
        ...(this.deps.steering ? { steering: this.deps.steering } : {}),
        ...(this.deps.commitMemory ? { commitMemory: this.deps.commitMemory } : {}),
        ...(this.deps.onLateSteers ? { onLateSteers: this.deps.onLateSteers } : {}),
        ...(this.deps.window ? { window: this.deps.window } : {}),
      },
      this.deps.sinks,
    );
    // `cancelled` is a Stop that raced the run OR a stop command steered in; the
    // orchestration layer reconciles terminal state from it. A run that parked or ran out of
    // its step budget is not terminal, and says so.
    return {
      ok: r.ok,
      output: r.text,
      cancelled: this.deps.abortController.signal.aborted || r.cancelled === true,
      finished: r.yielded !== true && r.awaitingInput === undefined,
      ...(r.awaitingInput ? { awaitingInput: r.awaitingInput } : {}),
    };
  }
}
