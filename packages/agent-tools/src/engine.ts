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
  /**
   * Governance gates compiled onto the agent's spec, enforced by the engine at its
   * tool-call seam ({@link import("./spec.js").evaluatePolicyGate}). Carried on the
   * run input — not the engine's construction — because gates are a property of the
   * agent (the spec), so the SAME gate enforces identically on every engine/surface.
   */
  readonly policy?: { readonly gates: readonly import("./spec.js").PolicyGate[] };
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
 * The ONE current engine id, shared so every surface names the same engine and the
 * value lives in ONE place. The on-prem relay registry, the cloud `resolveCloudAgent`,
 * and the API route fallbacks all import {@link CURRENT_ENGINE_ID} / {@link DEFAULT_ENGINE_ID}.
 *
 * **There is no per-agent engine selection and no v1/v2 legacy path.** A run is ALWAYS
 * the current engine — "V3" = the tool loop (Claude-Agent-SDK, gateway-routed) with the
 * limbic affective layer ALWAYS composed on top. The retired v1 (legacy pi loop) and v2
 * (limbic-off variant) are gone; any legacy `engine` value on an old row is ignored and
 * resolves to the current engine at runtime — versions are a code constant, never DB data.
 * When a "V4" ships, this one constant moves and every surface follows; prior versions are
 * not retained as selectable options.
 */
export const CURRENT_ENGINE_ID = "builderforce-v3" as const;

export type EngineId = typeof CURRENT_ENGINE_ID;

/**
 * The default (and only) engine == the current engine. Kept as a distinct export so the
 * many call sites that read a "default" don't all have to change when the current id moves.
 */
export const DEFAULT_ENGINE_ID: EngineId = CURRENT_ENGINE_ID;

/**
 * Resolve an engine implementation by id from a registry, falling back to the current
 * engine when the id is unknown/absent (every legacy id lands on {@link CURRENT_ENGINE_ID}).
 * With a single engine the registry has one entry and any id resolves to it; the generic
 * DI seam stays so the NEXT engine (a future V4) is a registry entry, never a new branch.
 * Generic over the engine shape so it serves both the orchestration `RelayTaskEngine` and
 * the pure-loop `AgentEngine`.
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
