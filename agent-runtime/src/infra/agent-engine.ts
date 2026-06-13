/**
 * AgentEngine — the swappable runner abstraction for executing a dispatched task.
 *
 * The host relay used to hard-branch `if (engine === 'builderforce-v2') runV2 else
 * runV1`, and the cloud path branched again — the same V1/V2 decision encoded in
 * multiple places. Behind this interface, each runtime is one implementation
 * (Strategy pattern); the relay resolves the right one by id and calls `run()`.
 *
 * Dependency injection: an engine receives its collaborators (gateway client,
 * workspace, sinks, tool provider) from the host that constructs it, rather than
 * reaching into relay internals. That makes engines unit-testable in isolation and
 * makes retiring V1 a one-line registry change — delete the implementation, drop
 * its registration; no dispatch-site edits.
 */

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
}

/** One agent runtime. Implementations: the Claude Agent SDK (V2) and the legacy
 *  pi loop (V1, slated for removal once V2 reaches full tool parity). */
export interface AgentEngine {
  /** Stable engine id matched against `EngineDispatch.engine`. */
  readonly id: string;
  /** Execute the dispatched task. Never throws — reports terminal state itself. */
  run(dispatch: EngineDispatch, prompt: string): Promise<void>;
}
