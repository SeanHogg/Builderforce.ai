/**
 * Who a sandbox callback speaks for, and the two liveness signals every run depends on.
 *
 * A run SANDBOX (the Cloudflare Container, the GitHub Actions runner) holds no database
 * credentials, so every callback it posts arrives with an execution id and nothing else.
 * {@link loadSandboxRunContext} turns that id back into the run's identity — its ticket,
 * project and executing agent — which is all a sandbox callback needs: the sandbox runs
 * no loop, so nothing it says is a model turn, a commit or a finalize.
 *
 * {@link isExecutionCancelled} and {@link heartbeatExecution} live here because they are
 * the same question from two directions — is this run still alive, and is it still
 * allowed to be.
 */
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { findCanonicalBoard } from '../../swimlane/canonicalBoard';
import { parseCloudAgentRef } from '../cloudDispatch';
import { getOrSetCached } from '../../../infrastructure/cache/readThroughCache';
import { executions, tasks } from '../../../infrastructure/database/schema';
import { reportCaughtError } from '../../observability/caughtErrorReporter';
import { throttledWriteDue } from '../../agentHost/heartbeatThrottle';
import { resolveCloudAgent } from './agent';
import type { Env } from '../../../env';
import type { Db } from '../../../infrastructure/database/connection';

/** The run a sandbox callback speaks for. */
export interface SandboxRunContext {
  tenantId: number;
  taskId: number;
  projectId: number;
  cloudAgentRef?: string;
}

/** Load (and briefly cache) the identity of the run an execution id names. An
 *  execution's ticket, project and agent are immutable, so the cache needs no
 *  invalidation. Null for a run that may not be driven (unknown, an inactive agent, a
 *  managed-board ticket with no named executor). */
export async function loadSandboxRunContext(env: Env, db: Db, executionId: number): Promise<SandboxRunContext | null> {
  return getOrSetCached(env, `sandboxctx:${executionId}`, async () => {
    const [exec] = await db
      .select({ taskId: executions.taskId, tenantId: executions.tenantId, payload: executions.payload })
      .from(executions).where(eq(executions.id, executionId)).limit(1);
    if (!exec) return null;
    const [task] = await db
      .select({ projectId: tasks.projectId, assignedAgentRef: tasks.assignedAgentRef })
      .from(tasks).where(eq(tasks.id, exec.taskId)).limit(1);
    if (!task) return null;
    const explicitRef = parseCloudAgentRef(exec.payload ?? undefined);
    const board = await findCanonicalBoard(db, task.projectId, exec.tenantId);
    // Managed-ticket assignees coordinate; role dispatches must name their executor.
    if (board?.lifecycleManaged && !explicitRef) return null;
    const agent = await resolveCloudAgent(env, exec.tenantId, explicitRef ?? task.assignedAgentRef ?? undefined);
    if (agent.active === false) return null;
    return {
      tenantId: exec.tenantId, taskId: exec.taskId, projectId: task.projectId,
      ...(agent.ref ? { cloudAgentRef: agent.ref } : {}),
    };
  }, { kvTtlSeconds: 600, l1TtlMs: 600_000 });
}

/** True when the execution has been flipped to CANCELLED from another isolate. */
export async function isExecutionCancelled(db: Db, executionId: number): Promise<boolean> {
  try {
    const [row] = await db.select({ status: executions.status }).from(executions).where(eq(executions.id, executionId)).limit(1);
    return row?.status === 'cancelled';
  } catch (error) {
    reportCaughtError(error, { source: "application/runtime/cloudAgent/runContext.ts", operation: "isExecutionCancelled", context: { logMessage: '[cloud-run] cancellation status check failed', details: { executionId, error } } });
    return false;
  }
}

/** How often a run beats while one sandbox command runs (`sandbox/sandboxProvider.ts`): a
 *  build or a test suite can hold one tool call for minutes with no model turn. Only the
 *  WRITE a beat causes is throttled. */
export const SANDBOX_COMMAND_HEARTBEAT_MS = 60_000;

/**
 * Minimum spacing between liveness writes, bound to the reaper's REAL ceiling for the
 * executors that beat here: `orphanReasons.CLOUD_LONG_LIVED_SILENCE_MS` (5 min, durable +
 * container; `staleExecutionReaper`'s 90s `CLOUD_RUNNING_DEADLINE_MS` is only its
 * candidate prefilter). Worst-case `updated_at` age for a live run is this plus one
 * caller cadence: a running sandbox command 60s = 3 min; durable DO one alarm tick ≈
 * one LLM step (slowest observed 93s, execution #136) ≈ 3.5 min. Both
 * stay inside the ceiling — pinned in runContext.heartbeat.test.ts. Was 30s, which made
 * every live run an UPDATE every 30s and kept Neon from ever suspending.
 */
export const HEARTBEAT_MIN_INTERVAL_MS = 2 * 60_000;

/** In-isolate memory of this isolate's last successful beat (L1 only — a KV write per
 *  beat would cost more than the round trip it saves). */
const beatCacheKey = (executionId: number): string => `exec:beat:${executionId}`;

/**
 * Bump `executions.updated_at` — the cloud-run liveness heartbeat the orphan reaper
 * measures "last activity" from. A container can spend minutes inside a single
 * `run_command` (a build/test step) with no LLM round-trip, so it pings this on a
 * timer independent of LLM steps; without that the reaper would kill a healthy,
 * busy container mid-build. ONE writer, so the `llm` op and the dedicated
 * `heartbeat` op agree. Best-effort — a missed beat is covered by the next one.
 *
 * Throttled to one write per {@link HEARTBEAT_MIN_INTERVAL_MS}: callers beat on every
 * LLM step and container op (the Durable Object alarm re-arms immediately), which was
 * a write per few seconds per run — and each one used to fire the lifecycle trigger.
 * Two layers: an in-isolate gate skips the round trip entirely while this isolate's
 * own last write is fresh (the DO alarm is one isolate, so most ticks cost nothing),
 * and the conditional WHERE keeps writes throttled across isolates.
 */
export async function heartbeatExecution(db: Db, executionId: number): Promise<void> {
  const lastBeat = await peekCached<number>(undefined, beatCacheKey(executionId));
  if (!throttledWriteDue({ lastWrittenAtMs: lastBeat, throttleMs: HEARTBEAT_MIN_INTERVAL_MS })) return;
  const now = Date.now();
  try {
    const written = await db.update(executions).set({ updatedAt: new Date(now) })
      .where(and(
        eq(executions.id, executionId),
        or(isNull(executions.updatedAt), lt(executions.updatedAt, new Date(now - HEARTBEAT_MIN_INTERVAL_MS))),
      ))
      .returning({ id: executions.id });
    // Gate only on a write THIS call made: a no-match means another isolate wrote at an
    // unknown point inside the window, and gating on "now" could age the row past the
    // throttle before anyone wrote again.
    if (written.length > 0) {
      await setCached(undefined, beatCacheKey(executionId), now, { l1TtlMs: HEARTBEAT_MIN_INTERVAL_MS });
    }
  } catch (error) {
    reportCaughtError(error, { source: "application/runtime/cloudAgent/runContext.ts", operation: "heartbeatExecution", context: { logMessage: '[cloud-container] execution heartbeat failed', details: { executionId, error } } });
  }
}
