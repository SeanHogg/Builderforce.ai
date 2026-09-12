/**
 * Request-body schemas for `tenantRoutes.ts` — split out so the 1,400-line route
 * module does not grow by its own contract.
 *
 * Each mirrors the body type its handler declared. A field the handler answers
 * its own "X is required" sentence for stays OPTIONAL here, so that sentence is
 * still the answer a missing field gets; the schema's job is the shape — a
 * `name: 5` or a `role: "root"` is a 400 with a field path instead of a
 * TypeError (or a Postgres enum error) answered as a 500.
 */
import { TenantBillingCycle, TenantRole } from '../../domain/shared/types';
import { z } from './requestBody';

/** `POST /create`, `PATCH /:id/name`, `POST /` — the handler refuses a blank name itself. */
export const TenantNameBody = z.object({ name: z.string().optional() });

/** `PUT /:id/default-agentHost` — `null` clears the default. */
export const DefaultAgentHostBody = z.object({ agentHostId: z.number().int().nullish() });

/** `PUT /:id/navigation-features` — `validateNavigationFeatures` owns the id vocabulary. */
export const NavigationFeaturesBody = z.object({ enabled: z.unknown() });

/** `POST /:id/add-ons/business-phone/checkout`. */
export const BusinessPhoneCheckoutBody = z.object({ billingEmail: z.string().nullish() });

/** `POST /:id/subscription/checkout`. */
export const SubscriptionCheckoutBody = z.object({
  targetPlan: z.enum(['pro', 'teams']).nullish(),
  seats: z.number().optional(),
  billingCycle: z.enum(TenantBillingCycle).nullish(),
  billingEmail: z.string().nullish(),
  successUrl: z.string().nullish(),
  cancelUrl: z.string().nullish(),
  discountCode: z.string().nullish(),
});

/** `POST /:id/card-validation` — every field falls back to a stored or default value. */
export const CardValidationBody = z.object({
  billingEmail: z.string().nullish(),
  successUrl: z.string().nullish(),
  cancelUrl: z.string().nullish(),
});

/**
 * `POST` and `PATCH /:id/source-control-integrations[/:integrationId]`. One shape
 * for both: create's required fields are refused by the handler with their own
 * messages, and the provider vocabulary is checked there too.
 */
export const SourceControlIntegrationBody = z.object({
  provider: z.string().optional(),
  name: z.string().optional(),
  accountIdentifier: z.string().optional(),
  hostUrl: z.string().nullish(),
  isActive: z.boolean().optional(),
});

/** `POST /:id/members` — add an existing account. */
export const AddMemberBody = z.object({
  newUserId: z.string().min(1),
  role: z.enum(TenantRole),
});

/** `POST /:id/invite-by-email` — role defaults to developer. */
export const InviteByEmailBody = z.object({
  email: z.string().optional(),
  role: z.enum(TenantRole).optional(),
});

/** `PATCH /:id/members/:userId/role`. */
export const ChangeRoleBody = z.object({ role: z.enum(TenantRole).optional() });

/** `PATCH /:id/spend-limits` — `null` clears the team default; the range is checked by the handler. */
export const DefaultSpendCapBody = z.object({ amountUsd: z.number().nullish() });

/** `PATCH /:id/members/:userId/spend-limit` — the handler answers an unknown mode itself. */
export const SeatSpendLimitBody = z.object({
  mode: z.string().optional(),
  amountUsd: z.number().optional(),
});
