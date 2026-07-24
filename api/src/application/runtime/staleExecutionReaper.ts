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
 *   • `paused`               — idle (updatedAt) older than PAUSED_DEADLINE_MS: a run
 *                              parked on an `ask_human` question nobody answered.
 *                              Nothing used to reap these, yet auto-run counts a
 *                              paused run as LIVE — so one unanswered question
 *                              blocked the ticket's autonomy forever.
 *
 * Idempotent and best-effort: it only touches rows past the deadline, so running
 * it every few minutes is safe.
 */

import { neon } from '@neondatabase/serverless';
import type { Env } from '../../env';
import { buildDatabase } from '../../infrastructure/database/connection';
import { ChatTicketService, ticketKindForTaskType } from '../brain/ChatTicketService';
import { cloudOrphanReason, cloudSilenceCeilingMs, PAUSED_DEADLINE_MS, PAUSED_ORPHAN_REASON } from './orphanReasons';
import { markReaperRequeued, parseExecutor } from './cloudDispatch';
import { isSelfHealEligible, buildDurableStartBody, dispatchDurableStart } from './cloudSelfHeal';
import { runParkAgeTimeoutSweep, type ParkAgeTimeoutResult } from '../maintenance/parkAgeTimeout';

/** A self-hosted host run executing longer than this is treated as hung. */
export const RUNNING_DEADLINE_MS = 30 * 60_000; // 30 min
/** Candidate-pull floor for stale CLOUD runs: a cheap SQL prefilter that surfaces every
 *  cloud run silent for more than 90s. It is deliberately SMALLER than any real ceiling
 *  — each candidate is then held against {@link cloudSilenceCeilingMs} in the loop
 *  below, so a live durable/container tick mid-LLM-step is pulled here but spared
 *  there. Only the true ceiling decides a run's fate; this value just bounds the scan. */
export const CLOUD_RUNNING_DEADLINE_MS = 90_000; // 90s
/** A run never picked up by any agent within this window is treated as dropped. */
export const QUEUED_DEADLINE_MS = 15 * 60_000; // 15 min
/** A run PAUSED on an `ask_human` question whose answer never came. Deliberately
 *  generous (72h — a question raised on Friday is still answerable Monday); the
 *  policy + message live with the other orphan reasons so the read-path repair
 *  ({@link ../runtime/RuntimeService}) applies the identical deadline. Re-exported
 *  here so all four reaper deadlines read together. */
export { PAUSED_DEADLINE_MS } from './orphanReasons';

export interface ReapResult {
  failedRunning: number;
  failedQueued: number;
  /** Runs parked on an unanswered `ask_human` question past PAUSED_DEADLINE_MS,
   *  failed so the ticket they were blocking can auto-run again. */
  failedPaused: number;
  /** Orphaned cloud runs re-queued ONCE on the durable executor (CloudRunnerDO)
   *  instead of being failed — self-healing for a run that died before completing. */
  requeuedCloud: number;
  /** Tickets parked on a never-settling run_workflow that were surfaced to
   *  needs_attention by the park-age timeout (best-effort sibling sweep). */
  parkAge: ParkAgeTimeoutResult;
}

