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
import { authTokenTypeEnum, legalDocumentTypeEnum, memberAvailabilityStatusEnum, memberExperienceLevelEnum, memberProfileSyncSourceEnum, objects, segmentStatusEnum, teamMemberKindEnum, tenantIsolationModeEnum, tenantKindEnum, tenantRoleEnum, tenantStatusEnum } from './kernel';


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
  /** When this user last OPENED the Product Updates panel — the "read" clock behind
   *  the unread badge on the version chip. NULL = never opened, which the counter
   *  reads as `created_at` rather than as the epoch: notes published before someone
   *  signed up are not new TO THEM, so a fresh account starts unbadged with no
   *  backfill. (0475) */
  productUpdatesSeenAt:   timestamp('product_updates_seen_at'),
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


/**
 * A registered passkey (0988). Unlike `users.mfa_secret_enc` there is nothing here
 * to seal — a WebAuthn public key is public by construction and the private half
 * never leaves the authenticator, so possession of this row grants nothing.
 *
 * `credentialId` is unique platform-wide because a discoverable credential must
 * resolve to exactly one account before the server knows who is asking; that is
 * what makes a usernameless sign-in possible.
 */
export const webauthnCredentials = pgTable('webauthn_credentials', {
  id:              serial('id').primaryKey(),
  userId:          varchar('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  credentialId:    varchar('credential_id', { length: 512 }).notNull(),
  /** base64url COSE_Key. */
  publicKey:       text('public_key').notNull(),
  /** COSE algorithm identifier: -7 (ES256) or -257 (RS256). */
  algorithm:       integer('algorithm').notNull(),
  signCount:       bigint('sign_count', { mode: 'number' }).notNull().default(0),
  aaguid:          varchar('aaguid', { length: 64 }),
  transports:      varchar('transports', { length: 120 }),
  backupEligible:  boolean('backup_eligible').notNull().default(false),
  backedUp:        boolean('backed_up').notNull().default(false),
  name:            varchar('name', { length: 120 }).notNull().default('Passkey'),
  /** Recorded, never enforced — synced passkeys legitimately report 0 forever. */
  lastSignCountRegressedAt: timestamp('last_sign_count_regressed_at'),
  lastUsedAt:      timestamp('last_used_at'),
  createdAt:       timestamp('created_at').notNull().defaultNow(),
  updatedAt:       timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_webauthn_credentials_credential').on(t.credentialId),
  index('idx_webauthn_credentials_user').on(t.userId, t.createdAt),
]);


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
 * Tenant API keys (bfk_*) — the ONE credential presented by anything calling us
 * from outside a browser session: a tenant app (hired.video, burnrateos), a
 * customer's integration server, and — since 0472 — a PUBLISHER's CI shipping an
 * extension version.
 *
 * ── WHY THERE IS NO SECOND KEY TABLE ────────────────────────────────────────
 * There was one. `developer_api_keys` (0042) sat twenty lines above this and was
 * the same concept with a different owner: an outside caller, a hash, a scope
 * list, a revocation. 0467 tried to keep them apart by REMOVING a column until
 * `check-signature-duplication` stopped scoring them as one table — which dodges
 * a threshold rather than answering it. A developer is a tenant (0472), so the
 * credential a developer presents is a tenant key, and "what may this caller do"
 * has one answer in one place.
 *
 * Migrated `bfai_*` keys still resolve: both tables stored `hashSecret()` and
 * lookup is by hash, so the prefix is history rather than a routing decision.
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
  allowedOrigins:   jsonb('allowed_origins').$type<string[]>(),
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
   * The tenant's OWN brand palette (migration 0483) — a `BrandPalette`:
   * `{ primary, secondary, accent, text, background, logoUrl }`.
   *
   * The responder half of RFP co-branding. Before this column there was no
   * per-tenant brand-colour store anywhere in the platform, so every tenant's
   * proposal blended the requesting org against the same hard-coded Builderforce
   * accent set. NULL keeps that default; a stored palette replaces it.
   */
  brandPalette:           jsonb('brand_palette'),
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
  /**
   * Per-tenant daily ceiling on PREMIUM spend — the any-paid-OpenRouter tier a paid
   * tenant pins explicitly, billed at vendor cost plus a flat per-request surcharge —
   * in millicents (1/100000 USD), migration 0952.
   *
   * Its sibling above caps the overflow Builderforce funds on its OWN keys; this caps
   * what the tenant runs up on the metered long tail. They are separate ceilings
   * because they answer to different budgets, but they share one convention:
   *   NULL  → plan default (see `resolvePremiumDailyCapMillicents`)
   *   -1    → unlimited; the premium gate is skipped
   *   >= 0  → use this value instead of the plan default
   * Once exceeded the gateway refuses premium pins for the rest of the UTC day; the
   * tenant's plan pool still runs. Resets at UTC midnight.
   */
  premiumDailyCap:        integer('premium_daily_cap'),
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
  /**
   * ── THE PUBLISHER FACET (migration 0472) ────────────────────────────────
   * A developer IS a tenant. Publishing an extension is something a workspace
   * DOES, not a second kind of party — so these nine columns replaced
   * `developer_orgs` + `developer_org_members` outright rather than joining to
   * them. Every one is functionally dependent on `tenants.id` and 1:1 with the
   * row, which is what makes a facet a set of columns instead of a table.
   *
   * `publisherState` carries BOTH facts on one ordered scale — whether this
   * workspace publishes at all ('none') and how far it is verified. Splitting
   * "is a publisher" from "verification state" would permit the one combination
   * nobody wants: not a publisher, yet identity-verified.
   *
   * The vocabulary and the ordering live in `application/developer
   * /extensionContract.ts` (`PUBLISHER_STATES`), not here — a column is where a
   * fact is stored, not where its meaning is decided.
   */
  publisherState:         varchar('publisher_state', { length: 32 }).notNull().default('none'),
  publisherWebsite:       text('publisher_website'),
  publisherSupportEmail:  varchar('publisher_support_email', { length: 255 }),
  /** The domain being claimed, and the one-time token its DNS TXT record must
   *  carry. The token is never projected to a client: it is a challenge, and one
   *  readable from a listing would let anyone finish somebody else's claim. */
  publisherDomain:        varchar('publisher_domain', { length: 255 }),
  publisherVerificationToken: varchar('publisher_verification_token', { length: 64 }),
  publisherVerifiedAt:    timestamp('publisher_verified_at', { withTimezone: true }),
  /** Cross-domain id into `connections` (capability='payout'). Deliberately NOT a
   *  foreign key — payouts are the commerce domain's. */
  publisherPayoutConnectionId: uuid('publisher_payout_connection_id'),
  /** Standing a PUBLISHER down hides its listings everywhere at once. It is not
   *  `status`: a vendor whose listing broke a rule must not lose their own board. */
  publisherSuspendedAt:   timestamp('publisher_suspended_at', { withTimezone: true }),
  publisherSuspendedReason: text('publisher_suspended_reason'),
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
/**
 * `tenant_invitations` was DROPPED by migration 0435 (PRD 20 §5 step 5, family 1).
 * A workspace invitation is now an `invitations` row with `kind = 'tenant'` and a
 * null `object_id` — a workspace is not an addressable object in the registry.
 * Read and write it through `application/kernel/InvitationService`.
 */


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

// Skill assignment moved to `schema/agents.ts` as the single `skill_assignments`
// table (migration 1108): the tenant-level and host-level tables were one fact at
// two scopes. It lives with `agent_hosts`, which is the aggregate a host-scoped
// row names — Identity has no stake in which skills an agent may use.


// ---------------------------------------------------------------------------
// Chat sessions and messages
// ---------------------------------------------------------------------------



// ---------------------------------------------------------------------------
// Human chat participants (migration 0288) — the shared-access model. Until now a
// brain_chats row had a single owner (user_id) and every access check filtered by
// it, so a chat was strictly single-owner. This table is the human equivalent of
// an agent invite (agent_assignments scope='chat'): a member (active user_id, or a
// pending invited_email that converts on next access) may open, read, and post in a
// chat they do not own. Owner-only admin (rename/archive/invite) stays on user_id.
// ---------------------------------------------------------------------------



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
  pagesVisited:    jsonb('pages_visited').$type<{ path: string; ts: string }[]>().notNull().default([]),
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
  permissions: jsonb('permissions').$type<string[]>().notNull().default([]),
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
  permissions: jsonb('permissions').$type<string[]>().notNull().default([]),
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
  /**
   * Surrogate identity for THIS KEY INSTANCE (0953). The composite primary key below
   * is deliberately kept — it is what makes the write an upsert — so this is an
   * ADDITIONAL identity, not a replacement.
   *
   * Minted fresh whenever the stored key MATERIAL changes, which is the whole point:
   * a rotation overwrites the row in place, so without a value that changes with the
   * secret, a rotated key is indistinguishable from its predecessor and last month's
   * spend silently re-attributes to the new key. Usage rows carry it as
   * `llm_usage_log.byo_credential_id`.
   */
  id:              uuid('id').notNull().defaultRandom(),
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

// ═══ PRD 20 §5 step 2 — target-schema tables ═══
//
// Identity & tenancy — the platform's fifteen remaining targets (PRD 20 §3.2).
//
// 123 source tables in → 23 out: 56 absorbed by the kernel, 3 by the canvas, 38
// merged into a sibling — the largest "merged into a sibling" count in the model,
// because identity is where every product had grown its own near-duplicate of the
// same three nouns.
//
// Three flattening moves ran here (§3.2):
//   · FACET — `company_crm` was one row per company split by which screen read
//     it. It is columns on `companies` (Investor) now.
//   · KIND-SPLIT — `auth_user_sessions` = `extension_sessions` = `sessions`
//     shared user_id, user_agent and ip_address. One `sessions` with a `kind`.
//     `extension_sessions` survives as a NARROW row keyed to it, because the VS
//     Code extension carries workspace state a browser session does not.
//   · THIN — `team_projects` was ≤3 payload columns: an ordered join row, which
//     is a kernel `relations` row with a position.
//
// Decision 3 of §8 is settled here by precedent rather than by rename: this repo
// already uses `tenant_*` in 17 places against BurnRateOS's 11 `account_*`, and
// every gate in the platform runs on tenant. `tenant_` wins.

/**
 * A session, of any kind.
 *
 * The kind-split collapse: `auth_user_sessions`, `extension_sessions` and
 * `sessions` shared `user_id`, `user_agent` and `ip_address` and differed only in
 * which surface created them.
 */
export const sessions = pgTable('sessions', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    integer('tenant_id'),
  userId:      varchar('user_id', { length: 64 }).notNull(),
  /** 'web' | 'extension' | 'cli' | 'mobile' | 'api'. The column that replaced
   *  two tables. */
  kind:        varchar('kind', { length: 16 }).notNull().default('web'),
  tokenHash:   varchar('token_hash', { length: 64 }).notNull(),
  userAgent:   varchar('user_agent', { length: 500 }),
  ipAddress:   varchar('ip_address', { length: 45 }),
  /** Denormalised for the session list, which is one of the two surfaces
   *  `SessionList` renders — the other being /security. */
  deviceLabel: varchar('device_label', { length: 160 }),
  location:    varchar('location', { length: 160 }),
  lastSeenAt:  timestamp('last_seen_at'),
  expiresAt:   timestamp('expires_at'),
  revokedAt:   timestamp('revoked_at'),
  revokedBy:   varchar('revoked_by', { length: 64 }),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_sessions_token').on(t.tokenHash),
  index('idx_sessions_user').on(t.tenantId, t.userId, t.revokedAt),
]);

