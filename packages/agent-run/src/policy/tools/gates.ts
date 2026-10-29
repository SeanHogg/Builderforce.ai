/**
 * gates — the ONE on-prem policy-gate evaluation, ported from
 * `agent-runtime/src/agents/policy-gate-seam.ts` (deleted: agent-runtime now asks this module).
 *
 * A path-scoped `block` must actually refuse the call, on every surface. This module
 * evaluates a compiled gate list against one tool call (empty/missing args omit the
 * path so path-scoped gates stay unmatched — the same contract as the shared
 * `evaluatePolicyGate`), matching tool-name synonyms so a `write_file` gate still
 * covers on-prem `write` / SDK `Write`. `block` wins over `require-approval`; an
 * approval is refused with a message the model sees (no approval pause in the kernel).
 *
 * No `node:*` imports, no DOM: this file is compiled into the Worker, the browser
 * and Node.
 */

import { evaluatePolicyGate, toolCallPaths, type PolicyDecision, type PolicyGate } from "@builderforce/agent-tools";

/**
 * Native / SDK tool names the model emits, plus the catalog names a gate is typically
 * authored against (`write_file`, `run_command`, …). Verbatim from the on-prem `policy-gate-seam.ts` this module replaced.
 */
const TOOL_NAME_SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  write: ["write_file", "Write"],
  write_file: ["write", "Write"],
  Write: ["write", "write_file"],
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
};

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
 * `evaluatePolicyGate`. `block` wins over `require-approval` across every synonym.
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

/** `canUseTool` shape — allow or deny; never a prompt. */
export type CanUseToolDecision =
  | { behavior: "allow" }
  | { behavior: "deny"; message: string };

export function canUseToolDecision(
  gates: readonly PolicyGate[] | undefined,
  toolName: string,
  input?: Record<string, unknown>,
): CanUseToolDecision {
  const d = evaluatePolicyGateSeam(gates, toolName, input);
  if (!isPolicyRefusal(d)) return { behavior: "allow" };
  return { behavior: "deny", message: policyRefusalMessage(d) };
}

// ── The allowlist half: which tools a `block` gate withholds ─────────────────

/**
 * The tool vocabulary a gate is authored against — the names the SDK runner passed
 * verbatim as its `allowedTools` (`claude-agent-sdk-runner.ts`, deleted with that
 * runner). A `block` gate names one of these (any case, or a catalog synonym such as
 * `run_command`) and the tool leaves the advertised set; `Task` is the delegation tool,
 * so governance can withhold delegation per tenant.
 */
export const GATED_TOOL_VOCABULARY = ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "Task"] as const;

/**
 * The gates that withhold a tool outright: a `block` with no path scope. A path-scoped
 * block still needs the tool for the unmatched paths — {@link canUseToolDecision} refuses
 * the matching calls at dispatch.
 */
function withholdingGates(gates: readonly PolicyGate[] | undefined): PolicyGate[] {
  return (gates ?? []).filter((g) => g.effect === "block" && !(g.paths && g.paths.length));
}

/** True when an unscoped `block` gate withholds `toolName` (any case, any synonym). */
export function isToolWithheld(gates: readonly PolicyGate[] | undefined, toolName: string): boolean {
  const blocking = withholdingGates(gates);
  if (blocking.length === 0) return false;
  if (blocking.some((g) => !g.tool || g.tool === "*")) return true;
  const blocked = new Set(blocking.map((g) => (g.tool ?? "").toLowerCase()));
  return candidateToolNames(toolName).some((n) => blocked.has(n.toLowerCase()));
}

/**
 * The tools a run may use after `block` gates are applied: the gate vocabulary plus any
 * mounted tool entries in `extraTools`, minus what a gate withholds (case-insensitive;
 * `*` / no tool removes every one). Pure.
 */
export function allowedToolsAfterGates(
  gates: readonly PolicyGate[] | undefined,
  extraTools: readonly string[] = [],
): string[] {
  return [...GATED_TOOL_VOCABULARY, ...extraTools].filter((t) => !isToolWithheld(gates, t));
}

/**
 * The refusal a gate hands the model for one call, or nothing when the call may run.
 * The result carries the gate's id and decision so the model (and the trace) can name
 * what stopped it.
 */
export function gateRefusal(
  gates: readonly PolicyGate[] | undefined,
  toolName: string,
  args?: Record<string, unknown>,
): { data: Record<string, unknown> } | undefined {
  const decision = evaluatePolicyGateSeam(gates, toolName, args);
  if (!isPolicyRefusal(decision)) return undefined;
  return { data: { ok: false, error: policyRefusalMessage(decision), policy: decision } };
}
