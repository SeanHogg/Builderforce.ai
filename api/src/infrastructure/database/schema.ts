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
  unique,
} from 'drizzle-orm/pg-core';

/**
 * Data model aligns with product flow (see README "Data model & API"):
 * Brain Storm (ideate) → Execute → Project → IDE (build) or Tasks + Workforce (assign to Claws).
 * Unified chats: ide_project_chats (origin + optional projectId). Tasks link projects to claws/executions.
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

export const taskStatusEnum = pgEnum('task_status', [
  'backlog', // ideation/unplanned
  'todo',    // planned
  'ready',   // queued/assigned awaiting workforce
  'in_progress',
  'in_review',
  'done',
  'blocked',
]);

export const taskPriorityEnum = pgEnum('task_priority', [
  'low', 'medium', 'high', 'urgent',
]);

export const agentTypeEnum = pgEnum('agent_type', [
  'claude', 'openai', 'ollama', 'http',
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

export const sourceControlProviderEnum = pgEnum('source_control_provider', [
  'github', 'bitbucket',
]);

export const authTokenTypeEnum = pgEnum('auth_token_type', [
  'web', 'tenant', 'api', 'claw',
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

export const clawStatusEnum = pgEnum('claw_status', ['active', 'inactive', 'suspended']);
export const clawDirectoryStatusEnum = pgEnum('claw_directory_status', ['pending', 'synced', 'error']);

export const specStatusEnum = pgEnum('spec_status', ['draft', 'reviewed', 'approved', 'in_progress', 'done']);
export const workflowTypeEnum = pgEnum('workflow_type', ['feature', 'bugfix', 'refactor', 'planning', 'adversarial', 'custom']);
export const workflowStatusEnum = pgEnum('workflow_status', ['pending', 'running', 'completed', 'failed', 'cancelled']);
export const workflowTaskStatusEnum = pgEnum('workflow_task_status', ['pending', 'running', 'completed', 'failed', 'cancelled']);
export const approvalStatusEnum = pgEnum('approval_status', ['pending', 'approved', 'rejected', 'expired']);

export const artifactTypeEnum = pgEnum('artifact_type', ['skill', 'persona', 'content']);
export const assignmentScopeEnum = pgEnum('assignment_scope', ['tenant', 'claw', 'project', 'task']);
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
  llmProduct:       varchar('llm_product', { length: 32 }).notNull().default('coderClawLLM'),
  model:            varchar('model', { length: 200 }).notNull(),
  promptTokens:     integer('prompt_tokens').notNull().default(0),
  completionTokens: integer('completion_tokens').notNull().default(0),
  totalTokens:      integer('total_tokens').notNull().default(0),
  retries:          integer('retries').notNull().default(0),
  streamed:         boolean('streamed').notNull().default(false),
  createdAt:        timestamp('created_at').notNull().defaultNow(),
});

export const llmFailoverLog = pgTable('llm_failover_log', {
  id:        serial('id').primaryKey(),
  model:     varchar('model', { length: 200 }).notNull(),
  errorCode: integer('error_code').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const projectInsightEvents = pgTable('project_insight_events', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
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

// ---------------------------------------------------------------------------
// Orchestration tables
// ---------------------------------------------------------------------------

export const tenants = pgTable('tenants', {
  id:                     serial('id').primaryKey(),
  name:                   varchar('name', { length: 255 }).notNull(),
  slug:                   varchar('slug', { length: 255 }).notNull().unique(),
  status:                 tenantStatusEnum('status').notNull().default('active'),
  defaultClawId:          integer('default_claw_id'),
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
  createdAt:              timestamp('created_at').notNull().defaultNow(),
  updatedAt:              timestamp('updated_at').notNull().defaultNow(),
});

export const tenantMembers = pgTable('tenant_members', {
  id:        serial('id').primaryKey(),
  tenantId:  integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  userId:    varchar('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  role:      tenantRoleEnum('role').notNull().default('developer'),
  isActive:  boolean('is_active').notNull().default(true),
  joinedAt:  timestamp('joined_at').notNull().defaultNow(),
});

export const managedClawRequestStatusEnum = pgEnum('managed_claw_request_status', [
  'pending', 'provisioning', 'active', 'cancelled', 'failed',
]);

/**
 * Managed Claw hosting requests — tenants who want Builderforce to host their CoderClaw instance.
 * $49/mo per hosted Claw add-on.
 */
