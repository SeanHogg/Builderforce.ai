/**
 * Schema — Agents & runtime, owned by **the platform** (PRD 20 §3).
 *
 * Root entity `agent`. 75 source tables in → 40 out.
 *
 * Merged from `runtime.ts` and `llm.ts`. A model, a provider, a routing decision
 * and the execution that used them are one bounded context — the split ran through
 * the middle of every question worth asking ("why did this run cost that much"),
 * and `work ↔ runtime` was one of the import cycles the boundary guard baselined.
 */

import {
  AnyPgColumn,
  bigint,
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
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
import { brainChats, knowledgeDocuments } from './canvas';
import { agentHostDirectoryStatusEnum, agentHostStatusEnum, agentTypeEnum, artifactTypeEnum, assignmentScopeEnum, executionStatusEnum, managedAgentHostRequestStatusEnum, objects, pricingModelEnum, tsvector, workflowStatusEnum, workflowTypeEnum } from './kernel';
import { pullRequests, qaCredentials, qaTargets, qaTests } from './delivery';
import { segments, tenants, users } from './identity';
import { integrationCredentials } from './platform';
import {
  boards,
  projectAgents,
  projectFacts,
  projectRepositories,
  projects,
  specs,
  swimlanes,
  tasks,
} from './delivery';
import type { ColumnClassification, DatasetUsePolicy } from '@builderforce/creation-canvas-contract';

// ═══ from runtime.ts ═══
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
  /**
   * The PULL REQUEST the action was about (0383) — the key the PR loop's ceilings and
   * its least-recently-worked rotation are counted on.
   *
   * NOT `task_id`, which is what 0381 used and what made the ceilings unenforceable:
   * `pull_requests.task_id` is nullable, so an orphan PR's actions could never be
   * counted back to it (`NULL = NULL` is never true in a join) and every guard written
   * `pr.taskId != null && …` skipped it outright. Measured on project 11: one PR
   * journalled `merge_failed` with `attempt: 1` six times in thirty minutes, forever,
   * while its NULL `last_acted_at` pinned it to the front of a NULLS-FIRST rotation.
   * It is also the right key on its own terms — a replacement PR must not inherit the
   * retired one's refusals.
   */
  prId:       uuid('pr_id').references(() => pullRequests.id, { onDelete: 'set null' }),
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
   *  'escalate' (0367: the manager's own remedy stopped working and a human is needed) |
   *  'merge_failed' (0381: the PROVIDER refused the merge — its own type because the
   *  merge ceiling COUNTS these, and a refusal buried in 'flag' cannot be counted) |
   *  'pr_conflict' (0381: the branch conflicts with its base — its own type because it
   *  is the only record that the PR loop touched a conflicting PR, and the
   *  least-recently-worked rotation orders by exactly that). */
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
 * ONE ROW PER MANAGER PASS (migration 1082) — the pass's outcome as DATA.
 *
 * `finalizeManagerRunTask` rendered the whole {@link ManagerRunSummary} into
 * `tasks.description` ("Scored 0 · ranked 300 · assigned 0 · …") and stored nothing
 * else, so the frontend had to regex that sentence back apart
 * (`managerDiagnostics.parsePassCounters`) to detect the manager's single most
 * load-bearing failure: a pass that COMPLETES and changes nothing. A UI string was
 * being used as a wire format — it degraded silently on any rewording — and no query
 * could answer "how many passes actually scored anything this month?".
 *
 * The counters live in one `summary` jsonb because the set grows with every new stage
 * (six were added across four passes) and a migration per counter is exactly the
 * friction that would push the next one back into the prose. The two facts that are
 * QUERIED — did it finish, did it change anything — are real indexed columns.
 *
 * The sentence stays on the run card. It is good for a human reading that card; it
 * simply stops being the only copy.
 */
export const managerRuns = pgTable('manager_runs', {
  id:         uuid('id').primaryKey().defaultRandom(),
  tenantId:   integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:  uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  projectId:  integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  /** The "Backlog management pass" card this row closes — UNIQUE, so a retried
   *  finalize upserts rather than writing a second row for one pass. */
  runTaskId:  integer('run_task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  /** The pass finished, as opposed to ending early. */
  ok:         boolean('ok').notNull().default(true),
  /** The pass CHANGED something. The one question the regex existed to answer. */
  changed:    boolean('changed').notNull().default(false),
  /** Stages shed for wall-clock budget, comma-joined; empty on a complete pass. */
  shedStages: text('shed_stages'),
  /** The full `ManagerRunSummary`, verbatim. */
  summary:    jsonb('summary').notNull().default({}),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  byProject: index('idx_manager_runs_project_created').on(t.tenantId, t.projectId, t.createdAt),
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
 * Canonical registry for callable agents, independent of their implementation.
 * `framework` describes what built the agent; `protocol` describes how Builderforce
 * communicates with it. The legacy numeric `agents` table is read-only compatibility.
 */
export const agentRegistrations = pgTable('agent_registrations', {
  id:                     uuid('id').primaryKey().defaultRandom(),
  tenantId:               integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:              uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  agentHostId:            integer('agent_host_id').references(() => agentHosts.id, { onDelete: 'set null' }),
  legacyAgentId:          integer('legacy_agent_id').unique().references(() => agents.id, { onDelete: 'set null' }),
  name:                   varchar('name', { length: 255 }).notNull(),
  framework:              varchar('framework', { length: 64 }).notNull(),
  protocol:               varchar('protocol', { length: 32 }).notNull(),
  endpoint:               text('endpoint'),
  externalAgentId:        varchar('external_agent_id', { length: 255 }),
  credentialRef:          varchar('credential_ref', { length: 255 }),
  status:                 varchar('status', { length: 16 }).notNull().default('active'),
  healthStatus:           varchar('health_status', { length: 16 }).notNull().default('unknown'),
  declaredCapabilities:   jsonb('declared_capabilities').$type<string[]>().notNull().default([]),
  discoveredCapabilities: jsonb('discovered_capabilities').$type<string[]>().notNull().default([]),
  agentCard:              jsonb('agent_card').$type<Record<string, unknown>>(),
  metadata:               jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  registeredBy:           varchar('registered_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  lastSeenAt:             timestamp('last_seen_at'),
  createdAt:              timestamp('created_at').notNull().defaultNow(),
  updatedAt:              timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byTenantStatus: index('idx_agent_registrations_tenant_status').on(t.tenantId, t.status, t.framework, t.protocol),
  byHost: index('idx_agent_registrations_host').on(t.agentHostId),
}));


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

/** Immutable snapshot of an executable definition. Generic source identity keeps
 * Workforce agents and canonical registrations on one versioning contract. */
export const agentDefinitionVersions = pgTable('agent_definition_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  sourceKind: varchar('source_kind', { length: 32 }).notNull(),
  sourceRef: varchar('source_ref', { length: 128 }).notNull(),
  version: integer('version').notNull(),
  fingerprint: varchar('fingerprint', { length: 64 }).notNull(),
  definition: jsonb('definition').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  sourceVersion: uniqueIndex('agent_definition_versions_tenant_id_source_kind_source_ref_version_key').on(t.tenantId, t.sourceKind, t.sourceRef, t.version),
  sourceFingerprint: uniqueIndex('agent_definition_versions_tenant_id_source_kind_source_ref_fingerprint_key').on(t.tenantId, t.sourceKind, t.sourceRef, t.fingerprint),
  bySource: index('idx_agent_definition_versions_source').on(t.tenantId, t.sourceKind, t.sourceRef, t.version),
}));

export const agentDefinitionReleases = pgTable('agent_definition_releases', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  sourceKind: varchar('source_kind', { length: 32 }).notNull(),
  sourceRef: varchar('source_ref', { length: 128 }).notNull(),
  stableVersionId: uuid('stable_version_id').notNull().references(() => agentDefinitionVersions.id, { onDelete: 'restrict' }),
  canaryVersionId: uuid('canary_version_id').references(() => agentDefinitionVersions.id, { onDelete: 'restrict' }),
  canaryPercent: integer('canary_percent').notNull().default(0),
  updatedBy: varchar('updated_by', { length: 128 }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({ source: uniqueIndex('agent_definition_releases_tenant_id_source_kind_source_ref_key').on(t.tenantId, t.sourceKind, t.sourceRef) }));

export const agentDefinitionPromotions = pgTable('agent_definition_promotions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  sourceKind: varchar('source_kind', { length: 32 }).notNull(),
  sourceRef: varchar('source_ref', { length: 128 }).notNull(),
  fromVersionId: uuid('from_version_id').references(() => agentDefinitionVersions.id, { onDelete: 'restrict' }),
  toVersionId: uuid('to_version_id').notNull().references(() => agentDefinitionVersions.id, { onDelete: 'restrict' }),
  action: varchar('action', { length: 16 }).notNull(),
  actorRef: varchar('actor_ref', { length: 128 }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({ bySource: index('idx_agent_definition_promotions_source').on(t.tenantId, t.sourceKind, t.sourceRef, t.createdAt) }));


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
  agentRegistrationId: uuid('agent_registration_id').references(() => agentRegistrations.id, { onDelete: 'set null' }),
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
  /** Authenticated initiating surface. 'agent' is governed by the tenant kill
   * switch; interactive VSIX/Brain runs remain available. */
  source:       varchar('source', { length: 16 }).notNull().default('agent'),
  result:       text('result'),
  errorMessage: text('error_message'),
  /** Cloud agent that actually ran this execution (ide_agents.id by value, no FK).
   *  Null for gateway-default / host runs. Written at dispatch so each run's
   *  logs/telemetry scope to the agent that ran IT, not the ticket's current one. */
  cloudAgentRef: varchar('cloud_agent_ref', { length: 64 }),
  agentDefinitionVersionId: uuid('agent_definition_version_id').references(() => agentDefinitionVersions.id, { onDelete: 'restrict' }),
  /** 'live' (default) or 'rehearsal' (0372). A rehearsal drives the REAL loop through
   *  a shadow capability provider that suppresses every effect, so it needs a real
   *  execution row for audit/steering/cancel — but it must never count as delivery.
   *  Never filter on this literal: use `liveExecution()` from
   *  application/rehearsal/executionMode.ts so the predicate exists in one place. */
  mode:         varchar('mode', { length: 16 }).notNull().default('live'),
  /**
   * Did this finished run leave ANYTHING behind — a commit, a PR, a merge, or a lane
   * move (0385)? Stamped at the terminal chokepoint every cloud surface routes through
   * (`finalizeCloudRun`) from the SAME facts `finalizeLearnWeight` already grades.
   *
   * Read by the autonomy circuit breaker and its cooldown, which counted only FAILED
   * runs and therefore never armed on a board where everything completed and shipped
   * nothing: 5,931 completed runs and 10 failures in one day against 3 finished tickets,
   * one agent at 5,796 runs / 0 finished. NULL means NOT JUDGED — legacy rows and the
   * surfaces that do not route through finalize — and is treated as PRODUCTIVE, so an
   * unknown can never halt autonomy. See `runProducedOutput`.
   */
  produced:     boolean('produced'),
  /** Monotonic lifecycle transition number. Maintained by the database trigger
   * that appends execution_lifecycle_outbox rows. */
  lifecycleVersion: integer('lifecycle_version').notNull().default(1),
  startedAt:    timestamp('started_at'),
  completedAt:  timestamp('completed_at'),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
});

/**
 * A cloud run parked on `ask_human`, and everything resume needs to put it back
 * (migration 0945).
 *
 * The durable surface could always resume from its own DO cursor. The container
 * and GitHub Actions surfaces cannot: each drives the whole loop inside one
 * process whose conversation lives only in that process's memory, so their pause
 * is exit-and-redispatch and the loop state has to outlive the process HERE.
 *
 * It also records where the ticket was before the pause routed it to the board's
 * needs-attention lane, so resume restores the origin lane rather than guessing.
 *
 * One row per execution (UNIQUE) — a run has at most one outstanding question.
 * Written by `pauseExecutionForQuestion`, read and deleted by
 * `resumePausedExecution`; never touched directly by a route.
 */
export const executionPauseState = pgTable('execution_pause_state', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:   uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  executionId: integer('execution_id').notNull().references(() => executions.id, { onDelete: 'cascade' }),
  taskId:      integer('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  /** 'durable' | 'container' | 'github_actions' — the surface resume dispatches to. */
  surface:     varchar('surface', { length: 16 }).notNull(),
  /** The `approvals` row (kind='question') whose answer resumes this run. */
  approvalId:  uuid('approval_id'),
  /** The lane the ticket sat in before the pause routed it away. */
  originLane:  varchar('origin_lane', { length: 120 }),
  /** The lane the pause actually moved it to; null when no move happened. */
  routedLane:  varchar('routed_lane', { length: 120 }),
  /** JSON `{ messages, writtenPaths, step }` — the exit-and-redispatch payload.
   *  Null on the durable surface, which resumes from its DO cursor. */
  loopState:   text('loop_state'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
});

/** Machine principal minted for exactly one execution. No secret material is stored
 * here; narrow grants and expiring delegations describe what it may request. */
export const agentRunPrincipals = pgTable('agent_run_principals', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  executionId: integer('execution_id').notNull().unique().references(() => executions.id, { onDelete: 'cascade' }),
  agentDefinitionVersionId: uuid('agent_definition_version_id').references(() => agentDefinitionVersions.id, { onDelete: 'restrict' }),
  status: varchar('status', { length: 16 }).notNull().default('active'),
  issuedBy: varchar('issued_by', { length: 128 }).notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  revokedAt: timestamp('revoked_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({ byTenantStatus: index('idx_agent_run_principals_tenant_status').on(t.tenantId, t.status, t.expiresAt) }));

export const agentCapabilityGrants = pgTable('agent_capability_grants', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  principalId: uuid('principal_id').notNull().references(() => agentRunPrincipals.id, { onDelete: 'cascade' }),
  capability: varchar('capability', { length: 128 }).notNull(),
  resourcePattern: varchar('resource_pattern', { length: 512 }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({ byPrincipal: index('idx_agent_capability_grants_principal').on(t.tenantId, t.principalId, t.capability) }));

export const agentCredentialDelegations = pgTable('agent_credential_delegations', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  principalId: uuid('principal_id').notNull().references(() => agentRunPrincipals.id, { onDelete: 'cascade' }),
  credentialKind: varchar('credential_kind', { length: 32 }).notNull(),
  credentialRef: varchar('credential_ref', { length: 128 }).notNull(),
  scopes: jsonb('scopes').notNull().default(sql`'[]'::jsonb`),
  expiresAt: timestamp('expires_at').notNull(),
  revokedAt: timestamp('revoked_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({ byPrincipal: index('idx_agent_credential_delegations_principal').on(t.tenantId, t.principalId, t.expiresAt) }));

export const executionLimits = pgTable('execution_limits', {
  executionId: integer('execution_id').primaryKey().references(() => executions.id, { onDelete: 'cascade' }),
  tenantId: integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  maxFiles: integer('max_files'),
  maxRepositories: integer('max_repositories'),
  maxSpendMillicents: integer('max_spend_millicents'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({ byTenant: index('idx_execution_limits_tenant').on(t.tenantId, t.executionId) }));

export const agentContextContributions = pgTable('agent_context_contributions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  executionId: integer('execution_id').notNull().references(() => executions.id, { onDelete: 'cascade' }),
  sourceKind: varchar('source_kind', { length: 32 }).notNull(),
  sourceRef: varchar('source_ref', { length: 512 }),
  trustTier: varchar('trust_tier', { length: 16 }).notNull(),
  contentHash: varchar('content_hash', { length: 64 }).notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({ byExecution: index('idx_agent_context_contributions_execution').on(t.tenantId, t.executionId, t.createdAt) }));

export const agentOutboundInspections = pgTable('agent_outbound_inspections', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  executionId: integer('execution_id').notNull().references(() => executions.id, { onDelete: 'cascade' }),
  seam: varchar('seam', { length: 32 }).notNull(),
  target: varchar('target', { length: 512 }),
  verdict: varchar('verdict', { length: 16 }).notNull(),
  reasons: jsonb('reasons').notNull().default(sql`'[]'::jsonb`),
  contentHash: varchar('content_hash', { length: 64 }).notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({ byExecution: index('idx_agent_outbound_inspections_execution').on(t.tenantId, t.executionId, t.createdAt) }));

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
 *
 * ── THE SWIMLANE SCOPE IS NO LONGER ASPIRATIONAL (migration 1085) ───────────
 * `scope = 'swimlane'` was a documented value with zero rows while every reader of lane
 * staffing went to `swimlane_agent_assignments` instead — so "where is this agent
 * assigned?" had two answers depending on which table you asked. That table is folded in
 * and dropped; lane staffing lives here, keyed `scope_id = <swimlane id>`, with its
 * stage-specific columns documented below. Read it through
 * `application/swimlane/laneAgentAssignments.ts`, which is the only place the scope
 * predicate is written.
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
  // ── SCOPE-QUALIFIED STAGE COLUMNS (migration 1085) ────────────────────────
  // Null for every scope but 'swimlane'. A lane assignment carries stage semantics no
  // other scope has, and folding `swimlane_agent_assignments` in without them would have
  // deleted the operator's runtime choice — the very data a previous fix had to restore
  // when the drag path ignored it and sent every lane agent to the cloud.
  /** Display name of the chosen agent at assign time. */
  name:           varchar('name', { length: 255 }),
  /** The BACKPLANE the operator staffed: 'local' | 'cloud' | 'remote'. */
  runtime:        varchar('runtime', { length: 16 }),
  /** Remote `agentHosts.id` when `runtime = 'remote'`. */
  target:         varchar('target', { length: 120 }),
  taskTemplate:   text('task_template'),
  /** JSON array stored as text — the capabilities this stage requires of its agent. */
  requiredCapabilities: text('required_capabilities'),
  /** Model pinned to this stage; null = the workspace default. */
  model:          varchar('model', { length: 120 }),
  /** Order within a sequential stage. */
  position:       integer('position').notNull().default(0),
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
  // Approval mode (1092): 'autonomous' = a run starts on request; 'required' = a run
  // must first be approved by a human, through the same `approvals` gate that
  // `task.execution` uses. This is the canvas Workflow card's authored setting,
  // which until 1092 was rendered and then dropped on the floor.
  approvalMode:         varchar('approval_mode', { length: 16 }).notNull().default('autonomous'),
  // Fork lineage (0224): a global/shared workflow that gets modified for a project
  // is forked into a custom copy — this points at the template it was forked from.
  parentDefinitionId:   uuid('parent_definition_id').references((): AnyPgColumn => workflowDefinitions.id, { onDelete: 'set null' }),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
});


// ---------------------------------------------------------------------------
// Workflow variables — the KV store backing the Tools node kinds `set-variable`
// / `get-variable` (scope='run', scopeId=a `workflows.id`) and `increment`
// (scope='definition', scopeId=a `workflow_definitions.id`, so the counter
// persists across runs the way Make's Increment function does). One fact per
// row (3NF): a single generic `scope`/`scopeId` pair rather than two nullable
// FK columns, since a row belongs to exactly one scope kind and the two never
// mix. See application/workflow/cloudExecutor.ts + workflowVariablesRepo.ts.
// ---------------------------------------------------------------------------

export const workflowVariables = pgTable('workflow_variables', {
  id:        uuid('id').primaryKey().defaultRandom(),
  tenantId:  integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  scope:     varchar('scope', { length: 16 }).notNull(),    // 'run' | 'definition'
  scopeId:   varchar('scope_id', { length: 64 }).notNull(), // a workflows.id or workflow_definitions.id
  key:       varchar('key', { length: 255 }).notNull(),
  value:     text('value').notNull().default(''),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_workflow_variables_scope_key').on(t.scope, t.scopeId, t.key),
]);


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

/** An agent assertion whose support is structural rather than inferred from prose. */
export const executionClaims = pgTable('execution_claims', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  executionId: integer('execution_id').notNull().references(() => executions.id, { onDelete: 'cascade' }),
  kind:        varchar('kind', { length: 32 }).notNull(),
  statement:   text('statement').notNull(),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  byExecution: index('idx_execution_claims_execution').on(t.tenantId, t.executionId, t.createdAt),
}));

/** Exact tool-audit rows supporting a claim. Both tables are append-only in SQL. */
export const executionClaimEvidence = pgTable('execution_claim_evidence', {
  claimId:          uuid('claim_id').notNull().references(() => executionClaims.id, { onDelete: 'cascade' }),
  toolAuditEventId: integer('tool_audit_event_id').notNull().references(() => toolAuditEvents.id, { onDelete: 'restrict' }),
  tenantId:         integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt:        timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.claimId, t.toolAuditEventId] }),
  byEvent: index('idx_execution_claim_evidence_event').on(t.tenantId, t.toolAuditEventId),
}));


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



// ---------------------------------------------------------------------------
// Agent-host messaging channels (migration 0943)
//
// The registry behind `GET /api/agent-hosts/:id/channels`, which answered a
// hardcoded `{ channels: [] }` while a full CRUD surface shipped against it.
//
// NOT a `connector_connections` row: a connection is an ACCOUNT ("our production
// Slack"), a channel is a routing TARGET inside one ("#general") bound to the host
// that runs the adapter. One account carries many targets, so folding them together
// would put a repeating group in a row read on every listing. `connectionId` points
// at the account when the tenant has connected one, which keeps the credential in
// one place instead of pasted per channel.
// ---------------------------------------------------------------------------

export const agentHostChannels = pgTable('agent_host_channels', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenantId:     integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:    uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  agentHostId:  integer('agent_host_id').notNull().references(() => agentHosts.id, { onDelete: 'cascade' }),
  /** A KIND column, not a table per platform: 'slack' | 'telegram' | 'webhook' | … */
  platform:     varchar('platform', { length: 32 }).notNull(),
  /** The target on that platform — '#general', a chat id, a webhook name. */
  name:         varchar('name', { length: 255 }).notNull(),
  /** The credentialed account this target belongs to; NULL = it carries its own
   *  sealed config below. */
  /** `connector_connections.id`, owned by the integrations domain (§3: an id, not
   *  an imported table). FK declared in migration 0410. */
  connectionId: uuid('connection_id'),
  /** Sealed with the shared per-tenant AES-GCM credential crypto. NEVER a bare
   *  secret, and never returned to a client — the read model exposes only whether
   *  a config is present. */
  configEnc:    text('config_enc'),
  configIv:     varchar('config_iv', { length: 64 }),
  enabled:      boolean('enabled').notNull().default(true),
  /** Reported by the host when it brings the adapter up; NULL until it does. */
  lastStatus:   varchar('last_status', { length: 32 }),
  lastError:    text('last_error'),
  lastSeenAt:   timestamp('last_seen_at'),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  // Re-adding '#general' to the same platform on the same host is the SAME
  // channel, and the database is what says so rather than a check someone
  // remembered to write.
  uniqueIndex('uq_agent_host_channels_target').on(t.agentHostId, t.platform, t.name),
  index('idx_agent_host_channels_tenant').on(t.tenantId, t.agentHostId, t.enabled),
]);

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
  /** The run died on a PROVIDER RATE LIMIT (migration 0485) — `classifyRunFailure`
   *  returned `rate_limited`. An AVAILABILITY fact, never a quality one: the learned
   *  router demotes a chronically-429ing model without letting the 0.0 score that a
   *  failed run necessarily carries teach it that the model writes bad code. */
  rateLimited:      boolean('rate_limited').notNull().default(false),
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
// Human ratings of model output (migration 0468).
//
// The SIBLING fact to `run_model_outcomes`: that table learns which model ships
// working code from merges and CI; this one learns which model produces work a
// person actually accepted, from the thumbs they pressed. Chat and canvas turns
// have no run, no PR and no CI, so before this they taught the router nothing —
// while the thumbs sat unqueryable inside `brain_chat_messages.metadata`.
//
// Grain: ONE row per rater per rated thing (the unique index below). Clearing a
// vote deletes the row — "no opinion" is an absent fact, not a third value.
// ---------------------------------------------------------------------------
export const llmActionRatings = pgTable('llm_action_ratings', {
  id:               serial('id').primaryKey(),
  tenantId:         integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  /** Who pressed it — part of the uniqueness key, so two members of a shared chat
   *  keep their own votes instead of overwriting each other. */
  userId:           varchar('user_id', { length: 64 }).notNull(),
  projectId:        integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
  /** 'brain' | 'canvas' | 'vscode' | 'execution' — where the press happened. */
  surface:          varchar('surface', { length: 16 }).notNull().default('brain'),
  /** 'turn' (an assistant reply) | 'tool' (one tool execution). */
  subjectKind:      varchar('subject_kind', { length: 16 }).notNull().default('turn'),
  /** The rated thing's id in ITS OWN surface. Deliberately opaque — a foreign key
   *  would have to point at four different tables. */
  subjectRef:       varchar('subject_ref', { length: 128 }).notNull(),
  /** The closed action taxonomy the learned router already ranks on, so a rating
   *  lands in the same bucket a cloud run does and the two are comparable. */
  actionType:       varchar('action_type', { length: 32 }).notNull().default('other'),
  /** WHICH MCP tool the rated turn executed, when it executed one. Null for a
   *  prose-only reply — "it answered badly" is a real, rateable outcome. */
  toolName:         varchar('tool_name', { length: 120 }),
  /** The model that actually served it (the gateway's resolved id). We always know
   *  this, even when the user was shown only "Builderforce Free". */
  resolvedModel:    varchar('resolved_model', { length: 200 }).notNull(),
  plan:             varchar('plan', { length: 16 }).notNull().default('free'),
  /** +1 up, -1 down (CHECK-constrained in the migration). */
  rating:           smallint('rating').notNull(),
  comment:          text('comment'),
  createdAt:        timestamp('created_at').notNull().defaultNow(),
  updatedAt:        timestamp('updated_at').notNull().defaultNow(),
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
  /** The lane-staffing row this dispatch ran as. Re-pointed to the canonical
   *  `agent_assignments` by migration 1085, which carried the old ids over precisely so
   *  this link survives — it is the only record of WHICH configured agent a stage ran. */
  assignmentId: uuid('assignment_id').references((): AnyPgColumn => agentAssignments.id, { onDelete: 'set null' }),
  taskId:       integer('task_id').references(() => tasks.id, { onDelete: 'set null' }),
  agentId:      integer('agent_id').references(() => agents.id, { onDelete: 'set null' }),
  agentRegistrationId: uuid('agent_registration_id').references(() => agentRegistrations.id, { onDelete: 'set null' }),
  agentDefinitionVersionId: uuid('agent_definition_version_id').references(() => agentDefinitionVersions.id, { onDelete: 'restrict' }),
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
  tenantId:  integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  agentId:   text('agent_id').notNull().references(() => ideAgents.id, { onDelete: 'cascade' }),
  ordinal:   integer('ordinal').notNull(),
  chunkText: text('chunk_text').notNull(),
  source:    text('source'),
  origin:    varchar('origin', { length: 64 }).notNull().default('ingestion'),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({ byTenantAgent: index('idx_agent_knowledge_chunks_tenant_agent').on(t.tenantId, t.agentId, t.ordinal) }));


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

// ═══ from llm.ts ═══
/**
 * Schema — llm context.
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
  metadata:         jsonb('metadata').$type<Record<string, unknown>>(),
  /** Brain conversation this turn belongs to, and the mode that conversation was
   *  in when it ran (0934). Both also ride in `metadata` — the SDK's billing
   *  trace-back contract reads it there — but per-chat and per-mode spend is a
   *  product report, so it gets indexed columns rather than a JSON scan. */
  chatId:           integer('chat_id'),
  chatMode:         varchar('chat_mode', { length: 16 }).$type<'chat' | 'work'>(),
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
  /** Did this row run on a PREMIUM model — an any-paid-OpenRouter id the tenant
   *  pinned explicitly, billed at vendor cost plus the flat request surcharge (0952)?
   *  A real column rather than the `metadata.premiumSurchargeMillicents` key it
   *  replaces: the daily premium cap has to SUM this on every premium request, and a
   *  jsonb key means a scan. Mirrors `paidOverflow` above, which caps a different
   *  budget (what WE fund) from the same shape. */
  premium:          boolean('premium').notNull().default(false),
  /** True when this call was served by the tenant's OWN provider credential — a
   *  BYO API key or a connected subscription (migration 0284). The platform pays
   *  nothing for these tokens, so `cost_usd_millicents` is forced to 0, and a BYO
   *  row on the on-prem / VSIX `surface` is EXEMPT from the plan token allowance
   *  (see tokenUsage.ts). BYO cloud-agent rows still count (charged). */
  byo:              boolean('byo').notNull().default(false),
  /** Connected LLM provider credential that funded a BYO call (for example
   *  'anthropic' or 'google'). Null for platform-funded calls. */
  byoProvider:      varchar('byo_provider', { length: 32 }),
  /**
   * WHICH INSTANCE of the tenant's credential paid for this row (0953) — the
   * surrogate `tenant_llm_provider_keys.id`, which is re-minted on every key
   * rotation. `byoProvider` above says which connected ACCOUNT; this says which
   * key. Both are needed: the account survives rotation, the instance does not,
   * and per-key spend is only answerable with the latter.
   *
   * A bare uuid with no `.references()` — this table is written through
   * `resolveUsageDatabase`, which may target a different Neon account, and a
   * cross-account foreign key is not enforceable. Also deliberately non-cascading:
   * deleting a credential must not rewrite the spend it already incurred.
   */
  byoCredentialId:  uuid('byo_credential_id'),
  /** Which agent modality produced this row (migration 0284): 'web' | 'vsix' |
   *  'on_prem' | 'cloud' | 'sdk'. Drives the BYO metering exemption above so
   *  own-machine (on-prem/VSIX) BYO usage is free while cloud BYO is charged. */
  surface:          varchar('surface', { length: 16 }).notNull().default('web'),
  createdAt:        timestamp('created_at').notNull().defaultNow(),
});


export const llmFailoverLog = pgTable('llm_failover_log', {
  id:        serial('id').primaryKey(),
  model:     varchar('model', { length: 200 }).notNull(),
  errorCode: integer('error_code').notNull().default(0),
  /** WHOSE cascade this was (0946). Nullable — guest/unauthenticated gateway traffic
   *  has no tenant. A BARE INTEGER with no `.references()`: this table is written
   *  through `buildTransactionalDatabase`, which targets a separate Neon account when
   *  NEON_TRANSACTIONAL_DATABASE_URL is bound, and PostgreSQL cannot enforce a foreign
   *  key across accounts. Same rule the rest of the operational ledger follows. */
  tenantId:  integer('tenant_id'),
  /** The coarse failure CLASS the dispatcher already computed — `auth`, `rate_limit`,
   *  `timeout`, `server_error`, `embedded`, … (0946). Without it an expired credential
   *  and a saturated free tier are the same row, which is why provider auth alerts had
   *  to live in KV instead of being derived from (and recovered from) this history. */
  kind:      varchar('kind', { length: 24 }),
  /** Per-REQUEST correlation id (0946). Every attempt in one cascade shares it, so
   *  "this request failed over four times" is a GROUP BY rather than an inference from
   *  adjacent timestamps. */
  requestId: varchar('request_id', { length: 64 }),
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
  /** The cloud execution this call served (0949) — scalar id, no FK (this table
   *  lives in the operational database). Null for every non-run surface. It is the
   *  join key behind a run's structured model+token turns and their trace deep-link. */
  executionId:       integer('execution_id'),
  tenantApiKeyId:    uuid('tenant_api_key_id'),
  llmProduct:        varchar('llm_product', { length: 32 }),
  /** chat | image | ide-chat | brain | dataset-gen | agent | cloud | knowledge-ai | legal-ai */
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


/** Polymorphic AI evaluation of a proposal (a bid) OR a deliverable proposal —
 *  the LLM-as-judge (semanticEval) verdict scoring it against the posting's
 *  requirements/acceptance criteria. History-preserving (one row per eval run). */
export const proposalEvaluations = pgTable('proposal_evaluations', {
  id:                 varchar('id', { length: 36 }).primaryKey(),
  tenantId:           integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  subjectType:        varchar('subject_type', { length: 20 }).notNull(),   // job_proposal|deliverable
  subjectId:          varchar('subject_id', { length: 36 }).notNull(),
  /** The posting the bid was against — `job_postings.id`, owned by the hiring
   *  domain. An id and not a `.references()`: §3 routes cross-domain references by
   *  id, and the FK itself is declared in migration 0293. */
  jobId:              varchar('job_id', { length: 36 }),
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


/** Training dataset for an IDE project (0022). */
export const ideDatasets = pgTable('ide_datasets', {
  id:               text('id').primaryKey(),
  projectId:        integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name:             text('name').notNull(),
  description:      text('description'),
  capabilityPrompt: text('capability_prompt').notNull(),
  r2Key:            text('r2_key').notNull().default(''),
  exampleCount:     integer('example_count').notNull().default(0),
  status:           text('status').notNull().default('pending'),
  // GOVERNANCE (0936). What the corpus is ALLOWED to be, so `POST /training` can refuse a
  // use the classification forbids — the one path where the mistake cannot be undone,
  // because weights cannot be un-trained. Shapes are owned by
  // `@builderforce/creation-canvas-contract/dataGovernance`; NULL means "nobody
  // classified this", which the gate reads exactly as it reads today's rows.
  classifications:  jsonb('classifications').$type<ColumnClassification[]>(),
  usePolicy:        jsonb('use_policy').$type<DatasetUsePolicy>(),
  /** The canvas object and session this corpus was promoted from, so a refusal can name
   *  the CARD a person has to fix rather than an opaque dataset id. */
  sourceSessionId:  text('source_session_id'),
  sourceObjectId:   text('source_object_id'),
  createdAt:        timestamp('created_at').notNull().defaultNow(),
  updatedAt:        timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byProject: index('idx_ide_datasets_project_id').on(t.projectId),
}));


/** A fine-tune run and its eval scorecard (0022, eval columns added in 0323). */
export const ideTrainingJobs = pgTable('ide_training_jobs', {
  id:                    text('id').primaryKey(),
  projectId:             integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  datasetId:             text('dataset_id').references(() => ideDatasets.id, { onDelete: 'set null' }),
  baseModel:             text('base_model').notNull(),
  loraRank:              integer('lora_rank').notNull().default(8),
  epochs:                integer('epochs').notNull().default(3),
  batchSize:             integer('batch_size').notNull().default(4),
  learningRate:          real('learning_rate').notNull().default(0.0002),
  status:                text('status').notNull().default('pending'),
  currentEpoch:          integer('current_epoch').notNull().default(0),
  currentLoss:           real('current_loss'),
  r2ArtifactKey:         text('r2_artifact_key'),
  errorMessage:          text('error_message'),
  evalScore:             real('eval_score'),
  evalCodeCorrectness:   real('eval_code_correctness'),
  evalReasoningQuality:  real('eval_reasoning_quality'),
  evalHallucinationRate: real('eval_hallucination_rate'),
  evalDetails:           text('eval_details'),
  evaluatedAt:           timestamp('evaluated_at'),
  createdAt:             timestamp('created_at').notNull().defaultNow(),
  updatedAt:             timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byProject: index('idx_ide_training_jobs_project_id').on(t.projectId),
}));


/** Streamed per-step log lines for a training job (0022). */
export const ideTrainingLogs = pgTable('ide_training_logs', {
  id:        text('id').primaryKey(),
  jobId:     text('job_id').notNull().references(() => ideTrainingJobs.id, { onDelete: 'cascade' }),
  epoch:     integer('epoch'),
  step:      integer('step'),
  loss:      real('loss'),
  message:   text('message').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  byJob: index('idx_ide_training_logs_job_id').on(t.jobId),
}));

// ═══ PRD 20 §5 step 2 — target-schema tables ═══
//
// Agents & runtime — the platform's ten remaining targets (PRD 20 §3.2).
//
// 75 source tables in → 40 out, 28 absorbed by the kernel: every execution,
// attempt and step is a `runs` row in one self-referencing tree, every dispatch
// is a `deliveries` row, every model-usage number is a `metric_fact`.
//
// One flattening move ran here (§3.2): `agent_host_projects` was ≤3 payload
// columns — the thin move — so it is a JSONB key on the host rather than a table.
//
// THE FOUR CACHES ARE FOUR TABLES ON PURPOSE. `answer_cache`, `enrichment_cache`,
// `geocoder_cache` and `model_locks` look like one shape and are not: they differ
// in key derivation, eviction rule and correctness consequence, and a shared
// cache table would need every one of those as a nullable column — the
// null-padded union §2.2 forbids. They are also NOT `getOrSetCached` L1+L2
// replacements: that primitive is the read-through for tenant-scoped reads, and
// these are cross-tenant, provider-priced, long-lived stores whose whole value is
// that they survive an isolate.

/** A cached answer to a semantically-identical question, keyed by prompt hash.
 *  Cross-tenant by design and therefore explicitly scoped: the cache key includes
 *  the tenant unless the answer is provably tenant-independent. */
export const answerCache = pgTable('answer_cache', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id'),
  /** SHA-256 of (normalised prompt + model + tool set). */
  keyHash:     varchar('key_hash', { length: 64 }).notNull(),
  model:       varchar('model', { length: 96 }),
  answer:      text('answer'),
  payload:     jsonb('payload'),
  tokensSaved: integer('tokens_saved').notNull().default(0),
  hitCount:    integer('hit_count').notNull().default(0),
  lastHitAt:   timestamp('last_hit_at'),
  expiresAt:   timestamp('expires_at'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_answer_cache_key').on(t.tenantId, t.keyHash),
  index('idx_answer_cache_expiry').on(t.expiresAt),
]);

/** A cached enrichment result. Keyed by the provider request, because the SPEND
 *  is what is being avoided — a miss costs money, not just latency. */
export const enrichmentCache = pgTable('enrichment_cache', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id'),
  provider:    varchar('provider', { length: 64 }).notNull(),
  requestHash: varchar('request_hash', { length: 64 }).notNull(),
  payload:     jsonb('payload'),
  /** What the call would have cost, so the saving is reportable rather than
   *  asserted. */
  costCentsAvoided: integer('cost_cents_avoided').notNull().default(0),
  hitCount:    integer('hit_count').notNull().default(0),
  expiresAt:   timestamp('expires_at'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_enrichment_cache_request').on(t.provider, t.requestHash),
  index('idx_enrichment_cache_expiry').on(t.expiresAt),
]);

/** A cached geocode. Genuinely global — an address resolves to the same point
 *  for every tenant — and long-lived, which is why it outlives any isolate cache. */
export const geocoderCache = pgTable('geocoder_cache', {
  id:         serial('id').primaryKey(),
  tenantId:   integer('tenant_id'),
  queryHash:  varchar('query_hash', { length: 64 }).notNull(),
  query:      varchar('query', { length: 500 }),
  latitude:   numeric('latitude', { precision: 9, scale: 6 }),
  longitude:  numeric('longitude', { precision: 9, scale: 6 }),
  country:    varchar('country', { length: 2 }),
  region:     varchar('region', { length: 120 }),
  locality:   varchar('locality', { length: 160 }),
  provider:   varchar('provider', { length: 48 }),
  hitCount:   integer('hit_count').notNull().default(0),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_geocoder_cache_query').on(t.queryHash),
]);

/** A lock held on a model, so two runs do not contend for a rate-limited pool.
 *  Not a cache at all — the row's VALUE is its existence, and its correctness
 *  consequence is a 429 rather than a slower response. */
export const modelLocks = pgTable('model_locks', {
  id:         serial('id').primaryKey(),
  tenantId:   integer('tenant_id'),
  model:      varchar('model', { length: 96 }).notNull(),
  poolKey:    varchar('pool_key', { length: 96 }).notNull().default('default'),
  holderRef:  varchar('holder_ref', { length: 64 }).notNull(),
  acquiredAt: timestamp('acquired_at').notNull().defaultNow(),
  /** A lock with no expiry is a deadlock waiting for a crash. */
  expiresAt:  timestamp('expires_at').notNull(),
  releasedAt: timestamp('released_at'),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_model_locks_pool').on(t.model, t.poolKey),
  index('idx_model_locks_expiry').on(t.expiresAt),
]);

/** One tool call an agent made inside a run. Distinct from the `runs` tree: a
 *  tool call is not an execution, it is an interaction WITHIN one, and it is the
 *  grain a cost or a refusal investigation actually needs. */
export const aiToolCalls = pgTable('ai_tool_calls', {
  id:         bigserial('id', { mode: 'number' }).primaryKey(),
  tenantId:   integer('tenant_id').notNull(),
  runRef:     varchar('run_ref', { length: 64 }),
  messageRef: varchar('message_ref', { length: 64 }),
  /** The ADVERTISED tool name, which is what the prompt contract asserts on. */
  toolName:   varchar('tool_name', { length: 96 }).notNull(),
  arguments:  jsonb('arguments'),
  result:     jsonb('result'),
  /** 'ok' | 'error' | 'refused' | 'timeout'. */
  outcome:    varchar('outcome', { length: 16 }).notNull().default('ok'),
  error:      text('error'),
  latencyMs:  integer('latency_ms'),
  calledAt:   timestamp('called_at').notNull().defaultNow(),
}, (t) => [
  index('idx_ai_tool_calls_run').on(t.tenantId, t.runRef, t.calledAt),
  index('idx_ai_tool_calls_tool').on(t.tenantId, t.toolName, t.outcome),
]);

/** A usage record, at the grain the vendor bills at. Rolled up into
 *  `metric_facts` for charts and into `ledger_entries` for spend — this is the
 *  underlying evidence both are derived from, which is what makes a bill
 *  reconcilable rather than merely reported. */
export const aiUsageRecords = pgTable('ai_usage_records', {
  id:           bigserial('id', { mode: 'number' }).primaryKey(),
  tenantId:     integer('tenant_id').notNull(),
  runRef:       varchar('run_ref', { length: 64 }),
  vendor:       varchar('vendor', { length: 48 }).notNull(),
  model:        varchar('model', { length: 96 }).notNull(),
  /** Whether the tenant's own key paid for it — a BYO row costs the platform 0,
   *  which is why ranking BYO usage by cost reports nothing and ranking it by
   *  tokens reports the truth. */
  isByo:        boolean('is_byo').notNull().default(false),
  inputTokens:  integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  cachedTokens: integer('cached_tokens').notNull().default(0),
  costCents:    numeric('cost_cents', { precision: 14, scale: 4 }).notNull().default('0'),
  latencyMs:    integer('latency_ms'),
  occurredAt:   timestamp('occurred_at').notNull().defaultNow(),
}, (t) => [
  index('idx_ai_usage_records_tenant').on(t.tenantId, t.occurredAt),
  index('idx_ai_usage_records_model').on(t.tenantId, t.vendor, t.model, t.occurredAt),
]);

/** A classification of one inbound email. The message is a kernel `messages`
 *  row; this is what the classifier decided and on which model, so a
 *  re-classification is comparable rather than an unexplained change of mind. */
export const aiEmailClassifications = pgTable('ai_email_classifications', {
  id:         serial('id').primaryKey(),
  tenantId:   integer('tenant_id').notNull(),
  messageRef: varchar('message_ref', { length: 64 }).notNull(),
  /** 'lead' | 'support' | 'billing' | 'spam' | 'internal' | 'other'. */
  label:      varchar('label', { length: 32 }).notNull(),
  confidence: numeric('confidence', { precision: 4, scale: 2 }),
  intent:     varchar('intent', { length: 96 }),
  entities:   jsonb('entities'),
  model:      varchar('model', { length: 96 }),
  /** Set when a human overruled it — the only signal a routing classifier can
   *  learn from. */
  correctedLabel: varchar('corrected_label', { length: 32 }),
  correctedBy: varchar('corrected_by', { length: 64 }),
  classifiedAt: timestamp('classified_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_ai_email_classifications_message').on(t.tenantId, t.messageRef, t.model),
  index('idx_ai_email_classifications_label').on(t.tenantId, t.label, t.classifiedAt),
]);

/** A call handled by a voice agent. The recording and transcript are `artifacts`
 *  derived from one another; this is the call's own shape. */
export const aiVoiceAgentCalls = pgTable('ai_voice_agent_calls', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  objectId:    uuid('object_id').references(() => objects.id, { onDelete: 'cascade' }),
  agentRef:    varchar('agent_ref', { length: 64 }),
  phoneNumberRef: varchar('phone_number_ref', { length: 64 }),
  direction:   varchar('direction', { length: 12 }).notNull().default('inbound'),
  counterparty: varchar('counterparty', { length: 40 }),
  startedAt:   timestamp('started_at'),
  endedAt:     timestamp('ended_at'),
  durationSec: integer('duration_sec'),
  /** 'completed' | 'no_answer' | 'busy' | 'failed' | 'transferred'. */
  outcome:     varchar('outcome', { length: 16 }),
  transferredTo: varchar('transferred_to', { length: 64 }),
  recordingArtifactId: uuid('recording_artifact_id'),
  costCents:   numeric('cost_cents', { precision: 12, scale: 4 }),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('idx_ai_voice_agent_calls_tenant').on(t.tenantId, t.startedAt),
]);

/** A competitor the platform's own agents track. */
export const aiCompetitors = pgTable('ai_competitors', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  name:        varchar('name', { length: 200 }).notNull(),
  website:     varchar('website', { length: 255 }),
  category:    varchar('category', { length: 96 }),
  positioning: text('positioning'),
  strengths:   jsonb('strengths'),
  weaknesses:  jsonb('weaknesses'),
  pricingSummary: text('pricing_summary'),
  lastReviewedAt: timestamp('last_reviewed_at'),
  watchEnabled: boolean('watch_enabled').notNull().default(true),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_ai_competitors_name').on(t.tenantId, t.name),
]);