/** The workspace state a VS Code session carries that a browser session does
 *  not. A narrow satellite of `sessions` rather than a second session table:
 *  subtype payload goes in a typed row, never null-padded onto the union (§2.2). */
export const extensionSessions = pgTable('extension_sessions', {
  id:            serial('id').primaryKey(),
  tenantId:      integer('tenant_id'),
  sessionId:     uuid('session_id').references(() => sessions.id, { onDelete: 'cascade' }),
  extensionVersion: varchar('extension_version', { length: 32 }),
  vscodeVersion: varchar('vscode_version', { length: 32 }),
  workspaceName: varchar('workspace_name', { length: 255 }),
  workspaceHash: varchar('workspace_hash', { length: 64 }),
  repoRemote:    varchar('repo_remote', { length: 500 }),
  branch:        varchar('branch', { length: 255 }),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_extension_sessions_session').on(t.sessionId),
]);

/** A grant of access to one workspace. Distinct from a kernel `memberships` row
 *  because a workspace grant carries a filesystem SCOPE — which paths the holder
 *  may read — and a membership carries a role. */
export const workspaceGrants = pgTable('workspace_grants', {
  id:           serial('id').primaryKey(),
  tenantId:     integer('tenant_id').notNull(),
  workspaceRef: varchar('workspace_ref', { length: 64 }).notNull(),
  granteeKind:  varchar('grantee_kind', { length: 16 }).notNull().default('user'),
  granteeRef:   varchar('grantee_ref', { length: 64 }).notNull(),
  /** 'read' | 'write' | 'admin'. */
  access:       varchar('access', { length: 16 }).notNull().default('read'),
  /** Path globs. A grant without a scope is a grant over everything, which is
   *  what makes this column non-optional in practice even though it is nullable. */
  pathScope:    jsonb('path_scope'),
  grantedBy:    varchar('granted_by', { length: 64 }),
  expiresAt:    timestamp('expires_at'),
  revokedAt:    timestamp('revoked_at'),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_workspace_grants_grantee').on(t.tenantId, t.workspaceRef, t.granteeKind, t.granteeRef),
]);

