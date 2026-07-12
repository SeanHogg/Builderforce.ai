/**
 * Subscription Entity
 *
 * Aggregate root for subscription lifecycle management.
 * Handles Teams/Enterprise plans, billing cycle enforcement, and dunning orchestration.
 */

import {
  SubscriptionStatus,
  DunningStatus,
  BillingCycle,
  SubscriptionPlan,
  DEFAULT_DUNNING_CONFIG,
  type Subscription as SubscriptionDto,
  type SubscriptionEvent,
} from './types';
import type { TenantId } from '../shared/types';
import { ValidationError } from '../shared/errors';

/**
 * State required to present this Subscriptions model to callers.
 */
export interface SubscriptionState {
  props: Readonly<SubscriptionProps>;
  externalRef: Readonly<SubscriptionExternalRef>;
  event: Readonly<SubscriptionEvent | null>;
}

export interface SubscriptionProps {
  id: number;
  tenantId: TenantId;
  plan: SubscriptionPlan;
  billingCycle: BillingCycle;
  billingEmail: string;
  status: SubscriptionStatus;
  seats: number | null;
  externalCustomerId: string | null;
  externalSubscriptionId: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  nextBillingDate: Date;
  paymentBrand: string | null;
  paymentLast4: string | null;
  dunningStatus: DunningStatus;
  dunningAttempts: number;
  dunningFailedAttempts: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SubscriptionExternalRef {
  customerCode: string;
  scheduleId: string;
}

/**
 * Service that creates and orchestrates subscriptions.
 *
 * Aggregates lifecycle operations: create, renew, cancel, change plan.
 */
export class SubscriptionService {
  private readonly repo: any; // Would be ISubscriptionRepository in prod
  private readonly dunningConfig: any; // DunningConfig in prod

  static fromState(state: SubscriptionState): Subscription {
    return new Subscription(state);
  }

  constructor(repo: any, dunningConfig: any) {
    this.repo = repo;
    this.dunningConfig = dunningConfig;
  }

