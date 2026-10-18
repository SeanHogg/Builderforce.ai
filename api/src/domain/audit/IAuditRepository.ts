import { AuditEvent } from './AuditEvent';
import { TenantId } from '../shared/types';

export interface AuditQueryOptions {
  /** Required: an audit read is always one tenant's trail (there is no
   *  cross-tenant audit query — the operator trail is `admin_audit_log`). */
  tenantId:     TenantId;
  userId?:      string;
  limit?:       number;
  offset?:      number;
  /** Exact match on the event type (the verb in its underscored form). */
  eventType?:   string;
  /** Exact match on the resource type the event targeted. */
  resourceType?: string;
}

export interface IAuditRepository {
  save(event: AuditEvent): Promise<AuditEvent>;
  query(opts: AuditQueryOptions): Promise<AuditEvent[]>;
}