/** ISO countries. A global catalogue, declared as one in
 *  `check-tenant-column.mjs` rather than left to look like an oversight. */
export const countries = pgTable('countries', {
  id:         serial('id').primaryKey(),
  code:       varchar('code', { length: 2 }).notNull(),
  code3:      varchar('code3', { length: 3 }),
  name:       varchar('name', { length: 120 }).notNull(),
  region:     varchar('region', { length: 64 }),
  currency:   varchar('currency', { length: 8 }),
  callingCode: varchar('calling_code', { length: 8 }),
  /** Whether the platform sells here — a compliance answer, not a geography one. */
  isSupported: boolean('is_supported').notNull().default(true),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_countries_code').on(t.code),
]);

/** The platform-wide company-stage vocabulary a tenant selects FROM. A tenant's
 *  own stages are `pipeline_stages` rows; this is the shared axis that makes two
 *  tenants' "Series A" the same thing. */
export const stageLookup = pgTable('stage_lookup', {
  id:          serial('id').primaryKey(),
  key:         varchar('key', { length: 48 }).notNull(),
  label:       varchar('label', { length: 120 }).notNull(),
  category:    varchar('category', { length: 32 }).notNull().default('company'),
  position:    integer('position').notNull().default(0),
  description: text('description'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_stage_lookup_key').on(t.category, t.key),
]);

/** When somebody is free. Read by booking, by interviews and by ceremonies —
 *  which is exactly why it is ONE table rather than three per-feature ones. */
export const availabilitySlots = pgTable('availability_slots', {
  id:         serial('id').primaryKey(),
  tenantId:   integer('tenant_id').notNull(),
  ownerRef:   varchar('owner_ref', { length: 64 }).notNull(),
  /** 'recurring' | 'one_off' | 'block'. A block is unavailability, which is the
   *  same shape with the sign flipped rather than a second table. */
  kind:       varchar('kind', { length: 16 }).notNull().default('recurring'),
  /** 0–6, Sunday-first. Null for a one-off. */
  weekday:    integer('weekday'),
  startsAt:   timestamp('starts_at'),
  endsAt:     timestamp('ends_at'),
  startMinute: integer('start_minute'),
  endMinute:  integer('end_minute'),
  timezone:   varchar('timezone', { length: 64 }).notNull().default('UTC'),
  /** The calendar this was synced from, if any. */
  connectionId: integer('connection_id'),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_availability_slots_owner').on(t.tenantId, t.ownerRef, t.kind),
]);

/** A named onboarding flow. */
export const onboardingFlows = pgTable('onboarding_flows', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id'),
  key:         varchar('key', { length: 64 }).notNull(),
  name:        varchar('name', { length: 200 }).notNull(),
  /** Which arrival it serves: 'signup' | 'invite' | 'hire' | 'employee' |
   *  'freelancer'. */
  audience:    varchar('audience', { length: 32 }).notNull().default('signup'),
  description: text('description'),
  isDefault:   boolean('is_default').notNull().default(false),
  enabled:     boolean('enabled').notNull().default(true),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_onboarding_flows_key').on(t.tenantId, t.key),
]);

