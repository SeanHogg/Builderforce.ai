import { ITenantRepository } from '../../domain/tenant/ITenantRepository';
import { Tenant } from '../../domain/tenant/Tenant';
import {
  TenantRole,
  TenantPlan,
  TenantBillingCycle,
  TenantBillingStatus,
  asTenantId,
} from '../../domain/shared/types';
import { NotFoundError, ConflictError, ValidationError } from '../../domain/shared/errors';
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
    teams: {
      perSeatMonthly: 20,
      perSeatYearly: 192,   // $16/seat/mo billed yearly — 20% off
      yearlySavingsPercent: 20,
      minimumSeats: 1,
    },
    managedClaw: {
      perClawMonthly: 49,
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
    seatCount: number | null;
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
      seatCount: tenant.seatCount,
      pricing: TenantService.PRICING,
      paymentProvider: this.payment.name,
    };
  }

  /**
   * Initiate checkout for Pro or Teams plan.
   *
   * For the ManualProvider: activates immediately and returns checkoutUrl=null.
   * For hosted providers (Stripe): returns a URL to redirect the user to.
   * The subscription is finalised when the provider fires a webhook.
   */
  async createCheckoutSession(
    tenantId: number,
    input: {
      targetPlan?: TenantPlan.PRO | TenantPlan.TEAMS;
      billingCycle: TenantBillingCycle;
      billingEmail: string;
      /** Required for Teams plan */
      seats?: number;
      /** For manual provider only — optional card details entered by user */
      billingPaymentBrand?: string;
      billingPaymentLast4?: string;
      successUrl: string;
      cancelUrl: string;
    },
  ): Promise<{ checkoutUrl: string | null; sessionId: string }> {
    const targetPlan = input.targetPlan ?? TenantPlan.PRO;

    if (targetPlan === TenantPlan.TEAMS) {
      const seats = input.seats ?? 1;
      if (seats < 1) throw new ValidationError('Teams plan requires at least 1 seat');
    }

    const tenant = await this.getTenant(tenantId);
    const seats = input.seats ?? 1;

    const result = await this.payment.createCheckoutSession({
      tenantId,
      targetPlan,
      billingCycle: input.billingCycle,
      billingEmail: input.billingEmail,
      seats: targetPlan === TenantPlan.TEAMS ? seats : 1,
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
    });

    if (result.checkoutUrl === null) {
      // ManualProvider — activate immediately with the user-supplied card details
      const activated = targetPlan === TenantPlan.TEAMS
        ? tenant.activateTeamsSubscription({
            seats,
            billingCycle: input.billingCycle,
            billingEmail: input.billingEmail,
            billingPaymentBrand: input.billingPaymentBrand ?? 'card',
            billingPaymentLast4: input.billingPaymentLast4 ?? '',
            externalCustomerId: result.externalCustomerId,
            externalSubscriptionId: result.externalSubscriptionId,
          })
        : tenant.activateProSubscription({
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
        const billingCycle = event.billingCycle ?? (tenant.billingCycle ?? TenantBillingCycle.MONTHLY);
        const billingEmail = event.billingEmail ?? tenant.billingEmail ?? '';
        const paymentBrand = event.paymentBrand ?? tenant.billingPaymentBrand ?? 'card';
        const paymentLast4 = event.paymentLast4 ?? tenant.billingPaymentLast4 ?? '';

        const updated = event.targetPlan === TenantPlan.TEAMS
          ? tenant.activateTeamsSubscription({
              seats: event.seats ?? tenant.seatCount ?? 1,
              billingCycle,
              billingEmail,
              billingPaymentBrand: paymentBrand,
              billingPaymentLast4: paymentLast4,
              externalCustomerId: event.externalCustomerId,
              externalSubscriptionId: event.externalSubscriptionId,
            })
          : tenant.activateProSubscription({
              billingCycle,
              billingEmail,
              billingPaymentBrand: paymentBrand,
              billingPaymentLast4: paymentLast4,
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
