import { IAuditRepository, AuditQueryOptions } from '../../domain/audit/IAuditRepository';
import { AuditEvent } from '../../domain/audit/AuditEvent';
import { TenantRole, TenantId, asTenantId } from '../../domain/shared/types';
import { ForbiddenError } from '../../domain/shared/errors';

export class AuditService {
  constructor(private readonly audit: IAuditRepository) {}

  /**
   * Query audit events. Only OWNER / MANAGER may view tenant-level audit logs.
   */
  async query(
    opts:     AuditQueryOptions,
    actorRole: TenantRole,
  ): Promise<AuditEvent[]> {
    if (
      actorRole !== TenantRole.OWNER &&
      actorRole !== TenantRole.MANAGER
    ) {
      throw new ForbiddenError('Only OWNER or MANAGER may view audit events');
    }
    return this.audit.query(opts);
  }

  async userActivity(
    userId:    string,
    tenantId:  number,
    actorRole: TenantRole,
    limit?:    number,
  ): Promise<AuditEvent[]> {
    if (
      actorRole !== TenantRole.OWNER &&
      actorRole !== TenantRole.MANAGER
    ) {
      throw new ForbiddenError('Only OWNER or MANAGER may view user activity');
    }
    return this.audit.query({ userId, tenantId: asTenantId(tenantId), limit });
  }
}