/** A checklist within a flow. */
export const onboardingChecklists = pgTable('onboarding_checklists', {
  id:        serial('id').primaryKey(),
  tenantId:  integer('tenant_id'),
  flowId:    integer('flow_id').references(() => onboardingFlows.id, { onDelete: 'cascade' }),
  name:      varchar('name', { length: 200 }).notNull(),
  summary:   text('summary'),
  position:  integer('position').notNull().default(0),
  /** Whether the shell may proceed without it. Progressive disclosure gates
   *  state, never capability — a required step blocks, an optional one nudges. */
  isRequired: boolean('is_required').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_onboarding_checklists_pos').on(t.flowId, t.position),
]);

/** A step on a checklist. */
export const onboardingTasks = pgTable('onboarding_tasks', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id'),
  checklistId: integer('checklist_id').references(() => onboardingChecklists.id, { onDelete: 'cascade' }),
  key:         varchar('key', { length: 64 }).notNull(),
  title:       varchar('title', { length: 300 }).notNull(),
  description: text('description'),
  /** Where the step sends you. A route, so the CTA carries intent into the
   *  session rather than dropping the user on a dashboard. */
  actionHref:  varchar('action_href', { length: 500 }),
  /** How completion is detected: 'manual' | 'event' | 'query'. */
  completionKind: varchar('completion_kind', { length: 16 }).notNull().default('manual'),
  completionRule: jsonb('completion_rule'),
  position:    integer('position').notNull().default(0),
  isRequired:  boolean('is_required').notNull().default(false),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_onboarding_tasks_key').on(t.checklistId, t.key),
]);

