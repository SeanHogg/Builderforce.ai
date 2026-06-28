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
 * A governance gate compiled onto the spec (the `policy` modality). Because a gate
 * lives *on the spec* — not inside one front door — it reaches every surface for
 * free: a gate authored once applies in the IDE exactly as it does on a cloud tick
 * or a workflow node, because every surface lowers through {@link lowerAgentSpec}.
 *
 * - `inject-directive` — prepend a governing instruction to the system prompt
 *   (live on every surface today, via the lowering below).
 * - `require-approval` — the engine must pause for human approval before invoking
 *   `tool` (or any tool when `tool` is omitted). Evaluated by {@link evaluatePolicyGate}.
 * - `block` — the engine must refuse `tool` outright.
 */
export interface PolicyGate {
  id: string;
  /** Tool this gate governs; omit (or `"*"`) to govern every tool call. */
  tool?: string;
  effect: "inject-directive" | "require-approval" | "block";
  /** The instruction injected (inject-directive) or the human-readable reason. */
  directive?: string;
  reason?: string;
}

export interface AgentSpecPolicy {
  gates: PolicyGate[];
}

/**
 * Defensively coerce an untrusted value (a parsed run payload, a dispatch frame)
 * into well-formed {@link PolicyGate}s — dropping anything without a string `id` and
 * a known `effect`. Shared so every surface that reads gates off the wire (the cloud
 * payload parser, the on-prem relay) validates them identically.
 */
export function coercePolicyGates(raw: unknown): PolicyGate[] {
  if (!Array.isArray(raw)) return [];
  const out: PolicyGate[] = [];
  for (const g of raw) {
    if (!g || typeof g !== "object") continue;
    const { id, tool, effect, directive, reason } = g as Record<string, unknown>;
    if (typeof id !== "string") continue;
    if (effect !== "inject-directive" && effect !== "require-approval" && effect !== "block") continue;
    out.push({
      id,
      effect,
      ...(typeof tool === "string" ? { tool } : {}),
      ...(typeof directive === "string" ? { directive } : {}),
      ...(typeof reason === "string" ? { reason } : {}),
    });
  }
  return out;
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
  /** Governance gates that apply on every surface the spec deploys to. */
  policy?: AgentSpecPolicy;
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

/** Render one {@link PolicyGate} as a binding system-prompt line. */
function policyGateDirective(g: PolicyGate): string {
  const scope = !g.tool || g.tool === "*" ? "any tool" : `the \`${g.tool}\` tool`;
  switch (g.effect) {
    case "inject-directive":
      return (g.directive ?? "").trim();
    case "require-approval":
      return `Before using ${scope}, pause and request explicit human approval${g.reason ? ` (${g.reason})` : ""}.`;
    case "block":
      return `Never use ${scope}${g.reason ? ` — ${g.reason}` : ""}. Refuse and explain instead.`;
  }
}

/**
 * Render governance gates as binding system-prompt lines (the "Governance" block).
 * Shared so every surface that injects gates into a prompt — the canonical
 * {@link lowerAgentSpec} AND the on-prem SDK runner (which builds its own prompt) —
 * renders them identically. Returns '' when there are no gates.
 */
export function renderPolicyDirectives(gates: readonly PolicyGate[] | undefined): string {
  const lines = (gates ?? []).map(policyGateDirective).filter(Boolean);
  if (lines.length === 0) return "";
  return ["Governance (these gates are binding):", ...lines.map((g) => `- ${g}`)].join("\n");
}

/** The decision a policy evaluation yields at the engine's tool-call seam. */
export type PolicyDecision =
  | { action: "allow" }
  | { action: "require-approval"; gateId: string; reason: string }
  | { action: "block"; gateId: string; reason: string };

/**
 * Hard-enforce the policy gates for a pending tool call. Pure and surface-agnostic
 * so every engine (cloud tick, on-prem loop, workflow node) enforces governance the
 * same way: call this before invoking a tool and honour the decision. `block` wins
 * over `require-approval` when both match. Gates with no `tool` (or `"*"`) match all.
 */
export function evaluatePolicyGate(
  gates: readonly PolicyGate[] | undefined,
  toolName: string,
): PolicyDecision {
  const matches = (gates ?? []).filter((g) => !g.tool || g.tool === "*" || g.tool === toolName);
  const blocked = matches.find((g) => g.effect === "block");
  if (blocked) return { action: "block", gateId: blocked.id, reason: blocked.reason ?? "blocked by policy" };
  const approval = matches.find((g) => g.effect === "require-approval");
  if (approval) {
    return { action: "require-approval", gateId: approval.id, reason: approval.reason ?? "approval required by policy" };
  }
  return { action: "allow" };
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

  // --- Governance gates --------------------------------------------------
  // Rendered into the prompt so policy reaches EVERY surface identically; hard
  // pause/refusal enforcement is `evaluatePolicyGate` at the engine's tool seam.
  const governance = renderPolicyDirectives(spec.policy?.gates);
  if (governance) sections.push(governance);

  return {
    systemPrompt: sections.join("\n\n"),
    model: spec.model?.ref ?? undefined,
    execParams: spec.persona?.execParams ?? {},
  };
}
