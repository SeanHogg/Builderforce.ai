/**
 * Schema — runtime context.
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
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
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
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { facts } from './brain';
import { contributorMerges, rehearsals, teams } from './collaboration';
import { agentHostDirectoryStatusEnum, agentHostStatusEnum, agentTypeEnum, artifactTypeEnum, assignmentScopeEnum, executionStatusEnum, managedAgentHostRequestStatusEnum, pricingModelEnum, tsvector, workflowStatusEnum, workflowTypeEnum } from './common';
import { monitors, pullRequests, qaCredentials, qaTargets, qaTests } from './delivery';
import { approvals } from './governance';
import { segments, tenants, users } from './identity';
import { ideTrainingJobs } from './llm';
import { integrationCredentials } from './platform';
import { boards, projectAgents, projectFacts, projectRepositories, projects, specs, swimlaneAgentAssignments, swimlanes, tasks } from './work';


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
   *  'sync_pr' | 'flag' (a required check is unmet — written only when the verdict
   *  CHANGES) | 'coordinate' (the manager staffed a flagged ticket's missing
   *  role/reviewer) | 'merge_blocked' (0363: the PR is ready but the effective policy
   *  withholds merge authority — written once per PR, not once per pass) |
   *  'triage' (0367: a stalled ticket was diagnosed and its remedy applied) |
   *  'escalate' (0367: the manager's own remedy stopped working and a human is needed). */
  actionType: varchar('action_type', { length: 24 }).notNull(),
  summary:    text('summary').notNull(),
  /** Structured JSON payload for drill-in. */
  detail:     text('detail'),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  byFeed: index('idx_manager_actions_feed').on(t.tenantId, t.projectId, t.createdAt),
  byRunTask: index('idx_manager_actions_run_task').on(t.runTaskId),
}));


/**
 * The AI Manager's STUCK-TICKET REGISTER (0367) — one open row per stalled ticket.
 *
 * `manager_actions` above records what the manager DID; this records what it is stuck
 * ON, and — the part that matters — whether its own fix is working. `attempts` counts
 * consecutive applications of `remedy` that did NOT move the ticket (measured by
 * comparing the live status against `observedStatus`), and at the ceiling the remedy
 * converts to `escalate_human`. That ceiling is the generalised fix for the merge
 * livelock this table's migration documents: a remedy nobody checks is a retry storm.
 */
export const managerStallWatch = pgTable('manager_stall_watch', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenantId:       integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  projectId:      integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  taskId:         integer('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  /** {@link ../../application/manager/stallTriage.StallCause}. */
  cause:          varchar('cause', { length: 32 }).notNull(),
  /** {@link ../../application/manager/stallTriage.StallRemedy}. */
  remedy:         varchar('remedy', { length: 32 }).notNull(),
  detail:         text('detail').notNull(),
  /** The ticket's status when the remedy was last applied — how "did it work?" is answered. */
  observedStatus: varchar('observed_status', { length: 32 }).notNull(),
  attempts:       integer('attempts').notNull().default(0),
  idleMs:         bigint('idle_ms', { mode: 'number' }).notNull().default(0),
  firstSeenAt:    timestamp('first_seen_at').notNull().defaultNow(),
  lastSeenAt:     timestamp('last_seen_at').notNull().defaultNow(),
  lastAttemptAt:  timestamp('last_attempt_at'),
  escalatedAt:    timestamp('escalated_at'),
  resolvedAt:     timestamp('resolved_at'),
  createdAt:      timestamp('created_at').notNull().defaultNow(),
  updatedAt:      timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byOpen: index('idx_manager_stall_watch_open').on(t.tenantId, t.projectId, t.resolvedAt, t.idleMs),
  byEscalated: index('idx_manager_stall_watch_escalated').on(t.tenantId, t.escalatedAt),
}));

/**
 * SYSTEMIC findings (0373) — a stall CAUSE the manager has concluded is a platform
 * problem rather than N independent tickets, plus the one ticket it filed for it.
 *
 * The per-ticket register (`manager_stall_watch`) answers "what is stuck?". This
 * answers the question that outranks it once a cohort gets large: "these 313 tickets
 * are not 313 problems — what is the ONE thing wrong?" See
 * {@link ../../application/manager/systemicDiagnosis}.
 */