/** How far one person got. */
export const onboardingProgress = pgTable('onboarding_progress', {
  id:         serial('id').primaryKey(),
  tenantId:   integer('tenant_id').notNull(),
  flowId:     integer('flow_id').references(() => onboardingFlows.id, { onDelete: 'cascade' }),
  taskId:     integer('task_id').references(() => onboardingTasks.id, { onDelete: 'cascade' }),
  subjectRef: varchar('subject_ref', { length: 64 }).notNull(),
  /** 'pending' | 'in_progress' | 'done' | 'skipped'. */
  status:     varchar('status', { length: 16 }).notNull().default('pending'),
  completedAt: timestamp('completed_at'),
  skippedReason: varchar('skipped_reason', { length: 200 }),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_onboarding_progress_subject').on(t.tenantId, t.taskId, t.subjectRef),
  index('idx_onboarding_progress_flow').on(t.tenantId, t.flowId, t.subjectRef),
]);

/** Somebody waiting for the platform to open in their region. */
export const regionWaitlist = pgTable('region_waitlist', {
  id:         serial('id').primaryKey(),
  tenantId:   integer('tenant_id'),
  email:      varchar('email', { length: 320 }).notNull(),
  country:    varchar('country', { length: 2 }),
  region:     varchar('region', { length: 120 }),
  source:     varchar('source', { length: 64 }),
  /** 'waiting' | 'invited' | 'joined' | 'declined'. */
  status:     varchar('status', { length: 16 }).notNull().default('waiting'),
  invitedAt:  timestamp('invited_at'),
  joinedAt:   timestamp('joined_at'),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_region_waitlist_email').on(t.email, t.country),
]);

/** A badge somebody holds. The badge's DEFINITION is `badges` (People); this is
 *  the award, which has its own moment and its own evidence. */