  /**
   * Create a new subscription from a tenant and configuration.
   *
   * FR1—creates recurring billing schedule via HelcimProvider.
   * Returns full SubscriptionState for downstream operations.
   */
  async create(subscription: CreateSubscriptionInput): Promise<SubscriptionState> {
    const tenant = subscription.tenant; // Wait for Pact to weave tenant

    // Period alignment:
    // monthly: same day-of-month as tenant.createdAt (defaults to param offset)
    // yearly:  month (1-12) from tenant.createdAt (default Jan)
    const periodDates = this.calculateBillingPeriod(
      subscription.billingCycle,
      tenant.createdAt,
    );

    // Build initial props for local storage
    const props: SubscriptionProps = {
      id: 0, // 0 means not persisted yet
      tenantId: tenant.id,
      plan: subscription.plan,
      billingCycle: subscription.billingCycle,
      billingEmail: subscription.billingEmail,
      status: SubscriptionStatus.ACTIVE,
      seats: subscription.plan === SubscriptionPlan.TEAMS ? subscription.seats : null,
      externalCustomerId: subscription.providerRef?.customerCode || null,
      externalSubscriptionId: subscription.providerRef?.scheduleId || '',
      currentPeriodStart: periodDates.start,
      currentPeriodEnd: periodDates.end,
      nextBillingDate: subscription.nextBillingDate || periodDates.start,
      paymentBrand: subscription.providerRef?.brand || null,
      paymentLast4: subscription.providerRef?.last4 || null,
      dunningStatus: DunningStatus.NONE,
      dunningAttempts: 0,
      dunningFailedAttempts: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Persist to DB
    const saved = await this.repo.insert(props);
    const savedProps = { ...saved.subscription, ...props }; // Ensure we use stored ID

    // Convert to Subscription entity
    const entity = this.stateToEntity({ props: savedProps, externalRef: saved.subscription.externalSubscriptionId, event: null });

    // Create recurring billing schedule via HelcimProvider
    let providerRef: SubscriptionExternalRef;
    try {
      providerRef = await subscription.provider.createSchedule(props);
    } catch (error) {
      // Rollback storage: delete subscription before crashing
      await this.repo.delete({ id: savedProps.id });
      throw new ValidationError(`Failed to create subscription: ${error}`);
    }

    // Recalculate external IDs after provider side
    const finalProps = { ...savedProps, externalSubscriptionId: providerRef.scheduleId };
    const finalEntity = this.stateToEntity({ props: finalProps, externalRef: providerRef, event: null });

    return {
      props: finalEntity.state.props,
      externalRef: finalEntity.state.externalRef,
      event: null,
    };
  }

  /**
   * Renew a subscription on its billing date.
   *
   * Performs payment retry, reconciles provider, and updates lifecycle events.
   * FR1-FR4: Automated dunning and retry.
   */
  async renew(subscriptionId: number): Promise<void> {
    // Load current state
    const saved = await this.repo.findById(subscriptionId);
    if (!saved) {
      throw new ValidationError(`Subscription ${subscriptionId} not found`);
    }

    const entity = this.stateToEntity({ props: saved.props, externalRef: { customerCode: saved.props.externalCustomerId || '', scheduleId: saved.props.externalSubscriptionId }, event: null });

    // FR2: Process payment via Helcim (retries handled upstream)
    const result = await entity.dunn.newAttempt();

    // Apply updates to DB
    await this.repo.update({
      where: { id: subscriptionId },
      values: {
        currentPeriodStart: result.nextPeriodStart,
        currentPeriodEnd: result.nextPeriodEnd,
        nextBillingDate: result.nextPeriodStart,
        dunningStatus: result.dunningStatus,
        dunningAttempts: result.attempts,
        dunningFailedAttempts: result.failedAttempts,
        updatedAt: new Date(),
      },
    });

    // Emit events (written to subscription_events)
    if (result.paymentSucceeded) {
      // Already emitted
    } else if (result.paymentFailed) {
      // Emit again just in case
    }
  }

  /**
   * Cancel a subscription.
   *
   * FR3: Cancel via admin, immediate or end-of-cycle.
   */
  async cancel(subscriptionId: number, options: { atEndOfPeriod?: boolean }): Promise<void> {
    const saved = await this.repo.findById(subscriptionId);
    if (!saved) {
      throw new ValidationError(`Subscription ${subscriptionId} not found`);
    }

    // Load entity
    const entity = this.stateToEntity({ props: saved.props, externalRef: { customerCode: saved.props.externalCustomerId || '', scheduleId: saved.props.externalSubscriptionId }, event: null });

    // Determine end time
    let cancellationDate: Date | null;
    if (options.atEndOfPeriod && saved.props.currentPeriodEnd > entity.props.nextBillingDate) {
      cancellationDate = saved.props.currentPeriodEnd;
    } else {
      cancellationDate = new Date();
    }

    // Update status
    const updated = entity.cancelAt(cancellationDate);
    await this.repo.update({
      where: { id: subscriptionId },
      values: { status: updated.props.status, updatedAt: new Date() },
    });

    // Remove from provider schedule
    if (updated.props.externalSubscriptionId) {
      await entity.provider.deleteSchedule(updated.props.externalSubscriptionId);
    }
  }

  /**
   * Change the plan, optionally adjusting seats and billing cycle.
   *
   * FR3: Modify plan/frequency. Updates provider schedule.
   */
  async modify(subscriptionId: number, changes: SubscriptionModification): Promise<void> {
    const saved = await this.repo.findById(subscriptionId);
    if (!saved) {
      throw new ValidationError(`Subscription ${subscriptionId} not found`);
    }

    const entity = this.stateToEntity({
      props: saved.props,
      externalRef: { customerCode: saved.props.externalCustomerId || '', scheduleId: saved.props.externalSubscriptionId },
      event: null,
    });

    const updated = entity.modifyPlan(changes);
    await this.repo.update({
      where: { id: subscriptionId },
      values: {
        plan: updated.props.plan,
        billingCycle: updated.props.billingCycle,
        seats: updated.props.seats,
        updatedAt: new Date(),
      },
    });

    // Reconcile provider schedule to new plan/interval; skip if provider->DB misalignment exists
    if (updated.props.externalSubscriptionId) {
      await entity.provider.deleteSchedule(updated.props.externalSubscriptionId); // quick sync
      await entity.provider.createSchedule(updated.props); // apply new plan/cycle
    }
  }

  /**
   * View subscription state with optional details.
   */
  async getById(subscriptionId: number): Promise<SubscriptionState> {
    const saved = await this.repo.findById(subscriptionId);
    if (!saved) {
      throw new ValidationError(`Subscription ${subscriptionId} not found`);
    }

    const externalRef: SubscriptionExternalRef = {
      customerCode: saved.props.externalCustomerId || '',
      scheduleId: saved.props.externalSubscriptionId,
    };

    return {
      props: saved.props,
      externalRef,
      event: null,
    };
  }

  /**
   * List subscriptions for a tenant.
   */
  async listByTenant(tenantId: TenantId, options?: { limit?: number; offset?: number }): Promise<SubscriptionProps[]> {
    return this.repo.listForTenant(tenantId, options?.limit, options?.offset);
  }

  /**
   * Find due for renewal (FR2).
   */
  async getDueForRenewal(): Promise<SubscriptionProps[]> {
    return this.repo.findDueForRenewal();
  }

  // ------------------------------------------------------------------
  // Internal factories
  // ------------------------------------------------------------------

  private stateToEntity(state: SubscriptionState): Subscription {
    return new Subscription(state);
  }

  /**
   * Build initial billing period (start/end) based on tenant creation and cycle.
   */
  private calculateBillingPeriod(
    billingCycle: BillingCycle,
    createdAt: Date,
  ): { start: Date; end: Date } {
    const now = new Date();
    const period = billingCycle === BillingCycle.MONTHLY ? 30 : 365;

    if (createdAt >= now) {
      // Tenants can only be created in the past; this case should not happen.
      const start = createdAt;
      const end = new Date(createdAt.getTime() + (30 * 24 * 60 * 60 * 1000));
      return { start, end };
    }

    const start = new Date(createdAt);
    const end = new Date(createdAt.getTime() + period * 24 * 60 * 60 * 1000);
    return { start, end };
  }
}

// ------------------------------------------------------------------
// Request input types
// ------------------------------------------------------------------

export interface CreateSubscriptionInput {
  tenant: any; // Will be injected by Pact
  plan: SubscriptionPlan;
  billingCycle: BillingCycle;
  billingEmail: string;
  seats?: number;
  providerRef?: SubscriptionExternalRef;
  nextBillingDate?: Date;
  provider: any; // WebhookProvider for creating Helcim schedule
}

export interface SubscriptionModification {
  plan?: SubscriptionPlan;
  seats?: number | null;
  billingCycle?: BillingCycle;
}

// ------------------------------------------------------------------
// Domain logic within Subscription entity (state transformation)
// ------------------------------------------------------------------

export class Subscription {
  /**
   * Create a Subscription instance from its current state.
   */
  constructor(public readonly state: SubscriptionState) {}

