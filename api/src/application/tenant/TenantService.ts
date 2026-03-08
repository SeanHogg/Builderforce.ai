import { ITenantRepository } from '../../domain/tenant/ITenantRepository';
import { Tenant } from '../../domain/tenant/Tenant';
import {
  TenantRole,
  TenantPlan,
  TenantBillingCycle,
  TenantBillingStatus,
  asTenantId,
} from '../../domain/shared/types';
import { NotFoundError, ConflictError } from '../../domain/shared/errors';

export interface CreateTenantDto {
  name: string;
  ownerUserId: string;
}

/**
 * Application service: orchestrates Tenant use cases.
 */
export class TenantService {
  constructor(private readonly tenants: ITenantRepository) {}

  static readonly PRICING = {
    currency: 'USD',
    pro: {
      monthly: 29,
      yearly: 290,
      yearlySavingsPercent: 17,
    },
  } as const;

  async listTenants(): Promise<Tenant[]> {
    return this.tenants.findAll();
  }

  async listTenantsForUser(userId: string): Promise<Array<{
    id: number;
    name: string;
    slug: string;
    role: string;
    status: string;
    defaultClawId: number | null;
    plan: TenantPlan;
    effectivePlan: TenantPlan;
    billingStatus: TenantBillingStatus;
  }>> {
    const userTenants = await this.tenants.findByUserId(userId);
    return userTenants.map(t => {
      const member = t.getMember(userId);
      return {
        id: t.id,
        name: t.name,
        slug: t.slug,
        role: member?.role ?? 'member',
        status: t.status,
        defaultClawId: t.defaultClawId,
        plan: t.plan,
        effectivePlan: t.effectivePlan(),
        billingStatus: t.billingStatus,
      };
    });
  }

  async getTenant(id: number): Promise<Tenant> {
    const tenant = await this.tenants.findById(asTenantId(id));
    if (!tenant) throw new NotFoundError('Tenant', id);
    return tenant;
  }

  async createTenant(dto: CreateTenantDto): Promise<Tenant> {
    const slug = dto.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const existing = await this.tenants.findBySlug(slug);
    if (existing) {
      throw new ConflictError(`A tenant with name '${dto.name}' already exists`);
    }

    const tenant = Tenant.create(dto.name, dto.ownerUserId);
    return this.tenants.save(tenant);
  }

  async addMember(
    tenantId: number,
    actorUserId: string,
    newUserId: string,
    role: TenantRole,
  ): Promise<Tenant> {
    const tenant = await this.getTenant(tenantId);
    const updated = tenant.addMember(actorUserId, newUserId, role);
    return this.tenants.update(updated);
  }

  async removeMember(
    tenantId: number,
    actorUserId: string,
    targetUserId: string,
  ): Promise<Tenant> {
    const tenant = await this.getTenant(tenantId);
    const updated = tenant.removeMember(actorUserId, targetUserId);
    return this.tenants.update(updated);
  }

  async deleteTenant(id: number): Promise<void> {
    await this.getTenant(id);
    await this.tenants.delete(asTenantId(id));
  }

  async getSubscription(tenantId: number): Promise<{
    plan: TenantPlan;
    effectivePlan: TenantPlan;
    billingCycle: TenantBillingCycle | null;
    billingStatus: TenantBillingStatus;
    billingEmail: string | null;
    billingPaymentBrand: string | null;
    billingPaymentLast4: string | null;
    billingUpdatedAt: Date | null;
    pricing: typeof TenantService.PRICING;
  }> {
    const tenant = await this.getTenant(tenantId);
    return {
      plan: tenant.plan,
      effectivePlan: tenant.effectivePlan(),
      billingCycle: tenant.billingCycle,
      billingStatus: tenant.billingStatus,
      billingEmail: tenant.billingEmail,
      billingPaymentBrand: tenant.billingPaymentBrand,
      billingPaymentLast4: tenant.billingPaymentLast4,
      billingUpdatedAt: tenant.billingUpdatedAt,
      pricing: TenantService.PRICING,
    };
  }

  async activateProSubscription(
    tenantId: number,
    input: {
      billingCycle: TenantBillingCycle;
      billingEmail: string;
      billingPaymentBrand: string;
      billingPaymentLast4: string;
    },
  ): Promise<Tenant> {
    const tenant = await this.getTenant(tenantId);
    const updated = tenant.activateProSubscription(input);
    return this.tenants.update(updated);
  }

  async downgradeToFree(tenantId: number): Promise<Tenant> {
    const tenant = await this.getTenant(tenantId);
    const updated = tenant.downgradeToFree();
    return this.tenants.update(updated);
  }

  async setDefaultClaw(tenantId: number, clawId: number | null): Promise<Tenant> {
    const tenant = await this.getTenant(tenantId);
    const updated = tenant.setDefaultClaw(clawId);
    return this.tenants.update(updated);
  }
}