export const managedClawRequests = pgTable('managed_claw_requests', {
  id:           serial('id').primaryKey(),
  tenantId:     integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  status:       managedClawRequestStatusEnum('status').notNull().default('pending'),
  clawName:     varchar('claw_name', { length: 255 }).notNull(),
  region:       varchar('region', { length: 100 }).notNull().default('us-east'),
  notes:        text('notes'),
  provisionedAt: timestamp('provisioned_at'),
  clawId:       integer('claw_id'),   // set once provisioned and linked to a Claw record
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
});

export const sourceControlIntegrations = pgTable('source_control_integrations', {
  id:                serial('id').primaryKey(),
  tenantId:          integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
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
  createdAt:       timestamp('created_at').notNull().defaultNow(),
  updatedAt:       timestamp('updated_at').notNull().defaultNow(),
});

export const tasks = pgTable('tasks', {
  id:                serial('id').primaryKey(),
  projectId:         integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  key:               varchar('key', { length: 100 }).notNull().unique(),
  title:             varchar('title', { length: 500 }).notNull(),
  description:       text('description'),
  status:            taskStatusEnum('status').notNull().default('backlog'),
  priority:          taskPriorityEnum('priority').notNull().default('medium'),
  assignedAgentType: agentTypeEnum('assigned_agent_type'),
  githubIssueNumber: integer('github_issue_number'),
  githubIssueUrl:    varchar('github_issue_url', { length: 500 }),
  githubPrUrl:       varchar('github_pr_url', { length: 500 }),
  githubPrNumber:    integer('github_pr_number'),
  assignedClawId:    integer('assigned_claw_id').references(() => coderclawInstances.id, { onDelete: 'set null' }),
  startDate:         timestamp('start_date'),
  dueDate:           timestamp('due_date'),
  persona:           varchar('persona', { length: 50 }),
  archived:          boolean('archived').notNull().default(false),
  createdAt:         timestamp('created_at').notNull().defaultNow(),
  updatedAt:         timestamp('updated_at').notNull().defaultNow(),
});

export const agents = pgTable('agents', {
  id:         serial('id').primaryKey(),
  tenantId:   integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
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
 * CoderClaw instances — registered CoderClaw machines owned by a tenant.
 * Each instance authenticates with its own API key (not a user credential).
 * A claw belongs to exactly one tenant; a tenant can have many claws (the mesh).
 */
export const coderclawInstances = pgTable('coderclaw_instances', {
  id:           serial('id').primaryKey(),
  tenantId:     integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name:         varchar('name', { length: 255 }).notNull(),
  slug:         varchar('slug', { length: 255 }).notNull(),
  apiKeyHash:   varchar('api_key_hash', { length: 64 }).notNull(),
  status:       clawStatusEnum('status').notNull().default('active'),
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
  connectedAt:  timestamp('connected_at'),   // set when claw's upstream WS connects; null = offline
  capabilities:         text('capabilities'),         // JSON array reported via heartbeat, e.g. '["chat","tasks","relay"]'
  declaredCapabilities: text('declared_capabilities'), // JSON array configured by user in the portal
  localPersonas:        text('local_personas'),         // JSON array of custom role definitions reported by the claw
  /** Per-claw token budget per calendar day. NULL = no per-claw limit (only plan-level limit applies). */
  tokenDailyLimit:      integer('token_daily_limit'),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
});

export const executions = pgTable('executions', {
  id:           serial('id').primaryKey(),
  taskId:       integer('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  agentId:      integer('agent_id').references(() => agents.id),
  clawId:       integer('claw_id').references(() => coderclawInstances.id, { onDelete: 'set null' }),
  tenantId:     integer('tenant_id').notNull().references(() => tenants.id),
  submittedBy:  varchar('submitted_by', { length: 36 }).notNull(),
  sessionId:    varchar('session_id', { length: 128 }),
  status:       executionStatusEnum('status').notNull().default('pending'),
  payload:      text('payload'),
  result:       text('result'),
  errorMessage: text('error_message'),
  startedAt:    timestamp('started_at'),
  completedAt:  timestamp('completed_at'),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
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
// A skill from the marketplace can be assigned to an entire tenant (all claws
// inherit it) or to a specific CoderClaw instance.
// ---------------------------------------------------------------------------

/**
 * Tenant-level skill assignment.
 * When a skill is assigned here, every active claw in the tenant can use it.
 * assignedBy is the userId of the owner/manager who made the assignment.
 */
export const tenantSkillAssignments = pgTable('tenant_skill_assignments', {
  id:         serial('id').primaryKey(),
  tenantId:   integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  skillSlug:  varchar('skill_slug', { length: 255 }).notNull(),
  assignedBy: varchar('assigned_by', { length: 36 }).references(() => users.id),
  assignedAt: timestamp('assigned_at').notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.tenantId, t.skillSlug] }),
]);

/**
 * Claw-level skill assignment.
 * Overrides or supplements the tenant-level assignment for a specific claw.
 */
export const clawSkillAssignments = pgTable('claw_skill_assignments', {
  id:         serial('id').primaryKey(),
  clawId:     integer('claw_id').notNull().references(() => coderclawInstances.id, { onDelete: 'cascade' }),
  tenantId:   integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  skillSlug:  varchar('skill_slug', { length: 255 }).notNull(),
  assignedBy: varchar('assigned_by', { length: 36 }).references(() => users.id),
  assignedAt: timestamp('assigned_at').notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.clawId, t.skillSlug] }),
]);