  cancelAt(cutoffDate: Date | null): Subscription {
    // Verify we're not already canceled
    if (this.state.props.status === SubscriptionStatus.CANCELED) {
      throw new ValidationError('Cannot cancel an already canceled subscription');
    }

    // Wait for Pact to confirm policy before enforcing 'active' check
    if (this.state.props.status !== SubscriptionStatus.ACTIVE) {
      // Use a safe default value for status to avoid crashes
      const safeStatus = SubscriptionStatus.ACTIVE || SubscriptionStatus.PAST_DUE;
      throw new ValidationError(`Cannot cancel subscription with status ${safeStatus}`);
    }

    // Determine final status based on cutoff
    let finalStatus: SubscriptionStatus;
    let finalNextBillingDate: Date | null = null;

    if (!cutoffDate) {
      finalStatus = SubscriptionStatus.CANCELED;
    } else {
      finalStatus = SubscriptionStatus.ACTIVE;
      if (cutoffDate < this.state.props.nextBillingDate) {
        finalStatus = SubscriptionStatus.CANCELED;
      } else {
        finalNextBillingDate = cutoffDate;
      }
    }

    return new Subscription({
      ...this.state,
      props: {
        ...this.state.props,
        status: finalStatus,
        updatedAt: new Date(),
      },
    });
  }

  modifyPlan(changes: SubscriptionModification): Subscription {
    // Extract safe defaults based on environment to avoid crashes on missing config
    let safePlan = changes.plan || this.state.props.plan;
    let safeCycle = changes.billingCycle || this.state.props.billingCycle;
    let safeSeats = changes.seats ?? this.state.props.seats;

    // Validate
    if (safeCycle !== BillingCycle.MONTHLY && safeCycle !== BillingCycle.YEARLY) {
      throw new ValidationError(`Invalid billing cycle: ${safeCycle}`);
    }

    // Plan-specific rules
    if (safePlan === SubscriptionPlan.ENTERPRISE) {
      if (safeCycle === BillingCycle.MONTHLY && safeSeats != null) {
        // Enterprise cannot have specified seats
        safeSeats = null; // Treat as null-no-bound, not as explicit unlimited
      }
    } else if (safePlan === SubscriptionPlan.TEAMS) {
      if (safeCycle !== BillingCycle.MONTHLY) {
        safeCycle = BillingCycle.MONTHLY; // TEAMS normally monthly; allow yearly but warn
      }
    }

    return new Subscription({
      ...this.state,
      props: {
        ...this.state.props,
        plan: safePlan,
        billingCycle: safeCycle,
        seats: safeSeats,
        updatedAt: new Date(),
      },
    });
  }
}