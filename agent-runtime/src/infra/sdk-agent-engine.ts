/**
 * ClaudeSdkAgentEngine — the on-prem runner expressed as the SHARED
 * {@link AgentEngine} contract (`@builderforce/agent-tools`), the same interface the
 * cloud `CloudToolLoopEngine` implements.
 *
 * **Why this exists (engine convergence — PRD 12).** The cloud surface already drives
 * the shared `AgentEngine` (`run(input) → AgentRunResult`); on-prem used to call the
 * Claude Agent SDK inline inside the relay. That left the two surfaces on different
 * loop abstractions, so "swap in a V3" meant two unrelated edits. With on-prem now
 * behind the same `AgentEngine`, a V3 loop is a sibling implementation of THIS
 * interface on either surface — a one-line construction swap, not a rewrite.
 *
 * **Layering.** This is the pure per-task LOOP (drives model + tools, returns a
 * result). The relay's {@link RelayTaskEngine} is the ORCHESTRATION layer around it
 * (workspace lifecycle, change attribution, commit/push/PR, execution-state report);
 * it constructs this engine with its runtime deps and drives it via `run()`.
 * Surface-specific collaborators (workspace cwd, gateway URL/key, event sinks, the
 * abort handle) are CONSTRUCTION concerns here, not per-run arguments — keeping
 * `run()` the same runtime-agnostic shape as every other `AgentEngine`.
 */

import type { AgentEngine, AgentRunInput, AgentRunResult } from "@builderforce/agent-tools";
import { ENGINE_IDS } from "@builderforce/agent-tools";
import { runClaudeAgentSdkV2, type V2RunnerSinks } from "../agents/claude-agent-sdk-runner.js";

/** Runtime collaborators an on-prem SDK run needs, supplied once at construction. */
export interface ClaudeSdkEngineDeps {
  /** Working directory the agent operates in (the cloned ticket workspace). */
  cwd: string;
  /** Gateway base; the SDK posts Messages to `${anthropicBaseUrl}/v1/messages`. */
  anthropicBaseUrl: string;
  /** Auth key the gateway resolves the tenant from (sent as x-api-key by the SDK). */
  gatewayAuthKey: string;
  /** Abort handle so an `execution.cancel` can stop the run; also read for `cancelled`. */
  abortController: AbortController;
  /** Normalized event sinks (assistant text / tool use / result) the relay forwards. */
  sinks: V2RunnerSinks;
}

/** The on-prem Claude-Agent-SDK loop, behind the shared {@link AgentEngine} seam. */
export class ClaudeSdkAgentEngine implements AgentEngine {
  // Read from the shared ENGINE_IDS source so the id never drifts from the registry's
  // well-known names (mirrors the cloud CloudToolLoopEngine).
  readonly id = ENGINE_IDS.v2;

  constructor(private readonly deps: ClaudeSdkEngineDeps) {}

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    // The shared contract splits systemPrompt (assigned persona/skills) from
    // userContent (the task). The SDK has no real system role, so the runner
    // prepends `appendSystemPrompt` to the prompt — map the contract onto that
    // existing behavior rather than duplicating the prepend here.
    const r = await runClaudeAgentSdkV2(
      {
        prompt: input.userContent,
        model: input.model,
        cwd: this.deps.cwd,
        anthropicBaseUrl: this.deps.anthropicBaseUrl,
        gatewayAuthKey: this.deps.gatewayAuthKey,
        appendSystemPrompt: input.systemPrompt,
        abortController: this.deps.abortController,
      },
      this.deps.sinks,
    );
    // The SDK loop runs to completion in one call (no durable tick / human pause),
    // so a returned run is always terminal. `cancelled` reflects an abort that raced
    // the run; the orchestration layer reconciles terminal state from that.
    return {
      ok: r.ok,
      output: r.text,
      cancelled: this.deps.abortController.signal.aborted,
      finished: true,
    };
  }
}
