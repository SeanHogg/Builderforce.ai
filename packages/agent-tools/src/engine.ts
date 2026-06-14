/**
 * The engine seam. An {@link AgentEngine} is "the loop that drives a model + tools
 * to complete a task on a surface." Today that is the cloud tool loop; tomorrow it
 * could be a Claude-Agent-SDK loop or the on-prem pi loop. Callers depend on THIS
 * interface and are handed a concrete engine (Dependency Injection), so swapping
 * "the next engine" is a wiring change at one composition root, not a rewrite of
 * every dispatch site.
 *
 * Runtime-agnostic by construction: the engine receives its capability provider and
 * tool registry, so it never reaches a Worker `Env` or `node:*` directly.
 */

/**
 * Inbound: the PER-TASK input. Surface-specific wiring (capability provider, tool
 * registry, db/env, cancellation source) is the engine's CONSTRUCTION concern, not a
 * per-run argument — an engine is built once at the composition root with its runtime
 * deps, then driven via {@link AgentEngine.run} with just the task. That keeps this
 * contract runtime-agnostic and the same shape across every engine.
 */
export interface AgentRunInput {
  readonly systemPrompt: string;
  readonly userContent: string;
  /** Model id to pin (engine decides strict-vs-seed); omit to let routing choose. */
  readonly model?: string;
  /** Co-operative cancellation. */
  readonly signal?: AbortSignal;
  /** Opaque resume state from a prior partial run (durable tick / paused-on-human). */
  readonly resume?: unknown;
}

/** Outbound: the result of a run (or a partial run that must resume). */
export interface AgentRunResult {
  readonly ok: boolean;
  readonly output: string;
  readonly cancelled: boolean;
  /** True when the run reached a terminal state (finished / failed / cancelled). */
  readonly finished: boolean;
  /** Set when the run paused on a human question — the caller parks + resumes it. */
  readonly awaitingInput?: { approvalId: string; question: string };
  /** Opaque state to hand back on the next resume (durable tick). */
  readonly state?: unknown;
}

export interface AgentEngine {
  /** Stable id for logging / picker (e.g. "cloud-tool-loop", "pi"). */
  readonly id: string;
  run(input: AgentRunInput): Promise<AgentRunResult>;
}

/**
 * The well-known engine ids, shared so every surface names the same engines and the
 * default lives in ONE place. The on-prem relay registry, the cloud `resolveCloudAgent`,
 * and the API route fallbacks all import {@link DEFAULT_ENGINE_ID} — so retiring V1 /
 * flipping the default to `builderforce-local` is a one-line change here, not a hunt for
 * every duplicated `'builderforce-v1'` literal (PRD 11 §5.4 / §5.1 Stage 5).
 */
export const ENGINE_IDS = {
  v1: "builderforce-v1",
  v2: "builderforce-v2",
  local: "builderforce-local",
} as const;

export type EngineId = (typeof ENGINE_IDS)[keyof typeof ENGINE_IDS];

/**
 * The default engine when a dispatch / agent record does not name one. Stays
 * `builderforce-v1` until on-prem tool parity is proven; flipping it to
 * `ENGINE_IDS.local` here changes every surface at once.
 */
export const DEFAULT_ENGINE_ID: EngineId = ENGINE_IDS.v1;
