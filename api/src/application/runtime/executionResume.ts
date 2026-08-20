import { reportCaughtError } from '../observability/caughtErrorReporter';
/**
 * Resume a paused cloud run with a human's answer.
 *
 * A cloud agent that calls `ask_human` parks its run through
 * {@link pauseExecutionForQuestion} ([executionPause.ts]): a `question` approval is
 * opened, the ticket is routed to the board's needs-attention lane, and a resume
 * record is written that says WHICH surface parked the run and — for the surfaces
 * that cannot outlive their own process — the conversation to restart from.
 *
 * This is the mirror image. It delivers the answer to that exact run, puts the
 * ticket back in the lane it came from, and wakes the run on the ONE surface it
 * actually ran on:
 *
 *   • `durable`        — POST the DO's `/resume`; its cursor still holds the loop.
 *   • `container`      — relaunch the container image seeded with the paused
 *                        conversation (exit-and-redispatch; the previous process
 *                        exited without a terminal op, so the row is still live).
 *   • `github_actions` — re-dispatch the workflow; the runner asks for its `spec`,
 *                        which serves the same paused conversation back.
 *
 * Waking off the RECORD rather than off a guess matters: firing every surface would
 * start a second, concurrent run of the same execution on the two redispatch
 * surfaces. A run with no resume record (paused before this shipped) falls back to
 * the durable wake, which is a no-op on any other surface.
 *
 * Best-effort and idempotent-ish: enqueuing the answer is the durable part. A wake
 * that cannot be delivered leaves the row `paused` with the answer queued, so the
 * chip's resume affordance (or the next run) still picks it up.
 */
import { enqueueExecutionMessage } from './executionSteering';
import { notifyExecutionSubscribers } from './executionEvents';
import { clearPauseState, loadPauseState, restoreTicketLane, type PausedRunState } from './executionPause';
import { launchContainerRun } from './containerRunLauncher';
import { loadContainerRunContext } from './cloudAgentEngine';
import { dispatchGithubActionsRun } from './githubActionsDispatch';
import { probeContainerHealth } from './cloudDispatch';
import { recordCloudToolEvent } from './cloudToolEvents';
import { markCloudExecutionRunning } from './cloudAgentEngine';
import { resolveArtifacts } from '../artifact/resolveArtifacts';
import { executions } from '../../infrastructure/database/schema';
import { and, eq } from 'drizzle-orm';
import type { RuntimeService } from './RuntimeService';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

export async function resumePausedExecution(
  env: Env,
  db: Db,
  args: {
    executionId: number; tenantId: number; answer: string;
    /** The answered `question` approval's id — forwarded to the durable runner so its
     *  resumed chat-milestone is keyed per Q&A cycle (see CloudRunnerDO `/resume`). */
    approvalId?: string;
    /** Reuse the caller's RuntimeService for the redispatch surfaces' running
     *  transition + resumed milestone, instead of building a second one. */
    runtimeService?: RuntimeService;
  },
): Promise<void> {
  // 1. Queue the answer as a user turn for the loop to ingest (mid-run steer channel).
  await enqueueExecutionMessage(db, {
    executionId: args.executionId,
    tenantId: args.tenantId,
    role: 'user',
    text: args.answer,
    pending: true,
  });

  // 2. Echo the answer onto the live execution stream so an open panel shows it.
  notifyExecutionSubscribers(args.executionId, {
    type: 'message', executionId: args.executionId, role: 'user',
    text: args.answer, ts: new Date().toISOString(),
  });

  const state = await loadPauseState(db, { tenantId: args.tenantId, executionId: args.executionId });

  // 3. Put the ticket back in the lane the pause moved it out of. Done BEFORE the
  //    wake so the board never shows a running ticket sitting in needs-attention.
  if (state) await restoreTicketLane(env, db, state);

  // 4. Wake the surface that actually ran it.
  const surface = state?.surface ?? 'durable';
  if (surface === 'container') {
    await resumeContainerRun(env, db, args, state!);
  } else if (surface === 'github_actions') {
    await resumeGithubActionsRun(env, db, args, state!);
  } else {
    await resumeDurableRun(env, args);
  }

  // 5. The record has served its purpose. Dropping it also re-arms the pause path:
  //    a second `ask_human` on the resumed run writes a fresh record rather than
  //    inheriting a stale conversation.
  //
  //    EXCEPT on GitHub Actions, where the record is the delivery mechanism: the
  //    re-dispatched runner does not exist yet, and reads the paused conversation
  //    from its `spec` call minutes later. That op consumes and clears it.
  if (state && surface !== 'github_actions') {
    await clearPauseState(db, { tenantId: args.tenantId, executionId: args.executionId });
  }
}

