/**
 * cloudRunTail — what the cloud does AFTER the one agent returns (PRD 35 WS3): map the agent's
 * outcome onto the result every cloud surface already settles, and, when the run is truly over,
 * hand its leases back, verify and remember what it learned, and land the pull request.
 *
 * This is HOST work above the agent (the board and governance layer, §6.9): the agent decides
 * whether a run finished; the cloud decides what finishing a ticket MEANS (the PR, the merge,
 * the summary comment). Nothing here judges the run's work.
 *
 * The mapping keeps the old engine's paths exactly:
 *   • finished, cancelled, a stall that gave up and a tripped breaker all LAND the run (leases,
 *     verify note, memory, `finalizeCloudRun` — teardown, verdict, summary, principal revoke);
 *   • containment and a gateway failure the model policy did not route around are hard stops
 *     with no finalize and no lease release, as before;
 *   • an exception that is not a model-transport failure is RE-THROWN, so the Durable Object's
 *     eviction handling re-arms the run instead of failing it.
 */
import {
  ModelTransportError, RUN_CANCELLED_REASON, buildOutcomeRow, describeVerifyOutcome, runSandboxVerify, runVerifyPhase,
  type RunOutcome, type RunOutcomeRow, type RunState, type VerifySandbox,
} from '@builderforce/agent-run';
import type { RunSandbox } from './sandbox/runSandbox';
import { handOffOutcomeCounts } from './cloudOutcomeRow';
import { cloudRunId } from '../../domain/execution/cloudRunId';
import { buildRuntimeService } from '../../buildRuntimeService';
import { releaseAllForExecution } from '../coordination/leaseService';
import { coordinationScopeKey } from '../../domain/coordination/resourceKey';
import { reportCaughtError, reportedFallback } from '../observability/caughtErrorReporter';
import { missingReviewVerdictMessage } from './cloudAgent/finishGates';
import { commitRunMemory, recordRunVerifyEvents } from './cloudAgent/runEndMemory';
import { snapshotWrittenHashes } from './cloudAgent/writtenFileHashes';
import { lastPersonSteerSender } from './executionSteering';
import { finalizeCloudRun } from './cloudFinalize';
import type { CloudModelPort } from './cloudAdapterModel';
import type { CloudRunHost } from './cloudRunHost';
import type { CloudLoopResult } from './cloudRunOpts';
import type { CloudLoopState } from './cloudRunState';

/** What the run stashed through its ports for the tail. */
export interface RunStash {
  /** The memory the agent consolidated at run end (`store.commitMemory`). */
  consolidated?: unknown;
  /** The outcome row the agent built when it settled; the tail writes it once the run has LANDED (see `cloudOutcomeRow`). */
  row?: RunOutcomeRow;
}

/** Hand every path this run held back to its peers immediately rather than making them wait out the lease TTL. */
export function releaseLeases(host: CloudRunHost): Promise<void> {
  const { env, db, refs, taskRow } = host;
  return releaseAllForExecution(env, db, refs.tenantId, refs.executionId, coordinationScopeKey(taskRow.id))
    .then(() => undefined)
    .catch((error) => reportCaughtError(error, {
      source: 'application/runtime/cloudRunTail.ts', operation: 'releaseLeases',
      context: { tenantId: refs.tenantId, executionId: refs.executionId, taskId: taskRow.id, error },
    }));
}

/** The state the next durable tick resumes from: the agent's own, plus the host facts it must reuse. */
function resumeStateOf(host: CloudRunHost, run: RunState): CloudLoopState {
  const { spentMillicents, tokensUsed, tokenCap } = host.cost.snapshot();
  return {
    run,
    repoCtx: host.repoCtx,
    repoMiss: host.repoMiss,
    routing: host.routing,
    writtenHashes: snapshotWrittenHashes(host.writtenHashes),
    ...(spentMillicents !== undefined ? { spentMillicents } : {}),
    ...(tokensUsed !== undefined ? { tokensUsed } : {}),
    ...(tokenCap !== undefined ? { tokenCap } : {}),
  };
}

/** The last thing the assistant said — what a run that yielded without finishing hands back. */
function lastSaid(state: RunState): string {
  for (let i = state.messages.length - 1; i >= 0; i -= 1) {
    const row = state.messages[i] as { role?: string; content?: unknown };
    if (row.role === 'assistant' && typeof row.content === 'string' && row.content.trim()) return row.content;
  }
  return '';
}

/**
 * The VERIFY, then REMEMBER tail. With a sandbox the project's own declared checks run over the clone (honest exit
 * codes) as a best-effort note; without one the verification is the branch CI the finish gates already polled — a
 * green CI is verified, never a local typecheck that did not happen. Then what the run learned is committed.
 * Neither step may delay or undo the finalize, which IS this run's result.
 */
