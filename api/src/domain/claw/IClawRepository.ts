import { Claw, ClawStatus } from './Claw';
import { ClawId, TenantId } from '../shared/types';

export interface IClawRepository {
  findById(id: ClawId): Promise<Claw | null>;
  findByIdAndTenant(id: ClawId, tenantId: TenantId): Promise<Claw | null>;
  findByTenant(tenantId: TenantId): Promise<Claw[]>;
  verifyApiKey(id: ClawId, apiKey: string): Promise<Claw | null>;
  updateStatus(id: ClawId, tenantId: TenantId, status: ClawStatus): Promise<Claw | null>;
}