export const userBadges = pgTable('user_badges', {
  id:         serial('id').primaryKey(),
  tenantId:   integer('tenant_id').notNull(),
  userRef:    varchar('user_ref', { length: 64 }).notNull(),
  badgeKey:   varchar('badge_key', { length: 64 }).notNull(),
  awardedBy:  varchar('awarded_by', { length: 64 }),
  evidence:   jsonb('evidence'),
  awardedAt:  timestamp('awarded_at').notNull().defaultNow(),
  revokedAt:  timestamp('revoked_at'),
  /** Whether it shows on a public profile — an opt-in, like for-hire status. */
  isPublic:   boolean('is_public').notNull().default(true),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_user_badges_badge').on(t.tenantId, t.userRef, t.badgeKey),
]);

/** One person's use of one licensed stock asset. Metered against the licence's
 *  per-seat cap, which is why it is a row rather than a counter. */
export const userStockMediaUsage = pgTable('user_stock_media_usage', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  userRef:     varchar('user_ref', { length: 64 }).notNull(),
  stockAssetId: integer('stock_asset_id'),
  /** The `artifacts` row the asset was copied into. */
  artifactId:  uuid('artifact_id'),
  usedAt:      timestamp('used_at').notNull().defaultNow(),
  costCents:   integer('cost_cents').notNull().default(0),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('idx_user_stock_media_usage_user').on(t.tenantId, t.userRef, t.usedAt),
]);

/** A tenant's acceptance of terms, as an ORGANISATION rather than a person.
 *  Separate from `legal_document_acceptances` (Governance) on the same grounds
 *  that separate a party from a party role: the signatory is a person, the
 *  bound entity is the tenant, and an audit needs both. */
export const userTermsAgreements = pgTable('user_terms_agreements', {
  id:            serial('id').primaryKey(),
  tenantId:      integer('tenant_id').notNull(),
  signatoryRef:  varchar('signatory_ref', { length: 64 }).notNull(),
  documentKind:  varchar('document_kind', { length: 32 }).notNull(),
  documentVersion: varchar('document_version', { length: 32 }).notNull(),
  signatoryTitle: varchar('signatory_title', { length: 160 }),
  legalEntityName: varchar('legal_entity_name', { length: 255 }),
  agreedAt:      timestamp('agreed_at').notNull().defaultNow(),
  supersededAt:  timestamp('superseded_at'),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_user_terms_agreements_version').on(t.tenantId, t.documentKind, t.documentVersion),
]);

/** A discussion pinned to a working session. Not a `threads` row: this is the
 *  session's AGENDA of topics, each of which opens a thread — the topic outlives
 *  the conversation and can be carried into the next session. */
export const sessionDiscussions = pgTable('session_discussions', {
  id:         serial('id').primaryKey(),
  tenantId:   integer('tenant_id').notNull(),
  objectId:   uuid('object_id').references(() => objects.id, { onDelete: 'cascade' }),
  sessionRef: varchar('session_ref', { length: 64 }).notNull(),
  topic:      varchar('topic', { length: 300 }).notNull(),
  /** The `threads` row opened for it, once somebody says something. */
  threadId:   uuid('thread_id'),
  raisedBy:   varchar('raised_by', { length: 64 }),
  /** 'open' | 'discussed' | 'deferred' | 'closed'. */
  status:     varchar('status', { length: 16 }).notNull().default('open'),
  position:   integer('position').notNull().default(0),
  /** Set when the topic is carried into a later session rather than dropped. */
  carriedToRef: varchar('carried_to_ref', { length: 64 }),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_session_discussions_session').on(t.tenantId, t.sessionRef, t.position),
]);

