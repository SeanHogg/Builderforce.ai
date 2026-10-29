/**
 * The state a run carries across a step boundary: a fresh run's, a resumed run's, the
 * transcript read back out of it, and the two facts the turns record into it.
 */

import { initialRunPolicy, type RunPolicyState } from "@builderforce/run-policy";
import type { ParsedToolCall } from "@builderforce/agent-loop";
import type { ReadCoverageState, RunMessage, RunPolicy, RunState, RunTask } from "./contract.js";
import { initialFinishGateState } from "./policy/finish/gates.js";
import { freshTally, resumeTally } from "./telemetry/runTally.js";

/**
 * A fresh run's state. Every slice starts empty; a hook fills its own. The finish
 * counters start the way `policy/finish` starts them: a sub-agent's deliverable gate
 * starts spent, because its OWNER is held to it for the whole tree.
 */
export function freshState(policy: RunPolicy, task: RunTask): RunState {
  return {
    messages: [],
    step: 0,
    guards: {},
    finish: initialFinishGateState(undefined, task.dispatch.parentRunId !== undefined),
    model: initialModelState(policy),
    memory: { memory: { created: [], edited: [], deleted: [], read: [], searched: [] }, tools: [] },
    compaction: { compactions: 0 },
    writtenPaths: [],
    askedGates: [],
    reads: freshReads(),
    telemetry: freshTally(),
  };
}

/**
 * The model policy's starting state. WS2g owns how a pin, a role and the inference
 * mode become a model; until it lands, a pinned model is asked for as-is and an
 * unpinned run lets the transport choose.
 */
function initialModelState(policy: RunPolicy): RunPolicyState {
  return initialRunPolicy({ pinnedModel: policy.pinnedModel, ...(policy.modelOptions ?? {}) });
}

function freshReads(): ReadCoverageState {
  return { served: {}, readsWithoutSpawn: { reads: 0, spawned: false, nudged: false } };
}

/** The state a resume hands back, with every slice present even if an older writer omitted one. */
export function resumeState(saved: RunState, policy: RunPolicy, task: RunTask): RunState {
  const fresh = freshState(policy, task);
  return {
    ...fresh,
    ...saved,
    guards: saved.guards ?? fresh.guards,
    finish: saved.finish ?? fresh.finish,
    model: saved.model ?? fresh.model,
    memory: saved.memory ?? fresh.memory,
    compaction: saved.compaction ?? fresh.compaction,
    writtenPaths: saved.writtenPaths ?? [],
    askedGates: saved.askedGates ?? [],
    reads: saved.reads ?? fresh.reads,
    telemetry: resumeTally(saved.telemetry),
    messages: Array.isArray(saved.messages) ? saved.messages : [],
  };
}

/** A transcript row, read back out of the state it was saved as. */
export function asMessages(raw: readonly unknown[]): RunMessage[] {
  const out: RunMessage[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Partial<RunMessage>;
    if (r.role !== "system" && r.role !== "user" && r.role !== "assistant" && r.role !== "tool") continue;
    out.push({
      role: r.role,
      content: typeof r.content === "string" ? r.content : "",
      ...(Array.isArray(r.toolCalls) ? { toolCalls: r.toolCalls } : {}),
      ...(typeof r.toolCallId === "string" ? { toolCallId: r.toolCallId } : {}),
    });
  }
  return out;
}

/** Record a write the run made, so the finish gates can see what was delivered. */
export function rememberWrite(state: RunState, call: ParsedToolCall, ok: boolean): void {
  if (!ok) return;
  if (call.name !== "write_file" && call.name !== "edit_file") return;
  const path = typeof call.args.path === "string" ? call.args.path : undefined;
  if (path && !state.writtenPaths.includes(path)) state.writtenPaths = [...state.writtenPaths, path];
}

/** An approval id for a pause that named none, stable for the rest of the run. */
export function newApprovalId(state: RunState): string {
  return `approval-${state.askedGates.length + 1}`;
}