export const managerSystemicFindings = pgTable('manager_systemic_findings', {
  id:            uuid('id').primaryKey().defaultRandom(),
  tenantId:      integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  projectId:     integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  /** {@link ../../application/manager/stallTriage.StallCause}. */
  cause:         varchar('cause', { length: 32 }).notNull(),
  ticketCount:   integer('ticket_count').notNull().default(0),
  summary:       text('summary').notNull(),
  remediation:   text('remediation').notNull(),
  /** 'ai' when a model produced it, 'heuristic' when the deterministic fallback did. */
  source:        varchar('source', { length: 16 }).notNull().default('ai'),
  createdTaskId: integer('created_task_id').references(() => tasks.id, { onDelete: 'set null' }),
  status:        varchar('status', { length: 16 }).notNull().default('open'),
  firstSeenAt:   timestamp('first_seen_at').notNull().defaultNow(),
  lastSeenAt:    timestamp('last_seen_at').notNull().defaultNow(),
  resolvedAt:    timestamp('resolved_at'),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byLookup: index('idx_manager_systemic_lookup').on(t.tenantId, t.projectId, t.status, t.lastSeenAt),
}));


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
  /** Training job this agent was produced by (0022). */
  jobId:            text('job_id').references(() => ideTrainingJobs.id, { onDelete: 'set null' }),
  loraRank:         integer('lora_rank'),
  /** R2 key of the trained LoRA adapter artifact (0022). */
  r2ArtifactKey:    text('r2_artifact_key'),
  resumeMd:         text('resume_md'),
  // ── Local inference pipeline (0036): adapter caching + Mamba state sync ──
  packageVersion:   text('package_version').notNull().default('1.0'),
  /** Serialized Mamba SSM hidden state, synced between inference calls. */
  mambaState:       jsonb('mamba_state'),
  /** 'base' | (fine-tuned modes) — which weights an inference call should use. */
  inferenceMode:    text('inference_mode').notNull().default('base'),
  requestCount:     integer('request_count').notNull().default(0),
  lastUsedAt:       timestamp('last_used_at'),
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
  /** WHICH dispatcher started this run — `system:lane-auto`, `system:coordinator`,
   *  `manager:signoff-request:<ref>`, `<base>:lane-approver:<role>`, `user:<id>`.
   *  Read by the ticket lifecycle ledger to attribute a retry storm to the subsystem
   *  responsible. Widened 36→128 in 0368: the lane-approver paths COMPOSE this value
   *  and overflowed at any role key longer than 3 chars. Build it with
   *  `composeDispatcherLabel()`, never a raw template. */
  submittedBy:  varchar('submitted_by', { length: 128 }).notNull(),
  sessionId:    varchar('session_id', { length: 128 }),
  status:       executionStatusEnum('status').notNull().default('pending'),
  payload:      text('payload'),
  result:       text('result'),
  errorMessage: text('error_message'),
  /** Cloud agent that actually ran this execution (ide_agents.id by value, no FK).
   *  Null for gateway-default / host runs. Written at dispatch so each run's
   *  logs/telemetry scope to the agent that ran IT, not the ticket's current one. */
  cloudAgentRef: varchar('cloud_agent_ref', { length: 64 }),
  /** 'live' (default) or 'rehearsal' (0372). A rehearsal drives the REAL loop through
   *  a shadow capability provider that suppresses every effect, so it needs a real
   *  execution row for audit/steering/cancel — but it must never count as delivery.
   *  Never filter on this literal: use `liveExecution()` from
   *  application/rehearsal/executionMode.ts so the predicate exists in one place. */
  mode:         varchar('mode', { length: 16 }).notNull().default('live'),
  /** Monotonic lifecycle transition number. Maintained by the database trigger
   * that appends execution_lifecycle_outbox rows. */
  lifecycleVersion: integer('lifecycle_version').notNull().default(1),
  startedAt:    timestamp('started_at'),
  completedAt:  timestamp('completed_at'),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
});

