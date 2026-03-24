import {
  TenantId,
  TenantStatus,
  TenantRole,
  TenantPlan,
  TenantBillingCycle,
  TenantBillingStatus,
} from '../shared/types';
import { ValidationError, ForbiddenError } from '../shared/errors';

export interface TenantMemberProps {
  userId: string;
  role: TenantRole;
  isActive: boolean;
  joinedAt: Date;
}

export interface TenantProps {
  id: TenantId;
  name: string;
  slug: string;
  status: TenantStatus;
  defaultClawId: number | null;
  plan: TenantPlan;
  billingCycle: TenantBillingCycle | null;
  billingStatus: TenantBillingStatus;
  billingEmail: string | null;
  billingPaymentBrand: string | null;
  billingPaymentLast4: string | null;
  billingUpdatedAt: Date | null;
  /** Provider-assigned customer ID (e.g. Stripe cus_... or Helcim customerCode) */
  externalCustomerId: string | null;
  /** Provider-assigned subscription ID (e.g. Stripe sub_... or Helcim transactionId) */
  externalSubscriptionId: string | null;
  /** Number of paid seats for Teams plan; null for Free/Pro */
  seatCount: number | null;
  members: TenantMemberProps[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Tenant aggregate root.
 *
 * Encapsulates multi-tenant isolation: a Tenant owns Projects.
 * Members are entities owned by the Tenant aggregate.
 */
export class Tenant {
  private constructor(private readonly props: TenantProps) {}

  // ------------------------------------------------------------------
  // Factory methods
  // ------------------------------------------------------------------

  static create(
    name: string,
    ownerUserId: string,
  ): Tenant {
    if (!name.trim()) throw new ValidationError('Tenant name is required');

    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const now = new Date();

    return new Tenant({
      id: 0 as TenantId,
      name: name.trim(),
      slug,
      status: TenantStatus.ACTIVE,
      defaultClawId: null,
      plan: TenantPlan.FREE,
      billingCycle: null,
      billingStatus: TenantBillingStatus.NONE,
      billingEmail: null,
      billingPaymentBrand: null,
      billingPaymentLast4: null,
      billingUpdatedAt: null,
      externalCustomerId: null,
      externalSubscriptionId: null,
      seatCount: null,
      members: [
        { userId: ownerUserId, role: TenantRole.OWNER, isActive: true, joinedAt: now },
      ],
      createdAt: now,
      updatedAt: now,
    });
  }

  static reconstitute(props: TenantProps): Tenant {
    return new Tenant(props);
  }

  // ------------------------------------------------------------------
  // Accessors
  // ------------------------------------------------------------------

  get id(): TenantId { return this.props.id; }
  get name(): string { return this.props.name; }
  get slug(): string { return this.props.slug; }
  get status(): TenantStatus { return this.props.status; }
  get defaultClawId(): number | null { return this.props.defaultClawId; }
  get plan(): TenantPlan { return this.props.plan; }
  get billingCycle(): TenantBillingCycle | null { return this.props.billingCycle; }
  get billingStatus(): TenantBillingStatus { return this.props.billingStatus; }
  get billingEmail(): string | null { return this.props.billingEmail; }
  get billingPaymentBrand(): string | null { return this.props.billingPaymentBrand; }
  get billingPaymentLast4(): string | null { return this.props.billingPaymentLast4; }
  get billingUpdatedAt(): Date | null { return this.props.billingUpdatedAt; }
  get externalCustomerId(): string | null { return this.props.externalCustomerId; }
  get externalSubscriptionId(): string | null { return this.props.externalSubscriptionId; }
  get seatCount(): number | null { return this.props.seatCount; }
  get members(): readonly TenantMemberProps[] { return this.props.members; }
  get createdAt(): Date { return this.props.createdAt; }
  get updatedAt(): Date { return this.props.updatedAt; }

  // ------------------------------------------------------------------
  // Behaviour
  // ------------------------------------------------------------------

  getMember(userId: string): TenantMemberProps | undefined {
    return this.props.members.find(m => m.userId === userId && m.isActive);
  }

  canManageMembers(actorUserId: string): boolean {
    const member = this.getMember(actorUserId);
    return member?.role === TenantRole.OWNER || member?.role === TenantRole.MANAGER;
  }

  addMember(actorUserId: string, newUserId: string, role: TenantRole): Tenant {
    if (!this.canManageMembers(actorUserId)) {
      throw new ForbiddenError('Only owners and managers can add members');
    }
    if (this.getMember(newUserId)) {
      throw new ValidationError(`User '${newUserId}' is already a member`);
    }
    return new Tenant({
      ...this.props,
      members: [
        ...this.props.members,
        { userId: newUserId, role, isActive: true, joinedAt: new Date() },
      ],
      updatedAt: new Date(),
    });
  }

  removeMember(actorUserId: string, targetUserId: string): Tenant {
    if (!this.canManageMembers(actorUserId)) {
      throw new ForbiddenError('Only owners and managers can remove members');
    }
    return new Tenant({
      ...this.props,
      members: this.props.members.map(m =>
        m.userId === targetUserId ? { ...m, isActive: false } : m,
      ),
      updatedAt: new Date(),
    });
  }

  suspend(): Tenant {
    return new Tenant({ ...this.props, status: TenantStatus.SUSPENDED, updatedAt: new Date() });
  }

  setDefaultClaw(clawId: number | null): Tenant {
    return new Tenant({
      ...this.props,
      defaultClawId: clawId,
      updatedAt: new Date(),
    });
  }

  hasActiveBilling(): boolean {
    return this.props.billingStatus === TenantBillingStatus.ACTIVE;
  }

  effectivePlan(): TenantPlan {
    if (!this.hasActiveBilling()) return TenantPlan.FREE;
    if (this.props.plan === TenantPlan.TEAMS) return TenantPlan.TEAMS;
    if (this.props.plan === TenantPlan.PRO) return TenantPlan.PRO;
    return TenantPlan.FREE;
  }

  activateProSubscription(input: {
    billingCycle: TenantBillingCycle;
    billingEmail: string;
    billingPaymentBrand: string;
    billingPaymentLast4: string;
    externalCustomerId?: string | null;
    externalSubscriptionId?: string | null;
  }): Tenant {
    if (!input.billingEmail.trim()) {
      throw new ValidationError('billingEmail is required for Pro plan');
    }
    // For manual provider the last4 is entered by the user (must be 4 digits).
    // For hosted providers it arrives from the webhook (may be empty string initially).
    if (input.billingPaymentLast4 && !/^[0-9]{4}$/.test(input.billingPaymentLast4)) {
      throw new ValidationError('billingPaymentLast4 must be 4 digits');
    }

    return new Tenant({
      ...this.props,
      plan: TenantPlan.PRO,
      billingCycle: input.billingCycle,
      billingStatus: TenantBillingStatus.ACTIVE,
      billingEmail: input.billingEmail.trim().toLowerCase(),
      billingPaymentBrand: input.billingPaymentBrand.trim() || 'card',
      billingPaymentLast4: input.billingPaymentLast4,
      billingUpdatedAt: new Date(),
      externalCustomerId: input.externalCustomerId ?? this.props.externalCustomerId,
      externalSubscriptionId: input.externalSubscriptionId ?? this.props.externalSubscriptionId,
      updatedAt: new Date(),
    });
  }

  activateTeamsSubscription(input: {
    seats: number;
    billingCycle: TenantBillingCycle;
    billingEmail: string;
    billingPaymentBrand: string;
    billingPaymentLast4: string;
    externalCustomerId?: string | null;
    externalSubscriptionId?: string | null;
  }): Tenant {
    if (!input.billingEmail.trim()) {
      throw new ValidationError('billingEmail is required for Teams plan');
    }
    if (input.seats < 1) {
      throw new ValidationError('Teams plan requires at least 1 seat');
    }

    return new Tenant({
      ...this.props,
      plan: TenantPlan.TEAMS,
      billingCycle: input.billingCycle,
      billingStatus: TenantBillingStatus.ACTIVE,
      billingEmail: input.billingEmail.trim().toLowerCase(),
      billingPaymentBrand: input.billingPaymentBrand.trim() || 'card',
      billingPaymentLast4: input.billingPaymentLast4,
      billingUpdatedAt: new Date(),
      seatCount: input.seats,
      externalCustomerId: input.externalCustomerId ?? this.props.externalCustomerId,
      externalSubscriptionId: input.externalSubscriptionId ?? this.props.externalSubscriptionId,
      updatedAt: new Date(),
    });
  }

  updateSeatCount(seats: number): Tenant {
    if (this.props.plan !== TenantPlan.TEAMS) {
      throw new ValidationError('Seat count can only be changed on a Teams plan');
    }
    if (seats < 1) throw new ValidationError('Seat count must be at least 1');
    return new Tenant({ ...this.props, seatCount: seats, updatedAt: new Date() });
  }

  /**
   * Update external provider IDs without changing subscription status.
   * Called when a checkout session is created before the webhook arrives.
   */
  setExternalIds(externalCustomerId: string | null, externalSubscriptionId: string | null): Tenant {
    return new Tenant({
      ...this.props,
      externalCustomerId: externalCustomerId ?? this.props.externalCustomerId,
      externalSubscriptionId: externalSubscriptionId ?? this.props.externalSubscriptionId,
      updatedAt: new Date(),
    });
  }

  downgradeToFree(): Tenant {
    return new Tenant({
      ...this.props,
      plan: TenantPlan.FREE,
      billingCycle: null,
      billingStatus: TenantBillingStatus.NONE,
      billingUpdatedAt: new Date(),
      seatCount: null,
      updatedAt: new Date(),
    });
  }

  markBillingInactive(status: TenantBillingStatus.PAST_DUE | TenantBillingStatus.CANCELLED): Tenant {
    return new Tenant({
      ...this.props,
      billingStatus: status,
      billingUpdatedAt: new Date(),
      updatedAt: new Date(),
    });
  }

  toPlain(): TenantProps {
    return { ...this.props, members: [...this.props.members] };
  }
}