/** One action a workflow node performs. The workflow's EXECUTION is a `runs`
 *  tree; this is the authored definition of what the node does, which is edited
 *  and versioned rather than emitted. */
export const workflowActions = pgTable('workflow_actions', {
  id:           serial('id').primaryKey(),
  tenantId:     integer('tenant_id').notNull(),
  workflowRef:  varchar('workflow_ref', { length: 64 }).notNull(),
  nodeId:       varchar('node_id', { length: 96 }).notNull(),
  /** Mirrors WorkflowNodeKind — trigger | agent | llm | mcp | connector | memory
   *  | knowledge | train | transform | filter | branch | output. */
  kind:         varchar('kind', { length: 32 }).notNull(),
  label:        varchar('label', { length: 200 }),
  config:       jsonb('config'),
  /** Set for a `connector` node: the manifest action it invokes on a
   *  `connections` row, which is what stops a vendor needing DDL (0410). */
  connectionId: integer('connection_id'),
  actionKey:    varchar('action_key', { length: 96 }),
  position:     integer('position').notNull().default(0),
  enabled:      boolean('enabled').notNull().default(true),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_workflow_actions_node').on(t.tenantId, t.workflowRef, t.nodeId),
]);


/**
 * The run-context CONTINUITY store (0952) — what a run has already been TOLD.
 *
 * One row per (scope, subject): the current belief a run holds about one context block
 * (its PRD, its governance, its strategy…). `application/runtime/runContextService.ts`
 * wraps it as an Evermind `CognitionFactStore`, so `EvermindCognition.commit()` decides
 * augment / confirm / supersede / reject against it and every surface — cloud, on-prem,
 * VS Code — is handed the DELTA rather than the whole blob on every turn.
 *
 * `scope` is the continuity key (`task:<id>` for a cloud re-run, `session:<key>` on-prem,
 * `chat:<id>` in VS Code); `subject_key` is the canonical Evermind key. Uniqueness on
 * (tenant_id, scope, subject_key) is what makes a write REPLACE rather than accumulate —
 * the single-incumbent guarantee, enforced by the database rather than by convention.
 */