/**
 * Durable surface: its `/resume` flips the row back to running AND re-arms the
 * alarm so the loop ticks and drains the answer. We deliberately do NOT flip the
 * status here — a wake with no persisted cursor 409s, and flipping to `running`
 * with nothing to run it would just get the row reaped. There the queued answer
 * stays pending and is consumed by the next run, with the row correctly still
 * showing `paused` until then.
 */
async function resumeDurableRun(
  env: Env,
  args: { executionId: number; tenantId: number; approvalId?: string },
): Promise<void> {
  if (!env.CLOUD_RUNNER) return;
  const stub = env.CLOUD_RUNNER.get(env.CLOUD_RUNNER.idFromName(`exec:${args.executionId}`));
  await stub.fetch('https://cloud-runner/resume', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ approvalId: args.approvalId ?? null }),
  }).catch((error) => reportCaughtError(error, { source: "application/runtime/executionResume.ts", operation: "resumeDurableRun", context: { logMessage: '[execution-resume] durable runner wake-up failed', details: {
    executionId: args.executionId,
    tenantId: args.tenantId,
    approvalId: args.approvalId ?? null,
    error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  } } }));
}

/**
 * Container surface: exit-and-redispatch. The image that asked the question exited
 * WITHOUT posting a terminal op, so the execution row is still live — a fresh
 * container process seeded with the paused conversation simply continues it.
 */
async function resumeContainerRun(
  env: Env,
  db: Db,
  args: { executionId: number; tenantId: number; approvalId?: string; runtimeService?: RuntimeService },
  state: PausedRunState,
): Promise<void> {
  if (!env.AGENT_CONTAINER) {
    await recordResumeFailure(db, args, state, 'no AGENT_CONTAINER binding is configured');
    return;
  }
  const ctx = await loadContainerRunContext(env, db, args.executionId);
  if (!ctx) {
    await recordResumeFailure(db, args, state, 'the run context could no longer be resolved');
    return;
  }
  const [execRow] = await db
    .select({ payload: executions.payload })
    .from(executions)
    .where(and(eq(executions.id, args.executionId), eq(executions.tenantId, args.tenantId)))
    .limit(1);
  const artifacts = await resolveArtifacts(db, {
    tenantId: ctx.tenantId, taskId: ctx.taskId, projectId: ctx.projectId, cloudAgentRef: ctx.cloudAgentRef,
  }).catch(() => undefined);

  const stub = env.AGENT_CONTAINER.get(env.AGENT_CONTAINER.idFromName(`exec:${args.executionId}`));
  // Probe FIRST, for the same reason dispatch does: the DO's `/run` acks 202 even
  // when the image cannot boot, so a 202 is not evidence anything started. Without
  // this, a dead container would swallow the resume, the row would be flipped to
  // `running`, and the run would be orphan-reaped minutes later as a failure —
  // destroying an answered question that is still perfectly resumable.
  if (!(await probeContainerHealth(stub))) {
    await recordResumeFailure(db, args, state, 'the Cloudflare Container is not live (health probe failed)');
    return;
  }
  const launched = await launchContainerRun(env, db, stub, {
    tenantId: ctx.tenantId,
    executionId: args.executionId,
    taskRow: { id: ctx.taskId, title: ctx.taskTitle, description: ctx.taskDescription, projectId: ctx.projectId },
    agentLabel: ctx.agentLabel,
    model: ctx.model,
    cloudAgentRef: ctx.cloudAgentRef,
    artifacts,
    payload: execRow?.payload ?? undefined,
    resume: state.loopState,
  });
  if (!launched.ok) {
    await recordResumeFailure(db, args, state, launched.reason);
    return;
  }
  await markRunningAndNarrate(env, db, args, state);
}

