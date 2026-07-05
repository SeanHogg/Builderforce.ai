import { and, desc, eq } from 'drizzle-orm';
import { IAuditRepository, AuditQueryOptions } from '../../domain/audit/IAuditRepository';
import { AuditEvent, AuditEventProps } from '../../domain/audit/AuditEvent';
import { AuditEventType, asTenantId } from '../../domain/shared/types';
import { activityLog } from '../database/schema';
import { recordActivity, resolveHumanActor, SYSTEM_ACTOR, type ActorIdentity } from '../../application/activity/activityLog';
import type { Env } from '../../env';
import type { Db } from '../database/connection';

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

  async query(opts: AuditQueryOptions): Promise<AuditEvent[]> {
    const conditions = [];
    if (opts.tenantId !== undefined) conditions.push(eq(activityLog.tenantId, Number(opts.tenantId)));
    if (opts.userId !== undefined) conditions.push(eq(activityLog.actorRef, opts.userId));

    const rows = await this.db
      .select()
      .from(activityLog)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(activityLog.id))
      .limit(opts.limit ?? 100)
      .offset(opts.offset ?? 0);

    return rows.map((r) => AuditEvent.reconstitute({
      id:           Number(r.id),
      tenantId:     r.tenantId != null ? asTenantId(r.tenantId) : null,
      // Only human/hire actors are a "user"; agents/system have no users.id.
      userId:       (r.actorType === 'human' || r.actorType === 'hire') ? r.actorRef : null,
      eventType:    eventTypeForVerb(r.verb),
      resourceType: r.targetType,
      resourceId:   r.targetId,
      metadata:     r.metadata != null ? JSON.stringify(r.metadata) : null,
      createdAt:    r.occurredAt,
    } as AuditEventProps));
  }
}