export const runContextState = pgTable('run_context_state', {
  id:         bigserial('id', { mode: 'number' }).primaryKey(),
  tenantId:   integer('tenant_id').notNull(),
  scope:      varchar('scope', { length: 160 }).notNull(),
  subjectKey: varchar('subject_key', { length: 512 }).notNull(),
  /** The belief itself — the block body, with the reconciler's provenance header. */
  content:    text('content').notNull(),
  importance: real('importance').notNull().default(0.6),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_run_context_state_subject').on(t.tenantId, t.scope, t.subjectKey),
  index('idx_run_context_state_scope').on(t.tenantId, t.scope, t.updatedAt),
]);

/**
 * preview_sessions (0949) — the LEASE behind one live container preview.
 *
 * The preview transport (signed token → `preview.builderforce.ai/<tok>/*` → the run's
 * AgentContainerDO → its dev server) has no concept of cost. This row is that concept:
 * a container instance held open for an editor tab, countable per tenant and globally,
 * with a MEASURED `lastSeenAt` so "nobody is watching this any more" is a fact rather
 * than a timeout guess.
 *
 * Read by `application/runtime/previewSessions.ts` — the ONE place the instance budget,
 * the per-tenant concurrency cap and the idle-eviction policy are decided.
 */
export const previewSessions = pgTable('preview_sessions', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:   uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  executionId: integer('execution_id').notNull().references(() => executions.id, { onDelete: 'cascade' }),
  /** Denormalised so "the live preview for THIS project" is one indexed read — the
   *  Mobile panel mints by project and has no execution id to offer. */
  projectId:   integer('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  /** The port the dev server was told to bind inside the container. */
  port:        integer('port').notNull(),
  /** starting | live | failed | idle_evicted | stopped — see PreviewSessionStatus. */
  status:      varchar('status', { length: 16 }).notNull().default('starting'),
  /** Health-check / failure detail, so "no preview" can say WHY. */
  detail:      text('detail'),
  startedAt:   timestamp('started_at').notNull().defaultNow(),
  /** Last real preview request served through the ingress; idle eviction reads this. */
  lastSeenAt:  timestamp('last_seen_at').notNull().defaultNow(),
  stoppedAt:   timestamp('stopped_at'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_preview_sessions_execution').on(t.executionId),
  index('idx_preview_sessions_tenant_status').on(t.tenantId, t.status, t.lastSeenAt),
  index('idx_preview_sessions_status_seen').on(t.status, t.lastSeenAt),
  index('idx_preview_sessions_project').on(t.tenantId, t.projectId, t.status),
]);
