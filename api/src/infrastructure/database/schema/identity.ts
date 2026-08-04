/**
 * Schema — identity context.
 *
 * Split out of the single 7,500-line `schema.ts`, which held all 322 tables
 * in one file and was the largest source file in the repo by a factor of three.
 * `schema.ts` is now a barrel that re-exports every context, so nothing that
 * imports from it had to change.
 *
 * Imports between context modules are circular by nature — a task references a
 * project, a project references a tenant, and ownership runs in both directions
 * across contexts. That is safe here because EVERY table→table reference sits
 * inside a lazy callback (`references(() => other.id)`, and the index /
 * primaryKey builders), so no cross-module value is dereferenced while the
 * modules are still evaluating. `schema.tables.test.ts` renders SQL for every
 * exported table to keep that guarantee honest.
 */
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  serial,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { budgets } from './billing';
import { brainChats } from './brain';
import { contributors, devTeams, meetings, teamVelocity, teams } from './collaboration';
import { authTokenTypeEnum, legalDocumentTypeEnum, memberAvailabilityStatusEnum, memberExperienceLevelEnum, memberProfileSyncSourceEnum, segmentStatusEnum, teamMemberKindEnum, tenantIsolationModeEnum, tenantKindEnum, tenantRoleEnum, tenantStatusEnum } from './common';
import { errorGroups, onCallRotations } from './delivery';
import { marketplacePersonas } from './llm';
import { agentHosts, agents, importRuns, skills, toolRuns } from './runtime';
import { projects } from './work';


// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

/**
 * Unified users table. Supports both API-key users (SDK/CLI) and web/
 * marketplace users (email + password).
 */
export const users = pgTable('users', {
  id:            varchar('id', { length: 36 }).primaryKey(),
  email:         varchar('email', { length: 255 }).notNull().unique(),
  apiKeyHash:    varchar('api_key_hash', { length: 64 }),
  username:      varchar('username', { length: 100 }).unique(),
  displayName:   varchar('display_name', { length: 255 }),
  // text, not varchar(500): OAuth provider `picture` URLs (Google signed
  // lh3.googleusercontent.com links) and mirrored freelancer avatars are
  // unbounded and overflowed 500 chars on signup (mig 0356).
  avatarUrl:     text('avatar_url'),
  bio:           text('bio'),
  passwordHash:  varchar('password_hash', { length: 255 }),
  /** When the user proved they own this email address — set by OTP verification on
   *  password signup, or immediately for OAuth/magic-link (the provider/inbox vouches).
   *  NULL = unverified: the account exists but cannot obtain a session until a code is
   *  entered. Backfilled to created_at for every pre-existing account (mig 0285) so the
   *  gate only ever traps NEW password signups. Stops fake/unowned-email accounts. */
  emailVerifiedAt: timestamp('email_verified_at'),
  mfaEnabled:    boolean('mfa_enabled').notNull().default(false),
  mfaSecretEnc:  text('mfa_secret_enc'),
  mfaTempSecretEnc: text('mfa_temp_secret_enc'),
  mfaTempExpiresAt: timestamp('mfa_temp_expires_at'),
  mfaEnabledAt:  timestamp('mfa_enabled_at'),
  mfaRecoveryGeneratedAt: timestamp('mfa_recovery_generated_at'),
  mfaLastVerifiedAt: timestamp('mfa_last_verified_at'),
  isSuperadmin:           boolean('is_superadmin').notNull().default(false),
  isSuspended:            boolean('is_suspended').notNull().default(false),
  /** Account-type discriminator. GLOBAL (a freelancer works across many tenants).
   *  'standard' = normal builder; 'freelancer' = restricted gig account (minimal
   *  shell: profile + gigs + timecard). Drives shell/nav gating. (0269) */
  accountType:            varchar('account_type', { length: 20 }).notNull().default('standard'),
  /** When the user EXPLICITLY chose their account type (Build vs Hired). NULL for
   *  OAuth/magic-link accounts that were auto-provisioned before picking a role —
   *  the onboarding gate uses this to force a one-time role choice. (0278) */
  accountTypeSelectedAt:  timestamp('account_type_selected_at'),
  /** Opt-in to being hired talent. INDEPENDENT of accountType: a 'standard' builder
   *  can turn this on to publish a for-hire profile + bid on gigs while keeping the
   *  full builder shell. Always true for 'freelancer' accounts. Discoverability is
   *  still gated on a PUBLISHED profile; this drives the opt-in UX + bid gate. (0282) */
  availableForHire:       boolean('available_for_hire').notNull().default(false),
  sessionVersion:         integer('session_version').notNull().default(0),
  onboardingCompletedAt:  timestamp('onboarding_completed_at'),
  /** JSON `{ track, completed[], activeStep }` — which setup-wizard steps are done,
   *  by STEP ID so it survives track changes/reordering. Lets a user resume the
   *  wizard where they left off instead of restarting at step 1. (0343) */
  onboardingProgress:     text('onboarding_progress'),
  userIntent:             text('user_intent'), // JSON array of intent strings, set during onboarding
  /** JSON PsychometricProfile (Pro) — this human's OWN personality; null = none. Same
   *  shape agents/personas use, so a person and an agent are described the same way. */
  psychometric:           text('psychometric'),
  /** Preferred UI + EMAIL language, captured at signup from the request (NEXT_LOCALE
   *  cookie, then Accept-Language) and editable from /settings?sub=email. NULL = never
   *  captured — NOT the same as "chose English": the shared resolver
   *  (application/email/emailLocaleResolver) then falls back to the request's own hints
   *  before 'en', so a pre-existing account is not permanently pinned to English. Held
   *  as a BCP-47 tag; narrowed to a supported EmailLocale at read time. (0351) */
  locale:                 varchar('locale', { length: 5 }),
  createdAt:              timestamp('created_at').notNull().defaultNow(),
  updatedAt:              timestamp('updated_at').notNull().defaultNow(),
});