/**
 * The ONE one-time email code store.
 *
 * `check-signature-duplication.mjs` scored the new `email_otp_challenges`
 * against the existing `email_verification_codes` at **0.62** — over the 0.55
 * gate — and it was right: they were the same table. One was issued at password
 * signup to prove ownership of an address (migration 0285), the other for a
 * newsletter double opt-in and a gated download. Same code, same hash-only
 * storage, same expiry, same attempt cap, same single-use rule; the only
 * difference was which feature asked.
 *
 * So `email_verification_codes` is gone and `purpose` is a column — the §0 rule
 * applied to a table that already existed, rather than only to the new one.
 * Migration 0433 carries its rows across and drops it.
 *
 * FILED IN IDENTITY, NOT GROWTH. The coverage map put `email_otp_challenges` in
 * Growth because a marketing double opt-in is what BurnRateOS used it for. It is
 * an authentication primitive: it gates account activation, so it belongs to the
 * seat that owns identity. PRD 20 §9 records this class of correction explicitly
 * — the domain classifier carries about 5% noise and `admin_impersonation_sessions`
 * landing in Growth is the example it gives.
 *
 * NO TENANT COLUMN, deliberately, and the predecessor had none either. A signup
 * challenge is issued BEFORE the account exists, so there is no tenant to scope
 * it to; the scope is (userRef, purpose), which is narrower than tenant rather
 * than looser. `check-tenant-column.mjs` records that as a decision.
 *
 * The raw code is NEVER persisted, only its SHA-256 hash.
 */
export const emailOtpChallenges = pgTable('email_otp_challenges', {
  id:          serial('id').primaryKey(),
  /** 'signup_verification' | 'subscribe' | 'gated_download' | 'email_change' —
   *  the column that replaced the second table. */
  purpose:     varchar('purpose', { length: 48 }).notNull().default('signup_verification'),
  email:       varchar('email', { length: 320 }).notNull(),
  /** users.id when the challenge belongs to an account. Null for an anonymous
   *  marketing opt-in, which has an address and nothing else. */
  userRef:     varchar('user_ref', { length: 64 }),
  codeHash:    varchar('code_hash', { length: 64 }).notNull(),
  attempts:    integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(5),
  /** Set on success AND on supersession — only the newest outstanding challenge
   *  can verify, and a provider rejection retires the row it created. */
  consumedAt:  timestamp('consumed_at'),
  expiresAt:   timestamp('expires_at').notNull(),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('idx_email_otp_challenges_user').on(t.userRef, t.consumedAt, t.createdAt),
  index('idx_email_otp_challenges_email').on(t.email, t.purpose, t.expiresAt),
]);

// ---------------------------------------------------------------------------
// Enterprise SSO — the institution's own IdP, over OIDC
// ---------------------------------------------------------------------------

/**
 * One enterprise SSO connection.
 *
 * OIDC ONLY, deliberately, and migration 0482 carries the full argument. The
 * short version: SAML 2.0's hard part is verifying the signed Response —
 * exclusive canonicalisation plus reference-digest validation before the RSA
 * check — where a mistake is an XML signature-wrapping AUTHENTICATION BYPASS that
 * looks exactly like a working login. So SAML is terminated at a gateway that
 * already speaks it (the customer's choice of WorkOS / Auth0 / Okta / Entra),
 * their Shibboleth or InCommon IdP talks SAML to that, and every signature THIS
 * codebase verifies stays an RS256 JWS — the primitive WebCrypto implements and
 * `LtiService.ts` already verifies the same way.
 *
 * `protocol` exists so that decision is legible in the data rather than implied
 * by the absence of code. Only 'oidc' is accepted, and the refusal says why.
 *
 * ── WHY THIS IS NOT A ROW IN `connections` ──────────────────────────────────
 * The name matches the kernel `connection` shape and `check-shape-lint.mjs` asks
 * about it, correctly. It is a different noun, and the direction is what
 * separates them. A kernel `connections` row is a PERSON's OUTBOUND grant — it
 * is keyed `(tenant, user, vendor, capability, external_account)` so the platform
 * can call Gmail or Jira as that user, and its whole reason to exist is that two
 * colleagues connecting the same workspace must not overwrite one another.
 *
 * This is the WORKSPACE's INBOUND identity provider. It has no user (it is what
 * decides who a user IS), no vendor manifest key (the IdP is the customer's, not
 * one we integrate against), and no capability. Its identity is
 * `(issuer, client_id)`, unique platform-wide, and `sso_domains` carries a
 * foreign key to it. Folding it in would mean a connection row with a null user,
 * an invented vendor and capability, the endpoints buried in `config` jsonb, and
 * the `(issuer, client_id)` uniqueness downgraded from a constraint to a
 * convention — strictly worse on the 3NF grounds the kernel exists to serve.
 */