/**
 * Transactional execution-lifecycle outbox. Database triggers append to this
 * table in the SAME transaction as every executions insert/status transition,
 * including legacy/direct SQL writers that bypass RuntimeService.
 */
export const executionLifecycleOutbox = pgTable('execution_lifecycle_outbox', {
  id:               bigserial('id', { mode: 'number' }).primaryKey(),
  eventKey:         varchar('event_key', { length: 160 }).notNull(),
  tenantId:         integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  executionId:      integer('execution_id').notNull().references(() => executions.id, { onDelete: 'cascade' }),
  taskId:           integer('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  projectId:        integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
  lifecycleVersion: integer('lifecycle_version').notNull(),
  eventType:        varchar('event_type', { length: 64 }).notNull(),
  fromStatus:       varchar('from_status', { length: 32 }),
  toStatus:         varchar('to_status', { length: 32 }).notNull(),
  submittedBy:      varchar('submitted_by', { length: 128 }).notNull(),
  agentHostId:      integer('agent_host_id').references(() => agentHosts.id, { onDelete: 'set null' }),
  cloudAgentRef:    varchar('cloud_agent_ref', { length: 64 }),
  mode:             varchar('mode', { length: 16 }).notNull().default('live'),
  payload:          jsonb('payload'),
  status:           varchar('status', { length: 16 }).notNull().default('pending'),
  attempts:         integer('attempts').notNull().default(0),
  nextAttemptAt:    timestamp('next_attempt_at').notNull().defaultNow(),
  lastError:        text('last_error'),
  processedAt:      timestamp('processed_at'),
  occurredAt:       timestamp('occurred_at').notNull().defaultNow(),
  createdAt:        timestamp('created_at').notNull().defaultNow(),
  updatedAt:        timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('idx_execution_lifecycle_outbox_event_key').on(t.eventKey),
  index('idx_execution_lifecycle_outbox_due').on(t.status, t.nextAttemptAt),
  index('idx_execution_lifecycle_outbox_execution').on(t.tenantId, t.executionId, t.id),
]);


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
  /** Soft-delete stamp for "unhire" (migration 0101). NULL = the tenant is CURRENTLY
   *  holding the agent; a timestamp = released, but the row (and therefore the hire
   *  provenance behind any work the agent did) is kept. Every active-hire read filters
   *  on `unhired_at IS NULL`; re-hiring revives the same row by clearing it. */
  unhiredAt: timestamp('unhired_at'),
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
  // ── Memory governance (0371). Written ONLY through application/memory/memoryService. ──
  /** 'tenant' | 'ticket'. Project-scoped facts live in `projectFacts` (the shared
   *  cross-surface store), so this store holds the workspace-wide and ticket-local
   *  ends of the scope chain. */
  scopeKind:  varchar('scope_kind', { length: 16 }).notNull().default('tenant'),
  /** Concrete owner of the scope: the task id for 'ticket', 0 for 'tenant'. NOT NULL
   *  so `(tenant, scope_kind, scope_id, key)` stays a plain upsert target. */
  scopeId:    integer('scope_id').notNull().default(0),
  /** PROVENANCE — where the belief came from: 'agent' | 'cloud-run' | 'ide' | 'brain'
   *  | 'user' | 'ingestion'. */
  origin:     varchar('origin', { length: 64 }).notNull().default('agent'),
  /** The run that formed it, when an agent did (executions.id by value, no FK). */
  originExecutionId: integer('origin_execution_id'),
  /** TTL. NULL = durable. Recall filters expired rows; the retention sweep deletes them. */
  expiresAt:  timestamp('expires_at'),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
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
// Tables that existed in migrations but had no Drizzle definition until now.
// Their absence is why the routes/services below them dropped to raw SQL; with
// these defined, the Drizzle query builder is the ONE access path (no raw neon).
// ---------------------------------------------------------------------------

/** Per-call inference telemetry for a trained IDE agent (0036). */
export const agentInferenceLogs = pgTable('agent_inference_logs', {
  id:               text('id').primaryKey(),
  agentId:          text('agent_id').notNull().references(() => ideAgents.id, { onDelete: 'cascade' }),
  modelRef:         text('model_ref').notNull(),
  promptTokens:     integer('prompt_tokens'),
  completionTokens: integer('completion_tokens'),
  latencyMs:        integer('latency_ms'),
  status:           text('status').notNull(),
  errorMessage:     text('error_message'),
  inferenceMode:    text('inference_mode'),
  createdAt:        timestamp('created_at').notNull().defaultNow(),
});


/** Retrieval chunks backing an agent's recalled knowledge (0249). */
export const agentKnowledgeChunks = pgTable('agent_knowledge_chunks', {
  id:        text('id').primaryKey(),
  agentId:   text('agent_id').notNull().references(() => ideAgents.id, { onDelete: 'cascade' }),
  ordinal:   integer('ordinal').notNull(),
  chunkText: text('chunk_text').notNull(),
  source:    text('source'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});


// ---------------------------------------------------------------------------
// Multi-agent coordination (migration 0370)
//
// A swimlane stage can dispatch SEVERAL agents at once — dispatches with no
// `dependsOn` all become ready together, and the 'any'/'n_of_m' success policies
// exist for exactly that. Those agents share one git branch. These two tables are
// the arbiter that was missing: a lease is mutual exclusion over a named resource,
// and a note is how concurrent agents tell each other what they are doing.
//
// Everything here is written through application/coordination — never inline.
// ---------------------------------------------------------------------------

/**
 * A mutual-exclusion lease over one canonical resource (see
 * domain/coordination/resourceKey.ts). The DB-level guarantee is a PARTIAL UNIQUE
 * INDEX on `(tenant_id, resource_key) WHERE released_at IS NULL`, which makes
 * `INSERT … ON CONFLICT DO NOTHING` an atomic test-and-set — the only concurrency
 * primitive available on neon-http, which has no interactive transactions.
 *
 * `expiresAt` keeps the lock crash-safe: a dead run's lease is stealable once past
 * its expiry, so a path can never be wedged forever by a run that never released.
 */
export const resourceLeases = pgTable('resource_leases', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenantId:     integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  /** Canonical key, e.g. `repo:acme/web:src/app.ts`. Never a raw model string. */
  resourceKey:  varchar('resource_key', { length: 512 }).notNull(),
  /** 'exclusive' (one holder) | 'shared' (many readers; blocks an exclusive claim). */
  mode:         varchar('mode', { length: 16 }).notNull().default('exclusive'),
  /** The coordination scope this lease is visible in — `ticket:<taskId>`. */
  scopeKey:     varchar('scope_key', { length: 255 }).notNull(),
  /** Holding run (executions.id by value, no FK — rehearsals hold leases too). */
  executionId:  integer('execution_id'),
  holderLabel:  varchar('holder_label', { length: 255 }).notNull(),
  taskId:       integer('task_id').references(() => tasks.id, { onDelete: 'cascade' }),
  reason:       text('reason'),
  acquiredAt:   timestamp('acquired_at').notNull().defaultNow(),
  expiresAt:    timestamp('expires_at').notNull(),
  releasedAt:   timestamp('released_at'),
});


/**
 * The shared workspace ("blackboard") for one coordination scope. Run-scoped WORKING
 * state — intent, hand-offs, decisions a peer must not contradict. Deliberately NOT
 * memory: memory is durable cross-ticket knowledge with scope/TTL/provenance rules
 * (0371); a note dies with its ticket. One row per (scope, key): posting the same key
 * overwrites, because the board holds CURRENT intent and `tool_audit_events` already
 * keeps the history.
 */
export const coordinationNotes = pgTable('coordination_notes', {
  id:                uuid('id').primaryKey().defaultRandom(),
  tenantId:          integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  scopeKey:          varchar('scope_key', { length: 255 }).notNull(),
  taskId:            integer('task_id').references(() => tasks.id, { onDelete: 'cascade' }),
  key:               varchar('key', { length: 255 }).notNull(),
  content:           text('content').notNull(),
  authorExecutionId: integer('author_execution_id'),
  authorLabel:       varchar('author_label', { length: 255 }).notNull(),
  createdAt:         timestamp('created_at').notNull().defaultNow(),
  updatedAt:         timestamp('updated_at').notNull().defaultNow(),
});
