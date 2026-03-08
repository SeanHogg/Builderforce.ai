import { Tenant } from './Tenant';
import { TenantId } from '../shared/types';

export interface ITenantRepository {
  findAll(): Promise<Tenant[]>;
  findById(id: TenantId): Promise<Tenant | null>;
  findBySlug(slug: string): Promise<Tenant | null>;
  findByUserId(userId: string): Promise<Tenant[]>;
  save(tenant: Tenant): Promise<Tenant>;
  update(tenant: Tenant): Promise<Tenant>;
  delete(id: TenantId): Promise<void>;
}
