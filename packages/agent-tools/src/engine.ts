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
 * and the API route fallbacks all import {@link DEFAULT_ENGINE_ID}.
 *
 * **V1 and Local are RETIRED (operator decision 2026-06-14).** `v2` (the Claude-Agent-SDK
 * engine, gateway-routed — drives the vendor pool, no tenant BYO key) is the SOLE runner and
 * the consolidated default on every surface (cloud + on-prem); the frontend/api `AGENT_ENGINES`
 * set is `['builderforce-v2']`. The retired `v1` id is kept only to recognize/back-fill legacy
 * `engine='builderforce-v1'` rows — no runtime serves it. `builderforce-local` (the on-prem
 * pi-free shared-registry engine) was deleted as dead code: it was never selectable, so no row
 * carries it and no back-fill token is needed.
 */
export const ENGINE_IDS = {
  /** RETIRED — legacy pi loop. Kept only to recognize/back-fill old rows; no runner. */
  v1: "builderforce-v1",
  v2: "builderforce-v2",
} as const;

export type EngineId = (typeof ENGINE_IDS)[keyof typeof ENGINE_IDS];

/**
 * The default engine when a dispatch / agent record does not name one. **`builderforce-v2`**
 * (V1 retired) — one constant, every surface. Cloud `resolveCloudAgent`, on-prem relay
 * `resolveEngine`, `workforceRoutes` create, and the `task.assign` fallback all read this.
 */
export const DEFAULT_ENGINE_ID: EngineId = ENGINE_IDS.v2;

/**
 * Resolve an engine implementation by id from a registry, falling back to the default
 * when the id is unknown/absent (legacy `builderforce-v1`/`builderforce-local` rows all
 * land on {@link DEFAULT_ENGINE_ID}). The id→impl + fallback logic lived inline in the
 * relay `resolveEngine`; sharing it here means every surface that keeps an engine
 * registry (on-prem relay today, a cloud registry tomorrow) registers a V3 the same way
 * — a registry entry, never a new branch. Generic over the engine shape so it serves
 * both the orchestration `RelayTaskEngine` and the pure-loop `AgentEngine`.
 */
export function resolveEngineById<E>(
  registry: Readonly<Record<string, E>>,
  id: string | undefined,
  defaultId: string = DEFAULT_ENGINE_ID,
): E {
  // `defaultId` is guaranteed registered by the caller's contract (every surface
  // registers DEFAULT_ENGINE_ID), so the fallback is non-null — assert it so the
  // return is `E`, not `E | undefined`, under `noUncheckedIndexedAccess`.
  return registry[id ?? ""] ?? registry[defaultId]!;
}
