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
 * ticket back in the lane it came from, and wakes it: every cloud run is driven by its
 * durable runner (CloudRunnerDO), whose cursor still holds the loop, so the wake is
 * that runner's `/resume` — which also queues a fresh GitHub Actions runner when one
 * was the run's sandbox (the previous one was released while the question waited).
 *
 * Best-effort and idempotent-ish: enqueuing the answer is the durable part. A wake
 * that cannot be delivered leaves the row `paused` with the answer queued, so the
 * chip's resume affordance (or the next run) still picks it up.
 */
import { enqueueExecutionMessage } from './executionSteering';
import { notifyExecutionSubscribers } from './executionEvents';
import { clearPauseState, loadPauseState, restoreTicketLane, type PausedRunState } from './executionPause';
import { recordCloudToolEvent } from './cloudToolEvents';
import { cloudRunnerStub } from './cloudRunnerStub';
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

  // 4. Wake the run. Every cloud run is driven by its durable runner (CloudRunnerDO),
  //    which kept the paused conversation in its cursor; `/resume` continues it — and
  //    queues a fresh GitHub Actions runner when that was the run's sandbox.
  await resumeDurableRun(env, db, args, state);

  // 5. The record has served its purpose. Dropping it also re-arms the pause path:
  //    a second `ask_human` on the resumed run writes a fresh record rather than
  //    inheriting a stale conversation.
  if (state) await clearPauseState(db, { tenantId: args.tenantId, executionId: args.executionId });
}

/**
 * Its `/resume` flips the row back to running AND re-arms the alarm so the loop ticks
 * and drains the answer. We deliberately do NOT flip the status here — a wake with no
 * persisted cursor 409s, and flipping to `running` with nothing to run it would just get
 * the row reaped. The queued answer then stays pending, the row stays `paused`, and the
 * timeline says why: a pause left by the retired container loop has no runner cursor.
 */
async function resumeDurableRun(
  env: Env,
  db: Db,
  args: { executionId: number; tenantId: number; approvalId?: string },
  state: PausedRunState | null,
): Promise<void> {
  if (!env.CLOUD_RUNNER) return;
  const stub = cloudRunnerStub(env.CLOUD_RUNNER, args.executionId);
  const res = await stub.fetch('https://cloud-runner/resume', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ approvalId: args.approvalId ?? null }),
  }).catch((error) => {
    reportCaughtError(error, { source: "application/runtime/executionResume.ts", operation: "resumeDurableRun", context: { logMessage: '[execution-resume] durable runner wake-up failed', details: {
      executionId: args.executionId,
      tenantId: args.tenantId,
      approvalId: args.approvalId ?? null,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    } } });
    return null;
  });
  if (res?.status === 409 && state) {
    await recordResumeFailure(db, args, state, 'this run was paused before cloud runs moved onto one runtime, so there is no runner state to continue from — start a follow-up run (the ticket branch already holds its committed work)');
  }
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
