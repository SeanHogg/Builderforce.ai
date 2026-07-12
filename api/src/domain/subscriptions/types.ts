/**
 * Subscription Domain Types
 *
 * Core domain types for recurring subscription billing.
 * Handles Teams/Enterprise plans, billing cycles, dunning, and lifecycle.
 */

import { z } from 'zod';
import type { TenantId } from '../shared/types';

// --- Enums (migratable to database enum) ---

export enum SubscriptionStatus {
  ACTIVE = 'active',
  TRIALING = 'trialing',
  PAST_DUE = 'past_due',
  CANCELED = 'canceled',
  SUSPENDED = 'suspended',
}

export enum DunningStatus {
  NONE = 'none',
  PENDING_RETRY = 'pending_retry',
  ACTION_REQUIRED = 'action_required',
}

export enum BillingCycle {
  MONTHLY = 'MONTHLY',
  YEARLY = 'YEARLY',
}

export enum SubscriptionPlan {
  TEAMS = 'TEAMS',
  ENTERPRISE = 'PRO',
}

// --- Zod schemas for validation (mirroring/create patterns) ---

export const SubscriptionSchema: z.ZodObject<{
  id: z.ZodString;
  tenantId: z.ZodNumber;
  plan: z.ZodEnum<[SubscriptionPlan.TEAMS, SubscriptionPlan.ENTERPRISE]>;
  billingCycle: z.ZodEnum<[BillingCycle.MONTHLY, BillingCycle.YEARLY]>;
  billingEmail: z.ZodOptional<z.ZodString>;
  status: z.ZodEnum<[SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING, SubscriptionStatus.PAST_DUE, SubscriptionStatus.CANCELED, SubscriptionStatus.SUSPENDED]>;
  seats: z.ZodOptional<z.ZodNumber>;
  externalCustomerId: z.ZodOptional<z.ZodString>;
  externalSubscriptionId: z.ZodString;
  currentPeriodStart: z.ZodDate;
  currentPeriodEnd: z.ZodDate;
  nextBillingDate: z.ZodDate;
  paymentBrand: z.ZodOptional<z.ZodString>;
  paymentLast4: z.ZodOptional<z.ZodString>;
  dunningStatus: z.ZodEnum<[DunningStatus.NONE, DunningStatus.PENDING_RETRY, DunningStatus.ACTION_REQUIRED]>;
  dunningAttempts: z.ZodNumber;
  dunningFailedAttempts: z.ZodNumber;
  createdAt: z.ZodDate;
  updatedAt: z.ZodDate;
}> = z.object({
  id: z.string(),
  tenantId: z.number(),
  plan: z.enum([SubscriptionPlan.TEAMS, SubscriptionPlan.ENTERPRISE]),
  billingCycle: z.enum([BillingCycle.MONTHLY, BillingCycle.YEARLY]),
  billingEmail: z.string().email().optional(),
  status: z.enum([
    SubscriptionStatus.ACTIVE,
    SubscriptionStatus.TRIALING,
    SubscriptionStatus.PAST_DUE,
    SubscriptionStatus.CANCELED,
    SubscriptionStatus.SUSPENDED,
  ]),
  seats: z.number().optional(),
  externalCustomerId: z.string().optional(),
  externalSubscriptionId: z.string(),
  currentPeriodStart: z.coerce.date(),
  currentPeriodEnd: z.coerce.date(),
  nextBillingDate: z.coerce.date(),
  paymentBrand: z.string().optional(),
  paymentLast4: z.string().optional(),
  dunningStatus: z.enum([
    DunningStatus.NONE,
    DunningStatus.PENDING_RETRY,
    DunningStatus.ACTION_REQUIRED,
  ]),
  dunningAttempts: z.number(),
  dunningFailedAttempts: z.number(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const CreateSubscriptionSchema: z.ZodObject<{
  tenantId: z.ZodNumber;
  plan: z.ZodEnum<[SubscriptionPlan.TEAMS, SubscriptionPlan.ENTERPRISE]>;
  billingCycle: z.ZodEnum<[BillingCycle.MONTHLY, BillingCycle.YEARLY]>;
  billingEmail: z.ZodString;
  seats: z.ZodOptional<z.ZodNumber>;
}> = z.object({
  tenantId: z.number(),
  plan: z.enum([SubscriptionPlan.TEAMS, SubscriptionPlan.ENTERPRISE]),
  billingCycle: z.enum([BillingCycle.MONTHLY, BillingCycle.YEARLY]),
  billingEmail: z.string().email(),
  seats: z.number().optional(),
});

export const UpdateSubscriptionSchema: z.ZodObject<{
  status: z.ZodEnum<[SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING, SubscriptionStatus.PAST_DUE, SubscriptionStatus.CANCELED, SubscriptionStatus.SUSPENDED]>;
  seats: z.ZodOptional<z.ZodNumber>;
}> = z.object({
  status: z.enum([
    SubscriptionStatus.ACTIVE,
    SubscriptionStatus.TRIALING,
    SubscriptionStatus.PAST_DUE,
    SubscriptionStatus.CANCELED,
    SubscriptionStatus.SUSPENDED,
  ]),
  seats: z.number().optional(),
});

export const DunningMetricsSchema: z.ZodObject<{
  currentAttempts: z.ZodNumber;
  failedAttempts: z.ZodNumber;
  status: z.ZodEnum<[DunningStatus.NONE, DunningStatus.PENDING_RETRY, DunningStatus.ACTION_REQUIRED]>;
}> = z.object({
  currentAttempts: z.number(),
  failedAttempts: z.number(),
  status: z.enum([DunningStatus.NONE, DunningStatus.PENDING_RETRY, DunningStatus.ACTION_REQUIRED]),
});

export type Subscription = z.infer<typeof SubscriptionSchema>;
export type CreateSubscription = z.infer<typeof CreateSubscriptionSchema>;
export type UpdateSubscription = z.infer<typeof UpdateSubscriptionSchema>;
export type DunningMetrics = z.infer<typeof DunningMetricsSchema>;

// --- Domain Events (passed to notifications) ---

export enum SubscriptionEventType {
  CREATED = 'subscription.created',
  RENEWED = 'subscription.renewed',
  FAILED = 'subscription.failed',
  PAST_DUE = 'subscription.past_due',
  COLLECTED = 'subscription.collected',
  CANCELED = 'subscription.canceled',
  DUNNING_INITIATED = 'subscription.dunning_initiated',
  DUNNING_RESOLVED = 'subscription.dunning_resolved',
  DUNNING_FAILED = 'subscription.dunning_failed',
}

export interface SubscriptionEvent {
  id: string;
  subscriptionId: string;
  tenantId: TenantId;
  eventType: SubscriptionEventType;
  summary: string;
  occurredAt: Date;
}

// --- Platform (Helcim) identifiers ---

export interface SubscriptionExternalRef {
  customerCode: string; // Helcim customerCode (linked to tenant)
  scheduleId: string; // Helcim recurring billing schedule ID
}

// --- Dunning configuration ---

export interface DunningConfig {
  maxAttempts: number; // How many automatic retries
  retryIntervalDays: number; // Days between retry attempts (START of schedule)
  actionRequiredGracePeriodDays: number; // Days before marking ACTION_REQUIRED
}

export const DEFAULT_DUNNING_CONFIG: DunningConfig = {
  maxAttempts: 3,
  retryIntervalDays: 7,
  actionRequiredGracePeriodDays: 3,
};