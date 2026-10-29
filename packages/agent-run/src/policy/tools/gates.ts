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
 * Three things a gate can do (see {@link gateCall} and {@link isToolWithheld}):
 *   - `block` — the tool never runs; the model reads which gate stopped it;
 *   - `require-approval` — the run asks the human channel once per CALL (gate + tool +
 *     argument hash, {@link policyGateCallKey}) and proceeds on an approving answer;
 *   - an unscoped `block` also withholds the tool from the advertised catalog.
 * The control tools (`finish`, `ask_human`, `ask_user`) are how a run ends or asks: a gate
 * that names no tool (or `*`) never withholds or refuses them, so a fully-gated run can
 * still stop and ask. A gate that NAMES one still applies.
 *
 * No `node:*` imports, no DOM: this file is compiled into the Worker, the browser
 * and Node.
 */

import { evaluatePolicyGate, policyGateCallKey, toolCallPaths, type PolicyDecision, type PolicyGate } from "@builderforce/agent-tools";
import type { GuardControl, PolicyContext, PolicyToolCall } from "../hooks.js";

export { policyGateCallKey };

/**
 * Native / SDK tool names the model emits, plus the catalog names a gate is typically
 * authored against (`write_file`, `run_command`, …). The on-prem `policy-gate-seam.ts`
 * table, extended with the SDK vocabulary its runner's allowlist covered: `Task` is
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

/** Message the model sees when a gate refuses the call (for a surface with no approver to ask). */
export function policyRefusalMessage(d: PolicyRefusal): string {
  if (d.action === "block") {
    return `Policy gate ${d.gateId} blocked this tool call: ${d.reason}`;
  }
  return (
    `Policy gate ${d.gateId} requires human approval before this tool call (${d.reason}). ` +
    "No approver is available on this host (no approval pause), so the call was refused."
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

/** The gates that apply to `toolName`: for a control tool, only those that NAME a tool. */
function gatesFor(gates: readonly PolicyGate[] | undefined, toolName: string): readonly PolicyGate[] {
  const all = gates ?? [];
  return CONTROL_TOOLS.has(toolName) ? all.filter((g) => g.tool && g.tool !== "*") : all;
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
  const applicable = gatesFor(gates, toolName);
  const paths = toolCallPaths(args);
  const pathArg = paths.length ? paths : undefined;
  let approval: PolicyRefusal | undefined;
  for (const name of candidateToolNames(toolName)) {
    const d = evaluatePolicyGate(applicable, name, pathArg);
    if (d.action === "block") return d;
    if (d.action === "require-approval") approval = d;
  }
  return approval ?? { action: "allow" };
}

/**
 * True when an unscoped `block` gate withholds `toolName` (any case, any synonym). A
 * path-scoped block still needs the tool for the unmatched paths — {@link gateCall} refuses
 * the matching calls at dispatch.
 */
export function isToolWithheld(gates: readonly PolicyGate[] | undefined, toolName: string): boolean {
  const blocking = gatesFor(gates, toolName).filter((g) => g.effect === "block" && !(g.paths && g.paths.length));
  if (blocking.length === 0) return false;
  if (blocking.some((g) => !g.tool || g.tool === "*")) return true;
  const blocked = new Set(blocking.map((g) => (g.tool ?? "").toLowerCase()));
  return candidateToolNames(toolName).some((n) => blocked.has(n.toLowerCase()));
}

// ── The in-run gate (RunPolicy.approvalGates) — ported from the cloud loop's beforeDispatch ──

// The identity of ONE `require-approval` decision (`policyGateCallKey`) is shared by every surface: `@builderforce/agent-tools`.

/**
 * Judge one call against `RunPolicy.approvalGates`. A `block` refuses it (the model reads
 * why and takes another path). A `require-approval` asks the human channel the FIRST time
 * that exact call is reached: answered in-run, it proceeds on an APPROVED decision; parked,
 * it returns the control that parks the run and remembers the approval it parked on
 * (`RunState.parkedCalls`). The retried identical call asks the channel for that approval's
 * STRUCTURED status — approved ⇒ it proceeds (`approvedCalls`), rejected ⇒ it is declined,
 * still pending ⇒ the run parks again on the same approval. A host with no `approve` port
 * has no approver to ask: the gate REFUSES the call. Nothing ⇒ the call is allowed.
 */
export async function gateCall(
  ctx: PolicyContext,
  call: PolicyToolCall,
): Promise<{ data: unknown; isError: true; control?: GuardControl } | void> {
  const gates = ctx.policy.approvalGates;
  if (!gates || gates.length === 0) return undefined;
  const decision = evaluatePolicyGateSeam(gates, call.name, call.args);
  if (decision.action === "block") {
    await ctx.ports.events.emit({ kind: "policy.blocked", step: ctx.step, tool: call.name, gateId: decision.gateId, reason: decision.reason });
    return {
      data: { ok: false, error: `Blocked by governance policy: ${decision.reason}. Do not retry this tool — accomplish the task another way, or finish and explain why it cannot proceed.` },
      isError: true,
    };
  }
  if (decision.action !== "require-approval") return undefined;
  const key = policyGateCallKey(decision.gateId, call.name, call.args);
  if ((ctx.state.approvedCalls ?? []).includes(key)) return undefined;

  const gate: PolicyGate = gates.find((g) => g.id === decision.gateId) ?? { id: decision.gateId, effect: "require-approval", reason: decision.reason };
  const question = `Approve the agent's use of "${call.name}"? ${decision.reason}`;
  const human = ctx.ports.human;
  // No approver to ask ⇒ the policy refuses the call (the model reads why and takes another path).
  if (!human.approve) return { data: { ok: false, error: policyRefusalMessage(decision) }, isError: true };
  const parkedOn = ctx.state.parkedCalls?.[key];
  const answer = await human.approve(gate, { tool: call.name, args: call.args, reason: decision.reason, ...(parkedOn ? { approvalId: parkedOn } : {}) });
  // The decision is the approval's STRUCTURED outcome, never matched out of the answer's words.
  if (answer.kind === "answered") {
    if (parkedOn) {
      const { [key]: _settled, ...rest } = ctx.state.parkedCalls ?? {};
      ctx.state.parkedCalls = rest;
    }
    if (answer.approved === true) {
      ctx.state.approvedCalls = [...(ctx.state.approvedCalls ?? []), key];
      return undefined;
    }
    return { data: { ok: false, error: `The approver declined "${call.name}" (governance gate ${decision.gateId}).${answer.answer ? ` ${answer.answer}` : ""}` }, isError: true };
  }
  // Parked: the call is NOT approved. The person answers after the resume; the retried identical call reads that decision.
  const approvalId = answer.approvalId ?? parkedOn;
  if (approvalId) ctx.state.parkedCalls = { ...(ctx.state.parkedCalls ?? {}), [key]: approvalId };
  return {
    data: { ok: false, error: `Paused for human approval of "${call.name}" (governance gate ${decision.gateId}).` },
    isError: true,
    // `parked`: the approver's channel already parked the run — the kernel settles `paused`, it never asks a second time.
    control: { kind: "ask_human", question, parked: true, ...(approvalId ? { approvalId } : {}) },
  };
}
