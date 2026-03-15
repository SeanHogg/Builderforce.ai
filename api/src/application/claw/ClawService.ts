import { IClawRepository } from '../../domain/claw/IClawRepository';
import type { Claw, ClawStatus } from '../../domain/claw/Claw';
import { asClawId, asTenantId } from '../../domain/shared/types';

export type ClawFilterStatus = 'online' | 'offline' | null;

export class ClawService {
  constructor(private readonly clawRepo: IClawRepository) {}

  async getClawForTenant(clawId: number, tenantId: number): Promise<Claw | null> {
    return this.clawRepo.findByIdAndTenant(asClawId(clawId), asTenantId(tenantId));
  }

  async listClawsForTenant(tenantId: number, status: ClawFilterStatus = null): Promise<Claw[]> {
    const claws = await this.clawRepo.findByTenant(asTenantId(tenantId));
    if (status === 'online') {
      return claws.filter((c) => c.connectedAt !== null);
    }
    if (status === 'offline') {
      return claws.filter((c) => c.connectedAt === null);
    }
    return claws;
  }

  async updateDeclaredCapabilities(clawId: number, tenantId: number, capabilities: string[]): Promise<Claw | null> {
    const claw = await this.getClawForTenant(clawId, tenantId);
    if (!claw) return null;

    // Currently our repository does not support updates, so we defer to callers.
    // This method exists to encapsulate business rules in the future.
    return claw;
  }

  async verifyApiKey(clawId: number, apiKey: string): Promise<Claw | null> {
    return this.clawRepo.verifyApiKey(asClawId(clawId), apiKey);
  }

  async setStatus(clawId: number, tenantId: number, status: ClawStatus): Promise<Claw | null> {
    return this.clawRepo.updateStatus(asClawId(clawId), asTenantId(tenantId), status);
  }

  async deactivate(clawId: number, tenantId: number): Promise<Claw | null> {
    return this.setStatus(clawId, tenantId, 'inactive');
  }
}
