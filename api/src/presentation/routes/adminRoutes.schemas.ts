/**
 * Request-body schemas for the superadmin surface (`adminRoutes.ts`, /api/admin/*).
 *
 * Kept beside the route module rather than inside it: `adminRoutes.ts` is already
 * past 4,000 lines, and these are pure data — every schema is read through
 * `parseBody` / `parseOptionalBody` from `./requestBody`, the ONE validated read.
 *
 * The schemas state SHAPE (types), not policy. Each mirrors the body type its
 * handler declared and what the handler actually reads:
 *   • a field the handler checks itself (with its own error message) stays
 *     optional here, so that message is still the one a caller sees;
 *   • a field the handler tolerates as null (`??`, `?.`, `!= null`, truthiness)
 *     is `.nullish()`, because clients send null;
 *   • a body or sub-object that is stored/forwarded wholesale (audit metadata, a
 *     service input) is a loose object or a record, never a stripping `z.object`.
 */
import { z } from './requestBody';
import { NEWSLETTER_EVENT_TYPES } from '../../domain/marketing/newsletterEvents';

/** Free text the handler trims/tests itself; null and absent both tolerated. */
const text = z.string().nullish();

/** A string whose consumer takes `string | undefined` — null reads as absent. */
const optionalText = z.string().nullish().transform((value) => value ?? undefined);

// ── Pricing / legal ──────────────────────────────────────────────────────────

/** The draft pricing document — `validatePricingDocument` owns its rules; stored whole. */
export const PricingDraftBody = z.record(z.string(), z.unknown());

/** Publish + amend. The legal service answers `version is required` / `content is required`. */
export const LegalDocBody = z.object({ version: optionalText, title: optionalText, content: optionalText });

export const LegalEnhanceBody = z.object({ content: optionalText, instruction: optionalText, title: optionalText });

// ── Newsletter / privacy ─────────────────────────────────────────────────────

/** Create and patch share one shape; `preheader: null` clears it on patch. */
export const NewsletterTemplateBody = z.object({
  name: text,
  slug: text,
  subject: text,
  preheader: text,
  bodyMarkdown: text,
  isActive: z.boolean().nullish(),
});

export const PrivacyRequestPatchBody = z.object({ status: text, resolution: text });

/** `eventType` is the column's own pg enum — a value outside it could only fail the insert. */
export const NewsletterEventBody = z.object({
  subscriberEmail: text,
  templateId: z.number().nullish(),
  eventType: z.enum(NEWSLETTER_EVENT_TYPES).nullish(),
  metadata: text,
});

// ── MFA administration ───────────────────────────────────────────────────────

export const MfaEnableBody = z.object({ code: text });

/** Disable / regenerate: a TOTP code or a recovery code (the handler requires one). */
export const MfaChallengeBody = z.object({ code: optionalText, recoveryCode: optionalText });

// ── Accounts, leads, broadcasts, discounts ───────────────────────────────────

/** Non-string ids are filtered out by the handler, not refused. */
export const SuspectRevokeBody = z.object({ userIds: z.array(z.unknown()).nullish() });

export const SalesLeadPatchBody = z.object({ status: text });

/**
 * A platform broadcast (create) or a patch to one. Forwarded to
 * `PlatformBroadcastService` and recorded whole in the audit trail, so loose.
 * An absent body was always read as `{ message: '' }`.
 */
export const BroadcastBody = z.looseObject({
  message: z.string().default(''),
  tone: z.string().optional(),
  ctaLabel: text,
  ctaHref: text,
  dismissible: z.boolean().optional(),
  status: z.string().optional(),
  audience: z.unknown().optional(),
  startsAt: text,
  endsAt: text,
});

/** Create coerces with `Number(...)`, so numeric strings stay admissible. */
const coercedNumber = z.union([z.number(), z.string()]).nullish();

export const DiscountCodeCreateBody = z.object({
  code: text,
  percentOff: coercedNumber,
  durationYears: coercedNumber,
  applicablePlan: text,
  billingCycle: text,
  isActive: z.boolean().nullish(),
});

/** Patch writes each present field straight to its column. */
export const DiscountCodePatchBody = z.object({
  code: z.string().optional(),
  percentOff: z.number().optional(),
  durationYears: z.number().optional(),
  applicablePlan: z.enum(['pro', 'teams']).optional(),
  billingCycle: z.enum(['monthly', 'yearly']).optional(),
  isActive: z.boolean().optional(),
});

