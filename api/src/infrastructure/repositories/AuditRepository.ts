import { reportCaughtError } from '../../application/observability/caughtErrorReporter';
import { IAuditRepository, AuditQueryOptions } from '../../domain/audit/IAuditRepository';
import { AuditEvent, AuditEventProps } from '../../domain/audit/AuditEvent';
import { AuditEventType, asTenantId } from '../../domain/shared/types';
import { getActivityLog, recordActivity, resolveHumanActor, SYSTEM_ACTOR, type ActorIdentity } from '../../application/activity/activityLog';
import type { Env } from '../../env';
import type { Db } from '../database/connection';
import { drainExecutionLifecycleOutbox } from '../../application/runtime/executionLifecycleOutbox';

/**
 * Audit repository — now an ADAPTER over the ONE unified `activity_log` stream
 * (migration 0295 retired the standalone `audit_events` table). The DDD seam
 * (`IAuditRepository`) is preserved so its callers (AuthService / AgentService /
 * RuntimeService) and the `/api/audit` reader keep working unchanged; only the
 * storage unified. eventType ⇄ verb is a dotted-name transform ('user_login' ↔
 * 'user.login'); the acting user maps to a polymorphic (human/hire) actor.
 */
function verbForEventType(eventType: string): string {
  return eventType.replace('_', '.');
}
function eventTypeForVerb(verb: string): AuditEventType {
  // Best-effort reverse map; unknown verbs (task.created, pr.merged, …) pass through
  // as their underscored form — AuditEvent.eventType is surfaced as a plain string.
  return verb.replace('.', '_') as AuditEventType;
}

export class AuditRepository implements IAuditRepository {
  constructor(private readonly db: Db, private readonly env?: Env) {}

  async save(event: AuditEvent): Promise<AuditEvent> {
    const p = event.toPlain();
    const tenantId = p.tenantId != null ? Number(p.tenantId) : null;

    // Execution lifecycle is captured atomically by the executions-table outbox
    // trigger. Drain that durable row instead of appending a second, non-idempotent
    // activity event here. Direct SQL writers are drained by the frequent sweep.
    if (p.resourceType === 'execution' && p.resourceId && /^\d+$/.test(p.resourceId)) {
      try {
        await drainExecutionLifecycleOutbox(this.env, this.db, {
          executionId: Number(p.resourceId),
          limit: 20,
        });
      } catch (error) {
        reportCaughtError(error, { source: "infrastructure/repositories/AuditRepository.ts", operation: "save", context: { logMessage: '[audit-repository] execution lifecycle outbox drain failed', details: {
          tenantId,
          executionId: Number(p.resourceId),
          eventType: p.eventType,
          error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        } } });
      }
      return event;
    }

    let actor: ActorIdentity;
    if (p.userId && tenantId != null) actor = await resolveHumanActor(this.env, this.db, tenantId, p.userId);
    else if (p.userId) actor = { type: 'human', ref: p.userId, name: p.userId };
    else actor = SYSTEM_ACTOR;

    let metadata: Record<string, unknown> | null = null;
    if (p.metadata) {
      try { metadata = JSON.parse(p.metadata) as Record<string, unknown>; }
      catch { metadata = { raw: p.metadata }; }
    }

    await recordActivity(this.env, this.db, {
      tenantId,
      actor,
      verb: verbForEventType(p.eventType),
      targetType: p.resourceType,
      targetId: p.resourceId,
      metadata,
    });
    return event;
  }

  /**
   * The audit view of the tenant's activity — a filter over THE activity read
   * (`getActivityLog`), so `/api/audit/*` reads the same database the writers
   * append to (this used to query `this.db`, the primary, which no activity
   * writer targets) and shares the timeline's version-token cache.
   */
  async query(opts: AuditQueryOptions): Promise<AuditEvent[]> {
    const tenantId = Number(opts.tenantId);
    const page = await getActivityLog(this.env as Env, this.db, tenantId, {
      ...(opts.userId !== undefined ? { actorRef: opts.userId } : {}),
      ...(opts.eventType ? { eventType: opts.eventType } : {}),
      ...(opts.resourceType ? { targetType: opts.resourceType } : {}),
      limit: opts.limit ?? 100,
      offset: opts.offset ?? 0,
    });

    return page.events.map((r) => AuditEvent.reconstitute({
      id:           r.id,
      tenantId:     asTenantId(tenantId),
      // Only human/hire actors are a "user"; agents/system have no users.id.
      userId:       (r.actorType === 'human' || r.actorType === 'hire') ? r.actorRef : null,
      eventType:    eventTypeForVerb(r.verb),
      resourceType: r.targetType,
      resourceId:   r.targetId,
      metadata:     r.metadata != null ? JSON.stringify(r.metadata) : null,
      createdAt:    new Date(r.occurredAt),
    } as AuditEventProps));
  }
}
