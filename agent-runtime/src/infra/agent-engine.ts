/**
 * RelayTaskEngine — the host relay's swappable runner for executing a dispatched task.
 *
 * The host relay used to hard-branch on the engine id in multiple places. Behind this
 * interface there is ONE runtime — the current engine — resolved via the shared DI
 * registry and driven with `run()`; the seam stays so the NEXT engine is a wiring change.
 *
 * **Layering — NOT the same contract as `@builderforce/agent-tools`'s `AgentEngine`.**
 * That shared engine is a PURE per-task loop: `run(input) → AgentRunResult`, with the
 * caller owning terminal-state reporting. THIS one is an ORCHESTRATION-layer engine:
 * `run(dispatch, prompt) → void`, owning the ticket-workspace lifecycle, change
 * attribution, commit/push/PR, and execution-state reporting itself. A relay engine
 * may internally drive a shared `AgentEngine` (or the Claude Agent SDK) for the loop;
 * the two interfaces are deliberately distinct layers, named apart to avoid confusion.
 *
 * Dependency injection: an engine receives its collaborators (gateway client,
 * workspace, sinks, tool provider) from the host that constructs it, rather than
 * reaching into relay internals — so adding/retiring a runner is a one-line registry
 * change, no dispatch-site edits.
 */

import type { PolicyGate } from "@builderforce/agent-tools";

/** Everything an engine needs to run one dispatched task. Surface-agnostic. */
export interface EngineDispatch {
  title: string;
  description?: string;
  executionId?: number;
  taskId?: number;
  sourceType: "task.assign" | "task.broadcast";
  artifacts?: { skills?: string[]; personas?: string[]; content?: string[] };
  /** Engine id from the run payload (selects the implementation). */
  engine?: string;
  /** Model id from the run payload (forwarded to the engine). */
  model?: string;
  /** Repo bound to the task's project (cloned into the ticket workspace). */
  repo?: { repoId: string; defaultBranch: string | null };
  /** Human label of the executing agent (for change traceability). */
  agentLabel?: string;
  /** Compiled governance gates (compile-primitive policy modality), enforced by the
   *  engine at its tool seam — the on-prem mirror of the cloud `payload.policyGates`. */
  policyGates?: PolicyGate[];
}

/** One relay task runtime. Sole implementation: the Claude Agent SDK loop, the
 *  current engine ({@link CURRENT_ENGINE_ID}). Legacy ids resolve to it. */
export interface RelayTaskEngine {
  /** Stable engine id matched against `EngineDispatch.engine`. */
  readonly id: string;
  /** Execute the dispatched task. Never throws — reports terminal state itself. */
  run(dispatch: EngineDispatch, prompt: string): Promise<void>;
}