export const legalDocuments = pgTable('legal_documents', {
  id:           serial('id').primaryKey(),
  documentType: legalDocumentTypeEnum('document_type').notNull(),
  version:      varchar('version', { length: 50 }).notNull(),
  title:        varchar('title', { length: 255 }).notNull(),
  content:      text('content').notNull(),
  isActive:     boolean('is_active').notNull().default(true),
  publishedBy:  varchar('published_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  publishedAt:  timestamp('published_at').notNull().defaultNow(),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
});


export const legalDocumentVersions = pgTable('legal_document_versions', {
  id:           serial('id').primaryKey(),
  documentType: legalDocumentTypeEnum('document_type').notNull(),
  version:      varchar('version', { length: 50 }).notNull(),
  title:        varchar('title', { length: 255 }).notNull(),
  content:      text('content').notNull(),
  changeKind:   varchar('change_kind', { length: 16 }).notNull().default('publish'),
  changedBy:    varchar('changed_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('legal_document_versions_type_idx').on(t.documentType, t.createdAt),
]);


export const userLegalAcceptances = pgTable('user_legal_acceptances', {
  userId:       varchar('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  documentType: legalDocumentTypeEnum('document_type').notNull(),
  version:      varchar('version', { length: 50 }).notNull(),
  acceptedAt:   timestamp('accepted_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.documentType] }),
]);


export const userMfaRecoveryCodes = pgTable('user_mfa_recovery_codes', {
  id:          serial('id').primaryKey(),
  userId:      varchar('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  codeHash:    varchar('code_hash', { length: 64 }).notNull(),
  usedAt:      timestamp('used_at'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
});


export const authUserSessions = pgTable('auth_user_sessions', {
  id:          uuid('id').primaryKey(),
  userId:      varchar('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  sessionName: varchar('session_name', { length: 120 }),
  userAgent:   text('user_agent'),
  ipAddress:   varchar('ip_address', { length: 64 }),
  isActive:    boolean('is_active').notNull().default(true),
  revokedAt:   timestamp('revoked_at'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  lastSeenAt:  timestamp('last_seen_at').notNull().defaultNow(),
});


export const authTokens = pgTable('auth_tokens', {
  jti:         varchar('jti', { length: 64 }).primaryKey(),
  userId:      varchar('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  sessionId:   uuid('session_id').references(() => authUserSessions.id, { onDelete: 'set null' }),
  tenantId:    integer('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
  tokenType:   authTokenTypeEnum('token_type').notNull(),
  issuedAt:    timestamp('issued_at').notNull().defaultNow(),
  expiresAt:   timestamp('expires_at').notNull(),
  revokedAt:   timestamp('revoked_at'),
  userAgent:   text('user_agent'),
  ipAddress:   varchar('ip_address', { length: 64 }),
  lastSeenAt:  timestamp('last_seen_at').notNull().defaultNow(),
});


/**
 * Developer API keys — allows external sites to query the public Builderforce.ai API.
 * The key itself is only shown once at creation; only the hash is stored.
 */
export const developerApiKeys = pgTable('developer_api_keys', {
  id:          uuid('id').primaryKey().defaultRandom(),
  userId:      varchar('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  name:        varchar('name', { length: 255 }).notNull(),
  keyHash:     varchar('key_hash', { length: 128 }).notNull().unique(),
  lastUsedAt:  timestamp('last_used_at', { withTimezone: true }),
  revokedAt:   timestamp('revoked_at', { withTimezone: true }),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});


/**
 * Tenant API keys (bfk_*) — gateway-facing credential for tenant apps
 * (hired.video, burnrateos, 3rd-party customers) calling /llm/v1/chat/completions.
 * Tenant-scoped, owner-issued, raw key shown once and only the hash stored.
 */
export const tenantApiKeys = pgTable('tenant_api_keys', {
  id:               uuid('id').primaryKey().defaultRandom(),
  tenantId:         integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name:             varchar('name', { length: 255 }).notNull(),
  keyHash:          varchar('key_hash', { length: 64 }).notNull().unique(),
  createdByUserId:  varchar('created_by_user_id', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  /** Origin allowlist for browser use. NULL = server-only (any request with an `Origin` header is rejected).
   *  Array of exact origins or single `'*'` for any-origin escape hatch.
   *  Stored as JSONB on the wire; stringified on insert (drizzle treats `text` here for portability). */
  allowedOrigins:   text('allowed_origins'),
  /** JSON array of endpoint scopes (e.g. ["ingest:feedback"]). NULL / empty =
   *  unrestricted full-tenant key (legacy LLM-gateway keys); non-empty = the key
   *  is limited to exactly these scopes. See migration 0070. */
  scopes:           text('scopes'),
  lastUsedAt:       timestamp('last_used_at', { withTimezone: true }),
  revokedAt:        timestamp('revoked_at', { withTimezone: true }),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});


/**
 * Tenant-registered MCP extensions — the server-side half of the Brain's
 * extension contract. A tenant registers a custom MCP server (URL + optional
 * bearer secret); the gateway advertises its tools to the Brain and relays tool
 * calls SERVER-TO-SERVER, so the MCP secret never reaches the browser. The
 * secret is encrypted at rest with JWT_SECRET (AES-GCM, same as MFA secrets).
 */
export const tenantMcpExtensions = pgTable('tenant_mcp_extensions', {
  id:               uuid('id').primaryKey().defaultRandom(),
  tenantId:         integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name:             varchar('name', { length: 255 }).notNull(),
  /** Base URL of the customer's MCP server (the gateway calls {server_url}/tools and {server_url}/call). */
  serverUrl:        text('server_url').notNull(),
  /** AES-GCM-encrypted bearer secret sent to the MCP server. NULL = no auth. */
  secretEnc:        text('secret_enc'),
  enabled:          boolean('enabled').notNull().default(true),
  createdByUserId:  varchar('created_by_user_id', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  lastUsedAt:       timestamp('last_used_at', { withTimezone: true }),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});


// ---------------------------------------------------------------------------
// Orchestration tables
// ---------------------------------------------------------------------------

export const tenants = pgTable('tenants', {
  id:                     serial('id').primaryKey(),
  name:                   varchar('name', { length: 255 }).notNull(),
  slug:                   varchar('slug', { length: 255 }).notNull().unique(),
  status:                 tenantStatusEnum('status').notNull().default('active'),
  defaultAgentHostId:          integer('default_agent_host_id'),
  // plan / billingCycle / billingStatus are plain VARCHAR(16) columns in the DB
  // (added in migration 0008), NOT Postgres enums. They are typed as string
  // unions here, not pgEnum, so the schema matches reality — declaring them as
  // pgEnum previously implied a `tenant_*` enum type that was never created,
  // which broke migration 0204 (ALTER TYPE on a non-existent type).
  plan:                   varchar('plan', { length: 16 }).notNull().default('free').$type<'free' | 'pro' | 'teams'>(),
  billingCycle:           varchar('billing_cycle', { length: 16 }).$type<'monthly' | 'yearly'>(),
  billingStatus:          varchar('billing_status', { length: 16 }).notNull().default('none').$type<'none' | 'pending' | 'active' | 'trialing' | 'past_due' | 'cancelled'>(),
  billingEmail:           varchar('billing_email', { length: 255 }),
  billingPaymentBrand:    varchar('billing_payment_brand', { length: 50 }),
  billingPaymentLast4:    varchar('billing_payment_last4', { length: 4 }),
  billingUpdatedAt:       timestamp('billing_updated_at'),
  /**
   * Explicit card-validation flow for PREMIUM (any-paid-OpenRouter) model selection
   * (migration 0342). A tenant may select any paid OpenRouter model (billed at
   * OpenRouter cost + a flat 1¢/request) on any plan with a card that has
   * been through the provider's validation flow (SetupIntent / $0 auth):
   *   card_validated_at    → stamped when the provider confirms a usable card (NULL
   *                          until then). Presence = "validated card on file".
   *   card_validation_status → none | pending | validated | failed (drives the UI).
   * See `cardValidationService.ts` + `evaluatePremiumModelAccess`.
   */
  cardValidatedAt:        timestamp('card_validated_at', { withTimezone: true }),
  cardValidationStatus:   varchar('card_validation_status', { length: 16 }).notNull().default('none').$type<'none' | 'pending' | 'validated' | 'failed'>(),
  externalCustomerId:     varchar('external_customer_id', { length: 255 }),
  externalSubscriptionId: varchar('external_subscription_id', { length: 255 }),
  /**
   * The VALIDATED card — the $0-SetupIntent card that unlocks PREMIUM model
   * selection (migrations 0346/0347).
   *
   * Deliberately SEPARATE from `billing_payment_brand`/`billing_payment_last4`,
   * which describe the card that bills the SUBSCRIPTION. The two are frequently
   * the same card but need not be, and sharing one pair of columns meant whichever
   * flow wrote last won — so the card shown to the user could disagree with the
   * one `external_payment_method_id` would actually detach.
   *
   * `externalPaymentMethodId` is the processor handle: it lets us detach exactly
   * this card rather than sweeping the customer, and swap a replacement in before
   * revoking the old one. Null on rows validated before 0346 (customer-wide
   * fallback).
   */
  externalPaymentMethodId: varchar('external_payment_method_id', { length: 255 }),
  cardBrand:              varchar('card_brand', { length: 50 }),
  cardLast4:              varchar('card_last4', { length: 4 }),
  seatCount:              integer('seat_count'),
  /**
   * When the introductory Pro trial ends (migration 0204). Set on tenant creation
   * to created_at + 14 days alongside billing_status='trialing' + plan='pro'. While
   * billing_status='trialing' AND trial_ends_at > now() the tenant gets Pro limits
   * (see domain/tenant/effectivePlan.ts); once it passes it falls back to Free.
   * NULL for tenants created before 0204 / never trialing.
   */
  trialEndsAt:            timestamp('trial_ends_at', { withTimezone: true }),
  /**
   * Superadmin override for the daily token budget.
   *   NULL  → use the plan default (see PlanLimits.tokenDailyLimit).
   *   -1    → unlimited; the plan-level gate is skipped.
   *   >= 0  → use this value instead of the plan default.
   */
  tokenDailyLimitOverride: integer('token_daily_limit_override'),
  /**
   * Superadmin grant of premium routing — when TRUE the LLM proxy uses the
   * premium model pool (top PREMIUM-tier models) and the extended per-vendor
   * timeout regardless of plan/billingStatus. Mirrors tokenDailyLimitOverride:
   * for comped / beta access without flipping the billing plan.
   */
  premiumOverride:        boolean('premium_override').notNull().default(false),
  /**
   * Per-tenant daily ceiling on PAID-OVERFLOW spend (premium-fallback / backstop
   * calls Builderforce funds on its own keys), in millicents (1/100000 USD) —
   * migration 0130.
   *   NULL  → use the plan default (free = $0.50/day; pro/teams effectively
   *           unlimited — see DEFAULT_PAID_OVERFLOW_CAP_MILLICENTS).
   *   -1    → unlimited; the overflow gate is skipped.
   *   >= 0  → use this value instead of the plan default.
   * Once exceeded the gateway closes the funded overflow path for the rest of the
   * UTC day (the tenant's primary pool still runs); resets at UTC midnight.
   */
  paidOverflowDailyCap:   integer('paid_overflow_daily_cap'),
  /** Per-tenant daily image-generation credit override (1 credit = 1 returned
   *  image). NULL → plan default; -1 → unlimited; >= 0 → explicit. Metered
   *  independently of `tokenDailyLimit` so image and text budgets don't starve
   *  each other (migration 0131). See `resolveImageCreditsDailyLimit`. */
  imageCreditsDailyLimit: integer('image_credits_daily_limit'),
  /** Team-wide DEFAULT per-seat monthly AI spend cap in millicents (1/100000 USD)
   *  — migration 0359. Owner-configured (Teams plan). NULL → no default (seats
   *  uncapped unless individually set); >= 0 → applied to every seat with no
   *  explicit `tenant_members.monthly_spend_cap_millicents`. Enforced against the
   *  OpenRouter-rate cost recorded on `llm_usage_log.cost_usd_millicents` (BYO = 0).
   *  See application/consumption/memberSpend.ts. */
  memberDefaultSpendCapMillicents: bigint('member_default_spend_cap_millicents', { mode: 'number' }),
  // Segment tier / identity federation (migration 0054).
  kind:                   tenantKindEnum('kind').notNull().default('direct'),
  idpIssuer:              varchar('idp_issuer', { length: 500 }),
  isolationMode:          tenantIsolationModeEnum('isolation_mode').notNull().default('single'),
  /** Sales-cycle demo workspace (migration 0360): seeded persona tenant entered
   *  from the marketing shell without signup, wiped + reseeded on every deploy
   *  (and nightly). demoPersona is the stable persona key ('ai-team' | 'insights'
   *  | 'pmo' | 'talent' | 'governance'); a partial unique index guarantees at
   *  most one tenant per persona. See application/demo/demoSeedService.ts. */
  isDemo:                 boolean('is_demo').notNull().default(false),
  demoPersona:            varchar('demo_persona', { length: 32 }),
  /** Workspace emergency stop. RuntimeService.submit checks this canonical flag
   *  before creating any manual, scheduled, autonomous, or integration run. */
  agentExecutionEnabled:  boolean('agent_execution_enabled').notNull().default(true),
  settings:               text('settings'),   // JSON-as-text (jsonb avoided per existing convention)
  createdAt:              timestamp('created_at').notNull().defaultNow(),
  updatedAt:              timestamp('updated_at').notNull().defaultNow(),
});


/**
 * Segment — the isolation tier BETWEEN tenant and entity. For a multi-tenant
 * integrator (isolationMode='segmented') there is one segment per end-client
 * (account, company) so no client data bleeds. For a single-tenant customer
 * (isolationMode='single') there is exactly ONE auto-created default segment
 * (isDefault=true) they never see — so every business entity can carry a
 * NOT NULL segment_id and both modes share one query path. See README
 * "Segment tier" and migration 0054.
 */
export const segments = pgTable('segments', {
  id:                uuid('id').primaryKey().defaultRandom(),
  tenantId:          integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  // Host coordinates of a federated end-client. NULL on the tenant's default segment.
  externalAccountId: varchar('external_account_id', { length: 255 }),
  externalCompanyId: varchar('external_company_id', { length: 255 }),
  displayName:       varchar('display_name', { length: 255 }).notNull(),
  slug:              varchar('slug', { length: 255 }).notNull(),
  plan:              varchar('plan', { length: 50 }).notNull().default('free'),
  status:            segmentStatusEnum('status').notNull().default('active'),
  settings:          text('settings'),
  isDefault:         boolean('is_default').notNull().default(false),
  provisionedAt:     timestamp('provisioned_at').notNull().defaultNow(),
  lastActiveAt:      timestamp('last_active_at'),
  createdAt:         timestamp('created_at').notNull().defaultNow(),
  updatedAt:         timestamp('updated_at').notNull().defaultNow(),
});


export const tenantMembers = pgTable('tenant_members', {
  id:        serial('id').primaryKey(),
  tenantId:  integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  userId:    varchar('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  role:      tenantRoleEnum('role').notNull().default('developer'),
  isActive:  boolean('is_active').notNull().default(true),
  joinedAt:  timestamp('joined_at').notNull().defaultNow(),
  /** Per-seat monthly AI spend cap in millicents (1/100000 USD) — migration 0359.
   *  NULL → inherit `tenants.member_default_spend_cap_millicents`; -1 → unlimited
   *  (override a team default); >= 0 → explicit cap (0 = no paid spend). Resolved by
   *  resolveMemberSpendCapMillicents; enforced at the gateway spend gate for Teams. */
  monthlySpendCapMillicents: bigint('monthly_spend_cap_millicents', { mode: 'number' }),
  /** 'YYYY-MM' the spend-notify level applies to (resets each month). Migration 0359. */
  spendNotifyPeriod:  varchar('spend_notify_period', { length: 7 }),
  /** Highest % threshold (0/50/80/100) already notified this period — dedupes the
   *  budget/spend notifications so a seat's owner is pinged once per threshold. */
  spendNotifyLevel:   smallint('spend_notify_level').notNull().default(0),
});


/**
 * Pending/accepted/revoked invitations to a workspace (see migration 0114).
 * Unlike tenant_members (which requires an existing user), an invitation targets
 * an email that may not have a Builderforce account yet. On the invitee's next
 * login with a matching email the pending row auto-converts to a tenant_members
 * row and is stamped 'accepted'. Managers can 'revoke' a still-pending row.
 */
export const tenantInvitations = pgTable('tenant_invitations', {
  id:               uuid('id').primaryKey().defaultRandom(),
  tenantId:         integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  email:            varchar('email', { length: 255 }).notNull(),   // stored lower-cased
  role:             tenantRoleEnum('role').notNull().default('developer'),
  status:           varchar('status', { length: 20 }).notNull().default('pending'), // pending | accepted | revoked
  invitedByUserId:  varchar('invited_by_user_id', { length: 36 }),
  createdAt:        timestamp('created_at').notNull().defaultNow(),
  acceptedAt:       timestamp('accepted_at'),
  revokedAt:        timestamp('revoked_at'),
});


/**
 * WORKSPACE-WIDE manager defaults (migration 0363) — the tier BETWEEN the hardcoded
 * defaults in `application/manager/managerPolicy.ts` and a per-project
 * `project_manager_configs` row. One row per tenant.
 *
 * Before this existed the policy had a single tier, so "the manager may groom but never
 * merge" had to be re-stated on every project and every NEW project silently started
 * from the code defaults. Every column here is NULLABLE because NULL is meaningful:
 * "this workspace expresses no opinion — fall through to the hardcoded default". That is
 * what makes the fold a genuine three-level override instead of a second copy of the
 * defaults.
 *
 * Precedence is NOT uniformly last-tier-wins: `enabled` and `allowAutoMerge` are
 * CEILINGS (an explicit false here cannot be re-granted by a project row) and
 * `requireSignoffToComplete` is a FLOOR (an explicit true cannot be relaxed). The rule
 * lives in exactly one place — `resolveTieredManagerPolicy()`.
 */
export const tenantManagerDefaults = pgTable('tenant_manager_defaults', {
  id:                uuid('id').primaryKey().defaultRandom(),
  tenantId:          integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  /** Workspace kill-switch. false = the manager is off workspace-wide and a project row
   *  cannot re-enable it (project rows have `enabled` NOT NULL DEFAULT true, so
   *  last-tier-wins would let every existing row silently defeat this switch). */
  enabled:           boolean('enabled'),
  /** Default PR authority tier: 'immediate' | 'on_green' | 'queue'. */
  prMergePolicy:     varchar('pr_merge_policy', { length: 12 }),
  autoAssign:        boolean('auto_assign'),
  autoBusinessValue: boolean('auto_business_value'),
  autoPrioritize:    boolean('auto_prioritize'),
  /** Workspace default for manager scheduling (0364). A plain override, not a
   *  ceiling — a project row wins. NULL = no workspace opinion. */
  autoSchedule:      boolean('auto_schedule'),
  /** Workspace sign-off FLOOR: true = no project may complete/merge without unanimous
   *  role sign-off (see 0362 + signoffGate.ts). */
  requireSignoffToComplete: boolean('require_signoff_to_complete'),
  /** Workspace grant of autonomous merge authority — a CEILING. false = no project may
   *  merge unattended; true = projects may unless their own row says false. */
  allowAutoMerge:    boolean('allow_auto_merge'),
  /** Workspace CEREMONY AUTONOMY (0364). Both booleans are CEILINGS, like allowAutoMerge:
   *  conducting business without the people it concerns, and moving someone's work off
   *  their plate, are handed over on purpose or not at all. The two numbers are guardrails
   *  folded most-restrictive-wins (largest idle threshold, smallest cap). */
  allowUnattendedCeremonies:  boolean('allow_unattended_ceremonies'),
  allowAgentReassignment:     boolean('allow_agent_reassignment'),
  agentReassignIdleHours:     integer('agent_reassign_idle_hours'),
  agentReassignMaxPerSession: integer('agent_reassign_max_per_session'),
  /** Workspace CEILING for lane auto-staffing (0386) — see the project column. */
  allowAutoStaffLanes:        boolean('allow_auto_staff_lanes'),
  /** Who last changed the workspace autonomy posture — the governance question is
   *  "who granted the manager merge rights?", so the answer is stored. */
  updatedBy:         varchar('updated_by', { length: 36 }),
  createdAt:         timestamp('created_at').notNull().defaultNow(),
  updatedAt:         timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byTenant: uniqueIndex('uq_tenant_manager_defaults_tenant').on(t.tenantId),
}));


/**
 * Capability & availability profile for one workforce member — human OR agent —
 * keyed by the polymorphic (memberKind, memberRef) identity (users.id /
 * ide_agents.id / agent_hosts.id), the same shape as {@link teamMembers}. Feeds
 * the AI sprint planner (who/what/when). Schedule fields are human-centric;
 * capacity/skills apply to both populations. `syncSource` is the Calendar-ready
 * seam — 'manual' today, overlay Google Calendar busy/pto later without a
 * migration. See migration 0116. JSON-shaped columns are typed loosely here
 * (jsonb) and validated at the route boundary.
 */
export const memberProfiles = pgTable('member_profiles', {
  id:           serial('id').primaryKey(),
  tenantId:     integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:    uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  memberKind:   teamMemberKindEnum('member_kind').notNull(),
  memberRef:    varchar('member_ref', { length: 64 }).notNull(),
  timezone:     varchar('timezone', { length: 64 }),
  workHours:    jsonb('work_hours'),
  pto:          jsonb('pto'),
  responseSlaHours:      real('response_sla_hours'),
  weeklyCapacityHours:   real('weekly_capacity_hours'),
  dailyCapacityPoints:   real('daily_capacity_points'),
  maxConcurrentWip:      integer('max_concurrent_wip'),
  rampFactor:   real('ramp_factor').notNull().default(1.0),
  experienceLevel:       memberExperienceLevelEnum('experience_level'),
  // Builder-discipline axis (migration 0228): engineering | product | design |
  // qa | devops | data | other. Null = unassigned. Orthogonal to memberKind.
  discipline:   varchar('discipline', { length: 24 }),
  skills:       jsonb('skills'),
  focusAreas:   jsonb('focus_areas'),
  preferredTaskTypes:    jsonb('preferred_task_types'),
  availabilityStatus:    memberAvailabilityStatusEnum('availability_status').notNull().default('available'),
  availabilityUntil:     timestamp('availability_until'),
  lastActiveAt: timestamp('last_active_at'),
  costRateUsdCents:      integer('cost_rate_usd_cents'),
  syncSource:   memberProfileSyncSourceEnum('sync_source').notNull().default('manual'),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  unique('uq_member_profile').on(t.tenantId, t.memberKind, t.memberRef),
]);


/**
 * Effectiveness/engagement scorecard per member per period (humans AND agents).
 * engagement_* columns are the human-specific board-behaviour dimensions; the
 * throughput/redo/reopen/cycle columns apply to everyone. Parallels
 * {@link teamVelocity} at member grain. See migration 0118.
 */
export const memberMetricsPeriod = pgTable('member_metrics_period', {
  id:           serial('id').primaryKey(),
  tenantId:     integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:    uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  memberKind:   teamMemberKindEnum('member_kind').notNull(),
  memberRef:    varchar('member_ref', { length: 64 }).notNull(),
  memberName:   varchar('member_name', { length: 255 }).notNull(),
  periodStart:  timestamp('period_start').notNull(),
  periodEnd:    timestamp('period_end').notNull(),
  assignedCount:  integer('assigned_count').notNull().default(0),
  completedCount: integer('completed_count').notNull().default(0),
  redoCount:      integer('redo_count').notNull().default(0),
  reopenCount:    integer('reopen_count').notNull().default(0),
  avgCycleTimeHours:       real('avg_cycle_time_hours'),
  avgPickupLatencyHours:   real('avg_pickup_latency_hours'),
  avgIdleAfterDoneHours:   real('avg_idle_after_done_hours'),
  boardHygieneScore:       real('board_hygiene_score'),
  engagementScore:         real('engagement_score'),
  effectivenessScore:      real('effectiveness_score'),
  computedAt:   timestamp('computed_at').notNull().defaultNow(),
}, (t) => [
  unique('uq_member_metrics_period').on(t.tenantId, t.memberKind, t.memberRef, t.periodStart, t.periodEnd),
]);


// ---------------------------------------------------------------------------
// Skill assignments
// A skill from the marketplace can be assigned to an entire tenant (all agentHosts
// inherit it) or to a specific BuilderForce Agents instance.
// ---------------------------------------------------------------------------

/**
 * Tenant-level skill assignment.
 * When a skill is assigned here, every active agentHost in the tenant can use it.
 * assignedBy is the userId of the owner/manager who made the assignment.
 */
export const tenantSkillAssignments = pgTable('tenant_skill_assignments', {
  id:         serial('id').primaryKey(),
  tenantId:   integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  skillSlug:  varchar('skill_slug', { length: 255 }).notNull(),
  assignedBy: varchar('assigned_by', { length: 36 }).references(() => users.id),
  assignedAt: timestamp('assigned_at').notNull().defaultNow(),
}, (t) => [
  // `id` above is the PK; this is the enforced uniqueness contract. (Postgres
  // permits only one PRIMARY KEY per table, so a composite primaryKey() here
  // would silently fight the column-level id PK — demoted to unique() [1315].)
  unique().on(t.tenantId, t.skillSlug),
]);


// ---------------------------------------------------------------------------
// Chat sessions and messages
// ---------------------------------------------------------------------------

export const chatSessions = pgTable('chat_sessions', {
  id:         serial('id').primaryKey(),
  tenantId:   integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId: uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),  // DB NOT NULL via trigger (0056); optional in TS so single-mode writes need no change
  agentHostId:     integer('agent_host_id').notNull().references(() => agentHosts.id, { onDelete: 'cascade' }),
  sessionKey: varchar('session_key', { length: 255 }).notNull(),
  projectId:  integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
  startedAt:  timestamp('started_at').notNull().defaultNow(),
  endedAt:    timestamp('ended_at'),
  msgCount:   integer('msg_count').notNull().default(0),
  lastMsgAt:  timestamp('last_msg_at'),
});


// ---------------------------------------------------------------------------
// Human chat participants (migration 0288) — the shared-access model. Until now a
// brain_chats row had a single owner (user_id) and every access check filtered by
// it, so a chat was strictly single-owner. This table is the human equivalent of
// an agent invite (agent_assignments scope='chat'): a member (active user_id, or a
// pending invited_email that converts on next access) may open, read, and post in a
// chat they do not own. Owner-only admin (rename/archive/invite) stays on user_id.
// ---------------------------------------------------------------------------

export const chatMembers = pgTable('chat_members', {
  id:           serial('id').primaryKey(),
  chatId:       integer('chat_id').notNull().references(() => brainChats.id, { onDelete: 'cascade' }),
  tenantId:     integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:    uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  /** Resolved member (an existing account); NULL while the invite is pending. */
  userId:       varchar('user_id', { length: 36 }).references(() => users.id, { onDelete: 'cascade' }),
  /** Lower-cased; set for a cold invite whose email has no account yet. */
  invitedEmail: varchar('invited_email', { length: 255 }),
  role:         varchar('role', { length: 24 }).notNull().default('participant'),
  /** 'active' (has access now) | 'pending' (email invite, converts on access). */
  status:       varchar('status', { length: 16 }).notNull().default('active'),
  invitedBy:    varchar('invited_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_chat_members_user').on(t.chatId, t.userId),
  index('idx_chat_members_user').on(t.tenantId, t.userId),
]);


// ---------------------------------------------------------------------------
// OAuth accounts — one user → many providers (added by migration 0034)
// ---------------------------------------------------------------------------

export const oauthAccounts = pgTable('oauth_accounts', {
  id:                uuid('id').primaryKey().defaultRandom(),
  userId:            varchar('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider:          varchar('provider', { length: 50 }).notNull(),
  providerAccountId: varchar('provider_account_id', { length: 255 }).notNull(),
  email:             varchar('email', { length: 255 }),
  displayName:       varchar('display_name', { length: 255 }),
  avatarUrl:         text('avatar_url'),
  accessToken:       text('access_token'),
  refreshToken:      text('refresh_token'),
  tokenExpiresAt:    timestamp('token_expires_at'),
  scope:             text('scope'),
  createdAt:         timestamp('created_at').notNull().defaultNow(),
  updatedAt:         timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  unique('uq_oauth_provider_account').on(t.provider, t.providerAccountId),
]);


// ---------------------------------------------------------------------------
// Magic link tokens — single-use, 15-minute expiry (added by migration 0034)
// ---------------------------------------------------------------------------

export const magicLinkTokens = pgTable('magic_link_tokens', {
  id:        uuid('id').primaryKey().defaultRandom(),
  email:     varchar('email', { length: 255 }).notNull(),
  token:     text('token').notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  used:      boolean('used').notNull().default(false),
  redirect:  varchar('redirect', { length: 500 }).notNull().default('/dashboard'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});


export const devTeamMembers = pgTable('dev_team_members', {
  id:            serial('id').primaryKey(),
  teamId:        integer('team_id').notNull().references(() => devTeams.id, { onDelete: 'cascade' }),
  contributorId: integer('contributor_id').notNull().references(() => contributors.id, { onDelete: 'cascade' }),
  /** 'manager' | 'member' | 'lead' */
  memberRole:    varchar('member_role', { length: 50 }).notNull().default('member'),
  joinedAt:      timestamp('joined_at').notNull().defaultNow(),
}, (t) => [
  unique('uq_team_contributor').on(t.teamId, t.contributorId),
]);


export const teamMembers = pgTable('team_members', {
  id:         serial('id').primaryKey(),
  teamId:     integer('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  /** Which workforce sub-population {@link memberRef} points at. */
  memberKind: teamMemberKindEnum('member_kind').notNull(),
  /** Stringified identity in the relevant table (users.id / ide_agents.id /
   *  agent_hosts.id). No FK — the targets are heterogeneous; integrity is enforced
   *  in the route. */
  memberRef:  varchar('member_ref', { length: 64 }).notNull(),
  /** Denormalized display name, refreshed on (re-)add so the list view never has
   *  to fan-join across all three populations. */
  memberName: varchar('member_name', { length: 255 }).notNull(),
  addedAt:    timestamp('added_at').notNull().defaultNow(),
}, (t) => [
  unique('uq_team_member').on(t.teamId, t.memberKind, t.memberRef),
]);


// ---------------------------------------------------------------------------
// Admin impersonation — Phase 2 of PRD: Super Admin Impersonation
// ---------------------------------------------------------------------------

/**
 * One row per impersonation session started by a Super Admin.
 * The table is effectively append-only; ended_at + end_reason are the only
 * mutable columns and are set exactly once when the session closes.
 */
export const adminImpersonationSessions = pgTable('admin_impersonation_sessions', {
  id:              uuid('id').primaryKey().defaultRandom(),
  adminUserId:     varchar('admin_user_id', { length: 36 }).notNull().references(() => users.id),
  targetUserId:    varchar('target_user_id', { length: 36 }).notNull().references(() => users.id),
  tenantId:        integer('tenant_id').notNull().references(() => tenants.id),
  roleOverride:    varchar('role_override', { length: 64 }).notNull(),
  reason:          text('reason').notNull(),
  tokenJti:        varchar('token_jti', { length: 256 }).unique(),
  startedAt:       timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  endedAt:         timestamp('ended_at', { withTimezone: true }),
  expiresAt:       timestamp('expires_at', { withTimezone: true }).notNull(),
  endReason:       varchar('end_reason', { length: 32 }),  // MANUAL | EXPIRED | ADMIN_LOGOUT
  pagesVisited:    text('pages_visited').notNull().default('[]'),  // JSON array
  writeBlockCount: integer('write_block_count').notNull().default(0),
  ipAddress:       varchar('ip_address', { length: 64 }),
  userAgent:       text('user_agent'),
  debuggerEnabled: boolean('debugger_enabled').notNull().default(false),
});


/**
 * Sub-events for role switches within an impersonation session.
 */
export const adminImpersonationRoleSwitches = pgTable('admin_impersonation_role_switches', {
  id:         uuid('id').primaryKey().defaultRandom(),
  sessionId:  uuid('session_id').notNull().references(() => adminImpersonationSessions.id),
  fromRole:   varchar('from_role', { length: 64 }).notNull(),
  toRole:     varchar('to_role', { length: 64 }).notNull(),
  switchedAt: timestamp('switched_at', { withTimezone: true }).notNull().defaultNow(),
});


// ---------------------------------------------------------------------------
// Granular permissions & modules (migration 0038)
// ---------------------------------------------------------------------------

/** Deviations from the hardcoded default permission matrix. */
export const rolePermissionOverrides = pgTable('role_permission_overrides', {
  id:         uuid('id').primaryKey().defaultRandom(),
  role:       varchar('role', { length: 32 }).notNull(),
  permission: varchar('permission', { length: 128 }).notNull(),
  granted:    boolean('granted').notNull(),
  reason:     text('reason'),
  createdBy:  varchar('created_by', { length: 36 }).notNull().references(() => users.id),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});


/** Custom roles defined by tenant owners or super admins (TEAMS plan only). */
export const tenantCustomRoles = pgTable('tenant_custom_roles', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id),
  name:        varchar('name', { length: 64 }).notNull(),
  description: text('description'),
  baseRole:    varchar('base_role', { length: 32 }).notNull(),
  permissions: text('permissions').notNull().default('[]'),  // JSON array
  createdBy:   varchar('created_by', { length: 36 }).notNull().references(() => users.id),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});


/** Platform-wide module definitions. */
export const platformModules = pgTable('platform_modules', {
  id:          uuid('id').primaryKey().defaultRandom(),
  name:        varchar('name', { length: 128 }).notNull().unique(),
  slug:        varchar('slug', { length: 128 }).notNull().unique(),
  description: text('description'),
  baseRole:    varchar('base_role', { length: 64 }),
  permissions: text('permissions').notNull().default('[]'),  // JSON array
  isBuiltin:   boolean('is_builtin').notNull().default(false),
  createdBy:   varchar('created_by', { length: 36 }).references(() => users.id),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});


/** Module assignments for specific users within a tenant. */
export const tenantMemberModules = pgTable('tenant_member_modules', {
  id:        uuid('id').primaryKey().defaultRandom(),
  tenantId:  integer('tenant_id').notNull().references(() => tenants.id),
  userId:    varchar('user_id', { length: 36 }).notNull().references(() => users.id),
  moduleId:  uuid('module_id').notNull().references(() => platformModules.id),
  grantedBy: varchar('granted_by', { length: 36 }).notNull().references(() => users.id),
  grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
});


/** Per-user per-tenant permission grants and revocations. */
export const userPermissionOverrides = pgTable('user_permission_overrides', {
  id:         uuid('id').primaryKey().defaultRandom(),
  tenantId:   integer('tenant_id').notNull().references(() => tenants.id),
  userId:     varchar('user_id', { length: 36 }).notNull().references(() => users.id),
  permission: varchar('permission', { length: 128 }).notNull(),
  granted:    boolean('granted').notNull(),
  expiresAt:  timestamp('expires_at', { withTimezone: true }),
  createdBy:  varchar('created_by', { length: 36 }).notNull().references(() => users.id),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});


// ---------------------------------------------------------------------------
// Ceremony sessions (standup / planning round-table; migration 0119). One row per
// officially-started, timed ceremony; participants carry turn order + speaking time.
// ---------------------------------------------------------------------------

export const ceremonySessions = pgTable('ceremony_sessions', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenantId:       integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:      uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  projectId:      integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  kind:           varchar('kind', { length: 16 }).notNull(),                       // 'standup' | 'planning'
  /** 'active' | 'completed' | 'abandoned' (0364). Abandoned = concluded without being
   *  conducted (nobody came and unattended ceremonies are not granted); it still frees
   *  the partial unique index so the next scheduled ceremony can open. */
  status:         varchar('status', { length: 16 }).notNull().default('active'),
  facilitatorId:  varchar('facilitator_id', { length: 64 }),
  turnMode:       varchar('turn_mode', { length: 16 }).notNull().default('facilitator'),
  turnSeconds:    integer('turn_seconds').notNull().default(90),
  currentTurn:    integer('current_turn'),                                         // index into participants.turnOrder
  turnStartedAt:  timestamp('turn_started_at'),
  startedAt:      timestamp('started_at').notNull().defaultNow(),
  endedAt:        timestamp('ended_at'),
  /** Set when the frequent cron sweep auto-opened this session from a schedule (0349). */
  scheduleId:     uuid('schedule_id'),
  /** Who closed it (0364): 'human' | 'manager' | 'system'. */
  concludedBy:    varchar('concluded_by', { length: 16 }),
  /** Why it closed (0364): 'facilitator' | 'unattended' | 'no_humans' | 'expired'.
   *  Kept separate from `status` so "completed" never has to mean four things. */
  closeReason:    varchar('close_reason', { length: 24 }),
  /** Denormalised outcome counters (0364) — the history LIST renders from these alone,
   *  so showing 20 past standups costs one query rather than 20 participant fan-outs. */
  humansExpected: integer('humans_expected').notNull().default(0),
  humansPresent:  integer('humans_present').notNull().default(0),
  reassignedCount: integer('reassigned_count').notNull().default(0),
  dispatchedCount: integer('dispatched_count').notNull().default(0),
  /** When the "your ceremony is live, come join" fan-out ran; guards re-notification. */
  notifiedAt:     timestamp('notified_at'),
  /** The calendar/video meeting this ceremony is held in (0366). The ceremony owns
   *  ATTENDANCE; the meeting owns the calendar entry and the media room, so joining the
   *  call writes through to this session's presence rather than keeping a rival record. */
  meetingId:      uuid('meeting_id'),
  createdAt:      timestamp('created_at').notNull().defaultNow(),
  updatedAt:      timestamp('updated_at').notNull().defaultNow(),
});


/**
 * meeting_transcript_segments (0330) — the running transcript of a live meeting.
 * One row per spoken line: a human line captured client-side (browser
 * SpeechRecognition) or an AGENT line produced by an LLM turn. Ordered by `atMs`
 * (ms since the meeting started).
 */
export const meetingTranscriptSegments = pgTable('meeting_transcript_segments', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  meetingId:   uuid('meeting_id').notNull().references(() => meetings.id, { onDelete: 'cascade' }),
  speakerRef:  varchar('speaker_ref', { length: 64 }).notNull(),
  speakerName: varchar('speaker_name', { length: 255 }).notNull(),
  speakerKind: varchar('speaker_kind', { length: 16 }).notNull().default('human'), // human|agent
  text:        text('text').notNull(),
  atMs:        bigint('at_ms', { mode: 'number' }).notNull().default(0),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});


export const userAvailability = pgTable('user_availability', {
  id:         uuid('id').primaryKey().defaultRandom(),
  tenantId:   integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  userId:     varchar('user_id', { length: 64 }).notNull(),
  timezone:   varchar('timezone', { length: 64 }).notNull().default('UTC'),
  // Weekly recurring windows: [{ day: 0-6 (0=Sun), start: minutesFromMidnight, end: minutes }]
  windows:    jsonb('windows').notNull().default('[]'),
  updatedAt:  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});


// ---------------------------------------------------------------------------
// Planning Poker + Retrospectives (doc 03; migration 0062). Segment-scoped.
// Nested session models (REST + client polling, no WebSocket infra).
// ---------------------------------------------------------------------------

export const pokerSessions = pgTable('poker_sessions', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenantId:       integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:      uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  name:           varchar('name', { length: 255 }).notNull(),
  votingSystem:   varchar('voting_system', { length: 20 }).notNull().default('fibonacci'),
  status:         varchar('status', { length: 20 }).notNull().default('active'),
  facilitatorId:  varchar('facilitator_id', { length: 64 }),
  createdAt:      timestamp('created_at').notNull().defaultNow(),
  updatedAt:      timestamp('updated_at').notNull().defaultNow(),
});


export const importStagedUsers = pgTable('import_staged_users', {
  id:           uuid('id').primaryKey().defaultRandom(),
  runId:        uuid('run_id').notNull().references(() => importRuns.id, { onDelete: 'cascade' }),
  tenantId:     integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  externalId:   varchar('external_id', { length: 255 }).notNull(),
  displayName:  varchar('display_name', { length: 255 }),
  email:        varchar('email', { length: 320 }),
  /** 'invite' (send workspace invite) | 'map' (link targetUserId) | 'skip'. */
  action:       varchar('action', { length: 8 }).notNull().default('invite'),
  targetUserId: varchar('target_user_id', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
});


/**
 * Device-code (RFC 8628) sign-in for editor clients (VS Code extension). Bridges the
 * API-key-only gateway to a one-click browser login: see migration 0201. Short-lived;
 * the minted tenant key is stored encrypted and delivered exactly once.
 */
export const deviceAuthorizations = pgTable('device_authorizations', {
  id:             serial('id').primaryKey(),
  deviceCodeHash: varchar('device_code_hash', { length: 128 }).notNull(),
  userCode:       varchar('user_code', { length: 16 }).notNull(),
  userId:         varchar('user_id', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  tenantId:       integer('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
  status:         varchar('status', { length: 16 }).notNull().default('pending'),
  issuedKeyEnc:   text('issued_key_enc'),
  scopes:         varchar('scopes', { length: 256 }).notNull().default('gateway'),
  client:         varchar('client', { length: 32 }),
  intervalSecs:   integer('interval_secs').notNull().default(5),
  expiresAt:      timestamp('expires_at').notNull(),
  approvedAt:     timestamp('approved_at'),
  lastPolledAt:   timestamp('last_polled_at'),
  createdAt:      timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  uqDeviceCode: uniqueIndex('uq_device_auth_device_code').on(t.deviceCodeHash),
  uqUserCode:   uniqueIndex('uq_device_auth_user_code').on(t.userCode),
  byExpires:    index('idx_device_auth_expires').on(t.expiresAt),
}));


/**
 * VS Code "coder agent" connections — the third agent runtime (alongside Cloud and
 * On-Prem agentHosts), tracked as a human-in-the-loop link: which user has a live VS
 * Code extension connected for this tenant. See migration 0202.
 */
export const vscodeConnections = pgTable('vscode_connections', {
  id:               serial('id').primaryKey(),
  tenantId:         integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  userId:           varchar('user_id', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  machineName:      varchar('machine_name', { length: 255 }).notNull().default('vscode'),
  extensionVersion: varchar('extension_version', { length: 32 }),
  status:           varchar('status', { length: 16 }).notNull().default('active'),
  connectedAt:      timestamp('connected_at').notNull().defaultNow(),
  lastSeenAt:       timestamp('last_seen_at').notNull().defaultNow(),
  createdAt:        timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  uqUserMachine: uniqueIndex('uq_vscode_conn_user_machine').on(t.tenantId, t.userId, t.machineName),
  byTenant:      index('idx_vscode_conn_tenant').on(t.tenantId),
}));


/**
 * tenant_models — the tenant "LLM" object (migration 0211). A reusable, named
 * bundle of { base model + system prompt + params (+ optional persona / BYO key /
 * future trained model) } that any cloud agent, on-prem host, or the Designer can
 * select by ref `tenant_model:<slug>`. `providerKey` names the provider whose BYO
 * key to route through (tenant_llm_provider_keys is keyed by (tenant_id, provider),
 * no surrogate id). `trainedModelRef` is the seam for a future SSM artifact base.
 */
export const tenantModels = pgTable('tenant_models', {
  id:              uuid('id').primaryKey().defaultRandom(),
  tenantId:        integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name:            varchar('name', { length: 255 }).notNull(),
  slug:            varchar('slug', { length: 255 }).notNull(),
  /** A model id from the curated pool; NULL = run on the tenant/plan default base. */
  baseModel:       text('base_model'),
  systemPrompt:    text('system_prompt'),
  /** { temperature?, reasoning?, top_p?, ... } applied at run time. */
  params:          jsonb('params').notNull().default(sql`'{}'::jsonb`),
  personaId:       uuid('persona_id').references(() => marketplacePersonas.id, { onDelete: 'set null' }),
  /** Provider name whose BYO key to route through (e.g. 'anthropic'); NULL = managed. */
  providerKey:     text('provider_key'),
  /** Future: a trained SSM model artifact used as the base. */
  trainedModelRef: text('trained_model_ref'),
  visibility:      varchar('visibility', { length: 16 }).notNull().default('tenant'),
  createdBy:       varchar('created_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  createdAt:       timestamp('created_at').notNull().defaultNow(),
  updatedAt:       timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byTenant: index('idx_tenant_models_tenant').on(t.tenantId),
  uqSlug:   uniqueIndex('uq_tenant_models_slug').on(t.tenantId, t.slug),
}));


/**
 * Anonymous marketing session (migration 0279) — a logged-out visitor who runs a
 * free Diagnostics & Tools diagnostic IS a lead. Keyed by a client-generated
 * stable `visitorId`; tracks run volume + first-touch attribution and is stamped
 * `converted` when the visitor creates an account. Not tenant-scoped (pre-signup).
 */
export const marketingSessions = pgTable('marketing_sessions', {
  id:              uuid('id').primaryKey().defaultRandom(),
  visitorId:       varchar('visitor_id', { length: 64 }).notNull(),
  toolRuns:        integer('tool_runs').notNull().default(0),
  lastToolId:      varchar('last_tool_id', { length: 64 }),
  landingPath:     text('landing_path'),
  referrer:        text('referrer'),
  userAgent:       text('user_agent'),
  utm:             jsonb('utm').notNull().default(sql`'{}'::jsonb`),
  converted:       boolean('converted').notNull().default(false),
  convertedUserId: varchar('converted_user_id', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  convertedAt:     timestamp('converted_at'),
  // Guest Brain/Ideas chat metering (migration 0297) — a logged-out visitor can
  // try the Brain before signing up; usage is counted per UTC day on this same
  // lead row. `guestChatDay` is the UTC day the counters below apply to (reset
  // when a new day's first message lands). Per-IP metering is KV-side.
  guestChatDay:    date('guest_chat_day'),
  guestChatCount:  integer('guest_chat_count').notNull().default(0),
  guestChatTokens: integer('guest_chat_tokens').notNull().default(0),
  firstSeenAt:     timestamp('first_seen_at').notNull().defaultNow(),
  lastSeenAt:      timestamp('last_seen_at').notNull().defaultNow(),
}, (t) => ({
  byVisitor: uniqueIndex('uq_marketing_sessions_visitor').on(t.visitorId),
  byLastSeen: index('idx_marketing_sessions_last_seen').on(t.lastSeenAt),
}));


/** An ordered participant of an on-call rotation. memberRef is assignee-encoded:
 *  'u:<userId>' | 'c:<agentRef>' | 'contact:<businessContactId>'. */
export const onCallMembers = pgTable('on_call_members', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  rotationId:  uuid('rotation_id').notNull().references(() => onCallRotations.id, { onDelete: 'cascade' }),
  memberRef:   varchar('member_ref', { length: 72 }).notNull(),
  displayName: varchar('display_name', { length: 255 }),
  position:    integer('position').notNull().default(0),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  byRotation: index('idx_on_call_members_rotation').on(t.rotationId, t.position),
}));


/**
 * Distinct affected users per error group (migration 0245) — the set behind the
 * EXACT `error_groups.user_count`. The ingest path inserts (group_id, user_key)
 * with ON CONFLICT DO NOTHING and bumps user_count only for newly-inserted pairs.
 */
export const errorGroupUsers = pgTable('error_group_users', {
  groupId:   uuid('group_id').notNull().references(() => errorGroups.id, { onDelete: 'cascade' }),
  userKey:   varchar('user_key', { length: 255 }).notNull(),
  firstSeen: timestamp('first_seen').notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.groupId, t.userKey] }),
}));


export const tenantBenchmarkProfiles = pgTable('tenant_benchmark_profiles', {
  tenantId:  integer('tenant_id').primaryKey().references(() => tenants.id, { onDelete: 'cascade' }),
  industry:  varchar('industry', { length: 48 }).notNull().default('software_saas'),
  sizeBand:  varchar('size_band', { length: 16 }).notNull().default('mid'),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});


// ---------------------------------------------------------------------------
// Persona-role 2D RBAC — the lateral "lens persona" dimension (migration 0308).
// Orthogonal to the four-tier access level: reorders/highlights lenses, NOT an
// access grant. Exactly one is_primary per (tenant,user) (partial-unique in mig).
// ---------------------------------------------------------------------------
export const memberPersonas = pgTable('member_personas', {
  id:        uuid('id').primaryKey().defaultRandom(),
  tenantId:  integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  userId:    varchar('user_id', { length: 64 }).notNull(),
  persona:   varchar('persona', { length: 16 }).notNull(),
  isPrimary: boolean('is_primary').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  unique('uq_member_persona').on(t.tenantId, t.userId, t.persona),
]);


/**
 * BYO LLM provider credentials (0088). `keyEnc` holds EITHER an encrypted API
 * key (authType='api_key') or an encrypted `{access,refresh,expires}` JSON blob
 * (authType='oauth', 0198) — `authType` is the discriminator the storage layer
 * reads to decode it. `priority`: LOWER number = tried FIRST, NULL = unset (0338).
 */
export const tenantLlmProviderKeys = pgTable('tenant_llm_provider_keys', {
  tenantId:        integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  provider:        text('provider').notNull(),
  keyEnc:          text('key_enc').notNull(),
  createdByUserId: text('created_by_user_id'),
  authType:        text('auth_type').notNull().default('api_key'),
  priority:        integer('priority'),
  createdAt:       timestamp('created_at').notNull().defaultNow(),
  updatedAt:       timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.tenantId, t.provider] }),
}));

/**
 * OpenRouter CONNECTIONS (0382) — a tenant's named OpenRouter model sets.
 *
 * Distinct from {@link tenantLlmProviderKeys} on purpose: that table is one credential per
 * PROVIDER contributing one implicit frontier flagship, which cannot express "route through
 * OpenRouter on THESE models in THIS order". A connection is a label + 1..N model ids, and a
 * tenant may hold several.
 *
 * `keyEnc` is OPTIONAL: bound → the tenant's own OpenRouter account pays the tokens (row
 * recorded byo, token cost 0); NULL → the request rides the operator key and is priced from
 * the catalog. Either way the gateway routes and meters it, so the turn carries the flat
 * per-request platform surcharge.
 *
 * `priority` shares ONE integer space with `tenantLlmProviderKeys.priority` — both are
 * stamped from a single ordered list by `setByoPrecedence`, so connections and connected
 * providers interleave in one precedence list. NULL = unset (catalog-tier fallback).
 */
export const tenantOpenRouterConnections = pgTable('tenant_openrouter_connections', {
  id:              serial('id').primaryKey(),
  tenantId:        integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  label:           text('label').notNull(),
  keyEnc:          text('key_enc'),
  /** Bare OpenRouter model ids, in the operator's chosen order. Prefixed to
   *  `openrouter/<id>` at the routing boundary (never stored prefixed). */
  models:          jsonb('models').$type<string[]>().notNull().default([]),
  priority:        integer('priority'),
  createdByUserId: text('created_by_user_id'),
  createdAt:       timestamp('created_at').notNull().defaultNow(),
  updatedAt:       timestamp('updated_at').notNull().defaultNow(),
});
