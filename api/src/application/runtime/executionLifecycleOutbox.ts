import { reportCaughtError } from '../observability/caughtErrorReporter';
import { and, eq, inArray, isNotNull, lte } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { activityLog, executionLifecycleOutbox } from '../../infrastructure/database/schema';
import type { Env } from '../../env';
import { bumpCacheVersion } from '../../infrastructure/cache/readThroughCache';
import { activityDatabase, activityLogVersionKey, type ActorIdentity } from '../activity/activityLog';
import { submittingUserId } from './dispatcherLabel';

const MAX_ATTEMPTS = 8;

export interface LifecycleOutboxDrainResult {
  claimed: number;
  projected: number;
  retried: number;
  dead: number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error);
}

/** Exponential retry delay, capped at one hour. Exported for contract tests. */
export function lifecycleOutboxBackoffMs(attempts: number): number {
  return Math.min(1_000 * 2 ** Math.min(Math.max(attempts, 0), 12), 60 * 60_000);
}

function actorFor(row: {
  eventType: string;
  submittedBy: string;
  agentHostId: number | null;
  cloudAgentRef: string | null;
}): ActorIdentity {
  const submittedBy = row.submittedBy.trim();
  const automated = /^(system|manager|rehearsal|cron|workflow):/i.test(submittedBy)
    || submittedBy === 'system';

  // Submission is attributed to the requester. Runtime transitions are
  // attributed to the executor that actually performed them.
  if (row.eventType === 'execution.submitted' && !automated) {
    // ONE parser for `user:<id>` (`submittingUserId`) — this used to be a second,
    // subtly different copy that kept the whole remainder of a COMPOSED label.
    const ref = submittingUserId(submittedBy) ?? submittedBy;
    return { type: 'human', ref, name: ref };
  }
  if (row.cloudAgentRef) {
    return { type: 'cloud_agent', ref: row.cloudAgentRef, name: row.cloudAgentRef };
  }
  if (row.agentHostId != null) {
    return { type: 'host_agent', ref: String(row.agentHostId), name: `AgentHost ${row.agentHostId}` };
  }
  return { type: 'system', ref: null, name: 'System' };
}

function summaryFor(eventType: string, executionId: number, toStatus: string): string {
  const action = eventType.replace('execution.', '').replaceAll('_', ' ');
  return `Execution ${executionId} ${action || toStatus}`;
}

/**
 * Project durable execution events into the unified tenant activity log.
 *
 * Claiming is compare-and-set. Projection is idempotent on activity_log.event_key:
 * if the activity insert commits but the outbox acknowledgement fails, a retry
 * observes the same event key and safely marks the row done without duplicating it.
 */
