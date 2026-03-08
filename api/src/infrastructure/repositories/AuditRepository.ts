import { eq, and } from 'drizzle-orm';
import { IAuditRepository, AuditQueryOptions } from '../../domain/audit/IAuditRepository';
import { AuditEvent, AuditEventProps } from '../../domain/audit/AuditEvent';
import { TenantId, AuditEventType, asTenantId } from '../../domain/shared/types';
import { auditEvents as auditTable } from '../database/schema';
import type { Db } from '../database/connection';

export class AuditRepository implements IAuditRepository {
  constructor(private readonly db: Db) {}

  async save(event: AuditEvent): Promise<AuditEvent> {
    const plain = event.toPlain();
    const [inserted] = await this.db
      .insert(auditTable)
      .values({
        tenantId:     plain.tenantId ?? undefined,
        userId:       plain.userId ?? undefined,
        eventType:    plain.eventType,
        resourceType: plain.resourceType ?? undefined,
        resourceId:   plain.resourceId ?? undefined,
        metadata:     plain.metadata ?? undefined,
      })
      .returning();
    if (!inserted) throw new Error('Audit insert returned no rows');
    return toDomain(inserted);
  }

  async query(opts: AuditQueryOptions): Promise<AuditEvent[]> {
    const conditions = [];
    if (opts.tenantId !== undefined) {
      conditions.push(eq(auditTable.tenantId, opts.tenantId));
    }
    if (opts.userId !== undefined) {
      conditions.push(eq(auditTable.userId, opts.userId));
    }

    const query = this.db
      .select().from(auditTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .limit(opts.limit ?? 100)
      .offset(opts.offset ?? 0);

    const rows = await query;
    return rows.map(toDomain);
  }
}

function toDomain(row: typeof auditTable.$inferSelect): AuditEvent {
  return AuditEvent.reconstitute({
    id:           row.id,
    tenantId:     row.tenantId != null ? asTenantId(row.tenantId) : null,
    userId:       row.userId ?? null,
    eventType:    row.eventType as AuditEventType,
    resourceType: row.resourceType ?? null,
    resourceId:   row.resourceId ?? null,
    metadata:     row.metadata ?? null,
    createdAt:    row.createdAt,
  } as AuditEventProps);
}
