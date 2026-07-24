/**
 * Resume a paused cloud run with a human's answer.
 *
 * A cloud agent that calls `ask_human` records a `question` approval scoped to its
 * execution and parks the run in `paused` ([cloudAgentEngine.ts] / [CloudRunnerDO]).
 * When a human answers (via the approvals queue), this delivers the answer back to
 * that exact run: the answer is enqueued as a pending user turn — the SAME channel
 * mid-run steering uses, so the loop drains it on its next tick — the row flips
 * back to `running`, and the durable runner is woken via its `/resume` endpoint.
 *
 * Best-effort and idempotent-ish: enqueuing the answer is the durable part; the
 * DO wake is a no-op if the run was on the interim Worker surface (no persisted
 * cursor) — there the queued answer is picked up by the next run instead.
 */
import { enqueueExecutionMessage } from './executionSteering';
import { notifyExecutionSubscribers } from './executionEvents';
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

  // 3. Wake the durable runner: its /resume flips the row back to running AND
  //    re-arms the alarm so the loop ticks and drains the answer. We deliberately
  //    do NOT flip the status here — on the interim Worker surface there is no
  //    persisted cursor (/resume → 409), and flipping to `running` with nothing to
  //    run it would just get the row reaped. There the queued answer stays pending
  //    and is consumed by the next run (chip re-run / follow-up), with the row
  //    correctly still showing `paused` until then.
  if (env.CLOUD_RUNNER) {
    const stub = env.CLOUD_RUNNER.get(env.CLOUD_RUNNER.idFromName(`exec:${args.executionId}`));
    await stub.fetch('https://cloud-runner/resume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approvalId: args.approvalId ?? null }),
    }).catch(() => { /* best-effort */ });
  }
}