export async function drainExecutionLifecycleOutbox(
  env: Env | undefined,
  db: Db,
  opts: { limit?: number; executionId?: number } = {},
): Promise<LifecycleOutboxDrainResult> {
  const limit = Math.max(1, Math.min(opts.limit ?? 100, 500));
  const now = new Date();
  const filters = [
    // This is the deliberate cross-tenant cron scan. Requiring a tenant value
    // keeps global/platform rows out; every subsequent mutation also matches the
    // tenant copied from the claimed row.
    isNotNull(executionLifecycleOutbox.tenantId),
    inArray(executionLifecycleOutbox.status, ['pending', 'retry']),
    lte(executionLifecycleOutbox.nextAttemptAt, now),
  ];
  if (opts.executionId != null) filters.push(eq(executionLifecycleOutbox.executionId, opts.executionId));

  const due = await db
    .select()
    .from(executionLifecycleOutbox)
    .where(and(...filters))
    .orderBy(executionLifecycleOutbox.id)
    .limit(limit);

  const result: LifecycleOutboxDrainResult = { claimed: 0, projected: 0, retried: 0, dead: 0 };
  const touchedTenants = new Set<number>();

  for (const row of due) {
    const [claimed] = await db
      .update(executionLifecycleOutbox)
      .set({ status: 'processing', updatedAt: now })
      .where(and(
        eq(executionLifecycleOutbox.id, row.id),
        eq(executionLifecycleOutbox.tenantId, row.tenantId),
        inArray(executionLifecycleOutbox.status, ['pending', 'retry']),
      ))
      .returning({ id: executionLifecycleOutbox.id });
    if (!claimed) continue;
    result.claimed += 1;

    try {
      const actor = actorFor(row);
      // The OUTBOX lives on primary (it foreign-keys executions/tasks); `activity_log`
      // lives on the transactional endpoint. Projecting with the caller's `db` put every
      // execution.submitted/running/completed/failed event on primary, where no activity
      // surface reads — 85k lifecycle rows accumulated there unseen. The two-endpoint
      // write is safe for the reason the docblock already gives: the insert is idempotent
      // on `event_key`, so a projection that commits before its acknowledgement fails is
      // re-attempted without duplicating.
      await activityDatabase(env, db).insert(activityLog).values({
        eventKey: row.eventKey,
        tenantId: row.tenantId,
        projectId: row.projectId,
        actorType: actor.type,
        actorRef: actor.ref,
        actorName: actor.name,
        verb: row.eventType,
        targetType: 'execution',
        targetId: String(row.executionId),
        targetLabel: `Execution ${row.executionId}`,
        summary: summaryFor(row.eventType, row.executionId, row.toStatus),
        metadata: {
          eventKey: row.eventKey,
          lifecycleVersion: row.lifecycleVersion,
          taskId: row.taskId,
          fromStatus: row.fromStatus,
          toStatus: row.toStatus,
          submittedBy: row.submittedBy,
          mode: row.mode,
          ...(row.payload && typeof row.payload === 'object' ? row.payload as Record<string, unknown> : {}),
        },
        occurredAt: row.occurredAt,
      }).onConflictDoNothing({ target: activityLog.eventKey });

      await db.update(executionLifecycleOutbox)
        .set({ status: 'done', processedAt: new Date(), lastError: null, updatedAt: new Date() })
        .where(and(
          eq(executionLifecycleOutbox.id, row.id),
          eq(executionLifecycleOutbox.tenantId, row.tenantId),
        ));
      touchedTenants.add(row.tenantId);
      result.projected += 1;
    } catch (error) {
      const attempts = row.attempts + 1;
      const message = errorMessage(error).slice(0, 4_000);
      const dead = attempts >= MAX_ATTEMPTS;
      reportCaughtError(error, { source: "application/runtime/executionLifecycleOutbox.ts", operation: "drainExecutionLifecycleOutbox", context: { logMessage: '[execution-lifecycle-outbox] projection failed', details: {
        outboxId: row.id,
        eventKey: row.eventKey,
        tenantId: row.tenantId,
        executionId: row.executionId,
        attempts,
        dead,
        error: message,
      } } });
      await db.update(executionLifecycleOutbox)
        .set({
          status: dead ? 'dead' : 'retry',
          attempts,
          nextAttemptAt: new Date(Date.now() + lifecycleOutboxBackoffMs(attempts)),
          lastError: message,
          updatedAt: new Date(),
        })
        .where(and(
          eq(executionLifecycleOutbox.id, row.id),
          eq(executionLifecycleOutbox.tenantId, row.tenantId),
        ));
      if (dead) result.dead += 1;
      else result.retried += 1;
    }
  }

  await Promise.all([...touchedTenants].map(async (tenantId) => {
    try {
      await bumpCacheVersion(env as Env, activityLogVersionKey(tenantId));
    } catch (error) {
      reportCaughtError(error, { source: "application/runtime/executionLifecycleOutbox.ts", operation: "drainExecutionLifecycleOutbox", context: { logMessage: '[execution-lifecycle-outbox] cache-version bump failed', details: {
        tenantId,
        error: errorMessage(error),
      } } });
    }
  }));
  return result;
}

/** Frequent cron entry point. */
export async function runExecutionLifecycleOutboxSweep(env: Env): Promise<LifecycleOutboxDrainResult> {
  const { buildTransactionalDatabase } = await import('../../infrastructure/database/connection');
  return drainExecutionLifecycleOutbox(env, buildTransactionalDatabase(env), { limit: 500 });
}