// ---------------------------------------------------------------------------
// Unified artifact assignments (skills, personas, content at any scope level)
// ---------------------------------------------------------------------------

/**
 * Assigns an artifact (skill, persona, or content) to a scope (tenant, claw,
 * project, or task). Precedence during resolution: task > project > claw > tenant.
 * scopeId holds the FK for the scope entity (tenantId / clawId / projectId / taskId).
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
// Claw ↔ Project associations and synced workspace directories
// ---------------------------------------------------------------------------

export const clawProjects = pgTable('claw_projects', {
  id:        serial('id').primaryKey(),
  tenantId:  integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  clawId:    integer('claw_id').notNull().references(() => coderclawInstances.id, { onDelete: 'cascade' }),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  role:      varchar('role', { length: 64 }).notNull().default('default'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.tenantId, t.clawId, t.projectId] }),
]);

export const clawDirectories = pgTable('claw_directories', {
  id:           serial('id').primaryKey(),
  tenantId:     integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  clawId:       integer('claw_id').notNull().references(() => coderclawInstances.id, { onDelete: 'cascade' }),
  projectId:    integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
  absPath:      text('abs_path').notNull(),
  pathHash:     varchar('path_hash', { length: 128 }).notNull(),
  status:       clawDirectoryStatusEnum('status').notNull().default('pending'),
  metadata:     text('metadata'),
  errorMessage: text('error_message'),
  lastSeenAt:   timestamp('last_seen_at'),
  lastSyncedAt: timestamp('last_synced_at'),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.tenantId, t.clawId, t.pathHash] }),
]);

export const clawDirectoryFiles = pgTable('claw_directory_files', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  clawId:      integer('claw_id').notNull().references(() => coderclawInstances.id, { onDelete: 'cascade' }),
  directoryId: integer('directory_id').notNull().references(() => clawDirectories.id, { onDelete: 'cascade' }),
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

export const clawSyncHistory = pgTable('claw_sync_history', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  clawId:      integer('claw_id').notNull().references(() => coderclawInstances.id, { onDelete: 'cascade' }),
  directoryId: integer('directory_id').references(() => clawDirectories.id, { onDelete: 'set null' }),
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
  clawId:     integer('claw_id').notNull().references(() => coderclawInstances.id, { onDelete: 'cascade' }),
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
  clawId:    integer('claw_id').notNull().references(() => coderclawInstances.id, { onDelete: 'cascade' }),
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
  projectId:   integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
  clawId:      integer('claw_id').references(() => coderclawInstances.id, { onDelete: 'set null' }),
  goal:        text('goal').notNull(),
  status:      specStatusEnum('status').notNull().default('draft'),
  prd:         text('prd'),
  archSpec:    text('arch_spec'),
  taskList:    text('task_list'),      // JSON array stored as text (jsonb not available in all envs)
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Workflows — structured execution records for orchestrated multi-step plans
// ---------------------------------------------------------------------------

export const workflows = pgTable('workflows', {
  id:           uuid('id').primaryKey(),
  tenantId:     integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  clawId:       integer('claw_id').notNull().references(() => coderclawInstances.id, { onDelete: 'cascade' }),
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
// Usage snapshots — context window and token telemetry from the claw agent
// ---------------------------------------------------------------------------

export const usageSnapshots = pgTable('usage_snapshots', {
  id:               serial('id').primaryKey(),
  tenantId:         integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  clawId:           integer('claw_id').notNull().references(() => coderclawInstances.id, { onDelete: 'cascade' }),
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
  clawId:      integer('claw_id').notNull().references(() => coderclawInstances.id, { onDelete: 'cascade' }),
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
// OTel spans — W3C-compatible workflow trace spans forwarded from CoderClaw
// ---------------------------------------------------------------------------

export const telemetrySpans = pgTable('telemetry_spans', {
  id:               serial('id').primaryKey(),
  tenantId:         integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  clawId:           integer('claw_id').references(() => coderclawInstances.id, { onDelete: 'set null' }),
  traceId:          varchar('trace_id', { length: 32 }).notNull(),
  workflowId:       varchar('workflow_id', { length: 36 }),
  taskId:           varchar('task_id', { length: 36 }),
  kind:             varchar('kind', { length: 64 }).notNull(),     // SpanKind from CoderClaw
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
  clawId:      integer('claw_id').references(() => coderclawInstances.id, { onDelete: 'set null' }),
  requestedBy: varchar('requested_by', { length: 36 }),   // claw ID or user ID as string
  actionType:  varchar('action_type', { length: 255 }).notNull(),
  description: text('description').notNull(),
  metadata:    text('metadata'),
  status:      approvalStatusEnum('status').notNull().default('pending'),
  reviewedBy:  varchar('reviewed_by', { length: 36 }),
  reviewNote:  text('review_note'),
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
  chatId:         integer('chat_id').references(() => brainChats.id, { onDelete: 'cascade' }).unique(),
  clawSessionId:  integer('claw_session_id').references(() => chatSessions.id, { onDelete: 'cascade' }).unique(),
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
  userId:    varchar('user_id', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  origin:     varchar('origin', { length: 32 }).notNull().default('ide'),
  title:      varchar('title', { length: 500 }).notNull().default('New chat'),
  summary:    text('summary'),
  isArchived: boolean('is_archived').notNull().default(false),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Cron jobs (claw-scoped, optionally project-associated, synced via GUID)
// ---------------------------------------------------------------------------

export const cronJobs = pgTable('cron_jobs', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  clawId:      integer('claw_id').notNull().references(() => coderclawInstances.id, { onDelete: 'cascade' }),
  projectId:   integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
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
  'github', 'bitbucket', 'jira', 'confluence', 'freshservice',
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
  isActive:      boolean('is_active').notNull().default(true),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
});

/**
 * Cross-platform identity reconciliation.
 * e.g. contributor 42 is "johndoe" on GitHub AND "john.doe@example.com" on Jira.
 */
export const contributorIdentities = pgTable('contributor_identities', {
  id:            serial('id').primaryKey(),
  contributorId: integer('contributor_id').notNull().references(() => contributors.id, { onDelete: 'cascade' }),
  tenantId:      integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
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
  userId:        varchar('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  reportType:    reportTypeEnum('report_type').notNull(),
  isSubscribed:  boolean('is_subscribed').notNull().default(true),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  unique('uq_subscription_user_type').on(t.tenantId, t.userId, t.reportType),
]);

// ---------------------------------------------------------------------------
// Team memory — cross-claw memory sharing mesh (P4-5)
// ---------------------------------------------------------------------------

export const teamMemory = pgTable('team_memory', {
  id:        uuid('id').primaryKey().defaultRandom(),
  tenantId:  integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  /** Numeric claw ID stored as string for flexibility. */
  clawId:    varchar('claw_id', { length: 64 }).notNull(),
  runId:     varchar('run_id', { length: 64 }).notNull(),
  summary:   text('summary').notNull(),
  /** JSON array of tag strings, stored as text. */
  tags:      text('tags').notNull().default('[]'),
  /** ISO-8601 timestamp provided by the claw. */
  timestamp: varchar('timestamp', { length: 32 }).notNull(),
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