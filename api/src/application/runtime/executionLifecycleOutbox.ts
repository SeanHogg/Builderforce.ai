import { reportCaughtError } from '../observability/caughtErrorReporter';
import { and, eq, inArray, isNotNull, lte } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { bumpExecutionState } from './executionStateVersion';
import { activityLog, executionLifecycleOutbox } from '../../infrastructure/database/schema';
import type { Env } from '../../env';
import { bumpCacheVersion } from '../../infrastructure/cache/readThroughCache';
import { activityDatabase, activityLogVersionKey, hostAgentActor, type ActorIdentity } from '../activity/activityLog';
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
    return hostAgentActor(row.agentHostId, `AgentHost ${row.agentHostId}`);
  }
  return { type: 'system', ref: null, name: 'System' };
}

function summaryFor(eventType: string, executionId: number, toStatus: string): string {
  const action = eventType.replace('execution.', '').replaceAll('_', ' ');
  return `Execution ${executionId} ${action || toStatus}`;
}

type DueRow = typeof executionLifecycleOutbox.$inferSelect;

function projectionValues(row: DueRow): typeof activityLog.$inferInsert {
  const actor = actorFor(row);
  return {
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
  };
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

  // No separate `processing` claim. The projection is idempotent on `event_key`, so a
  // row two drains both see is simply projected twice with one effect; the settle below
  // is conditional on the row still being open, which makes it the claim and the
  // acknowledgement in one write (three writes per event became one).
  const stillOpen = (id: number, tenantId: number) => scopedToTenant(
    executionLifecycleOutbox,
    tenantId,
    eq(executionLifecycleOutbox.id, id),
    inArray(executionLifecycleOutbox.status, ['pending', 'retry']),
  );

  const settleProjected = (row: DueRow) => {
    result.claimed += 1;
    result.projected += 1;
    touchedTenants.add(row.tenantId);
  };

  // Fast path: ONE multi-row activity insert + ONE conditional UPDATE for the whole
  // batch (was 2 statements per event, up to 500 per tick). `RETURNING id` tells us
  // which rows we actually settled; a row a concurrent drain settled first is skipped.
  let batched = false;
  if (due.length > 0) {
    try {
      await activityDatabase(env, db).insert(activityLog)
        .values(due.map(projectionValues))
        .onConflictDoNothing({ target: activityLog.eventKey });
      const now2 = new Date();
      const settled = await db.update(executionLifecycleOutbox)
        .set({ status: 'done', processedAt: now2, lastError: null, updatedAt: now2 })
        .where(and(
          isNotNull(executionLifecycleOutbox.tenantId),
          inArray(executionLifecycleOutbox.id, due.map((r) => r.id)),
          inArray(executionLifecycleOutbox.status, ['pending', 'retry']),
        ))
        .returning({ id: executionLifecycleOutbox.id });
      const settledIds = new Set(settled.map((r) => r.id));
      for (const row of due) if (settledIds.has(row.id)) settleProjected(row);
      batched = true;
    } catch (error) {
      // One poison row must not park the other 499: fall back to per-row handling,
      // which retries/dead-letters only the row that actually fails.
      reportCaughtError(error, { source: "application/runtime/executionLifecycleOutbox.ts", operation: "drainExecutionLifecycleOutbox.batch", context: { logMessage: '[execution-lifecycle-outbox] batch projection failed; falling back per row', details: { rows: due.length, error: errorMessage(error) } } });
    }
  }

  for (const row of batched ? [] : due) {
    try {
      // The OUTBOX lives on primary (it foreign-keys executions/tasks); `activity_log`
      // lives on the transactional endpoint, so the two writes use different handles.
      // Safe because the insert is idempotent on `event_key`.
      await activityDatabase(env, db).insert(activityLog).values(projectionValues(row))
        .onConflictDoNothing({ target: activityLog.eventKey });

      const [settled] = await db.update(executionLifecycleOutbox)
        .set({ status: 'done', processedAt: new Date(), lastError: null, updatedAt: new Date() })
        .where(stillOpen(row.id, row.tenantId))
        .returning({ id: executionLifecycleOutbox.id });
      if (!settled) continue; // a concurrent drain settled it first
      settleProjected(row);
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
      const [failed] = await db.update(executionLifecycleOutbox)
        .set({
          status: dead ? 'dead' : 'retry',
          attempts,
          nextAttemptAt: new Date(Date.now() + lifecycleOutboxBackoffMs(attempts)),
          lastError: message,
          updatedAt: new Date(),
        })
        .where(stillOpen(row.id, row.tenantId))
        .returning({ id: executionLifecycleOutbox.id });
      if (!failed) continue; // settled by a concurrent drain
      result.claimed += 1;
      if (dead) result.dead += 1;
      else result.retried += 1;
    }
  }

  await Promise.all([...touchedTenants].map(async (tenantId) => {
    // An execution changed state: the tenant's attention snapshot is stale too.
    await bumpExecutionState(env as Env, tenantId);
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
