/**
 * gates — the ONE policy-gate evaluation of the agent, ported from the on-prem
 * `agent-runtime/src/agents/policy-gate-seam.ts` (deleted: agent-runtime asks this module).
 *
 * A path-scoped `block` must actually refuse the call, on every surface. This module
 * evaluates a compiled gate list against one tool call (empty/missing args omit the
 * path so path-scoped gates stay unmatched — the same contract as the shared
 * `evaluatePolicyGate`), matching tool-name synonyms so a `write_file` gate still
 * covers on-prem `write` / SDK `Write`. `block` wins over `require-approval`.
 *
 * Three things a gate can do to a call (see {@link gateVerdict}):
 *   - `block` — the tool never runs; the model reads which gate stopped it;
 *   - `require-approval` — the run asks a human once per CALL (gate + tool + argument
 *     hash, {@link policyGateCallKey}) and proceeds on the answer, or parks;
 *   - an unscoped `block` also withholds the tool from the advertised catalog
 *     ({@link isToolWithheld}).
 * The control tools (`finish`, `ask_human`, `ask_user`) are how a run ends or asks: a
 * gate that names no tool (or `*`) never withholds or refuses them, so a fully-gated
 * run can still stop and ask. A gate that NAMES one still applies.
 *
 * No `node:*` imports, no DOM: this file is compiled into the Worker, the browser
 * and Node.
 */

import {
  evaluatePolicyGate,
  policyGateCallKey,
  toolCallPaths,
  type PolicyDecision,
  type PolicyGate,
} from "@builderforce/agent-tools";

/**
 * Native / SDK tool names the model emits, plus the catalog names a gate is typically
 * authored against (`write_file`, `run_command`, …). The on-prem `policy-gate-seam.ts`
 * table, extended with the SDK vocabulary the SDK runner's allowlist covered: `Task` is
 * delegation (`spawn_agent(s)`), `Glob` / `Grep` are `list_files` / `search_code`, and a
 * write gate also covers `delete_file` (a delete is a write).
 */
const TOOL_NAME_SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  write: ["write_file", "Write"],
  write_file: ["write", "Write"],
  Write: ["write", "write_file"],
  delete_file: ["write_file", "write", "Write"],
  edit: ["edit_file", "Edit"],
  edit_file: ["edit", "Edit"],
  Edit: ["edit", "edit_file"],
  exec: ["run_command", "Bash", "bash"],
  Bash: ["run_command", "exec", "bash"],
  bash: ["run_command", "exec", "Bash"],
  run_command: ["exec", "Bash", "bash"],
  read: ["read_file", "Read"],
  Read: ["read", "read_file"],
  read_file: ["read", "Read"],
  Task: ["spawn_agent", "spawn_agents"],
  spawn_agent: ["Task", "spawn_agents"],
  spawn_agents: ["Task", "spawn_agent"],
  Glob: ["list_files"],
  list_files: ["Glob"],
  Grep: ["search_code"],
  search_code: ["Grep"],
};

/** How a run ends or asks. A gate that names no tool never gets between a run and these. */
const CONTROL_TOOLS: ReadonlySet<string> = new Set(["finish", "ask_human", "ask_user"]);

export type PolicyRefusal = Extract<PolicyDecision, { action: "block" | "require-approval" }>;

export function isPolicyRefusal(d: PolicyDecision): d is PolicyRefusal {
  return d.action === "block" || d.action === "require-approval";
}

/** Message the model sees when a gate refuses the call. */
export function policyRefusalMessage(d: PolicyRefusal): string {
  if (d.action === "block") {
    return `Policy gate ${d.gateId} blocked this tool call: ${d.reason}`;
  }
  return (
    `Policy gate ${d.gateId} requires human approval before this tool call (${d.reason}). ` +
    "This runner has no approval pause; the call was refused."
  );
}

function candidateToolNames(toolName: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of [toolName, ...(TOOL_NAME_SYNONYMS[toolName] ?? [])]) {
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

/**
 * Evaluate compiled gates against one tool call. Empty/missing args (no path) omit the
 * path argument so path-scoped gates stay unmatched — the same contract as the shared
 * `evaluatePolicyGate`. `block` wins over `require-approval` across every name synonym.
 */
export function evaluatePolicyGateSeam(
  gates: readonly PolicyGate[] | undefined,
  toolName: string,
  args?: Record<string, unknown>,
): PolicyDecision {
  const paths = toolCallPaths(args);
  const pathArg = paths.length ? paths : undefined;
  let approval: PolicyRefusal | undefined;
  for (const name of candidateToolNames(toolName)) {
    const d = evaluatePolicyGate(gates, name, pathArg);
    if (d.action === "block") return d;
    if (d.action === "require-approval") approval = d;
  }
  return approval ?? { action: "allow" };
}

/** The gates that apply to `toolName`: for a control tool, only those that NAME a tool. */
function gatesFor(gates: readonly PolicyGate[] | undefined, toolName: string): readonly PolicyGate[] {
  const all = gates ?? [];
  return CONTROL_TOOLS.has(toolName) ? all.filter((g) => g.tool && g.tool !== "*") : all;
}

// ── The catalog half: which tools an unscoped `block` gate withholds ─────────

/**
 * True when an unscoped `block` gate withholds `toolName` (any case, any synonym). A
 * path-scoped block still needs the tool for the unmatched paths — the dispatch refusal
 * ({@link gateVerdict}) stops the matching calls.
 */
export function isToolWithheld(gates: readonly PolicyGate[] | undefined, toolName: string): boolean {
  const blocking = gatesFor(gates, toolName).filter((g) => g.effect === "block" && !(g.paths && g.paths.length));
  if (blocking.length === 0) return false;
  if (blocking.some((g) => !g.tool || g.tool === "*")) return true;
  const blocked = new Set(blocking.map((g) => (g.tool ?? "").toLowerCase()));
  return candidateToolNames(toolName).some((n) => blocked.has(n.toLowerCase()));
}

// ── The dispatch half: what a gate does to one call ──────────────────────────

/** What the gates decided about one call. */
export type GateVerdict =
  | { kind: "allow" }
  /** Refuse: `data` is the result the model reads in place of the tool's. */
  | { kind: "block"; data: Record<string, unknown> }
  /** Ask a human once for THIS call; `key` is its identity in `RunState.askedGates`. */
  | { kind: "approve"; gate: PolicyGate; key: string; reason: string };

/** Decide one call against the run's gates. Pure. */
export function gateVerdict(
  gates: readonly PolicyGate[] | undefined,
  toolName: string,
  args: Record<string, unknown>,
): GateVerdict {
  const applicable = gatesFor(gates, toolName);
  const decision = evaluatePolicyGateSeam(applicable, toolName, args);
  if (decision.action === "block") {
    return { kind: "block", data: { ok: false, error: policyRefusalMessage(decision), policy: decision } };
  }
  if (decision.action === "require-approval") {
    const gate = applicable.find((g) => g.id === decision.gateId) ?? {
      id: decision.gateId,
      effect: "require-approval" as const,
      tool: toolName,
      reason: decision.reason,
    };
    return { kind: "approve", gate, key: policyGateCallKey(decision.gateId, toolName, args), reason: decision.reason };
  }
  return { kind: "allow" };
}

/** The result a call gets when it needs approval and the surface has no one to ask. */
export function approvalRefusal(verdict: Extract<GateVerdict, { kind: "approve" }>): { data: Record<string, unknown> } {
  const decision: PolicyRefusal = { action: "require-approval", gateId: verdict.gate.id, reason: verdict.reason };
  return { data: { ok: false, error: policyRefusalMessage(decision), policy: decision } };
}
