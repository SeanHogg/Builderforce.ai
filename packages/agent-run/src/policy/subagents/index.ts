/**
 * policy/subagents — `policy/subagents/**` — the child that is the SAME agent with its own ports, the delegation nudge and the end-of-run backstop.
 *
 * Owned by WS2c. It ports, behind the {@link SubagentsHook} the composition calls:
 *   - the child's standing instructions (`subagentSystemPrompt`) and report contract
 *     (`parseSubagentReport`) — `packages/agent-loop/src/subagent.ts`. A child is a
 *     CLONE of its owner — the same tools, the same execution, one level down — so it is
 *     told to carry its slice out, not what it may not touch. Its final message is its
 *     report, and the owner acts on it;
 *   - the delegation nudge and the end-of-run backstop (`delegationRequest.ts` +
 *     brain-embedded `runStore/earlyDelegation.ts`): gated on `RunPolicy.delegation`, the
 *     early nudge fires after `readsBeforeNudge` reads with no spawn (counted by
 *     run-guards' `ReadsWithoutSpawn`), and when the run is about to settle without
 *     starting any, {@link delegationBackstop} names the call that clears the block — a
 *     model told only "use sub-agents" argues from the kill-switch otherwise;
 *   - the child report clip (`SUBAGENT_REPORT_CHARS` / `clipChildOutput`), reused from
 *     `@builderforce/agent-tools`.
 *
 * What a surface supplies is the PORT, not the policy: the tool schemas the run was
 * given (which let it spawn) and the transcript of what it has called. The hook reads
 * those and returns a decision — the nudged read result, or the backstop note — never
 * reaching into how a child actually starts (that is the `orchestrate` capability's job
 * on the surface, not the policy's).
 *
 * `delegationRequest.ts` is the port of `brain-embedded/src/delegationRequest.ts`, the
 * replacement home (PRD 35 §5 rule 1): this package may not import brain-embedded, and
 * no shared package carries those predicates, so brain-embedded's copy is deleted when
 * its adapter switches over (WS4), never kept beside this one.
 *
 * No `node:*` imports, no DOM: this file is compiled into the Worker, the browser
 * and Node.
 */

import { parseSubagentReport, subagentSystemPrompt, type SubagentLiveOwner, type SubagentPersona } from "@builderforce/agent-loop";
import { SUBAGENT_REPORT_CHARS, clipChildOutput } from "@builderforce/agent-tools";
import { ReadsWithoutSpawn, type DelegationCallKind, type ReadsWithoutSpawnState } from "@builderforce/run-guards";
import type { PolicyContext, PolicyToolCall, SubagentsHook } from "../hooks.js";
import { isReadOnlyCloudTool } from "../guards/readOnly.js";
import { asksForSubagents, attemptedDelegation, canSpawnHere, earlyDelegationNudge, isSpawnTool, leftDelegationUndone, undelegatedRequestNudge, type DelegationTraceEvent } from "./delegationRequest.js";

export { parseSubagentReport, subagentSystemPrompt, asksForSubagents, attemptedDelegation, canSpawnHere, earlyDelegationNudge, leftDelegationUndone, undelegatedRequestNudge };
// A child's report is clipped ONCE, by agent-tools' rule (WS8j) — never a second cap here.
export { SUBAGENT_REPORT_CHARS, clipChildOutput };
export type { DelegationTraceEvent, SubagentLiveOwner, SubagentPersona };

/** The tool names the surface can run — what `canSpawnHere` and the nudges name. */
function toolNamesOf(ctx: PolicyContext): string[] {
  return ctx.tools.map((tool) => tool.function?.name).filter((name): name is string => !!name);
}

/** What one call is to the reads-without-spawn counter: a spawn, a read, or neither. */
export function delegationCallKind(name: string): DelegationCallKind {
  if (isSpawnTool(name)) return "spawn";
  return isReadOnlyCloudTool(name) ? "read" : "other";
}

/**
 * The run's reads-without-spawn count, folded from its own transcript through
 * `@builderforce/run-guards`' {@link ReadsWithoutSpawn} and merged with the persisted
 * slice (`RunState.reads.readsWithoutSpawn`), so a compacted transcript never lowers it
 * and a resumed run continues the same count.
 */
export function readsWithoutSpawnOf(ctx: PolicyContext): ReadsWithoutSpawnState {
  const counter = new ReadsWithoutSpawn();
  for (const message of ctx.messages) {
    for (const call of message.toolCalls ?? []) counter.record(delegationCallKind(call.name));
  }
  const counted = counter.snapshot();
  const saved = ctx.state.reads.readsWithoutSpawn;
  const spawned = saved.spawned || counted.spawned;
  return { reads: Math.max(saved.reads, counted.reads), spawned, nudged: saved.nudged };
}

/**
 * The delegation gate for this run: the request asked for sub-agents
 * (`RunPolicy.delegation.requested`, set by the adapter from the user's request — the
 * child's own brief for a sub-agent, never its `dispatch.source`), the surface can spawn,
 * and nothing has spawned yet. One rule for every run, parent or child.
 */
export function delegationLeftUndone(ctx: PolicyContext): boolean {
  return ctx.policy.delegation.requested && canSpawnHere(toolNamesOf(ctx)) && !readsWithoutSpawnOf(ctx).spawned;
}

/**
 * The EARLY nudge (PRD 35 E5 / WS8c): once the run has made `readsBeforeNudge` read calls
 * and started no sub-agent it was asked for, the next turn is told to delegate — once per
 * run (the fired flag persists in `RunState.reads`). Null otherwise.
 */
export function delegationNudge(ctx: PolicyContext): string | null {
  const counted = readsWithoutSpawnOf(ctx);
  ctx.state.reads = { ...ctx.state.reads, readsWithoutSpawn: counted };
  const counter = new ReadsWithoutSpawn(counted);
  if (!counter.due(ctx.policy.delegation.readsBeforeNudge) || !delegationLeftUndone(ctx)) return null;
  counter.markNudged();
  ctx.state.reads = { ...ctx.state.reads, readsWithoutSpawn: counter.snapshot() };
  return earlyDelegationNudge(toolNamesOf(ctx), counted.reads);
}

/**
 * The end-of-run backstop: a run about to settle (or ask) without starting the
 * sub-agents it was asked for is re-prompted with the call that clears the block.
 * Null when settling is right.
 */
export function delegationBackstop(ctx: PolicyContext): string | null {
  return delegationLeftUndone(ctx) ? undelegatedRequestNudge(toolNamesOf(ctx)) : null;
}

/**
 * A read result carrying the early nudge, so the model reads "stop reading and delegate"
 * on the very read that reached the threshold (brain-embedded `earlyDelegationAdvisory`).
 */
export function withDelegationAdvisory(result: unknown, nudge: string): unknown {
  return result && typeof result === "object" && !Array.isArray(result)
    ? { ...(result as Record<string, unknown>), advisory: nudge }
    : { output: result, advisory: nudge };
}

/** The subagents hook: the early nudge on a read result, and the end-of-run backstop. */
export const subagentsHook: SubagentsHook = {
  backstop: delegationBackstop,
  nudge(ctx: PolicyContext, call: PolicyToolCall, result: unknown) {
    if (delegationCallKind(call.name) !== "read") return undefined;
    const nudge = delegationNudge(ctx);
    return nudge ? { data: withDelegationAdvisory(result, nudge) } : undefined;
  },
};
