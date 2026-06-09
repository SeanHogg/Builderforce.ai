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
import { CLOUD_ORPHAN_REASON } from './orphanReasons';

/** A self-hosted host run executing longer than this is treated as hung. */
export const RUNNING_DEADLINE_MS = 30 * 60_000; // 30 min
/** A cloud (serverless) run executing longer than this is dead: Cloudflare stops
 *  `waitUntil` work ~30s after the response, so nothing runs past the wall. Kept
 *  in lockstep with RuntimeService.CLOUD_ORPHAN_MS (the read-path ceiling). */
export const CLOUD_RUNNING_DEADLINE_MS = 90_000; // 90s
/** A run never picked up by any agent within this window is treated as dropped. */
export const QUEUED_DEADLINE_MS = 15 * 60_000; // 15 min

export interface ReapResult {
  failedRunning: number;
  failedQueued: number;
}

export async function reapStaleExecutions(env: Env, nowMs = Date.now()): Promise<ReapResult> {
  const sql = neon(env.NEON_DATABASE_URL);
  const runningCutoff = new Date(nowMs - RUNNING_DEADLINE_MS).toISOString();
  const cloudRunningCutoff = new Date(nowMs - CLOUD_RUNNING_DEADLINE_MS).toISOString();
  const queuedCutoff = new Date(nowMs - QUEUED_DEADLINE_MS).toISOString();

  // Hung HOST runs: a real long-lived process that went silent (crash / dropped
  // connection). Cloud runs (agent_host_id IS NULL) are handled below on a much
  // tighter deadline, so scope this to host runs only.
  const running = (await sql`
    UPDATE executions
       SET status = 'failed',
           error_message = 'Execution timed out — the agent did not report completion (host crash or dropped connection).',
           completed_at = now(),
           updated_at = now()
     WHERE status = 'running'
       AND agent_host_id IS NOT NULL
       AND COALESCE(started_at, created_at) < ${runningCutoff}
    RETURNING id, tenant_id, agent_host_id, payload, error_message
  `) as ReapedRow[];

  // Hung CLOUD runs: the serverless background task was stopped at the ~30s wall
  // before writing a terminal status. Fast-fail at 90s (vs 30 min) with the
  // actionable "use a durable runtime" reason — even for runs nobody has viewed
  // (the read-path repair only fires on view).
  const cloudRunning = (await sql`
    UPDATE executions
       SET status = 'failed',
           error_message = ${CLOUD_ORPHAN_REASON},
           completed_at = now(),
           updated_at = now()
     WHERE status = 'running'
       AND agent_host_id IS NULL
       AND COALESCE(updated_at, created_at) < ${cloudRunningCutoff}
    RETURNING id, tenant_id, agent_host_id, payload, error_message
  `) as ReapedRow[];

  // Dropped queue: submitted/pending but no agent ever took it.
  const queued = (await sql`
    UPDATE executions
       SET status = 'failed',
           error_message = 'Execution was never picked up by an agent within the dispatch window.',
           completed_at = now(),
           updated_at = now()
     WHERE status IN ('pending', 'submitted')
       AND created_at < ${queuedCutoff}
    RETURNING id, tenant_id, agent_host_id, payload, error_message
  `) as ReapedRow[];

  // Mirror each reaped failure onto the Observability Logs/Timeline (derived only
  // from tool_audit_events). Without this the run just stops at its last
  // successful tool call and the timeout reason is invisible there — the same gap
  // RuntimeService.reapIfOrphaned / recordRunFailureEvent close on the read path.
  await Promise.all([...running, ...cloudRunning, ...queued].map(async (r) => {
    try {
      await sql`
        INSERT INTO tool_audit_events
          (tenant_id, agent_host_id, cloud_agent_ref, execution_id, session_key, tool_name, category, result, ts)
        VALUES
          (${r.tenant_id}, ${r.agent_host_id}, ${cloudRefFromPayload(r.payload)}, ${r.id},
           ${'exec:' + r.id}, 'run.failed', 'error', ${r.error_message ?? 'Run failed'}, now())
      `;
    } catch {
      /* telemetry is best-effort — never break the reap sweep on it */
    }
  }));

  return { failedRunning: running.length + cloudRunning.length, failedQueued: queued.length };
}

interface ReapedRow {
  id: number;
  tenant_id: number;
  agent_host_id: number | null;
  payload: string | null;
  error_message: string | null;
}

/** Cloud-agent ref pinned in the execution payload, if any (cloud runs have no
 *  cloud_agent_ref column — attribution lives in the payload). */
function cloudRefFromPayload(payload: string | null): string | null {
  if (!payload) return null;
  try {
    const p = JSON.parse(payload) as { cloudAgentRef?: unknown };
    return typeof p.cloudAgentRef === 'string' && p.cloudAgentRef.trim() ? p.cloudAgentRef.trim() : null;
  } catch {
    return null;
  }
}
