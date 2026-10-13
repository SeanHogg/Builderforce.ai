/**
 * On-prem tool-dispatch policy seam.
 *
 * Cloud already calls `evaluatePolicyGate` in `beforeDispatch`. The on-prem native
 * loop and the V2 SDK runner did not — gates only rendered into the prompt / a
 * name-only allowlist, so a path-scoped `block` never actually refused the call.
 *
 * This module is the ONE place those two surfaces evaluate a gate at invoke time.
 * There is no on-prem policy-pause UI; `require-approval` is refused with a message
 * the model sees rather than inventing an approval prompt.
 */

import {
  evaluatePolicyGate,
  toolCallPaths,
  type PolicyDecision,
  type PolicyGate,
} from "@builderforce/agent-tools";

/**
 * Native / SDK tool names the model emits, plus the catalog names a gate is
 * typically authored against (`write_file`, `run_command`, …). Evaluating every
 * synonym means a `write_file` gate still matches on-prem `write` / SDK `Write`.
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
    "This on-prem runner has no approval pause; the call was refused."
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
 * Evaluate compiled gates against one tool call. Empty/missing args (no path)
 * omit the path argument so path-scoped gates stay unmatched — the same contract
 * as the shared `evaluatePolicyGate`.
 *
 * `block` wins over `require-approval` across every name synonym.
 */
export function evaluateOnPremPolicyGate(
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

/** SDK `canUseTool` shape — allow or deny; never a prompt. */
export type CanUseToolDecision =
  | { behavior: "allow" }
  | { behavior: "deny"; message: string };

export function canUseToolDecision(
  gates: readonly PolicyGate[] | undefined,
  toolName: string,
  input?: Record<string, unknown>,
): CanUseToolDecision {
  const d = evaluateOnPremPolicyGate(gates, toolName, input);
  if (!isPolicyRefusal(d)) return { behavior: "allow" };
  return { behavior: "deny", message: policyRefusalMessage(d) };
}
