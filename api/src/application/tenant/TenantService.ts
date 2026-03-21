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
import type { PaymentProvider, WebhookEvent } from '../../infrastructure/payment/PaymentProvider';

export interface CreateTenantDto {
  name: string;
  ownerUserId: string;
}

/**
 * Application service: orchestrates Tenant use cases.
 */
export class TenantService {
  constructor(
    private readonly tenants: ITenantRepository,
    private readonly payment: PaymentProvider,
  ) {}

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

  /** Which payment provider is active (for informational display). */
  get paymentProviderName(): string {
    return this.payment.name;
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
    externalCustomerId: string | null;
    externalSubscriptionId: string | null;
    pricing: typeof TenantService.PRICING;
    paymentProvider: string;
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
      externalCustomerId: tenant.externalCustomerId,
      externalSubscriptionId: tenant.externalSubscriptionId,
      pricing: TenantService.PRICING,
      paymentProvider: this.payment.name,
    };
  }

  /**
   * Initiate checkout for the Pro plan.
   *
   * For the ManualProvider: activates immediately and returns checkoutUrl=null.
   * For hosted providers (Stripe, Helcim): returns a URL to redirect the user to.
   * The subscription is finalised when the provider fires a webhook.
   */
  async createCheckoutSession(
    tenantId: number,
    input: {
      billingCycle: TenantBillingCycle;
      billingEmail: string;
      /** For manual provider only — optional card details entered by user */
      billingPaymentBrand?: string;
      billingPaymentLast4?: string;
      successUrl: string;
      cancelUrl: string;
    },
  ): Promise<{ checkoutUrl: string | null; sessionId: string }> {
    const tenant = await this.getTenant(tenantId);

    const result = await this.payment.createCheckoutSession({
      tenantId,
      billingCycle: input.billingCycle,
      billingEmail: input.billingEmail,
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
    });

    if (result.checkoutUrl === null) {
      // ManualProvider — activate immediately with the user-supplied card details
      const activated = tenant.activateProSubscription({
        billingCycle: input.billingCycle,
        billingEmail: input.billingEmail,
        billingPaymentBrand: input.billingPaymentBrand ?? 'card',
        billingPaymentLast4: input.billingPaymentLast4 ?? '',
        externalCustomerId: result.externalCustomerId,
        externalSubscriptionId: result.externalSubscriptionId,
      });
      await this.tenants.update(activated);
    } else if (result.externalCustomerId) {
      // Hosted provider — store external IDs now; subscription activates via webhook
      const withIds = tenant.setExternalIds(result.externalCustomerId, result.externalSubscriptionId);
      await this.tenants.update(withIds);
    }

    return { checkoutUrl: result.checkoutUrl, sessionId: result.sessionId };
  }

  /**
   * Process a normalised webhook event from the payment provider.
   * Called by the webhook route after signature verification.
   */
  async handleWebhookEvent(event: WebhookEvent): Promise<void> {
    const tenant = await this.tenants.findByExternalCustomerId(event.externalCustomerId);
    if (!tenant) {
      // Unknown customer — could be a test event or a race condition; log and ignore
      console.warn(`[payment] webhook for unknown externalCustomerId: ${event.externalCustomerId}`);
      return;
    }

    switch (event.type) {
      case 'subscription.activated':
      case 'subscription.renewed':
      case 'payment.succeeded': {
        const updated = tenant.activateProSubscription({
          billingCycle: event.billingCycle ?? (tenant.billingCycle ?? TenantBillingCycle.MONTHLY),
          billingEmail: event.billingEmail ?? tenant.billingEmail ?? '',
          billingPaymentBrand: event.paymentBrand ?? tenant.billingPaymentBrand ?? 'card',
          billingPaymentLast4: event.paymentLast4 ?? tenant.billingPaymentLast4 ?? '',
          externalCustomerId: event.externalCustomerId,
          externalSubscriptionId: event.externalSubscriptionId,
        });
        await this.tenants.update(updated);
        break;
      }

      case 'subscription.past_due':
      case 'payment.failed': {
        const updated = tenant.markBillingInactive(TenantBillingStatus.PAST_DUE);
        await this.tenants.update(updated);
        break;
      }

      case 'subscription.cancelled': {
        const updated = tenant.downgradeToFree();
        await this.tenants.update(updated);
        break;
      }
    }
  }

  async downgradeToFree(tenantId: number): Promise<Tenant> {
    const tenant = await this.getTenant(tenantId);

    // Cancel with the provider if an active subscription exists
    if (tenant.externalSubscriptionId) {
      await this.payment.cancelSubscription(tenant.externalSubscriptionId).catch((err) => {
        // Log but don't block — the local state downgrade still proceeds
        console.error('[payment] cancelSubscription failed:', err);
      });
    }

    const updated = tenant.downgradeToFree();
    return this.tenants.update(updated);
  }

  async setDefaultClaw(tenantId: number, clawId: number | null): Promise<Tenant> {
    const tenant = await this.getTenant(tenantId);
    const updated = tenant.setDefaultClaw(clawId);
    return this.tenants.update(updated);
  }
}
