import {
  TenantId,
  TenantStatus,
  TenantRole,
  TenantPlan,
  TenantBillingCycle,
  TenantBillingStatus,
} from '../shared/types';
import { ValidationError, ForbiddenError } from '../shared/errors';
import { resolveEffectivePlan, TRIAL_DURATION_DAYS } from './effectivePlan';

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
  defaultAgentHostId: number | null;
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
  /** When the introductory Pro trial ends; null when not (and never) trialing. */
  trialEndsAt: Date | null;
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
    slugOverride?: string,
  ): Tenant {
    if (!name.trim()) throw new ValidationError('Tenant name is required');

    // Slug is globally unique. Callers that must guarantee uniqueness (e.g. the
    // auto-provisioned "Default" workspace, whose display name collides across
    // every new user) pass a pre-resolved slug; otherwise derive it from the name.
    const slug = slugOverride?.trim()
      ? slugOverride.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')
      : name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const now = new Date();
    // Every new workspace starts on a 14-day Pro trial: plan=Pro + status=trialing
    // + trial_ends_at = now + 14d. effectivePlan() yields Pro limits until it lapses,
    // then falls back to Free automatically (resolveEffectivePlan is time-based).
    const trialEndsAt = new Date(now.getTime() + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000);

    return new Tenant({
      id: 0 as TenantId,
      name: name.trim(),
      slug,
      status: TenantStatus.ACTIVE,
      defaultAgentHostId: null,
      plan: TenantPlan.PRO,
      billingCycle: null,
      billingStatus: TenantBillingStatus.TRIALING,
      billingEmail: null,
      billingPaymentBrand: null,
      billingPaymentLast4: null,
      billingUpdatedAt: null,
      externalCustomerId: null,
      externalSubscriptionId: null,
      seatCount: null,
      trialEndsAt,
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
  get defaultAgentHostId(): number | null { return this.props.defaultAgentHostId; }
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
  get trialEndsAt(): Date | null { return this.props.trialEndsAt; }
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
    // Granting OWNER is owner-only — mirrors changeMemberRole so a MANAGER can't
    // escalate a new member (or themselves via a re-add) to OWNER.
    if (role === TenantRole.OWNER && this.getMember(actorUserId)?.role !== TenantRole.OWNER) {
      throw new ForbiddenError('Only an owner can assign the owner role');
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

  /**
   * Change an existing active member's role. Owners and managers may manage
   * roles, but only an owner may grant or alter the OWNER role, and the last
   * remaining owner can never be demoted (the workspace must always have one).
   */
  changeMemberRole(actorUserId: string, targetUserId: string, role: TenantRole): Tenant {
    if (!this.canManageMembers(actorUserId)) {
      throw new ForbiddenError('Only owners and managers can change member roles');
    }
    const actor  = this.getMember(actorUserId);
    const target = this.getMember(targetUserId);
    if (!target) throw new ValidationError(`User '${targetUserId}' is not an active member`);

    // Granting OWNER, or touching an existing owner's role, is owner-only.
    if ((role === TenantRole.OWNER || target.role === TenantRole.OWNER) && actor?.role !== TenantRole.OWNER) {
      throw new ForbiddenError('Only an owner can assign or change the owner role');
    }
    // The workspace must always retain at least one owner.
    if (target.role === TenantRole.OWNER && role !== TenantRole.OWNER) {
      const owners = this.props.members.filter(m => m.isActive && m.role === TenantRole.OWNER);
      if (owners.length <= 1) {
        throw new ValidationError('Cannot demote the last owner — promote another member to owner first');
      }
    }
    if (target.role === role) return this;

    return new Tenant({
      ...this.props,
      members: this.props.members.map(m =>
        m.userId === targetUserId && m.isActive ? { ...m, role } : m,
      ),
      updatedAt: new Date(),
    });
  }

  /**
   * Rename the workspace. Only owners and managers may do so.
   * The slug is intentionally left unchanged so existing URLs / references stay stable.
   */
  rename(actorUserId: string, name: string): Tenant {
    if (!this.canManageMembers(actorUserId)) {
      throw new ForbiddenError('Only owners and managers can rename a workspace');
    }
    const trimmed = name.trim();
    if (!trimmed) throw new ValidationError('Tenant name is required');
    if (trimmed === this.props.name) return this;
    return new Tenant({ ...this.props, name: trimmed, updatedAt: new Date() });
  }

  suspend(): Tenant {
    return new Tenant({ ...this.props, status: TenantStatus.SUSPENDED, updatedAt: new Date() });
  }

  setDefaultAgentHost(agentHostId: number | null): Tenant {
    return new Tenant({
      ...this.props,
      defaultAgentHostId: agentHostId,
      updatedAt: new Date(),
    });
  }

  hasActiveBilling(): boolean {
    return this.props.billingStatus === TenantBillingStatus.ACTIVE;
  }

  /**
   * The plan whose limits this tenant is entitled to right now — paid `active`,
   * an unexpired Pro trial, or Free once the trial lapses. Delegates to the one
   * shared resolver so the gateway + plan-limits guard never drift from this.
   */
  effectivePlan(now: Date = new Date()): TenantPlan {
    return resolveEffectivePlan(
      { plan: this.props.plan, billingStatus: this.props.billingStatus, trialEndsAt: this.props.trialEndsAt },
      now,
    );
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
      // Converting from trial → paid: the trial is consumed.
      trialEndsAt: null,
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
      // Converting from trial → paid: the trial is consumed.
      trialEndsAt: null,
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
      // The trial (if any) is over once explicitly downgraded.
      trialEndsAt: null,
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
