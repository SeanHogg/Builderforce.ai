/**
 * The compile primitive's intermediate representation: {@link AgentSpec} + the
 * single canonical lowering {@link lowerAgentSpec}.
 *
 * The platform has several "define a need → run an agent" front doors (a trained
 * Workforce model, a hand-drawn workflow, a persona, a plain-language ask). They
 * historically each assembled their own system prompt and exec params by ad-hoc
 * string concatenation, so persona/memory rendered differently depending on where
 * an agent ran. `AgentSpec` is the one shape every front door compiles *into*, and
 * `lowerAgentSpec` is the one function every surface lowers it *through* — so an
 * agent's identity, personality, and recalled memory render identically whether it
 * runs in the IDE, on-prem, on a durable cloud tick, or as a workflow node.
 *
 * Pure and dependency-free (no GPU, no I/O, no `Env`) so it runs in a Cloudflare
 * Worker, Node, and a VS Code extension alike — the same constraint as
 * {@link AgentEngine} and the limbic compiler beside it. The modality compilers
 * (`compile()`) and surface deployers (`deploy()`) that produce and consume an
 * `AgentSpec` are layered on top in the `api`/`agent-runtime` packages; this file
 * owns only the IR and its lowering. See `PRD-agent-compile-primitive.md`.
 */

/**
 * Execution levers an agent's persona/affect can set. Canonical shape shared
 * across surfaces; `agent-runtime`'s `PsychometricExecParams` is an alias of this,
 * so the trait/limbic compilers and this spec speak one type. Value unions mirror
 * the runtime's `ThinkLevel` / `ReasoningLevel`.
 */
export type AgentThinkLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
export type AgentReasoningLevel = "off" | "on" | "stream";

export interface AgentExecParams {
  thinkLevel?: AgentThinkLevel;
  reasoningLevel?: AgentReasoningLevel;
  /** Sampling temperature, expected clamped to [0.1, 1.0] by the compiler. */
  temperature?: number;
}

/** Where an agent is allowed to run — the `deploy()` targets. */
export type AgentSurface =
  | "ide"
  | "desktop"
  | "cloud-durable"
  | "cloud-container"
  | "workflow-node";

export interface AgentSpecIdentity {
  name: string;
  title?: string;
  bio?: string;
  /** Free-form list or a pre-joined string; both lower identically. */
  skills?: string[] | string | null;
}

export interface AgentSpecModel {
  /** A base model id OR a `builderforce/workforce-<id>` trained-model ref. */
  ref: string | null;
  /** When true, the engine may route/seed rather than pin the model. */
  autoRoute?: boolean;
}

export interface AgentSpecPersona {
  /** Compiled persona/psychometric directives (system-prompt lines). */
  directives?: string[];
  /** Compiled execution levers — applied by the engine when present. */
  execParams?: AgentExecParams;
}

export interface AgentMemorySignal {
  step: number;
  signal: string;
}

export interface AgentSpecMemory {
  /** Grounded context recalled from the agent's knowledge (hybrid retrieval). */
  recalledContext?: string;
  /** Compact signal derived from a persistent SSM/Mamba memory snapshot. */
  stateSignal?: AgentMemorySignal;
}

/**
 * The canonical agent intermediate representation. Every modality compiles *into*
 * this; every surface deploys *from* it. Only the prompt-bearing fields are
 * consumed by {@link lowerAgentSpec}; `steps`/`surfaces` are carried for the
 * `deploy()` layer (which dispatches per surface) and are intentionally not part
 * of the system-prompt lowering.
 */
export interface AgentSpec {
  id?: string;
  identity: AgentSpecIdentity;
  model?: AgentSpecModel;
  persona?: AgentSpecPersona;
  memory?: AgentSpecMemory;
  /** Ordered steps when the need is a process/workflow (CompiledStep-shaped). */
  steps?: readonly unknown[];
  /** Surfaces this spec may deploy to. */
  surfaces?: readonly AgentSurface[];
}

/** A raw persistent SSM/Mamba state snapshot, as stored on a published agent. */
export interface AgentMemoryState {
  step?: number;
  data?: number[];
}

/**
 * Derive the compact memory signal from a raw persistent-state snapshot. Returns
 * `undefined` for a snapshot that carries neither a step nor a data vector, so a
 * stateless agent renders no memory line. Shared so every surface summarises a
 * persistent state the same way (replaces per-call inline slicing).
 */
export function agentMemorySignal(state: unknown): AgentMemorySignal | undefined {
  if (!state || typeof state !== "object") return undefined;
  const snap = state as AgentMemoryState;
  const hasStep = typeof snap.step === "number";
  const hasData = Array.isArray(snap.data);
  if (!hasStep && !hasData) return undefined;
  const signal = hasData
    ? snap.data!.slice(0, 4).map((v) => v.toFixed(3)).join(",")
    : "";
  return { step: snap.step ?? 0, signal };
}

/** The result of lowering a spec: what an engine needs to make the call. */
export interface LoweredAgent {
  /** Assembled persona + memory system prompt. */
  systemPrompt: string;
  /** Model id/ref to dispatch (passthrough of `spec.model.ref`). */
  model?: string;
  /** Execution levers to apply (empty object when the persona sets none). */
  execParams: AgentExecParams;
}

function joinSkills(skills: AgentSpecIdentity["skills"]): string {
  if (Array.isArray(skills)) return skills.filter(Boolean).join(", ");
  return skills ?? "";
}

/**
 * THE canonical lowering: an {@link AgentSpec} → system prompt + model + exec
 * params. Every surface lowers through this so identity, personality, and recalled
 * memory render identically wherever the agent runs. Pure and deterministic, so it
 * is unit-testable and safe in a Worker, Node, and a VS Code extension.
 */
export function lowerAgentSpec(spec: AgentSpec): LoweredAgent {
  const id = spec.identity;
  const sections: string[] = [];

  // --- Identity ----------------------------------------------------------
  const header = `You are ${id.name}${id.title ? `, ${id.title}` : ""}.${id.bio ? ` ${id.bio}` : ""}`;
  const skills = joinSkills(id.skills);
  sections.push(skills ? `${header}\n\nSkills: ${skills}` : header);

  // --- Persona directives ------------------------------------------------
  const directives = spec.persona?.directives?.filter(Boolean) ?? [];
  if (directives.length > 0) {
    sections.push(
      ["Personality (execute under these traits):", ...directives.map((d) => `- ${d}`)].join("\n"),
    );
  }

  // --- Recalled memory ---------------------------------------------------
  const recalled = spec.memory?.recalledContext?.trim();
  if (recalled) {
    sections.push(`Relevant knowledge (recalled from this agent's memory):\n${recalled}`);
  }
  const sig = spec.memory?.stateSignal;
  if (sig) {
    sections.push(`[Memory: step=${sig.step} signal=${sig.signal} context="persistent agent state"]`);
  }

  return {
    systemPrompt: sections.join("\n\n"),
    model: spec.model?.ref ?? undefined,
    execParams: spec.persona?.execParams ?? {},
  };
}
