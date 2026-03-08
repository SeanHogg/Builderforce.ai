import { AuditEvent } from './AuditEvent';
import { TenantId } from '../shared/types';

export interface AuditQueryOptions {
  tenantId?:    TenantId;
  userId?:      string;
  limit?:       number;
  offset?:      number;
}

export interface IAuditRepository {
  save(event: AuditEvent): Promise<AuditEvent>;
  query(opts: AuditQueryOptions): Promise<AuditEvent[]>;
}
