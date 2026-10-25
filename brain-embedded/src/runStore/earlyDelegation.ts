/**
 * The EARLY delegation nudge (PRD 35 E5 / WS8c) — the dispatch-time twin of the
 * end-of-run `loop.recover_undelegated_request` gate in `finalAnswerHook.ts`.
 *
 * Every dispatched call is counted by the run's {@link ReadsWithoutSpawn}: a read is a
 * dedupable read tool or a read-only `run_command`; a spawn is `spawn_agent(s)`. When the
 * count reaches the threshold and the run is still leaving the requested delegation
 * undone, the read result the model is about to see carries the nudge as its advisory.
 * Once per run; the end-of-run gate stays as the backstop.
 */

import { ReadsWithoutSpawn, READS_BEFORE_DELEGATION_NUDGE, type DelegationCallKind } from '@builderforce/run-guards';
import { earlyDelegationNudge, isSpawnTool, leftDelegationUndone } from '../delegationRequest';
import { isReadOnlyShellCall } from '../readOnlyShell';
import { nowIso, pushTrace, runTrace } from './runCells';
import type { RunLoopContext } from './runLoopContext';

/** One counter per run — kept beside the run's context so it can never exist twice. */
const counters = new WeakMap<RunLoopContext, ReadsWithoutSpawn>();

function counterOf(run: RunLoopContext): ReadsWithoutSpawn {
  let counter = counters.get(run);
  if (!counter) {
    counter = new ReadsWithoutSpawn();
    counters.set(run, counter);
  }
  return counter;
}

/**
 * THE delegation gate for one run — the early nudge, the prose-end backstop and the
 * `ask_user` redirect all ask it, so a sub-agent is exempt on every path at once.
 */
export function runLeftDelegationUndone(run: RunLoopContext): boolean {
  return leftDelegationUndone({
    toolNames: run.catalogToolNames,
    requestText: run.userRequest,
    events: runTrace(run.c),
    delegatedRun: !!run.req.lineage,
  });
}

/** What this call is to the counter. `isReadTool` is dispatch's own `isDedupableRead`. */
export function delegationCallKind(name: string, args: unknown, isReadTool: boolean): DelegationCallKind {
  if (isSpawnTool(name)) return 'spawn';
  if (isReadTool || isReadOnlyShellCall(name, args)) return 'read';
  return 'other';
}

/**
 * Count the call; return the nudge to attach to its result when it is the read that
 * crosses the threshold in a run that was asked for sub-agents and has spawned none.
 * Null otherwise (and always on a non-read call).
 */
export function earlyDelegationAdvisory(run: RunLoopContext, name: string, args: unknown, isReadTool: boolean, step: number): string | null {
  const counter = counterOf(run);
  const kind = delegationCallKind(name, args, isReadTool);
  const reads = counter.record(kind);
  if (kind !== 'read' || !counter.due(READS_BEFORE_DELEGATION_NUDGE)) return null;
  if (!runLeftDelegationUndone(run)) return null;
  counter.markNudged();
  const nudge = earlyDelegationNudge(run.catalogToolNames, reads);
  pushTrace(run.c, {
    ts: nowIso(),
    category: 'message',
    label: 'loop.nudge_undelegated_request',
    args: { step, tool: name, reads },
    result: `The user asked for sub-agents and the run had made ${reads} reads without starting one — told to delegate on that read result.`,
  });
  return nudge;
}
