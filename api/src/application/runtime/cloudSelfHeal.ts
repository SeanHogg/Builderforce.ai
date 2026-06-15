/**
 * cloudSelfHeal — ONE implementation of "a cloud run died/crashed before reporting
 * a terminal status → recover it". Two outcomes, in priority order:
 *
 *   1. SELF-HEAL — re-queue the run ONCE on the durable executor (CloudRunnerDO),
 *      which alarm-ticks one step at a time and survives long multi-step runs. This
 *      is the right move for a run killed by infrastructure (a container that
 *      OOM'd / was evicted, the Worker `waitUntil` wall, a lost heartbeat).
 *   2. FAIL with the real reason — when self-heal isn't possible (no durable runner
 *      bound, the run already used its one retry, or an open PR a re-run would
 *      double), mark the run failed carrying the ACTUAL crash reason so the timeline
 *      explains *why* instead of a generic "went silent" guess.
 *
 * Shared by every detector so recovery is identical no matter who notices first:
 *   • the cron sweep ({@link ./staleExecutionReaper})            — periodic backstop
 *   • the read-path repair ({@link ./RuntimeService})            — a viewer polled it
 *   • the container crash handlers ({@link ./cloudAgentEngine} `fail` op +
 *     {@link ../../infrastructure/relay/AgentContainerDO} `onError`) — the runtime
 *     reported its own death, WITH the error message.
 *
 * Idempotent + once-only: the `reaperRequeued` flag is persisted to the payload
 * before kickoff, so a second detector finds it set and falls through to failing the
 * run — never an infinite re-queue loop. This module is intentionally a leaf (no
 * import of {@link ./cloudAgentEngine}) so the engine's `fail` op can depend on it
 * without a cycle; the small telemetry insert below mirrors `recordCloudToolEvent`
 * for that reason.
 */
import { and, eq, ne } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { executions, pullRequests, tasks, toolAuditEvents } from '../../infrastructure/database/schema';
import type { Env } from '../../env';
import { markReaperRequeued, wasReaperRequeued, parseCloudAgentRef } from './cloudDispatch';

/** Live (non-terminal) statuses an orphaned/crashed run can be recovered from. */
const RECOVERABLE = new Set(['running', 'submitted', 'pending']);

export type SelfHealOutcome = 'requeued' | 'ineligible';

/** Everything the durable executor needs to resume a run, + the eligibility inputs. */
export interface SelfHealInput {
  executionId: number;
  tenantId: number;
  projectId: number;
  taskId: number;
  taskTitle: string;
  taskDescription: string | null;
  cloudAgentRef: string | null;
  payload: string | null;
  status?: string;
}

/** The body the durable runner's `/start` expects — the dispatch contract, kept in
 *  ONE place so the cron reaper and the drizzle self-heal agree on its shape. */
export interface DurableStartBody {
  executionId: number;
  tenantId: number;
  projectId: number;
  taskId: number;
  taskTitle: string;
  taskDescription: string | null;
  cloudAgentRef?: string;
  agentLabel: string;
  payload: string;
}

export function buildDurableStartBody(input: {
  executionId: number; tenantId: number; projectId: number; taskId: number;
  taskTitle: string; taskDescription: string | null; cloudAgentRef: string | null; payload: string;
}): DurableStartBody {
  return {
    executionId: input.executionId,
    tenantId: input.tenantId,
    projectId: input.projectId,
    taskId: input.taskId,
    taskTitle: input.taskTitle,
    taskDescription: input.taskDescription,
    cloudAgentRef: input.cloudAgentRef ?? undefined,
    agentLabel: input.cloudAgentRef ? `Cloud agent ${input.cloudAgentRef}` : 'BuilderForce Agent',
    payload: input.payload,
  };
}

/** The one eligibility rule for the once-only durable retry — pure + testable. */
export function isSelfHealEligible(input: { payload: string | null; openPrCount: number; hasCloudRunner: boolean }): boolean {
  return input.hasCloudRunner && !wasReaperRequeued(input.payload) && input.openPrCount === 0;
}

/** Kick off (or re-kick) a run on the durable executor. DB-agnostic so both the
 *  raw-SQL cron reaper and the drizzle self-heal share the dispatch. Never throws. */
