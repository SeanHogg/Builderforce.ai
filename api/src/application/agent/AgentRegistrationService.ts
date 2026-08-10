import { asc, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { agentHosts, agentRegistrations } from '../../infrastructure/database/schema';
import { scopedToSegment } from '../../infrastructure/database/tenantScope';
import type { IAuditRepository } from '../../domain/audit/IAuditRepository';
import { AuditEvent } from '../../domain/audit/AuditEvent';
import { AuditEventType, asTenantId } from '../../domain/shared/types';

export type AgentRegistrationRecord = typeof agentRegistrations.$inferSelect;
export type AgentRegistrationCreate = Omit<
  typeof agentRegistrations.$inferInsert,
  'id' | 'tenantId' | 'segmentId' | 'createdAt' | 'updatedAt'
>;
export type AgentRegistrationUpdate = Partial<Pick<
  typeof agentRegistrations.$inferInsert,
  'name' | 'framework' | 'protocol' | 'endpoint' | 'externalAgentId' | 'credentialRef' |
  'agentHostId' |
  'status' | 'healthStatus' | 'declaredCapabilities' | 'discoveredCapabilities' |
  'agentCard' | 'metadata' | 'lastSeenAt'
>>;

export interface AgentRegistrationScope {
  tenantId: number;
  segmentId: string;
}

export class AgentRegistrationService {
  constructor(private readonly db: Db, private readonly audit: IAuditRepository) {}

  async list(scope: AgentRegistrationScope): Promise<AgentRegistrationRecord[]> {
    return this.db.select().from(agentRegistrations)
      .where(scopedToSegment(agentRegistrations, scope.tenantId, scope.segmentId))
      .orderBy(asc(agentRegistrations.name));
  }

  async get(id: string, scope: AgentRegistrationScope): Promise<AgentRegistrationRecord | null> {
    const [row] = await this.db.select().from(agentRegistrations).where(scopedToSegment(
      agentRegistrations,
      scope.tenantId,
      scope.segmentId,
      eq(agentRegistrations.id, id),
    )).limit(1);
    return row ?? null;
  }

  async hostExists(agentHostId: number, scope: AgentRegistrationScope): Promise<boolean> {
    const [host] = await this.db.select({ id: agentHosts.id }).from(agentHosts).where(scopedToSegment(
      agentHosts,
      scope.tenantId,
      scope.segmentId,
      eq(agentHosts.id, agentHostId),
    )).limit(1);
    return host != null;
  }

  async create(scope: AgentRegistrationScope, input: AgentRegistrationCreate): Promise<AgentRegistrationRecord> {
    const [row] = await this.db.insert(agentRegistrations).values({
      ...input,
      tenantId: scope.tenantId,
      segmentId: scope.segmentId,
    }).returning();
    if (!row) throw new Error('Agent registration insert returned no rows');
    if (input.registeredBy) {
      await this.audit.save(AuditEvent.create({
        tenantId: asTenantId(scope.tenantId),
        userId: input.registeredBy,
        eventType: AuditEventType.AGENT_REGISTERED,
        resourceType: 'agent_registration',
        resourceId: row.id,
        metadata: JSON.stringify({ framework: row.framework, protocol: row.protocol }),
      }));
    }
    return row;
  }

  async update(id: string, scope: AgentRegistrationScope, input: AgentRegistrationUpdate): Promise<AgentRegistrationRecord | null> {
    const [row] = await this.db.update(agentRegistrations).set({ ...input, updatedAt: new Date() }).where(scopedToSegment(
      agentRegistrations,
      scope.tenantId,
      scope.segmentId,
      eq(agentRegistrations.id, id),
    )).returning();
    return row ?? null;
  }

  async deactivate(id: string, scope: AgentRegistrationScope): Promise<AgentRegistrationRecord | null> {
    return this.update(id, scope, { status: 'inactive' });
  }
}
