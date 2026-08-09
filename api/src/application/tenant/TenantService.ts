import { reportCaughtError } from '../observability/caughtErrorReporter';
import { ITenantRepository } from '../../domain/tenant/ITenantRepository';
import { Tenant } from '../../domain/tenant/Tenant';
import {
  TenantRole,
  TenantPlan,
  TenantBillingCycle,
  TenantBillingStatus,
  asTenantId,
} from '../../domain/shared/types';
import { NotFoundError, ValidationError } from '../../domain/shared/errors';
import { trialDaysRemaining } from '../../domain/tenant/effectivePlan';
import type { PaymentProvider, WebhookEvent } from '../../infrastructure/payment/PaymentProvider';
import { PLAN_LIMITS } from '../../domain/tenant/PlanLimits';
import { membershipChanged } from './membershipChanged';
import type { Env } from '../../env';

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
    /**
     * Present so a membership use case can announce itself (see
     * {@link membershipChanged}). Optional because the unit tests construct this
     * service without a worker environment, and a missing cache binding must not
     * be the reason a member cannot be added.
     */
    private readonly env?: Env,
  ) {}

  /** Every membership use case ends here — see `membershipChanged`. */
  private async announceMembership(tenantId: number, userIds: readonly string[] = []): Promise<void> {
    if (!this.env) return;
    await membershipChanged(this.env, tenantId, userIds);
  }

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
      // Teams is priced BELOW Pro per seat ($20 vs $29) as org-wide volume
      // pricing — the discount is earned by committing to a seat block, not by
      // being a strictly-cheaper superset of Pro (which would read as a pricing
      // typo). The minimum makes that volume commitment explicit everywhere the
      // price is shown, and the checkout below enforces it server-side.
      minimumSeats: 5,
    },
    managedAgentHost: {
      perAgentHostMonthly: 49,
    },
  } as const;

  /**
   * Public pricing/entitlement contract used by marketing and checkout UI.
   * Prices come from PRICING and feature availability is derived from the same
   * PLAN_LIMITS object enforced by API guards, so public plan copy cannot drift
   * from runtime entitlements.
   */
  static publicPricingContract() {
    const free = PLAN_LIMITS[TenantPlan.FREE];
    const pro = PLAN_LIMITS[TenantPlan.PRO];
    const teams = PLAN_LIMITS[TenantPlan.TEAMS];
    const availability = (key: string, values: [boolean, boolean, boolean]) => ({
      key,
      free: values[0],
      pro: values[1],
      teams: values[2],
    });

    return {
      pricing: TenantService.PRICING,
      generatedFrom: 'TenantService.PRICING + PLAN_LIMITS',
      featureAvailability: [
        availability('agentHosts.free', [free.maxAgentHosts === 1, false, false]),
        availability('agentHosts.pro', [false, pro.maxAgentHosts === 3, false]),
        availability('agentHosts.teams', [false, false, teams.maxAgentHosts === -1]),
        availability('projects.free', [free.maxProjects === 5, false, false]),
        availability('projects.paid', [false, pro.maxProjects === -1, teams.maxProjects === -1]),
        availability('tokens.free', [free.tokenDailyLimit === 10_000, false, false]),
        availability('tokens.pro', [false, pro.tokenDailyLimit === 1_000_000, false]),
        availability('tokens.teams', [false, false, teams.tokenDailyLimit === 5_000_000]),
        availability('approvalWorkflows', [free.approvalWorkflows, pro.approvalWorkflows, teams.approvalWorkflows]),
        availability('fleetMesh', [free.fleetMesh, pro.fleetMesh, teams.fleetMesh]),
        availability('fullTelemetry', [free.fullTelemetry, pro.fullTelemetry, teams.fullTelemetry]),
        availability('customAgentRoles', [free.customAgentRoles, pro.customAgentRoles, teams.customAgentRoles]),
        availability('teamApprovalInbox', [free.teamApprovalInbox, pro.teamApprovalInbox, teams.teamApprovalInbox]),
        availability('seatCostControls', [free.seatCostControls, pro.seatCostControls, teams.seatCostControls]),
      ],
    } as const;
  }

  async listTenants(): Promise<Tenant[]> {
    return this.tenants.findAll();
  }

  /**
   * Full Tenant aggregates for the workspaces this user is a member of. Backs the
   * membership-scoped GET /api/tenants so a caller can never enumerate another
   * tenant's billing PII / roster by hitting the unscoped list. Reuses the same
   * repository query that powers the tenant picker (listTenantsForUser).
   */
  async listTenantsForUserFull(userId: string): Promise<Tenant[]> {
    return this.tenants.findByUserId(userId);
  }

  async listTenantsForUser(userId: string): Promise<Array<{
    id: number;
    name: string;
    slug: string;
    role: string;
    status: string;
    defaultAgentHostId: number | null;
    plan: TenantPlan;
    effectivePlan: TenantPlan;
    billingStatus: TenantBillingStatus;
    trialEndsAt: Date | null;
    trialDaysRemaining: number | null;
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
        defaultAgentHostId: t.defaultAgentHostId,
        plan: t.plan,
        effectivePlan: t.effectivePlan(),
        billingStatus: t.billingStatus,
        trialEndsAt: t.trialEndsAt,
        trialDaysRemaining: trialDaysRemaining(t.billingStatus, t.trialEndsAt),
      };
    });
  }

  async getTenant(id: number): Promise<Tenant> {
    const tenant = await this.tenants.findById(asTenantId(id));
    if (!tenant) throw new NotFoundError('Tenant', id);
    return tenant;
  }

  async createTenant(dto: CreateTenantDto): Promise<Tenant> {
    // Slugs are globally unique, but workspace NAMES are not meant to be — two
    // unrelated orgs (and, crucially, every new user's auto-provisioned "Default")
    // can share a display name. Resolve a free slug by suffixing instead of
    // rejecting the create, mirroring how project keys auto-disambiguate.
    const slug = await this.resolveUniqueSlug(dto.name);
    const tenant = Tenant.create(dto.name, dto.ownerUserId, slug);
    const saved = await this.tenants.save(tenant);
    // A workspace's FIRST member is created here, inside provisioning — which is
    // why "there is no insert(tenantMembers) outside the demo seeder" was true
    // and the roster still went stale.
    await this.announceMembership(saved.id as number, [dto.ownerUserId]);
    return saved;
  }

  /** Lowest free slug for a display name: `default`, then `default-2`, `default-3`… */
  private async resolveUniqueSlug(name: string): Promise<string> {
    const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'workspace';
    let slug = base;
    for (let i = 2; await this.tenants.findBySlug(slug); i++) {
      slug = `${base}-${i}`;
    }
    return slug;
  }

  async renameTenant(
    tenantId: number,
    actorUserId: string,
    name: string,
  ): Promise<Tenant> {
    const tenant = await this.getTenant(tenantId);
    const updated = tenant.rename(actorUserId, name);
    return this.tenants.update(updated);
  }

  async addMember(
    tenantId: number,
    actorUserId: string,
    newUserId: string,
    role: TenantRole,
  ): Promise<Tenant> {
    const tenant = await this.getTenant(tenantId);
    const updated = tenant.addMember(actorUserId, newUserId, role);
    const persisted = await this.tenants.update(updated);
    await this.announceMembership(tenantId, [newUserId]);
    return persisted;
  }

  async removeMember(
    tenantId: number,
    actorUserId: string,
    targetUserId: string,
  ): Promise<Tenant> {
    const tenant = await this.getTenant(tenantId);
    const updated = tenant.removeMember(actorUserId, targetUserId);
    const persisted = await this.tenants.update(updated);
    await this.announceMembership(tenantId, [targetUserId]);
    return persisted;
  }

  async changeMemberRole(
    tenantId: number,
    actorUserId: string,
    targetUserId: string,
    role: TenantRole,
  ): Promise<Tenant> {
    const tenant = await this.getTenant(tenantId);
    const updated = tenant.changeMemberRole(actorUserId, targetUserId, role);
    const persisted = await this.tenants.update(updated);
    await this.announceMembership(tenantId, [targetUserId]);
    return persisted;
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
    externalCustomerId: string | null;
    externalSubscriptionId: string | null;
    seatCount: number | null;
    trialEndsAt: Date | null;
    trialDaysRemaining: number | null;
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
      externalCustomerId: tenant.externalCustomerId,
      externalSubscriptionId: tenant.externalSubscriptionId,
      seatCount: tenant.seatCount,
      trialEndsAt: tenant.trialEndsAt,
      trialDaysRemaining: trialDaysRemaining(tenant.billingStatus, tenant.trialEndsAt),
      pricing: TenantService.PRICING,
    };
  }

  /**
   * Initiate checkout for Pro or Teams plan. Returns the hosted Stripe Checkout URL to
   * redirect the user to; the plan is only ever activated later, by the signed webhook
   * confirming payment — never synchronously here, so no user input can grant a plan.
   */
  async createCheckoutSession(
    tenantId: number,
    input: {
      targetPlan?: TenantPlan.PRO | TenantPlan.TEAMS;
      billingCycle: TenantBillingCycle;
      billingEmail: string;
      /** Required for Teams plan */
      seats?: number;
      successUrl: string;
      cancelUrl: string;
      discount?: {
        id: string;
        code: string;
        percentOff: number;
        durationYears: number;
        redemptionId: string;
      };
      salesReferralId?: string;
    },
  ): Promise<{ checkoutUrl: string; sessionId: string }> {
    const targetPlan = input.targetPlan ?? TenantPlan.PRO;
    const minimumSeats = TenantService.PRICING.teams.minimumSeats;

    if (targetPlan === TenantPlan.TEAMS) {
      const requestedSeats = input.seats ?? minimumSeats;
      if (requestedSeats < minimumSeats) {
        throw new ValidationError(`Teams plan requires at least ${minimumSeats} seats`);
      }
    }

    const tenant = await this.getTenant(tenantId);
    // Teams enforces the volume-pricing minimum; Pro is single-seat.
    const seats = targetPlan === TenantPlan.TEAMS
      ? Math.max(input.seats ?? minimumSeats, minimumSeats)
      : (input.seats ?? 1);

    const result = await this.payment.createCheckoutSession({
      tenantId,
      targetPlan,
      billingCycle: input.billingCycle,
      billingEmail: input.billingEmail,
      seats: targetPlan === TenantPlan.TEAMS ? seats : 1,
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
      discount: input.discount,
      salesReferralId: input.salesReferralId,
    });

    // Store the customer id now so the activation webhook can correlate back to us.
    if (result.externalCustomerId) {
      const withIds = tenant.setExternalIds(result.externalCustomerId, result.externalSubscriptionId);
      await this.tenants.update(withIds);
    }

    return { checkoutUrl: result.checkoutUrl, sessionId: result.sessionId };
  }

  async createBusinessPhoneCheckoutSession(tenantId: number, input: {
    cartId: string;
    billingEmail: string;
    currency: string;
    activationCents: number;
    monthlyCents: number;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ checkoutUrl: string; sessionId: string }> {
    const tenant = await this.getTenant(tenantId);
    if (tenant.billingStatus !== TenantBillingStatus.ACTIVE || tenant.plan === TenantPlan.FREE) {
      throw new ValidationError('Business Phone requires an active Pro or Teams plan');
    }
    const result = await this.payment.createBusinessPhoneCheckoutSession({ tenantId, ...input });
    return { checkoutUrl: result.checkoutUrl, sessionId: result.sessionId };
  }

  /**
   * Process a normalised webhook event from the payment provider.
   * Called by the webhook route after signature verification.
   */
  async handleWebhookEvent(event: WebhookEvent): Promise<void> {
    // Add-on lifecycle is persisted by the webhook route in its own bounded context;
    // it must never mutate the workspace's base plan subscription.
    if (event.purchaseKind) return;
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
        reportCaughtError(err, { source: "application/tenant/TenantService.ts", operation: "downgradeToFree", context: { logMessage: '[payment] cancelSubscription failed:', details: err } });
      });
    }

    const updated = tenant.downgradeToFree();
    return this.tenants.update(updated);
  }

  async setDefaultAgentHost(tenantId: number, agentHostId: number | null): Promise<Tenant> {
    const tenant = await this.getTenant(tenantId);
    const updated = tenant.setDefaultAgentHost(agentHostId);
    return this.tenants.update(updated);
  }
}
