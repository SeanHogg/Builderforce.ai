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
  externalCustomerId:     varchar('external_customer_id', { length: 255 }),
  externalSubscriptionId: varchar('external_subscription_id', { length: 255 }),
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
  /** Feature sign tag (0261) — the feature's overall development and release
   *  status. One of: SHIPPED, IN_PROGRESS, NOT_STARTED, BROKEN. */
  featureSign:       varchar('feature_sign', { length: 24 }).notNull().default('NOT_STARTED'),
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
