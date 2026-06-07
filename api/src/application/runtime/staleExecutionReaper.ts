/**
 * Stale-execution reaper.
 *
 * Executions are driven to a terminal state by the agent that runs them
 * (self-hosted host or the cloud background loop). If that agent's host crashes,
 * its WebSocket drops mid-run, or a queued cloud run is lost, the `executions`
 * row is stranded in `running` / `submitted` / `pending` forever — there was no
 * heartbeat or timeout to fail it. That stuck status pollutes the dashboard, the
 * fleet "active runs" view, and success-rate math.
 *
 * This sweep (run on the frequent scheduled() tick) fails any non-terminal
 * execution that has outlived its deadline:
 *   • `running`              — startedAt older than RUNNING_DEADLINE_MS
 *   • `pending`/`submitted`  — createdAt older than QUEUED_DEADLINE_MS (never
 *                              picked up by any agent)
 *
 * Idempotent and best-effort: it only touches rows past the deadline, so running
 * it every few minutes is safe.
 */

import { neon } from '@neondatabase/serverless';
import type { Env } from '../../env';

/** A run that has been executing longer than this is treated as hung. */
export const RUNNING_DEADLINE_MS = 30 * 60_000; // 30 min
/** A run never picked up by any agent within this window is treated as dropped. */
export const QUEUED_DEADLINE_MS = 15 * 60_000; // 15 min

export interface ReapResult {
  failedRunning: number;
  failedQueued: number;
}

export async function reapStaleExecutions(env: Env, nowMs = Date.now()): Promise<ReapResult> {
  const sql = neon(env.NEON_DATABASE_URL);
  const runningCutoff = new Date(nowMs - RUNNING_DEADLINE_MS).toISOString();
  const queuedCutoff = new Date(nowMs - QUEUED_DEADLINE_MS).toISOString();

  // Hung runs: started but never reported terminal. Prefer started_at; fall back
  // to created_at for rows that reached 'running' without a started_at stamp.
  const running = (await sql`
    UPDATE executions
       SET status = 'failed',
           error_message = 'Execution timed out — the agent did not report completion (host crash or dropped connection).',
           completed_at = now(),
           updated_at = now()
     WHERE status = 'running'
       AND COALESCE(started_at, created_at) < ${runningCutoff}
    RETURNING id
  `) as Array<{ id: number }>;

  // Dropped queue: submitted/pending but no agent ever took it.
  const queued = (await sql`
    UPDATE executions
       SET status = 'failed',
           error_message = 'Execution was never picked up by an agent within the dispatch window.',
           completed_at = now(),
           updated_at = now()
     WHERE status IN ('pending', 'submitted')
       AND created_at < ${queuedCutoff}
    RETURNING id
  `) as Array<{ id: number }>;

  return { failedRunning: running.length, failedQueued: queued.length };
}
