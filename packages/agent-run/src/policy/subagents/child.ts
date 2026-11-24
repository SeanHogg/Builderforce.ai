/**
 * What a child run is, derived from its owner's (PRD 35 §6): a sub-agent is the SAME agent
 * with its own transcript — a CLONE of its owner, one level down, with the same catalog.
 * The adapter supplies the ports a child runs on; WHAT a child holds, which policy it runs
 * under and how its outcome reads to the owner are the agent's, so they are here and no
 * adapter restates them.
 *
 *   - {@link childPolicy}: the owner's execution policy with child scope and role;
 *   - {@link childProvider}: the owner's capabilities minus what a child mechanically
 *     cannot do (`childCapabilities`, the cloud's rule — one source in `agent-tools`) and
 *     the services behind them;
 *   - {@link childResult}: the child's outcome as the `spawn_agent` result its owner reads.
 *
 * No `node:*` imports, no DOM: this file is compiled into the Worker, the browser and Node.
 */

import {
  childCapabilities,
  clipChildOutput,
  type CapabilityProvider,
  type SubagentRequest,
  type SubagentResult,
} from "@builderforce/agent-tools";
import type { RunOutcome, RunPolicy, RunTask } from "../../contract.js";
import { isSpawnTool } from "./delegationRequest.js";
import { MAX_SUBAGENT_DEPTH, subagentSystemPrompt, type SubagentPersona } from "@builderforce/agent-loop";
import { ALL_ENTRY_POINTS, type EntryPoint } from "@builderforce/learned-routing";

export interface SpawnChildRequest {
  parentRunId: string;
  entryPoint: EntryPoint;
  /** The child's depth, not the parent's. */
  depth: number;
  owner: string;
  task: string;
  role?: string;
  persona?: SubagentPersona;
  basePrompt?: string;
  workItemIds?: readonly string[];
}

export interface ChildStartRequest {
  prompt: string;
  systemPrompt: string;
  entryPoint: EntryPoint;
  lineage: { parentRunId: string; depth: number };
  workItemIds: readonly string[];
}

/** Validate before recording a child as admitted. */
export function validateChildStart(request: Pick<SpawnChildRequest, "entryPoint" | "parentRunId" | "depth" | "owner" | "task">): void {
  if (!ALL_ENTRY_POINTS.includes(request.entryPoint)) throw new Error("spawnChild: entryPoint is required and must be registered");
  if (typeof request.parentRunId !== "string" || !request.parentRunId.trim()) throw new Error("spawnChild: parentRunId is required");
  if (!Number.isInteger(request.depth) || request.depth < 1 || request.depth > MAX_SUBAGENT_DEPTH) {
    throw new Error(`spawnChild: child depth must be an integer from 1 through ${MAX_SUBAGENT_DEPTH}`);
  }
  if (typeof request.owner !== "string" || !request.owner.trim() || typeof request.task !== "string" || !request.task.trim()) {
    throw new Error("spawnChild: owner and task are required");
  }
}

/** Prepare without starting: durable hosts can persist these inputs for their later tick. */
export function prepareChildStart(request: SpawnChildRequest): ChildStartRequest {
  validateChildStart(request);
  const standing = subagentSystemPrompt(request.persona, { owner: request.owner, role: request.role });
  return {
    prompt: request.task,
    systemPrompt: request.basePrompt ? `${standing}\n\n${request.basePrompt}` : standing,
    entryPoint: request.entryPoint,
    lineage: { parentRunId: request.parentRunId, depth: request.depth },
    workItemIds: [...(request.workItemIds ?? [])],
  };
}

export interface SpawnChildPorts<Result> {
  /** Authenticated/scoped host start. Result is its native admission handle OR completed report. */
  openRun(request: ChildStartRequest): Promise<Result>;
}

/** Validate before host side effects; never interpret an admission handle as a completed report. */
export async function spawnChild<Result>(request: SpawnChildRequest, ports: SpawnChildPorts<Result>): Promise<Result> {
  const child = prepareChildStart(request);
  assertCanSpawnChild(request.depth - 1);
  return ports.openRun(child);
}

/** Only root runs can create new children. Existing deeper lineage can still be read. */
export function canSpawnChild(parentDepth: number): boolean {
  return parentDepth === 0;
}

export function assertCanSpawnChild(parentDepth: number): void {
  if (!canSpawnChild(parentDepth)) throw new Error(CHILD_SPAWN_REFUSAL);
}

export const CHILD_SPAWN_REFUSAL = "Only root runs can spawn sub-agents";

/** Applies to both the shared registry and host-supplied native tools. */
export function blocksChildSpawn(dispatch: RunTask["dispatch"], tool: string): boolean {
  return (dispatch.source === "subagent" || dispatch.parentRunId !== undefined)
    && (isSpawnTool(tool) || tool === "sessions_spawn" || tool === "Task");
}

/** The owner's policy, narrowed to one of its children. */
export function childPolicy(parent: RunPolicy, request: Pick<SubagentRequest, "role">): RunPolicy {
  return {
    ...parent,
    toolScope: "subagent",
    role: request.role ?? parent.role,
  };
}

/**
 * The owner's capabilities as a child holds them: the same set minus what is never
 * delegable (`human`, `skill.author`) and minus delegation itself — a child spawns no
 * children of its own here — together with the services those capabilities back.
 */
export function childProvider(parent: CapabilityProvider): CapabilityProvider {
  const { orchestration: _orchestration, human: _human, skillAuthor: _skillAuthor, ...kept } = parent;
  return { ...kept, capabilities: childCapabilities(parent.capabilities) };
}

/** A child's outcome as the result its owner reads (`outputChars` caps a fan-out's share). */
export function childResult(outcome: RunOutcome, request: Pick<SubagentRequest, "outputChars" | "ticket">): SubagentResult {
  switch (outcome.kind) {
    case "finished":
      return {
        ok: true,
        output: request.outputChars ? outcome.output.slice(0, request.outputChars) : clipChildOutput(outcome.output),
        steps: outcome.state.step,
        ...(request.ticket ? { ticket: request.ticket } : {}),
      };
    case "paused":
      return { ok: false, error: `the sub-agent stopped to ask a person: ${outcome.question}` };
    case "yielded":
      return { ok: true, output: "", truncated: true, steps: outcome.state.step };
    case "failed":
      return { ok: false, error: outcome.reason };
  }
}
