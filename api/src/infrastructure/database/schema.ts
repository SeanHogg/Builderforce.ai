import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  pgEnum,
  customType,
  primaryKey,
  serial,
  varchar,
  smallint,
  bigint,
  bigserial,
  date,
  real,
  jsonb,
  unique,
  uniqueIndex,
  index,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * Data model aligns with product flow (see README "Data model & API"):
 * Brain Storm (ideate) → Execute → Project → IDE (build) or Tasks + Workforce (assign to AgentHosts).
 * Unified chats: brain_chats (all modalities via `origin` + optional projectId). Tasks link projects to agentHosts/executions.
 */

// custom tsvector type for full-text search
const tsvector = customType<{ data: string }>({
  dataType() { return 'tsvector'; },
});

// ---------------------------------------------------------------------------
// Enum columns (Builderforce orchestration)
// ---------------------------------------------------------------------------

export const projectStatusEnum = pgEnum('project_status', [
  'active', 'completed', 'archived', 'on_hold',
]);

// Task status is a free-form varchar (see migration 0076): a project's swimlanes
// define its board columns, so a task's status is whatever lane key it sits in.
// The canonical default statuses live in the app-layer `TaskStatus` enum.

export const taskPriorityEnum = pgEnum('task_priority', [
  'low', 'medium', 'high', 'urgent',
]);

export const agentTypeEnum = pgEnum('agent_type', [
  'claude', 'openai', 'ollama', 'http',
]);

// Task type is a fixed, automation-driven dimension (unlike the free-form
// per-board `status` lane key): a plain `task`, or an `epic` that decomposes
// into child tasks (parent_task_id) — see migration 0112.
export const taskTypeEnum = pgEnum('task_type', [
  'task', 'epic', 'gap', 'security',
  // Incident ticket (migration 0325): a first-class board card the Incident Manager
  // agent works, bridged to a prod_incidents record.
  'incident',
  // Hireable work-item kinds (migration 0293): a full product/scope brief a
  // Product-Manager agent authors + publishes for a fixed-bid build, and a UI/UX
  // design (or design-review) gig. Both are publishable to the Gig Marketplace.
  'product', 'design',
]);

export const tenantStatusEnum = pgEnum('tenant_status', [
  'active', 'suspended', 'archived',
]);

export const tenantRoleEnum = pgEnum('tenant_role', [
  'owner', 'manager', 'developer', 'viewer',
]);

// Segment tier (see README "Segment tier"): the isolation level between tenant
// and entity for tenants that are themselves multi-tenant.
export const segmentStatusEnum = pgEnum('segment_status', [
  'active', 'suspended', 'archived',
]);

// How a tenant authenticates users: 'direct' = BuilderForce is the IdP
// (local/OAuth/magic-link, the current model); 'embedded' = an external host is
// the OIDC IdP and identity arrives as claims.
export const tenantKindEnum = pgEnum('tenant_kind', [
  'embedded', 'direct',
]);

// Whether a tenant sub-divides into segments. 'single' tenants are pinned to one
// default segment; 'segmented' tenants get one segment per end-client.
export const tenantIsolationModeEnum = pgEnum('tenant_isolation_mode', [
  'single', 'segmented',
]);

export const sourceControlProviderEnum = pgEnum('source_control_provider', [
  'github', 'bitbucket',
]);

export const authTokenTypeEnum = pgEnum('auth_token_type', [
  'web', 'tenant', 'api', 'host',
]);

export const legalDocumentTypeEnum = pgEnum('legal_document_type', [
  'terms', 'privacy',
]);

export const newsletterSubscriptionStatusEnum = pgEnum('newsletter_subscription_status', [
  'subscribed', 'unsubscribed', 'suppressed',
]);

export const newsletterEventTypeEnum = pgEnum('newsletter_event_type', [
  'subscribed', 'unsubscribed', 'template_sent', 'email_opened', 'email_clicked',
]);

export const privacyRequestTypeEnum = pgEnum('privacy_request_type', [
  'ccpa', 'gdpr',
]);

export const privacyRequestStatusEnum = pgEnum('privacy_request_status', [
  'pending', 'completed', 'closed',
]);

export const executionStatusEnum = pgEnum('execution_status', [
  'pending', 'submitted', 'running', 'completed', 'failed', 'cancelled',
  // Non-terminal: a cloud run that called ask_human and is waiting on a person
  // (migration 0120). Not spending, not terminal — resumes once the question is
  // answered. The reaper's running/pending/submitted sweeps deliberately skip it.
  'paused',
]);

export const agentHostStatusEnum = pgEnum('agent_host_status', ['active', 'inactive', 'suspended']);
export const agentHostDirectoryStatusEnum = pgEnum('agent_host_directory_status', ['pending', 'synced', 'error']);

export const specStatusEnum = pgEnum('spec_status', ['draft', 'ready', 'in_progress', 'complete']);
export const workflowTypeEnum = pgEnum('workflow_type', ['feature', 'bugfix', 'refactor', 'planning', 'adversarial', 'custom']);
export const workflowStatusEnum = pgEnum('workflow_status', ['pending', 'running', 'completed', 'failed', 'cancelled']);
export const workflowTaskStatusEnum = pgEnum('workflow_task_status', ['pending', 'running', 'completed', 'failed', 'cancelled']);
export const approvalStatusEnum = pgEnum('approval_status', ['pending', 'approved', 'rejected', 'expired', 'answered']);

export const artifactTypeEnum = pgEnum('artifact_type', ['skill', 'persona', 'content']);
export const assignmentScopeEnum = pgEnum('assignment_scope', ['tenant', 'host', 'project', 'task', 'agent']);
export const pricingModelEnum = pgEnum('pricing_model', ['flat_fee', 'consumption']);

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

/**
 * Per-address email consent — the record every LIFECYCLE send checks and no
 * TRANSACTIONAL send does. Keyed on EMAIL, not user id: a cold workspace/chat
 * invite goes to an address with no `users` row, and an unsubscribe taken from
 * that mail must survive both "no account yet" and "account later deleted"
 * (hence `userId` is a nullable ON DELETE SET NULL convenience link, not the key).
 *
 * A MISSING row means "no preference expressed" and reads as all-allowed, exactly
 * like the column defaults — so the reader never has to distinguish the two.
 * `unsubscribedAll` is the CAN-SPAM global opt-out and overrides every category.
 * (0352)
 */
