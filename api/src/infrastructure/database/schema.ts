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
 * Unified chats: ide_project_chats (origin + optional projectId). Tasks link projects to agentHosts/executions.
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
  'task', 'epic',
]);

export const tenantStatusEnum = pgEnum('tenant_status', [
  'active', 'suspended', 'archived',
]);

export const tenantRoleEnum = pgEnum('tenant_role', [
  'owner', 'manager', 'developer', 'viewer',
]);

export const tenantPlanEnum = pgEnum('tenant_plan', [
  'free', 'pro', 'teams',
]);

export const tenantBillingCycleEnum = pgEnum('tenant_billing_cycle', [
  'monthly', 'yearly',
]);

export const tenantBillingStatusEnum = pgEnum('tenant_billing_status', [
  'none', 'pending', 'active', 'past_due', 'cancelled',
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

export const auditEventTypeEnum = pgEnum('audit_event_type', [
  'user_registered', 'user_login',
  'task_submitted', 'task_cancelled',
  'execution_started', 'execution_completed', 'execution_failed',
  'agent_registered',
  'member_added', 'member_removed',
  'project_created', 'project_updated',
  'task_created', 'task_updated',
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
  avatarUrl:     varchar('avatar_url', { length: 500 }),
  bio:           text('bio'),
  passwordHash:  varchar('password_hash', { length: 255 }),
  mfaEnabled:    boolean('mfa_enabled').notNull().default(false),
  mfaSecretEnc:  text('mfa_secret_enc'),
  mfaTempSecretEnc: text('mfa_temp_secret_enc'),
  mfaTempExpiresAt: timestamp('mfa_temp_expires_at'),
  mfaEnabledAt:  timestamp('mfa_enabled_at'),
  mfaRecoveryGeneratedAt: timestamp('mfa_recovery_generated_at'),
  mfaLastVerifiedAt: timestamp('mfa_last_verified_at'),
  isSuperadmin:           boolean('is_superadmin').notNull().default(false),
  isSuspended:            boolean('is_suspended').notNull().default(false),
  sessionVersion:         integer('session_version').notNull().default(0),
  onboardingCompletedAt:  timestamp('onboarding_completed_at'),
  userIntent:             text('user_intent'), // JSON array of intent strings, set during onboarding
  createdAt:              timestamp('created_at').notNull().defaultNow(),
  updatedAt:              timestamp('updated_at').notNull().defaultNow(),
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
  createdAt:        timestamp('created_at').notNull().defaultNow(),
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
  plan:                   tenantPlanEnum('plan').notNull().default('free'),
  billingCycle:           tenantBillingCycleEnum('billing_cycle'),
  billingStatus:          tenantBillingStatusEnum('billing_status').notNull().default('none'),
  billingEmail:           varchar('billing_email', { length: 255 }),
  billingPaymentBrand:    varchar('billing_payment_brand', { length: 50 }),
  billingPaymentLast4:    varchar('billing_payment_last4', { length: 4 }),
  billingUpdatedAt:       timestamp('billing_updated_at'),
  externalCustomerId:     varchar('external_customer_id', { length: 255 }),
  externalSubscriptionId: varchar('external_subscription_id', { length: 255 }),
  seatCount:              integer('seat_count'),
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
  // Segment tier / identity federation (migration 0054).
  kind:                   tenantKindEnum('kind').notNull().default('direct'),
  idpIssuer:              varchar('idp_issuer', { length: 500 }),
  isolationMode:          tenantIsolationModeEnum('isolation_mode').notNull().default('single'),
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
  createdAt:       timestamp('created_at').notNull().defaultNow(),
  updatedAt:       timestamp('updated_at').notNull().defaultNow(),
});

/**
 * Subdomain hosting for IDE (Designer) projects — a published app served at
 * {subdomain}.apps.builderforce.ai. One row per project (project_id unique);
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
  startDate:         timestamp('start_date'),
  dueDate:           timestamp('due_date'),
  persona:           varchar('persona', { length: 50 }),
  /** Origin board provider label for tickets synced from an external board. */
  source:            varchar('source', { length: 24 }),
  // PRD/spec link moved to the task_specs junction (0098): a task references 1..N
  // project PRDs (one optional primary) — see `taskSpecs` below.
  archived:          boolean('archived').notNull().default(false),
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
  createdAt:         timestamp('created_at').notNull().defaultNow(),
  updatedAt:         timestamp('updated_at').notNull().defaultNow(),
});

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