export async function reapStaleExecutions(env: Env, nowMs = Date.now()): Promise<ReapResult> {
  const sql = neon(env.NEON_DATABASE_URL);
  const runningCutoff = new Date(nowMs - RUNNING_DEADLINE_MS).toISOString();
  const cloudRunningCutoff = new Date(nowMs - CLOUD_RUNNING_DEADLINE_MS).toISOString();
  const queuedCutoff = new Date(nowMs - QUEUED_DEADLINE_MS).toISOString();
  const pausedCutoff = new Date(nowMs - PAUSED_DEADLINE_MS).toISOString();

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
    RETURNING id, tenant_id, agent_host_id, payload, error_message, task_id
  `) as ReapedRow[];

  // Hung CLOUD runs: the serverless background task was stopped at the ~30s wall
  // (or a container that booted then died) before writing a terminal status.
  // Before failing one at the 90s deadline, try to SELF-HEAL it: re-queue it ONCE
  // on the durable executor (CloudRunnerDO), which survives long multi-step runs.
  // Pull the candidates first (with task context the DO `/start` needs) so we can
  // decide per-row whether to re-dispatch or fail — see requeueCloudRun.
  const cloudCandidates = (await sql`
    SELECT e.id, e.tenant_id, e.agent_host_id, e.payload, e.error_message,
           e.started_at AS started_at, e.created_at AS created_at, e.updated_at AS updated_at,
           t.id AS task_id, t.title AS task_title, t.description AS task_description,
           t.project_id AS project_id, e.cloud_agent_ref AS cloud_agent_ref,
           (SELECT count(*) FROM pull_requests pr
              WHERE pr.task_id = t.id AND pr.status <> 'merged' AND pr.status <> 'closed') AS open_pr_count
      FROM executions e
      JOIN tasks t ON t.id = e.task_id
     WHERE e.status = 'running'
       AND e.agent_host_id IS NULL
       AND COALESCE(e.updated_at, e.created_at) < ${cloudRunningCutoff}
  `) as CloudCandidateRow[];

  const cloudRunning: ReapedRow[] = [];
  let requeuedCloud = 0;
  for (const row of cloudCandidates) {
    // Per-surface silence ceiling: the SQL above pulls every cloud run stale past the
    // serverless 90s wall, but a long-lived executor (durable DO / container) heartbeats
    // only once per alarm tick and a tick legitimately spans one slow LLM step. Spare a
    // durable/container run still inside its (larger) ceiling — it is mid-completion,
    // NOT silent — so we don't reap a live tick (execution #136: a 93s LLM call reaped at
    // 90s, 2s before it returned). Only a genuinely stalled run (past 5 min) falls
    // through to self-heal/fail below.
    const lastActivityMs = tsToMs(row.updated_at ?? row.created_at);
    if (lastActivityMs != null && nowMs - lastActivityMs <= cloudSilenceCeilingMs(parseExecutor(row.payload))) {
      continue;
    }

    // Re-dispatch ONCE, idempotently. Skip (and fail) a run that has already been
    // re-queued by a prior sweep, has an open PR a re-run could double, or when no
    // durable runner is bound to retry on. The eligibility RULE is shared with the
    // read-path + container-crash self-heal so all detectors agree (cloudSelfHeal).
    const eligible = isSelfHealEligible({
      payload: row.payload,
      openPrCount: Number(row.open_pr_count),
      hasCloudRunner: !!env.CLOUD_RUNNER,
    });

    if (eligible && (await requeueCloudRun(env, sql, row))) {
      requeuedCloud += 1;
      continue;
    }

    // Surface-aware reason: a run whose last activity outlasted the serverless wall
    // ran on a long-lived executor (durable/container) and crashed — don't claim a
    // 30s serverless timeout or tell the user to downgrade to a durable runtime.
    const reason = cloudOrphanReason(tsToMs(row.started_at ?? row.created_at), tsToMs(row.updated_at ?? row.created_at));
    const [failed] = (await sql`
      UPDATE executions
         SET status = 'failed',
             error_message = ${reason},
             completed_at = now(),
             updated_at = now()
       WHERE id = ${row.id} AND status = 'running'
      RETURNING id, tenant_id, agent_host_id, payload, error_message, task_id
    `) as ReapedRow[];
    if (failed) cloudRunning.push(failed);
  }

  // Dropped queue: submitted/pending but no agent ever took it.
  const queued = (await sql`
    UPDATE executions
       SET status = 'failed',
           error_message = 'Execution was never picked up by an agent within the dispatch window.',
           completed_at = now(),
           updated_at = now()
     WHERE status IN ('pending', 'submitted')
       AND created_at < ${queuedCutoff}
    RETURNING id, tenant_id, agent_host_id, payload, error_message, task_id
  `) as ReapedRow[];

  // Abandoned agent QUESTION: a run parked on `ask_human` that nobody answered
  // within the (generous) paused deadline. Unlike the sweeps above this is not a
  // hung process — it is a ticket held hostage: `evaluateTaskAutoRun` and
  // `laneRequirementGate` both count a paused run as LIVE, so until this row goes
  // terminal the ticket can never auto-run again. Measured from `updated_at` so a
  // still-active back-and-forth on the question keeps the run alive.
  const paused = (await sql`
    UPDATE executions
       SET status = 'failed',
           error_message = ${PAUSED_ORPHAN_REASON},
           completed_at = now(),
           updated_at = now()
     WHERE status = 'paused'
       AND COALESCE(updated_at, started_at, created_at) < ${pausedCutoff}
    RETURNING id, tenant_id, agent_host_id, payload, error_message, task_id
  `) as ReapedRow[];

  // Mirror each reaped failure onto the Observability Logs/Timeline (derived only
  // from tool_audit_events). Without this the run just stops at its last
  // successful tool call and the timeout reason is invisible there — the same gap
  // RuntimeService.reapIfOrphaned / recordRunFailureEvent close on the read path.
  // A timed-out QUESTION gets its own tool name so "the ticket was released because
  // nobody answered the agent" is distinguishable on the timeline from a crashed run.
  const reaped: { row: ReapedRow; toolName: string }[] = [
    ...[...running, ...cloudRunning, ...queued].map((row) => ({ row, toolName: 'run.failed' })),
    ...paused.map((row) => ({ row, toolName: 'run.paused_timeout' })),
  ];
  await Promise.all(reaped.map(async ({ row: r, toolName }) => {
    try {
      await sql`
        INSERT INTO tool_audit_events
          (tenant_id, agent_host_id, cloud_agent_ref, execution_id, session_key, tool_name, category, result, ts)
        VALUES
          (${r.tenant_id}, ${r.agent_host_id}, ${cloudRefFromPayload(r.payload)}, ${r.id},
           ${'exec:' + r.id}, ${toolName}, 'error', ${r.error_message ?? 'Run failed'}, now())
      `;
    } catch {
      /* telemetry is best-effort — never break the reap sweep on it */
    }
  }));

  // …and narrate each reaped failure into the ticket's linked Brain chats. The
  // raw-SQL sweeps above bypass RuntimeService.update, so without this a run that
  // dies silently (hung host, evicted cloud isolate, dropped queue, abandoned
  // ask_human) NEVER reaches the human driving the conversation — the chat shows
  // "started working on…" and then nothing, forever. Idempotent per execution
  // (run:{id}:failed), so racing the read-path reaper's narration is harmless.
  await narrateReapedRuns(env, sql, reaped.map(({ row }) => row));

  // Same family of "reap a stuck state on the frequent tick": surface any ticket
  // parked on a run_workflow whose spawned workflow never settled past the
  // park-age cap. Best-effort + isolated so a failure here never breaks the
  // execution reaper above (and vice versa).
  let parkAge: ParkAgeTimeoutResult = { stale: 0, unparked: 0 };
  try {
    parkAge = await runParkAgeTimeoutSweep(env, nowMs);
  } catch (err) {
    console.error('[cron:park-age] sweep failed', err);
  }

  return {
    failedRunning: running.length + cloudRunning.length,
    failedQueued: queued.length,
    failedPaused: paused.length,
    requeuedCloud,
    parkAge,
  };
}

interface ReapedRow {
  id: number;
  tenant_id: number;
  agent_host_id: number | null;
  payload: string | null;
  error_message: string | null;
  /** The ticket the run served — the chat-narration fan-out key (chat_ticket_links). */
  task_id: number | null;
}

/**
 * Post a `failed` run-milestone into every Brain chat linked to each reaped run's
 * ticket ({@link ChatTicketService.postRunMilestone} — insert + DO `changed`
 * broadcast, so a mounted web/VSIX Brain re-reads and shows it live). One batched
 * `tasks` read resolves the chat-ticket kind (task|epic|gap); per-execution+phase
 * idempotent; best-effort — narration must never break the reap sweep.
 */
async function narrateReapedRuns(env: Env, sql: SqlTag, rows: ReapedRow[]): Promise<void> {
  const withTask = rows.filter((r) => r.task_id != null);
  if (withTask.length === 0) return;
  try {
    const taskIds = [...new Set(withTask.map((r) => Number(r.task_id)))];
    const kinds = (await sql`
      SELECT id, task_type FROM tasks WHERE id = ANY(${taskIds})
    `) as Array<{ id: number; task_type: string | null }>;
    const kindByTask = new Map(kinds.map((k) => [Number(k.id), ticketKindForTaskType(k.task_type)]));
    const chatTickets = new ChatTicketService(buildDatabase(env), env);
    await Promise.all(withTask.map((r) => chatTickets.postRunMilestone(r.tenant_id, {
      kind: kindByTask.get(Number(r.task_id)) ?? 'task',
      ref: String(r.task_id),
      agentRef: cloudRefFromPayload(r.payload),
      phase: 'failed',
      executionId: r.id,
      errorMessage: r.error_message,
    })));
  } catch {
    /* narration is best-effort — never break the reap sweep on it */
  }
}

/** A stale cloud run + the task context the durable executor needs to resume it. */
interface CloudCandidateRow extends ReapedRow {
  started_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  task_id: number;
  task_title: string;
  task_description: string | null;
  project_id: number;
  cloud_agent_ref: string | null;
  open_pr_count: number | string;
}

/** Parse a timestamp column (ISO string or null) to epoch ms, or null when absent
 *  / unparseable — so the reason picker falls back to the serverless message. */
function tsToMs(ts: string | null | undefined): number | null {
  if (!ts) return null;
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ms : null;
}

type SqlTag = ReturnType<typeof neon<false, false>>;

/**
 * Re-queue an orphaned cloud run on the durable executor (CloudRunnerDO) exactly
 * once. We DON'T pass `artifacts`: the DO's prepareCloudRun re-reads the repo, so
 * the retry reconciles against whatever the dead run already wrote instead of
 * blindly re-creating it. The `reaperRequeued` flag is persisted to the payload
 * BEFORE kickoff so even a crash mid-dispatch can't cause a second retry. Returns
 * true only when the DO accepted the run (it flips the row back to `running`);
 * any failure returns false so the caller fails the run with CLOUD_ORPHAN_REASON.
 */
async function requeueCloudRun(env: Env, sql: SqlTag, row: CloudCandidateRow): Promise<boolean> {
  if (!env.CLOUD_RUNNER) return false;

  const requeuedPayload = markReaperRequeued(row.payload);
  // Persist the one-retry flag first — its absence is the only thing that makes a
  // run eligible, so writing it up-front is what guarantees "at most one retry".
  await sql`
    UPDATE executions SET payload = ${requeuedPayload}, updated_at = now()
     WHERE id = ${row.id} AND status = 'running'
  `;

  // Shared dispatch contract + kickoff (cloudSelfHeal) so the durable `/start` body
  // matches every other self-heal path.
  const ok = await dispatchDurableStart(env, row.id, buildDurableStartBody({
    executionId: row.id,
    tenantId: row.tenant_id,
    projectId: row.project_id,
    taskId: row.task_id,
    taskTitle: row.task_title,
    taskDescription: row.task_description,
    cloudAgentRef: row.cloud_agent_ref,
    payload: requeuedPayload,
  }));
  if (!ok) return false;

  // Surface the self-heal on the Observability timeline so the gap (a run that
  // looked dead) is explained rather than silently resurrected.
  try {
    await sql`
      INSERT INTO tool_audit_events
        (tenant_id, agent_host_id, cloud_agent_ref, execution_id, session_key, tool_name, category, result, ts)
      VALUES
        (${row.tenant_id}, NULL, ${row.cloud_agent_ref}, ${row.id}, ${'exec:' + row.id},
         'runtime.requeue', 'planning',
         ${'Orphaned cloud run re-queued once on the durable executor (CloudRunnerDO) to run to completion.'}, now())
    `;
  } catch {
    /* telemetry is best-effort */
  }
  return true;
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