export const emailPreferences = pgTable('email_preferences', {
  id:               uuid('id').primaryKey().defaultRandom(),
  userId:           varchar('user_id', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  email:            varchar('email', { length: 255 }).notNull().unique(),
  productUpdates:   boolean('product_updates').notNull().default(true),
  onboardingTips:   boolean('onboarding_tips').notNull().default(true),
  digests:          boolean('digests').notNull().default(true),
  unsubscribedAll:  boolean('unsubscribed_all').notNull().default(false),
  unsubscribedAt:   timestamp('unsubscribed_at'),
  createdAt:        timestamp('created_at').notNull().defaultNow(),
  updatedAt:        timestamp('updated_at').notNull().defaultNow(),
});

/**
 * PLATFORM release notes — Builderforce's own changelog, marketed to every user.
 * Deliberately NOT tenant-scoped (contrast `changelog_entries`, which is each
 * tenant's changelog for THEIR product): one global list feeds the footer
 * "What's new" panel and the weekly product-updates digest email.
 *
 * `publishedAt` NULL = draft (invisible everywhere). `emailedAt` is the "sent"
 * flag the weekly digest sets — NULL + published = "will be in the next digest".
 * (0358)
 */
export const releaseNotes = pgTable('release_notes', {
  id:          uuid('id').primaryKey().defaultRandom(),
  version:     varchar('version', { length: 50 }).notNull(),
  title:       varchar('title', { length: 255 }).notNull(),
  body:        text('body'),
  /** 'new' | 'improvement' | 'fix' — drives the badge in the panel + email. */
  category:    varchar('category', { length: 20 }).notNull().default('improvement'),
  publishedAt: timestamp('published_at'),
  emailedAt:   timestamp('emailed_at'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
});

export const newsletterSubscribers = pgTable('newsletter_subscribers', {
  id:                  serial('id').primaryKey(),
  userId:              varchar('user_id', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  email:               varchar('email', { length: 255 }).notNull().unique(),
  firstName:           varchar('first_name', { length: 120 }),
  lastName:            varchar('last_name', { length: 120 }),
  source:              varchar('source', { length: 120 }).notNull().default('marketing_site'),
  status:              newsletterSubscriptionStatusEnum('status').notNull().default('subscribed'),
  subscribedAt:        timestamp('subscribed_at').notNull().defaultNow(),
  unsubscribedAt:      timestamp('unsubscribed_at'),
  unsubscribeReason:   text('unsubscribe_reason'),
  lastCommunicationAt: timestamp('last_communication_at'),
  createdAt:           timestamp('created_at').notNull().defaultNow(),
  updatedAt:           timestamp('updated_at').notNull().defaultNow(),
});

export const newsletterTemplates = pgTable('newsletter_templates', {
  id:            serial('id').primaryKey(),
  name:          varchar('name', { length: 180 }).notNull(),
  slug:          varchar('slug', { length: 180 }).notNull().unique(),
  subject:       varchar('subject', { length: 255 }).notNull(),
  preheader:     varchar('preheader', { length: 255 }),
  bodyMarkdown:  text('body_markdown').notNull(),
  isActive:      boolean('is_active').notNull().default(true),
  createdBy:     varchar('created_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  updatedBy:     varchar('updated_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
});

export const newsletterEvents = pgTable('newsletter_events', {
  id:            serial('id').primaryKey(),
  subscriberId:  integer('subscriber_id').notNull().references(() => newsletterSubscribers.id, { onDelete: 'cascade' }),
  templateId:    integer('template_id').references(() => newsletterTemplates.id, { onDelete: 'set null' }),
  eventType:     newsletterEventTypeEnum('event_type').notNull(),
  metadata:      text('metadata'),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
});

export const privacyRequests = pgTable('privacy_requests', {
  id:           serial('id').primaryKey(),
  userId:       varchar('user_id', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  email:        varchar('email', { length: 255 }).notNull(),
  requestType:  privacyRequestTypeEnum('request_type').notNull(),
  details:      text('details'),
  status:       privacyRequestStatusEnum('status').notNull().default('pending'),
  resolution:   text('resolution'),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
  closedAt:     timestamp('closed_at'),
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

export const apiErrorLog = pgTable('api_error_log', {
  id:        serial('id').primaryKey(),
  method:    varchar('method', { length: 10 }),
  path:      varchar('path', { length: 500 }),
  message:   text('message'),
  stack:     text('stack'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const llmUsageLog = pgTable('llm_usage_log', {
  id:               serial('id').primaryKey(),
  tenantId:         integer('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
  userId:           varchar('user_id', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  llmProduct:       varchar('llm_product', { length: 32 }).notNull().default('builderforceLLM'),
  model:            varchar('model', { length: 200 }).notNull(),
  promptTokens:     integer('prompt_tokens').notNull().default(0),
  completionTokens: integer('completion_tokens').notNull().default(0),
  totalTokens:      integer('total_tokens').notNull().default(0),
  /** Prompt-cache breakdown (subset of prompt_tokens). cache_read is billed at
   *  ~0.1x input rate, cache_creation at ~1.25x — persisted so cost accounting
   *  reflects the discount instead of charging cached input at full rate. */
  cacheReadTokens:     integer('cache_read_tokens').notNull().default(0),
  cacheCreationTokens: integer('cache_creation_tokens').notNull().default(0),
  retries:          integer('retries').notNull().default(0),
  streamed:         boolean('streamed').notNull().default(false),
  /** Caller-supplied metadata for billing trace-back ({ toolRunId, sessionId, userId, … }). */
  metadata:         text('metadata'),  // JSONB on the wire; stringified on insert.
  /** SDK-supplied Idempotency-Key — gateway will use this to dedupe retries (TTL TBD). */
  idempotencyKey:   varchar('idempotency_key', { length: 128 }),
  /** Opaque telemetry slug from `body.useCase`. Free-form; tenant taxonomy. */
  useCase:          varchar('use_case', { length: 128 }),
  /** Which `bfk_*` key authenticated this request. Null for `clk_*` / web JWT auth. */
  tenantApiKeyId:   uuid('tenant_api_key_id'),
  // Agent attribution (0096) — lets usage/cost be split CLOUD vs ON-PREM vs WEB.
  // A row with all three null is a web/SDK call.
  /** Self-hosted (on-prem) agent host that made the call. */
  agentHostId:      integer('agent_host_id').references(() => agentHosts.id, { onDelete: 'set null' }),
  /** Cloud agent run (ide_agents.id, or null for the gateway-default bucket). */
  cloudAgentRef:    varchar('cloud_agent_ref', { length: 64 }),
  /** Execution a cloud-run usage row belongs to (trace key). */
  executionId:      integer('execution_id'),
  /** Ticket (task) this spend is attributed to (0104) — the finest grain. Cost
   *  rolls up ticket → project → account. Stamped from the run's task; null for
   *  web/SDK calls. */
  taskId:           integer('task_id').references(() => tasks.id, { onDelete: 'set null' }),
  /** Project this spend is attributed to (0103) — lets cost roll up project →
   *  account. Stamped from the run's task→project; null for web/SDK calls. */
  projectId:        integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
  /** Authoritative cost stamped at write time from the resolved model's price
   *  (incl. cache tiers), in millicents (1/100000 USD) — see migration 0097.
   *  The dashboard sums this instead of re-pricing tokens at read time. */
  costUsdMillicents: integer('cost_usd_millicents').notNull().default(0),
  /** The `llm_traces.trace_id` for this call (migration 0125), so a superadmin
   *  can pivot from a usage/billing row to its full diagnostic trace [1299].
   *  Null for usage rows written without a trace (e.g. BYO-key passthrough). */
  traceId:          varchar('trace_id', { length: 48 }),
  /** True when this call resolved via the funded paid-overflow path (premium
   *  fallback / reliability backstop on Builderforce's own key, not a plan-pool
   *  model) — migration 0130. Summed (by cost) against the tenant's
   *  `paid_overflow_daily_cap` so a Free tenant can't run up arbitrary spend on
   *  our keys via a tight retry loop. */
  paidOverflow:     boolean('paid_overflow').notNull().default(false),
  /** True when this call was served by the tenant's OWN provider credential — a
   *  BYO API key or a connected subscription (migration 0284). The platform pays
   *  nothing for these tokens, so `cost_usd_millicents` is forced to 0, and a BYO
   *  row on the on-prem / VSIX `surface` is EXEMPT from the plan token allowance
   *  (see tokenUsage.ts). BYO cloud-agent rows still count (charged). */
  byo:              boolean('byo').notNull().default(false),
  /** Connected LLM provider credential that funded a BYO call (for example
   *  'anthropic' or 'google'). Null for platform-funded calls. */
  byoProvider:      varchar('byo_provider', { length: 32 }),
  /** Which agent modality produced this row (migration 0284): 'web' | 'vsix' |
   *  'on_prem' | 'cloud' | 'sdk'. Drives the BYO metering exemption above so
   *  own-machine (on-prem/VSIX) BYO usage is free while cloud BYO is charged. */
  surface:          varchar('surface', { length: 16 }).notNull().default('web'),
  createdAt:        timestamp('created_at').notNull().defaultNow(),
});

/**
 * Data-ingestion ledger (migration 0218) — the append-only record of data
 * PROCESSED through system integrations (repo content imports, etc.). The
 * non-token half of the consumption meter: where llm_usage_log meters AI tokens,
 * this meters bytes ingested, so free-vs-paid can cap the real cost driver
 * (linking/processing lots of repo data) WITHOUT capping what a user can see.
 * Summed month-to-date against the plan's ingestion allowance (PlanLimits) by the
 * shared accountant in application/ingestion/ingestionLedger.ts.
 */
export const ingestionUsageLog = pgTable('ingestion_usage_log', {
  id:            serial('id').primaryKey(),
  tenantId:      integer('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
  /** Project the ingestion is attributed to (null for tenant-level sources). */
  projectId:     integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
  /** What was ingested: 'repo_import' today; room for 'integration_sync' etc. */
  source:        varchar('source', { length: 32 }).notNull().default('repo_import'),
  /** Integration provider (github/gitlab/…), when applicable. */
  provider:      varchar('provider', { length: 32 }),
  /** Bytes of content actually pulled/processed — the metered quantity. */
  bytesIngested: bigint('bytes_ingested', { mode: 'number' }).notNull().default(0),
  /** Discrete items processed (files, records) — informational alongside bytes. */
  itemsIngested: integer('items_ingested').notNull().default(0),
  /** Caller-supplied trace-back ({ repoId, ref, truncated, … }); stringified. */
  metadata:      text('metadata'),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
});

export const llmFailoverLog = pgTable('llm_failover_log', {
  id:        serial('id').primaryKey(),
  model:     varchar('model', { length: 200 }).notNull(),
  errorCode: integer('error_code').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

/**
 * Per-vendor health-probe results. One row per run. `modelsJson` is a JSONB
 * array of `{ model, ok, status, latencyMs, error? }`. Declared `jsonb` to match
 * the live column created by migration 0050 (was previously mis-declared `text`,
 * a schema-drift item [1449]); the pg driver auto-decodes JSONB to a JS array.
 * Used by the admin UI vendor cards and the scheduled() cron handler.
 */
export const llmHealthProbes = pgTable('llm_health_probes', {
  id:           serial('id').primaryKey(),
  vendor:       varchar('vendor', { length: 32 }).notNull(),
  status:       varchar('status', { length: 16 }).notNull(),
  probedCount:  integer('probed_count').notNull().default(0),
  okCount:      integer('ok_count').notNull().default(0),
  failedCount:  integer('failed_count').notNull().default(0),
  latencyMs:    integer('latency_ms').notNull().default(0),
  modelsJson:   jsonb('models_json')
    .$type<Array<{ model: string; ok: boolean; status: number; latencyMs: number; error?: string }>>()
    .notNull().default([]),
  trigger:      varchar('trigger', { length: 16 }).notNull(),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
});

/**
 * Full per-call diagnostic trace for every BuilderLLM gateway request — one row
 * per LLM call, keyed by the authoritative `traceId` (`llm-<uuid>`) the gateway
 * generates. The trace id (and ONLY the trace id) is echoed to the caller; the
 * full details captured here NEVER leave the builder side — they exist solely
 * for superadmin diagnostics (who called, how long, every model attempt, every
 * exception, the candidate chain, and the request/response bodies). Written
 * fire-and-forget (ctx.waitUntil) so tracing never adds latency. JSON columns
 * are `text` per this schema's convention (the pg driver decodes at read time).
 */
export const llmTraces = pgTable('llm_traces', {
  id:                serial('id').primaryKey(),
  traceId:           varchar('trace_id', { length: 48 }).notNull().unique(),
  tenantId:          integer('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
  userId:            varchar('user_id', { length: 36 }),
  agentHostId:            integer('agent_host_id'),
  tenantApiKeyId:    uuid('tenant_api_key_id'),
  llmProduct:        varchar('llm_product', { length: 32 }),
  /** chat | image | ide-chat | brain | dataset-gen | agent */
  surface:           varchar('surface', { length: 16 }).notNull().default('chat'),
  effectivePlan:     varchar('effective_plan', { length: 8 }),
  premiumOverride:   boolean('premium_override').notNull().default(false),
  resolvedModel:     varchar('resolved_model', { length: 200 }),
  resolvedVendor:    varchar('resolved_vendor', { length: 32 }),
  /** Final HTTP status returned to the caller. */
  status:            integer('status'),
  success:           boolean('success').notNull().default(false),
  /** success | cascade_exhausted | all_cooldown | subrequest_exhausted | strict_unavailable | schema_nonconforming */
  outcome:           varchar('outcome', { length: 32 }),
  /** rate_limit | timeout | auth | server_error | mixed | none */
  classification:    varchar('classification', { length: 16 }),
  attemptCount:      integer('attempt_count').notNull().default(0),
  retries:           integer('retries').notNull().default(0),
  schemaRetries:     integer('schema_retries').notNull().default(0),
  durationMs:        integer('duration_ms').notNull().default(0),
  promptTokens:      integer('prompt_tokens').notNull().default(0),
  completionTokens:  integer('completion_tokens').notNull().default(0),
  totalTokens:       integer('total_tokens').notNull().default(0),
  useCase:           varchar('use_case', { length: 128 }),
  idempotencyKey:    varchar('idempotency_key', { length: 128 }),
  /** Caller's own x-request-id / x-correlation-id, for cross-referencing. */
  consumerRequestId: varchar('consumer_request_id', { length: 128 }),
  requestIp:         varchar('request_ip', { length: 64 }),
  origin:            varchar('origin', { length: 255 }),
  userAgent:         text('user_agent'),
  streamed:          boolean('streamed').notNull().default(false),
  errorMessage:      text('error_message'),
  /** JSON-as-text detail blobs (superadmin-only). */
  requestShape:      text('request_shape'),
  candidateChain:    text('candidate_chain'),
  attempts:          text('attempts'),       // [{ model, vendor, status, kind, durationMs, error }]
  requestBody:       text('request_body'),    // full messages (verbatim, builder-side only)
  responseBody:      text('response_body'),   // final completion or error envelope
  callerMetadata:    text('caller_metadata'),
  createdAt:         timestamp('created_at').notNull().defaultNow(),
});

export const projectInsightEvents = pgTable('project_insight_events', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId: uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),  // DB NOT NULL via trigger (0056); optional in TS so single-mode writes need no change
  projectId:   integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  userId:      varchar('user_id', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  executionId: integer('execution_id').references(() => executions.id, { onDelete: 'set null' }),
  codeChanges: integer('code_changes').notNull().default(0),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Marketplace tables
// ---------------------------------------------------------------------------

export const marketplaceSkills = pgTable('marketplace_skills', {
  id:           serial('id').primaryKey(),
  name:         varchar('name', { length: 255 }).notNull(),
  slug:         varchar('slug', { length: 255 }).notNull().unique(),
  description:  text('description'),
  authorId:     varchar('author_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  category:     varchar('category', { length: 100 }).notNull(),
  tags:         text('tags'),
  version:      varchar('version', { length: 50 }).notNull().default('1.0.0'),
  readme:       text('readme'),
  iconUrl:      varchar('icon_url', { length: 500 }),
  repoUrl:      varchar('repo_url', { length: 500 }),
  downloads:    integer('downloads').notNull().default(0),
  likes:        integer('likes').notNull().default(0),
  published:    boolean('published').notNull().default(false),
  /** Price in USD cents (0 = free). Stored as integer cents to avoid floating point. */
  priceCents:   integer('price_cents').notNull().default(0),
  pricingModel: pricingModelEnum('pricing_model').notNull().default('flat_fee'),
  priceUnit:    varchar('price_unit', { length: 100 }),
  searchVector: tsvector('search_vector'),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const marketplaceSkillLikes = pgTable('marketplace_skill_likes', {
  userId:    varchar('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  skillSlug: varchar('skill_slug', { length: 255 }).notNull(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.skillSlug] }),
]);

/**
 * Unified artifact likes — tracks likes for any artifact type (skill, persona, content).
 */
export const artifactLikes = pgTable('artifact_likes', {
  userId:        varchar('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  artifactType:  artifactTypeEnum('artifact_type').notNull(),
  artifactSlug:  varchar('artifact_slug', { length: 255 }).notNull(),
  createdAt:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.artifactType, t.artifactSlug] }),
]);

/**
 * Records completed marketplace purchases.
 * Flat-fee: one row per purchase. Consumption: one row per billing cycle summary.
 */
export const marketplacePurchases = pgTable('marketplace_purchases', {
  id:                   serial('id').primaryKey(),
  userId:               varchar('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  artifactType:         artifactTypeEnum('artifact_type').notNull(),
  artifactSlug:         varchar('artifact_slug', { length: 255 }).notNull(),
  priceCents:           integer('price_cents').notNull().default(0),
  pricingModel:         pricingModelEnum('pricing_model').notNull().default('flat_fee'),
  stripePaymentIntentId: varchar('stripe_payment_intent_id', { length: 255 }),
  createdAt:            timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
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
   * OpenRouter cost + a flat 1¢/request) only with a PAID plan AND a card that has
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

export const managedAgentHostRequestStatusEnum = pgEnum('managed_agent_host_request_status', [
  'pending', 'provisioning', 'active', 'cancelled', 'failed',
]);

/**
 * Managed AgentHost hosting requests — tenants who want Builderforce to host their BuilderForce Agents instance.
 * $49/mo per hosted AgentHost add-on.
 */
export const managedAgentHostRequests = pgTable('managed_agent_host_requests', {
  id:           serial('id').primaryKey(),
  tenantId:     integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  status:       managedAgentHostRequestStatusEnum('status').notNull().default('pending'),
  agentHostName:     varchar('agent_host_name', { length: 255 }).notNull(),
  region:       varchar('region', { length: 100 }).notNull().default('us-east'),
  notes:        text('notes'),
  provisionedAt: timestamp('provisioned_at'),
  agentHostId:       integer('agent_host_id'),   // set once provisioned and linked to a AgentHost record
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
});

export const sourceControlIntegrations = pgTable('source_control_integrations', {
  id:                serial('id').primaryKey(),
  tenantId:          integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId: uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),  // DB NOT NULL via trigger (0056); optional in TS so single-mode writes need no change
  provider:          sourceControlProviderEnum('provider').notNull(),
  name:              varchar('name', { length: 255 }).notNull(),
  accountIdentifier: varchar('account_identifier', { length: 255 }).notNull(),
  hostUrl:           varchar('host_url', { length: 500 }),
  isActive:          boolean('is_active').notNull().default(true),
  createdAt:         timestamp('created_at').notNull().defaultNow(),
  updatedAt:         timestamp('updated_at').notNull().defaultNow(),
});

export const projects = pgTable('projects', {
  id:              serial('id').primaryKey(),
  publicId:        uuid('public_id').notNull().defaultRandom(),
  tenantId:        integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId: uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),  // DB NOT NULL via trigger (0056); optional in TS so single-mode writes need no change
  key:             varchar('key', { length: 50 }).notNull().unique(),
  name:            varchar('name', { length: 255 }).notNull(),
  description:     text('description'),
  /** IDE: template used to seed initial files (e.g. "vanilla"). */
  template:        varchar('template', { length: 50 }),
  /** The KANBAN template selected for this project's board (migration 0274) — a
   *  built-in slug ('standard-swe') or a kanban_templates.id. Distinct from
   *  {@link template} (IDE file scaffold). Drives lane roles/requirements + the
   *  recommended roster. Null = the legacy hardcoded default board. */
  kanbanTemplateId: varchar('kanban_template_id', { length: 120 }),
  rootWorkingDirectory: text('root_working_directory'),
  status:          projectStatusEnum('status').notNull().default('active'),
  sourceControlIntegrationId: integer('source_control_integration_id').references(() => sourceControlIntegrations.id, { onDelete: 'set null' }),
  sourceControlProvider: sourceControlProviderEnum('source_control_provider'),
  sourceControlRepoFullName: varchar('source_control_repo_full_name', { length: 255 }),
  sourceControlRepoUrl: varchar('source_control_repo_url', { length: 500 }),
  githubRepoUrl:   varchar('github_repo_url', { length: 500 }),
  githubRepoOwner: varchar('github_repo_owner', { length: 255 }),
  githubRepoName:  varchar('github_repo_name', { length: 255 }),
  governance:      text('governance'),
  modality:        text('modality').notNull().default('designer'),
  /** Where the project was born — drives the IDE/Designer badge.
   *  'ide' (created in the Designer) | 'imported' (created by importing a repo) |
   *  'external' (anything else). NULL on legacy rows = treated as external. */
  origin:          text('origin'),
  // TRUE when this projects row exists purely as the storage backing of an
  // ide_project (0224) — hidden from the board/PMO project list. Backfilled
  // (pre-existing) projects stay FALSE and continue to appear normally.
  isIdeStorage:    boolean('is_ide_storage').notNull().default(false),
  // PMO rollup link (0213): the initiative this project belongs to, or NULL when
  // unassigned. The join that lets cost/DORA/outcome collectors roll up to the
  // initiative → portfolio tier. Forward ref to `initiatives` (defined below).
  initiativeId:    uuid('initiative_id').references((): AnyPgColumn => initiatives.id, { onDelete: 'set null' }),
  // Explicit, PM-set project deadline (0255). NULL = no explicit deadline; the
  // list endpoint then falls back to the derived max-task-due-date so the
  // calendar/Gantt still plot a deadline when tasks carry due dates.
  dueDate:         timestamp('due_date'),
  /** The external website this project is configured to security-scan (migration
   *  0357). Set once, re-scanned on demand; NULL = no target configured yet. */
  securityTargetUrl: varchar('security_target_url', { length: 2048 }),
  createdAt:       timestamp('created_at').notNull().defaultNow(),
  updatedAt:       timestamp('updated_at').notNull().defaultNow(),
});

/**
 * Subdomain hosting for IDE (Designer) projects — a published app served at
 * {subdomain}.builderforce.ai. One row per project (project_id unique);
 * re-publishing overwrites the R2 assets and bumps `versionToken` (the cache-bust
 * token the subdomain→site lookup is keyed by). See migration 0121.
 */
export const projectSites = pgTable('project_sites', {
  id:            serial('id').primaryKey(),
  projectId:     integer('project_id').notNull().unique().references(() => projects.id, { onDelete: 'cascade' }),
  tenantId:      integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  subdomain:     varchar('subdomain', { length: 63 }).notNull().unique(),
  /** 'static' (R2-served built assets) | 'container' (V2 container web-serving, later phase). */
  mode:          varchar('mode', { length: 16 }).notNull().default('static'),
  status:        varchar('status', { length: 16 }).notNull().default('active'),
  r2Prefix:      text('r2_prefix').notNull(),
  versionToken:  varchar('version_token', { length: 32 }).notNull(),
  indexDocument: varchar('index_document', { length: 128 }).notNull().default('index.html'),
  customDomain:  varchar('custom_domain', { length: 255 }),
  assetCount:    integer('asset_count').notNull().default(0),
  totalBytes:    bigint('total_bytes', { mode: 'number' }).notNull().default(0),
  publishedAt:   timestamp('published_at'),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
});

export const tasks = pgTable('tasks', {
  id:                serial('id').primaryKey(),
  projectId:         integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  segmentId: uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),  // DB NOT NULL via trigger (0056); optional in TS so single-mode writes need no change
  key:               varchar('key', { length: 100 }).notNull().unique(),
  title:             varchar('title', { length: 500 }).notNull(),
  description:       text('description'),
  status:            varchar('status', { length: 64 }).notNull().default('backlog'),
  priority:          taskPriorityEnum('priority').notNull().default('medium'),
  /** Fixed type dimension: 'task' (default) or 'epic'. An Epic decomposes into
   *  child tasks that link back via {@link parentTaskId}. See migration 0112. */
  taskType:          taskTypeEnum('task_type').notNull().default('task'),
  /** Self-FK to the parent Epic (null for top-level tasks). ON DELETE SET NULL
   *  so deleting an Epic orphans its children rather than cascade-deleting them.
   *  Typed `AnyPgColumn` to break drizzle's self-reference inference cycle. */
  parentTaskId:      integer('parent_task_id').references((): AnyPgColumn => tasks.id, { onDelete: 'set null' }),
  assignedAgentType: agentTypeEnum('assigned_agent_type'),
  githubIssueNumber: integer('github_issue_number'),
  githubIssueUrl:    varchar('github_issue_url', { length: 500 }),
  githubPrUrl:       varchar('github_pr_url', { length: 500 }),
  githubPrNumber:    integer('github_pr_number'),
  /** Atomic single-PR claim (0140): set the instant a finalize path begins opening
   *  a PR (before the external create), so a concurrent inline run-end finalize and
   *  a human Done-drag can't both open a PR for the same branch. Cleared (back to
   *  null) if the create fails, so a retry can re-claim. Distinct from githubPrUrl,
   *  which is only known AFTER the create returns. */
  prOpeningAt:       timestamp('pr_opening_at'),
  assignedAgentHostId:    integer('assigned_agent_host_id').references(() => agentHosts.id, { onDelete: 'set null' }),
  /** ide_agents.id of the cloud agent working this ticket — the agent self-assigns
   *  when it starts a run (agents are first-class assignees). No FK (raw-SQL table). */
  assignedAgentRef:  text('assigned_agent_ref'),
  /** Human assignee/owner (users.id). Humans and agents are one team — a task is
   *  owned by EITHER a human OR an agent (host/cloud ref), never more than one. */
  assignedUserId:    varchar('assigned_user_id', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  /** Git branch the agent executes this ticket under (surfaced on Details, links to the PR). */
  gitBranch:         text('git_branch'),
  /** project_repositories.id the run is pinned to (the "explicit" tier of
   *  resolveRepoForTask) — lets a run target a specific repo instead of the
   *  project default. Sticky so run/finalize/CI/PRD all use the same repo. */
  explicitRepoId:    uuid('explicit_repo_id').references(() => projectRepositories.id, { onDelete: 'set null' }),
  /** Sprint this task is scheduled into (null = unscheduled/backlog). ON DELETE
   *  SET NULL so deleting a sprint un-schedules its tasks rather than deleting the
   *  work. See migration 0115. sprints.id is a UUID. */
  sprintId:          uuid('sprint_id').references((): AnyPgColumn => sprints.id, { onDelete: 'set null' }),
  /** Lineage edge to the PMO initiative this task/epic rolls up to (0225). Null =
   *  inherit the initiative from the parent epic / linked project. ON DELETE SET
   *  NULL so retiring an initiative un-links rather than deletes work. */
  initiativeId:      uuid('initiative_id').references((): AnyPgColumn => initiatives.id, { onDelete: 'set null' }),
  /** Release this task/epic ships in (0227) — makes a product release a first-class
   *  deliverable for the delivery lens (burnup/forecast/scope). ON DELETE SET NULL. */
  releaseId:         uuid('release_id').references((): AnyPgColumn => productReleases.id, { onDelete: 'set null' }),
  /** CAPEX/OPEX classification (0225). null = unclassified (inherits from the
   *  effective parent). costClassSource records who set it (manual PM / agent
   *  classifier / inherited); costClassVerified gates the PM reconciliation stage. */
  costClass:         varchar('cost_class', { length: 8 }),               // 'capex' | 'opex' | null
  costClassSource:   varchar('cost_class_source', { length: 12 }).notNull().default('inherited'), // manual | inherited | agent
  costClassVerified: boolean('cost_class_verified').notNull().default(false),
  startDate:         timestamp('start_date'),
  dueDate:           timestamp('due_date'),
  persona:           varchar('persona', { length: 50 }),
  /** Origin board provider label for tickets synced from an external board. */
  source:            varchar('source', { length: 24 }),
  // PRD/spec link moved to the task_specs junction (0098): a task references 1..N
  // project PRDs (one optional primary) — see `taskSpecs` below.
  archived:          boolean('archived').notNull().default(false),
  /** Gig Marketplace (0293): this work item is published (or publishable) as a
   *  hireable gig, and the back-ref to the published posting. Canonical link is
   *  jobPostings.sourceTicketId; jobPostingId is a denormalized convenience kept in
   *  sync on publish so the board can badge "Published" without a reverse scan. */
  hireable:          boolean('hireable').notNull().default(false),
  jobPostingId:      varchar('job_posting_id', { length: 36 }),
  /** Lifecycle metrics (migration 0117). completedAt is the REAL timestamp the
   *  task entered a done-class lane (replaces the updatedAt proxy); null once it
   *  leaves. lastWorkedAt is the latest "work stopped" signal (baseline for
   *  idle-after-done). redoCount/reopenCount are denormalized backward-move
   *  counters bumped by the status-transition emit so board reads never aggregate
   *  the task_status_transitions log. */
  completedAt:       timestamp('completed_at'),
  lastWorkedAt:      timestamp('last_worked_at'),
  redoCount:         integer('redo_count').notNull().default(0),
  reopenCount:       integer('reopen_count').notNull().default(0),
  /** Learned Model Routing (0197): the cached action-type label (sql / frontend_ui /
   *  backend_api / …) a free-model classifier assigns ONCE per task and every re-run
   *  reuses. Null = unclassified (the router treats it as 'other'). actionTypeConfidence
   *  is the classifier's 0..1 self-report, kept so low-confidence labels can be
   *  re-classified later without a schema change. See actionTypes.ts. */
  actionType:           varchar('action_type', { length: 32 }),
  actionTypeConfidence: real('action_type_confidence'),
  /** Categorical INVESTMENT axis (0226): innovation | ktlo | support | tech_debt |
   *  other — orthogonal to action_type (the TECHNICAL axis). Derived for free from
   *  action_type + task signals; a PM can override (source = 'manual'). Null =
   *  unclassified → the allocation rollup derives it on the fly, so every historical
   *  task counts with zero backfill. See allocationCategories.ts. */
  allocationCategory:       varchar('allocation_category', { length: 16 }),
  allocationCategorySource: varchar('allocation_category_source', { length: 12 }).notNull().default('derived'), // derived | manual | agent
  /** Story-point estimate (0246) — the leaf source for derived sprint velocity
   *  (EMP-4) + productivity metrics. Captured from the issue tracker on board sync
   *  (Jira estimate) or set on the board. Null = unestimated. */
  storyPoints:       real('story_points'),
  /** AI Manager (0265): the ticket's business value 0-100. Null = unscored — the
   *  manager backfills it (AI-scored with a rationale, or RICE-derived from PMO
   *  fields). Drives the manager's backlog ranking. Editable by a human PM. */
  businessValue:         integer('business_value'),
  /** One-line justification for {@link businessValue} (shown on the card/drawer). */
  businessValueRationale: text('business_value_rationale'),
  /** How the score was set: 'ai' | 'rice' | 'manual'. A manual edit pins it so the
   *  manager never overwrites a human's number. */
  businessValueSource:   varchar('business_value_source', { length: 12 }),
  /** The manager's computed backlog rank (1 = do this first). Null = unranked. The
   *  priority-aware autonomous dispatcher + the board default sort read this so the
   *  team works highest-value/most-urgent tickets first, not oldest-updated. */
  managerRank:           integer('manager_rank'),
  /** Validator agent review bookkeeping (0270). A Done item may be reviewed MANY
   *  times (on entry to Done, then re-swept on a schedule) — the full history lives
   *  in {@link taskReviews}; these denormalise the LATEST pass for cheap board
   *  rendering. reviewCount increments per pass; lastReviewVerdict is
   *  'complete' | 'gaps'. */
  reviewCount:           integer('review_count').notNull().default(0),
  lastReviewedAt:        timestamp('last_reviewed_at'),
  lastReviewVerdict:     varchar('last_review_verdict', { length: 16 }),
  /** For a GAP-typed task: the Done item whose review produced it (null otherwise).
   *  Typed AnyPgColumn to break the self-reference inference cycle. ON DELETE SET
   *  NULL so deleting the origin keeps the gap as standalone work. */
  gapOriginTaskId:       integer('gap_origin_task_id').references((): AnyPgColumn => tasks.id, { onDelete: 'set null' }),
  /** Denormalised ticket ROLE/DIAGNOSTIC audit verdict (migration 0275) — the
   *  full result lives in {@link ticketAudits}; these render the board flag chip
   *  without a join. auditStatus is null(unaudited) | 'pass' | 'flagged';
   *  auditFlagCount is how many required lane requirements are unmet. */
  auditStatus:           varchar('audit_status', { length: 12 }),
  auditFlagCount:        integer('audit_flag_count').notNull().default(0),
  /** Security-finding metadata (migration 0290) — set on a SECURITY-typed task the
   *  Security agent mints for a SOC 2 finding. severity is
   *  'critical'|'high'|'medium'|'low'|'info'; tsc is the Trust Service Criterion the
   *  finding maps to; securityAuditId links back to the {@link securityAudits} run.
   *  Null on ordinary task/epic/gap rows. */
  securitySeverity:      varchar('security_severity', { length: 12 }),
  securityTsc:           varchar('security_tsc', { length: 32 }),
  securityAuditId:       integer('security_audit_id'),
  /** Incident metadata (migration 0325) — set on an INCIDENT-typed task the Incident
   *  Manager agent opens. severity is 'sev1'..'sev4'; status is
   *  'triage'|'investigating'|'mitigated'|'resolved'; incidentSystem is the
   *  classified affected system; incidentId links to the {@link prodIncidents}
   *  record. Null on ordinary task/epic/gap/security rows. */
  incidentSeverity:      varchar('incident_severity', { length: 16 }),
  incidentStatus:        varchar('incident_status', { length: 20 }),
  incidentSystem:        varchar('incident_system', { length: 120 }),
  incidentId:            uuid('incident_id'),
  createdAt:         timestamp('created_at').notNull().defaultNow(),
  updatedAt:         timestamp('updated_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Validator agent: review ledger + work-delta provenance (migration 0270)
// ---------------------------------------------------------------------------

/**
 * One row per Validator review PASS over a task. A Done item is reviewed
 * repeatedly (on Done + a recurring sweep), so this is the append-only audit
 * trail; the task row denormalises the latest pass. verdict is
 * 'complete' | 'gaps'; gapsCount is how many GAP tasks the pass minted.
 */
export const taskReviews = pgTable('task_reviews', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  taskId:      integer('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  /** ide_agents.id of the Validator (or 'system' for automation). No FK — raw-SQL table. */
  reviewerRef: varchar('reviewer_ref', { length: 64 }),
  verdict:     varchar('verdict', { length: 16 }).notNull(),   // 'complete' | 'gaps'
  summary:     text('summary'),
  gapsCount:   integer('gaps_count').notNull().default(0),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Security agent: ticket-access config + audit runs (migration 0291)
// ---------------------------------------------------------------------------

/**
 * Per-tenant setup configuration deciding WHO can see the access-restricted
 * SECURITY tickets the Security agent files. Default-DENY: every audience toggle
 * off + empty allowlists ⇒ only tenant Owner/Admin see them. A tenant opts whole
 * audiences in (humans / hired agents / talent) and/or names specific users/agents.
 * Read + enforced by SecurityTicketAccessService on every task read surface.
 */
export const securityTicketAccess = pgTable('security_ticket_access', {
  tenantId:       integer('tenant_id').primaryKey().references(() => tenants.id, { onDelete: 'cascade' }),
  /** { humans:boolean, hired:boolean, talent:boolean } — whole-population opt-ins. */
  audiences:      jsonb('audiences').notNull().default(sql`'{"humans":false,"hired":false,"talent":false}'::jsonb`),
  /** Explicit per-user grants (users.id values). */
  allowUserIds:   jsonb('allow_user_ids').notNull().default(sql`'[]'::jsonb`),
  /** Explicit per-agent grants (ide_agents.id values). */
  allowAgentRefs: jsonb('allow_agent_refs').notNull().default(sql`'[]'::jsonb`),
  updatedAt:      timestamp('updated_at').notNull().defaultNow(),
  updatedBy:      varchar('updated_by', { length: 64 }),
});

/**
 * One row per Security-agent audit RUN — the surfaced "Security Audit result".
 * Goes running → complete|failed; on finish it carries the one-paragraph summary
 * and the rollups (counts by severity, counts by Trust Service Criterion). Each
 * finding it produces is a SECURITY task linked back via tasks.security_audit_id.
 */
export const securityAudits = pgTable('security_audits', {
  id:               serial('id').primaryKey(),
  tenantId:         integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  /** The project (repo) the audit ran against; its findings are filed into it. */
  projectId:        integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
  /** The transient anchor task the cloud run hangs on (dispatch is task-centric). */
  anchorTaskId:     integer('anchor_task_id'),
  /** ide_agents.id of the Security agent that ran the audit (or 'system'). */
  agentRef:         varchar('agent_ref', { length: 64 }),
  status:           varchar('status', { length: 16 }).notNull().default('running'), // 'running'|'complete'|'failed'
  triggerSource:    varchar('trigger_source', { length: 16 }).notNull().default('cron'), // 'cron'|'manual'
  /** 'codebase' (SOC 2 agent audit of the repo) | 'web' (external URL scan). Migration 0357. */
  scanKind:         varchar('scan_kind', { length: 16 }).notNull().default('codebase'),
  /** The scanned website URL — set on 'web' runs only. */
  targetUrl:        varchar('target_url', { length: 2048 }),
  /** Posture score 0..100 — set on 'web' runs only. */
  score:            integer('score'),
  summary:          text('summary'),
  findingsCount:    integer('findings_count').notNull().default(0),
  countsBySeverity: jsonb('counts_by_severity'),
  countsByTsc:      jsonb('counts_by_tsc'),
  startedAt:        timestamp('started_at').notNull().defaultNow(),
  finishedAt:       timestamp('finished_at'),
});

/**
 * Provenance ledger for "a chat turn changed code". Every modality (VS Code, web
 * Brain, MCP, CLI, cloud agent) records a delta here when its work produces a
 * code change, classified improvement|fix|bug and (optionally) tied to the ticket
 * it created — giving the operator visibility of ad-hoc work that used to land
 * silently. Feeds the delta drawer + insight surfaces.
 */
export const workDeltas = pgTable('work_deltas', {
  id:         serial('id').primaryKey(),
  tenantId:   integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:  uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  projectId:  integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
  /** The ticket this delta created/updated (null if it could not be created). */
  taskId:     integer('task_id').references(() => tasks.id, { onDelete: 'set null' }),
  /** The Brain chat/session that produced the delta (null for headless runs). */
  chatId:     integer('chat_id').references(() => brainChats.id, { onDelete: 'set null' }),
  /** Interaction surface: 'ide' | 'web' | 'mcp' | 'cli' | 'cloud'. */
  modality:   varchar('modality', { length: 32 }).notNull().default('unknown'),
  /** Classification of the change: 'improvement' | 'fix' | 'bug'. */
  kind:       varchar('kind', { length: 16 }).notNull(),
  summary:    text('summary').notNull(),
  detail:     text('detail'),
  /** Files touched by the change (string[]). */
  files:      jsonb('files'),
  /** User id or agent ref that authored the turn. */
  createdBy:  varchar('created_by', { length: 64 }),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// AI Manager coordination layer (migration 0265)
// ---------------------------------------------------------------------------

/**
 * Per-project manager designation + policy. A row overrides the default-on tenant
 * system service: it names a manager (an AI agent OR a human, assignee-encoded)
 * and tunes what the manager is allowed to do (assign, backfill value, rank, and
 * how much PR authority it has). Absent row = the system service manages the
 * project with tenant-default policy.
 */
export const projectManagerConfigs = pgTable('project_manager_configs', {
  id:                uuid('id').primaryKey().defaultRandom(),
  tenantId:          integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  projectId:         integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  /** Designated manager, assignee-encoded ('u:<userId>' | 'c:<cloudRef>' | 'h:<hostId>').
   *  Null = the tenant system service manages this project (no named manager). */
  managerRef:        text('manager_ref'),
  /** Master switch for this project — false skips it entirely. */
  enabled:           boolean('enabled').notNull().default(true),
  /** PR authority: 'immediate' | 'on_green' | 'queue'. Tenant default 'immediate'. */
  prMergePolicy:     varchar('pr_merge_policy', { length: 12 }).notNull().default('immediate'),
  autoAssign:        boolean('auto_assign').notNull().default(true),
  autoBusinessValue: boolean('auto_business_value').notNull().default(true),
  autoPrioritize:    boolean('auto_prioritize').notNull().default(true),
  /** The manager's DOMAIN focus/persona (see managerTypes.ts): a built-in ('general' |
   *  'delivery' | 'qa' | 'service_desk' | 'devops') or a `role:<key>` custom-role type
   *  (up to a 60-char role key). Shapes what it values + prioritizes. */
  managerType:       varchar('manager_type', { length: 80 }).notNull().default('general'),
  lastRunAt:         timestamp('last_run_at'),
  createdAt:         timestamp('created_at').notNull().defaultNow(),
  updatedAt:         timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byProject: uniqueIndex('uq_project_manager_configs_project').on(t.tenantId, t.projectId),
}));

/**
 * Standing human guidance the AI Manager honors on every pass — the persisted output
 * of a "coaching session" (Manager-tab box or the manager.coach chat tool). A row
 * scoped to one project applies to that project's passes; project_id NULL applies
 * tenant-wide (a manager that manages the whole tenant). See migration 0327.
 */
export const managerDirectives = pgTable('manager_directives', {
  id:         uuid('id').primaryKey().defaultRandom(),
  tenantId:   integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  projectId:  integer('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  directive:  text('directive').notNull(),
  status:     varchar('status', { length: 16 }).notNull().default('active'),
  createdBy:  varchar('created_by', { length: 36 }),
  source:     varchar('source', { length: 16 }).notNull().default('coach'),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  expiresAt:  timestamp('expires_at'),
}, (t) => ({
  byScope: index('idx_manager_directives_scope').on(t.tenantId, t.projectId, t.status),
}));

/**
 * Audit feed of every decision the manager took (ranked, assigned, scored, merged,
 * flagged…). Backs the Manager surface "activity" list so a human can see — and
 * trust — exactly what the AI manager did and why.
 */
export const managerActions = pgTable('manager_actions', {
  id:         uuid('id').primaryKey().defaultRandom(),
  tenantId:   integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  projectId:  integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  /** The ticket the action was about (null for project-wide actions like a re-rank). */
  taskId:     integer('task_id').references(() => tasks.id, { onDelete: 'set null' }),
  /** The board task that REPRESENTS the manual manager run this decision belongs to
   *  (0286). Set for actions taken during a "Run manager now" pass so the run task can
   *  show exactly what it changed; null for cron-sweep decisions (feed-only). */
  runTaskId:  integer('run_task_id').references(() => tasks.id, { onDelete: 'set null' }),
  /** 'prioritize' | 'assign' | 'score_value' | 'dispatch' | 'merge_pr' | 'close_pr' |
   *  'flag' (a required check is unmet — written only when the verdict CHANGES) |
   *  'coordinate' (the manager staffed a flagged ticket's missing role/reviewer). */
  actionType: varchar('action_type', { length: 24 }).notNull(),
  summary:    text('summary').notNull(),
  /** Structured JSON payload for drill-in. */
  detail:     text('detail'),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  byFeed: index('idx_manager_actions_feed').on(t.tenantId, t.projectId, t.createdAt),
  byRunTask: index('idx_manager_actions_run_task').on(t.runTaskId),
}));

// ---------------------------------------------------------------------------
// Workforce member profiles + lifecycle metrics (migrations 0116–0118)
// ---------------------------------------------------------------------------

/** Which workforce sub-population a member_ref points at — shared by team_members
 *  (0114), member_profiles, and member_metrics_period. Declared here (ahead of the
 *  Workforce Teams section) so all consumers can reference it. */
export const teamMemberKindEnum = pgEnum('team_member_kind', [
  'human', 'cloud_agent', 'host_agent',
]);

export const memberExperienceLevelEnum = pgEnum('member_experience_level', [
  'junior', 'mid', 'senior', 'staff', 'principal',
]);
export const memberAvailabilityStatusEnum = pgEnum('member_availability_status', [
  'available', 'busy', 'focus', 'ooo', 'on_call',
]);
export const memberProfileSyncSourceEnum = pgEnum('member_profile_sync_source', [
  'manual', 'google_calendar',
]);

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
 * Per-task time logging (migration 0247) — REAL logged effort, replacing the
 * cycle-time estimate the planning spine used for human cost. A member logs
 * `minutes` against a task on `entryDate`; the spine sums minutes × the member's
 * cost rate, and the member activity chart buckets logged hours by day. Member is
 * polymorphic (human | cloud_agent | host_agent) — same identity as the metrics.
 */
export const timeEntries = pgTable('time_entries', {
  id:         uuid('id').primaryKey().defaultRandom(),
  tenantId:   integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:  uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  taskId:     integer('task_id').notNull().references((): AnyPgColumn => tasks.id, { onDelete: 'cascade' }),
  memberKind: varchar('member_kind', { length: 16 }).notNull(), // human | cloud_agent | host_agent
  memberRef:  varchar('member_ref', { length: 64 }).notNull(),
  minutes:    integer('minutes').notNull(),
  entryDate:  date('entry_date').notNull(),
  source:     varchar('source', { length: 12 }).notNull().default('manual'), // manual | timer | derived
  note:       text('note'),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
});

/**
 * Append-only ticket-lifecycle event log — one row per status (lane) move. The
 * keystone for redo / idle-after-done / time-in-status / DORA cycle+lead time.
 * Emitted from PATCH /api/tasks/:id. `isBackward` (move to a lower-ordinal
 * swimlane) is the redo signal; `actorKind`/`actorRef` record who moved it. See
 * migration 0117.
 */
export const taskStatusTransitions = pgTable('task_status_transitions', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:   uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  projectId:   integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  taskId:      integer('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  fromStatus:  varchar('from_status', { length: 64 }),
  toStatus:    varchar('to_status', { length: 64 }).notNull(),
  actorKind:   varchar('actor_kind', { length: 16 }).notNull().default('system'),
  actorRef:    varchar('actor_ref', { length: 64 }),
  isBackward:  boolean('is_backward'),
  occurredAt:  timestamp('occurred_at').notNull().defaultNow(),
});

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

export const deploymentStatusEnum = pgEnum('deployment_status', [
  'success', 'failed', 'rolled_back',
]);

/**
 * Deploy/restore stream — the DORA signal that activity_events (commits/PRs)
 * lacks: deployment frequency, change-failure-rate (is_failure), and MTTR
 * (restored_at − deployed_at). Optionally tied to the task it shipped for
 * lead-time bridging. See migration 0118.
 */
export const deploymentEvents = pgTable('deployment_events', {
  id:           serial('id').primaryKey(),
  tenantId:     integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:    uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  projectId:    integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
  taskId:       integer('task_id').references(() => tasks.id, { onDelete: 'set null' }),
  environment:  varchar('environment', { length: 64 }).notNull().default('production'),
  status:       deploymentStatusEnum('status').notNull().default('success'),
  isFailure:    boolean('is_failure').notNull().default(false),
  externalRef:  varchar('external_ref', { length: 255 }),
  deployedAt:   timestamp('deployed_at').notNull().defaultNow(),
  restoredAt:   timestamp('restored_at'),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
});

// Anonymous landing-page prompts (0128) — durable, cross-device handoff of a
// prompt typed before signup. Claimed on first authenticated request. No tenant
// scope (the user has none yet).
export const pendingPrompts = pgTable('pending_prompts', {
  id:         uuid('id').primaryKey().defaultRandom(),
  anonId:     varchar('anon_id', { length: 64 }).notNull(),
  prompt:     text('prompt').notNull(),
  path:       varchar('path', { length: 512 }),
  userId:     varchar('user_id', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  expiresAt:  timestamp('expires_at').notNull(),
  claimedAt:  timestamp('claimed_at'),
});

export const agents = pgTable('agents', {
  id:         serial('id').primaryKey(),
  tenantId:   integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId: uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),  // DB NOT NULL via trigger (0056); optional in TS so single-mode writes need no change
  name:       varchar('name', { length: 255 }).notNull(),
  type:       agentTypeEnum('type').notNull(),
  endpoint:   varchar('endpoint', { length: 500 }).notNull(),
  apiKeyHash: varchar('api_key_hash', { length: 64 }),
  isActive:   boolean('is_active').notNull().default(true),
  config:     text('config'),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
});

/**
 * Cloud agents (the workforce "marketplace + my agents" tier). A cloud agent is
 * an `ide_agents` row with project_id NULL + tenant_id set (migration 0075). When
 * `published` it appears in the world-readable marketplace registry. Tenant-scoped
 * (NO segment_id). `id` is a client-generated UUID stored as text. Mirrors the
 * raw-SQL shape used by workforceRoutes / ideRoutes; declared here so the built-in
 * MCP catalog can reach it through Drizzle like every other domain.
 */
export const ideAgents = pgTable('ide_agents', {
  id:               varchar('id', { length: 64 }).primaryKey(),
  tenantId:         integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  projectId:        integer('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  name:             varchar('name', { length: 255 }).notNull(),
  /** Stable built-in-agent marker (e.g. 'validator', 'security'). NULL for ordinary
   *  user/marketplace agents. Decouples a built-in's IDENTITY from its display name,
   *  so `name` can be renamed freely (to feel like a teammate) while dispatch and the
   *  card's type indicator key off this instead. See migration 0289. */
  builtinKind:      varchar('builtin_kind', { length: 32 }),
  /** Explicit role keys this agent may act as (JSON string[]). NULL falls back to
   *  builtin_kind-derived + fuzzy title/skill matching — see roleCapability.ts. */
  roleKeys:         jsonb('role_keys'),
  title:            varchar('title', { length: 255 }),
  bio:              text('bio'),
  skills:           text('skills'),              // JSON string[] as text
  baseModel:        varchar('base_model', { length: 120 }),
  status:           varchar('status', { length: 16 }).notNull().default('active'),
  hireCount:        integer('hire_count').notNull().default(0),
  runtimeSupport:   varchar('runtime_support', { length: 16 }).notNull().default('cloud'),
  preferredRuntime: varchar('preferred_runtime', { length: 16 }),
  // (vestigial `engine` column dropped in migration 0321 — one engine, resolved from
  //  CURRENT_ENGINE_ID at run time, never persisted.)
  runtimeSurface:   varchar('runtime_surface', { length: 16 }),
  /** JSON PsychometricProfile (Pro) — this agent's OWN personality; null = none. Compiled at run time. */
  psychometric:     text('psychometric'),
  priceCents:       integer('price_cents').notNull().default(0),
  pricingModel:     varchar('pricing_model', { length: 24 }).notNull().default('flat_fee'),
  priceUnit:        varchar('price_unit', { length: 100 }),
  evalScore:        real('eval_score'),
  published:        boolean('published').notNull().default(false),
  createdAt:        timestamp('created_at').notNull().defaultNow(),
  updatedAt:        timestamp('updated_at').notNull().defaultNow(),
});

export const skills = pgTable('skills', {
  id:           serial('id').primaryKey(),
  agentId:      integer('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  name:         varchar('name', { length: 255 }).notNull(),
  description:  text('description'),
  inputSchema:  text('input_schema'),
  outputSchema: text('output_schema'),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
});

/**
 * BuilderForce Agents instances — registered BuilderForce Agents machines owned by a tenant.
 * Each instance authenticates with its own API key (not a user credential).
 * A agentHost belongs to exactly one tenant; a tenant can have many agentHosts (the mesh).
 */
export const agentHosts = pgTable('agent_hosts', {
  id:           serial('id').primaryKey(),
  tenantId:     integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId: uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),  // DB NOT NULL via trigger (0056); optional in TS so single-mode writes need no change
  name:         varchar('name', { length: 255 }).notNull(),
  slug:         varchar('slug', { length: 255 }).notNull(),
  apiKeyHash:   varchar('api_key_hash', { length: 64 }).notNull(),
  status:       agentHostStatusEnum('status').notNull().default('active'),
  registeredBy: varchar('registered_by', { length: 36 }).references(() => users.id),
  machineName:  varchar('machine_name', { length: 255 }),
  machineIp:    varchar('machine_ip', { length: 64 }),
  rootInstallDirectory: text('root_install_directory'),
  workspaceDirectory: text('workspace_directory'),
  gatewayPort:  integer('gateway_port'),
  relayPort:    integer('relay_port'),
  tunnelUrl:    varchar('tunnel_url', { length: 500 }),
  tunnelStatus: varchar('tunnel_status', { length: 64 }),
  networkMetadata: text('network_metadata'),
  lastSeenAt:   timestamp('last_seen_at'),
  connectedAt:  timestamp('connected_at'),   // set when agentHost's upstream WS connects; null = offline
  capabilities:         text('capabilities'),         // JSON array reported via heartbeat, e.g. '["chat","tasks","relay"]'
  declaredCapabilities: text('declared_capabilities'), // JSON array configured by user in the portal
  localPersonas:        text('local_personas'),         // JSON array of custom role definitions reported by the agentHost
  /** Per-agentHost token budget per calendar day. NULL = no per-agentHost limit (only plan-level limit applies). */
  tokenDailyLimit:      integer('token_daily_limit'),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
});

export const executions = pgTable('executions', {
  id:           serial('id').primaryKey(),
  taskId:       integer('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  agentId:      integer('agent_id').references(() => agents.id),
  agentHostId:       integer('agent_host_id').references(() => agentHosts.id, { onDelete: 'set null' }),
  tenantId:     integer('tenant_id').notNull().references(() => tenants.id),
  segmentId: uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),  // DB NOT NULL via trigger (0056); optional in TS so single-mode writes need no change
  submittedBy:  varchar('submitted_by', { length: 36 }).notNull(),
  sessionId:    varchar('session_id', { length: 128 }),
  status:       executionStatusEnum('status').notNull().default('pending'),
  payload:      text('payload'),
  result:       text('result'),
  errorMessage: text('error_message'),
  /** Cloud agent that actually ran this execution (ide_agents.id by value, no FK).
   *  Null for gateway-default / host runs. Written at dispatch so each run's
   *  logs/telemetry scope to the agent that ran IT, not the ticket's current one. */
  cloudAgentRef: varchar('cloud_agent_ref', { length: 64 }),
  startedAt:    timestamp('started_at'),
  completedAt:  timestamp('completed_at'),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
});

/**
 * Durable per-execution chat/steering thread (migration 0109). A user "Send" on
 * the execution Output tab persists here so steering survives a reload and reaches
 * cloud runs (the WS echo is cross-isolate-lossy). `role='user'` rows with a null
 * `consumedAt` are PENDING steers the cloud agent loop drains on its next step;
 * `consumedAt` is stamped once ingested so a steer is delivered exactly once.
 */
export const executionMessages = pgTable('execution_messages', {
  id:          serial('id').primaryKey(),
  executionId: integer('execution_id').notNull().references(() => executions.id, { onDelete: 'cascade' }),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id),
  role:        varchar('role', { length: 16 }).notNull(),
  text:        text('text').notNull(),
  consumedAt:  timestamp('consumed_at'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
});

/**
 * Unified activity / audit log (migration 0287) — the ONE canonical, append-only
 * stream of "who did what, to what, when" across the whole workforce: team
 * members, external talent / hires, and AI agents alike. Replaces the fragmented
 * per-domain event tables as the single trace surface; written through the
 * `recordActivity()` emitter (application/activity/activityLog.ts).
 *
 * Actor is polymorphic via (actorType, actorRef) — see the migration header for
 * the per-type ref mapping. actorName is denormalised so the timeline renders
 * without a heterogeneous fan-join. `verb` is free-form so new event kinds need
 * no migration.
 */
export const activityLog = pgTable('activity_log', {
  id:           bigserial('id', { mode: 'number' }).primaryKey(),
  /** Nullable ONLY for platform-global events (pre-tenant login/registration),
   *  absorbed from the retired audit_events table (mig 0295). Tenant-scoped reads
   *  filter on tenantId, so a global row is simply invisible to any one tenant. */
  tenantId:     integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:    uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  projectId:    integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
  /** human | hire | cloud_agent | host_agent | system */
  actorType:    varchar('actor_type', { length: 16 }).notNull(),
  /** Id into the per-type table (users.id / ide_agents.id / agent_hosts.id); null for system. */
  actorRef:     varchar('actor_ref', { length: 64 }),
  /** Denormalised display label — avoids a per-row fan-join across actor tables. */
  actorName:    varchar('actor_name', { length: 255 }),
  /** freelancer_engagements.id — binds a cross-tenant hire action; nullable. */
  engagementId: varchar('engagement_id', { length: 36 }),
  /** Free-form action verb: 'task.created', 'comment.added', 'deploy.recorded', … */
  verb:         varchar('verb', { length: 64 }).notNull(),
  targetType:   varchar('target_type', { length: 32 }),
  targetId:     varchar('target_id', { length: 64 }),
  targetLabel:  varchar('target_label', { length: 300 }),
  summary:      text('summary'),
  metadata:     jsonb('metadata'),
  occurredAt:   timestamp('occurred_at').notNull().defaultNow(),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('idx_activity_log_tenant_time').on(t.tenantId, t.occurredAt),
  index('idx_activity_log_actor').on(t.tenantId, t.actorType, t.actorRef, t.occurredAt),
  index('idx_activity_log_target').on(t.tenantId, t.targetType, t.targetId),
  index('idx_activity_log_project').on(t.tenantId, t.projectId, t.occurredAt),
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

/**
 * AgentHost-level skill assignment.
 * Overrides or supplements the tenant-level assignment for a specific agentHost.
 */
export const agentHostSkillAssignments = pgTable('agent_host_skill_assignments', {
  id:         serial('id').primaryKey(),
  agentHostId:     integer('agent_host_id').notNull().references(() => agentHosts.id, { onDelete: 'cascade' }),
  tenantId:   integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  skillSlug:  varchar('skill_slug', { length: 255 }).notNull(),
  assignedBy: varchar('assigned_by', { length: 36 }).references(() => users.id),
  assignedAt: timestamp('assigned_at').notNull().defaultNow(),
}, (t) => [
  // `id` above is the PK; composite demoted to unique() — see note above [1315].
  unique().on(t.agentHostId, t.skillSlug),
]);

// ---------------------------------------------------------------------------
// Unified artifact assignments (skills, personas, content at any scope level)
// ---------------------------------------------------------------------------

/**
 * Assigns an artifact (skill, persona, or content) to a scope (tenant, agentHost,
 * project, or task). Precedence during resolution: task > project > agentHost > tenant.
 * scopeId holds the FK for the scope entity (tenantId / agentHostId / projectId / taskId).
 */
export const artifactAssignments = pgTable('artifact_assignments', {
  id:            serial('id').primaryKey(),
  tenantId:      integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  artifactType:  artifactTypeEnum('artifact_type').notNull(),
  artifactSlug:  varchar('artifact_slug', { length: 255 }).notNull(),
  scope:         assignmentScopeEnum('scope').notNull(),
  scopeId:       integer('scope_id').notNull(),
  assignedBy:    varchar('assigned_by', { length: 36 }).references(() => users.id),
  config:        text('config'),
  assignedAt:    timestamp('assigned_at').notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.tenantId, t.artifactType, t.artifactSlug, t.scope, t.scopeId] }),
]);

/**
 * Agent identity + project attachments. Gives each agent (workforce or
 * registered) a numeric id so per-agent artifact assignments can reuse
 * artifact_assignments with scope='agent' and scope_id = project_agents.id.
 *
 * An agent is NOT tied to a project — it's used anywhere (IDE, Workflow,
 * on-prem, cloud) and associated with 0..N projects as swimlanes:
 *   projectId NULL     → the canonical, tenant-wide agent identity row.
 *                        Per-agent capabilities assigned here apply everywhere.
 *   projectId NOT NULL → a project (swimlane) attachment, layered on top.
 *
 *   agentKind 'workforce'  → agentRef holds PublishedAgent.id (string)
 *   agentKind 'registered' → agentRef holds agents.id (numeric, as string)
 */
export const projectAgents = pgTable('project_agents', {
  id:         serial('id').primaryKey(),
  tenantId:   integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  projectId:  integer('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  agentKind:  varchar('agent_kind', { length: 16 }).notNull(),
  agentRef:   varchar('agent_ref', { length: 64 }).notNull(),
  name:       varchar('name', { length: 255 }).notNull(),
  role:       varchar('role', { length: 64 }).notNull().default('default'),
  governance: text('governance'),
  addedBy:    varchar('added_by', { length: 36 }).references(() => users.id),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  // One canonical identity row per (tenant, kind, ref); many project attachments.
  uniqueIndex('uq_project_agents_identity')
    .on(t.tenantId, t.agentKind, t.agentRef)
    .where(sql`${t.projectId} IS NULL`),
  uniqueIndex('uq_project_agents_attachment')
    .on(t.tenantId, t.projectId, t.agentKind, t.agentRef)
    .where(sql`${t.projectId} IS NOT NULL`),
]);

/**
 * Canonical agent-assignment model (migration 0082). An agent is registered once
 * (tenant-scoped, identified by agentKind+agentRef — the same coordinates
 * project_agents uses) and ASSIGNED to many platform aspects from one place:
 *   scope          — project | workflow | architecture | security | swimlane | brain | global
 *   scopeId        — target id within that scope (project/workflow/swimlane id…); NULL for brain/global
 *   executionScope — project | global (e.g. a workflow runs under a project, or tenant-wide)
 * This is the single source the surfaces read, superseding the fragmented
 * project_agents / swimlane target / assignedAgentHost notions over time.
 */
export const agentAssignments = pgTable('agent_assignments', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenantId:       integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:      uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  agentKind:      varchar('agent_kind', { length: 16 }).notNull(),  // workforce | registered
  agentRef:       varchar('agent_ref', { length: 64 }).notNull(),
  scope:          varchar('scope', { length: 24 }).notNull(),       // project|workflow|architecture|security|swimlane|brain|global
  scopeId:        varchar('scope_id', { length: 64 }),              // target id; NULL for brain/global
  executionScope: varchar('execution_scope', { length: 16 }).notNull().default('project'),  // project|global
  role:           varchar('role', { length: 64 }).notNull().default('default'),
  createdAt:      timestamp('created_at').notNull().defaultNow(),
  updatedAt:      timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  // One assignment per (tenant, agent, scope, target). COALESCE collapses NULL
  // scopeId so brain/global is unique per agent+scope. Mirrors migration 0082.
  uniqueIndex('uq_agent_assignments').on(t.tenantId, t.agentKind, t.agentRef, t.scope, sql`COALESCE(${t.scopeId}, '')`),
  index('idx_agent_assignments_scope').on(t.tenantId, t.scope, t.scopeId),
]);

/**
 * Per-tenant marketplace agent purchases (migration 0085). One row per agent a
 * tenant has acquired from the marketplace, so the /workforce directory shows
 * purchased agents alongside owned ones and an owned agent with purchases can't
 * be deleted. `agentId` references the raw-SQL `ide_agents.id` (no FK).
 */
export const agentPurchases = pgTable('agent_purchases', {
  id:        uuid('id').primaryKey().defaultRandom(),
  tenantId:  integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  agentId:   varchar('agent_id', { length: 64 }).notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_agent_purchases').on(t.tenantId, t.agentId),
  index('idx_agent_purchases_agent').on(t.agentId),
]);

/**
 * Buyer feedback on a hired marketplace agent (migration 0111). One row per hire
 * (`purchase_id` is unique → re-submitting overwrites), so an owner sees how the
 * tenants who hired the agent rate it. `agentId` is denormalized off the purchase
 * for the owner-side perf rollup join (which scopes by agent, not by purchase) and
 * references the raw-SQL `ide_agents.id` (no FK, mirrors `agentPurchases`). Feeds
 * the owner-only performance surface alongside the live `executions` telemetry
 * rollup (success rate / runs / latency per hired tenant).
 */
export const agentFeedback = pgTable('agent_feedback', {
  id:         uuid('id').primaryKey().defaultRandom(),
  purchaseId: uuid('purchase_id').notNull().references(() => agentPurchases.id, { onDelete: 'cascade' }),
  agentId:    varchar('agent_id', { length: 64 }).notNull(),
  tenantId:   integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  rating:     smallint('rating').notNull(), // 1..5 (CHECK enforced in 0111)
  comment:    text('comment'),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_agent_feedback_purchase').on(t.purchaseId),
  index('idx_agent_feedback_agent').on(t.agentId, t.createdAt),
]);

/**
 * Platform personas — admin-managed personas (CRUD in Platform Admin).
 * Merged with built-in personas for marketplace display.
 */
export const platformPersonas = pgTable('platform_personas', {
  id:             serial('id').primaryKey(),
  name:           varchar('name', { length: 255 }).notNull(),
  slug:           varchar('slug', { length: 255 }).notNull().unique(),
  description:    text('description'),
  voice:          varchar('voice', { length: 500 }),
  perspective:    varchar('perspective', { length: 500 }),
  decisionStyle:  varchar('decision_style', { length: 500 }),
  outputPrefix:   varchar('output_prefix', { length: 50 }),
  capabilities:   text('capabilities'), // JSON array
  tags:           text('tags'),         // JSON array
  psychometric:   text('psychometric'), // JSON PsychometricProfile (Pro), null = none
  source:         varchar('source', { length: 50 }).notNull().default('builtin'),
  author:         varchar('author', { length: 255 }),
  active:         boolean('active').notNull().default(true),
  createdAt:      timestamp('created_at').notNull().defaultNow(),
  updatedAt:      timestamp('updated_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// AgentHost ↔ Project associations and synced workspace directories
// ---------------------------------------------------------------------------

export const agentHostProjects = pgTable('agent_host_projects', {
  id:        serial('id').primaryKey(),
  tenantId:  integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId: uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),  // DB NOT NULL via trigger (0056); optional in TS so single-mode writes need no change
  agentHostId:    integer('agent_host_id').notNull().references(() => agentHosts.id, { onDelete: 'cascade' }),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  role:      varchar('role', { length: 64 }).notNull().default('default'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.tenantId, t.agentHostId, t.projectId] }),
]);

export const agentHostDirectories = pgTable('agent_host_directories', {
  id:           serial('id').primaryKey(),
  tenantId:     integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId: uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),  // DB NOT NULL via trigger (0056); optional in TS so single-mode writes need no change
  agentHostId:       integer('agent_host_id').notNull().references(() => agentHosts.id, { onDelete: 'cascade' }),
  projectId:    integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
  absPath:      text('abs_path').notNull(),
  pathHash:     varchar('path_hash', { length: 128 }).notNull(),
  status:       agentHostDirectoryStatusEnum('status').notNull().default('pending'),
  metadata:     text('metadata'),
  errorMessage: text('error_message'),
  lastSeenAt:   timestamp('last_seen_at'),
  lastSyncedAt: timestamp('last_synced_at'),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.tenantId, t.agentHostId, t.pathHash] }),
]);

export const agentHostDirectoryFiles = pgTable('agent_host_directory_files', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId: uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),  // DB NOT NULL via trigger (0056); optional in TS so single-mode writes need no change
  agentHostId:      integer('agent_host_id').notNull().references(() => agentHosts.id, { onDelete: 'cascade' }),
  directoryId: integer('directory_id').notNull().references(() => agentHostDirectories.id, { onDelete: 'cascade' }),
  relPath:     text('rel_path').notNull(),
  contentHash: varchar('content_hash', { length: 128 }).notNull(),
  sizeBytes:   integer('size_bytes').notNull().default(0),
  content:     text('content'),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.directoryId, t.relPath] }),
]);

// ---------------------------------------------------------------------------
// Sync history
// ---------------------------------------------------------------------------

export const agentHostSyncHistory = pgTable('agent_host_sync_history', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId: uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),  // DB NOT NULL via trigger (0056); optional in TS so single-mode writes need no change
  agentHostId:      integer('agent_host_id').notNull().references(() => agentHosts.id, { onDelete: 'cascade' }),
  directoryId: integer('directory_id').references(() => agentHostDirectories.id, { onDelete: 'set null' }),
  triggeredBy: varchar('triggered_by', { length: 32 }).notNull().default('startup'),
  fileCount:   integer('file_count').notNull().default(0),
  bytesTotal:  integer('bytes_total').notNull().default(0),
  status:      varchar('status', { length: 16 }).notNull().default('success'),
  errorMsg:    text('error_msg'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
});

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

export const chatMessages = pgTable('chat_messages', {
  id:        serial('id').primaryKey(),
  tenantId:  integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId: uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),  // DB NOT NULL via trigger (0056); optional in TS so single-mode writes need no change
  agentHostId:    integer('agent_host_id').notNull().references(() => agentHosts.id, { onDelete: 'cascade' }),
  sessionId: integer('session_id').notNull().references(() => chatSessions.id, { onDelete: 'cascade' }),
  role:      varchar('role', { length: 16 }).notNull(),
  content:   text('content').notNull().default(''),
  metadata:  text('metadata'),
  seq:       integer('seq').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Specs — structured planning documents produced by the /spec TUI command
// ---------------------------------------------------------------------------

export const specs = pgTable('specs', {
  id:          uuid('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId: uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),  // DB NOT NULL via trigger (0056); optional in TS so single-mode writes need no change
  projectId:   integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
  agentHostId:      integer('agent_host_id').references(() => agentHosts.id, { onDelete: 'set null' }),
  goal:        text('goal').notNull(),
  status:      specStatusEnum('status').notNull().default('draft'),
  kind:        varchar('kind', { length: 32 }).notNull().default('feature'),  // 'feature' | 'architecture' (Architect analysis output)
  prd:         text('prd'),
  archSpec:    text('arch_spec'),
  taskList:    text('task_list'),      // JSON array stored as text (jsonb not available in all envs)
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
});

// Task <-> PRD (many-to-many, 0098). A task references 1..N project PRDs; at most
// one is marked primary (the canonical PRD the agent reads/writes for the task).
export const taskSpecs = pgTable('task_specs', {
  id:         uuid('id').primaryKey().defaultRandom(),
  tenantId:   integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:  uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),  // DB NOT NULL via trigger (0056)
  taskId:     integer('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  specId:     uuid('spec_id').notNull().references(() => specs.id, { onDelete: 'cascade' }),
  isPrimary:  boolean('is_primary').notNull().default(false),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
}, (t) => [unique('uq_task_specs').on(t.taskId, t.specId)]);

// ---------------------------------------------------------------------------
// Workflows — structured execution records for orchestrated multi-step plans
// ---------------------------------------------------------------------------

export const workflows = pgTable('workflows', {
  id:           uuid('id').primaryKey(),
  tenantId:     integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId: uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),  // DB NOT NULL via trigger (0056); optional in TS so single-mode writes need no change
  // Nullable since 0080: a workflow can target the cloud runtime instead of a
  // self-hosted agentHost (then runtime='cloud' + cloudAgentRef identifies it).
  agentHostId:       integer('agent_host_id').references(() => agentHosts.id, { onDelete: 'cascade' }),
  /** Optional project this workflow belongs to (0086). Tenant-wide when null. */
  projectId:    integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
  /** Source definition this run was instantiated from (0094); null for ad-hoc runs. */
  workflowDefinitionId: uuid('workflow_definition_id').references(() => workflowDefinitions.id, { onDelete: 'set null' }),
  /** Reliability linkage (0337): the incident/monitor whose event fired this run —
   *  set on event-trigger runs and on a manual runbook launched from an incident, so
   *  the incident detail can list "workflows run for this incident". Null otherwise.
   *  Plain uuids (no ORM FK) — mirrors monitors.current_incident_id; the value is only
   *  ever an equality filter and the tables are declared later in this module. */
  sourceIncidentId: uuid('source_incident_id'),
  sourceMonitorId:  uuid('source_monitor_id'),
  /** Where this run executes: 'host' (self-hosted agentHost) | 'cloud' (builderforce-hosted). */
  runtime:      varchar('runtime', { length: 16 }).notNull().default('host'),
  /** ide_agents.id of the cloud agent serving the run when runtime='cloud'. */
  cloudAgentRef: varchar('cloud_agent_ref', { length: 64 }),
  specId:       uuid('spec_id').references(() => specs.id, { onDelete: 'set null' }),
  workflowType: workflowTypeEnum('workflow_type').notNull().default('custom'),
  status:       workflowStatusEnum('status').notNull().default('pending'),
  description:  text('description'),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  completedAt:  timestamp('completed_at'),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
});

export const workflowTasks = pgTable('workflow_tasks', {
  id:          uuid('id').primaryKey(),
  workflowId:  uuid('workflow_id').notNull().references(() => workflows.id, { onDelete: 'cascade' }),
  agentRole:   varchar('agent_role', { length: 255 }).notNull(),
  description: text('description').notNull(),
  status:      workflowTaskStatusEnum('status').notNull().default('pending'),
  input:       text('input'),
  output:      text('output'),
  error:       text('error'),
  dependsOn:   text('depends_on'),   // JSON array of task UUIDs stored as text
  startedAt:   timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Workflow definitions — reusable, visually-authored agentic workflow graphs.
// The design-time template the IPAAS-style builder canvas serializes to; at run
// time it is compiled to orchestrator steps and instantiated as a `workflows`
// execution record (see workflowDefinitionRoutes + domain/workflowGraph).
// ---------------------------------------------------------------------------

export const workflowDefinitions = pgTable('workflow_definitions', {
  id:          uuid('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:   uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),  // DB NOT NULL via trigger (0056); optional in TS
  name:        varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  // Project this workflow belongs to (0093). Tenant-wide (independent) when null;
  // when set, execution_scope is 'project' and runs inherit this projectId.
  projectId:   integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
  definition:  text('definition').notNull().default('{"nodes":[],"edges":[]}'),  // serialized WorkflowDefinition JSON
  // Run target (0080): where runs of this definition execute — manual runs, and
  // every trigger-fired run, inherit this. 'host' uses runTargetAgentHostId,
  // 'cloud' uses runTargetCloudAgentRef (an ide_agents.id).
  runTargetRuntime:     varchar('run_target_runtime', { length: 16 }).notNull().default('host'),
  runTargetAgentHostId: integer('run_target_agent_host_id').references(() => agentHosts.id, { onDelete: 'set null' }),
  runTargetCloudAgentRef: varchar('run_target_cloud_agent_ref', { length: 64 }),
  // Execution scope (0083): 'project' = runs under the bound project; 'global' = tenant-wide.
  executionScope:       varchar('execution_scope', { length: 16 }).notNull().default('project'),
  // Fork lineage (0224): a global/shared workflow that gets modified for a project
  // is forked into a custom copy — this points at the template it was forked from.
  parentDefinitionId:   uuid('parent_definition_id').references((): AnyPgColumn => workflowDefinitions.id, { onDelete: 'set null' }),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
});

/**
 * IDE projects (0224) — the buildable artifact you open in the IDE (a Designer
 * app, an LLM, a Video, a Voice). A first-class child of a Project: many IDE
 * projects can hang off one container Project (`containerProjectId`, optional),
 * and each one is BACKED by a `projects` row (`storageProjectId`) that physically
 * holds its R2 files / datasets / training / site / repo workspace — so the
 * existing IDE storage routes are reused unchanged. `modality` mirrors the storage
 * project's modality so the modality-driven IDE page renders the right panels.
 */
export const ideProjects = pgTable('ide_projects', {
  id:                  serial('id').primaryKey(),
  publicId:            uuid('public_id').notNull().defaultRandom(),
  tenantId:            integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:           uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  /** The user-facing "Project" container this build is grouped under; NULL = ungrouped. */
  containerProjectId:  integer('container_project_id').references(() => projects.id, { onDelete: 'set null' }),
  /** The backing projects row holding this build's files/datasets/training/site/repo. */
  storageProjectId:    integer('storage_project_id').notNull().unique().references(() => projects.id, { onDelete: 'cascade' }),
  name:                varchar('name', { length: 255 }).notNull(),
  /** 'designer' | 'mobile' | 'video' | 'evermind' | 'finetune' | 'voice' (legacy: 'llm' → evermind). */
  modality:            text('modality').notNull().default('designer'),
  status:              text('status').notNull().default('active'),
  /** Optional automation workflow attached to this IDE project (any modality; the
   *  assigned, possibly forked-custom definition). LLM projects provision their model
   *  via an Evermind recipe at creation instead — this is no longer required. */
  workflowDefinitionId: uuid('workflow_definition_id').references((): AnyPgColumn => workflowDefinitions.id, { onDelete: 'set null' }),
  createdAt:           timestamp('created_at').notNull().defaultNow(),
  updatedAt:           timestamp('updated_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Workflow triggers — the materialized, activatable triggers (schedule /
// webhook / rss / inbound-email) extracted from a definition's trigger nodes on
// every save. The scheduler cron reads schedule+rss rows by `nextRunAt`; the
// public webhook + inbound-email entrypoints address rows by `token`. Re-synced
// (delete + recreate) whenever the owning definition is created/updated/imported
// so the registry never drifts from the graph. See application/workflow/triggerSync.
// ---------------------------------------------------------------------------

export const workflowTriggers = pgTable('workflow_triggers', {
  id:            uuid('id').primaryKey().defaultRandom(),
  tenantId:      integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:     uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  definitionId:  uuid('definition_id').notNull().references(() => workflowDefinitions.id, { onDelete: 'cascade' }),
  nodeId:        varchar('node_id', { length: 128 }).notNull(),
  triggerType:   varchar('trigger_type', { length: 32 }).notNull(),  // schedule|webhook|rss|inbound-email|monitor-breach|incident-created|incident-resolved|incident-status-change
  enabled:       boolean('enabled').notNull().default(true),
  config:        text('config').notNull().default('{}'),             // JSON of the trigger node config
  // Run target snapshot, inherited from the definition at sync time.
  runtime:       varchar('runtime', { length: 16 }).notNull().default('host'),
  agentHostId:   integer('agent_host_id').references(() => agentHosts.id, { onDelete: 'set null' }),
  cloudAgentRef: varchar('cloud_agent_ref', { length: 64 }),
  // Addressing (webhook / inbound-email): random URL/address-safe token + optional HMAC secret.
  token:         varchar('token', { length: 64 }).unique(),
  secret:        varchar('secret', { length: 128 }),
  // Polling state (schedule / rss): next due time + dedup cursor for rss.
  nextRunAt:     timestamp('next_run_at'),
  cursor:        text('cursor'),
  lastRunAt:     timestamp('last_run_at'),
  lastStatus:    varchar('last_status', { length: 32 }),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Usage snapshots — context window and token telemetry from the agentHost agent
// ---------------------------------------------------------------------------

export const usageSnapshots = pgTable('usage_snapshots', {
  id:               serial('id').primaryKey(),
  tenantId:         integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId: uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),  // DB NOT NULL via trigger (0056); optional in TS so single-mode writes need no change
  // Telemetry belongs to EITHER a self-hosted host OR a cloud agent (0092), so
  // agent_host_id is nullable; cloud rows carry cloud_agent_ref + execution_id instead.
  agentHostId:           integer('agent_host_id').references(() => agentHosts.id, { onDelete: 'cascade' }),
  /** Raw-SQL ide_agents.id for cloud-agent runs (no FK; see task.assignedAgentRef). */
  cloudAgentRef:    varchar('cloud_agent_ref', { length: 64 }),
  /** Execution this snapshot belongs to — the trace key for cloud runs (no live session). */
  executionId:      integer('execution_id'),
  sessionKey:       varchar('session_key', { length: 255 }).notNull(),
  inputTokens:      integer('input_tokens').notNull().default(0),
  outputTokens:     integer('output_tokens').notNull().default(0),
  contextTokens:    integer('context_tokens').notNull().default(0),
  contextWindowMax: integer('context_window_max').notNull().default(0),
  compactionCount:  integer('compaction_count').notNull().default(0),
  ts:               timestamp('ts').notNull().defaultNow(),
  createdAt:        timestamp('created_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Tool audit events — immutable, append-only log of tool calls made by agents
// ---------------------------------------------------------------------------

export const toolAuditEvents = pgTable('tool_audit_events', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId: uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),  // DB NOT NULL via trigger (0056); optional in TS so single-mode writes need no change
  // Telemetry belongs to EITHER a self-hosted host OR a cloud agent (0092), so
  // agent_host_id is nullable; cloud rows carry cloud_agent_ref + execution_id instead.
  agentHostId:      integer('agent_host_id').references(() => agentHosts.id, { onDelete: 'cascade' }),
  /** Raw-SQL ide_agents.id for cloud-agent runs (no FK; see task.assignedAgentRef). */
  cloudAgentRef: varchar('cloud_agent_ref', { length: 64 }),
  /** Execution this event belongs to — the trace key for cloud runs (no live session). */
  executionId: integer('execution_id'),
  runId:       varchar('run_id', { length: 255 }),
  sessionKey:  varchar('session_key', { length: 255 }),
  toolCallId:  varchar('tool_call_id', { length: 255 }),
  toolName:    varchar('tool_name', { length: 255 }).notNull(),
  category:    varchar('category', { length: 100 }),  // free-form classification e.g. thinking, tool, code_edit
  args:        text('args'),     // JSON object stored as text
  result:      text('result'),
  durationMs:  integer('duration_ms'),
  ts:          timestamp('ts').notNull().defaultNow(),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// OTel spans — W3C-compatible workflow trace spans forwarded from BuilderForce Agents
// ---------------------------------------------------------------------------

export const telemetrySpans = pgTable('telemetry_spans', {
  id:               serial('id').primaryKey(),
  tenantId:         integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId: uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),  // DB NOT NULL via trigger (0056); optional in TS so single-mode writes need no change
  agentHostId:           integer('agent_host_id').references(() => agentHosts.id, { onDelete: 'set null' }),
  traceId:          varchar('trace_id', { length: 32 }).notNull(),
  workflowId:       varchar('workflow_id', { length: 36 }),
  taskId:           varchar('task_id', { length: 36 }),
  kind:             varchar('kind', { length: 64 }).notNull(),     // SpanKind from BuilderForce Agents
  agentRole:        varchar('agent_role', { length: 255 }),
  description:      text('description'),
  durationMs:       integer('duration_ms'),
  model:            varchar('model', { length: 255 }),
  inputTokens:      integer('input_tokens'),
  outputTokens:     integer('output_tokens'),
  estimatedCostUsd: integer('estimated_cost_usd_millicents'),       // stored as millicents to avoid floats
  error:            text('error'),
  ts:               timestamp('ts').notNull(),
  createdAt:        timestamp('created_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Approvals — human-in-the-loop gate for destructive / high-risk agent actions
// ---------------------------------------------------------------------------

export const approvals = pgTable('approvals', {
  id:          uuid('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId: uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),  // DB NOT NULL via trigger (0056); optional in TS so single-mode writes need no change
  agentHostId:      integer('agent_host_id').references(() => agentHosts.id, { onDelete: 'set null' }),
  requestedBy: varchar('requested_by', { length: 36 }),   // agentHost ID or user ID as string
  // What the agent is bubbling up for a human: 'approval' (approve/reject a
  // high-risk action), 'question' (needs a free-text answer to proceed), or
  // 'feedback' (wants human review/comments). All three share this table + the
  // same blocking gate; only the kind + how it's resolved differ.
  kind:        varchar('kind', { length: 32 }).notNull().default('approval'),
  actionType:  varchar('action_type', { length: 255 }).notNull(),
  description: text('description').notNull(),
  metadata:    text('metadata'),
  // Cloud-run scope (migration 0120). Cloud agents have no agent_host_id; a
  // question they raise carries the execution it paused so the answer resumes
  // that exact run. Null for self-hosted approvals (those route via agent_host_id).
  executionId:   integer('execution_id'),
  cloudAgentRef: varchar('cloud_agent_ref', { length: 64 }),
  status:      approvalStatusEnum('status').notNull().default('pending'),
  reviewedBy:  varchar('reviewed_by', { length: 36 }),
  reviewNote:  text('review_note'),
  // Free-text human answer for 'question'/'feedback' kinds (status='answered').
  responseText: text('response_text'),
  expiresAt:   timestamp('expires_at'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Approval rules — configurable auto-approval based on action type and thresholds
// ---------------------------------------------------------------------------

export const approvalRules = pgTable('approval_rules', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  tenantId:           integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId: uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),  // DB NOT NULL via trigger (0056); optional in TS so single-mode writes need no change
  name:               varchar('name', { length: 255 }).notNull(),
  /** Null = matches all action types */
  actionType:         varchar('action_type', { length: 255 }),
  /** Auto-approve when estimated_cost in metadata ≤ this value (USD). Null = ignore. */
  maxEstimatedCost:   integer('max_estimated_cost'),
  /** Auto-approve when files_changed in metadata ≤ this value. Null = ignore. */
  maxFilesChanged:    integer('max_files_changed'),
  isEnabled:          boolean('is_enabled').notNull().default(true),
  createdAt:          timestamp('created_at').notNull().defaultNow(),
  updatedAt:          timestamp('updated_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Chat memories — compressed summaries of individual chats
// ---------------------------------------------------------------------------
// (The legacy Brain-only `brain_chats`/`brain_messages` tables — superseded by the
// unified chats table in 0026 and orphaned — were dropped in migration 0271; the
// unified table itself was renamed brain_chats there. See `brainChats` below.)

export const chatMemories = pgTable('chat_memories', {
  id:             serial('id').primaryKey(),
  tenantId:       integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId: uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),  // DB NOT NULL via trigger (0056); optional in TS so single-mode writes need no change
  // Vestigial link to the old legacy brain_chats (dropped 0272) — chat memories
  // are keyed on agent_host_session_id in practice; no FK (plain nullable id).
  chatId:         integer('chat_id').unique(),
  agentHostSessionId:  integer('agent_host_session_id').references(() => chatSessions.id, { onDelete: 'cascade' }).unique(),
  projectId:      integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
  summary:        text('summary').notNull().default(''),
  createdAt:      timestamp('created_at').notNull().defaultNow(),
  updatedAt:      timestamp('updated_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Project memories — consolidated summaries across all chats for a project
// ---------------------------------------------------------------------------

export const projectMemories = pgTable('project_memories', {
  id:                   serial('id').primaryKey(),
  tenantId:             integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId: uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),  // DB NOT NULL via trigger (0056); optional in TS so single-mode writes need no change
  projectId:            integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }).unique(),
  consolidatedSummary:  text('consolidated_summary').notNull().default(''),
  createdAt:            timestamp('created_at').notNull().defaultNow(),
  updatedAt:            timestamp('updated_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Brain chats (unified, all-modality) — Brain Storm, IDE, and project-level chat
// in ONE table (this is the store the live Brain reads/writes on every surface —
// web, VS Code, on-prem). origin = 'brainstorm' | 'ide' | 'project' | 'team' tells
// the page which tools/actions to load. origin='team' is the canonical, always-there
// GROUP chat for a whole team — ONE per (tenant, projectId), projectId NULL for the
// tenant-wide team chat (see migration 0294's uq_team_chat_scope). Named
// `ide_project_chats` until migration 0272
// renamed it `brain_chats` (the `ide_` prefix was a historical artifact — it
// started IDE-only, then 0026 generalized it via the origin column).
// ---------------------------------------------------------------------------

export const brainChats = pgTable('brain_chats', {
  id:        serial('id').primaryKey(),
  projectId: integer('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  tenantId:  integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId: uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),  // DB NOT NULL via trigger (0056); optional in TS so single-mode writes need no change
  userId:    varchar('user_id', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  origin:     varchar('origin', { length: 32 }).notNull().default('ide'),
  title:      varchar('title', { length: 500 }).notNull().default('New chat'),
  summary:    text('summary'),
  isArchived: boolean('is_archived').notNull().default(false),
  /** LOCK primitive (0288): 'shared' = visible/joinable by any tenant teammate
   *  (chats are global to project+tenant); 'locked' = private to owner + members. */
  visibility: varchar('visibility', { length: 16 }).notNull().default('shared'),
  /** What this chat is MAKING (0345) — a capability id from the client-side
   *  registry (document / slides / dataviz / spreadsheet / website / design /
   *  mobile / animation / game3d). Shapes the system prompt and the export format.
   *  NULL = no capability ("anything"). Free-form: an unknown id reads as NULL. */
  capability: varchar('capability', { length: 64 }),
  /** Consolidation pointer (0266): when this chat was merged into another, the
   *  surviving chat's id. Set with isArchived=true so the source drops out of the
   *  list but any ticket still resolves to the one surviving conversation. */
  mergedIntoChatId: integer('merged_into_chat_id').references((): AnyPgColumn => brainChats.id, { onDelete: 'set null' }),
  /** TEAM CHAT scope (0294): when origin='team', which workforce team this chat is
   *  the group channel for. NULL (with projectId also NULL) = the tenant-wide
   *  "broader team" chat; projectId set = the project team chat. */
  teamId:     integer('team_id').references(() => teams.id, { onDelete: 'cascade' }),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
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
// Chat read state (0361) — per-user read high-water mark for a Brain chat, so the
// web can show an "unread" badge when execution milestones (or a teammate/agent
// message) land in a chat the user is not viewing. Keyed by (chat_id, user_id) so
// it covers BOTH the chat owner (no chat_members row) and shared participants.
// last_read_seq is compared against brain_chat_messages.seq (= the message PK):
// unread when max(seq) > last_read_seq. A row exists only once the user has OPENED
// the chat — so unread accrues only on conversations the user has actually read.
// ---------------------------------------------------------------------------

export const chatReadState = pgTable('chat_read_state', {
  chatId:      integer('chat_id').notNull().references(() => brainChats.id, { onDelete: 'cascade' }),
  userId:      varchar('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  lastReadSeq: integer('last_read_seq').notNull().default(0),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.chatId, t.userId] }),
  index('idx_chat_read_state_user').on(t.tenantId, t.userId),
]);

// ---------------------------------------------------------------------------
// Chat <-> ticket links (0266) — a many-to-many, lineage-aware edge between a
// Brain chat and a work item of ANY tier (portfolio | objective | initiative |
// epic | task). MANY chats can reference one ticket; ONE chat can reference MANY
// tickets (a brainstorm that spawned several). ticketRef is the target id AS TEXT
// (tasks.id is int; the strategy-tier ids are UUIDs) so one column addresses
// every tier — resolved against the right table by ticketKind at read time.
// ---------------------------------------------------------------------------

export const chatTicketLinks = pgTable('chat_ticket_links', {
  id:         serial('id').primaryKey(),
  tenantId:   integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:  uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  chatId:     integer('chat_id').notNull().references(() => brainChats.id, { onDelete: 'cascade' }),
  /** 'portfolio'|'objective'|'initiative'|'roadmap'|'spec'|'epic'|'gap'|'task' (spine + roadmap + spec + gap). */
  ticketKind: varchar('ticket_kind', { length: 12 }).notNull(),
  /** Target id as text — tasks.id (epic/gap/task) or a UUID (portfolio/objective/initiative/roadmap/spec). */
  ticketRef:  varchar('ticket_ref', { length: 64 }).notNull(),
  /** Lineage: 'created' (ticket spawned from this chat) | 'linked' (attached later). */
  linkType:   varchar('link_type', { length: 16 }).notNull().default('linked'),
  /** User id or agent ref that made the link (provenance). */
  createdBy:  varchar('created_by', { length: 64 }),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_chat_ticket_links').on(t.chatId, t.ticketKind, t.ticketRef),
  index('idx_chat_ticket_links_chat').on(t.tenantId, t.chatId),
  index('idx_chat_ticket_links_ticket').on(t.tenantId, t.ticketKind, t.ticketRef),
]);

// ---------------------------------------------------------------------------
// Cron jobs (agentHost-scoped, optionally project-associated, synced via GUID)
// ---------------------------------------------------------------------------

export const cronJobs = pgTable('cron_jobs', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId: uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),  // DB NOT NULL via trigger (0056); optional in TS so single-mode writes need no change
  agentHostId:      integer('agent_host_id').notNull().references(() => agentHosts.id, { onDelete: 'cascade' }),
  projectId:   integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
  /** Scopes the schedule to one attached agent (project_agents.id); NULL = project-wide. */
  projectAgentId: integer('project_agent_id').references(() => projectAgents.id, { onDelete: 'cascade' }),
  name:        varchar('name', { length: 255 }).notNull(),
  schedule:    varchar('schedule', { length: 255 }).notNull(),
  taskId:      integer('task_id').references(() => tasks.id, { onDelete: 'set null' }),
  enabled:     boolean('enabled').notNull().default(true),
  lastRunAt:   timestamp('last_run_at'),
  nextRunAt:   timestamp('next_run_at'),
  lastStatus:  varchar('last_status', { length: 50 }),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
});

export const brainChatMessages = pgTable('brain_chat_messages', {
  id:        serial('id').primaryKey(),
  chatId:    integer('chat_id').notNull().references(() => brainChats.id, { onDelete: 'cascade' }),
  role:      varchar('role', { length: 16 }).notNull(),
  content:   text('content').notNull().default(''),
  metadata:  text('metadata'),
  /** Optional producer idempotency key (for example executionId:phase). */
  eventKey:  varchar('event_key', { length: 160 }),
  seq:       integer('seq').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_brain_chat_messages_event').on(t.chatId, t.eventKey),
]);

// ---------------------------------------------------------------------------
// Brain chat TRACE (0330) — the tool/LLM-turn timeline that survives a reload.
// A Brain run streams a sequence of trace events (llm | tool | recall | learn |
// reconcile | message | error) that the webview renders as the "thinking" /
// tool-call timeline. Those events lived only in the browser, so reopening a
// chat lost every tool turn. This table persists them (append-only, per chat)
// so the frontend can rehydrate the timeline on chat load. Kept deliberately
// simple: one row per event, JSON args/result as text, durations for the UI.
// ---------------------------------------------------------------------------

export const brainChatTrace = pgTable('brain_chat_trace', {
  id:         serial('id').primaryKey(),
  chatId:     integer('chat_id').notNull().references(() => brainChats.id, { onDelete: 'cascade' }),
  /** Monotonic per-run turn ordinal (groups events of the same assistant turn). */
  turnSeq:    integer('turn_seq'),
  /** 'llm'|'tool'|'message'|'recall'|'learn'|'reconcile'|'error'. */
  kind:       varchar('kind', { length: 24 }).notNull(),
  /** Short human label (tool name, model id, step name). */
  label:      varchar('label', { length: 120 }),
  /** JSON-as-text: the tool/LLM call arguments (bounded by the caller). */
  argsJson:   text('args_json'),
  /** JSON-as-text: the tool/LLM result (bounded by the caller). */
  resultJson: text('result_json'),
  isError:    boolean('is_error').notNull().default(false),
  /** Full-step wall time (ms). */
  durationMs: integer('duration_ms'),
  /** Time-to-first-token (ms) for an 'llm' step; null otherwise. */
  ttftMs:     integer('ttft_ms'),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('idx_brain_chat_trace_chat').on(t.chatId, t.id),
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

/** One-time 6-digit email-ownership codes issued at password signup (and re-issued when
 *  an unverified account tries to sign in). The code itself is never stored — only its
 *  SHA-256 hash. A row is consumed on success, superseded when a newer code is issued,
 *  and rejected once `attempts` hits the cap or `expiresAt` passes. (mig 0285) */
export const emailVerificationCodes = pgTable('email_verification_codes', {
  id:         uuid('id').primaryKey().defaultRandom(),
  userId:     varchar('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  email:      varchar('email', { length: 255 }).notNull(),
  codeHash:   varchar('code_hash', { length: 64 }).notNull(),
  expiresAt:  timestamp('expires_at').notNull(),
  attempts:   integer('attempts').notNull().default(0),
  consumedAt: timestamp('consumed_at'),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
});

// ===========================================================================
// PHASE 6 — Dev Analytics & Team Intelligence (DevDynamics)
// ===========================================================================

// ---------------------------------------------------------------------------
// 6a — Integration providers + credentials
// ---------------------------------------------------------------------------

export const integrationProviderEnum = pgEnum('integration_provider', [
  'github', 'gitlab', 'bitbucket', 'jira', 'confluence', 'freshservice', 'rally', 'freshworks',
  'freshdesk',
  'google_calendar',
  // 0221 — single-pane / migration connectors
  'servicenow', 'linear', 'sentry', 'pagerduty', 'monday', 'asana', 'clickup',
  // 0353 — BYO web-search vendor keys (backs the cloud agent's `web_search` tool).
  // Ids MUST match WEB_SEARCH_VENDOR_IDS in application/runtime/webSearchVendors.ts.
  'brave_search',
  // 0355 — Google connectors (OAuth offline credentials). Gmail backs the email
  // workflow node; Google Drive can back a project's file storage.
  'gmail', 'google_drive',
]);

export const integrationSyncStatusEnum = pgEnum('integration_sync_status', [
  'idle', 'syncing', 'success', 'error',
]);

/**
 * Per-tenant integration credentials.
 * Token is stored AES-256-GCM encrypted (handled by application layer).
 */
export const integrationCredentials = pgTable('integration_credentials', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenantId:       integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId: uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),  // DB NOT NULL via trigger (0056); optional in TS so single-mode writes need no change
  /** NULL = workspace-global credential; set = scoped to a single project (0074). */
  projectId:      integer('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  provider:       integrationProviderEnum('provider').notNull(),
  /** Display label, e.g. "Production Jira" */
  name:           varchar('name', { length: 255 }).notNull(),
  baseUrl:        varchar('base_url', { length: 500 }),
  /** AES-GCM encrypted JSON: { accessToken, refreshToken?, apiToken? } */
  credentialsEnc: text('credentials_enc').notNull(),
  /** Ephemeral IV used for this credential's encryption (hex). */
  iv:             varchar('iv', { length: 64 }).notNull(),
  isEnabled:      boolean('is_enabled').notNull().default(true),
  lastTestedAt:   timestamp('last_tested_at'),
  lastTestOk:     boolean('last_test_ok'),
  createdAt:      timestamp('created_at').notNull().defaultNow(),
  updatedAt:      timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  unique('uq_integration_tenant_provider_name').on(t.tenantId, t.provider, t.name),
]);

/**
 * Sync run log — one row per integration sync attempt.
 */
export const integrationSyncLogs = pgTable('integration_sync_logs', {
  id:              serial('id').primaryKey(),
  tenantId:        integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId: uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),  // DB NOT NULL via trigger (0056); optional in TS so single-mode writes need no change
  credentialId:    uuid('credential_id').notNull().references(() => integrationCredentials.id, { onDelete: 'cascade' }),
  status:          integrationSyncStatusEnum('status').notNull().default('syncing'),
  itemsProcessed:  integer('items_processed').notNull().default(0),
  itemsErrored:    integer('items_errored').notNull().default(0),
  errorMessage:    text('error_message'),
  durationMs:      integer('duration_ms'),
  cursorAfter:     text('cursor_after'),   // opaque cursor for next incremental sync
  startedAt:       timestamp('started_at').notNull().defaultNow(),
  completedAt:     timestamp('completed_at'),
});

// ---------------------------------------------------------------------------
// 6b — Contributors (cross-platform unified profile)
// ---------------------------------------------------------------------------

/**
 * Unified contributor profile.  One row per unique person per tenant.
 * Multiple platform identities (GitHub login, Jira account ID, etc.) are
 * stored in contributor_identities.
 */
export const contributors = pgTable('contributors', {
  id:            serial('id').primaryKey(),
  tenantId:      integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId: uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),  // DB NOT NULL via trigger (0056); optional in TS so single-mode writes need no change
  displayName:   varchar('display_name', { length: 255 }).notNull(),
  email:         varchar('email', { length: 255 }),
  avatarUrl:     text('avatar_url'), // unbounded external URL (GitHub/Jira/R2); widened mig 0356
  jobTitle:      varchar('job_title', { length: 255 }),
  /** Role classification: 'developer' | 'manager' | 'qa' | 'devops' | 'other' */
  roleType:      varchar('role_type', { length: 50 }).notNull().default('developer'),
  /** Exclude from productivity calculations (QA, PM, etc.). */
  excludeFromMetrics: boolean('exclude_from_metrics').notNull().default(false),
  /** userId if this contributor is also a Builderforce user. */
  userId:        varchar('user_id', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  /** 'human' (git/PR contributor) | 'agent' (a BuilderForce Agents acting as a teammate). */
  kind:          varchar('kind', { length: 16 }).notNull().default('human'),
  /** For agent contributors: the agent host instance whose telemetry rolls up here. */
  agentHostId:        integer('agent_host_id').references(() => agentHosts.id, { onDelete: 'set null' }),
  /** Tombstone pointer: when this profile was merged into another, the survivor's
   *  id (and is_active is set false). Kept — not deleted — so the merge is
   *  auditable and reversible. NULL = a live, un-merged contributor. (0205) */
  mergedIntoId:  integer('merged_into_id').references((): AnyPgColumn => contributors.id, { onDelete: 'set null' }),
  isActive:      boolean('is_active').notNull().default(true),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  // One agent contributor per (tenant, agent host) — lets POST /sync-agents
  // `onConflictDoUpdate` instead of racing select-then-insert [1557]. Partial so
  // it constrains only agent rows; human contributors aren't agent-host-keyed.
  uniqueIndex('uq_contributors_tenant_agent_host')
    .on(t.tenantId, t.agentHostId)
    .where(sql`${t.kind} = 'agent'`),
]);

/**
 * Cross-platform identity reconciliation.
 * e.g. contributor 42 is "johndoe" on GitHub AND "john.doe@example.com" on Jira.
 */
export const contributorIdentities = pgTable('contributor_identities', {
  id:            serial('id').primaryKey(),
  contributorId: integer('contributor_id').notNull().references(() => contributors.id, { onDelete: 'cascade' }),
  tenantId:      integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId: uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),  // DB NOT NULL via trigger (0056); optional in TS so single-mode writes need no change
  provider:      integrationProviderEnum('provider').notNull(),
  externalId:    varchar('external_id', { length: 255 }).notNull(), // GitHub login, Jira account ID, etc.
  externalEmail: varchar('external_email', { length: 255 }),
  displayName:   varchar('display_name', { length: 255 }),
  avatarUrl:     text('avatar_url'), // unbounded external provider URL; widened mig 0356
  createdAt:     timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  unique('uq_identity_provider_external').on(t.tenantId, t.provider, t.externalId),
]);

// ---------------------------------------------------------------------------
// 6c — Activity events (commits, PRs, reviews, issues)
// ---------------------------------------------------------------------------

export const activityEventTypeEnum = pgEnum('activity_event_type', [
  'commit', 'pr_opened', 'pr_merged', 'pr_closed', 'pr_reviewed',
  'issue_created', 'issue_resolved', 'issue_commented',
]);

/**
 * Raw activity events ingested from integrations.
 * One row per discrete event (commit, PR action, issue action).
 */
export const activityEvents = pgTable('activity_events', {
  id:             serial('id').primaryKey(),
  tenantId:       integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId: uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),  // DB NOT NULL via trigger (0056); optional in TS so single-mode writes need no change
  contributorId:  integer('contributor_id').references(() => contributors.id, { onDelete: 'set null' }),
  credentialId:   uuid('credential_id').references(() => integrationCredentials.id, { onDelete: 'set null' }),
  /** Project this activity is attributed to, resolved at ingest from the connected
   *  repo (project_repositories, else projects.source_control_repo_full_name).
   *  NULL = repo not linked to a project yet. (0212) */
  projectId:      integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
  provider:       integrationProviderEnum('provider').notNull(),
  eventType:      activityEventTypeEnum('event_type').notNull(),
  externalId:     varchar('external_id', { length: 255 }),  // commit SHA, PR number, issue ID
  repositoryName: varchar('repository_name', { length: 255 }),
  repositoryFullName: varchar('repository_full_name', { length: 500 }),
  title:          text('title'),
  url:            varchar('url', { length: 500 }),
  /** For commits: lines added */
  linesAdded:     integer('lines_added'),
  /** For commits: lines removed */
  linesRemoved:   integer('lines_removed'),
  /** For commits: files changed */
  filesChanged:   integer('files_changed'),
  /** For PRs: time from open to merge/close in hours */
  cycleTimeHours: integer('cycle_time_hours'),
  occurredAt:     timestamp('occurred_at').notNull(),
  createdAt:      timestamp('created_at').notNull().defaultNow(),
  /** Reversibility marker: when a contributor was merged away, its events are
   *  re-pointed to the survivor and stamped with the loser's id here, so an
   *  un-merge can move exactly those rows back set-based. NULL = never moved. (0205) */
  mergedFromContributorId: integer('merged_from_contributor_id'),
}, (t) => [
  unique('uq_activity_provider_external').on(t.tenantId, t.provider, t.eventType, t.externalId),
]);

// ---------------------------------------------------------------------------
// 6d — Daily aggregated metrics per contributor
// ---------------------------------------------------------------------------

export const contributorDailyMetrics = pgTable('contributor_daily_metrics', {
  id:              serial('id').primaryKey(),
  tenantId:        integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId: uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),  // DB NOT NULL via trigger (0056); optional in TS so single-mode writes need no change
  contributorId:   integer('contributor_id').notNull().references(() => contributors.id, { onDelete: 'cascade' }),
  date:            timestamp('date').notNull(),   // date truncated to day (UTC midnight)
  commits:         integer('commits').notNull().default(0),
  prsOpened:       integer('prs_opened').notNull().default(0),
  prsMerged:       integer('prs_merged').notNull().default(0),
  prsReviewed:     integer('prs_reviewed').notNull().default(0),
  issuesCreated:   integer('issues_created').notNull().default(0),
  issuesResolved:  integer('issues_resolved').notNull().default(0),
  linesAdded:      integer('lines_added').notNull().default(0),
  linesRemoved:    integer('lines_removed').notNull().default(0),
  filesChanged:    integer('files_changed').notNull().default(0),
  /** Weighted activity score: commits×1 + PRs×3 + reviews×2 + issues×1.5 */
  activityScore:   integer('activity_score').notNull().default(0),
  /** Whether this was an active dev day (≥1 commit or PR action) */
  isActiveDay:     boolean('is_active_day').notNull().default(false),
  createdAt:       timestamp('created_at').notNull().defaultNow(),
  updatedAt:       timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  unique('uq_contributor_daily').on(t.tenantId, t.contributorId, t.date),
]);

/**
 * Audit + undo log for contributor consolidation (0205). One row per merge of a
 * `source` (loser, tombstoned) contributor into a `target` (survivor). The bulk
 * reassignment (activity_events) is reversed via activity_events.merged_from_
 * contributor_id; the small things without a column marker (moved/deduped
 * identities, team memberships, the survivor's prior user link) live in
 * undoPayload so a revert can restore them exactly.
 */
export const contributorMerges = pgTable('contributor_merges', {
  id:                   uuid('id').primaryKey().defaultRandom(),
  tenantId:             integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:            uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  targetContributorId:  integer('target_contributor_id').references(() => contributors.id, { onDelete: 'set null' }),
  sourceContributorId:  integer('source_contributor_id').references(() => contributors.id, { onDelete: 'set null' }),
  movedActivityCount:   integer('moved_activity_count').notNull().default(0),
  movedIdentityCount:   integer('moved_identity_count').notNull().default(0),
  undoPayload:          jsonb('undo_payload'),
  status:               varchar('status', { length: 16 }).notNull().default('merged'), // 'merged' | 'reverted'
  mergedByUserId:       varchar('merged_by_user_id', { length: 36 }),
  mergedAt:             timestamp('merged_at').notNull().defaultNow(),
  revertedAt:           timestamp('reverted_at'),
});

// ---------------------------------------------------------------------------
// 6e — Team hierarchy
// ---------------------------------------------------------------------------

export const devTeams = pgTable('dev_teams', {
  id:            serial('id').primaryKey(),
  tenantId:      integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId: uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),  // DB NOT NULL via trigger (0056); optional in TS so single-mode writes need no change
  name:          varchar('name', { length: 255 }).notNull(),
  description:   text('description'),
  parentTeamId:  integer('parent_team_id'), // self-reference: child → parent
  managerId:     integer('manager_id').references(() => contributors.id, { onDelete: 'set null' }),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
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

// ---------------------------------------------------------------------------
// Workforce Teams — group the workforce (agents AND humans) into named teams and
// attach a team to projects. Distinct from `devTeams` (contributor analytics):
// a member here is a first-class assignable workforce entity, identified exactly
// like a task assignee — a human (users.id), a cloud agent (ide_agents.id), or a
// remote host (agent_hosts.id). See migration 0114.
// ---------------------------------------------------------------------------
// teamMemberKindEnum is declared earlier (near member_profiles) so the lifecycle
// metrics tables that share the polymorphic member identity can reference it.

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

export const teamProjects = pgTable('team_projects', {
  id:        serial('id').primaryKey(),
  teamId:    integer('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  addedAt:   timestamp('added_at').notNull().defaultNow(),
}, (t) => [
  unique('uq_team_project').on(t.teamId, t.projectId),
]);

// ---------------------------------------------------------------------------
// 6f — Scheduled reports + subscriptions
// ---------------------------------------------------------------------------

export const reportTypeEnum = pgEnum('report_type', [
  'standup', 'code_review', 'project_status', 'executive_summary', 'portfolio_rollup',
]);

export const reportScheduleEnum = pgEnum('report_schedule', [
  'daily', 'weekly', 'monthly',
]);

export const reportSchedules = pgTable('report_schedules', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenantId:     integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId: uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),  // DB NOT NULL via trigger (0056); optional in TS so single-mode writes need no change
  reportType:   reportTypeEnum('report_type').notNull(),
  schedule:     reportScheduleEnum('schedule').notNull(),
  /** UTC hour to deliver (0–23) */
  deliveryHour: integer('delivery_hour').notNull().default(8),
  /** JSON array of email addresses */
  recipients:   text('recipients').notNull().default('[]'),
  isEnabled:    boolean('is_enabled').notNull().default(true),
  /** Attached tabular artifact format for the delivered report (EMP-20, mig 0318). */
  exportFormat: varchar('export_format', { length: 8 }).notNull().default('csv'), // csv | html
  lastRunAt:    timestamp('last_run_at'),
  nextRunAt:    timestamp('next_run_at'),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
});

export const reportSubscriptions = pgTable('report_subscriptions', {
  id:            serial('id').primaryKey(),
  tenantId:      integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId: uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),  // DB NOT NULL via trigger (0056); optional in TS so single-mode writes need no change
  userId:        varchar('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  reportType:    reportTypeEnum('report_type').notNull(),
  isSubscribed:  boolean('is_subscribed').notNull().default(true),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  unique('uq_subscription_user_type').on(t.tenantId, t.userId, t.reportType),
]);

// ---------------------------------------------------------------------------
// Team memory — cross-agentHost memory sharing mesh (P4-5)
// ---------------------------------------------------------------------------

export const teamMemory = pgTable('team_memory', {
  id:        uuid('id').primaryKey().defaultRandom(),
  tenantId:  integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId: uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),  // DB NOT NULL via trigger (0056); optional in TS so single-mode writes need no change
  /** Numeric agentHost ID stored as string for flexibility. */
  agentHostId:    varchar('agent_host_id', { length: 64 }).notNull(),
  runId:     varchar('run_id', { length: 64 }).notNull(),
  summary:   text('summary').notNull(),
  /** JSON array of tag strings, stored as text. */
  tags:      text('tags').notNull().default('[]'),
  /** ISO-8601 timestamp provided by the agentHost. */
  timestamp: varchar('timestamp', { length: 32 }).notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// Cloud agent memory — durable key→fact store backing the shared `memory` capability
// (memory_recall / memory_remember) for Worker/DO agents, scoped per tenant. The
// Worker-safe twin of the on-prem SSM MemoryStore: same tool contract, lexical recall
// (Postgres ILIKE) instead of SSM embeddings. Unique (tenant_id, key) (migration 0200)
// makes remember() an upsert.
export const agentMemory = pgTable('agent_memory', {
  id:         uuid('id').primaryKey().defaultRandom(),
  tenantId:   integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  key:        varchar('key', { length: 255 }).notNull(),
  content:    text('content').notNull(),
  /** JSON array of tag strings, stored as text. */
  tags:       text('tags').notNull().default('[]'),
  importance: real('importance').notNull().default(0.5),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
});

// Shared per-PROJECT write-through facts store (migration 0276) — the project-scoped
// twin of agent_memory. Every surface (VS Code, web Brain, cloud, on-prem) reads +
// writes the same project facts, so a fact one run learns is recalled by all. The
// (tenant_id, project_id, key) uniqueness is enforced in the migration (upsert target).
export const projectFacts = pgTable('project_facts', {
  id:         uuid('id').primaryKey().defaultRandom(),
  tenantId:   integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  projectId:  integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  key:        varchar('key', { length: 255 }).notNull(),
  content:    text('content').notNull(),
  source:     varchar('source', { length: 64 }).notNull().default('agent'),
  importance: real('importance').notNull().default(0.5),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Prompt Library — versioned prompt templates with a public gallery
// (Composite uniqueness/PKs are enforced in migration 0069. These tables use
//  the plain object form so the schema-drift parser captures them discretely.)
// ---------------------------------------------------------------------------

/**
 * A prompt template. Authored within a tenant; publishable to a public gallery
 * (visibility='public') that anyone can browse and "use". The body lives in
 * prompt_library_versions (immutable, versioned); current_version points at the
 * active one. Unique (tenant_id, slug) is enforced by migration 0069.
 */
export const promptLibraryEntries = pgTable('prompt_library_entries', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenantId:       integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId: uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),  // DB NOT NULL via trigger (0056); optional in TS so single-mode writes need no change
  slug:           varchar('slug', { length: 255 }).notNull(),
  title:          varchar('title', { length: 255 }).notNull(),
  description:    text('description'),
  category:       varchar('category', { length: 100 }),
  /** JSON array of tag strings, stored as text. */
  tags:           text('tags').notNull().default('[]'),
  /** 'private' | 'tenant' | 'public' */
  visibility:     varchar('visibility', { length: 16 }).notNull().default('private'),
  authorUserId:   varchar('author_user_id', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  authorName:     varchar('author_name', { length: 255 }),
  currentVersion: integer('current_version').notNull().default(1),
  usageCount:     integer('usage_count').notNull().default(0),
  starCount:      integer('star_count').notNull().default(0),
  isFeatured:     boolean('is_featured').notNull().default(false),
  createdAt:      timestamp('created_at').notNull().defaultNow(),
  updatedAt:      timestamp('updated_at').notNull().defaultNow(),
});

/** Immutable version of a prompt entry's body. Unique (entry_id, version) in 0069. */
export const promptLibraryVersions = pgTable('prompt_library_versions', {
  id:        uuid('id').primaryKey().defaultRandom(),
  entryId:   uuid('entry_id').notNull().references(() => promptLibraryEntries.id, { onDelete: 'cascade' }),
  version:   integer('version').notNull(),
  body:      text('body').notNull(),
  /** JSON array of { name, description, default } variable descriptors. */
  variables: text('variables').notNull().default('[]'),
  model:     varchar('model', { length: 255 }),
  notes:     text('notes'),
  createdBy: varchar('created_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

/** Per-user star ("like") on a prompt entry. PK (entry_id, user_id) in 0069. */
export const promptLibraryStars = pgTable('prompt_library_stars', {
  entryId:   uuid('entry_id').notNull().references(() => promptLibraryEntries.id, { onDelete: 'cascade' }),
  userId:    varchar('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

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

/**
 * Append-only audit log for all Super Admin actions.
 * No UPDATE or DELETE should ever be issued against this table via the app layer.
 */
export const adminAuditLog = pgTable('admin_audit_log', {
  id:           uuid('id').primaryKey().defaultRandom(),
  event:        varchar('event', { length: 64 }).notNull(),
  actorId:      varchar('actor_id', { length: 36 }).references(() => users.id),
  targetUserId: varchar('target_user_id', { length: 36 }).references(() => users.id),
  tenantId:     integer('tenant_id').references(() => tenants.id),
  metadata:     text('metadata').notNull().default('{}'),  // JSON object
  ipAddress:    varchar('ip_address', { length: 64 }),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
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
// Governance & Security compliance trackers (doc 07, Phase 2; migration 0057).
// Segment-scoped like every business entity. segment_id is NOT NULL in the DB
// (auto-filled by the 0056 default-segment trigger); optional in TS so writes
// need no change in single-tenant mode.
// ---------------------------------------------------------------------------

export const socControls = pgTable('soc_controls', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:   uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  controlRef:  varchar('control_ref', { length: 50 }).notNull(),
  category:    varchar('category', { length: 20 }).notNull(),
  name:        varchar('name', { length: 255 }).notNull(),
  requirement: text('requirement'),
  status:      varchar('status', { length: 20 }).notNull().default('not_started'),
  ownerId:     varchar('owner_id', { length: 64 }),
  notes:       text('notes'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
});

export const socEvidence = pgTable('soc_evidence', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenantId:     integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:    uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  controlId:    uuid('control_id').notNull().references(() => socControls.id, { onDelete: 'cascade' }),
  title:        varchar('title', { length: 255 }).notNull(),
  evidenceType: varchar('evidence_type', { length: 20 }).notNull(),
  url:          varchar('url', { length: 1000 }),
  note:         text('note'),
  uploadedBy:   varchar('uploaded_by', { length: 64 }),
  sourceRef:    text('source_ref'),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
});

export const securityVendors = pgTable('security_vendors', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenantId:       integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:      uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  name:           varchar('name', { length: 255 }).notNull(),
  purpose:        text('purpose'),
  region:         varchar('region', { length: 100 }),
  dataClasses:    text('data_classes'),
  isSubprocessor: boolean('is_subprocessor').notNull().default(false),
  dpaStatus:      varchar('dpa_status', { length: 20 }).notNull().default('pending'),
  dpaUrl:         varchar('dpa_url', { length: 1000 }),
  renewalDate:    timestamp('renewal_date'),
  contactEmail:   varchar('contact_email', { length: 255 }),
  website:        varchar('website', { length: 500 }),
  notes:          text('notes'),
  createdAt:      timestamp('created_at').notNull().defaultNow(),
  updatedAt:      timestamp('updated_at').notNull().defaultNow(),
});

export const securityIncidents = pgTable('security_incidents', {
  id:              uuid('id').primaryKey().defaultRandom(),
  tenantId:        integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:       uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  title:           varchar('title', { length: 255 }).notNull(),
  severity:        varchar('severity', { length: 20 }).notNull().default('low'),
  status:          varchar('status', { length: 20 }).notNull().default('open'),
  discoveredAt:    timestamp('discovered_at').notNull().defaultNow(),
  resolvedAt:      timestamp('resolved_at'),
  detectionSource: varchar('detection_source', { length: 40 }),
  impact:          text('impact'),
  rootCause:       text('root_cause'),
  postmortemUrl:   varchar('postmortem_url', { length: 1000 }),
  reportedBy:      varchar('reported_by', { length: 64 }),
  assignedTo:      varchar('assigned_to', { length: 64 }),
  sourceRef:       text('source_ref'),
  createdAt:       timestamp('created_at').notNull().defaultNow(),
  updatedAt:       timestamp('updated_at').notNull().defaultNow(),
});

export const piiDataAssets = pgTable('pii_data_assets', {
  id:              uuid('id').primaryKey().defaultRandom(),
  tenantId:        integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:       uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  name:            varchar('name', { length: 255 }).notNull(),
  classification:  varchar('classification', { length: 20 }).notNull().default('internal'),
  dataCategories:  text('data_categories'),
  storageLocation: varchar('storage_location', { length: 255 }),
  retentionDays:   integer('retention_days'),
  legalBasis:      varchar('legal_basis', { length: 40 }),
  ownerTeam:       varchar('owner_team', { length: 255 }),
  lastReviewedAt:  timestamp('last_reviewed_at'),
  notes:           text('notes'),
  createdAt:       timestamp('created_at').notNull().defaultNow(),
  updatedAt:       timestamp('updated_at').notNull().defaultNow(),
});

export const securityDpas = pgTable('security_dpas', {
  id:               uuid('id').primaryKey().defaultRandom(),
  tenantId:         integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:        uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  counterpartyName: varchar('counterparty_name', { length: 255 }).notNull(),
  counterpartyType: varchar('counterparty_type', { length: 20 }).notNull().default('vendor'),
  status:           varchar('status', { length: 20 }).notNull().default('draft'),
  signedAt:         timestamp('signed_at'),
  effectiveDate:    timestamp('effective_date'),
  renewalDate:      timestamp('renewal_date'),
  dpaUrl:           varchar('dpa_url', { length: 1000 }),
  sccVersion:       varchar('scc_version', { length: 50 }),
  notes:            text('notes'),
  createdAt:        timestamp('created_at').notNull().defaultNow(),
  updatedAt:        timestamp('updated_at').notNull().defaultNow(),
});

export const securityTrainings = pgTable('security_trainings', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenantId:       integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:      uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  userId:         varchar('user_id', { length: 64 }),
  userName:       varchar('user_name', { length: 255 }).notNull(),
  userEmail:      varchar('user_email', { length: 255 }),
  trainingType:   varchar('training_type', { length: 40 }).notNull(),
  trainingName:   varchar('training_name', { length: 255 }).notNull(),
  completedAt:    timestamp('completed_at'),
  dueDate:        timestamp('due_date'),
  status:         varchar('status', { length: 20 }).notNull().default('not_started'),
  certificateUrl: varchar('certificate_url', { length: 1000 }),
  notes:          text('notes'),
  createdAt:      timestamp('created_at').notNull().defaultNow(),
  updatedAt:      timestamp('updated_at').notNull().defaultNow(),
});

export const complianceEvents = pgTable('compliance_events', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenantId:       integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:      uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  title:          varchar('title', { length: 255 }).notNull(),
  framework:      varchar('framework', { length: 20 }).notNull(),
  eventType:      varchar('event_type', { length: 20 }).notNull().default('milestone'),
  dueDate:        timestamp('due_date').notNull(),
  status:         varchar('status', { length: 20 }).notNull().default('upcoming'),
  assignedTo:     varchar('assigned_to', { length: 64 }),
  isRecurring:    boolean('is_recurring').notNull().default(false),
  recurringEvery: varchar('recurring_every', { length: 20 }),
  notes:          text('notes'),
  completedAt:    timestamp('completed_at'),
  createdAt:      timestamp('created_at').notNull().defaultNow(),
  updatedAt:      timestamp('updated_at').notNull().defaultNow(),
});

export const dataSubjectRequests = pgTable('data_subject_requests', {
  id:                uuid('id').primaryKey().defaultRandom(),
  tenantId:          integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:         uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  requestType:       varchar('request_type', { length: 20 }).notNull(),
  subjectEmail:      varchar('subject_email', { length: 255 }).notNull(),
  subjectEmailHash:  varchar('subject_email_hash', { length: 64 }),
  jurisdiction:      varchar('jurisdiction', { length: 40 }),
  notes:             text('notes'),
  status:            varchar('status', { length: 30 }).notNull().default('verifying_identity'),
  verifiedAt:        timestamp('verified_at'),
  processedByUserId: varchar('processed_by_user_id', { length: 64 }),
  processedAt:       timestamp('processed_at'),
  rejectionReason:   text('rejection_reason'),
  submittedIp:       varchar('submitted_ip', { length: 64 }),
  submittedUserAgent: varchar('submitted_user_agent', { length: 500 }),
  createdAt:         timestamp('created_at').notNull().defaultNow(),
  updatedAt:         timestamp('updated_at').notNull().defaultNow(),
});

export const dataSuppressionList = pgTable('data_suppression_list', {
  id:              uuid('id').primaryKey().defaultRandom(),
  tenantId:        integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:       uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  identifierType:  varchar('identifier_type', { length: 20 }).notNull(),
  identifierValue: varchar('identifier_value', { length: 500 }).notNull(),
  identifierHash:  varchar('identifier_hash', { length: 64 }),
  reason:          varchar('reason', { length: 40 }).notNull(),
  addedByUserId:   varchar('added_by_user_id', { length: 64 }),
  addedByDsrId:    uuid('added_by_dsr_id'),
  notes:           text('notes'),
  createdAt:       timestamp('created_at').notNull().defaultNow(),
  updatedAt:       timestamp('updated_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Product Management net-new features (doc 02; migration 0059). Segment-scoped.
// ---------------------------------------------------------------------------

export const mvpScenarios = pgTable('mvp_scenarios', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  tenantId:           integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:          uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  name:               varchar('name', { length: 255 }).notNull(),
  description:        text('description'),
  pricingModel:       varchar('pricing_model', { length: 40 }),
  targetRevenue:      real('target_revenue'),
  timelineConstraint: integer('timeline_constraint'),
  budgetConstraint:   real('budget_constraint'),
  teamSize:           integer('team_size'),
  status:             varchar('status', { length: 20 }).notNull().default('draft'),
  notes:              text('notes'),
  createdAt:          timestamp('created_at').notNull().defaultNow(),
  updatedAt:          timestamp('updated_at').notNull().defaultNow(),
});

export const validationResults = pgTable('validation_results', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenantId:       integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:      uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  hypothesis:     text('hypothesis').notNull(),
  validationType: varchar('validation_type', { length: 20 }),
  method:         varchar('method', { length: 255 }),
  result:         varchar('result', { length: 20 }).notNull().default('in_progress'),
  metrics:        text('metrics'),
  learnings:      text('learnings'),
  nextSteps:      text('next_steps'),
  notes:          text('notes'),
  createdAt:      timestamp('created_at').notNull().defaultNow(),
  updatedAt:      timestamp('updated_at').notNull().defaultNow(),
});

export const roadmapItems = pgTable('roadmap_items', {
  id:         uuid('id').primaryKey().defaultRandom(),
  tenantId:   integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:  uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  // Nullable project scope (0121): NULL = portfolio/segment-level, non-null = one project.
  projectId:  integer('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  title:      varchar('title', { length: 255 }).notNull(),
  horizon:    varchar('horizon', { length: 10 }).notNull().default('now'),
  status:     varchar('status', { length: 20 }).notNull().default('planned'),
  theme:      varchar('theme', { length: 120 }),
  targetDate: timestamp('target_date'),
  priority:   varchar('priority', { length: 20 }),
  notes:      text('notes'),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
});

// ── PMO tier (0213): Portfolio / Initiative / OKR above the project tier ──────
// The rollup objects the collector substrate was missing. uuid PKs + tenant/
// segment scope match the planning trackers, so the generic segment-tracker CRUD
// (segmentTrackerRoutes) drives their management with no bespoke router; the live
// rollup (pmoRoutes/portfolioRollup) aggregates cost/DORA/outcomes/delivery over
// the projects linked under each tier.
export const portfolios = pgTable('portfolios', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:   uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  name:        varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  status:      varchar('status', { length: 20 }).notNull().default('active'), // active | archived
  ownerUserId: varchar('owner_user_id', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  targetDate:  timestamp('target_date'),
  costClass:       varchar('cost_class', { length: 8 }), // capex | opex | null — top of the inheritance chain (0225)
  costClassSource: varchar('cost_class_source', { length: 12 }).notNull().default('manual'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
});

export const initiatives = pgTable('initiatives', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:   uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  portfolioId: uuid('portfolio_id').references(() => portfolios.id, { onDelete: 'set null' }),
  name:        varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  status:      varchar('status', { length: 20 }).notNull().default('proposed'), // proposed | active | completed | archived
  ownerUserId: varchar('owner_user_id', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  /** Timeline bounds for the unified Gantt (0225). targetDate stays as the end
   *  anchor for back-compat; startDate is the new lower bound. */
  startDate:   timestamp('start_date'),
  targetDate:  timestamp('target_date'),
  costClass:       varchar('cost_class', { length: 8 }), // capex | opex | null (0225)
  costClassSource: varchar('cost_class_source', { length: 12 }).notNull().default('manual'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
});

export const objectives = pgTable('objectives', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenantId:     integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:    uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  portfolioId:  uuid('portfolio_id').references(() => portfolios.id, { onDelete: 'set null' }),
  initiativeId: uuid('initiative_id').references(() => initiatives.id, { onDelete: 'set null' }),
  /** Direct PROJECT scope (0268) — a fourth scope axis alongside portfolio/initiative.
   *  An objective created "for a project" (the Brain's `objectives.create` with a
   *  projectId, the OKR tab's project scope) lives here; the Project 360 counts these
   *  as the project's linked goals (its Direction dimension) without needing a task or
   *  initiative link. Null = an org/portfolio/initiative-level objective. */
  projectId:    integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
  title:        varchar('title', { length: 255 }).notNull(),
  description:  text('description'),
  period:       varchar('period', { length: 20 }), // e.g. '2026-Q2' — DERIVED from startDate (0225); kept for reporting/grouping
  /** Real timeline span for the unified Gantt (0225). An objective can run a
   *  quarter, several quarters, a year or more — these bounds drive its bar. */
  startDate:    timestamp('start_date'),
  endDate:      timestamp('end_date'),
  status:       varchar('status', { length: 20 }).notNull().default('active'), // active | achieved | missed | archived
  ownerUserId:  varchar('owner_user_id', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  /** CAPEX/OPEX for the whole goal (0225). Set here → the entire linked lineage
   *  inherits it unless a child manually overrides (which raises an anomaly). */
  costClass:       varchar('cost_class', { length: 8 }), // capex | opex | null
  costClassSource: varchar('cost_class_source', { length: 12 }).notNull().default('manual'),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
});

/**
 * Objective ↔ work-item lineage (0225). An objective owns ANY mix of initiatives,
 * epics, or tasks — exactly one of initiativeId / taskId is set per row, keyed by
 * linkKind. This is the edge that makes "an OKR can have multiple Epics or a task"
 * real and lets cost/progress roll up from leaf work into the goal.
 */
export const objectiveLinks = pgTable('objective_links', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenantId:     integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:    uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  objectiveId:  uuid('objective_id').notNull().references(() => objectives.id, { onDelete: 'cascade' }),
  linkKind:     varchar('link_kind', { length: 12 }).notNull(), // 'initiative' | 'epic' | 'task'
  initiativeId: uuid('initiative_id').references(() => initiatives.id, { onDelete: 'cascade' }),
  taskId:       integer('task_id').references((): AnyPgColumn => tasks.id, { onDelete: 'cascade' }),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
});

export const keyResults = pgTable('key_results', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenantId:     integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:    uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  objectiveId:  uuid('objective_id').notNull().references(() => objectives.id, { onDelete: 'cascade' }),
  title:        varchar('title', { length: 255 }).notNull(),
  metricType:   varchar('metric_type', { length: 20 }).notNull().default('number'), // number | percent | currency | boolean
  startValue:   real('start_value').notNull().default(0),
  targetValue:  real('target_value').notNull().default(100),
  currentValue: real('current_value').notNull().default(0),
  unit:         varchar('unit', { length: 20 }),
  status:       varchar('status', { length: 20 }).notNull().default('on_track'), // on_track | at_risk | off_track | done
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
});

// Initiative dependency edges (0216): from_initiative BLOCKS to_initiative. The
// rollup uses these to flag blocked initiatives + compute the critical path
// (longest incomplete chain); the route rejects self-loops and cycle-closing edges.
export const pmoDependencies = pgTable('pmo_dependencies', {
  id:               uuid('id').primaryKey().defaultRandom(),
  tenantId:         integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:        uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  fromInitiativeId: uuid('from_initiative_id').notNull().references(() => initiatives.id, { onDelete: 'cascade' }),
  toInitiativeId:   uuid('to_initiative_id').notNull().references(() => initiatives.id, { onDelete: 'cascade' }),
  createdAt:        timestamp('created_at').notNull().defaultNow(),
});

export const productReleases = pgTable('product_releases', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:   uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  // Project scope + delivery dates for the release-picker (EMP-10a, migration 0316).
  projectId:   integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
  name:        varchar('name', { length: 255 }).notNull(),
  version:     varchar('version', { length: 50 }),
  releaseDate: timestamp('release_date'),
  targetDate:  timestamp('target_date'),
  releasedAt:  timestamp('released_at'),
  status:      varchar('status', { length: 20 }).notNull().default('planned'),
  notes:       text('notes'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
});

export const changelogEntries = pgTable('changelog_entries', {
  id:         uuid('id').primaryKey().defaultRandom(),
  tenantId:   integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:  uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  version:    varchar('version', { length: 50 }).notNull(),
  title:      varchar('title', { length: 255 }),
  body:       text('body'),
  releasedAt: timestamp('released_at'),
  status:     varchar('status', { length: 20 }).notNull().default('draft'),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
});

export const featureFlags = pgTable('feature_flags', {
  id:                uuid('id').primaryKey().defaultRandom(),
  tenantId:          integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:         uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  key:               varchar('key', { length: 120 }).notNull(),
  name:              varchar('name', { length: 255 }),
  status:            varchar('status', { length: 20 }).notNull().default('disabled'),
  rolloutPercentage: integer('rollout_percentage'),
  description:       text('description'),
  notes:             text('notes'),
  createdAt:         timestamp('created_at').notNull().defaultNow(),
  updatedAt:         timestamp('updated_at').notNull().defaultNow(),
});

export const businessValueConfigs = pgTable('business_value_configs', {
  id:               uuid('id').primaryKey().defaultRandom(),
  tenantId:         integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:        uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  name:             varchar('name', { length: 255 }).notNull(),
  valueType:        varchar('value_type', { length: 20 }).notNull().default('REVENUE'),
  displayMode:      varchar('display_mode', { length: 20 }).notNull().default('REVENUE'),
  rewardMultiplier: real('reward_multiplier').notNull().default(1),
  isActive:         boolean('is_active').notNull().default(true),
  notes:            text('notes'),
  createdAt:        timestamp('created_at').notNull().defaultNow(),
  updatedAt:        timestamp('updated_at').notNull().defaultNow(),
});

export const featureRoi = pgTable('feature_roi', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:   uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  featureName: varchar('feature_name', { length: 255 }).notNull(),
  featureType: varchar('feature_type', { length: 20 }),
  category:    varchar('category', { length: 120 }),
  status:      varchar('status', { length: 20 }).notNull().default('TRACKING'),
  metrics:     text('metrics'),
  notes:       text('notes'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Agile Survival net-new CRUD features (doc 03; migration 0060). Segment-scoped.
// ---------------------------------------------------------------------------

export const sprints = pgTable('sprints', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenantId:     integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:    uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  // Nullable project scope (0244): NULL = portfolio/segment-level cadence, non-null
  // = one project. The Planning ceremony is project-scoped, so its sprints follow.
  projectId:    integer('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  name:         varchar('name', { length: 255 }).notNull(),
  goal:         text('goal'),
  startDate:    timestamp('start_date'),
  endDate:      timestamp('end_date'),
  capacity:     integer('capacity'),
  status:       varchar('status', { length: 20 }).notNull().default('planning'),
  runwayBudget: real('runway_budget'),
  actualBurn:   real('actual_burn'),
  notes:        text('notes'),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
});

export const teamVelocity = pgTable('team_velocity', {
  id:              uuid('id').primaryKey().defaultRandom(),
  tenantId:        integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:       uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  period:          varchar('period', { length: 120 }).notNull(),
  teamId:          varchar('team_id', { length: 64 }),
  periodStart:     timestamp('period_start'),
  periodEnd:       timestamp('period_end'),
  committedPoints: integer('committed_points'),
  completedPoints: integer('completed_points'),
  velocityScore:   real('velocity_score'),
  trend:           varchar('trend', { length: 20 }),
  notes:           text('notes'),
  createdAt:       timestamp('created_at').notNull().defaultNow(),
  updatedAt:       timestamp('updated_at').notNull().defaultNow(),
});

export const capacityPlanning = pgTable('capacity_planning', {
  id:                uuid('id').primaryKey().defaultRandom(),
  tenantId:          integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:         uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  planningPeriod:    varchar('planning_period', { length: 120 }).notNull(),
  teamId:            varchar('team_id', { length: 64 }),
  totalCapacity:     real('total_capacity'),
  allocatedCapacity: real('allocated_capacity'),
  availableCapacity: real('available_capacity'),
  utilizationRate:   real('utilization_rate'),
  teamSize:          integer('team_size'),
  notes:             text('notes'),
  createdAt:         timestamp('created_at').notNull().defaultNow(),
  updatedAt:         timestamp('updated_at').notNull().defaultNow(),
});

export const costCalculations = pgTable('cost_calculations', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  tenantId:           integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:          uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  label:              varchar('label', { length: 255 }).notNull(),
  calculationType:    varchar('calculation_type', { length: 40 }),
  laborCost:          real('labor_cost'),
  overheadCost:       real('overhead_cost'),
  toolingCost:        real('tooling_cost'),
  infrastructureCost: real('infrastructure_cost'),
  totalCost:          real('total_cost'),
  runwayImpactDays:   integer('runway_impact_days'),
  notes:              text('notes'),
  createdAt:          timestamp('created_at').notNull().defaultNow(),
  updatedAt:          timestamp('updated_at').notNull().defaultNow(),
});

export const featureScores = pgTable('feature_scores', {
  id:         uuid('id').primaryKey().defaultRandom(),
  tenantId:   integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:  uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  // Nullable project scope (0121): NULL = portfolio/segment-level, non-null = one project.
  projectId:  integer('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  name:       varchar('name', { length: 255 }).notNull(),
  reach:      real('reach'),
  impact:     real('impact'),
  confidence: real('confidence'),
  effort:     real('effort'),
  score:      real('score'),
  status:     varchar('status', { length: 20 }).notNull().default('draft'),
  notes:      text('notes'),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Task dependency edges (migration 0121). First-class blocks/blocked-by edges
// between tasks — the backbone of the dependency-map visualizer and roadmap
// sequencing. predecessor must finish before successor can start. Acyclicity is
// enforced at write time in the route (see application/task/taskDependencies.ts);
// the DB only stops self-loops + duplicate edges.
// ---------------------------------------------------------------------------

export const taskDependencies = pgTable('task_dependencies', {
  id:                serial('id').primaryKey(),
  tenantId:          integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  // Nullable in Drizzle (omitted on insert); the set_default_segment_id() trigger
  // fills it and migration 0121 enforces NOT NULL at the DB — same as task_status_transitions.
  segmentId:         uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  projectId:         integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  predecessorTaskId: integer('predecessor_task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  successorTaskId:    integer('successor_task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  depType:           varchar('dep_type', { length: 16 }).notNull().default('finish_to_start'),
  createdAt:         timestamp('created_at').notNull().defaultNow(),
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
  status:         varchar('status', { length: 16 }).notNull().default('active'),   // 'active' | 'completed'
  facilitatorId:  varchar('facilitator_id', { length: 64 }),
  turnMode:       varchar('turn_mode', { length: 16 }).notNull().default('facilitator'),
  turnSeconds:    integer('turn_seconds').notNull().default(90),
  currentTurn:    integer('current_turn'),                                         // index into participants.turnOrder
  turnStartedAt:  timestamp('turn_started_at'),
  startedAt:      timestamp('started_at').notNull().defaultNow(),
  endedAt:        timestamp('ended_at'),
  /** Set when the frequent cron sweep auto-opened this session from a schedule (0349). */
  scheduleId:     uuid('schedule_id'),
  createdAt:      timestamp('created_at').notNull().defaultNow(),
  updatedAt:      timestamp('updated_at').notNull().defaultNow(),
});

export const ceremonyParticipants = pgTable('ceremony_participants', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:   uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  sessionId:   uuid('session_id').notNull().references(() => ceremonySessions.id, { onDelete: 'cascade' }),
  memberKind:  varchar('member_kind', { length: 16 }).notNull(),                   // 'human' | 'cloud_agent' | 'host_agent'
  memberRef:   varchar('member_ref', { length: 64 }).notNull(),
  memberName:  varchar('member_name', { length: 255 }).notNull(),
  turnOrder:   integer('turn_order').notNull().default(0),
  durationMs:  integer('duration_ms').notNull().default(0),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Ceremony schedules (migration 0349) — the cadence layer that makes standups /
// plannings run themselves. The frequent cron sweep (runDueCeremonies) opens a
// ceremony_sessions row with its roster pre-seeded for every enabled row whose
// nextRunAt has elapsed, then re-arms nextRunAt from the cron expression.
//
// Cadence is the SAME representation as qaSchedules / workflowTriggers (5-field
// cron + IANA timezone via domain/workflowSchedule.nextCronTime) — one cadence
// language across every scheduled subsystem. `kind` mirrors ceremonySessions.kind
// exactly; retros are their own subsystem (retrospectives) and are not modelled here.
// ---------------------------------------------------------------------------

export const ceremonySchedules = pgTable('ceremony_schedules', {
  id:               uuid('id').primaryKey().defaultRandom(),
  tenantId:         integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:        uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  projectId:        integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  kind:             varchar('kind', { length: 16 }).notNull().default('standup'),   // 'standup' | 'planning'
  cron:             varchar('cron', { length: 120 }).notNull(),
  timezone:         varchar('timezone', { length: 64 }).notNull().default('UTC'),
  enabled:          boolean('enabled').notNull().default(true),
  /** Stamped onto the auto-opened session; null inherits the board's setting. */
  turnMode:         varchar('turn_mode', { length: 16 }),
  turnSeconds:      integer('turn_seconds'),
  /** 'members' (derive from project members) | 'roster' (explicit participants). */
  participantScope: varchar('participant_scope', { length: 16 }).notNull().default('members'),
  /** JSON array of { kind, ref, name }; used when participantScope = 'roster'. */
  participants:     text('participants').notNull().default('[]'),
  maxParticipants:  integer('max_participants').notNull().default(25),
  /** Server-side dispatch when the opened session completes (was client-driven). */
  autoDispatch:     boolean('auto_dispatch').notNull().default(false),
  nextRunAt:        timestamp('next_run_at'),
  lastRunAt:        timestamp('last_run_at'),
  lastStatus:       varchar('last_status', { length: 24 }),
  lastSessionId:    uuid('last_session_id'),
  createdBy:        varchar('created_by', { length: 36 }),
  createdAt:        timestamp('created_at').notNull().defaultNow(),
  updatedAt:        timestamp('updated_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Live video/audio collaboration — scheduled meetings + calendar connections
// (migration 0292). A meeting is a standup / planning / retro / ad-hoc / direct
// call; peers exchange WebRTC media via the CeremonyRoomDO relay keyed off
// `roomKey`. Calendars are per-user OAuth grants used to schedule + list events.
// ---------------------------------------------------------------------------

export const meetings = pgTable('meetings', {
  id:               uuid('id').primaryKey().defaultRandom(),
  tenantId:         integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:        uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  // Nullable: an ad-hoc / direct call need not belong to a project.
  projectId:        integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
  kind:             varchar('kind', { length: 16 }).notNull().default('adhoc'),        // standup|planning|retrospective|adhoc|direct|interview|review
  title:            varchar('title', { length: 255 }).notNull(),
  description:      text('description'),
  /** Gig Marketplace (0293): track a review/interview meeting against the exact
   *  work item, job posting, or engagement it concerns (all optional back-links). */
  ticketId:         integer('ticket_id').references((): AnyPgColumn => tasks.id, { onDelete: 'set null' }),
  jobId:            varchar('job_id', { length: 36 }),
  engagementId:     varchar('engagement_id', { length: 36 }),
  /** Team Chat backchannel (0294): the meeting IS a team chat — joining opens this
   *  conversation, and people who can't attend still post their updates here so the
   *  chat keeps going after the call. Resolved to the scope's canonical team chat. */
  chatId:           integer('chat_id').references((): AnyPgColumn => brainChats.id, { onDelete: 'set null' }),
  scheduledAt:      timestamp('scheduled_at', { withTimezone: true }),                 // null = start-now
  durationMinutes:  integer('duration_minutes').notNull().default(30),
  status:           varchar('status', { length: 16 }).notNull().default('scheduled'),  // scheduled|live|ended|cancelled
  createdBy:        varchar('created_by', { length: 64 }),
  roomKey:          varchar('room_key', { length: 64 }).notNull(),                     // media relay room (media:<roomKey>)
  videoEnabled:     boolean('video_enabled').notNull().default(true),
  calendarProvider: varchar('calendar_provider', { length: 16 }),                      // google|microsoft
  calendarEventId:  varchar('calendar_event_id', { length: 255 }),
  calendarHtmlLink: text('calendar_html_link'),
  startedAt:        timestamp('started_at', { withTimezone: true }),
  endedAt:          timestamp('ended_at', { withTimezone: true }),
  /** Recording/transcription (0330): the generated minutes (recap + decisions +
   *  action items) built from the transcript on meeting end. Also posted into the
   *  linked team chat as the durable artifact. Null until summarized. */
  summary:            text('summary'),
  summaryGeneratedAt: timestamp('summary_generated_at', { withTimezone: true }),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
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

export const meetingAttendees = pgTable('meeting_attendees', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  meetingId:   uuid('meeting_id').notNull().references(() => meetings.id, { onDelete: 'cascade' }),
  memberKind:  varchar('member_kind', { length: 16 }).notNull().default('human'),      // human|cloud_agent|host_agent
  memberRef:   varchar('member_ref', { length: 64 }).notNull(),
  memberName:  varchar('member_name', { length: 255 }).notNull(),
  email:       varchar('email', { length: 255 }),
  role:        varchar('role', { length: 16 }).notNull().default('attendee'),          // host|attendee
  response:    varchar('response', { length: 16 }).notNull().default('invited'),       // invited|accepted|declined|tentative
  joinedAt:    timestamp('joined_at', { withTimezone: true }),
  leftAt:      timestamp('left_at', { withTimezone: true }),
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

export const calendarConnections = pgTable('calendar_connections', {
  id:            uuid('id').primaryKey().defaultRandom(),
  tenantId:      integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  userId:        varchar('user_id', { length: 64 }).notNull(),                         // users.id (the connector)
  provider:      varchar('provider', { length: 16 }).notNull(),                        // google|microsoft
  accountEmail:  varchar('account_email', { length: 255 }),
  accessToken:   text('access_token').notNull(),
  refreshToken:  text('refresh_token'),
  expiresAt:     timestamp('expires_at', { withTimezone: true }),
  scope:         text('scope'),
  calendarId:    varchar('calendar_id', { length: 255 }).notNull().default('primary'),
  createdAt:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// DevSecOps governance surfaces (doc 07 SEC-8/9; migration 0061). Segment-scoped.
// ---------------------------------------------------------------------------

export const accessReviews = pgTable('access_reviews', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:   uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  period:      varchar('period', { length: 120 }).notNull(),
  scope:       varchar('scope', { length: 20 }),
  scopeRef:    varchar('scope_ref', { length: 255 }),
  status:      varchar('status', { length: 20 }).notNull().default('open'),
  reviewerId:  varchar('reviewer_id', { length: 64 }),
  dueDate:     timestamp('due_date'),
  completedAt: timestamp('completed_at'),
  findings:    text('findings'),
  notes:       text('notes'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
});

export const vulnerabilityScans = pgTable('vulnerability_scans', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:   uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  repoRef:     varchar('repo_ref', { length: 255 }),
  ref:         varchar('ref', { length: 255 }),
  scanType:    varchar('scan_type', { length: 20 }).notNull(),
  status:      varchar('status', { length: 20 }).notNull().default('queued'),
  triggeredBy: varchar('triggered_by', { length: 64 }),
  startedAt:   timestamp('started_at'),
  finishedAt:  timestamp('finished_at'),
  summary:     text('summary'),
  notes:       text('notes'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
});

export const vulnerabilityFindings = pgTable('vulnerability_findings', {
  id:                uuid('id').primaryKey().defaultRandom(),
  tenantId:          integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:         uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  scanId:            uuid('scan_id').notNull().references(() => vulnerabilityScans.id, { onDelete: 'cascade' }),
  severity:          varchar('severity', { length: 20 }).notNull(),
  ruleId:            varchar('rule_id', { length: 120 }),
  title:             varchar('title', { length: 255 }).notNull(),
  filePath:          varchar('file_path', { length: 500 }),
  line:              integer('line'),
  packageName:       varchar('package_name', { length: 255 }),
  vulnerableVersion: varchar('vulnerable_version', { length: 64 }),
  fixedVersion:      varchar('fixed_version', { length: 64 }),
  cwe:               varchar('cwe', { length: 40 }),
  cve:               varchar('cve', { length: 40 }),
  description:       text('description'),
  remediation:       text('remediation'),
  status:            varchar('status', { length: 20 }).notNull().default('open'),
  createdAt:         timestamp('created_at').notNull().defaultNow(),
  updatedAt:         timestamp('updated_at').notNull().defaultNow(),
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

export const pokerStories = pgTable('poker_stories', {
  id:            uuid('id').primaryKey().defaultRandom(),
  tenantId:      integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:     uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  sessionId:     uuid('session_id').notNull().references(() => pokerSessions.id, { onDelete: 'cascade' }),
  title:         varchar('title', { length: 500 }).notNull(),
  description:   text('description'),
  status:        varchar('status', { length: 20 }).notNull().default('pending'),
  finalEstimate: varchar('final_estimate', { length: 20 }),
  position:      integer('position').notNull().default(0),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
});

export const pokerVotes = pgTable('poker_votes', {
  id:         uuid('id').primaryKey().defaultRandom(),
  tenantId:   integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:  uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  storyId:    uuid('story_id').notNull().references(() => pokerStories.id, { onDelete: 'cascade' }),
  userId:     varchar('user_id', { length: 64 }).notNull(),
  value:      varchar('value', { length: 20 }).notNull(),
  isRevealed: boolean('is_revealed').notNull().default(false),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
});

export const retrospectives = pgTable('retrospectives', {
  id:         uuid('id').primaryKey().defaultRandom(),
  tenantId:   integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:  uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  name:       varchar('name', { length: 255 }).notNull(),
  template:   varchar('template', { length: 30 }).notNull().default('start_stop_continue'),
  status:     varchar('status', { length: 20 }).notNull().default('active'),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
});

export const retroItems = pgTable('retro_items', {
  id:         uuid('id').primaryKey().defaultRandom(),
  tenantId:   integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:  uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  retroId:    uuid('retro_id').notNull().references(() => retrospectives.id, { onDelete: 'cascade' }),
  category:   varchar('category', { length: 40 }).notNull(),
  content:    text('content').notNull(),
  authorId:   varchar('author_id', { length: 64 }),
  votes:      integer('votes').notNull().default(0),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Agentic QA — usage capture → AI test generation → browser execution results.
//
// Pipeline (see README "Agentic QA"):
//   qa_journey_events  raw client interaction events (route changes, clicks,
//                      form submits — values redacted client-side)
//   qa_flows           normalized flows to test, derived from journeys ('usage'),
//                      synthesized from the route map ('crawl'), or declared ('manual')
//   qa_tests           AI-generated Playwright specs (one per flow, versioned)
//   qa_runs            execution results posted back by the CI harness
//   qa_run_steps       per-step granularity within a run
//
// Status/type columns are varchar (not pgEnum) to mirror telemetrySpans.kind —
// the taxonomy evolves with the capture client without an enum migration.
// ---------------------------------------------------------------------------

export const qaJourneyEvents = pgTable('qa_journey_events', {
  id:         serial('id').primaryKey(),
  tenantId:   integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:  uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),  // DB NOT NULL via trigger (0056); optional in TS so single-mode writes need no change
  userId:     varchar('user_id', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  // Client-generated journey id — groups events from one continuous session.
  sessionId:  varchar('session_id', { length: 64 }).notNull(),
  seq:        integer('seq').notNull().default(0),
  // 'pageview' | 'click' | 'input' | 'submit' | 'nav'
  type:       varchar('type', { length: 32 }).notNull(),
  route:      varchar('route', { length: 512 }),
  // Stable selector for the interaction target (data-testid → role+name → text → css).
  selector:   text('selector'),
  // Human-readable label (accessible name / trimmed text content).
  label:      varchar('label', { length: 255 }),
  // Redacted value descriptor for inputs — NEVER raw input; e.g. "email#filled" / "len:14".
  value:      varchar('value', { length: 255 }),
  meta:       text('meta'),       // JSON: viewport, element role/tag, etc.
  ts:         timestamp('ts').notNull().defaultNow(),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
});

export const qaFlows = pgTable('qa_flows', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:   uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  // Project (site-under-test) this flow belongs to. Null = workspace-level
  // (legacy capture / builderforce self-test).
  projectId:   integer('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  name:        varchar('name', { length: 255 }).notNull(),
  slug:        varchar('slug', { length: 255 }).notNull(),
  // 'usage' (derived from journeys) | 'crawl' (AI route-map exploration) | 'manual'
  source:      varchar('source', { length: 16 }).notNull().default('usage'),
  description: text('description'),
  startRoute:  varchar('start_route', { length: 512 }),
  steps:       text('steps'),     // JSON array of normalized QaStep
  // AI-inferred role this flow needs (e.g. 'admin' for /admin routes); resolved
  // to a concrete credential at generate time, human-overridable.
  personaRole: varchar('persona_role', { length: 64 }),
  credentialId: uuid('credential_id').references(() => qaCredentials.id, { onDelete: 'set null' }),
  // How many captured journeys collapsed into this flow (usage-derived ranking).
  frequency:   integer('frequency').notNull().default(0),
  status:      varchar('status', { length: 16 }).notNull().default('active'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
  // Unique (tenant_id, slug) enforced by migration 0063; onConflictDoUpdate
  // targets the columns directly, so the constraint isn't declared here (keeps
  // this a single-arg pgTable for the schema-drift parser).
});

export const qaTests = pgTable('qa_tests', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:   uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  projectId:   integer('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  flowId:      uuid('flow_id').references(() => qaFlows.id, { onDelete: 'set null' }),
  // The persona this scenario runs as (resolved from the flow's personaRole).
  credentialId: uuid('credential_id').references(() => qaCredentials.id, { onDelete: 'set null' }),
  personaRole: varchar('persona_role', { length: 64 }),
  name:        varchar('name', { length: 255 }).notNull(),
  slug:        varchar('slug', { length: 255 }).notNull(),
  framework:   varchar('framework', { length: 16 }).notNull().default('playwright'),
  spec:        text('spec').notNull(),          // generated TypeScript spec source
  stepsModel:  text('steps_model'),             // JSON structured steps the spec was built from
  model:       varchar('model', { length: 255 }),   // LLM that generated the spec
  generatedBy: varchar('generated_by', { length: 36 }),
  version:     integer('version').notNull().default(1),
  // 'draft' | 'active' | 'archived' — the CI harness pulls 'active' specs.
  status:      varchar('status', { length: 16 }).notNull().default('active'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
  // Unique (tenant_id, slug) enforced by migration 0063 (see qa_flows note).
});

export const qaRuns = pgTable('qa_runs', {
  id:            uuid('id').primaryKey().defaultRandom(),
  tenantId:      integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:     uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  projectId:     integer('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  testId:        uuid('test_id').references(() => qaTests.id, { onDelete: 'set null' }),
  // Which persona + target this run executed against (for role-aware result triage).
  credentialId:  uuid('credential_id').references(() => qaCredentials.id, { onDelete: 'set null' }),
  targetId:      uuid('target_id').references(() => qaTargets.id, { onDelete: 'set null' }),
  // Correlates all runs from one CI invocation (the GitHub run id).
  runKey:        varchar('run_key', { length: 64 }),
  trigger:       varchar('trigger', { length: 16 }).notNull().default('ci'),   // 'ci' | 'manual' | 'cron'
  // 'queued' | 'running' | 'passed' | 'failed' | 'error' | 'skipped'
  status:        varchar('status', { length: 16 }).notNull().default('queued'),
  browser:       varchar('browser', { length: 32 }),
  targetUrl:     varchar('target_url', { length: 512 }),
  commitSha:     varchar('commit_sha', { length: 64 }),
  durationMs:    integer('duration_ms'),
  totalSteps:    integer('total_steps'),
  passedSteps:   integer('passed_steps'),
  errorMessage:  text('error_message'),
  screenshotKeys: text('screenshot_keys'),  // JSON array of artifact paths/URLs
  logs:          text('logs'),
  startedAt:     timestamp('started_at'),
  finishedAt:    timestamp('finished_at'),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
});

export const qaRunSteps = pgTable('qa_run_steps', {
  id:           serial('id').primaryKey(),
  runId:        uuid('run_id').notNull().references(() => qaRuns.id, { onDelete: 'cascade' }),
  seq:          integer('seq').notNull().default(0),
  action:       varchar('action', { length: 32 }).notNull(),
  selector:     text('selector'),
  status:       varchar('status', { length: 16 }).notNull(),   // 'passed' | 'failed' | 'skipped'
  durationMs:   integer('duration_ms'),
  errorMessage: text('error_message'),
  screenshotKey: varchar('screenshot_key', { length: 512 }),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// QA targets — per-project site(s)-under-test (root URL / environment).
// ---------------------------------------------------------------------------

export const qaTargets = pgTable('qa_targets', {
  id:         uuid('id').primaryKey().defaultRandom(),
  tenantId:   integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:  uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  projectId:  integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name:       varchar('name', { length: 255 }).notNull(),       // e.g. "Production", "Staging"
  baseUrl:    varchar('base_url', { length: 512 }).notNull(),
  isDefault:  boolean('is_default').notNull().default(false),
  status:     varchar('status', { length: 16 }).notNull().default('active'),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// QA credentials — per-project credential library (test personas). The password
// is AES-GCM encrypted at rest (secretEnc = "iv.cipher", via INTEGRATION_
// ENCRYPTION_SECRET) and never returned by list/get. The authenticated CI
// harness fetches the decrypted secret from a dedicated endpoint to drive the
// site's login form (arbitrary external sites have no token API to inject).
// ---------------------------------------------------------------------------

export const qaCredentials = pgTable('qa_credentials', {
  id:            uuid('id').primaryKey().defaultRandom(),
  tenantId:      integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:     uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  projectId:     integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  label:         varchar('label', { length: 255 }).notNull(),   // "Admin user", "Read-only viewer"
  // Free-form role slug used to match AI-inferred personaRole on a flow.
  role:          varchar('role', { length: 64 }),
  username:      varchar('username', { length: 512 }).notNull(),
  secretEnc:     text('secret_enc').notNull(),                   // AES-GCM "iv.cipher"
  loginUrl:      varchar('login_url', { length: 512 }),         // login page path; default '/login'
  // Optional explicit login selectors (JSON {usernameSelector, passwordSelector,
  // submitSelector}) when the form can't be auto-detected.
  loginSelectors: text('login_selectors'),
  status:        varchar('status', { length: 16 }).notNull().default('active'),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Agentic Tester (migration 0206) — the autonomous, heatmap-driven half of
// Agentic QA. qa_explorations is one exploratory tester session (driven by
// interaction heat from qa_journey_events); qa_findings are the runtime errors
// it captured, each rankable by zone heat and optionally linked to the board
// task opened to fix it.
// ---------------------------------------------------------------------------

export const qaExplorations = pgTable('qa_explorations', {
  id:            uuid('id').primaryKey().defaultRandom(),
  tenantId:      integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:     uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  projectId:     integer('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  targetId:      uuid('target_id').references(() => qaTargets.id, { onDelete: 'set null' }),
  credentialId:  uuid('credential_id').references(() => qaCredentials.id, { onDelete: 'set null' }),
  // 'queued' | 'running' | 'passed' | 'failed' | 'error'
  status:        varchar('status', { length: 16 }).notNull().default('queued'),
  trigger:       varchar('trigger', { length: 16 }).notNull().default('manual'),
  // Max number of hot zones the agent exercises this run.
  heatBudget:    integer('heat_budget').notNull().default(20),
  // Heat window in days feeding the ranking.
  sinceDays:     integer('since_days').notNull().default(30),
  plan:          text('plan'),         // JSON QaStep[] — the heat-derived plan
  heatZones:     text('heat_zones'),   // JSON snapshot of ranked zones
  model:         varchar('model', { length: 255 }),   // planner LLM (null = deterministic)
  zonesPlanned:  integer('zones_planned').notNull().default(0),
  zonesExplored: integer('zones_explored'),
  findingsCount: integer('findings_count').notNull().default(0),
  runKey:        varchar('run_key', { length: 64 }),
  browser:       varchar('browser', { length: 32 }),
  targetUrl:     varchar('target_url', { length: 512 }),
  commitSha:     varchar('commit_sha', { length: 64 }),
  summary:       text('summary'),
  errorMessage:  text('error_message'),
  createdBy:     varchar('created_by', { length: 36 }),
  startedAt:     timestamp('started_at'),
  finishedAt:    timestamp('finished_at'),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
});

export const qaFindings = pgTable('qa_findings', {
  id:            uuid('id').primaryKey().defaultRandom(),
  explorationId: uuid('exploration_id').notNull().references(() => qaExplorations.id, { onDelete: 'cascade' }),
  tenantId:      integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:     uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  projectId:     integer('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  // 'console' | 'pageerror' | 'network' | 'assertion' | 'crash' | 'navigation'
  type:          varchar('type', { length: 24 }).notNull(),
  // 'low' | 'medium' | 'high' | 'critical'
  severity:      varchar('severity', { length: 16 }).notNull().default('medium'),
  route:         varchar('route', { length: 512 }),
  selector:      text('selector'),
  message:       text('message').notNull(),
  detail:        text('detail'),       // stack / failed-response body / extra JSON
  // Interaction frequency of the zone this surfaced in (why it matters).
  heat:          integer('heat').notNull().default(0),
  screenshotKey: varchar('screenshot_key', { length: 512 }),
  // 'open' | 'triaged' | 'task_created' | 'ignored' | 'resolved'
  status:        varchar('status', { length: 16 }).notNull().default('open'),
  taskId:        integer('task_id').references(() => tasks.id, { onDelete: 'set null' }),
  // True when the platform auto-routed this finding to a fix agent (vs a manual
  // "Create task"). See qa_routing_settings + QaFindingRouter (migration 0214).
  autoRouted:    boolean('auto_routed').notNull().default(false),
  fingerprint:   varchar('fingerprint', { length: 64 }),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
  // Unique (exploration_id, fingerprint) enforced by migration 0206 (see qa_flows
  // note — kept off the pgTable literal for the schema-drift parser).
});

// ---------------------------------------------------------------------------
// QA routing settings (migration 0214) — per-project policy deciding whether the
// Agentic Tester's findings auto-route into a board fix-agent run. Opt-in:
// auto-routing dispatches paid agent runs, so it stays off until a project enables
// it. One row per project; read by QaFindingRouter on the findings-ingestion path.
// ---------------------------------------------------------------------------
export const qaRoutingSettings = pgTable('qa_routing_settings', {
  id:            uuid('id').primaryKey().defaultRandom(),
  tenantId:      integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:     uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  projectId:     integer('project_id').notNull().unique().references(() => projects.id, { onDelete: 'cascade' }),
  enabled:       boolean('enabled').notNull().default(false),
  // Minimum finding severity that triggers a route ('low'|'medium'|'high'|'critical').
  minSeverity:   varchar('min_severity', { length: 16 }).notNull().default('high'),
  // Explicit board lane key to route into; null = auto-detect the first staffed,
  // non-human-gated, non-terminal lane (the natural fix lane).
  targetLaneKey: varchar('target_lane_key', { length: 120 }),
  // Max findings auto-routed per exploration batch (storm guard).
  maxPerBatch:   integer('max_per_batch').notNull().default(5),
  createdBy:     varchar('created_by', { length: 36 }),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// QA schedules — makes the Agentic Tester a SCHEDULED platform agent. The
// frequent cron sweep (runQaExplorationSweep) enqueues an exploration for every
// enabled schedule whose next_run_at has elapsed, then re-arms next_run_at from
// the cron expr. This is the "run the QA agent as part of a workflow" surface —
// no GitHub Action involved; the platform drives the cadence.
// ---------------------------------------------------------------------------

export const qaSchedules = pgTable('qa_schedules', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenantId:     integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:    uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  projectId:    integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  // Which target + persona the scheduled run uses (null target = project default).
  targetId:     uuid('target_id').references(() => qaTargets.id, { onDelete: 'set null' }),
  credentialId: uuid('credential_id').references(() => qaCredentials.id, { onDelete: 'set null' }),
  cron:         varchar('cron', { length: 120 }).notNull(),
  timezone:     varchar('timezone', { length: 64 }).notNull().default('UTC'),
  enabled:      boolean('enabled').notNull().default(true),
  heatBudget:   integer('heat_budget').notNull().default(20),
  sinceDays:    integer('since_days').notNull().default(30),
  nextRunAt:    timestamp('next_run_at'),
  lastRunAt:    timestamp('last_run_at'),
  lastStatus:   varchar('last_status', { length: 24 }),
  createdBy:    varchar('created_by', { length: 36 }),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
});

// ===========================================================================
// Cloud Agent Boards (migrations 0064–0067)
//
// Agentic swimlanes, external board sync, PRD versioning, and multi-repo / PR
// tracking. Status-like columns use documented varchars (matching the qa_*
// convention) rather than pgEnum, so adding a state needs no ALTER TYPE.
// JSON payloads are stored as text (jsonb is not available in all envs).
// ===========================================================================

// ── Slice 1: Agentic boards & swimlanes ────────────────────────────────────

/** A board fans an external source (or BF-native backlog) into ordered swimlanes. */
export const boards = pgTable('boards', {
  id:                   uuid('id').primaryKey().defaultRandom(),
  tenantId:             integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:            uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  // One board per project (UNIQUE(project_id), migration 0111). Enforced in code
  // via findOrCreateBoard so both create entry points converge on the existing
  // board rather than tripping this constraint.
  projectId:            integer('project_id').notNull().unique().references(() => projects.id, { onDelete: 'cascade' }),
  name:                 varchar('name', { length: 255 }).notNull(),
  // The board-level Autonomous toggle was dropped in migration 0207 (inert
  // since 0084 — autonomy is driven by lane agents + per-lane gate 'auto'/'human').
  maxConcurrentTickets: integer('max_concurrent_tickets').notNull().default(5),
  needsAttentionLane:   varchar('needs_attention_lane', { length: 120 }).notNull().default('needs-attention'),
  /** Standup turn-timer behaviour for this board's ceremonies (migration 0119):
   *  'facilitator' = manual Next advances the speaker; 'timeboxed' = each speaker
   *  gets `standupTurnSeconds` then auto-advances. Snapshotted onto a session at start. */
  standupTurnMode:      varchar('standup_turn_mode', { length: 16 }).notNull().default('facilitator'),
  standupTurnSeconds:   integer('standup_turn_seconds').notNull().default(90),
  /** When true, the task board hides tickets sitting in a terminal (Done) lane
   *  so only live work is shown (migration 0194). Display-only — does not affect
   *  the coordinator lifecycle or capacity. */
  hideDoneItems:        boolean('hide_done_items').notNull().default(false),
  /** Governance gate: when true (default), running a HIGH/URGENT priority ticket
   *  on this board first opens a manager-approval request before the agent
   *  executes (see evaluateExecutionApprovalGate). A manager can set this FALSE to
   *  OVERRIDE the gate so high/urgent work runs without approval (migration 0257). */
  requireExecutionApproval: boolean('require_execution_approval').notNull().default(true),
  /** The kanban template this board was provisioned from (migration 0274) — a
   *  built-in slug ('standard-swe') or a kanban_templates.id. Null = the legacy
   *  hardcoded default lanes. Records provenance; re-applying overwrites lanes. */
  templateId:          varchar('template_id', { length: 120 }),
  /** Lifecycle-managed (PRD §5.5): when true the ticket's Assignee is the COORDINATOR
   *  and is never the default per-stage executor — the owner→executor auto-run fallback
   *  is suppressed and the per-stage producer is resolved by role capability. Default
   *  false = legacy behaviour (migration 0335). */
  lifecycleManaged:    boolean('lifecycle_managed').notNull().default(false),
  createdAt:            timestamp('created_at').notNull().defaultNow(),
  updatedAt:            timestamp('updated_at').notNull().defaultNow(),
});

/** An ordered lane within a board; a stage of work with assigned agents. */
export const swimlanes = pgTable('swimlanes', {
  id:            uuid('id').primaryKey().defaultRandom(),
  tenantId:      integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:     uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  boardId:       uuid('board_id').notNull().references(() => boards.id, { onDelete: 'cascade' }),
  key:           varchar('key', { length: 120 }).notNull(),
  name:          varchar('name', { length: 255 }).notNull(),
  position:      integer('position').notNull().default(0),
  isTerminal:    boolean('is_terminal').notNull().default(false),
  gate:          varchar('gate', { length: 16 }).notNull().default('auto'),              // 'auto' | 'human'
  executionMode: varchar('execution_mode', { length: 16 }).notNull().default('sequential'), // 'parallel' | 'sequential'
  failurePolicy: varchar('failure_policy', { length: 24 }).notNull().default('needs_attention'), // 'needs_attention' | 'retry' | 'skip'
  // Lane action fired once the stage settles per successPolicy (migration 0084).
  actionType:       varchar('action_type', { length: 16 }),   // null|'advance' | 'move_ticket' | 'run_workflow'
  actionTarget:     varchar('action_target', { length: 64 }), // target lane key (move_ticket) | workflow id (run_workflow)
  successPolicy:    varchar('success_policy', { length: 16 }).notNull().default('all'), // 'all' | 'any' | 'n_of_m'
  successThreshold: integer('success_threshold'),             // required when successPolicy='n_of_m'
  // How strictly this lane's requirements (swimlane_requirements) gate entry
  // (migration 0274): 'off' = audit-only, 'soft' = flag + round-trip the reviewer
  // (default), 'hard' = block the auto-advance until required checks are satisfied.
  requirementGate:  varchar('requirement_gate', { length: 8 }).notNull().default('soft'),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
  // UNIQUE (board_id, key) enforced in migration 0064 (kept out of the pgTable
  // second-arg form, which the check:schema drift parser mis-tokenizes).
});

/** 1..N agents assigned to a swimlane; run in parallel or sequence per stage. */
export const swimlaneAgentAssignments = pgTable('swimlane_agent_assignments', {
  id:                   uuid('id').primaryKey().defaultRandom(),
  tenantId:             integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:            uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  swimlaneId:           uuid('swimlane_id').notNull().references(() => swimlanes.id, { onDelete: 'cascade' }),
  // Which registry agent was chosen (migration 0084). role/runtime/target/model
  // below hold the values resolved from this agent at assign time.
  agentKind:            varchar('agent_kind', { length: 16 }),  // 'workforce' | 'registered'
  agentRef:             varchar('agent_ref', { length: 64 }),   // ide_agents.id | agents.id
  name:                 varchar('name', { length: 255 }),       // display name of the chosen agent
  role:                 varchar('role', { length: 120 }).notNull(),
  runtime:              varchar('runtime', { length: 16 }).notNull().default('cloud'),   // 'local' | 'cloud' | 'remote'
  target:               varchar('target', { length: 120 }),   // remote agentHost id when runtime='remote'
  taskTemplate:         text('task_template'),
  requiredCapabilities: text('required_capabilities'),         // JSON array stored as text
  model:                varchar('model', { length: 120 }),
  position:             integer('position').notNull().default(0),
  createdAt:            timestamp('created_at').notNull().defaultNow(),
});

/** Per-ticket lifecycle state machine sitting ABOVE the workflow engine. */
export const ticketRuns = pgTable('ticket_runs', {
  id:                uuid('id').primaryKey().defaultRandom(),
  tenantId:          integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:         uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  boardId:           uuid('board_id').notNull().references(() => boards.id, { onDelete: 'cascade' }),
  taskId:            integer('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  currentSwimlaneId: uuid('current_swimlane_id').references(() => swimlanes.id, { onDelete: 'set null' }),
  // queued|awaiting_gate|stage_running|stage_completed|advancing|needs_attention|done|cancelled
  lifecycle:         varchar('lifecycle', { length: 24 }).notNull().default('queued'),
  currentWorkflowId: uuid('current_workflow_id').references(() => workflows.id, { onDelete: 'set null' }),
  // The spawned run_workflow workflow this ticket is parked on (lifecycle
  // 'awaiting_workflow'); resumed when that workflow settles (migration 0171).
  awaitingWorkflowId: uuid('awaiting_workflow_id').references(() => workflows.id, { onDelete: 'set null' }),
  stageHistory:      text('stage_history'),   // JSON array of {swimlaneId, workflowId, status, at}
  branchName:        varchar('branch_name', { length: 255 }),
  error:             text('error'),
  createdAt:         timestamp('created_at').notNull().defaultNow(),
  updatedAt:         timestamp('updated_at').notNull().defaultNow(),
  // UNIQUE (board_id, task_id) enforced in migration 0064.
});

/** Append-only audit of every swimlane transition (or refusal to advance). */
export const swimlaneTransitions = pgTable('swimlane_transitions', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenantId:       integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  ticketRunId:    uuid('ticket_run_id').notNull().references(() => ticketRuns.id, { onDelete: 'cascade' }),
  fromSwimlaneId: uuid('from_swimlane_id').references(() => swimlanes.id, { onDelete: 'set null' }),
  toSwimlaneId:   uuid('to_swimlane_id').references(() => swimlanes.id, { onDelete: 'set null' }),
  reason:         varchar('reason', { length: 32 }).notNull(),  // autonomous|gate_approved|failed|retry|manual
  workflowStatus: varchar('workflow_status', { length: 16 }),
  detail:         text('detail'),
  at:             timestamp('at').notNull().defaultNow(),
});

// ── Agentic Workforce Kanban: roles, templates & per-lane requirements (0274) ─
// One primitive — a KanbanTemplate binding {roles, required checks, gate} to each
// lane — powers the built-in Standard SWE board, custom kanbans, the recommended
// roster, per-ticket auditing, and swimlane gating. Built-in roles/templates live
// as TS constants; these tables hold only tenant-created/forked/published rows.

/** Tenant-extensible tail of the job-function role taxonomy (canonical set in code). */
export const jobRoles = pgTable('job_roles', {
  id:          varchar('id', { length: 36 }).primaryKey(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  key:         varchar('key', { length: 60 }).notNull(),
  name:        varchar('name', { length: 120 }).notNull(),
  description: text('description'),
  discipline:  varchar('discipline', { length: 60 }).notNull().default('engineering'),
  color:       varchar('color', { length: 24 }),
  icon:        varchar('icon', { length: 16 }),
  position:    integer('position').notNull().default(0),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
});

/** A reusable / shareable / sellable kanban board definition (marketplace artifact). */
export const kanbanTemplates = pgTable('kanban_templates', {
  id:               varchar('id', { length: 36 }).primaryKey(),
  tenantId:         integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  slug:             varchar('slug', { length: 120 }).notNull(),
  name:             varchar('name', { length: 160 }).notNull(),
  description:      text('description'),
  category:         varchar('category', { length: 60 }).notNull().default('software'),
  teamType:         varchar('team_type', { length: 80 }),
  parentTemplateId: varchar('parent_template_id', { length: 120 }),
  authorId:         varchar('author_id', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  published:        boolean('published').notNull().default(false),
  visibility:       varchar('visibility', { length: 10 }).notNull().default('private'), // private|tenant|public
  priceCents:       integer('price_cents'),
  pricingModel:     varchar('pricing_model', { length: 20 }),
  priceUnit:        varchar('price_unit', { length: 40 }),
  installCount:     integer('install_count').notNull().default(0),
  version:          integer('version').notNull().default(1),
  createdAt:        timestamp('created_at').notNull().defaultNow(),
  updatedAt:        timestamp('updated_at').notNull().defaultNow(),
});

/** A lane within a kanban template. */
export const kanbanTemplateLanes = pgTable('kanban_template_lanes', {
  id:              varchar('id', { length: 36 }).primaryKey(),
  templateId:      varchar('template_id', { length: 36 }).notNull().references(() => kanbanTemplates.id, { onDelete: 'cascade' }),
  key:             varchar('key', { length: 120 }).notNull(),
  name:            varchar('name', { length: 255 }).notNull(),
  position:        integer('position').notNull().default(0),
  isTerminal:      boolean('is_terminal').notNull().default(false),
  gate:            varchar('gate', { length: 16 }).notNull().default('auto'),
  requirementGate: varchar('requirement_gate', { length: 8 }).notNull().default('soft'),
  createdAt:       timestamp('created_at').notNull().defaultNow(),
});

/** Roles responsible + checks (role sign-off / diagnostic) required at a template lane. */
export const kanbanTemplateLaneRequirements = pgTable('kanban_template_lane_requirements', {
  id:             varchar('id', { length: 36 }).primaryKey(),
  laneId:         varchar('lane_id', { length: 36 }).notNull().references(() => kanbanTemplateLanes.id, { onDelete: 'cascade' }),
  kind:           varchar('kind', { length: 16 }).notNull(),   // role | diagnostic | review
  ref:            varchar('ref', { length: 120 }).notNull(),   // role key | diagnostic tool id
  responsibility: varchar('responsibility', { length: 16 }),   // owner | reviewer | contributor
  isRequired:     boolean('is_required').notNull().default(true),
  description:    text('description'),
  position:       integer('position').notNull().default(0),
  ticketType:     varchar('ticket_type', { length: 32 }),      // null = all ticket types
  quorum:         integer('quorum'),                            // N-of-M; null = all required
  condition:      varchar('condition', { length: 48 }),        // small enum predicate
  createdAt:      timestamp('created_at').notNull().defaultNow(),
});

/** LIVE per-lane requirements materialised onto a board's swimlanes when a template
 *  is applied (and directly editable). Keeps the running board self-describing for
 *  the audit + gating engines regardless of template provenance. */
export const swimlaneRequirements = pgTable('swimlane_requirements', {
  id:             varchar('id', { length: 36 }).primaryKey(),
  tenantId:       integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  swimlaneId:     uuid('swimlane_id').notNull().references(() => swimlanes.id, { onDelete: 'cascade' }),
  kind:           varchar('kind', { length: 16 }).notNull(),
  ref:            varchar('ref', { length: 120 }).notNull(),
  responsibility: varchar('responsibility', { length: 16 }),
  isRequired:     boolean('is_required').notNull().default(true),
  description:    text('description'),
  position:       integer('position').notNull().default(0),
  ticketType:     varchar('ticket_type', { length: 32 }),      // null = all ticket types
  quorum:         integer('quorum'),                            // N-of-M; null = all required
  condition:      varchar('condition', { length: 48 }),        // small enum predicate
  createdAt:      timestamp('created_at').notNull().defaultNow(),
});

/** Explicit roster role assignment — a manager pinning an existing agent / human
 *  member / hired contractor to a role. `projectId` NULL = workspace-default (applies
 *  to every project); set = project-specific. The roster merges these into each role's
 *  `filledBy` (via='assignment'). */
export const projectRoleAssignments = pgTable('project_role_assignments', {
  id:           varchar('id', { length: 36 }).primaryKey(),
  tenantId:     integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  projectId:    integer('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  roleKey:      varchar('role_key', { length: 120 }).notNull(),
  assigneeKind: varchar('assignee_kind', { length: 16 }).notNull(), // agent | human | hire
  assigneeRef:  varchar('assignee_ref', { length: 128 }).notNull(),
  assigneeName: varchar('assignee_name', { length: 200 }),
  createdBy:    varchar('created_by', { length: 36 }),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
});

/** Append-only ledger: a member acting AS a role approved / requested-changes on a
 *  ticket at a lane. The audit engine reads this to satisfy role/review requirements. */
export const ticketRoleSignoffs = pgTable('ticket_role_signoffs', {
  id:         varchar('id', { length: 36 }).primaryKey(),
  tenantId:   integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  taskId:     integer('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  laneKey:    varchar('lane_key', { length: 120 }),
  roleKey:    varchar('role_key', { length: 60 }).notNull(),
  memberKind: varchar('member_kind', { length: 16 }),
  memberRef:  varchar('member_ref', { length: 64 }),
  /** Denormalized signer display name — the accountability record must never be an
   *  anonymous "system"; captured at write time so history survives a rename/delete. */
  memberName: varchar('member_name', { length: 255 }),
  verdict:    varchar('verdict', { length: 20 }).notNull().default('approved'), // approved | changes_requested | waived | delegated
  summary:    text('summary'),
  /** Verifiable link to the actual work backing this sign-off — the interaction that
   *  makes it more than a rubber stamp: { executionId?, prdRevision?, prUrl?, diffFiles?, reviewThreadRef?, toolRunId? }. */
  contribution: jsonb('contribution'),
  waiveReason:  text('waive_reason'), // required for waived/delegated
  createdAt:  timestamp('created_at').notNull().defaultNow(),
});

/** The per-ticket Participation Manifest — the forward-looking, stateful roster of
 *  who MUST participate on a ticket, who has, and with what evidence. Derived from
 *  the applicable process template and kept live; a Resource Assessment step ADDS
 *  rows (source='assessment') so the manifest is dynamic. Each row may materialize
 *  as a child task (childTaskId) so the parent ticket's %-complete rolls up. */
export const ticketParticipants = pgTable('ticket_participants', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenantId:       integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  taskId:         integer('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  stageKey:       varchar('stage_key', { length: 120 }),
  roleKey:        varchar('role_key', { length: 120 }).notNull(),
  responsibility: varchar('responsibility', { length: 16 }).notNull().default('owner'), // owner | reviewer | contributor
  required:       boolean('required').notNull().default(true),
  source:         varchar('source', { length: 16 }).notNull().default('template'), // template | assessment | manual
  assigneeKind:   varchar('assignee_kind', { length: 16 }), // agent | human | hire | null (unresolved)
  assigneeRef:    varchar('assignee_ref', { length: 128 }),
  assigneeName:   varchar('assignee_name', { length: 255 }),
  // pending|assigned|in_progress|completed|changes_requested|waived|skipped|unstaffed
  state:          varchar('state', { length: 24 }).notNull().default('pending'),
  signoffId:      varchar('signoff_id', { length: 36 }).references(() => ticketRoleSignoffs.id, { onDelete: 'set null' }),
  childTaskId:    integer('child_task_id').references((): AnyPgColumn => tasks.id, { onDelete: 'set null' }),
  evidence:       jsonb('evidence'),
  quorumGroup:    varchar('quorum_group', { length: 160 }),
  note:           text('note'),
  createdAt:      timestamp('created_at').notNull().defaultNow(),
  updatedAt:      timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uidx_ticket_participants_slot').on(t.taskId, t.stageKey, t.roleKey, t.responsibility, t.source),
  index('idx_ticket_participants_task').on(t.taskId),
  index('idx_ticket_participants_tenant').on(t.tenantId),
  index('idx_ticket_participants_child').on(t.childTaskId),
]);

/** Computed per-ticket audit result (upserted; one row per task). */
export const ticketAudits = pgTable('ticket_audits', {
  taskId:         integer('task_id').primaryKey().references(() => tasks.id, { onDelete: 'cascade' }),
  tenantId:       integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  boardId:        uuid('board_id').references(() => boards.id, { onDelete: 'set null' }),
  status:         varchar('status', { length: 12 }).notNull().default('pass'), // pass | flagged
  coverage:       integer('coverage').notNull().default(100),
  requiredCount:  integer('required_count').notNull().default(0),
  satisfiedCount: integer('satisfied_count').notNull().default(0),
  missing:        text('missing'),  // JSON array of unmet requirements
  computedAt:     timestamp('computed_at').notNull().defaultNow(),
});

// ── Slice 2: External board connections & bidirectional sync ────────────────

/** One external board (Jira/GitHub/Freshworks/Rally) bound to a BF project. */
export const boardConnections = pgTable('board_connections', {
  id:              uuid('id').primaryKey().defaultRandom(),
  tenantId:        integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:       uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  projectId:       integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  credentialId:    uuid('credential_id').references(() => integrationCredentials.id, { onDelete: 'set null' }),
  provider:        varchar('provider', { length: 24 }).notNull(),  // github|jira|freshworks|rally|bitbucket
  externalBoardId: varchar('external_board_id', { length: 255 }),
  status:          varchar('status', { length: 16 }).notNull().default('active'), // active|degraded|disabled
  pollCursor:      text('poll_cursor'),
  webhookSecret:   varchar('webhook_secret', { length: 128 }),
  webhookEnabled:  boolean('webhook_enabled').notNull().default(false),
  pollIntervalSec: integer('poll_interval_sec').notNull().default(60),
  lastPolledAt:    timestamp('last_polled_at'),
  createdAt:       timestamp('created_at').notNull().defaultNow(),
  updatedAt:       timestamp('updated_at').notNull().defaultNow(),
});

/** Maps a normalized BF task to its external ticket; the idempotency ledger key. */
export const externalTicketLinks = pgTable('external_ticket_links', {
  id:              uuid('id').primaryKey().defaultRandom(),
  tenantId:        integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:       uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  connectionId:    uuid('connection_id').notNull().references(() => boardConnections.id, { onDelete: 'cascade' }),
  taskId:          integer('task_id').references(() => tasks.id, { onDelete: 'set null' }),
  provider:        varchar('provider', { length: 24 }).notNull(),
  externalId:      varchar('external_id', { length: 255 }).notNull(),
  externalUrl:     varchar('external_url', { length: 500 }),
  externalVersion: varchar('external_version', { length: 128 }),  // etag/updated_at/version#
  contentHash:     varchar('content_hash', { length: 64 }),
  fields:          jsonb('fields'),  // last-reconciled normalized field bag (enables field-level 3-way merge — migration 0170)
  syncState:       varchar('sync_state', { length: 16 }).notNull().default('synced'), // synced|dirty_local|dirty_remote|conflict
  lastInboundAt:   timestamp('last_inbound_at'),
  lastOutboundAt:  timestamp('last_outbound_at'),
  createdAt:       timestamp('created_at').notNull().defaultNow(),
  updatedAt:       timestamp('updated_at').notNull().defaultNow(),
  // UNIQUE (connection_id, external_id) enforced in migration 0065.
});

/** Transactional outbox for reliable, retried writeback to external providers. */
export const boardSyncOutbox = pgTable('board_sync_outbox', {
  id:            uuid('id').primaryKey().defaultRandom(),
  tenantId:      integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:     uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  connectionId:  uuid('connection_id').notNull().references(() => boardConnections.id, { onDelete: 'cascade' }),
  taskId:        integer('task_id').references(() => tasks.id, { onDelete: 'set null' }),
  changeSet:     text('change_set'),   // JSON of changed normalized fields
  attempts:      integer('attempts').notNull().default(0),
  nextAttemptAt: timestamp('next_attempt_at').notNull().defaultNow(),
  status:        varchar('status', { length: 16 }).notNull().default('pending'),  // pending|inflight|done|dead
  lastError:     text('last_error'),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
});

/**
 * Persistent per-connection external-type → BF task mapping (migration 0256).
 * Consulted by SyncEngine on every inbound ticket so ongoing sync sets the right
 * task_type ('task'|'epic') and status lane instead of the hardcoded backlog/task
 * defaults. Seeded from a migration run's import_type_mappings on commit.
 */
export const boardTypeMappings = pgTable('board_type_mappings', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenantId:       integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:      uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  connectionId:   uuid('connection_id').notNull().references(() => boardConnections.id, { onDelete: 'cascade' }),
  externalType:   varchar('external_type', { length: 120 }).notNull(),
  targetTaskType: varchar('target_task_type', { length: 16 }).notNull().default('task'),
  targetStatus:   varchar('target_status', { length: 64 }),
  createdAt:      timestamp('created_at').notNull().defaultNow(),
  updatedAt:      timestamp('updated_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Migration staging (migration 0256) — "stage before it lands" import buffer.
// One import_run = one wizard session; nothing touches projects/tasks/members
// until commit. See application/migration/MigrationService.
// ---------------------------------------------------------------------------

export const importRuns = pgTable('import_runs', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenantId:     integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:    uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  provider:     varchar('provider', { length: 24 }).notNull(),
  credentialId: uuid('credential_id').references(() => integrationCredentials.id, { onDelete: 'set null' }),
  /** 'migrate' (one-time) | 'sync' (ongoing only) | 'both'. */
  mode:         varchar('mode', { length: 12 }).notNull().default('migrate'),
  /** discovering | staged | mapped | importing | completed | failed | cancelled. */
  status:       varchar('status', { length: 16 }).notNull().default('discovering'),
  summary:      jsonb('summary'),
  errorMessage: text('error_message'),
  createdBy:    varchar('created_by', { length: 36 }),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
});

export const importStagedProjects = pgTable('import_staged_projects', {
  id:                uuid('id').primaryKey().defaultRandom(),
  runId:             uuid('run_id').notNull().references(() => importRuns.id, { onDelete: 'cascade' }),
  tenantId:          integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  externalId:        varchar('external_id', { length: 255 }).notNull(),
  externalKey:       varchar('external_key', { length: 120 }),
  name:              varchar('name', { length: 255 }).notNull(),
  description:       text('description'),
  externalUrl:       varchar('external_url', { length: 500 }),
  itemCount:         integer('item_count'),
  /** 'create' (new BF project) | 'map' (fold into targetProjectId — combine) | 'skip'. */
  action:            varchar('action', { length: 8 }).notNull().default('create'),
  targetProjectId:   integer('target_project_id').references(() => projects.id, { onDelete: 'set null' }),
  targetProjectName: varchar('target_project_name', { length: 255 }),
  createdAt:         timestamp('created_at').notNull().defaultNow(),
});

export const importStagedItems = pgTable('import_staged_items', {
  id:              uuid('id').primaryKey().defaultRandom(),
  runId:           uuid('run_id').notNull().references(() => importRuns.id, { onDelete: 'cascade' }),
  tenantId:        integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  stagedProjectId: uuid('staged_project_id').notNull().references(() => importStagedProjects.id, { onDelete: 'cascade' }),
  externalId:      varchar('external_id', { length: 255 }).notNull(),
  externalType:    varchar('external_type', { length: 120 }),
  externalUrl:     varchar('external_url', { length: 500 }),
  title:           text('title').notNull(),
  body:            text('body'),
  state:           varchar('state', { length: 120 }),
  storyPoints:     real('story_points'),
  assigneeExternalId: varchar('assignee_external_id', { length: 255 }),
  externalVersion: varchar('external_version', { length: 128 }),
  contentHash:     varchar('content_hash', { length: 64 }),
  raw:             jsonb('raw'),
  targetTaskType:  varchar('target_task_type', { length: 16 }).notNull().default('task'),
  targetStatus:    varchar('target_status', { length: 64 }).notNull().default('backlog'),
  include:         boolean('include').notNull().default(true),
  createdAt:       timestamp('created_at').notNull().defaultNow(),
});

export const importTypeMappings = pgTable('import_type_mappings', {
  id:             uuid('id').primaryKey().defaultRandom(),
  runId:          uuid('run_id').notNull().references(() => importRuns.id, { onDelete: 'cascade' }),
  tenantId:       integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  externalType:   varchar('external_type', { length: 120 }).notNull(),
  targetTaskType: varchar('target_task_type', { length: 16 }).notNull().default('task'),
  targetStatus:   varchar('target_status', { length: 64 }).notNull().default('backlog'),
  createdAt:      timestamp('created_at').notNull().defaultNow(),
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

// ── Cross-domain (channel-3) seams: feedback ingest + outbound webhooks ──────

/**
 * Voice-of-Customer feedback the host (BurnRateOS) PUSHES to BuilderForce via
 * POST /v1/ingest/feedback (spec 05 §4.2). Segment-scoped; `external_ref` is the
 * host event id and is unique per segment so re-delivery is idempotent.
 */
export const customerFeedback = pgTable('customer_feedback', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:   uuid('segment_id').notNull().references(() => segments.id, { onDelete: 'cascade' }),
  externalRef: varchar('external_ref', { length: 255 }).notNull(),
  widgetId:    varchar('widget_id', { length: 255 }),
  text:        text('text').notNull(),
  sentiment:   varchar('sentiment', { length: 32 }),
  contact:     varchar('contact', { length: 320 }),
  status:      varchar('status', { length: 16 }).notNull().default('new'), // new|triaged|dismissed
  // When triaged into the backlog, the task it spawned/linked (migration 0161).
  triagedTaskId: integer('triaged_task_id').references(() => tasks.id, { onDelete: 'set null' }),
  triagedAt:   timestamp('triaged_at'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  // UNIQUE (segment_id, external_ref) enforced in migration 0071.
});

/**
 * Host subscriptions to BuilderForce outbound events (spec 05 §4.3):
 * workitem.released / sprint.completed / roadmap.published. Segment-scoped.
 */
export const webhookSubscriptions = pgTable('webhook_subscriptions', {
  id:         uuid('id').primaryKey().defaultRandom(),
  tenantId:   integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:  uuid('segment_id').notNull().references(() => segments.id, { onDelete: 'cascade' }),
  url:        text('url').notNull(),
  secret:     varchar('secret', { length: 128 }).notNull(),
  events:     text('events').notNull().default('[]'), // JSON array of event types
  active:     boolean('active').notNull().default(true),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
});

/** Per-delivery audit row. `id` doubles as the replay nonce in the signature. */
export const webhookDeliveries = pgTable('webhook_deliveries', {
  id:             uuid('id').primaryKey().defaultRandom(),
  subscriptionId: uuid('subscription_id').notNull().references(() => webhookSubscriptions.id, { onDelete: 'cascade' }),
  tenantId:       integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:      uuid('segment_id').notNull().references(() => segments.id, { onDelete: 'cascade' }),
  eventType:      varchar('event_type', { length: 64 }).notNull(),
  eventId:        varchar('event_id', { length: 255 }).notNull(),
  status:         varchar('status', { length: 16 }).notNull().default('pending'), // pending|delivered|failed
  responseStatus: integer('response_status'),
  attempts:       integer('attempts').notNull().default(0),
  payload:        text('payload'),          // exact signed POST body, for faithful redelivery
  nextRetryAt:    timestamp('next_retry_at'), // when next retry-eligible; NULL = terminal (delivered or exhausted)
  lastError:      text('last_error'),       // most recent failure reason (truncated)
  createdAt:      timestamp('created_at').notNull().defaultNow(),
  deliveredAt:    timestamp('delivered_at'),
});

// ── Slice 3: PRD versioning & audit ─────────────────────────────────────────

/** Immutable, monotonic snapshot of a spec/PRD; frozen once an execution uses it. */
export const specVersions = pgTable('spec_versions', {
  id:         uuid('id').primaryKey().defaultRandom(),
  tenantId:   integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:  uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  specId:     uuid('spec_id').notNull().references(() => specs.id, { onDelete: 'cascade' }),
  version:    integer('version').notNull(),
  prd:        text('prd'),
  archSpec:   text('arch_spec'),
  taskList:   text('task_list'),
  origin:     varchar('origin', { length: 24 }).notNull().default('prd_first'), // prd_first|generated_from_ticket
  frozen:     boolean('frozen').notNull().default(false),
  frozenAt:   timestamp('frozen_at'),
  createdBy:  varchar('created_by', { length: 120 }),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  // UNIQUE (spec_id, version) enforced in migration 0066.
});

/** PRD-coordinate audit: (agent action × PRD section) across swimlanes/agents. */
export const specAuditRecords = pgTable('spec_audit_records', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:   uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  specId:      uuid('spec_id').notNull().references(() => specs.id, { onDelete: 'cascade' }),
  specVersion: integer('spec_version'),
  sectionId:   varchar('section_id', { length: 120 }),
  agentRole:   varchar('agent_role', { length: 120 }),
  action:      varchar('action', { length: 64 }).notNull(),
  swimlane:    varchar('swimlane', { length: 120 }),
  taskId:      integer('task_id').references(() => tasks.id, { onDelete: 'set null' }),
  detail:      text('detail'),
  at:          timestamp('at').notNull().defaultNow(),
});

// ── Slice 4: Multi-repo associations & PR/branch tracking ───────────────────

/** A BF project associates with 1..N repos (github|bitbucket|gitlab). */
export const projectRepositories = pgTable('project_repositories', {
  id:            uuid('id').primaryKey().defaultRandom(),
  tenantId:      integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:     uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  projectId:     integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  provider:      varchar('provider', { length: 16 }).notNull(),  // github|bitbucket|gitlab
  host:          varchar('host', { length: 255 }).notNull().default('github.com'),
  owner:         varchar('owner', { length: 255 }).notNull(),
  repo:          varchar('repo', { length: 255 }).notNull(),
  defaultBranch: varchar('default_branch', { length: 255 }),
  cloneUrlHttps: varchar('clone_url_https', { length: 500 }),
  isDefault:     boolean('is_default').notNull().default(false),
  matchHints:    text('match_hints'),   // JSON {labels?, pathGlobs?, keywords?}
  credentialId:  uuid('credential_id').references(() => integrationCredentials.id, { onDelete: 'set null' }),
  // Designer import baseline (migration 0211): the ref + head sha + time the R2
  // workspace was last imported from, so commit-back can diff against it.
  lastSyncedRef: text('last_synced_ref'),
  lastSyncedSha: text('last_synced_sha'),
  lastSyncedAt:  timestamp('last_synced_at'),
  /** Activity-poller watermark (0212): last time runRepoActivitySweep pulled this
   *  repo's commits/PRs/reviews into activity_events. NULL = never → backfill. */
  lastActivitySyncedAt: timestamp('last_activity_synced_at'),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
  // UNIQUE (project_id, provider, owner, repo) enforced in migration 0067.
});

/** A branch created by an agent against an associated repo. */
export const repoBranches = pgTable('repo_branches', {
  id:         uuid('id').primaryKey().defaultRandom(),
  tenantId:   integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:  uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  repoId:     uuid('repo_id').notNull().references(() => projectRepositories.id, { onDelete: 'cascade' }),
  taskId:     integer('task_id').references(() => tasks.id, { onDelete: 'set null' }),
  name:       varchar('name', { length: 255 }).notNull(),
  baseBranch: varchar('base_branch', { length: 255 }),
  createdBy:  varchar('created_by', { length: 120 }),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
});

/** A pull/merge request opened by an agent, linked to ticket + PRD for traceability. */
export const pullRequests = pgTable('pull_requests', {
  id:                uuid('id').primaryKey().defaultRandom(),
  tenantId:          integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:         uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  projectId:         integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  repoId:            uuid('repo_id').references(() => projectRepositories.id, { onDelete: 'set null' }),
  taskId:            integer('task_id').references(() => tasks.id, { onDelete: 'set null' }),
  specId:            uuid('spec_id').references(() => specs.id, { onDelete: 'set null' }),
  workflowId:        uuid('workflow_id').references(() => workflows.id, { onDelete: 'set null' }),
  provider:          varchar('provider', { length: 16 }).notNull(),
  number:            integer('number'),
  url:               varchar('url', { length: 500 }),
  branchName:        varchar('branch_name', { length: 255 }),
  baseBranch:        varchar('base_branch', { length: 255 }),
  status:            varchar('status', { length: 16 }).notNull().default('open'),  // draft|open|merged|closed
  externalTicketRef: varchar('external_ticket_ref', { length: 255 }),
  mergedBy:          varchar('merged_by', { length: 128 }),   // user id who approved the in-product merge (0106)
  mergedAt:          timestamp('merged_at'),
  mergeSha:          varchar('merge_sha', { length: 64 }),    // merge commit SHA — correlates post-merge CI (0107)
  buildStatus:       varchar('build_status', { length: 16 }), // null|pending|success|failure — pre-merge (PR branch) or post-merge build (0107)
  buildError:        text('build_error'),                     // failing jobs/steps summary when build_status='failure' (0196)
  createdAt:         timestamp('created_at').notNull().defaultNow(),
  updatedAt:         timestamp('updated_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Learned Model Routing (PRD 13 / migration 0198) — the OUTCOME fact table.
// One row per TERMINAL cloud run, joining its (action_type, resolved_model) to a
// composite 0..1 outcome score. The durable source of truth analytics + the
// derived `routing:<scope>` KV blob read from. Idempotent on execution_id.
// ---------------------------------------------------------------------------
export const runModelOutcomes = pgTable('run_model_outcomes', {
  id:               serial('id').primaryKey(),
  tenantId:         integer('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
  projectId:        integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
  taskId:           integer('task_id').references(() => tasks.id, { onDelete: 'set null' }),
  /** The terminal cloud run this outcome scores. Unique (the scorer upserts on it
   *  so it is idempotent across the multiple terminal paths). No FK — executions is
   *  pruned independently and a scored outcome should survive the run row. The
   *  `.unique()` backs the scorer's `onConflictDoNothing({ target: executionId })`
   *  (migration 0197 creates `run_model_outcomes_execution_id_key`). NULLABLE since
   *  migration 0283: client/IDE/on-prem runs have no cloud execution and instead
   *  key on `clientRunId`. */
  executionId:      integer('execution_id').unique(),
  /** Where the outcome came from: 'cloud' (default) | 'onprem' | 'ide' | 'external'
   *  (migration 0283). Lets analytics split learned-routing quality by surface. */
  source:           varchar('source', { length: 16 }).notNull().default('cloud'),
  /** The client's own idempotency key for a NON-cloud run (no execution id).
   *  Partial-unique so client runs upsert on it while cloud rows (NULL) don't
   *  collide (migration 0283). */
  clientRunId:      varchar('client_run_id', { length: 128 }),
  cloudAgentRef:    varchar('cloud_agent_ref', { length: 64 }),
  /** The cached task action-type label at scoring time (defaults to 'other'). */
  actionType:       varchar('action_type', { length: 32 }).notNull().default('other'),
  /** The model the run actually locked onto (most-frequent llm_usage_log.model). */
  resolvedModel:    varchar('resolved_model', { length: 200 }).notNull(),
  /** effectivePlan at run time (free | pro | teams). */
  plan:             varchar('plan', { length: 16 }).notNull(),
  /** Composite 0..1 outcome score (see computeOutcomeScore / PRD D3). */
  score:            real('score').notNull(),
  merged:           boolean('merged').notNull().default(false),
  ciGreen:          boolean('ci_green').notNull().default(false),
  /** A coding_model_degraded event fired during the run (floored onto a non-coder). */
  degraded:         boolean('degraded').notNull().default(false),
  steps:            integer('steps').notNull().default(0),
  costUsdMillicents: integer('cost_usd_millicents').notNull().default(0),
  terminalStatus:   varchar('terminal_status', { length: 16 }).notNull(), // completed|failed|cancelled
  // ── Literal tool-use + human-review telemetry (migration 0333) ─────────────
  // Captured by the scorer from tool_audit_events / approvals / the PR row so trait
  // reinforcement reads REAL counts (toolErrorRate = tool_errors/tool_calls;
  // humanRejected = an approval rejected OR the PR closed unmerged) instead of the old
  // degraded/cancelled PROXIES. NULLABLE on purpose: rows scored BEFORE 0333 stay NULL
  // and `outcomeToSignal` falls back to the historical proxy for those alone.
  /** Total tool calls the run made (category='tool' audit events). */
  toolCalls:        integer('tool_calls'),
  /** How many of those tool calls returned an error (`ok:false`). */
  toolErrors:       integer('tool_errors'),
  /** A human rejected the work: a bubbled-up approval was rejected OR the PR was
   *  closed without merging. */
  humanRejected:    boolean('human_rejected'),
  // ── Semantic evaluation (Layer 6 — eval, migration 0222) ──────────────────
  // Quality scores for the run's deliverable, 0..1. Nullable: populated by the
  // evaluator on terminal (lexical, inline, zero-cost) or upgraded by the
  // LLM-as-judge /api/eval surface. evalMethod records which backend produced them.
  /** Answer grounded in its context (1 = fully grounded). */
  faithfulness:     real('faithfulness'),
  /** Deliverable addresses the task asked (1 = fully on-topic). */
  answerRelevance:  real('answer_relevance'),
  /** Share of the answer NOT grounded in context (0 = none). */
  hallucinationRate: real('hallucination_rate'),
  /** 'lexical' | 'llm' — which evaluation backend scored this run. */
  evalMethod:       varchar('eval_method', { length: 8 }),
  createdAt:        timestamp('created_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Personality LEARNING + TRACKING (migration 0324, Gaps 6 & 7).
//   personalityEvents      — one row each time a personality/persona is applied to a
//                            run; the durable spine the /api/personality events
//                            endpoint + PersonalityUsagePanel read.
//   traitReinforcements    — proposed/applied/dismissed outcome-driven trait nudges
//                            with full provenance (vector before/after), so the
//                            static trait vector can self-update reversibly + audited.
// ---------------------------------------------------------------------------

/** Which personality was applied to a run (agent, run/session, source, summary). */
export const personalityEvents = pgTable('personality_events', {
  id:                serial('id').primaryKey(),
  tenantId:          integer('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
  /** ide_agents.id (== run_model_outcomes.cloud_agent_ref) whose personality applied. */
  agentRef:          varchar('agent_ref', { length: 64 }).notNull(),
  /** The run: executionId for cloud runs; runId/sessionKey for the embedded runner. */
  executionId:       integer('execution_id'),
  runId:             varchar('run_id', { length: 128 }),
  sessionKey:        varchar('session_key', { length: 255 }),
  /** 'agent' | 'persona' | 'blended' | a raw profile source. */
  profileSource:     varchar('profile_source', { length: 24 }).notNull().default('agent'),
  /** JSON string[] of the persona/agent names applied. */
  personaIds:        text('persona_ids'),
  directivesSummary: text('directives_summary'),
  directiveCount:    integer('directive_count').notNull().default(0),
  thinkLevel:        varchar('think_level', { length: 16 }),
  reasoningLevel:    varchar('reasoning_level', { length: 8 }),
  temperature:       real('temperature'),
  createdAt:         timestamp('created_at').notNull().defaultNow(),
});

/** A proposed/applied/dismissed outcome-driven trait reinforcement (reversible). */
export const traitReinforcements = pgTable('trait_reinforcements', {
  id:            serial('id').primaryKey(),
  tenantId:      integer('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
  agentRef:      varchar('agent_ref', { length: 64 }).notNull(),
  /** 'proposed' | 'applied' | 'dismissed'. */
  status:        varchar('status', { length: 16 }).notNull().default('proposed'),
  /** JSON Record<dimensionId, number> — the bounded per-dimension nudges. */
  deltas:        text('deltas').notNull(),
  /** JSON string[] — the reason for each nudge. */
  rationale:     text('rationale'),
  basedOnRuns:   integer('based_on_runs').notNull().default(0),
  windowDays:    integer('window_days').notNull().default(0),
  /** Reversibility: the exact vector before/after the change (after null until applied). */
  vectorBefore:  text('vector_before'),
  vectorAfter:   text('vector_after'),
  autoApplied:   boolean('auto_applied').notNull().default(false),
  proposedAt:    timestamp('proposed_at').notNull().defaultNow(),
  decidedAt:     timestamp('decided_at'),
  decidedBy:     varchar('decided_by', { length: 128 }),
});

// ---------------------------------------------------------------------------
// Digital Transformation / Architect repo-analysis tool (migration 0072).
// Cloud-only LLM analysis of a project's mapped repos, driven by
// AnalysisRunnerDO one stage per alarm() tick. See repoAnalysisRoutes +
// ArchitectAnalysisService + the RepoSource provider clients.
// ---------------------------------------------------------------------------

/** One analysis invocation — the job + state-machine mirror the UI polls. */
export const repoAnalysisRuns = pgTable('repo_analysis_runs', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenantId:       integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:      uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  projectId:      integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  // queued | fetching | analyzing | writing_back | completed | partial | failed
  status:         varchar('status', { length: 24 }).notNull().default('queued'),
  stage:          varchar('stage', { length: 40 }),
  progress:       integer('progress').notNull().default(0),
  // brownfield | greenfield | parallel (headline from the recommendation artifact)
  recommendation: varchar('recommendation', { length: 24 }),
  effectivePlan:  varchar('effective_plan', { length: 8 }),
  tokenBudget:    integer('token_budget'),
  tokensUsed:     integer('tokens_used').notNull().default(0),
  error:          text('error'),
  triggeredBy:    varchar('triggered_by', { length: 36 }),
  startedAt:      timestamp('started_at'),
  finishedAt:     timestamp('finished_at'),
  createdAt:      timestamp('created_at').notNull().defaultNow(),
  updatedAt:      timestamp('updated_at').notNull().defaultNow(),
});

/** One generated output per run (6 kinds). Unique (run_id, kind) → upsert on retry. */
export const repoAnalysisArtifacts = pgTable('repo_analysis_artifacts', {
  id:        uuid('id').primaryKey().defaultRandom(),
  tenantId:  integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId: uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  runId:     uuid('run_id').notNull().references(() => repoAnalysisRuns.id, { onDelete: 'cascade' }),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  // diagnostic | business | arch_4plus1 | antipatterns | principles | recommendation
  kind:      varchar('kind', { length: 32 }).notNull(),
  title:     varchar('title', { length: 255 }),
  bodyMd:    text('body_md'),       // human Markdown (Mermaid in fences)
  dataJson:  text('data_json'),     // structured strict-schema output (agent-consumable)
  model:     varchar('model', { length: 255 }),
  tokens:    integer('tokens'),
  status:    varchar('status', { length: 16 }).notNull().default('complete'),  // complete | skipped | failed
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  // Unique (run_id, kind) enforced by migration 0072.
});

/** One repo per run: the sampled snapshot the LLM calls were grounded on. */
export const repoAnalysisEvidence = pgTable('repo_analysis_evidence', {
  id:            uuid('id').primaryKey().defaultRandom(),
  tenantId:      integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:     uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  runId:         uuid('run_id').notNull().references(() => repoAnalysisRuns.id, { onDelete: 'cascade' }),
  repoId:        uuid('repo_id').notNull().references(() => projectRepositories.id, { onDelete: 'cascade' }),
  provider:      varchar('provider', { length: 16 }),
  defaultBranch: varchar('default_branch', { length: 255 }),
  languages:     text('languages'),       // JSON { lang: bytes }
  treeSummary:   text('tree_summary'),     // JSON { topDirs, fileCount, totalBytes, truncated }
  sampledFiles:  text('sampled_files'),    // JSON [{ path, bytes, truncated, content }]
  commitSummary: text('commit_summary'),   // JSON { recent, hotspots }
  tokenEstimate: integer('token_estimate'),
  status:        varchar('status', { length: 16 }).notNull().default('complete'),  // complete | partial | failed
  createdAt:     timestamp('created_at').notNull().defaultNow(),
  // Unique (run_id, repo_id) enforced by migration 0072.
});

// ── Slice 5: Runtime-agnostic agent dispatch (agentHost OR cloud OR browser) ──────

/**
 * One unit of agent execution for a swimlane stage. A "stage" is the set of
 * dispatches sharing (ticket_run_id, swimlane_id, stage_seq). Each carries the
 * registered agent + its model (the user's own LLM), the runtime tier, and a
 * status the executor (a agentHost push, or a browser PULL worker) drives to a
 * terminal state. When all dispatches in a stage are terminal the coordinator
 * advances the ticket (autonomous mode) or routes it to needs-attention.
 */
export const agentDispatches = pgTable('agent_dispatches', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenantId:     integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:    uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  ticketRunId:  uuid('ticket_run_id').notNull().references(() => ticketRuns.id, { onDelete: 'cascade' }),
  swimlaneId:   uuid('swimlane_id').references(() => swimlanes.id, { onDelete: 'set null' }),
  assignmentId: uuid('assignment_id').references(() => swimlaneAgentAssignments.id, { onDelete: 'set null' }),
  taskId:       integer('task_id').references(() => tasks.id, { onDelete: 'set null' }),
  agentId:      integer('agent_id').references(() => agents.id, { onDelete: 'set null' }),
  /** Monotonic per-ticket stage counter so a retried lane is a distinct stage. */
  stageSeq:     integer('stage_seq').notNull().default(0),
  role:         varchar('role', { length: 120 }).notNull(),
  runtime:      varchar('runtime', { length: 16 }).notNull().default('cloud'),  // local|cloud|remote|browser
  target:       varchar('target', { length: 120 }),
  /** The LLM the agent runs (the user's own model), e.g. 'anthropic/claude-3-haiku'. */
  model:        varchar('model', { length: 160 }),
  input:        text('input'),
  // pending|claimed|running|completed|failed|cancelled
  status:       varchar('status', { length: 16 }).notNull().default('pending'),
  output:       text('output'),
  error:        text('error'),
  dependsOn:    text('depends_on'),     // JSON array of sibling dispatch ids
  /** AgentHost correlation id, or the browser worker's claim token. */
  externalRef:  varchar('external_ref', { length: 128 }),
  position:     integer('position').notNull().default(0),
  claimedAt:    timestamp('claimed_at'),
  completedAt:  timestamp('completed_at'),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
});

// ───────────────────────────────────────────────────────────────────────────
// Studio voice cloning (Voice PRD #1994). A clone is an enrolled voice identity
// (a reference sample in R2 + a cached speaker embedding); synthesis output is
// persisted to studio_voiceovers, which doubles as the read-through synthesis
// cache (keyed by sha256(cloneId+text+speed+lang)). Licensing lets one tenant
// use another's published clone. Migration 0127.
// ───────────────────────────────────────────────────────────────────────────

/** Who may use/see a clone: only its owner, anyone with the link, or listed in
 *  the marketplace catalog. */
export const voiceCloneVisibilityEnum = pgEnum('voice_clone_visibility', [
  'private',
  'unlisted',
  'marketplace',
]);

/** Lifecycle: enrolling, usable, or published to the marketplace. */
export const voiceCloneStatusEnum = pgEnum('voice_clone_status', ['draft', 'ready', 'published']);

export const studioVoiceClones = pgTable('studio_voice_clones', {
  id:            serial('id').primaryKey(),
  tenantId:      integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:     uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  /** The enrolling user (owner). */
  userId:        varchar('user_id', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  /** The voice-modality IDE project this clone was enrolled under (0224); NULL = tenant-wide/legacy. */
  ideProjectId:  integer('ide_project_id').references(() => ideProjects.id, { onDelete: 'set null' }),
  name:          varchar('name', { length: 255 }).notNull(),
  description:   text('description'),
  /** Synthesis backend honored at synth time (PRD §8 — never hardcode the engine). */
  provider:      varchar('provider', { length: 64 }).notNull().default('ssm-webgpu'),
  /** R2 key of the reference sample the clone was enrolled from. */
  referenceKey:  varchar('reference_key', { length: 512 }),
  /** Cached speaker embedding (L2-normalised number[]) so synthesis skips re-analysis. */
  embedding:     jsonb('embedding').$type<number[]>(),
  visibility:    voiceCloneVisibilityEnum('visibility').notNull().default('private'),
  status:        voiceCloneStatusEnum('status').notNull().default('ready'),
  /** Marketplace price in millicents (1/100000 USD). 0 = free. */
  priceMillicents: integer('price_millicents').notNull().default(0),
  /** Consent attestation (PRD §5 / ToS §9a) — set only when the enroller affirmed
   *  "this is my voice OR I have written permission". Synthesis is gated on it. */
  consentAttestedAt:  timestamp('consent_attested_at'),
  consentTextVersion: varchar('consent_text_version', { length: 32 }),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byTenant: index('idx_studio_voice_clones_tenant').on(t.tenantId),
  byVisibility: index('idx_studio_voice_clones_visibility').on(t.visibility),
}));

export const studioVoiceCloneLicenses = pgTable('studio_voice_clone_licenses', {
  id:        serial('id').primaryKey(),
  /** The licensee (buyer) tenant + user. */
  tenantId:  integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  userId:    varchar('user_id', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  cloneId:   integer('clone_id').notNull().references(() => studioVoiceClones.id, { onDelete: 'cascade' }),
  status:    varchar('status', { length: 16 }).notNull().default('active'),  // active|revoked
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  uniqueLicense: uniqueIndex('uq_voice_clone_license').on(t.cloneId, t.tenantId),
  byTenant: index('idx_voice_clone_licenses_tenant').on(t.tenantId),
}));

export const studioVoiceovers = pgTable('studio_voiceovers', {
  id:           serial('id').primaryKey(),
  tenantId:     integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  cloneId:      integer('clone_id').notNull().references(() => studioVoiceClones.id, { onDelete: 'cascade' }),
  /** sha256(cloneId + normalizedText + speed + lang) — the read-through cache key.
   *  Identical re-synthesis returns this row instead of re-billing. */
  cacheKey:     varchar('cache_key', { length: 64 }).notNull(),
  text:         text('text').notNull(),
  /** R2 key of the synthesized audio. */
  audioKey:     varchar('audio_key', { length: 512 }).notNull(),
  durationMs:   integer('duration_ms').notNull().default(0),
  wordTimestamps: jsonb('word_timestamps')
    .$type<Array<{ word: string; startMs: number; endMs: number }>>()
    .notNull()
    .default([]),
  costUsdMillicents: integer('cost_usd_millicents').notNull().default(0),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  uniqueCacheKey: uniqueIndex('uq_studio_voiceovers_cache_key').on(t.cacheKey),
  byClone: index('idx_studio_voiceovers_clone').on(t.cloneId),
}));

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
 * Server-backed personas marketplace (migration 0203). Mirrors the prompt library
 * (promptLibraryEntries): tenant-scoped persona rows with a PUBLIC visibility tier
 * so a tenant can publish a persona others browse + install. The `persona` JSON is
 * the persona body the editor uses ({ voice, perspective, decisionStyle,
 * outputPrefix, capabilities[], systemDirectives? }). Distinct from
 * `platformPersonas` (admin-managed builtins) — this is user-published content.
 * Public `slug` is globally unique (partial unique index, see 0203).
 */
export const marketplacePersonas = pgTable('marketplace_personas', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenantId:     integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  createdBy:    varchar('created_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  name:         varchar('name', { length: 255 }).notNull(),
  slug:         varchar('slug', { length: 255 }).notNull(),
  description:  text('description'),
  category:     varchar('category', { length: 100 }),
  /** JSON array of tag strings, stored as text (mirrors promptLibraryEntries.tags). */
  tags:         text('tags').notNull().default('[]'),
  /** Persona body: { voice, perspective, decisionStyle, outputPrefix, capabilities[], systemDirectives? }. */
  persona:      jsonb('persona').notNull().default(sql`'{}'::jsonb`),
  /** JSON PsychometricProfile (Pro) — the behaviour-bearing trait vector; null = none. Compiled at run time. */
  psychometric: text('psychometric'),
  /** 'private' | 'tenant' | 'public' */
  visibility:   varchar('visibility', { length: 16 }).notNull().default('private'),
  authorName:   varchar('author_name', { length: 255 }),
  installCount: integer('install_count').notNull().default(0),
  likeCount:    integer('like_count').notNull().default(0),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byTenant:   index('idx_marketplace_personas_tenant').on(t.tenantId),
}));

/**
 * Marketplace listings for KNOWLEDGE documents (migration 0252). Lets a tenant
 * publish a SOP/process/doc/canvas for sale; the listing carries a content
 * snapshot so installing copies it into the buyer's tenant as a new document.
 * Mirrors marketplacePersonas. Charging/checkout (price_cents) is a separate
 * Stripe integration — install currently grants a copy.
 */
export const marketplaceKnowledge = pgTable('marketplace_knowledge', {
  id:               uuid('id').primaryKey().defaultRandom(),
  tenantId:         integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  createdBy:        varchar('created_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  /** The document this listing was published from (SET NULL if it is deleted). */
  sourceDocumentId: uuid('source_document_id').references(() => knowledgeDocuments.id, { onDelete: 'set null' }),
  title:            varchar('title', { length: 255 }).notNull(),
  summary:          text('summary'),
  docType:          varchar('doc_type', { length: 16 }).notNull().default('doc'),
  /** Content snapshot used to recreate the document on install. */
  content:          text('content').notNull().default(''),
  category:         varchar('category', { length: 100 }),
  /** JSON array of tag strings. */
  tags:             text('tags').notNull().default('[]'),
  /** Sale price in cents (0 = free). */
  priceCents:       integer('price_cents').notNull().default(0),
  /** 'private' | 'tenant' | 'public' */
  visibility:       varchar('visibility', { length: 16 }).notNull().default('public'),
  authorName:       varchar('author_name', { length: 255 }),
  installCount:     integer('install_count').notNull().default(0),
  likeCount:        integer('like_count').notNull().default(0),
  createdAt:        timestamp('created_at').notNull().defaultNow(),
  updatedAt:        timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byTenant:   index('idx_marketplace_knowledge_tenant').on(t.tenantId),
}));

/**
 * knowledge_listing_purchases (migration 0320) — proof a tenant bought a PAID
 * knowledge listing, which unlocks install for the whole workspace. Free listings
 * need no row. One purchase per (listing, tenant).
 */
export const knowledgeListingPurchases = pgTable('knowledge_listing_purchases', {
  id:           uuid('id').primaryKey().defaultRandom(),
  listingId:    uuid('listing_id').notNull().references(() => marketplaceKnowledge.id, { onDelete: 'cascade' }),
  tenantId:     integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  purchasedBy:  varchar('purchased_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  priceCents:   integer('price_cents').notNull().default(0),
  provider:     varchar('provider', { length: 24 }).notNull().default('manual'),
  externalRef:  varchar('external_ref', { length: 255 }),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  uniq: uniqueIndex('knowledge_listing_purchase_unique').on(t.listingId, t.tenantId),
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
 * project_evermind (migration 0258) — the per-project, self-learning Evermind
 * model pointer. The canonical weights live in R2 as versioned immutable objects
 * (`evermind/project/<tenantId>/<projectId>/v<version>/…`); this row tracks the
 * CURRENT version + learning mode. The ProjectEvermindCoordinator Durable Object
 * is the single serialized writer (concurrent-learning + FedAvg merge); every
 * surface reads `version` and runs a local replica. See [[evermind-learning-architecture]].
 */
export const projectEvermind = pgTable('project_evermind', {
  id:            uuid('id').primaryKey().defaultRandom(),
  tenantId:      integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  projectId:     integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name:          text('name').notNull().default('Project Evermind'),
  /** Current canonical version (monotonic). 0 = not yet seeded (no model in R2). */
  version:       integer('version').notNull().default(0),
  /** 'connected' (pull + contribute) | 'offline-frozen' (pinned, no write-back). */
  mode:          varchar('mode', { length: 16 }).notNull().default('connected'),
  /** Total merged learning contributions across this model's life (telemetry). */
  contributions: integer('contributions').notNull().default(0),
  /**
   * Opt-in consumer flag (migration 0264). When TRUE + seeded, agent runs for this
   * project's tasks resolve their inference model to the project's current Evermind
   * head — the emitter of the `project_evermind:<projectId>` pin. Independent of
   * `mode` (write-back): read without contributing, or contribute without reading.
   */
  inferenceEnabled: boolean('inference_enabled').notNull().default(false),
  /**
   * Optional frontier-LLM TEACHER (migration 0277). When set to a gateway model id
   * (e.g. `claude-opus-4-8`, a Mistral/GLM id), the coordinator distills: it asks
   * that model for the exemplary version of each run and adapts the SSM on the
   * teacher's output instead of the raw run text (teacher→student). NULL = learn
   * from raw run text only (no teacher call, no teacher token cost).
   */
  teacherModel:  text('teacher_model'),
  lastLearnedAt: timestamp('last_learned_at'),
  /**
   * Auto-quarantine bookkeeping (migration 0339). `serveFailureStreak` counts
   * CONSECUTIVE incoherent serves (reset to 0 by any coherent serve or a manual
   * re-enable); when it reaches the threshold the head is force-disabled and
   * `quarantinedAt`/`quarantineReason` are stamped so a broken head stops answering
   * users in gibberish. See `recordEvermindServeOutcome`.
   */
  serveFailureStreak: integer('serve_failure_streak').notNull().default(0),
  quarantinedAt:     timestamp('quarantined_at'),
  quarantineReason:  text('quarantine_reason'),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  uqProject: uniqueIndex('uq_project_evermind_project').on(t.tenantId, t.projectId),
}));

// ── Insight-lens object tiers (migration 0220) ───────────────────────────────
// The only NEW storage the role-insight lenses need; everything else they read
// (run_model_outcomes, deployment_events, llm_usage_log, tool_audit_events) is
// already collected. Both tenant + segment scoped, uuid PKs, so the generic
// segmentTrackerRoutes factory drives their CRUD.

/** FinOps ceiling (LENS #3 / CFO): a monthly spend limit per scope, compared
 *  against the already-attributed llm_usage_log actuals in financeInsights. */
export const budgets = pgTable('budgets', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenantId:     integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:    uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  scopeKind:    varchar('scope_kind', { length: 16 }).notNull().default('tenant'), // tenant | project | initiative
  projectId:    integer('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  initiativeId: uuid('initiative_id').references(() => initiatives.id, { onDelete: 'cascade' }),
  periodMonth:  varchar('period_month', { length: 7 }).notNull(), // 'YYYY-MM'
  limitUsd:     real('limit_usd').notNull().default(0),
  notes:        text('notes'),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byScope: index('idx_budgets_scope').on(t.tenantId, t.segmentId, t.periodMonth),
}));

/** Innovation-funnel pipeline (LENS #5 / CEO): a tracked idea moving through
 *  idea→validated→in_build→shipped→measured (killed = off-ramp). stage_entered_at
 *  is trigger-maintained so the generic tracker PATCH needn't set it. */
export const innovationIdeas = pgTable('innovation_ideas', {
  id:              uuid('id').primaryKey().defaultRandom(),
  tenantId:        integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:       uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  initiativeId:    uuid('initiative_id').references(() => initiatives.id, { onDelete: 'set null' }),
  title:           varchar('title', { length: 255 }).notNull(),
  description:     text('description'),
  stage:           varchar('stage', { length: 16 }).notNull().default('idea'),
  linkedProjectId: integer('linked_project_id').references(() => projects.id, { onDelete: 'set null' }),
  impact:          real('impact'),
  effort:          real('effort'),
  confidence:      real('confidence'),
  outcome:         text('outcome'),
  outcomeValue:    real('outcome_value'),
  killedReason:    text('killed_reason'),
  stageEnteredAt:  timestamp('stage_entered_at').notNull().defaultNow(),
  notes:           text('notes'),
  createdAt:       timestamp('created_at').notNull().defaultNow(),
  updatedAt:       timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byScope: index('idx_innovation_ideas_scope').on(t.tenantId, t.segmentId, t.stage),
}));

/**
 * Diagnostics & Tools — saved runs of a free tool (calculator/questionnaire).
 * Definitions are code (application/tools); this stores kept results. See
 * migration 0217.
 */
export const toolRuns = pgTable('tool_runs', {
  id:         uuid('id').primaryKey().defaultRandom(),
  tenantId:   integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:  uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  // When set, the run was scored AGAINST this project; it contributes to the
  // project's diagnostic rating (which rolls up to the tenant). Null = workspace.
  projectId:  integer('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  // When set, the diagnostic was scored against a single ticket (migration 0275) —
  // the ticket audit engine checks kind='diagnostic' requirements by looking for a
  // tool_run on the task. Null = project/workspace-scoped run.
  taskId:     integer('task_id').references(() => tasks.id, { onDelete: 'set null' }),
  toolId:     varchar('tool_id', { length: 64 }).notNull(),
  kind:       varchar('kind', { length: 16 }).notNull().default('self'), // self | data
  input:      jsonb('input').notNull().default(sql`'{}'::jsonb`),
  result:     jsonb('result').notNull().default(sql`'{}'::jsonb`),
  createdBy:  varchar('created_by', { length: 36 }),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  byTenantTool: index('idx_tool_runs_tenant_tool').on(t.tenantId, t.toolId, t.createdAt),
  byProject: index('idx_tool_runs_project').on(t.tenantId, t.projectId, t.toolId, t.createdAt),
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

/**
 * Latest anonymous tool result per (visitor, tool) (migration 0279) — upserted on
 * every free run so a returning visitor can see their diagnostics again and we can
 * target them with a sign-up. Bounded (one row per visitor+tool) via upsert.
 */
export const marketingToolRuns = pgTable('marketing_tool_runs', {
  id:         uuid('id').primaryKey().defaultRandom(),
  visitorId:  varchar('visitor_id', { length: 64 }).notNull(),
  toolId:     varchar('tool_id', { length: 64 }).notNull(),
  input:      jsonb('input').notNull().default(sql`'{}'::jsonb`),
  result:     jsonb('result').notNull().default(sql`'{}'::jsonb`),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byVisitorTool: uniqueIndex('uq_marketing_tool_runs').on(t.visitorId, t.toolId),
  byVisitor: index('idx_marketing_tool_runs_visitor').on(t.visitorId, t.updatedAt),
}));

/**
 * Human-authored qualitative update stream on any deliverable (migration 0248) —
 * the narrative companion (EMP-11) to the delivery lens's quantitative status.
 * Polymorphic target via (scopeKind, scopeId); newest-first per deliverable.
 */
export const deliverableUpdates = pgTable('deliverable_updates', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:   uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  scopeKind:   varchar('scope_kind', { length: 16 }).notNull(),  // initiative | project | release | sprint
  scopeId:     varchar('scope_id', { length: 64 }).notNull(),
  statusLabel: varchar('status_label', { length: 16 }),          // on_track | at_risk | blocked | done | note
  body:        text('body').notNull(),
  authorId:    varchar('author_id', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  authorName:  varchar('author_name', { length: 255 }),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
});

/**
 * Desired investment mix per scope per month (migration 0226) — the goal half of
 * the allocation lens (EMP-2). One row per (scope, period, category) sets the
 * target share of effort (e.g. 30% innovation); the allocation rollup compares it
 * to the measured actual and surfaces the variance. tenant+segment scoped like the
 * other planning trackers, so segmentTrackerRoutes drives its CRUD.
 */
export const allocationGoals = pgTable('allocation_goals', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:   uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  scopeKind:   varchar('scope_kind', { length: 16 }).notNull().default('tenant'), // tenant | team | project
  teamId:      integer('team_id').references(() => teams.id, { onDelete: 'cascade' }),
  projectId:   integer('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  periodMonth: varchar('period_month', { length: 7 }).notNull(),                   // 'YYYY-MM'
  category:    varchar('category', { length: 16 }).notNull(),                      // innovation | ktlo | support | tech_debt | other
  targetPct:   real('target_pct').notNull().default(0),                            // desired share of effort (0..100)
  notes:       text('notes'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
});

/**
 * Anonymous demo-funnel telemetry (migration 0360). The signed-in activity
 * tracker never fires for marketing-shell visitors, so the demo experience
 * writes its own append-only stream keyed by the same visitorId as
 * marketing_sessions: demo_start → page views → convert prompt shown/clicked →
 * lead/newsletter/exit. The admin funnel panel aggregates this by persona.
 */
export const demoEvents = pgTable('demo_events', {
  id:         bigserial('id', { mode: 'number' }).primaryKey(),
  visitorId:  varchar('visitor_id', { length: 64 }).notNull(),
  persona:    varchar('persona', { length: 32 }),
  kind:       varchar('kind', { length: 64 }).notNull(),
  path:       varchar('path', { length: 300 }),
  metadata:   jsonb('metadata'),
  occurredAt: timestamp('occurred_at').notNull().defaultNow(),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  byPersonaTime: index('idx_demo_events_persona_time').on(t.persona, t.occurredAt),
  byVisitor: index('idx_demo_events_visitor').on(t.visitorId, t.occurredAt),
}));

/**
 * "Book a demo with sales" capture (migration 0360) — written by the public
 * /book-demo page and the demo exit-intent/convert prompts. Platform-global
 * (no tenant): these are prospects, not customers.
 */
export const salesLeads = pgTable('sales_leads', {
  id:        uuid('id').primaryKey().defaultRandom(),
  name:      varchar('name', { length: 200 }).notNull(),
  email:     varchar('email', { length: 320 }).notNull(),
  company:   varchar('company', { length: 200 }),
  interest:  varchar('interest', { length: 64 }),
  message:   text('message'),
  source:    varchar('source', { length: 64 }),
  locale:    varchar('locale', { length: 5 }),
  visitorId: varchar('visitor_id', { length: 64 }),
  status:    varchar('status', { length: 16 }).notNull().default('new'), // new | contacted | qualified | closed
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  byCreated: index('idx_sales_leads_created').on(t.createdAt),
}));

// ---------------------------------------------------------------------------
// Knowledge Management — SOPs, processes & documents (migration 0227)
//
// Team-authored knowledge with versioning, tagging, read-acknowledgement
// (audit evidence for SOX/TISAX/ISO) and training assignments with due dates.
// Tenant + segment scoped; optionally project scoped (null = workspace-wide).
// ---------------------------------------------------------------------------

/** A knowledge document: an SOP, process flow, or general doc. */
export const knowledgeDocuments = pgTable('knowledge_documents', {
  id:            uuid('id').primaryKey().defaultRandom(),
  tenantId:      integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:     uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  projectId:     integer('project_id').references(() => projects.id, { onDelete: 'set null' }), // null = workspace-wide
  docType:       varchar('doc_type', { length: 16 }).notNull().default('sop'),   // 'sop' | 'process' | 'doc' | 'postmortem' | 'known_error'
  title:         varchar('title', { length: 255 }).notNull(),
  summary:       varchar('summary', { length: 500 }),
  content:       text('content').notNull().default(''),
  status:        varchar('status', { length: 16 }).notNull().default('draft'),   // 'draft' | 'published' | 'archived'
  versionNumber: integer('version_number').notNull().default(0),                 // monotonic published version
  requiresAck:   boolean('requires_ack').notNull().default(false),
  /** For an incident RCA / post-mortem (docType 'postmortem'), the prod_incidents
   *  record it reviews (migration 0328) — the Knowledge → incident back-link. Null on
   *  ordinary docs. */
  sourceIncidentId: uuid('source_incident_id'),
  createdBy:     varchar('created_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  updatedBy:     varchar('updated_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  publishedAt:   timestamp('published_at'),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
});

/** Immutable snapshot of a document at the moment it was published. */
export const knowledgeDocumentVersions = pgTable('knowledge_document_versions', {
  id:            uuid('id').primaryKey().defaultRandom(),
  tenantId:      integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  documentId:    uuid('document_id').notNull().references(() => knowledgeDocuments.id, { onDelete: 'cascade' }),
  versionNumber: integer('version_number').notNull(),
  title:         varchar('title', { length: 255 }).notNull(),
  content:       text('content').notNull(),
  changeNote:    varchar('change_note', { length: 500 }),
  publishedBy:   varchar('published_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  uqVersion: uniqueIndex('uq_knowledge_versions').on(t.documentId, t.versionNumber),
}));

/** Free-form tags for filtering/organising knowledge. */
export const knowledgeDocumentTags = pgTable('knowledge_document_tags', {
  id:            uuid('id').primaryKey().defaultRandom(),
  tenantId:      integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  documentId:    uuid('document_id').notNull().references(() => knowledgeDocuments.id, { onDelete: 'cascade' }),
  tag:           varchar('tag', { length: 64 }).notNull(),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  uqTag: uniqueIndex('uq_knowledge_tags').on(t.documentId, t.tag),
}));

/** Audit evidence: a user read & acknowledged a specific published version. */
export const knowledgeAcknowledgements = pgTable('knowledge_acknowledgements', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenantId:       integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  documentId:     uuid('document_id').notNull().references(() => knowledgeDocuments.id, { onDelete: 'cascade' }),
  userId:         varchar('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  versionNumber:  integer('version_number').notNull(),
  acknowledgedAt: timestamp('acknowledged_at').notNull().defaultNow(),
}, (t) => ({
  uqAck: uniqueIndex('uq_knowledge_acks').on(t.documentId, t.userId),
}));

/** Per-document collaborators: users explicitly invited to a page (editor|viewer). */
export const knowledgeDocumentCollaborators = pgTable('knowledge_document_collaborators', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  documentId:  uuid('document_id').notNull().references(() => knowledgeDocuments.id, { onDelete: 'cascade' }),
  userId:      varchar('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  role:        varchar('role', { length: 16 }).notNull().default('editor'), // 'editor' | 'viewer'
  invitedBy:   varchar('invited_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  uqCollab: uniqueIndex('uq_knowledge_collab').on(t.documentId, t.userId),
}));

/** Training expectation: a document assigned to a user with an optional due date. */
export const knowledgeTrainingAssignments = pgTable('knowledge_training_assignments', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  documentId:  uuid('document_id').notNull().references(() => knowledgeDocuments.id, { onDelete: 'cascade' }),
  userId:      varchar('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  assignedBy:  varchar('assigned_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  dueAt:       timestamp('due_at'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  uqTraining: uniqueIndex('uq_knowledge_training').on(t.documentId, t.userId),
}));

// ===========================================================================
// Board-deck data spine (migrations 0236-0239) — the collectors that close the
// remaining gaps in the CTO/R&D quarterly board deck. The existing lenses cover
// Delivery/DORA, FinOps, Allocation, Deliverables, AI-Impact and DevEx; these
// add the QUALITY (ops/support), PEOPLE (headcount), AI-PROGRAM (third-party
// adoption + program investment) and disaggregated R&D FINANCIALS that nothing
// else collects. Tenant + segment scoped like the other planning trackers, so
// segmentTrackerRoutes drives their CRUD.
// ===========================================================================

// ── QUALITY (migration 0236) ───────────────────────────────────────────────

/** A production incident / alert — the ops half of the Quality slide. MTTR =
 *  resolvedAt − startedAt over resolved incidents (the prod analogue of the
 *  deploy-tied MTTR in deployment_events). `isAlertOnly` marks noise that paged
 *  but never became an incident → the Alerts count. Fed by PagerDuty/Sentry
 *  webhooks (boardsync) keyed by externalRef, or entered manually. */
export const prodIncidents = pgTable('prod_incidents', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenantId:       integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:      uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  projectId:      integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
  title:          varchar('title', { length: 255 }).notNull(),
  severity:       varchar('severity', { length: 16 }).notNull().default('sev3'), // sev1 | sev2 | sev3 | sev4
  status:         varchar('status', { length: 16 }).notNull().default('open'),   // open | acknowledged | mitigated | resolved
  isAlertOnly:    boolean('is_alert_only').notNull().default(false),
  source:         varchar('source', { length: 24 }).notNull().default('manual'), // pagerduty | sentry | datadog | manual
  externalRef:    varchar('external_ref', { length: 255 }),
  startedAt:      timestamp('started_at').notNull().defaultNow(),
  acknowledgedAt: timestamp('acknowledged_at'),
  resolvedAt:     timestamp('resolved_at'),
  impact:         text('impact'),
  rootCause:      text('root_cause'),
  postmortemUrl:  varchar('postmortem_url', { length: 512 }),
  // Active-response fields (migration 0325): the bridge to the board + war-room +
  // escalation state that turns this metrics record into a live incident.
  boardTaskId:        integer('board_task_id'),               // linked 'incident' kanban task
  affectedSystem:     varchar('affected_system', { length: 120 }),
  assignedAgentRef:   varchar('assigned_agent_ref', { length: 64 }),
  warRoomChatId:      integer('war_room_chat_id'),            // → brainChats.id (serial)
  escalationPolicyId: uuid('escalation_policy_id'),           // → escalationPolicies.id
  escalationLevel:    integer('escalation_level').notNull().default(0),
  lastEscalatedAt:    timestamp('last_escalated_at'),
  externalUrl:        varchar('external_url', { length: 512 }),
  createdAt:      timestamp('created_at').notNull().defaultNow(),
  updatedAt:      timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byStarted: index('idx_prod_incidents_started').on(t.tenantId, t.startedAt),
  byStatus:  index('idx_prod_incidents_status').on(t.tenantId, t.status),
  uqExternal: uniqueIndex('uq_prod_incidents_external').on(t.tenantId, t.source, t.externalRef),
}));

/** Incident → implicated DELIVERY ticket(s) (PRD §5.10): the ticket(s) whose change
 *  caused an incident, so RCA can pull their Accountability Reports and see where the
 *  process was skipped/waived. Distinct from `boardTaskId` (the incident's OWN ticket)
 *  and from remediation follow-ups (`tasks.incidentId`). Migration 0335. */
export const prodIncidentImplicatedTasks = pgTable('prod_incident_implicated_tasks', {
  id:         uuid('id').primaryKey().defaultRandom(),
  tenantId:   integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  incidentId: uuid('incident_id').notNull().references(() => prodIncidents.id, { onDelete: 'cascade' }),
  taskId:     integer('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  relation:   varchar('relation', { length: 24 }).notNull().default('implicated'), // implicated | suspected | ruled_out
  note:       text('note'),
  createdBy:  varchar('created_by', { length: 36 }),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uidx_incident_implicated_task').on(t.incidentId, t.taskId),
  index('idx_incident_implicated_incident').on(t.incidentId),
  index('idx_incident_implicated_tenant').on(t.tenantId),
]);

// ---------------------------------------------------------------------------
// Incident management: on-call, escalation, contacts, timeline (migration 0325)
// ---------------------------------------------------------------------------

/** A named on-call list. Who is on call NOW is resolved from the ordered
 *  {@link onCallMembers}: 'manual' → currentIndex; 'daily'/'weekly' → time-sliced
 *  round-robin. */
export const onCallRotations = pgTable('on_call_rotations', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenantId:     integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:    uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  projectId:    integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
  name:         varchar('name', { length: 255 }).notNull(),
  description:  text('description'),
  rotationKind: varchar('rotation_kind', { length: 16 }).notNull().default('manual'), // manual|daily|weekly
  currentIndex: integer('current_index').notNull().default(0),
  active:       boolean('active').notNull().default(true),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byTenant: index('idx_on_call_rotations_tenant').on(t.tenantId, t.active),
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

/** A timed escalation policy. Matches incidents (optionally by severity); its
 *  {@link escalationLevels} fire in order until the incident is acknowledged. */
export const escalationPolicies = pgTable('escalation_policies', {
  id:            uuid('id').primaryKey().defaultRandom(),
  tenantId:      integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:     uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  projectId:     integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
  name:          varchar('name', { length: 255 }).notNull(),
  description:   text('description'),
  matchSeverity: varchar('match_severity', { length: 16 }), // null = any
  active:        boolean('active').notNull().default(true),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byTenant: index('idx_escalation_policies_tenant').on(t.tenantId, t.active),
}));

/** One timed step of an escalation policy: at afterMinutes past the incident start,
 *  if still unacknowledged, page targetKind/targetRef through the enabled channels. */
export const escalationLevels = pgTable('escalation_levels', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenantId:     integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  policyId:     uuid('policy_id').notNull().references(() => escalationPolicies.id, { onDelete: 'cascade' }),
  level:        integer('level').notNull().default(1),
  afterMinutes: integer('after_minutes').notNull().default(15),
  targetKind:   varchar('target_kind', { length: 24 }).notNull().default('oncall_rotation'), // oncall_rotation|user|contact|team_chat
  targetRef:    varchar('target_ref', { length: 72 }),
  notifyTeams:  boolean('notify_teams').notNull().default(true),
  notifySlack:  boolean('notify_slack').notNull().default(true),
  notifyEmail:  boolean('notify_email').notNull().default(true),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  byPolicy: index('idx_escalation_levels_policy').on(t.policyId, t.level),
}));

/** A business contact — a stakeholder to talk to during an incident. */
export const businessContacts = pgTable('business_contacts', {
  id:        uuid('id').primaryKey().defaultRandom(),
  tenantId:  integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId: uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  name:      varchar('name', { length: 255 }).notNull(),
  roleTitle: varchar('role_title', { length: 255 }),
  company:   varchar('company', { length: 255 }),
  email:     varchar('email', { length: 255 }),
  phone:     varchar('phone', { length: 64 }),
  teamsId:   varchar('teams_id', { length: 255 }),
  notes:     text('notes'),
  tags:      jsonb('tags').notNull().default(sql`'[]'::jsonb`),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byTenant: index('idx_business_contacts_tenant').on(t.tenantId, t.name),
}));

// ---------------------------------------------------------------------------
// Active monitoring: diagram boards + monitor pins + monitor history (migration 0329)
// ---------------------------------------------------------------------------

/** An uploaded diagram / architecture image the team overlays monitor pins on. The
 *  image itself lives in R2 (via /api/brain/upload); we keep the key + dimensions. */
export const monitoringBoards = pgTable('monitoring_boards', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:   uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  projectId:   integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
  name:        varchar('name', { length: 255 }).notNull(),
  imageKey:    varchar('image_key', { length: 512 }),   // R2 key
  imageWidth:  integer('image_width'),
  imageHeight: integer('image_height'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byTenant: index('idx_monitoring_boards_tenant').on(t.tenantId),
}));

/** A monitor pinned on a board. pos_x/pos_y are 0..1 fractions of the image. A breach
 *  opens an incident (current_incident_id) and pages on-call. */
export const monitors = pgTable('monitors', {
  id:                  uuid('id').primaryKey().defaultRandom(),
  tenantId:            integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:           uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  boardId:             uuid('board_id').notNull().references(() => monitoringBoards.id, { onDelete: 'cascade' }),
  projectId:           integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
  label:               varchar('label', { length: 255 }).notNull(),
  description:         text('description'),
  posX:                real('pos_x').notNull().default(0.5),
  posY:                real('pos_y').notNull().default(0.5),
  monitorType:         varchar('monitor_type', { length: 20 }).notNull().default('webhook'), // heartbeat|http_check|webhook|metric_threshold|manual
  config:              jsonb('config').notNull().default(sql`'{}'::jsonb`),
  affectedSystem:      varchar('affected_system', { length: 120 }),
  severity:            varchar('severity', { length: 16 }).notNull().default('sev3'),
  escalationPolicyId:  uuid('escalation_policy_id'),
  status:              varchar('status', { length: 16 }).notNull().default('unknown'), // ok|breached|unknown
  consecutiveFailures: integer('consecutive_failures').notNull().default(0),
  lastSignalAt:        timestamp('last_signal_at'),
  lastCheckedAt:       timestamp('last_checked_at'),
  lastStatusChangeAt:  timestamp('last_status_change_at'),
  currentIncidentId:   uuid('current_incident_id'),
  webhookSecret:       varchar('webhook_secret', { length: 64 }),
  active:              boolean('active').notNull().default(true),
  createdAt:           timestamp('created_at').notNull().defaultNow(),
  updatedAt:           timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byBoard:  index('idx_monitors_board').on(t.boardId),
  byStatus: index('idx_monitors_tenant_status').on(t.tenantId, t.status),
  byActive: index('idx_monitors_active').on(t.active, t.monitorType),
}));

/** A monitor's own signal/breach/recovery history (its incidents live in prodIncidents). */
export const monitorEvents = pgTable('monitor_events', {
  id:         uuid('id').primaryKey().defaultRandom(),
  tenantId:   integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  monitorId:  uuid('monitor_id').notNull().references(() => monitors.id, { onDelete: 'cascade' }),
  kind:       varchar('kind', { length: 16 }).notNull().default('signal'), // signal|breach|recovery|check|error
  status:     varchar('status', { length: 16 }),
  message:    text('message'),
  incidentId: uuid('incident_id'),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  byMonitor: index('idx_monitor_events_monitor').on(t.monitorId, t.createdAt),
}));

/** Append-only incident timeline + notification log (the war-room feed + paging
 *  audit). */
export const incidentEvents = pgTable('incident_events', {
  id:         uuid('id').primaryKey().defaultRandom(),
  tenantId:   integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  incidentId: uuid('incident_id').notNull().references(() => prodIncidents.id, { onDelete: 'cascade' }),
  kind:       varchar('kind', { length: 24 }).notNull().default('note'), // created|classified|assigned|escalated|notified|status_change|note|resolved
  actorRef:   varchar('actor_ref', { length: 72 }),
  message:    text('message'),
  channel:    varchar('channel', { length: 16 }),
  target:     varchar('target', { length: 255 }),
  level:      integer('level'),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  byIncident: index('idx_incident_events_incident').on(t.incidentId, t.createdAt),
}));

/** A customer-support ticket — Support Issues / Tech Support Tix / Support-Tix-
 *  per-Customer (distinct customerRef). `isBug` flags the post-production-bug
 *  subset. Fed by Freshservice/ServiceNow poll (boardsync) keyed by externalRef,
 *  or entered manually. */
export const supportTickets = pgTable('support_tickets', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:   uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  source:      varchar('source', { length: 24 }).notNull().default('manual'), // freshservice | servicenow | zendesk | manual
  externalRef: varchar('external_ref', { length: 255 }),
  subject:     varchar('subject', { length: 512 }),
  category:    varchar('category', { length: 24 }).notNull().default('other'), // bug | how_to | billing | feature_request | other
  isBug:       boolean('is_bug').notNull().default(false),
  priority:    varchar('priority', { length: 16 }).notNull().default('normal'),
  status:      varchar('status', { length: 16 }).notNull().default('open'),
  customerRef: varchar('customer_ref', { length: 255 }),
  openedAt:    timestamp('opened_at').notNull().defaultNow(),
  resolvedAt:  timestamp('resolved_at'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byOpened: index('idx_support_tickets_opened').on(t.tenantId, t.openedAt),
  byBug:    index('idx_support_tickets_bug').on(t.tenantId, t.isBug),
  uqExternal: uniqueIndex('uq_support_tickets_external').on(t.tenantId, t.source, t.externalRef),
}));

/** A daily uptime sample per service — Uptime % on the Quality slide. One row per
 *  (service, day). Fed by a status-page connector (not yet built — manual until
 *  then) or derived from prodIncidents downtime. */
export const uptimeSamples = pgTable('uptime_samples', {
  id:              uuid('id').primaryKey().defaultRandom(),
  tenantId:        integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:       uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  serviceName:     varchar('service_name', { length: 120 }).notNull().default('production'),
  periodDay:       date('period_day').notNull(),
  uptimePct:       real('uptime_pct').notNull().default(100), // 0..100 for the day
  downtimeMinutes: real('downtime_minutes').notNull().default(0),
  source:          varchar('source', { length: 24 }).notNull().default('manual'), // statuspage | pingdom | betterstack | manual
  createdAt:       timestamp('created_at').notNull().defaultNow(),
  updatedAt:       timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byDay: index('idx_uptime_samples_day').on(t.tenantId, t.periodDay),
  uqDay: uniqueIndex('uq_uptime_samples_day').on(t.tenantId, t.serviceName, t.periodDay),
}));

// ── PEOPLE (migration 0237) ─────────────────────────────────────────────────

/** Append-only headcount event — drives the Headcount Waterfall + Attrition Rate
 *  on the People slide. `isVoluntary` (leave only) splits voluntary vs involuntary
 *  attrition. memberKind reuses the human/agent axis. */
export const headcountEvents = pgTable('headcount_events', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:   uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  memberKind:  varchar('member_kind', { length: 16 }).notNull().default('human'), // human | cloud_agent | host_agent
  memberRef:   varchar('member_ref', { length: 255 }),
  memberName:  varchar('member_name', { length: 255 }),
  eventType:   varchar('event_type', { length: 16 }).notNull(),                    // hire | leave | transfer
  teamId:      integer('team_id').references(() => teams.id, { onDelete: 'set null' }),
  effectiveOn: date('effective_on').notNull(),
  isVoluntary: boolean('is_voluntary'),                                            // leave only
  reason:      text('reason'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byEffective: index('idx_headcount_events_effective').on(t.tenantId, t.effectiveOn),
}));

/** An open requisition — High Priority Open Positions on the People slide.
 *  days_open = today − openedOn (derived in the rollup). */
export const openPositions = pgTable('open_positions', {
  id:            uuid('id').primaryKey().defaultRandom(),
  tenantId:      integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:     uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  reqTitle:      varchar('req_title', { length: 255 }).notNull(),
  teamId:        integer('team_id').references(() => teams.id, { onDelete: 'set null' }),
  priority:      varchar('priority', { length: 16 }).notNull().default('normal'), // high | normal | low
  status:        varchar('status', { length: 16 }).notNull().default('open'),     // open | filled | on_hold | cancelled
  openedOn:      date('opened_on').notNull().defaultNow(),
  targetStartOn: date('target_start_on'),
  filledOn:      date('filled_on'),
  notes:         text('notes'),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byStatus: index('idx_open_positions_status').on(t.tenantId, t.status, t.priority),
}));

// ── AI PROGRAM (migration 0238) — layers on top of aiImpactInsights ──────────

/** Third-party AI-tool adoption the platform can't instrument directly (Copilot,
 *  Cursor, …) — AI Tools Adoption & Impact on the AI slide. adoption % =
 *  activeUsers/eligibleUsers; ROI = estHoursSaved vs monthlyCostUsd. */
export const aiToolAdoption = pgTable('ai_tool_adoption', {
  id:            uuid('id').primaryKey().defaultRandom(),
  tenantId:      integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:     uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  toolName:      varchar('tool_name', { length: 120 }).notNull(),
  category:      varchar('category', { length: 24 }).notNull().default('coding'), // coding | review | testing | docs | other
  periodMonth:   varchar('period_month', { length: 7 }).notNull(),                // 'YYYY-MM'
  activeUsers:   integer('active_users').notNull().default(0),
  eligibleUsers: integer('eligible_users').notNull().default(0),
  estHoursSaved: real('est_hours_saved').notNull().default(0),
  monthlyCostUsd: real('monthly_cost_usd').notNull().default(0),
  notes:         text('notes'),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byPeriod: index('idx_ai_tool_adoption_period').on(t.tenantId, t.periodMonth),
  uqTool:   uniqueIndex('uq_ai_tool_adoption').on(t.tenantId, t.toolName, t.periodMonth),
}));

/** AI program investment linked to the PMO initiative tier — AI Program Investment
 *  (Objective → Summary) on the AI slide. investedUsd reconciles against budgets
 *  scoped to the same initiative. */
export const aiProgramInitiatives = pgTable('ai_program_initiatives', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenantId:     integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:    uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  initiativeId: uuid('initiative_id').references(() => initiatives.id, { onDelete: 'set null' }),
  programName:  varchar('program_name', { length: 255 }).notNull(),
  tier:         varchar('tier', { length: 16 }).notNull().default('strategic'),   // strategic | experiment | enablement
  investedUsd:  real('invested_usd').notNull().default(0),
  status:       varchar('status', { length: 16 }).notNull().default('active'),
  objective:    text('objective'),
  notes:        text('notes'),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byTenant:     index('idx_ai_program_initiatives_tenant').on(t.tenantId),
  byInitiative: index('idx_ai_program_initiatives_init').on(t.initiativeId),
}));

// ── R&D FINANCIALS (migration 0239) — disaggregated quarterly ────────────────

/** Quarterly R&D spend by category — Key R&D Financials on the Investment slide.
 *  One row per (fy, quarter, category) with actual + plan dollars. The board's
 *  categories (headcount/hosting/COGS/licenses) are not in any live ledger, so
 *  these are entered/imported (LLM/ingestion lines can auto-seed). */
export const rdFinancialsQuarterly = pgTable('rd_financials_quarterly', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:   uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  fiscalYear:  integer('fiscal_year').notNull(),
  quarter:     integer('quarter').notNull(),                                       // 1..4
  category:    varchar('category', { length: 24 }).notNull(),                      // headcount | tech_debt | hosting_storage | cogs | internal | third_party_licenses
  actualUsd:   real('actual_usd').notNull().default(0),
  planUsd:     real('plan_usd').notNull().default(0),
  source:      varchar('source', { length: 16 }).notNull().default('manual'),      // manual | llm_usage | import
  notes:       text('notes'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byFy: index('idx_rd_financials_fy').on(t.tenantId, t.fiscalYear, t.quarter),
  uqCat: uniqueIndex('uq_rd_financials_cat').on(t.tenantId, t.fiscalYear, t.quarter, t.category),
}));

/** Quarterly R&D revenue — backs the Total-R&D$/Revenue ratio on the Investment slide. */
export const rdRevenueQuarterly = pgTable('rd_revenue_quarterly', {
  id:         uuid('id').primaryKey().defaultRandom(),
  tenantId:   integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:  uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  fiscalYear: integer('fiscal_year').notNull(),
  quarter:    integer('quarter').notNull(),
  revenueUsd: real('revenue_usd').notNull().default(0),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  uqQuarter: uniqueIndex('uq_rd_revenue_quarter').on(t.tenantId, t.fiscalYear, t.quarter),
}));

/** Quarterly R&D FTE allocation by category — Historical Investment Allocation
 *  (R&D FTEs) on the Investment slide. Separate grain from dollars so neither
 *  null-pads the other. */
export const rdFteAllocationQuarterly = pgTable('rd_fte_allocation_quarterly', {
  id:         uuid('id').primaryKey().defaultRandom(),
  tenantId:   integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:  uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  fiscalYear: integer('fiscal_year').notNull(),
  quarter:    integer('quarter').notNull(),
  category:   varchar('category', { length: 24 }).notNull(),                       // growth | infrastructure | support | unplanned | other
  fte:        real('fte').notNull().default(0),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  uqCat: uniqueIndex('uq_rd_fte_cat').on(t.tenantId, t.fiscalYear, t.quarter, t.category),
}));

// ===========================================================================
// Deck generator (migrations 0242-0243) — the template library + generated-deck
// records behind the board-deck download / Brain "generate deck" tooling.
// ===========================================================================

/** A stored .pptx template + its {{token}}→binding manifest. Built-in templates
 *  (the R&D board deck, the CFO/DevFinOps deck) live at tenant_id=0; tenant
 *  uploads carry their own tenant_id. The binary lives in R2 at r2Key. */
export const deckTemplates = pgTable('deck_templates', {
  id:           uuid('id').primaryKey().defaultRandom(),
  // Sentinel 0 = BUILTIN_TENANT (global, tenant-less built-in templates); real
  // templates carry a live tenant id. Intentionally NO FK to tenants(id): the
  // 0 sentinel is not a real tenant row (tenants.id is serial from 1), so an FK
  // here rejected the built-in seed and blocked deploys (see migration 0243).
  // Tenant scoping is enforced in TemplateLibraryService queries.
  tenantId:     integer('tenant_id').notNull().default(0),
  name:         varchar('name', { length: 255 }).notNull(),
  description:  text('description'),
  archetype:    varchar('archetype', { length: 24 }).notNull().default('custom'), // board | cfo_devfinops | custom | generative
  r2Key:        varchar('r2_key', { length: 512 }),
  manifestJson: jsonb('manifest_json').notNull().default(sql`'{"version":1,"bindings":[]}'::jsonb`),
  isBuiltin:    boolean('is_builtin').notNull().default(false),
  createdBy:    varchar('created_by', { length: 36 }),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byTenant: index('idx_deck_templates_tenant').on(t.tenantId),
}));

/** A generated deck instance — the audit/history record + the R2 pointer to the
 *  rendered .pptx the user downloads. */
export const generatedDecks = pgTable('generated_decks', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenantId:     integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  templateId:   uuid('template_id').references(() => deckTemplates.id, { onDelete: 'set null' }),
  mode:         varchar('mode', { length: 16 }).notNull().default('generative'),  // generative | fill
  quarter:      varchar('quarter', { length: 12 }),
  r2Key:        varchar('r2_key', { length: 512 }),
  status:       varchar('status', { length: 16 }).notNull().default('pending'),   // pending | ready | failed
  warningsJson: jsonb('warnings_json').notNull().default(sql`'[]'::jsonb`),
  createdBy:    varchar('created_by', { length: 36 }),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  byTenant: index('idx_generated_decks_tenant').on(t.tenantId, t.createdAt),
}));

// ---------------------------------------------------------------------------
// Product Quality / error observability (migrations 0240, 0245, 0250)
// ---------------------------------------------------------------------------

/**
 * A project's (or tenant's) error collector — the unit of error gathering. ONE
 * per project (`projectId` set; one ingest key = one embeddable snippet, serving
 * all the project's repos and every channel: native SDK, OTLP, provider webhooks).
 * A TENANT-level collector (`projectId` NULL) ingests a mixed stream and routes
 * each event to a project via [[errorMappingRules]], with `defaultProjectId` as
 * the fallback. `keyHash` authenticates keyed ingest (native/OTLP). Provider
 * webhook secrets live per-provider in [[errorCollectorIntegrations]].
 */
export const errorCollectors = pgTable('error_collectors', {
  id:               uuid('id').primaryKey().defaultRandom(),
  tenantId:         integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  /** NULL = tenant-level collector (routes via mapping rules); set = project collector. */
  projectId:        integer('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  name:             varchar('name', { length: 255 }).notNull(),
  /** SHA-256 of the bfq_* ingest key (raw key shown once at creation). */
  keyHash:          varchar('key_hash', { length: 64 }).unique(),
  /** Fallback project for a tenant-level collector when no mapping rule matches. */
  defaultProjectId: integer('default_project_id').references(() => projects.id, { onDelete: 'set null' }),
  enabled:          boolean('enabled').notNull().default(true),
  status:           varchar('status', { length: 16 }).notNull().default('active'),
  lastEventAt:      timestamp('last_event_at'),
  createdBy:        varchar('created_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  createdAt:        timestamp('created_at').notNull().defaultNow(),
  updatedAt:        timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  // One collector per project (tenant-level collectors have NULL projectId).
  uqProject: uniqueIndex('uq_error_collectors_project').on(t.tenantId, t.projectId).where(sql`project_id IS NOT NULL`),
}));

/**
 * A provider webhook integration attached to a collector (Sentry/PostHog/
 * LogRocket). `secretEnc`/`secretIv` (AES-256-GCM per-tenant) seal
 * `{ secret?, apiToken?, scope?, baseUrl? }` — the webhook HMAC secret plus any
 * pull credentials (Sentry backfill).
 */
export const errorCollectorIntegrations = pgTable('error_collector_integrations', {
  id:           uuid('id').primaryKey().defaultRandom(),
  collectorId:  uuid('collector_id').notNull().references(() => errorCollectors.id, { onDelete: 'cascade' }),
  /** 'sentry' | 'posthog' | 'logrocket'. */
  provider:     varchar('provider', { length: 32 }).notNull(),
  secretEnc:    text('secret_enc'),
  secretIv:     varchar('secret_iv', { length: 32 }),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  uqProvider: unique('uq_collector_provider').on(t.collectorId, t.provider),
}));

/**
 * An error-mapping rule for a tenant-level collector: the first rule (by priority)
 * whose `matchField` `matchOp` `matchValue` matches an inbound event routes it to
 * `projectId`. `matchField`: 'service' | 'release' | 'environment' | 'url' |
 * 'tag:<key>'. `matchOp`: 'equals' | 'contains' | 'prefix'.
 */
export const errorMappingRules = pgTable('error_mapping_rules', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenantId:     integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  collectorId:  uuid('collector_id').notNull().references(() => errorCollectors.id, { onDelete: 'cascade' }),
  matchField:   varchar('match_field', { length: 64 }).notNull(),
  matchOp:      varchar('match_op', { length: 16 }).notNull().default('equals'),
  matchValue:   varchar('match_value', { length: 255 }).notNull(),
  projectId:    integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  priority:     integer('priority').notNull().default(100),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  byCollector: index('idx_error_mapping_rules_collector').on(t.collectorId, t.priority),
}));

/**
 * A fingerprint-grouped error. One row per distinct bug; aggregates are bumped on
 * every matching event (the ingest upsert). `samplePayload` holds the latest event
 * for the dashboard; `taskId` links the fix task once "Fix with agent" runs.
 */
export const errorGroups = pgTable('error_groups', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenantId:       integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  projectId:      integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  collectorId:    uuid('collector_id').references(() => errorCollectors.id, { onDelete: 'set null' }),
  fingerprint:    varchar('fingerprint', { length: 128 }).notNull(),
  title:          varchar('title', { length: 500 }).notNull(),
  type:           varchar('type', { length: 255 }),
  culprit:        text('culprit'),
  /** 'fatal' | 'error' | 'warning' | 'info'. */
  level:          varchar('level', { length: 16 }).notNull().default('error'),
  /** 'unresolved' | 'resolved' | 'ignored' | 'fixing'. */
  status:         varchar('status', { length: 16 }).notNull().default('unresolved'),
  eventCount:     integer('event_count').notNull().default(0),
  userCount:      integer('user_count').notNull().default(0),
  firstSeen:      timestamp('first_seen').notNull().defaultNow(),
  lastSeen:       timestamp('last_seen').notNull().defaultNow(),
  release:        varchar('release', { length: 255 }),
  environment:    varchar('environment', { length: 64 }),
  samplePayload:  jsonb('sample_payload'),
  taskId:         integer('task_id').references(() => tasks.id, { onDelete: 'set null' }),
  createdAt:      timestamp('created_at').notNull().defaultNow(),
  updatedAt:      timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  uqFingerprint: unique('uq_error_groups_fingerprint').on(t.tenantId, t.projectId, t.fingerprint),
}));

/**
 * The raw, high-volume event stream feeding a group. The `(tenant_id, created_at)`
 * index backs the month-to-date sum the consumption meter (error_events) reads.
 */
export const errorEvents = pgTable('error_events', {
  id:           uuid('id').primaryKey().defaultRandom(),
  groupId:      uuid('group_id').notNull().references(() => errorGroups.id, { onDelete: 'cascade' }),
  tenantId:     integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  ts:           timestamp('ts').notNull().defaultNow(),
  release:      varchar('release', { length: 255 }),
  environment:  varchar('environment', { length: 64 }),
  userKey:      varchar('user_key', { length: 255 }),
  // Adapter that produced this event ('native' | 'otlp' | 'sentry' | 'posthog' |
  // 'logrocket') — powers the by-source volume breakdown in /api/quality/stats.
  source:       varchar('source', { length: 32 }),
  payload:      jsonb('payload'),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
});

/**
 * Outbound-fetch consumption ledger (migration 0262) — one row per Brain
 * `/fetch-url` request that hit the wire. COUNT(*) over a window is the metered
 * quantity for the `outbound_fetches` consumption meter + the abuse cap gate,
 * mirroring error_events / ingestion_usage_log.
 */
export const outboundFetchLog = pgTable('outbound_fetch_log', {
  id:        uuid('id').primaryKey().defaultRandom(),
  tenantId:  integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  url:       text('url'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

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

// ---------------------------------------------------------------------------
// Alerts — threshold alert rules on platform metrics (migration 0234).
//
// A user defines a rule (metric + comparator + threshold + window); the daily
// runAlertSweep evaluates each enabled rule by reusing the existing metric
// collectors and, when it trips (respecting cooldown), raises an alert_event and
// notifies via the shared Slack/email channels (approvalNotifier). The system
// 'eval_drift' alert always fires from runEvalDriftSweep without a rule.
// tenant+segment scoped (uuid PK) like the other planning trackers.
// ---------------------------------------------------------------------------

/** Metric keys a rule may target (kept in lockstep with metricEvaluators). */
export type AlertMetric =
  | 'token_spend_usd'
  | 'token_spend_pct_of_cap'
  | 'cost_per_merged_pr_usd'
  | 'dora_change_failure_rate'
  | 'dora_lead_time_hours'
  | 'ai_effectiveness_score'
  | 'eval_drift';

export const alerts = pgTable('alerts', {
  id:              uuid('id').primaryKey().defaultRandom(),
  tenantId:        integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:       uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  name:            varchar('name', { length: 255 }).notNull(),
  metric:          varchar('metric', { length: 40 }).notNull(),       // see AlertMetric
  comparator:      varchar('comparator', { length: 4 }).notNull(),    // gt | lt | gte | lte
  threshold:       real('threshold').notNull().default(0),
  windowDays:      integer('window_days').notNull().default(7),
  scopeKind:       varchar('scope_kind', { length: 16 }).notNull().default('tenant'), // tenant | project | team
  projectId:       integer('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  teamId:          integer('team_id').references(() => teams.id, { onDelete: 'cascade' }),
  notifySlack:     boolean('notify_slack').notNull().default(true),
  notifyEmail:     boolean('notify_email').notNull().default(true),
  enabled:         boolean('enabled').notNull().default(true),
  cooldownHours:   integer('cooldown_hours').notNull().default(24),
  lastTriggeredAt: timestamp('last_triggered_at'),
  lastEvaluatedAt: timestamp('last_evaluated_at'),
  createdBy:       varchar('created_by', { length: 36 }),
  createdAt:       timestamp('created_at').notNull().defaultNow(),
  updatedAt:       timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byTenantEnabled: index('idx_alerts_tenant_enabled').on(t.tenantId, t.enabled),
}));

/** A single firing of a rule (or a system eval-drift alert). */
export const alertEvents = pgTable('alert_events', {
  id:             uuid('id').primaryKey().defaultRandom(),
  alertId:        uuid('alert_id').references(() => alerts.id, { onDelete: 'cascade' }),
  tenantId:       integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  metric:         varchar('metric', { length: 40 }),
  observedValue:  real('observed_value'),
  threshold:      real('threshold'),
  comparator:     varchar('comparator', { length: 4 }),
  message:        text('message').notNull(),
  status:         varchar('status', { length: 16 }).notNull().default('triggered'), // triggered | acknowledged | resolved
  notifiedSlack:  boolean('notified_slack').default(false),
  notifiedEmail:  boolean('notified_email').default(false),
  acknowledgedBy: varchar('acknowledged_by', { length: 36 }),
  acknowledgedAt: timestamp('acknowledged_at'),
  createdAt:      timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  byTenantCreated: index('idx_alert_events_tenant_created').on(t.tenantId, t.createdAt),
}));

// ── Industry Benchmarking (migration 0230) ─────────────────────────────────
// Seeded reference percentiles per (industry, size_band, metric) + the tenant's
// chosen benchmark cohort. The lens maps live metric values onto these.
export const industryBenchmarks = pgTable('industry_benchmarks', {
  id:             serial('id').primaryKey(),
  industry:       varchar('industry', { length: 48 }).notNull(),
  sizeBand:       varchar('size_band', { length: 16 }).notNull(),
  metric:         varchar('metric', { length: 48 }).notNull(),
  unit:           varchar('unit', { length: 16 }),
  p10:            real('p10'),
  p25:            real('p25'),
  p50:            real('p50'),
  p75:            real('p75'),
  p90:            real('p90'),
  higherIsBetter: boolean('higher_is_better').notNull().default(true),
  source:         varchar('source', { length: 120 }),
  updatedAt:      timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  uqCohortMetric: uniqueIndex('uq_industry_benchmarks_cohort_metric').on(t.industry, t.sizeBand, t.metric),
}));

export const tenantBenchmarkProfiles = pgTable('tenant_benchmark_profiles', {
  tenantId:  integer('tenant_id').primaryKey().references(() => tenants.id, { onDelete: 'cascade' }),
  industry:  varchar('industry', { length: 48 }).notNull().default('software_saas'),
  sizeBand:  varchar('size_band', { length: 16 }).notNull().default('mid'),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ── Custom Dashboards & AI-Powered Queries (migration 0231) ─────────────────
// Saved dashboards composed of widgets over whitelisted existing metrics, plus a
// log of natural-language questions and the metric each resolved to.
export const savedDashboards = pgTable('saved_dashboards', {
  id:         serial('id').primaryKey(),
  tenantId:   integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:  uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  name:       varchar('name', { length: 160 }).notNull(),
  isDefault:  boolean('is_default').notNull().default(false),
  createdBy:  varchar('created_by', { length: 36 }),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byTenant: index('idx_saved_dashboards_tenant').on(t.tenantId),
}));

export const dashboardWidgets = pgTable('dashboard_widgets', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  dashboardId: integer('dashboard_id').notNull().references(() => savedDashboards.id, { onDelete: 'cascade' }),
  // A widget is EITHER a scalar whitelisted metric (metricKey) OR a rich registry
  // widget contributed by any surface (widgetKey). Exactly one is set.
  metricKey:   varchar('metric_key', { length: 64 }),
  widgetKey:   varchar('widget_key', { length: 96 }),
  viz:         varchar('viz', { length: 16 }).notNull().default('stat'),
  title:       varchar('title', { length: 160 }),
  config:      jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
  position:    integer('position').notNull().default(0),
}, (t) => ({
  byTenant:    index('idx_dashboard_widgets_tenant').on(t.tenantId),
  byDashboard: index('idx_dashboard_widgets_dashboard').on(t.dashboardId),
}));

// A user's personal widget pins — the registry widget ids on their /insights
// home dashboard, scoped to (tenant, user).
export const dashboardPins = pgTable('dashboard_pins', {
  id:        serial('id').primaryKey(),
  tenantId:  integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  userId:    varchar('user_id', { length: 36 }).notNull(),
  widgetKey: varchar('widget_key', { length: 96 }).notNull(),
  position:  integer('position').notNull().default(0),
  pinnedAt:  timestamp('pinned_at').notNull().defaultNow(),
}, (t) => ({
  byTenantUser: index('idx_dashboard_pins_tenant_user').on(t.tenantId, t.userId),
}));

export const savedQueries = pgTable('saved_queries', {
  id:            serial('id').primaryKey(),
  tenantId:      integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  question:      text('question').notNull(),
  matchedMetric: varchar('matched_metric', { length: 64 }),
  createdBy:     varchar('created_by', { length: 36 }),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  byTenant: index('idx_saved_queries_tenant').on(t.tenantId),
}));

// ---------------------------------------------------------------------------
// Freelance worker marketplace (0269)
//
// A freelancer (users.account_type='freelancer') publishes a for-hire profile,
// is hired across many tenants/projects via engagements, and has time measured
// from an audited activity-signal stream that resolves into billable timecards.
// ---------------------------------------------------------------------------

/** One per freelancer user: skills / resume / rate + public-or-private toggle. */
export const freelancerProfiles = pgTable('freelancer_profiles', {
  userId:                 varchar('user_id', { length: 36 }).primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  headline:               varchar('headline', { length: 200 }),
  bio:                    text('bio'),
  slug:                   varchar('slug', { length: 60 }),         // vanity alias for the public URL (/talent/:slug); unique, case-insensitive (0280)
  avatarKey:              varchar('avatar_key', { length: 300 }),  // R2 key for uploaded profile picture; served at GET /:id/avatar (0280)
  discipline:             varchar('discipline', { length: 60 }),  // developer|dba|designer|... (card role)
  skills:                 text('skills'),                          // JSON string[]
  hourlyRateCents:        integer('hourly_rate_cents'),
  currency:               varchar('currency', { length: 3 }).notNull().default('USD'),
  visibility:             varchar('visibility', { length: 10 }).notNull().default('private'), // public|private
  published:              boolean('published').notNull().default(false),
  availability:           varchar('availability', { length: 20 }).notNull().default('open'),  // open|limited|unavailable
  location:               varchar('location', { length: 120 }),
  timezone:               varchar('timezone', { length: 60 }),
  hiredVideoUserId:       varchar('hired_video_user_id', { length: 120 }),
  hiredVideoConnectionId: varchar('hired_video_connection_id', { length: 120 }),
  hiredVideoResumeId:     varchar('hired_video_resume_id', { length: 120 }),
  hiredVideoClaimUrl:     varchar('hired_video_claim_url', { length: 500 }),
  resumeKey:              varchar('resume_key', { length: 300 }),
  resumeFilename:         varchar('resume_filename', { length: 255 }),
  resumeExtract:          text('resume_extract'),                  // cached hired.video getProfile JSON
  createdAt:              timestamp('created_at').notNull().defaultNow(),
  updatedAt:              timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byPublished: index('idx_freelancer_profiles_published').on(t.published),
}));

/** Employer hires a freelancer (optionally onto a project). Hire record + the
 *  cross-tenant membership bridge. Soft-terminate via terminatedAt. */
export const freelancerEngagements = pgTable('freelancer_engagements', {
  id:                 varchar('id', { length: 36 }).primaryKey(),
  tenantId:           integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  projectId:          integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
  freelancerUserId:   varchar('freelancer_user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  status:             varchar('status', { length: 20 }).notNull().default('invited'), // invited|interviewing|active|declined|terminated
  /** Gig Marketplace (0293): how much of the employer workspace an ACTIVE engagement
   *  grants this freelancer — enforced by EngagementAccessService. Default 'project'
   *  = view + work the engaged project's board (incl. moving a ticket to In Review). */
  accessScope:        varchar('access_scope', { length: 20 }).notNull().default('project'), // project|board_readonly|tenant
  rateCents:          integer('rate_cents'),
  currency:           varchar('currency', { length: 3 }).notNull().default('USD'),
  title:              varchar('title', { length: 200 }),
  note:               text('note'),
  createdByUserId:    varchar('created_by_user_id', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  invitedAt:          timestamp('invited_at').notNull().defaultNow(),
  hiredAt:            timestamp('hired_at'),
  terminatedAt:       timestamp('terminated_at'),
  terminatedReason:   text('terminated_reason'),
  createdAt:          timestamp('created_at').notNull().defaultNow(),
  updatedAt:          timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byTenant:     index('idx_engagements_tenant').on(t.tenantId),
  byFreelancer: index('idx_engagements_freelancer').on(t.freelancerUserId),
}));

/** Raw audited "click sense" + engagement stream (portal + VSIX). Append-only. */
export const activitySignals = pgTable('activity_signals', {
  id:               bigint('id', { mode: 'number' }).primaryKey(),   // DB bigserial
  userId:           varchar('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  tenantId:         integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  engagementId:     varchar('engagement_id', { length: 36 }).references(() => freelancerEngagements.id, { onDelete: 'set null' }),
  projectId:        integer('project_id'),
  source:           varchar('source', { length: 20 }).notNull(),   // portal|vscode|agent|meeting|system
  kind:             varchar('kind', { length: 40 }).notNull(),     // nav|tool_exec|ticket_move|project_update|agent_message|agent_run|meeting|heartbeat
  ref:              varchar('ref', { length: 300 }),
  weight:           integer('weight').notNull().default(1),
  durationSeconds:  integer('duration_seconds'),
  metadata:         text('metadata'),
  sessionId:        varchar('session_id', { length: 64 }),
  occurredAt:       timestamp('occurred_at').notNull().defaultNow(),
  createdAt:        timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  byUserDay:      index('idx_signals_user_day').on(t.userId, t.occurredAt),
  byEngagement:   index('idx_signals_engagement').on(t.engagementId, t.occurredAt),
}));

/** Resolved billable blocks — "what did you do today". Editable pre-submit.
 *  Named timecardEntries (table timecard_entries) to avoid the existing per-task
 *  `time_entries`/`timeEntries` (migration 0247) — a different subsystem. */
export const timecardEntries = pgTable('timecard_entries', {
  id:            varchar('id', { length: 36 }).primaryKey(),
  engagementId:  varchar('engagement_id', { length: 36 }).notNull().references(() => freelancerEngagements.id, { onDelete: 'cascade' }),
  userId:        varchar('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  tenantId:      integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  workDate:      date('work_date').notNull(),
  minutes:       integer('minutes').notNull().default(0),
  source:        varchar('source', { length: 20 }).notNull().default('auto'), // auto|manual|meeting
  description:   text('description'),
  billable:      boolean('billable').notNull().default(true),
  resolvedFrom:  text('resolved_from'),   // JSON audit
  timecardId:    varchar('timecard_id', { length: 36 }),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byEngagementDate: index('idx_timecard_entries_engagement_date').on(t.engagementId, t.workDate),
  byCard:           index('idx_timecard_entries_card').on(t.timecardId),
}));

/** Approvable per-engagement period rollup. */
export const timecards = pgTable('timecards', {
  id:                 varchar('id', { length: 36 }).primaryKey(),
  engagementId:       varchar('engagement_id', { length: 36 }).notNull().references(() => freelancerEngagements.id, { onDelete: 'cascade' }),
  userId:             varchar('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  tenantId:           integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  periodStart:        date('period_start').notNull(),
  periodEnd:          date('period_end').notNull(),
  status:             varchar('status', { length: 20 }).notNull().default('draft'), // draft|submitted|approved|rejected|paid
  totalMinutes:       integer('total_minutes').notNull().default(0),
  billableMinutes:    integer('billable_minutes').notNull().default(0),
  rateCents:          integer('rate_cents'),
  currency:           varchar('currency', { length: 3 }).notNull().default('USD'),
  amountCents:        integer('amount_cents').notNull().default(0),
  submittedAt:        timestamp('submitted_at'),
  approvedAt:         timestamp('approved_at'),
  approvedByUserId:   varchar('approved_by_user_id', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  rejectReason:       text('reject_reason'),
  createdAt:          timestamp('created_at').notNull().defaultNow(),
  updatedAt:          timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byEngagement: index('idx_timecards_engagement').on(t.engagementId),
}));

// ---------------------------------------------------------------------------
// Freelance marketplace — two-sided (0273): job postings + proposals (bidding),
// reviews/reputation, invoices/payment status, in-app notifications.
// ---------------------------------------------------------------------------

/** An employer posts work freelancers can BID on (distinct from a direct hire). */
export const jobPostings = pgTable('job_postings', {
  id:               varchar('id', { length: 36 }).primaryKey(),
  tenantId:         integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  projectId:        integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
  title:            varchar('title', { length: 200 }).notNull(),
  description:      text('description'),
  discipline:       varchar('discipline', { length: 60 }),
  skills:           text('skills'),                        // JSON string[]
  rateMinCents:     integer('rate_min_cents'),
  rateMaxCents:     integer('rate_max_cents'),
  currency:         varchar('currency', { length: 3 }).notNull().default('USD'),
  status:           varchar('status', { length: 20 }).notNull().default('open'),      // open|closed|filled
  visibility:       varchar('visibility', { length: 10 }).notNull().default('public'), // public|private
  /** Gig Marketplace (0293): the work item this gig was published FROM (one-click
   *  "Publish to Marketplace"), the gig shape, the billing/engagement shape, and the
   *  free-text acceptance criteria a proposal is AI-evaluated against. */
  sourceTicketId:   integer('source_ticket_id').references(() => tasks.id, { onDelete: 'set null' }),
  postingType:      varchar('posting_type', { length: 20 }).notNull().default('project_bid'), // project_bid|design|fte
  engagementType:   varchar('engagement_type', { length: 20 }),                        // fixed_bid|hourly|fte
  requirements:     text('requirements'),
  createdByUserId:  varchar('created_by_user_id', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  closedAt:         timestamp('closed_at'),
  createdAt:        timestamp('created_at').notNull().defaultNow(),
  updatedAt:        timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byStatus: index('idx_job_postings_open').on(t.status),
  byTenant: index('idx_job_postings_tenant').on(t.tenantId),
}));

/** A freelancer's bid on a job. One live proposal per (job, freelancer). */
export const jobProposals = pgTable('job_proposals', {
  id:                varchar('id', { length: 36 }).primaryKey(),
  jobId:             varchar('job_id', { length: 36 }).notNull().references(() => jobPostings.id, { onDelete: 'cascade' }),
  freelancerUserId:  varchar('freelancer_user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  coverNote:         text('cover_note'),
  rateCents:         integer('rate_cents'),
  currency:          varchar('currency', { length: 3 }).notNull().default('USD'),
  status:            varchar('status', { length: 20 }).notNull().default('submitted'), // submitted|shortlisted|accepted|declined|withdrawn
  /** Gig Marketplace (0293): 0..100 cached overall from the latest AI proposal
   *  evaluation (list display), and the courteous decline message shown to the
   *  candidate when they aren't selected. */
  lastEvalOverall:   integer('last_eval_overall'),
  declineReason:     text('decline_reason'),
  createdAt:         timestamp('created_at').notNull().defaultNow(),
  updatedAt:         timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byFreelancer: index('idx_proposals_freelancer').on(t.freelancerUserId),
}));

/** Polymorphic AI evaluation of a proposal (a bid) OR a deliverable proposal —
 *  the LLM-as-judge (semanticEval) verdict scoring it against the posting's
 *  requirements/acceptance criteria. History-preserving (one row per eval run). */
export const proposalEvaluations = pgTable('proposal_evaluations', {
  id:                 varchar('id', { length: 36 }).primaryKey(),
  tenantId:           integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  subjectType:        varchar('subject_type', { length: 20 }).notNull(),   // job_proposal|deliverable
  subjectId:          varchar('subject_id', { length: 36 }).notNull(),
  jobId:              varchar('job_id', { length: 36 }).references(() => jobPostings.id, { onDelete: 'set null' }),
  faithfulness:       real('faithfulness'),
  answerRelevance:    real('answer_relevance'),
  contextRelevance:   real('context_relevance'),
  hallucinationRate:  real('hallucination_rate'),
  overall:            real('overall').notNull().default(0),                // 0..1 composite
  method:             varchar('method', { length: 10 }).notNull().default('lexical'), // llm|lexical
  summary:            text('summary'),
  evaluatedByUserId:  varchar('evaluated_by_user_id', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  createdAt:          timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  bySubject: index('idx_proposal_evals_subject').on(t.subjectType, t.subjectId),
  byTenant:  index('idx_proposal_evals_tenant').on(t.tenantId, t.createdAt),
}));

/** A hired worker "presents a proposal" against the published scope — tied to the
 *  engagement (+ optional ticket / posting). AI-evaluable via proposalEvaluations. */
export const deliverableProposals = pgTable('deliverable_proposals', {
  id:               varchar('id', { length: 36 }).primaryKey(),
  tenantId:         integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  engagementId:     varchar('engagement_id', { length: 36 }).notNull().references(() => freelancerEngagements.id, { onDelete: 'cascade' }),
  ticketId:         integer('ticket_id').references(() => tasks.id, { onDelete: 'set null' }),
  jobId:            varchar('job_id', { length: 36 }).references(() => jobPostings.id, { onDelete: 'set null' }),
  authorUserId:     varchar('author_user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  title:            varchar('title', { length: 200 }).notNull(),
  body:             text('body'),
  status:           varchar('status', { length: 20 }).notNull().default('submitted'), // submitted|accepted|changes_requested|withdrawn
  lastEvalOverall:  integer('last_eval_overall'),
  createdAt:        timestamp('created_at').notNull().defaultNow(),
  updatedAt:        timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byEngagement: index('idx_deliverable_proposals_engagement').on(t.engagementId),
  byTenant:     index('idx_deliverable_proposals_tenant').on(t.tenantId, t.createdAt),
}));

/** Employer's rating of a freelancer for an engagement (reputation). One per engagement. */
export const freelancerReviews = pgTable('freelancer_reviews', {
  id:                varchar('id', { length: 36 }).primaryKey(),
  engagementId:      varchar('engagement_id', { length: 36 }).notNull().references(() => freelancerEngagements.id, { onDelete: 'cascade' }),
  tenantId:          integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  freelancerUserId:  varchar('freelancer_user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  reviewerUserId:    varchar('reviewer_user_id', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  rating:            integer('rating').notNull(),   // 1..5
  comment:           text('comment'),
  createdAt:         timestamp('created_at').notNull().defaultNow(),
  updatedAt:         timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byFreelancer: index('idx_reviews_freelancer').on(t.freelancerUserId),
}));

/** Invoice generated on timecard approval; carries payment status. One per timecard. */
export const freelancerInvoices = pgTable('freelancer_invoices', {
  id:                varchar('id', { length: 36 }).primaryKey(),
  timecardId:        varchar('timecard_id', { length: 36 }).notNull().references(() => timecards.id, { onDelete: 'cascade' }),
  engagementId:      varchar('engagement_id', { length: 36 }).notNull().references(() => freelancerEngagements.id, { onDelete: 'cascade' }),
  tenantId:          integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  freelancerUserId:  varchar('freelancer_user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  amountCents:       integer('amount_cents').notNull().default(0),
  currency:          varchar('currency', { length: 3 }).notNull().default('USD'),
  status:            varchar('status', { length: 20 }).notNull().default('pending'), // pending|paid|void
  externalRef:       varchar('external_ref', { length: 200 }),
  issuedAt:          timestamp('issued_at').notNull().defaultNow(),
  paidAt:            timestamp('paid_at'),
  createdAt:         timestamp('created_at').notNull().defaultNow(),
  updatedAt:         timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byTenant:     index('idx_invoices_tenant').on(t.tenantId),
  byFreelancer: index('idx_invoices_freelancer').on(t.freelancerUserId),
}));

/** In-app notifications for both sides of the marketplace. */
export const freelancerNotifications = pgTable('freelancer_notifications', {
  id:         bigint('id', { mode: 'number' }).primaryKey(),   // DB bigserial
  userId:     varchar('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  tenantId:   integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  kind:       varchar('kind', { length: 40 }).notNull(),
  title:      varchar('title', { length: 200 }).notNull(),
  body:       text('body'),
  ref:        varchar('ref', { length: 200 }),
  readAt:     timestamp('read_at'),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  byUser: index('idx_notifications_user').on(t.userId, t.createdAt),
}));

// ---------------------------------------------------------------------------
// FACTS library — structured (subject, predicate, object) triples with
// provenance. Powers /api/facts + the /facts page; recallable by agent tooling.
// Migration 0300. project_id NULL → tenant-global fact; set → project-scoped.
// ---------------------------------------------------------------------------
export const facts = pgTable('facts', {
  id:         uuid('id').primaryKey().defaultRandom(),
  tenantId:   integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  projectId:  integer('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  subject:    varchar('subject', { length: 255 }).notNull(),
  predicate:  varchar('predicate', { length: 255 }).notNull(),
  object:     text('object').notNull(),
  source:     varchar('source', { length: 255 }),
  confidence: real('confidence'),
  createdBy:  varchar('created_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('idx_facts_tenant_updated').on(t.tenantId, t.updatedAt),
  index('idx_facts_tenant_subject').on(t.tenantId, t.subject),
  index('idx_facts_tenant_predicate').on(t.tenantId, t.predicate),
  index('idx_facts_tenant_project').on(t.tenantId, t.projectId),
]);

// ---------------------------------------------------------------------------
// RFP / RFQ Response (PRD 15, migration 0335) — pre-sales proposal generation.
// A request captures the asking business's brand + requirements and is either
// greenfield or grounded on an existing project; a response is the co-branded
// proposal (capability roster + P&L + phase plan + risks + branded document).
// ---------------------------------------------------------------------------
export const rfpRequests = pgTable('rfp_requests', {
  id:               uuid('id').primaryKey().defaultRandom(),
  tenantId:         integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:        uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  title:            varchar('title', { length: 255 }).notNull(),
  requesterOrgName: varchar('requester_org_name', { length: 255 }),
  requesterBrand:   jsonb('requester_brand'),                 // BrandPalette of the asking business
  requirements:     text('requirements'),
  sourceMode:       varchar('source_mode', { length: 16 }).notNull().default('new').$type<'new' | 'existing_project'>(),
  basedOnProjectId: integer('based_on_project_id').references(() => projects.id, { onDelete: 'set null' }),
  marginPct:        real('margin_pct'),
  marketingPct:     real('marketing_pct'),
  contingencyPct:   real('contingency_pct'),
  dueDate:          timestamp('due_date', { withTimezone: true }),
  status:           varchar('status', { length: 24 }).notNull().default('draft').$type<'draft' | 'analyzing' | 'ready' | 'submitted'>(),
  createdBy:        varchar('created_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('idx_rfp_requests_tenant').on(t.tenantId, t.updatedAt),
  index('idx_rfp_requests_project').on(t.basedOnProjectId),
]);

export const rfpResponses = pgTable('rfp_responses', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  tenantId:           integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:          uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  requestId:          uuid('request_id').notNull().references(() => rfpRequests.id, { onDelete: 'cascade' }),
  projectId:          integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
  status:             varchar('status', { length: 24 }).notNull().default('draft').$type<'draft' | 'ready' | 'submitted'>(),
  body:               jsonb('body'),                          // RfpResponseBody (typed in application/rfp/types.ts)
  docHtml:            text('doc_html'),
  quotedPriceUsdCents: integer('quoted_price_usd_cents'),
  marginPct:          real('margin_pct'),
  scanRefreshed:      boolean('scan_refreshed').notNull().default(false),
  generatedBy:        jsonb('generated_by'),                  // { cto, productOwner } agent refs
  createdBy:          varchar('created_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  createdAt:          timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:          timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('idx_rfp_responses_tenant').on(t.tenantId, t.updatedAt),
  index('idx_rfp_responses_request').on(t.requestId, t.createdAt),
  index('idx_rfp_responses_project').on(t.projectId),
]);

// ---------------------------------------------------------------------------
// Generic, timestamped catalog adoption event log (skill | persona | prompt).
// Feeds the over-time series in /api/catalog-analytics. Append-only. Mig 0301.
// ---------------------------------------------------------------------------
export const catalogAdoptionEvents = pgTable('catalog_adoption_events', {
  id:         uuid('id').primaryKey().defaultRandom(),
  tenantId:   integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  kind:       varchar('kind', { length: 16 }).notNull(),
  itemId:     varchar('item_id', { length: 128 }).notNull(),
  itemName:   varchar('item_name', { length: 255 }),
  eventType:  varchar('event_type', { length: 16 }).notNull().default('install'),
  actorId:    varchar('actor_id', { length: 64 }),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('idx_catalog_events_tenant_kind_time').on(t.tenantId, t.kind, t.createdAt),
  index('idx_catalog_events_tenant_kind_item').on(t.tenantId, t.kind, t.itemId),
]);

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

// ---------------------------------------------------------------------------
// Annual-calendar cadence — periodic lens review snapshots (migration 0309).
// A frozen point-in-time capture of an insight lens for a review period,
// written by the cron sweep; (tenant,lens,period) is the upsert target.
// ---------------------------------------------------------------------------
export const lensSnapshots = pgTable('lens_snapshots', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:   uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  lens:        varchar('lens', { length: 32 }).notNull(),
  period:      varchar('period', { length: 16 }).notNull(),
  payload:     jsonb('payload').notNull().default({}),
  generatedAt: timestamp('generated_at').notNull().defaultNow(),
}, (t) => [
  unique('uq_lens_snapshot').on(t.tenantId, t.lens, t.period),
]);

// ---------------------------------------------------------------------------
// EMP-9 — delay root-cause taxonomy (migration 0315). One reason per task.
// ---------------------------------------------------------------------------
export const delayReasons = pgTable('delay_reasons', {
  id:         uuid('id').primaryKey().defaultRandom(),
  tenantId:   integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:  uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  taskId:     integer('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  reasonCode: varchar('reason_code', { length: 24 }).notNull(),
  notes:      text('notes'),
  createdBy:  varchar('created_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  uqTask: uniqueIndex('uq_delay_reasons_task').on(t.taskId),
}));

// ---------------------------------------------------------------------------
// EMP-15 — internal sentiment / pulse survey (migration 0317).
// ---------------------------------------------------------------------------
export const pulseSurveys = pgTable('pulse_surveys', {
  id:        uuid('id').primaryKey().defaultRandom(),
  tenantId:  integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId: uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  question:  varchar('question', { length: 255 }).notNull(),
  scale:     integer('scale').notNull().default(5),
  active:    boolean('active').notNull().default(true),
  createdBy: varchar('created_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  closedAt:  timestamp('closed_at'),
});

export const pulseResponses = pgTable('pulse_responses', {
  id:        uuid('id').primaryKey().defaultRandom(),
  surveyId:  uuid('survey_id').notNull().references(() => pulseSurveys.id, { onDelete: 'cascade' }),
  tenantId:  integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId: uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  userId:    varchar('user_id', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  score:     integer('score').notNull(),
  comment:   text('comment'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  uqUser: uniqueIndex('uq_pulse_response_user').on(t.surveyId, t.userId),
}));

// ---------------------------------------------------------------------------
// EMP-16 — manager coaching notes attached to a workforce member (mig 0311).
// Polymorphic (member_kind, member_ref) identity; no FK on member_ref.
// ---------------------------------------------------------------------------
export const coachingNotes = pgTable('coaching_notes', {
  id:         serial('id').primaryKey(),
  tenantId:   integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:  uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  memberKind: varchar('member_kind', { length: 16 }).notNull(),
  memberRef:  varchar('member_ref', { length: 64 }).notNull(),
  note:       text('note').notNull(),
  authorId:   varchar('author_id', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('idx_coaching_notes_member').on(t.tenantId, t.memberKind, t.memberRef),
]);

// ---------------------------------------------------------------------------
// Dismissed forecast anomalies (LENS forecast, migration 0305). A manager mutes
// a known/explained z-score outlier so it stops surfacing on the forecast lens.
// One row per (tenant, metric, point_day); additive (no rows == all shown).
// ---------------------------------------------------------------------------
export const forecastAnomalyAcks = pgTable('forecast_anomaly_acks', {
  id:        uuid('id').primaryKey().defaultRandom(),
  tenantId:  integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId: uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  metric:    varchar('metric', { length: 24 }).notNull(),
  pointDay:  varchar('point_day', { length: 10 }).notNull(),
  note:      text('note'),
  ackedBy:   varchar('acked_by', { length: 36 }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  uqAck:    uniqueIndex('uq_forecast_anomaly_ack').on(t.tenantId, t.metric, t.pointDay),
  byMetric: index('idx_forecast_anomaly_ack_metric').on(t.tenantId, t.metric),
}));

// ---------------------------------------------------------------------------
// Policy packs (migration 0348) — the authoring store behind `PolicyGate`
// enforcement. `evaluatePolicyGate` was already hard-enforced at three tool-call
// seams, but nothing wrote gates; these two tables are that missing writer.
//
// Scoping is NULL-as-wildcard: a pack with `projectId`/`agentRef` NULL applies
// tenant-wide, so the resolver is one predicate rather than a scope discriminator.
// `policyGates` mirrors the `PolicyGate` wire type field-for-field (gateKey = the
// wire `id`), so resolution is a projection, not a translation.
// ---------------------------------------------------------------------------
export const policyPacks = pgTable('policy_packs', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:   uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  name:        varchar('name', { length: 200 }).notNull(),
  description: text('description'),
  enabled:     boolean('enabled').notNull().default(true),
  /** NULL = every project. */
  projectId:   integer('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  /** NULL = every agent. */
  agentRef:    varchar('agent_ref', { length: 128 }),
  createdBy:   varchar('created_by', { length: 64 }),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_policy_packs_tenant').on(t.tenantId, t.enabled),
  index('idx_policy_packs_project').on(t.tenantId, t.projectId),
]);

export const policyGates = pgTable('policy_gates', {
  id:        uuid('id').primaryKey().defaultRandom(),
  tenantId:  integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  packId:    uuid('pack_id').notNull().references(() => policyPacks.id, { onDelete: 'cascade' }),
  /** The `PolicyGate.id` on the wire — echoed back in a block/approval decision. */
  gateKey:   varchar('gate_key', { length: 128 }).notNull(),
  /** NULL or '*' governs EVERY tool (how a broad deny posture is authored). */
  tool:      varchar('tool', { length: 128 }),
  effect:    varchar('effect', { length: 20 }).notNull(),
  directive: text('directive'),
  reason:    text('reason'),
  position:  integer('position').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_policy_gate_key').on(t.packId, t.gateKey),
  index('idx_policy_gates_pack').on(t.packId, t.position),
]);

// ---------------------------------------------------------------------------
// Execution rollback (0350) — the undo log for autonomous runs
// ---------------------------------------------------------------------------

/**
 * Audit + undo log for a cloud run's REPOSITORY artifacts. One row per run that
 * committed to a ticket branch. Modelled on {@link contributorMerges} (0205): the
 * `undoPayload` snapshots enough state (the paths written, the commit shas, the
 * branch/base, the PR) for a later revert to prove nothing moved underneath it,
 * `status` flips exactly once, and `revertedAt` stamps the flip.
 *
 * `executionId` is ON DELETE SET NULL on purpose — the record of what a run did to
 * a repo must outlive the run row, and a null id is precisely the "a participant
 * was hard-deleted" condition the revert refuses on.
 */
export const executionRollbacks = pgTable('execution_rollbacks', {
  id:               uuid('id').primaryKey().defaultRandom(),
  tenantId:         integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:        uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  projectId:        integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
  taskId:           integer('task_id').references(() => tasks.id, { onDelete: 'set null' }),
  executionId:      integer('execution_id').references(() => executions.id, { onDelete: 'set null' }),
  repoId:           uuid('repo_id').references(() => projectRepositories.id, { onDelete: 'set null' }),
  provider:         varchar('provider', { length: 16 }),
  branchName:       varchar('branch_name', { length: 255 }),
  baseBranch:       varchar('base_branch', { length: 255 }),
  prRowId:          uuid('pr_row_id').references(() => pullRequests.id, { onDelete: 'set null' }),
  undoPayload:      jsonb('undo_payload'),
  /** 'active' | 'reverted' | 'torn_down' | 'refused' | 'revert_pr' (a revert pull
   *  request is open against the base — the undo is proposed, not yet applied) */
  status:           varchar('status', { length: 16 }).notNull().default('active'),
  refusalCode:      varchar('refusal_code', { length: 32 }),
  refusalReason:    text('refusal_reason'),
  revertedByUserId: varchar('reverted_by_user_id', { length: 36 }),
  createdAt:        timestamp('created_at').notNull().defaultNow(),
  revertedAt:       timestamp('reverted_at'),
}, (t) => [
  index('idx_execution_rollbacks_execution').on(t.executionId),
  index('idx_execution_rollbacks_tenant_status').on(t.tenantId, t.status),
  index('idx_execution_rollbacks_task').on(t.taskId),
]);

// ---------------------------------------------------------------------------
// Product Feedback collection (migration 0354)
// ---------------------------------------------------------------------------

/**
 * A project's feedback collector — the human-input twin of [[errorCollectors]].
 * ONE per project (one ingest key = one embeddable snippet), so any application
 * carrying the snippet can gather feature requests, bug reports and ideas from
 * its own users. `keyHash` authenticates the public snippet POST; `dailyLimit`
 * is the abuse ceiling on an endpoint that opens TICKETS.
 */
export const feedbackCollectors = pgTable('feedback_collectors', {
  id:               uuid('id').primaryKey().defaultRandom(),
  tenantId:         integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  projectId:        integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name:             varchar('name', { length: 255 }).notNull(),
  /** SHA-256 of the bff_* ingest key (raw key shown once at creation). */
  keyHash:          varchar('key_hash', { length: 64 }).unique(),
  enabled:          boolean('enabled').notNull().default(true),
  /** Open a backlog ticket per submission (off = record + triage only). */
  autoCreateTask:   boolean('auto_create_task').notNull().default(true),
  /** Submissions accepted from this collector per rolling 24h. */
  dailyLimit:       integer('daily_limit').notNull().default(100),
  /** '*' or a comma-separated origin allow-list the snippet may post from. */
  allowedOrigins:   text('allowed_origins').notNull().default('*'),
  lastSubmissionAt: timestamp('last_submission_at'),
  createdBy:        varchar('created_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  createdAt:        timestamp('created_at').notNull().defaultNow(),
  updatedAt:        timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  // One collector per project — a project's feedback has a single front door.
  uqProject: uniqueIndex('uq_feedback_collectors_project').on(t.tenantId, t.projectId),
}));

/**
 * A single feedback request and its link to the backlog ticket it opened.
 * `collectorId` is NULL for an IN-APP submission (the signed-in right-edge
 * feedback panel), which the session authenticates and which needs no key.
 * `fingerprint` collapses a repeat/double submit onto the existing request.
 */
export const feedbackSubmissions = pgTable('feedback_submissions', {
  id:              uuid('id').primaryKey().defaultRandom(),
  tenantId:        integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  projectId:       integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  collectorId:     uuid('collector_id').references(() => feedbackCollectors.id, { onDelete: 'set null' }),
  /** 'feature' | 'bug' | 'idea' | 'other'. */
  kind:            varchar('kind', { length: 16 }).notNull().default('feature'),
  title:           varchar('title', { length: 300 }).notNull(),
  body:            text('body').notNull(),
  /** 'new' | 'approved' | 'declined' — approval is the human gate on execution. */
  status:          varchar('status', { length: 16 }).notNull().default('new'),
  submitterUserId: varchar('submitter_user_id', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  submitterEmail:  varchar('submitter_email', { length: 255 }),
  submitterName:   varchar('submitter_name', { length: 255 }),
  pageUrl:         text('page_url'),
  userAgent:       text('user_agent'),
  appVersion:      varchar('app_version', { length: 64 }),
  context:         jsonb('context'),
  /** SHA-256 of kind+title+body — the duplicate-collapse key. */
  fingerprint:     varchar('fingerprint', { length: 128 }).notNull(),
  taskId:          integer('task_id').references(() => tasks.id, { onDelete: 'set null' }),
  reviewedBy:      varchar('reviewed_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  reviewedAt:      timestamp('reviewed_at'),
  createdAt:       timestamp('created_at').notNull().defaultNow(),
  updatedAt:       timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byProject:     index('idx_feedback_submissions_project').on(t.projectId, t.createdAt),
  byTenant:      index('idx_feedback_submissions_tenant_status').on(t.tenantId, t.status, t.createdAt),
  byCollector:   index('idx_feedback_submissions_collector').on(t.collectorId, t.createdAt),
  byFingerprint: index('idx_feedback_submissions_fingerprint').on(t.projectId, t.fingerprint),
}));