// Web Push subscriptions — one row per browser/device that opted in to OS-level
// notifications (currently: "a new app version deployed"). The deploy hook
// (POST /api/push/notify-deploy) fans out to every row; dead endpoints (404/410
// from the push service) are pruned on send. endpoint is unique so a re-subscribe
// from the same browser upserts rather than duplicating.
export const pushSubscriptions = pgTable('push_subscriptions', {
  id:             serial('id').primaryKey(),
  tenantId:       integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  userId:         varchar('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  endpoint:       text('endpoint').notNull().unique(),
  p256dh:         text('p256dh').notNull(), // client public key (base64url)
  auth:           text('auth').notNull(),   // client auth secret (base64url)
  userAgent:      varchar('user_agent', { length: 512 }),
  createdAt:      timestamp('created_at').notNull().defaultNow(),
  lastNotifiedAt: timestamp('last_notified_at'),
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

export const auditEvents = pgTable('audit_events', {
  id:           serial('id').primaryKey(),
  tenantId:     integer('tenant_id').references(() => tenants.id),
  userId:       varchar('user_id', { length: 36 }),
  eventType:    auditEventTypeEnum('event_type').notNull(),
  resourceType: varchar('resource_type', { length: 100 }),
  resourceId:   varchar('resource_id', { length: 100 }),
  metadata:     text('metadata'),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
});

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
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
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
  triggerType:   varchar('trigger_type', { length: 32 }).notNull(),  // schedule|webhook|rss|inbound-email
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
// Brain chats (legacy) — superseded by ide_project_chats for the product flow:
// Brain Storm → Project → IDE or Tasks/Workforce. Kept for reference only.
// ---------------------------------------------------------------------------

export const brainChats = pgTable('brain_chats', {
  id:         serial('id').primaryKey(),
  tenantId:   integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId: uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),  // DB NOT NULL via trigger (0056); optional in TS so single-mode writes need no change
  userId:     varchar('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  projectId:  integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
  title:      varchar('title', { length: 500 }).notNull().default('New chat'),
  isArchived: boolean('is_archived').notNull().default(false),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
});

export const brainMessages = pgTable('brain_messages', {
  id:        serial('id').primaryKey(),
  chatId:    integer('chat_id').notNull().references(() => brainChats.id, { onDelete: 'cascade' }),
  role:      varchar('role', { length: 16 }).notNull(),  // 'user' | 'assistant' | 'system'
  content:   text('content').notNull().default(''),
  metadata:  text('metadata'),  // JSON string (attachments, model info, etc.)
  seq:       integer('seq').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Chat memories — compressed summaries of individual brain chats
// ---------------------------------------------------------------------------

export const chatMemories = pgTable('chat_memories', {
  id:             serial('id').primaryKey(),
  tenantId:       integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId: uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),  // DB NOT NULL via trigger (0056); optional in TS so single-mode writes need no change
  chatId:         integer('chat_id').references(() => brainChats.id, { onDelete: 'cascade' }).unique(),
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
// Project chats (unified) — Brain Storm, IDE, and project-level chat.
// origin = 'brainstorm' | 'ide' | 'project' tells the page which tools/actions to load.
// ---------------------------------------------------------------------------

export const ideProjectChats = pgTable('ide_project_chats', {
  id:        serial('id').primaryKey(),
  projectId: integer('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  tenantId:  integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId: uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),  // DB NOT NULL via trigger (0056); optional in TS so single-mode writes need no change
  userId:    varchar('user_id', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  origin:     varchar('origin', { length: 32 }).notNull().default('ide'),
  title:      varchar('title', { length: 500 }).notNull().default('New chat'),
  summary:    text('summary'),
  isArchived: boolean('is_archived').notNull().default(false),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
});

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

export const ideProjectChatMessages = pgTable('ide_project_chat_messages', {
  id:        serial('id').primaryKey(),
  chatId:    integer('chat_id').notNull().references(() => ideProjectChats.id, { onDelete: 'cascade' }),
  role:      varchar('role', { length: 16 }).notNull(),
  content:   text('content').notNull().default(''),
  metadata:  text('metadata'),
  seq:       integer('seq').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

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

// ===========================================================================
// PHASE 6 — Dev Analytics & Team Intelligence (DevDynamics)
// ===========================================================================

// ---------------------------------------------------------------------------
// 6a — Integration providers + credentials
// ---------------------------------------------------------------------------

export const integrationProviderEnum = pgEnum('integration_provider', [
  'github', 'gitlab', 'bitbucket', 'jira', 'confluence', 'freshservice', 'rally', 'freshworks',
  'google_calendar',
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
  avatarUrl:     varchar('avatar_url', { length: 500 }),
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
  avatarUrl:     varchar('avatar_url', { length: 500 }),
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
  'standup', 'code_review', 'project_status', 'executive_summary',
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

export const productReleases = pgTable('product_releases', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:   uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  name:        varchar('name', { length: 255 }).notNull(),
  version:     varchar('version', { length: 50 }),
  releaseDate: timestamp('release_date'),
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
  /** @deprecated Inert since migration 0084 — autonomy is now driven by lane
   *  agents + action rules (lane.gate 'auto' vs 'human'), not a board toggle.
   *  Kept (defaulted true) until all readers are gone; see Gap Register. */
  autonomous:           boolean('autonomous').notNull().default(true),
  maxConcurrentTickets: integer('max_concurrent_tickets').notNull().default(5),
  needsAttentionLane:   varchar('needs_attention_lane', { length: 120 }).notNull().default('needs-attention'),
  /** Standup turn-timer behaviour for this board's ceremonies (migration 0119):
   *  'facilitator' = manual Next advances the speaker; 'timeboxed' = each speaker
   *  gets `standupTurnSeconds` then auto-advances. Snapshotted onto a session at start. */
  standupTurnMode:      varchar('standup_turn_mode', { length: 16 }).notNull().default('facilitator'),
  standupTurnSeconds:   integer('standup_turn_seconds').notNull().default(90),
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
  buildStatus:       varchar('build_status', { length: 16 }), // null|pending|success|failure post-merge build (0107)
  createdAt:         timestamp('created_at').notNull().defaultNow(),
  updatedAt:         timestamp('updated_at').notNull().defaultNow(),
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