/**
 * GitHub Actions surface: same exit-and-redispatch shape, different transport. The
 * workflow is queued again and the fresh runner's very first call — `spec` — hands
 * it the paused conversation back (see githubActionsRoutes).
 */
async function resumeGithubActionsRun(
  env: Env,
  db: Db,
  args: { executionId: number; tenantId: number; approvalId?: string; runtimeService?: RuntimeService },
  state: PausedRunState,
): Promise<void> {
  const res = await dispatchGithubActionsRun(env, db, {
    tenantId: state.tenantId, taskId: state.taskId, executionId: args.executionId,
  }).catch((e) => ({ ok: false as const, code: 'threw', reason: e instanceof Error ? e.message : String(e) }));
  if (!res.ok) {
    await recordResumeFailure(db, args, state, `GitHub Actions re-dispatch failed: ${res.reason}`);
    return;
  }
  // Unlike the container there is no "it started" signal here: the runner marks the
  // run RUNNING itself when it asks for its spec. Narrate the resume only.
  await narrateResumed(env, db, args);
}

/** Flip the redispatched run back to `running` and narrate the resume into the
 *  ticket's linked Brain chats — the container's equivalent of what
 *  CloudRunnerDO `/resume` does for the durable surface. */
async function markRunningAndNarrate(
  env: Env,
  db: Db,
  args: { executionId: number; tenantId: number; approvalId?: string; runtimeService?: RuntimeService },
  _state: PausedRunState,
): Promise<void> {
  const runtimeService = args.runtimeService ?? (await buildService(env, db));
  await markCloudExecutionRunning(runtimeService, args.executionId).catch((error) => reportCaughtError(error, { source: "application/runtime/executionResume.ts", operation: "markRunningAndNarrate", level: 'warning', context: { logMessage: '[execution-resume] running transition rejected on redispatch', details: {
    tenantId: args.tenantId, executionId: args.executionId, error,
  } } }));
  await runtimeService.postLifecycleMilestoneById(args.executionId, 'resumed', {
    eventNonce: args.approvalId ?? null,
  });
}

async function narrateResumed(
  env: Env,
  db: Db,
  args: { executionId: number; approvalId?: string; runtimeService?: RuntimeService },
): Promise<void> {
  const runtimeService = args.runtimeService ?? (await buildService(env, db));
  await runtimeService.postLifecycleMilestoneById(args.executionId, 'resumed', {
    eventNonce: args.approvalId ?? null,
  });
}

/** Lazily built so the common (durable) path never pays for a RuntimeService, and
 *  so this module does not import the composition root at load time. */
async function buildService(env: Env, db: Db): Promise<RuntimeService> {
  const { buildRuntimeService } = await import('../../buildRuntimeService');
  return buildRuntimeService(env, db);
}

/**
 * A wake we could not deliver. The run STAYS paused with the answer queued (so it
 * is still resumable — from the chip, or by the next redispatch), and the timeline
 * says exactly why nothing woke up instead of leaving a silently dead question.
 */
async function recordResumeFailure(
  db: Db,
  args: { executionId: number; tenantId: number },
  state: PausedRunState,
  reason: string,
): Promise<void> {
  await recordCloudToolEvent(db, {
    tenantId: args.tenantId,
    executionId: args.executionId,
    toolName: 'run.resume_failed', category: 'error',
    detail: { surface: state.surface, reason },
    result: `Could not resume this run on the ${state.surface} surface: ${reason}. The answer is queued — retry the resume, or start a follow-up run.`,
  }).catch((error) => reportCaughtError(error, { source: "application/runtime/executionResume.ts", operation: "recordResumeFailure", context: { logMessage: '[execution-resume] resume-failure telemetry failed', details: {
    tenantId: args.tenantId, executionId: args.executionId, reason, error,
  } } }));
}