export const ssoConnections = pgTable('sso_connections', {
  id:               serial('id').primaryKey(),
  tenantId:         integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  /** What an administrator recognises: "University of Melbourne (Okta)". */
  label:            varchar('label', { length: 160 }).notNull(),
  /** 'oidc'. See the note above. */
  protocol:         varchar('protocol', { length: 16 }).notNull().default('oidc'),
  issuer:           varchar('issuer', { length: 255 }).notNull(),
  /** When set, the four endpoints are read from the IdP's own discovery
   *  document. Typed values still win, so a provider with a broken document is
   *  connectable by hand. */
  discoveryUrl:     text('discovery_url'),
  authorizationUrl: text('authorization_url'),
  tokenUrl:         text('token_url'),
  jwksUrl:          text('jwks_url'),
  userinfoUrl:      text('userinfo_url'),
  clientId:         varchar('client_id', { length: 255 }).notNull(),
  /** The `credentialCrypto` envelope — the same seal `lti_registrations` uses. */
  clientSecretEnc:  text('client_secret_enc').notNull(),
  clientSecretIv:   varchar('client_secret_iv', { length: 32 }).notNull(),
  scopes:           varchar('scopes', { length: 255 }).notNull().default('openid email profile'),
  /** Off means the IdP authenticates an unknown person and we still refuse —
   *  what an institution that provisions seats by hand asks for. */
  jitProvisioning:  boolean('jit_provisioning').notNull().default(true),
  defaultRole:      varchar('default_role', { length: 32 }).notNull().default('developer'),
  status:           varchar('status', { length: 16 }).notNull().default('active'),
  createdBy:        varchar('created_by', { length: 64 }),
  createdAt:        timestamp('created_at').notNull().defaultNow(),
  updatedAt:        timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_sso_connections_issuer_client').on(t.issuer, t.clientId),
  index('idx_sso_connections_tenant').on(t.tenantId, t.status),
]);

/**
 * Email domain → SSO connection.
 *
 * A TABLE and not a jsonb array on the connection, unlike
 * `lti_registrations.deployment_ids`, because this one is queried ACROSS rows:
 * "which connection owns physics.edu" is asked on every sign-in attempt. The
 * unique index is the rule as well as the index — two workspaces both claiming a
 * domain would make the routing answer ambiguous, and ambiguity at an auth
 * boundary resolves arbitrarily rather than refusing.
 *
 * Only a VERIFIED row routes. An unverified claim on a domain is a takeover of
 * every sign-in from it.
 */
export const ssoDomains = pgTable('sso_domains', {
  id:           serial('id').primaryKey(),
  tenantId:     integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  connectionId: integer('connection_id').notNull().references(() => ssoConnections.id, { onDelete: 'cascade' }),
  domain:       varchar('domain', { length: 255 }).notNull(),
  verifiedAt:   timestamp('verified_at'),
  /** The DNS TXT value that proves control. Random per row, never derived from
   *  the domain, so it cannot be guessed from the name. */
  verifyToken:  varchar('verify_token', { length: 64 }).notNull(),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_sso_domains_domain').on(t.domain),
  index('idx_sso_domains_connection').on(t.connectionId),
]);


// =========================================================================
// `team` is one of this seat’s three declared kinds (user / team / workspace) and
// `teams` is the row a team IS — declared, until this move, in `canvas.ts`, which
// then had to be imported back here and by `delivery.ts` to attach a team to work.
// It references nothing outside identity, so it belongs here and travels whole.
// =========================================================================


export const teams = pgTable('teams', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:   uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),  // DB NOT NULL via trigger (0056); optional in TS so single-mode writes need no change
  name:        varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  /** A team can give itself an avatar (0294) — shown on the team card + as the face
   *  of its team chat. An /api/brain/upload R2 URL or any image URL. */
  avatarUrl:   text('avatar_url'), // unbounded image URL (R2 upload w/ query params); widened mig 0356
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
});
