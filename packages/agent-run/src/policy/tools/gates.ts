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
import type { ApprovalRefusal } from "../../contract.js";
import type { GuardControl, PolicyContext, PolicyToolCall } from "../hooks.js";
import { emit } from "../../runContext.js";

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
  // A patch is a write and an edit at once: a gate authored on either covers it.
  apply_patch: ["write_file", "write", "Write", "edit_file", "edit", "Edit"],
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

/**
 * Tools whose ACTION decides what they are: `nodes` with `action: "run"` runs a command on a node, so a gate on the exec family
 * covers it at dispatch. DATA, read by {@link candidateToolNames}; the whole tool is NOT withheld from the catalog (its other
 * actions are not execution), so only a call with the named action evaluates as the family.
 */
const ACTION_TOOL_FAMILIES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  nodes: { run: "exec" },
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

function candidateToolNames(toolName: string, args?: Record<string, unknown>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const action = typeof args?.action === "string" ? args.action.trim().toLowerCase() : "";
  const family = ACTION_TOOL_FAMILIES[toolName]?.[action];
  const names = [toolName, ...(TOOL_NAME_SYNONYMS[toolName] ?? []), ...(family ? [family, ...(TOOL_NAME_SYNONYMS[family] ?? [])] : [])];
  for (const n of names) {
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
  for (const name of candidateToolNames(toolName, args)) {
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

/** What the model reads when an approval was not granted: declined, timed out and stopped each say what happened. */
function approvalRefusalMessage(refusal: ApprovalRefusal, tool: string, gateId: string, answer: string): string {
  if (refusal === "timed_out") return `No approver answered "${tool}" in time (governance gate ${gateId}), so it was not run.`;
  if (refusal === "stopped") return `The run was stopped before "${tool}" was approved (governance gate ${gateId}), so it was not run.`;
  return `The approver declined "${tool}" (governance gate ${gateId}).${answer ? ` ${answer}` : ""}`;
}

/**
 * Judge one call against `RunPolicy.approvalGates`. A `block` refuses it (the model reads
 * why and takes another path). A `require-approval` asks the human channel the FIRST time
 * that exact call is reached: answered in-run, it proceeds on an APPROVED decision; parked,
 * it returns the control that parks the run and remembers the approval it parked on
 * (`RunState.parkedCalls`). The retried identical call asks the channel for that approval's
 * STRUCTURED status — approved ⇒ it proceeds (`approvedCalls`), rejected ⇒ it is declined,
 * still pending ⇒ the run parks again on the same approval. A host with no `approve` port
 * has no approver: the gate puts a plain question to the person (`human.ask`) and, parked
 * without an approval record, the retried call proceeds after the resume. Nothing ⇒ allowed.
 */
export async function gateCall(
  ctx: PolicyContext,
  call: PolicyToolCall,
): Promise<{ data: unknown; isError: true; control?: GuardControl } | void> {
  const gates = ctx.policy.approvalGates;
  if (!gates || gates.length === 0) return undefined;
  const decision = evaluatePolicyGateSeam(gates, call.name, call.args);
  if (decision.action === "block") {
    await emit(ctx.ports.events, { kind: "policy.blocked", step: ctx.step, tool: call.name, gateId: decision.gateId, reason: decision.reason });
    return {
      data: { ok: false, gate: decision.gateId, error: `Blocked by governance policy: ${decision.reason}. Do not retry this tool — accomplish the task another way, or finish and explain why it cannot proceed.` },
      isError: true,
    };
  }
  if (decision.action !== "require-approval") return undefined;
  const key = policyGateCallKey(decision.gateId, call.name, call.args);
  if ((ctx.state.approvedCalls ?? []).includes(key)) return undefined;

  const gate: PolicyGate = gates.find((g) => g.id === decision.gateId) ?? { id: decision.gateId, effect: "require-approval", reason: decision.reason };
  const question = `Approve the agent's use of "${call.name}"? ${decision.reason}`;
  const human = ctx.ports.human;
  const parkedOn = ctx.state.parkedCalls?.[key];
  // A surface WITH an approver asks it, and reads a parked call's STRUCTURED status on the retried identical call.
  // One WITHOUT (on-prem, the IDE) puts a plain question to the person — never a refusal; an answer to it is
  // not an approval, so only the person's resume (below) lets the call through.
  const answer = human.approve
    ? await human.approve(gate, { tool: call.name, args: call.args, reason: decision.reason, ...(parkedOn ? { approvalId: parkedOn } : {}) })
    : await human.ask(question);
  // A channel that cannot say anything at all is no approver: the policy refuses the call (the model reads why).
  if (!answer) {
    const error = policyRefusalMessage(decision);
    await emit(ctx.ports.events, { kind: "policy.blocked", step: ctx.step, tool: call.name, gateId: decision.gateId, reason: error });
    return { data: { ok: false, gate: decision.gateId, error }, isError: true };
  }
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
    const refusal = answer.refusal ?? "declined";
    const error = approvalRefusalMessage(refusal, call.name, decision.gateId, answer.answer);
    // A refusal is a gate stopping a call whoever said no, so it is told like a block (the surface names the gate when a run ends on it).
    await emit(ctx.ports.events, { kind: "policy.blocked", step: ctx.step, tool: call.name, gateId: decision.gateId, reason: error });
    return { data: { ok: false, gate: decision.gateId, error }, isError: true };
  }
  // Parked. With an approval record, the call is NOT approved: the retried identical call reads that record's
  // status. With none (a plain question), the person's answer arrives with the resume, and the retried call proceeds.
  const approvalId = answer.approvalId ?? parkedOn;
  if (approvalId) ctx.state.parkedCalls = { ...(ctx.state.parkedCalls ?? {}), [key]: approvalId };
  else ctx.state.approvedCalls = [...(ctx.state.approvedCalls ?? []), key];
  return {
    data: { ok: false, error: `Paused for human approval of "${call.name}" (governance gate ${decision.gateId}).` },
    isError: true,
    // `parked`: the approver's channel already parked the run — the kernel settles `paused`, it never asks a second time.
    control: { kind: "ask_human", question, parked: true, ...(approvalId ? { approvalId } : {}) },
  };
}