/** The run's sandbox as the agent's verify executor reads it: `package.json` for the declared scripts, and a basename listing for the lockfile probe. */
export function verifySandboxOf(sandbox: RunSandbox): VerifySandbox {
  return {
    read: async (path) => {
      const r = await sandbox.fs({ op: 'read', path });
      return r.ok && typeof r.content === 'string' ? r.content : null;
    },
    list: async (glob) => (await sandbox.fs({ op: 'list', glob })).paths ?? [],
    onError: (operation, error) => reportCaughtError(error, { source: 'application/runtime/cloudRunTail.ts', operation: `verifySandbox.${operation}`, level: 'warning' }),
  };
}

async function verifyThenRemember(host: CloudRunHost, state: RunState, output: string, stash: RunStash): Promise<void> {
  const { env, db, refs, taskRow } = host;
  const where = { source: 'application/runtime/cloudRunTail.ts', context: { tenantId: refs.tenantId, executionId: refs.executionId } };
  // Only the I/O is best-effort (a sandbox that cannot run, a memory write that fails). The bookkeeping around it is not: a
  // programming error here (an unseeded host, a bad shape) must surface rather than silently skip the memory write.
  const sandboxed = host.verify && host.writtenPaths.size > 0
    ? await runSandboxVerify(verifySandboxOf(host.verify.sandbox), host.verify.shell).catch(reportedFallback(null, { ...where, operation: 'sandboxVerify' }))
    : null;
  const outcome = sandboxed
    ? runVerifyPhase({ surface: 'sandbox', writtenPaths: host.writtenPaths, packageScripts: sandboxed.packageScripts, runner: sandboxed.runner, results: sandboxed.results })
    : runVerifyPhase({ surface: 'durable', writtenPaths: host.writtenPaths, results: state.finish.ciVerified ? [{ command: 'branch-ci', exitCode: 0 }] : null });
  recordRunVerifyEvents({ db, tenantId: refs.tenantId, executionId: refs.executionId, ...(refs.cloudAgentRef ? { cloudAgentRef: refs.cloudAgentRef } : {}) }, outcome);
  const consolidated = stash.consolidated as { key?: unknown; content?: unknown } | undefined;
  const codeMap = typeof consolidated?.key === 'string' && typeof consolidated.content === 'string'
    ? { key: consolidated.key, content: consolidated.content }
    : undefined;
  await commitRunMemory({
    db, env, tenantId: refs.tenantId, projectId: refs.projectId, ticketId: taskRow.id, executionId: refs.executionId,
    ...(refs.cloudAgentRef ? { cloudAgentRef: refs.cloudAgentRef } : {}),
    summary: output.trim() || `${refs.agentLabel} finished ${taskRow.title}`,
    verifyNote: describeVerifyOutcome(outcome),
    writtenPaths: [...host.writtenPaths],
    // Anchors the run's facts to what it wrote: recall can tell a fact has gone stale once the file changes.
    ...(host.writtenHashes.size ? { writtenFileHashes: snapshotWrittenHashes(host.writtenHashes) } : {}),
    ...(codeMap ? { codeMap } : {}),
  }).catch(reportedFallback(undefined, { ...where, operation: 'commitRunMemory' }));
}

/** The code map alone, with a short note of why the run stopped — for the hard stops that do not finalize. Best-effort. */
async function commitCodeMap(host: CloudRunHost, state: RunState, why: string, stash: RunStash): Promise<void> {
  const consolidated = stash.consolidated as { key?: unknown; content?: unknown } | undefined;
  if (typeof consolidated?.key !== 'string' || typeof consolidated.content !== 'string') return;
  const { env, db, refs, taskRow } = host;
  await commitRunMemory({
    db, env, tenantId: refs.tenantId, projectId: refs.projectId, ticketId: taskRow.id, executionId: refs.executionId,
    ...(refs.cloudAgentRef ? { cloudAgentRef: refs.cloudAgentRef } : {}),
    summary: `${refs.agentLabel} stopped before finishing ${taskRow.title}: ${why}`,
    writtenPaths: [...state.writtenPaths],
    codeMap: { key: consolidated.key, content: consolidated.content },
  }).catch((error) => reportCaughtError(error, { source: 'application/runtime/cloudRunTail.ts', operation: 'commitCodeMap', context: { executionId: refs.executionId, error } }));
}

/** A steered stop is a cancel: the execution transitions to CANCELLED (so nothing restarts it) and the run lands as cancelled. */
async function cancelOnSteeredStop(host: CloudRunHost): Promise<void> {
  if (host.cancel.cancelled()) return; // the row was already cancelled elsewhere — that is what stopped the run
  // The same application use case the cancel API runs (`RuntimeService.cancel`): the row flips to CANCELLED, the runner is told,
  // the audit and the lifecycle narration are written. A Worker surface has no delegation runtime, so it builds the canonical one.
  const runtime = host.opts.delegation?.runtime ?? buildRuntimeService(host.env, host.db);
  const { tenantId, executionId } = host.refs;
  const where = { source: 'application/runtime/cloudRunTail.ts', operation: 'cancelOnSteeredStop', context: { executionId } };
  // The audit row names the PERSON whose steer stopped the run; with none on record the execution itself is the actor.
  const sender = await lastPersonSteerSender(host.db, tenantId, executionId).catch(reportedFallback<string | null>(null, { ...where, operation: 'stopSenderLookup' }));
  await runtime.cancel(executionId, sender ?? `execution:${executionId}`).catch(reportedFallback(undefined, where));
}