// ── Tenant limits ────────────────────────────────────────────────────────────
// null clears the override, -1 is unlimited; the handlers enforce the integer rule.

export const TokenLimitOverrideBody = z.object({ tokenDailyLimitOverride: z.number().nullish() });
export const PaidOverflowCapBody = z.object({ paidOverflowDailyCap: z.number().nullish() });
export const PremiumCapBody = z.object({ premiumDailyCap: z.number().nullish() });
export const ImageCreditsLimitBody = z.object({ imageCreditsDailyLimit: z.number().nullish() });
export const PremiumOverrideBody = z.object({ premiumOverride: z.boolean().nullish() });

// ── System health / cron ─────────────────────────────────────────────────────

/** `action` / `target` / `table` are each checked by the handler with its own message. */
export const MaintenanceBody = z.object({ action: text, target: text, table: text });

/** `enabled` keeps the handler's "enabled must be a boolean." answer. */
export const CronControlBody = z.object({ enabled: z.unknown() });

/** `clampForceTimeout` reads `Number(raw)`; junk falls back to its default, as before. */
export const CronForceRunBody = z.object({
  timeoutMs: z.union([z.number(), z.string()]).nullish()
    .transform((value) => (value == null ? undefined : Number(value))),
});

// ── Impersonation / personas / governance ────────────────────────────────────

export const ImpersonateBody = z.object({ userId: text, tenantId: z.number().nullish() });

export const ImpersonationStartBody = z.object({
  userId: text,
  tenantId: z.number().nullish(),
  role: text,
  reason: text,
  enableDebugger: z.boolean().nullish(),
});

export const SwitchRoleBody = z.object({ role: text });

/** `psychometric` is a PsychometricProfile stored as JSON — kept whole. */
export const PersonaCreateBody = z.object({
  name: text,
  slug: text,
  description: text,
  voice: text,
  perspective: text,
  decisionStyle: text,
  outputPrefix: text,
  capabilities: z.array(z.string()).nullish(),
  tags: z.array(z.string()).nullish(),
  psychometric: z.unknown().optional(),
  source: text,
  author: text,
  active: z.boolean().nullish(),
});

/** Present fields are written; `null` clears the nullable text columns. */
export const PersonaPatchBody = z.object({
  name: z.string().optional(),
  slug: z.string().optional(),
  description: text,
  voice: text,
  perspective: text,
  decisionStyle: text,
  outputPrefix: text,
  capabilities: z.array(z.string()).nullish(),
  tags: z.array(z.string()).nullish(),
  psychometric: z.unknown().optional(),
  source: text,
  author: text,
  active: z.boolean().optional(),
});

export const ProjectGovernanceBody = z.object({ governance: text });

// ── RBAC: role matrix, modules, users ────────────────────────────────────────

/** Each override is also recorded whole in the audit metadata, so loose. */
export const RolePermissionMatrixBody = z.object({
  overrides: z.array(z.looseObject({ permission: z.string(), granted: z.boolean(), reason: text })).nullish(),
});

export const ModuleCreateBody = z.object({
  name: text,
  slug: text,
  description: text,
  baseRole: text,
  permissions: z.array(z.string()).nullish(),
});

export const ModulePatchBody = z.object({
  name: text,
  description: text,
  baseRole: text,
  permissions: z.array(z.string()).optional(),
});

export const ModuleAssignBody = z.object({ moduleId: text });

export const UserStatusBody = z.object({ suspended: z.boolean() });

export const UserPermissionOverridesBody = z.object({
  tenantId: z.number().nullish(),
  overrides: z.array(z.looseObject({ permission: z.string(), granted: z.boolean(), expiresAt: text })).nullish(),
});

export const MemberRoleBody = z.object({ role: z.string() });

// ── Tenant API keys / feedback / publishers ──────────────────────────────────

/** `normalizeOrigins` shapes the list; `null` = server-only key. */
export const AdminTenantApiKeyBody = z.object({ name: text, allowedOrigins: z.array(z.string()).nullish() });

export const FeedbackReviewBody = z.object({ decision: text, tenantId: z.number().nullish() });

export const PublisherStateBody = z.object({ state: text, note: text });

export const PublisherSuspensionBody = z.object({ suspended: z.boolean().nullish(), reason: text });

/** `featured: null` always un-featured (it reached the service as a falsy, defined value). */
export const PartnerTrackBody = z.object({
  track: text,
  featured: z.boolean().nullish().transform((value) => (value === null ? false : value)),
});
