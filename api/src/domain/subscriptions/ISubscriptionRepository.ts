/**
 * Subscription Repository
 *
 * Defines the interface for subscription persistence operations.
 */

import type {
  CreateSubscription,
  UpdateSubscription,
  DunningMetrics,
} from './types';
import type { TenantId } from '../shared/types';

export interface SubscriptionProps {
  id: number;
  tenantId: number;
  plan: 'TEAMS' | 'ENTERPRISE';
  billingCycle: 'MONTHLY' | 'YEARLY';
  billingEmail: string;
  status: 'active' | 'past_due' | 'canceled' | 'trialing' | 'suspended';
  seats: number | null;
  externalCustomerId: string | null;
  externalSubscriptionId: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  nextBillingDate: Date;
  paymentBrand: string | null;
  paymentLast4: string | null;
  dunningStatus: 'none' | 'pending_retry' | 'action_required';
  dunningAttempts: number;
  dunningFailedAttempts: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SubscriptionState {
  props: SubscriptionProps;
}

export interface CreateMutation {
  subscription: SubscriptionProps;
}

export interface UpdateMutation {
  where: { id: number };
  values: Partial<SubscriptionProps>;
}

/**
 * Repository that saves and retrieves Subscription entities.
 *
 * Projection suitable for subscription management use cases:
 * - tenant lookup for admins
 * - next_billing_date filtering for renewals
 * - status/plan indexing for dashboards
 */
export interface ISubscriptionRepository {
  /**
   * Get a subscription by its internal database ID.
   */
  findById(id: number): Promise<SubscriptionState | null>;

  /**
   * Find subscriptions by tenant ID.
   */
  findByTenantId(tenantId: TenantId): Promise<SubscriptionProps[]>;

  /**
   * Find subscriptions due for renewal.
   *
   * Returns active subscriptions with nextBillingDate <= now.
   */
  findDueForRenewal(): Promise<SubscriptionProps[]>;

  /**
   * Find subscriptions past due with action required.
   */
  findPastDueActionRequired(): Promise<SubscriptionProps[]>;

  /**
   * Find all active subscriptions for dunning retry worker.
   */
  findActiveForRetry(dunningStatus: 'none' | 'pending_retry'): Promise<SubscriptionProps[]>;

  /**
   * Find subscriptions for a tenant with filtering.
   */
  findForTenant(
    tenantId: TenantId,
    filters?: {
      statuses?: ('active' | 'canceled' | 'past_due')[];
      plans?: ('TEAMS' | 'ENTERPRISE')[];
    }
  ): Promise<SubscriptionProps[]>;

  /**
   * Insert a new subscription.
   */
  insert(subscription: SubscriptionProps): Promise<CreateMutation>;

  /**
   * Update an existing subscription.
   */
  update(update: UpdateMutation): Promise<void>;

  /**
   * Delete a subscription.
   *
   * Protected by foreign key cascade in schema, but kept for safety.
   */
  delete(where: { id: number }): Promise<void>;

  /**
   * Find subscription by external provider IDs.
   */
  findByExternalIds(
    externalCustomerId: string,
    externalSubscriptionId: string,
  ): Promise<SubscriptionProps | null>;

  /**
   * Count active subscriptions.
   */
  countActive(): Promise<number>;

  /**
   * List subscriptions with limit/max.
   */
  list(
    tenantId: null,
    limit?: number,
    offset?: number,
  ): Promise<SubscriptionProps[]>;

  listForTenant(
    tenantId: TenantId,
    limit?: number,
    offset?: number,
  ): Promise<SubscriptionProps[]>;

  /**
   * Returns the DunningMetrics that should be updated to the input arguments.
   * Implementations should adapt their internal state to the given expectations.
   */
  updateDunningMetrics(rec: UpdateMutation): Promise<void>;
}