/** Land a run that is over: leases, the sign-off check, verify + memory, then the pull request / teardown. */
async function land(host: CloudRunHost, state: RunState, output: string, cancelled: boolean, stash: RunStash): Promise<CloudLoopResult> {
  const { env, db, refs, opts, taskRow } = host;
  for (const path of state.writtenPaths) host.writtenPaths.add(path);
  // Terminal: the leases go back now. Released here (not on a deferred tick) because a multi-tick
  // read→edit→write sequence is only safe while the agent keeps its leases across ticks.
  await releaseLeases(host);

  // The step cap is a safety limit, never an evidence bypass: without the required reviewer verdict the run
  // fails and leaves the slot open for retry/escalation; it must not finalize as successful acceptance.
  if (opts.requiredSignoff && !state.finish.reviewVerdictRecorded) {
    return { ok: false, output: missingReviewVerdictMessage(opts.requiredSignoff), cancelled, finished: true };
  }
  // Rehearsal / a sub-agent: nothing may be shipped, closed or summarised onto the real ticket.
  if (opts.suppressFinalize) return { ok: true, output, cancelled, finished: true };

  await verifyThenRemember(host, state, output, stash);
  const fin = await finalizeCloudRun(env, db, {
    tenantId: refs.tenantId, cloudAgentRef: refs.cloudAgentRef, executionId: refs.executionId, taskRow, agentLabel: refs.agentLabel,
    repoCtx: host.repoCtx, repoMiss: host.repoMiss, writtenPaths: host.writtenPaths, finalOutput: output, cancelled, ciVerified: state.finish.ciVerified,
  });
  return { ok: fin.ok, output: fin.output, cancelled, finished: true };
}

/**
 * Map the agent's outcome to the cloud's result and, on a terminal one, land the run. The run's counts (its `RunState.telemetry`,
 * as the outcome row) are handed to the ONE outcome-row writer (`cloudOutcomeRow`), which records the row at the terminal
 * transition with the status the execution LANDED with — a missing sign-off, a breaker that lands COMPLETED, a steered stop and a
 * rehearsal that spent its step budget all differ from what the agent settled on. A run that goes on (paused, a durable tick that
 * yielded) hands over nothing; an exception the Durable Object re-arms throws before it gets here.
 */
export async function settleCloudRun(host: CloudRunHost, outcome: RunOutcome, stash: RunStash, model: CloudModelPort): Promise<CloudLoopResult> {
  const result = await mapOutcome(host, outcome, stash, model);
  if (!result.finished) return result;
  handOffOutcomeCounts(host.refs.executionId, stash.row ?? buildOutcomeRow({ entryPoint: 'cloud', runId: cloudRunId(host.refs.executionId), kind: result.ok ? 'finished' : 'failed', state: outcome.state }));
  return result;
}

async function mapOutcome(host: CloudRunHost, outcome: RunOutcome, stash: RunStash, model: CloudModelPort): Promise<CloudLoopResult> {
  switch (outcome.kind) {
    case 'failed': {
      // Not a model-transport failure: a platform eviction (or any thrown port) is not the run's failure. Re-thrown so
      // the Durable Object re-arms an eviction exactly as before; the adapter hands the leases back first.
      if (outcome.cause !== undefined && !(outcome.cause instanceof ModelTransportError)) throw outcome.cause;
      if (outcome.reason === RUN_CANCELLED_REASON) {
        await cancelOnSteeredStop(host);
        return land(host, outcome.state, '', true, stash);
      }
      // The failure breaker or the step budget ended the run, or the stall policy gave up: it lands with its notice.
      // The notice is the run's output, as the old engine's `loop.output` was: the finalize reports it alongside what was committed.
      if (outcome.exhausted) return land(host, outcome.state, outcome.reason, false, stash);
      // Containment and a gateway failure the policy did not route around: terminal WITHOUT finalize or lease release —
      // but what the run read is still worth mapping for the next run on that area.
      const gateway = await model.flushFailure();
      await commitCodeMap(host, outcome.state, gateway ?? outcome.reason, stash);
      return { ok: false, output: gateway ?? outcome.reason, cancelled: false, finished: true };
    }
    case 'paused':
      // Paused on a human question — not finalized (no PR, not terminal): the surface parks the run until it is answered.
      return {
        ok: true, output: '', cancelled: false, finished: false,
        awaitingInput: { approvalId: outcome.approvalId, question: outcome.question },
        state: resumeStateOf(host, outcome.state),
      };
    case 'yielded':
      // The per-tick budget is spent but the run isn't done: hand back the resume state WITHOUT shipping.
      if (host.opts.deferFinalize) return { ok: true, output: '', cancelled: false, finished: false, state: resumeStateOf(host, outcome.state) };
      // A bounded invocation that is not durable (a rehearsal) ends here with what the run said last.
      return land(host, outcome.state, lastSaid(outcome.state), false, stash);
    case 'finished':
      return land(host, outcome.state, outcome.output, false, stash);
  }
}