export async function dispatchDurableStart(env: Env, executionId: number, body: DurableStartBody): Promise<boolean> {
  const cloudRunner = env.CLOUD_RUNNER;
  if (!cloudRunner) return false;
  try {
    const stub = cloudRunner.get(cloudRunner.idFromName(`exec:${executionId}`));
    const res = await stub.fetch('https://cloud-runner/start', { method: 'POST', body: JSON.stringify(body) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Non-terminal PR count for a task — a re-run must not double an open PR. */
async function countOpenPrs(db: Db, taskId: number): Promise<number> {
  try {
    const rows = await db.select({ id: pullRequests.id })
      .from(pullRequests)
      .where(and(eq(pullRequests.taskId, taskId), ne(pullRequests.status, 'merged'), ne(pullRequests.status, 'closed')));
    return rows.length;
  } catch {
    return 0;
  }
}

/** Best-effort tool-audit write. Mirrors `recordCloudToolEvent` (kept local to avoid
 *  an import cycle with cloudAgentEngine — see the file header). */
async function recordEvent(db: Db, args: { tenantId: number; cloudAgentRef: string | null; executionId: number; toolName: string; category: string; detail?: unknown; result: string }): Promise<void> {
  try {
    await db.insert(toolAuditEvents).values({
      tenantId: args.tenantId, agentHostId: null, cloudAgentRef: args.cloudAgentRef ?? null,
      executionId: args.executionId, sessionKey: `exec:${args.executionId}`, toolCallId: null,
      toolName: args.toolName, category: args.category,
      args: args.detail != null ? JSON.stringify(args.detail) : null,
      result: args.result, durationMs: null, ts: new Date(),
    });
  } catch { /* telemetry is best-effort */ }
}

/**
 * Attempt the once-only durable self-heal (drizzle). Returns 'requeued' when the
 * durable executor accepted the run, else 'ineligible'. Persists the one-retry flag
 * BEFORE kickoff (guarded on a still-running status so a concurrently-cancelled run
 * is never resurrected) — its absence is what makes a run eligible, so writing it
 * first guarantees at most one retry even on a mid-dispatch crash.
 */
export async function selfHealCloudRun(env: Env, db: Db, input: SelfHealInput): Promise<SelfHealOutcome> {
  const openPrCount = await countOpenPrs(db, input.taskId);
  if (!isSelfHealEligible({ payload: input.payload, openPrCount, hasCloudRunner: !!env.CLOUD_RUNNER })) return 'ineligible';

  const requeuedPayload = markReaperRequeued(input.payload);
  await db.update(executions)
    .set({ payload: requeuedPayload, updatedAt: new Date() })
    .where(and(eq(executions.id, input.executionId), eq(executions.status, 'running')))
    .catch(() => { /* best-effort */ });

  const ok = await dispatchDurableStart(env, input.executionId, buildDurableStartBody({ ...input, payload: requeuedPayload }));
  if (!ok) return 'ineligible';

  await recordEvent(db, {
    tenantId: input.tenantId, cloudAgentRef: input.cloudAgentRef, executionId: input.executionId,
    toolName: 'runtime.requeue', category: 'planning',
    result: 'Crashed/orphaned cloud run re-queued once on the durable executor (CloudRunnerDO) to run to completion.',
  });
  return 'requeued';
}

/** Load the run + its task context needed to self-heal it, by execution id. */
export async function loadCloudRunForSelfHeal(db: Db, executionId: number): Promise<SelfHealInput | null> {
  try {
    const [row] = await db.select({
      executionId: executions.id,
      tenantId: executions.tenantId,
      payload: executions.payload,
      cloudAgentRef: executions.cloudAgentRef,
      status: executions.status,
      taskId: tasks.id,
      taskTitle: tasks.title,
      taskDescription: tasks.description,
      projectId: tasks.projectId,
    })
      .from(executions)
      .innerJoin(tasks, eq(tasks.id, executions.taskId))
      .where(eq(executions.id, executionId))
      .limit(1);
    if (!row) return null;
    return {
      executionId: row.executionId,
      tenantId: row.tenantId,
      projectId: row.projectId,
      taskId: row.taskId,
      taskTitle: row.taskTitle,
      taskDescription: row.taskDescription,
      // Cloud attribution is on the column (migration 0092) or, for older runs, the payload.
      cloudAgentRef: row.cloudAgentRef ?? parseCloudAgentRef(row.payload ?? undefined) ?? null,
      payload: row.payload,
      status: row.status,
    };
  } catch {
    return null;
  }
}

/**
 * A cloud backplane (container / DO / worker loop) reported that a run crashed,
 * WITH the real reason. Recover it: self-heal once on the durable executor, else
 * fail the run carrying the actual `reason` (so the timeline says why) plus a
 * `run.failed` telemetry row. No-op when the run is already terminal. Never throws.
 */
export async function handleCloudRunCrash(env: Env, db: Db, executionId: number, reason: string): Promise<SelfHealOutcome | 'noop'> {
  const run = await loadCloudRunForSelfHeal(db, executionId);
  if (!run || !RECOVERABLE.has(run.status ?? '')) return 'noop';

  const outcome = await selfHealCloudRun(env, db, run);
  if (outcome === 'requeued') {
    await recordEvent(db, {
      tenantId: run.tenantId, cloudAgentRef: run.cloudAgentRef, executionId,
      toolName: 'runtime.crash', category: 'planning', detail: { reason },
      result: `Runtime crashed (${reason}) — re-queued once on the durable executor to run to completion.`,
    });
    return 'requeued';
  }

  await db.update(executions)
    .set({ status: 'failed', errorMessage: reason, completedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(executions.id, executionId), ne(executions.status, 'failed'), ne(executions.status, 'cancelled')))
    .catch(() => { /* best-effort */ });
  await recordEvent(db, {
    tenantId: run.tenantId, cloudAgentRef: run.cloudAgentRef, executionId,
    toolName: 'run.failed', category: 'error', result: reason,
  });
  return 'ineligible';
}
