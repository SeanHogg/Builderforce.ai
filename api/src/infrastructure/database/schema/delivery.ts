/**
 * Schema — Delivery & work, owned by the **Manager** (PRD 20 §3).
 *
 * Root entity `work_item`. 123 source tables in → 54 out, 48 of them absorbed by
 * the kernel. Builderforce contributed 37 of the survivors — it owns this domain
 * the way hired.video owns hiring.
 *
 * Merged from `work.ts`, `pmo.ts` and `delivery.ts` (PRD 20 §5 step 2). Portfolios,
 * initiatives, objectives, key results, epics, tasks and milestones were split
 * across three files and 25 tables; they are ONE tree with a `kind`, which is what
 * kernel `work_items` now holds. `portfolios` = `initiatives` was one of the eight
 * duplicate-shape clusters this repo carried before any merge (§5 step 0), and
 * both are `work_items` kinds now.
 *
 * The three files imported each other in every direction. An import between two
 * files that become one file is not a boundary being crossed — it is a boundary
 * that stopped existing, which is most of how `check-domain-boundary.mjs` went
 * from 82 edges to 38.
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
  pgEnum,
  pgTable,
  primaryKey,
  real,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import {
  agentHostDirectories,
  agentHosts,
  agentMemory,
  agents,
  executions,
  importRuns,
  jobPostings,
  repoAnalysisRuns,
  telemetrySpans,
  ticketRuns,
  workflowDefinitions,
  workflows,
} from './agents';
import { brainChats, creationSessions, facts, teams } from './canvas';
import { budgets } from './finance';
import { securityAudits, sourceControlIntegrations, ticketAudits } from './governance';
import { onCallMembers, segments, tenants, users } from './identity';
import {
  AlertMetric,
  agentTypeEnum,
  catalogItems,
  deploymentStatusEnum,
  objects,
  projectStatusEnum,
  reportScheduleEnum,
  reportTypeEnum,
  snapshots,
  sourceControlProviderEnum,
  specStatusEnum,
  taskPriorityEnum,
  taskTypeEnum,
  workflowTaskStatusEnum,
} from './kernel';
import { integrationCredentials } from './platform';

// ═══ from work.ts ═══
/**
 * Schema — work context.
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
  /** Migration lineage: allows a completed external import to be rolled back safely. */
  importRunId:     uuid('import_run_id'),
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
  /** Vanity hostname the tenant owns. Only routable once BOTH ownership is
   *  proven and a certificate exists, so it is meaningless without the
   *  lifecycle columns below (0412). `unset → pending_dns → pending_certificate
   *  → active`, or `failed`. */
  customDomain:            varchar('custom_domain', { length: 255 }),
  customDomainStatus:      varchar('custom_domain_status', { length: 24 }).notNull().default('unset'),
  /** Published by the tenant as a TXT record at `_builderforce-challenge.<domain>`
   *  and resolved over DNS-over-HTTPS, so proving ownership needs no zone access. */
  customDomainToken:       varchar('custom_domain_token', { length: 64 }),
  customDomainVerifiedAt:  timestamp('custom_domain_verified_at'),
  /** Cloudflare for SaaS custom-hostname id, once the cert has been requested. */
  customDomainHostnameId:  varchar('custom_domain_hostname_id', { length: 64 }),
  customDomainError:       text('custom_domain_error'),
  /** The `website` canvas card published as this site's LANDING PAGE (0473) —
   *  the creator's own shop window, in their own brand, on their own address.
   *
   *  A column and not a table: a site has exactly one landing page. Referenced
   *  by id rather than by a foreign key into `creation_session_objects` because
   *  the canvas is a different bounded context, and a published landing page
   *  must survive its source card being deleted (the bytes are already in R2)
   *  rather than cascade a live site to nothing. NULL = the site serves the app
   *  at `/`, exactly as before this existed. */
  landingObjectId:         uuid('landing_object_id'),
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
  /** For an EPIC (0364): which reasoning step produced its children — 'llm' (a real
   *  BA-style assessment), 'heuristic' (the degraded markdown-checklist fallback the
   *  LLM decomposer drops to on any failure) or 'manual' (a caller-supplied plan).
   *  Null on anything never decomposed. Makes "why does this Epic look like shredded
   *  markdown?" answerable from the row instead of unanswerable. */
  decompositionSource: varchar('decomposition_source', { length: 16 }),
  persona:           varchar('persona', { length: 50 }),
  /** Origin board provider label for tickets synced from an external board. */
  source:            varchar('source', { length: 24 }),
  /** Migration lineage; null for normal/synced work created outside an import commit. */
  importRunId:       uuid('import_run_id'),
  // PRD/spec link moved to the task_specs junction (0098): a task references 1..N
  // project PRDs (one optional primary) — see `taskSpecs` below.
  archived:          boolean('archived').notNull().default(false),
  /** Gig Marketplace (0293): this work item is published (or publishable) as a
   *  hireable gig, and the back-ref to the published posting. Canonical link is
   *  jobPostings.sourceTicketId; jobPostingId is a denormalized convenience kept in
   *  sync on publish so the board can badge "Published" without a reverse scan. */
  hireable:          boolean('hireable').notNull().default(false),
  jobPostingId:      varchar('job_posting_id', { length: 36 }),
  /** App-user loop (0920, R10): this ticket was RAISED by a submission to a
   *  `site_collections.raises_tickets` collection, and the back-ref to that
   *  submission. Same shape as jobPostingId just above — a plain, FK-less column;
   *  the growth domain (`site_records`) is the owner and delivery references it
   *  only by id. Null on every ticket opened any other way. Read backwards by
   *  {@link notifySiteRecordTicketDone} when the ticket reaches Done, which is the
   *  return leg that closes the loop back to the person who reported it. */
  originSiteRecordId: bigint('origin_site_record_id', { mode: 'number' }),
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
  /** May the manager place unscheduled tickets on the timeline (0364)? Ranking says
   *  what to do FIRST; scheduling says WHEN — before this existed nothing wrote a date,
   *  so the manager's own urgency term scored an always-null column. Only fills tickets
   *  with NEITHER date; a human-set date is never overwritten. */
  autoSchedule:      boolean('auto_schedule').notNull().default(true),
  /** The manager's DOMAIN focus/persona (see managerTypes.ts): a built-in ('general' |
   *  'delivery' | 'qa' | 'service_desk' | 'devops') or a `role:<key>` custom-role type
   *  (up to a 60-char role key). Shapes what it values + prioritizes. */
  managerType:       varchar('manager_type', { length: 80 }).notNull().default('general'),
  /** Self-governance precondition (0362): the manager may complete a ticket + merge its
   *  PR autonomously ONLY when every REQUIRED participation slot has signed off. Default
   *  FALSE since 0380 — this is the project's own opt-in to a review gate, and a
   *  default-on gate that nothing satisfied stalled 265 of 679 tickets on the reference
   *  board. NOT NULL on purpose (unlike `allowAutoMerge`): whether this project requires
   *  sign-off is a decision the project owns, so the column always states it outright
   *  rather than deferring to a workspace row. See signoffGate.ts + managerPolicy.ts. */
  requireSignoffToComplete: boolean('require_signoff_to_complete').notNull().default(false),
  /** MERGE AUTHORITY for this project (0363) — may the manager merge unattended AT ALL,
   *  as opposed to `prMergePolicy`, which only says HOW a permitted merge happens.
   *  NULLABLE unlike its siblings, and that is the point: null = "inherit the workspace
   *  tier" (`tenant_manager_defaults`, itself falling back to the hardcoded false), so a
   *  project that has never expressed an opinion is not pinned to one by a column
   *  default. Both this and requireSignoffToComplete must pass before a merge. */
  allowAutoMerge:    boolean('allow_auto_merge'),
  /** CEREMONY AUTONOMY for this project (0364). All four are nullable — null = "inherit
   *  the workspace tier". They live here rather than in a ceremony-specific table because
   *  "what may the manager do unattended" is one question with one fold. */
  allowUnattendedCeremonies:  boolean('allow_unattended_ceremonies'),
  allowAgentReassignment:     boolean('allow_agent_reassignment'),
  agentReassignIdleHours:     integer('agent_reassign_idle_hours'),
  agentReassignMaxPerSession: integer('agent_reassign_max_per_session'),
  /** May the manager staff a lane that authorises NO role at all (0386)? Nullable =
   *  inherit. A lane with no requirement and no staffed agent can never dispatch on a
   *  managed board, and the manager can fix that — but doing so turns an intake pile into
   *  auto-dispatching work, so it is a grant rather than a default. */
  allowAutoStaffLanes: boolean('allow_auto_staff_lanes'),
  lastRunAt:         timestamp('last_run_at'),
  createdAt:         timestamp('created_at').notNull().defaultNow(),
  updatedAt:         timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byProject: uniqueIndex('uq_project_manager_configs_project').on(t.tenantId, t.projectId),
}));


/**
 * Append-only ticket-lifecycle event log — one row per status (lane) move. The
 * keystone for redo / idle-after-done / time-in-status / DORA cycle+lead time.
 * Emitted from PATCH /api/tasks/:id. `isBackward` (move to a lower-ordinal
 * swimlane) is the redo signal; `actorKind`/`actorRef` record who moved it. See
 * migration 0117.
 *
 * `actorKind` is the (kind, ref) convention shared with `activity_log.actor_type`:
 * 'human' | 'cloud_agent' | 'host_agent' | 'system', where 'system' means automation
 * with NO identity to name (a cron sweep, a webhook) rather than "not a person".
 * `actorRef` is the bare per-kind id, resolvable by `resolveActorByRef`. Written only
 * by `taskLifecycle.recordStatusTransition` — see `resolveTransitionActor` (0377).
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
  // Set by the Tools `sleep` node kind on its first visit (now + delaySeconds);
  // the cloud dispatcher's readiness gate holds a `pending` task with deps
  // satisfied until this passes. Null for every other kind — see cloudExecutor.ts.
  notBefore:   timestamp('not_before'),
  startedAt:   timestamp('started_at'),
  completedAt: timestamp('completed_at'),
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


export const teamProjects = pgTable('team_projects', {
  id:        serial('id').primaryKey(),
  teamId:    integer('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  addedAt:   timestamp('added_at').notNull().defaultNow(),
}, (t) => [
  unique('uq_team_project').on(t.teamId, t.projectId),
]);


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
  /** PROVENANCE + TTL (0371) — the same contract `agentMemory` carries, so one service
   *  governs both stores. `source` is this table's origin marker. */
  originExecutionId: integer('origin_execution_id'),
  expiresAt:  timestamp('expires_at'),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
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
  // NULL stage keys are a real slot (the ticket-wide/default stage), not an
  // invitation to create unlimited duplicates. PostgreSQL's ordinary UNIQUE
  // semantics treat NULLs as distinct, so this must be NULLS NOT DISTINCT.
  unique('uidx_ticket_participants_slot')
    .on(t.taskId, t.stageKey, t.roleKey, t.responsibility, t.source)
    .nullsNotDistinct(),
  index('idx_ticket_participants_task').on(t.taskId),
  index('idx_ticket_participants_tenant').on(t.tenantId),
  index('idx_ticket_participants_child').on(t.childTaskId),
]);


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
  /** Migration lineage; makes a migration-created sync connection reversible. */
  importRunId:     uuid('import_run_id'),
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


/**
 * Per-agent file-change traceability for a ticket's shared workspace (0089).
 * Each row = one file the executing agent created/modified/deleted.
 */
export const taskFileChanges = pgTable('task_file_changes', {
  id:          bigserial('id', { mode: 'number' }).primaryKey(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  taskId:      integer('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  executionId: integer('execution_id').notNull().references(() => executions.id, { onDelete: 'cascade' }),
  path:        text('path').notNull(),
  /** 'created' | 'modified' | 'deleted'. */
  change:      text('change').notNull(),
  /** Executing agent label (attribution). */
  agent:       text('agent').notNull(),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  byTask: index('idx_task_file_changes_task').on(t.taskId, t.createdAt),
}));


// ---------------------------------------------------------------------------
// Challenge pipeline + project backends (migration 0411)
// ---------------------------------------------------------------------------

/**
 * A project's own credential vault — the values ITS deployed backend runs with.
 *
 * Deliberately separate from `connector_connections`: a connection is "the
 * tenant's production Slack, callable by agents"; a project secret is scoped to
 * one project's running system (the Twilio auth token its webhook verifier needs,
 * a signing key, a partner API key). Collapsing them would let any deployed
 * project backend read every credential the tenant owns.
 *
 * `valueEnc`/`iv` are AES-256-GCM sealed with the per-tenant derived key — the
 * same `credentialCrypto` contract every other credential store uses. `hint` is
 * the last 4 plaintext characters so the UI can identify WHICH token is stored
 * without ever reading the value back.
 */
export const projectSecrets = pgTable('project_secrets', {
  id:             uuid('id').primaryKey().defaultRandom(),
  projectId:      integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  tenantId:       integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  /** Env-var style name (`[A-Z][A-Z0-9_]*`), validated in the application. */
  name:           varchar('name', { length: 128 }).notNull(),
  valueEnc:       text('value_enc').notNull(),
  iv:             varchar('iv', { length: 64 }).notNull(),
  description:    text('description'),
  hint:           varchar('hint', { length: 8 }),
  createdByUserId: varchar('created_by_user_id', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  createdAt:      timestamp('created_at').notNull().defaultNow(),
  updatedAt:      timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  unique('uq_project_secrets_project_name').on(t.projectId, t.name),
  index('idx_project_secrets_project').on(t.projectId),
]);

/**
 * Where a project's SERVER-SIDE half runs. One row per project.
 *
 * `strategy` names a BackendHostingStrategy (application/backend/hostingStrategy):
 * `declarative` (handlers/*.json in the canvas, executed by this worker at
 * `/hooks/<ingressToken>/…`) or `github-worker` (a real Worker generated into the
 * user's repo and deployed to THEIR Cloudflare account).
 *
 * `ingressToken` is the unguessable public path segment webhooks are delivered
 * to. It is NOT a bearer secret — per-handler provider signature verification is
 * the real authentication; the token only prevents enumeration.
 */
export const projectBackends = pgTable('project_backends', {
  id:             uuid('id').primaryKey().defaultRandom(),
  projectId:      integer('project_id').notNull().unique().references(() => projects.id, { onDelete: 'cascade' }),
  tenantId:       integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  strategy:       varchar('strategy', { length: 32 }).notNull().default('declarative'),
  status:         varchar('status', { length: 16 }).notNull().default('active'),
  ingressToken:   varchar('ingress_token', { length: 48 }).notNull().unique(),
  deployedUrl:    varchar('deployed_url', { length: 500 }),
  lastDeployedAt: timestamp('last_deployed_at'),
  handlerCount:   integer('handler_count').notNull().default(0),
  createdAt:      timestamp('created_at').notNull().defaultNow(),
  updatedAt:      timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_project_backends_tenant').on(t.tenantId),
]);

/**
 * Where a canvas-authored game gets played. One row per (project, game, target).
 *
 * `target` names a GameTarget (application/game/gameTarget.ts): `web`, `pwa`,
 * `android`, `ios` or `roblox`. No CHECK constraint on it, deliberately — a sixth
 * target should land as an adapter rather than as a migration.
 *
 * `directory` is stored rather than derived because `android` and `ios` share ONE
 * Capacitor project directory: they are the same app built by two runners, and
 * materialising them separately would give the author two copies to keep in sync.
 *
 * The Roblox ids address an experience that already EXISTS. Open Cloud can
 * replace a place's contents but cannot create an experience, so the first
 * publish is always a human in Studio; everything after it is one call.
 */
export const projectGameTargets = pgTable('project_game_targets', {
  id:              uuid('id').primaryKey().defaultRandom(),
  projectId:       integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  tenantId:        integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  /** The game's file-safe stem; a project may hold several games. */
  slug:            varchar('slug', { length: 64 }).notNull(),
  title:           varchar('title', { length: 200 }).notNull().default(''),
  target:          varchar('target', { length: 24 }).notNull(),
  status:          varchar('status', { length: 24 }).notNull().default('materialized'),
  directory:       varchar('directory', { length: 256 }).notNull().default(''),
  fileCount:       integer('file_count').notNull().default(0),
  playUrl:         text('play_url'),
  detail:          text('detail'),
  /** The adapter's `SetupStep[]` — what the human still has to do. */
  setupSteps:      jsonb('setup_steps').notNull().default(sql`'[]'::jsonb`),
  robloxUniverseId: varchar('roblox_universe_id', { length: 32 }),
  robloxPlaceId:   varchar('roblox_place_id', { length: 32 }),
  robloxVersion:   integer('roblox_version'),
  lastPublishedAt: timestamp('last_published_at'),
  createdAt:       timestamp('created_at').notNull().defaultNow(),
  updatedAt:       timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  unique('uq_project_game_targets').on(t.projectId, t.slug, t.target),
  index('idx_project_game_targets_project').on(t.projectId),
  index('idx_project_game_targets_tenant').on(t.tenantId),
]);

/**
 * One row per inbound webhook delivery — the "did Twilio actually reach us, and
 * what did we say back?" trail. Bodies are NOT stored (they carry message content
 * and customer PII); the shape, verdict and timing are.
 */
export const projectBackendRequests = pgTable('project_backend_requests', {
  id:          bigserial('id', { mode: 'number' }).primaryKey(),
  projectId:   integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  route:       varchar('route', { length: 255 }).notNull(),
  method:      varchar('method', { length: 8 }).notNull(),
  statusCode:  integer('status_code').notNull(),
  /** 'ok' | 'unverified' | 'no-handler' | 'error' */
  verdict:     varchar('verdict', { length: 24 }).notNull(),
  durationMs:  integer('duration_ms'),
  error:       text('error'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('idx_project_backend_requests_project_time').on(t.projectId, t.createdAt),
]);

/**
 * A pasted brief (a contest, an RFP, a hackathon prompt) and everything the
 * platform derived from it.
 *
 * `spec` is the extracted structured requirement set; `plan` is what the platform
 * decided to build. Both persist so a challenge is re-openable and "why did it
 * build that?" is answerable without re-running the model.
 */
export const challenges = pgTable('challenges', {
  id:            uuid('id').primaryKey().defaultRandom(),
  tenantId:      integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  /** Set once BUILT; null while the challenge is only parsed + planned. */
  projectId:     integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
  title:         varchar('title', { length: 255 }).notNull(),
  sponsor:       varchar('sponsor', { length: 255 }),
  brief:         text('brief').notNull(),
  spec:          jsonb('spec').notNull().default(sql`'{}'::jsonb`),
  plan:          jsonb('plan').notNull().default(sql`'{}'::jsonb`),
  blueprintKey:  varchar('blueprint_key', { length: 64 }),
  /** 'parsed' → 'planned' → 'building' → 'built' → 'failed' */
  status:        varchar('status', { length: 16 }).notNull().default('parsed'),
  error:         text('error'),
  createdByUserId: varchar('created_by_user_id', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_challenges_tenant_time').on(t.tenantId, t.createdAt),
  index('idx_challenges_project').on(t.projectId),
]);

/**
 * One act of making an idea REAL, in one particular way.
 *
 * An idea has many proofs over its life — a demo video, then a smoke test, then
 * a wizard-of-oz, then the system — and each is a separate act with its own
 * outcome. That is why this is a table and not a column on `challenges`: a
 * `realization_key` column there could hold exactly one, which would make the
 * question the whole feature exists to answer ("what have we already tried, and
 * what did it tell us?") unanswerable.
 *
 * `challengeId` is nullable because a realization does not require a pasted
 * brief — an idea typed straight into the Realize page has a spec and no
 * challenge row, and refusing to record its proof would be the tail wagging the
 * dog.
 *
 * `plan` and `result` persist for the same reason the challenge's do: so "why
 * did it build that?" and "what did it actually write?" are answerable without
 * re-running anything.
 */
export const realizations = pgTable('realizations', {
  id:            uuid('id').primaryKey().defaultRandom(),
  tenantId:      integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  /** The brief this proof is of, when it came from one. */
  challengeId:   uuid('challenge_id').references(() => challenges.id, { onDelete: 'set null' }),
  /** Set once BUILT; null while the realization is only planned. */
  projectId:     integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
  /** A RealizationKey — `demo-video`, `smoke-test`, `live-system`, … */
  targetKey:     varchar('target_key', { length: 48 }).notNull(),
  title:         varchar('title', { length: 255 }).notNull(),
  /** Where the backend runs. Only `live-system` may be anything but its default. */
  strategy:      varchar('strategy', { length: 32 }).notNull().default('declarative'),
  spec:          jsonb('spec').notNull().default(sql`'{}'::jsonb`),
  plan:          jsonb('plan').notNull().default(sql`'{}'::jsonb`),
  /** What the build actually produced — files, tickets, readiness, live URL. */
  result:        jsonb('result').notNull().default(sql`'{}'::jsonb`),
  /** The address a person can open. Null until it has been built and published. */
  liveUrl:       varchar('live_url', { length: 500 }),
  /** 'planned' → 'building' → 'built' → 'failed' */
  status:        varchar('status', { length: 16 }).notNull().default('planned'),
  error:         text('error'),
  /**
   * 'met' | 'missed' | 'abandoned'. `met`/`missed` are rolled up from the
   * decisive call a generated proof's own console recorded — never typed here
   * directly. `abandoned` is the one value a person sets: it has no number to
   * compute, only a judgement to make. See `application/realization/realizationVerdict.ts`.
   */
  verdict:       varchar('verdict', { length: 16 }),
  /** The number that decided it, straight from the console that computed it —
   *  e.g. `{ metricLabel: 'Signups', metricValue: 31, target: 25, sample: 500 }`. */
  verdictMetric: jsonb('verdict_metric'),
  /** When the verdict was recorded. Distinct from `updatedAt`, which a rebuild
   *  also bumps without touching the verdict. */
  decidedAt:     timestamp('decided_at'),
  /**
   * The Creation Session whose idea this proof is of.
   *
   * The outcome ledger's grain is the session, so this link is what lets the
   * loop — read the idea, choose a proof, build it, grade its kill condition —
   * be MEASURED rather than merely performed. Nullable because a proof can be
   * started outside a board; such a proof simply never enters the ledger.
   */
  sessionId:     uuid('session_id').references(() => creationSessions.id, { onDelete: 'set null' }),
  createdByUserId: varchar('created_by_user_id', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_realizations_tenant_time').on(t.tenantId, t.createdAt),
  index('idx_realizations_challenge').on(t.challengeId),
  index('idx_realizations_project').on(t.projectId),
  index('idx_realizations_session').on(t.sessionId),
]);


// ═══ from pmo.ts ═══
/**
 * Schema — pmo context.
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


// ═══ from delivery.ts ═══
/**
 * Schema — delivery context.
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
  /**
   * Where this update sits in its lifecycle — 'in_development' | 'private_beta' |
   * 'public_beta' | 'live' | 'sunset'. A STAGE is not a category: category says
   * what kind of change it is, stage says how far along it is and therefore
   * whether it can be joined or is about to be withdrawn. (0448)
   */
  stage:       varchar('stage', { length: 24 }).notNull().default('live'),
  /** Users may enrol themselves. Only meaningful on a beta stage — a private beta
   *  left opt-in false is invitation-only and never offered in the banner. */
  betaOptIn:   boolean('beta_opt_in').notNull().default(false),
  /** The agreement a user accepts when joining. NULL → the generic platform beta
   *  terms are shown instead, so an operator never ships a consent-free join. */
  betaTerms:   text('beta_terms'),
  /** "Scheduled for release" on a beta; "upcoming sunset" date on a sunset. One
   *  column because it is one fact — the date this stage ends. */
  stageEndsAt: timestamp('stage_ends_at'),
  publishedAt: timestamp('published_at'),
  emailedAt:   timestamp('emailed_at'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
});


/**
 * A user's standing with ONE beta — joined, left, or "not now" (dismissed the
 * banner). One row per (release note, user): the enrolment IS the fact, and its
 * `status` is the current state of it, so a leave/rejoin updates in place rather
 * than growing a history nobody reads.
 *
 * `agreedAt` + `agreedTermsHash` are the consent record: WHEN they agreed and to
 * WHICH text, hashed so editing the terms afterwards is detectable rather than
 * silently rewriting what someone signed. A dismissal carries neither — declining
 * is not consent. (0448)
 */
export const releaseNoteBetaEnrollments = pgTable('release_note_beta_enrollments', {
  id:              uuid('id').primaryKey().defaultRandom(),
  releaseNoteId:   uuid('release_note_id').notNull().references(() => releaseNotes.id, { onDelete: 'cascade' }),
  userId:          varchar('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** 'joined' | 'left' | 'dismissed'. */
  status:          varchar('status', { length: 16 }).notNull().default('joined'),
  agreedAt:        timestamp('agreed_at'),
  agreedTermsHash: varchar('agreed_terms_hash', { length: 64 }),
  createdAt:       timestamp('created_at').notNull().defaultNow(),
  updatedAt:       timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  noteUserUnique: uniqueIndex('uq_release_note_beta_enrollment').on(table.releaseNoteId, table.userId),
  userIdx:        index('idx_release_note_beta_enrollment_user').on(table.userId),
}));


export const apiErrorLog = pgTable('api_error_log', {
  id:        serial('id').primaryKey(),
  scopeTenantId: integer('tenant_id'),
  method:    varchar('method', { length: 10 }),
  path:      varchar('path', { length: 500 }),
  source:    varchar('source', { length: 500 }),
  operation: varchar('operation', { length: 255 }),
  handled:   boolean('handled').notNull().default(false),
  context:   jsonb('context').notNull().default(sql`'{}'::jsonb`),
  message:   text('message'),
  stack:     text('stack'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  tenantCreatedIdx: index('idx_api_error_log_tenant_created').on(table.scopeTenantId, table.createdAt),
  sourceOperationIdx: index('idx_api_error_log_source_operation').on(table.source, table.operation, table.createdAt),
}));


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
  /** What this schedule is ABOUT, when its report type needs a subject (mig 0461).
   *  'canvas_frame' for a board pack; null for the five computed types, which are
   *  about the tenant. Opaque and resolved by the generator rather than joined —
   *  a typed FK here would be the polymorphic-FK violation the guard exists to catch. */
  subjectKind:  varchar('subject_kind', { length: 32 }),
  subjectRef:   varchar('subject_ref', { length: 160 }),
  lastRunAt:    timestamp('last_run_at'),
  nextRunAt:    timestamp('next_run_at'),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
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
// Stage Sandbox (migration 0478) — real execution behind marketplace Stage
// checks. One row per dispatched (or cap-refused) sandbox run: a disposable
// Cloudflare Container boots the staged snapshot, drives it, and reports
// findings back. `payloadHash` — not `snapshotId` — is what the publish gate
// matches on (see application/marketplace/stageSandboxRuns.ts and
// domain/marketplace/stageSandboxPayload.ts).
// ---------------------------------------------------------------------------

export const stageSandboxRuns = pgTable('stage_sandbox_runs', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenantId:     integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  snapshotId:   uuid('snapshot_id').notNull().references(() => snapshots.id, { onDelete: 'cascade' }),
  listingId:    uuid('listing_id').references(() => catalogItems.id, { onDelete: 'set null' }),
  payloadHash:  varchar('payload_hash', { length: 64 }).notNull(),
  // 'runtime' | 'media' — the only two harnesses a container can drive.
  harness:      varchar('harness', { length: 16 }).notNull(),
  // 'queued' | 'running' | 'passed' | 'failed' | 'error' | 'capped'
  status:       varchar('status', { length: 16 }).notNull().default('queued'),
  findings:     jsonb('findings'),   // StageCheck[] the container established
  summary:      text('summary'),
  errorMessage: text('error_message'),
  durationMs:   integer('duration_ms'),
  createdBy:    varchar('created_by', { length: 36 }),
  startedAt:    timestamp('started_at'),
  finishedAt:   timestamp('finished_at'),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_stage_sandbox_runs_lookup').on(t.tenantId, t.payloadHash, t.createdAt),
  index('idx_stage_sandbox_runs_meter').on(t.tenantId, t.createdAt),
]);


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
}, (t) => ({
  /** Provider identity is one row, even when webhook/finalize/reconciliation race. */
  byProviderNumber: uniqueIndex('uq_pull_requests_provider_number')
    .on(t.tenantId, t.repoId, t.number)
    .where(sql`${t.repoId} is not null and ${t.number} is not null`),
}));

/** One deterministic GitHub↔ticket audit by the dedicated reconciliation agent. */
export const prReconciliationRuns = pgTable('pr_reconciliation_runs', {
  id:                uuid('id').primaryKey().defaultRandom(),
  tenantId:          integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  projectId:         integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  repoId:            uuid('repo_id').notNull().references(() => projectRepositories.id, { onDelete: 'cascade' }),
  agentRef:          varchar('agent_ref', { length: 64 }),
  mode:              varchar('mode', { length: 16 }).notNull().default('dry_run'),
  status:            varchar('status', { length: 24 }).notNull().default('running'),
  requestedBy:       varchar('requested_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  approvedPrNumbers: jsonb('approved_pr_numbers').notNull().default([]),
  summary:           jsonb('summary').notNull().default({}),
  errorCount:        integer('error_count').notNull().default(0),
  startedAt:         timestamp('started_at').notNull().defaultNow(),
  finishedAt:        timestamp('finished_at'),
});

/** Evidence and recommendation retained for every PR seen in a reconciliation run. */
export const prReconciliationItems = pgTable('pr_reconciliation_items', {
  id:                uuid('id').primaryKey().defaultRandom(),
  runId:             uuid('run_id').notNull().references(() => prReconciliationRuns.id, { onDelete: 'cascade' }),
  tenantId:          integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  repoId:            uuid('repo_id').notNull().references(() => projectRepositories.id, { onDelete: 'cascade' }),
  prNumber:          integer('pr_number').notNull(),
  prUrl:             varchar('pr_url', { length: 500 }).notNull(),
  title:             text('title').notNull(),
  headBranch:        varchar('head_branch', { length: 255 }),
  taskId:            integer('task_id').references(() => tasks.id, { onDelete: 'set null' }),
  taskStatus:        varchar('task_status', { length: 64 }),
  classification:    varchar('classification', { length: 32 }).notNull(),
  recommendedAction: varchar('recommended_action', { length: 32 }).notNull(),
  confidence:        varchar('confidence', { length: 16 }).notNull(),
  reasonCodes:       jsonb('reason_codes').notNull().default([]),
  checkSummary:      jsonb('check_summary').notNull().default({}),
  evidence:          jsonb('evidence').notNull().default({}),
  appliedAction:     varchar('applied_action', { length: 32 }),
  appliedAt:         timestamp('applied_at'),
  createdAt:         timestamp('created_at').notNull().defaultNow(),
});

/** Every collection/classification/action error, readable from the diagnostics API. */
export const prReconciliationErrors = pgTable('pr_reconciliation_errors', {
  id:        uuid('id').primaryKey().defaultRandom(),
  runId:     uuid('run_id').references(() => prReconciliationRuns.id, { onDelete: 'cascade' }),
  tenantId:  integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  repoId:    uuid('repo_id').references(() => projectRepositories.id, { onDelete: 'set null' }),
  prNumber:  integer('pr_number'),
  phase:     varchar('phase', { length: 32 }).notNull(),
  code:      varchar('code', { length: 64 }).notNull(),
  message:   text('message').notNull(),
  stack:     text('stack'),
  details:   jsonb('details').notNull().default({}),
  createdAt: timestamp('created_at').notNull().defaultNow(),
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

// ═══ PRD 20 §5 step 2 — target-schema tables ═══
//
// Delivery & work — the Manager's fifteen remaining targets (PRD 20 §3.2).
//
// 123 source tables in → 54 out, 48 absorbed by the kernel. The two biggest
// absorptions are the reason this domain finally has invariants to enforce:
// `work_items` takes task, epic, story, subtask, objective, key result,
// initiative, milestone and the scored `feature` into one tree with a `kind`
// (§3.3), and `runs` takes every execution, attempt and step.
//
// `work_items` and `catalog_items` are the Delivery targets the kernel already
// declares, which is why they are not repeated here — a domain may not fork a
// kernel primitive (§0).
//
// `portfolios` = `initiatives` was one of the eight duplicate-shape clusters this
// repo carried before any merge (§5 step 0), and both are `work_items` kinds now.

/** A board column. A lane, not a status enum: a project's swimlanes define its
 *  board, which is the rule migration 0076 already established and the reason a
 *  `work_items.status` is a free-form varchar. */
export const kanbanColumns = pgTable('kanban_columns', {
  id:         serial('id').primaryKey(),
  tenantId:   integer('tenant_id').notNull(),
  boardRef:   varchar('board_ref', { length: 64 }).notNull(),
  key:        varchar('key', { length: 48 }).notNull(),
  label:      varchar('label', { length: 160 }).notNull(),
  position:   integer('position').notNull().default(0),
  /** WIP limit. Null means unlimited; 0 means the column is closed. */
  wipLimit:   integer('wip_limit'),
  /** Whether landing here means the item is done — one definition, so the
   *  cycle-time rollup and the board badge cannot disagree. */
  isTerminal: boolean('is_terminal').notNull().default(false),
  /** Whether an autonomous agent may move items into this lane unattended. */
  autoRunEnabled: boolean('auto_run_enabled').notNull().default(false),
  colorToken: varchar('color_token', { length: 48 }),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_kanban_columns_key').on(t.tenantId, t.boardRef, t.key),
]);

/** A commitment coming out of a conversation. Distinct from a `work_items` task:
 *  an action item is captured mid-discussion with no board, no estimate and no
 *  lane, and forcing it onto a board at capture time is how it stops being
 *  captured at all. Promoting one CREATES a work item and records the link. */
export const actionItems = pgTable('action_items', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  objectId:    uuid('object_id').references(() => objects.id, { onDelete: 'cascade' }),
  /** Where it was raised — a ceremony, a thread, a document. */
  sourceRef:   varchar('source_ref', { length: 64 }),
  title:       varchar('title', { length: 300 }).notNull(),
  detail:      text('detail'),
  ownerRef:    varchar('owner_ref', { length: 64 }),
  dueAt:       timestamp('due_at'),
  /** 'open' | 'done' | 'promoted' | 'dropped'. */
  status:      varchar('status', { length: 16 }).notNull().default('open'),
  promotedWorkItemRef: varchar('promoted_work_item_ref', { length: 64 }),
  createdBy:   varchar('created_by', { length: 64 }),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_action_items_owner').on(t.tenantId, t.ownerRef, t.status, t.dueAt),
]);

/** One step in an approval. The DECISION is `sign_offs`; this is the routing —
 *  who was asked, in what order, and whether their turn has come. */
export const approvalActions = pgTable('approval_actions', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  subjectKind: varchar('subject_kind', { length: 32 }).notNull(),
  subjectRef:  varchar('subject_ref', { length: 64 }).notNull(),
  approverKind: varchar('approver_kind', { length: 16 }).notNull().default('user'),
  approverRef: varchar('approver_ref', { length: 64 }).notNull(),
  step:        integer('step').notNull().default(1),
  /** 'waiting' | 'active' | 'done' | 'skipped'. */
  state:       varchar('state', { length: 16 }).notNull().default('waiting'),
  requestedAt: timestamp('requested_at'),
  actedAt:     timestamp('acted_at'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_approval_actions_approver').on(t.tenantId, t.subjectKind, t.subjectRef, t.approverRef, t.step),
]);

/** A recorded approval decision. Immutable: re-approving writes a new row, so
 *  "who signed this off, and against which version" survives a later change. */
export const signOffs = pgTable('sign_offs', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  subjectKind: varchar('subject_kind', { length: 32 }).notNull(),
  subjectRef:  varchar('subject_ref', { length: 64 }).notNull(),
  /** The `revisions.version` that was signed off, so an edit invalidates it
   *  visibly rather than silently. */
  subjectVersion: integer('subject_version'),
  approverRef: varchar('approver_ref', { length: 64 }).notNull(),
  /** 'approved' | 'rejected' | 'approved_with_comments'. */
  decision:    varchar('decision', { length: 32 }).notNull(),
  comment:     text('comment'),
  decidedAt:   timestamp('decided_at').notNull().defaultNow(),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('idx_sign_offs_subject').on(t.tenantId, t.subjectKind, t.subjectRef, t.decidedAt),
]);

/** A release plan. */
export const releasePlans = pgTable('release_plans', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  objectId:    uuid('object_id').references(() => objects.id, { onDelete: 'cascade' }),
  projectRef:  varchar('project_ref', { length: 64 }),
  name:        varchar('name', { length: 200 }).notNull(),
  version:     varchar('version', { length: 48 }),
  summary:     text('summary'),
  targetAt:    timestamp('target_at'),
  releasedAt:  timestamp('released_at'),
  /** 'planned' | 'in_progress' | 'frozen' | 'released' | 'rolled_back'. */
  status:      varchar('status', { length: 16 }).notNull().default('planned'),
  /** Set when a pre-merge build failure produced a fix ticket rather than a
   *  silent red build (migration 0196's contract). */
  blockedByRef: varchar('blocked_by_ref', { length: 64 }),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_release_plans_name').on(t.tenantId, t.projectRef, t.name),
]);

/** An estimate on one work item. A row rather than a column because estimates
 *  are RE-estimated, and comparing the first to the last is the only way to know
 *  whether a team is getting better at estimating. */
export const taskEffortEstimates = pgTable('task_effort_estimates', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  workItemRef: varchar('work_item_ref', { length: 64 }).notNull(),
  /** 'points' | 'hours' | 'tshirt'. */
  unit:        varchar('unit', { length: 16 }).notNull().default('points'),
  value:       numeric('value', { precision: 10, scale: 2 }),
  tshirt:      varchar('tshirt', { length: 8 }),
  estimatorKind: varchar('estimator_kind', { length: 16 }).notNull().default('user'),
  estimatorRef: varchar('estimator_ref', { length: 64 }),
  confidence:  numeric('confidence', { precision: 4, scale: 2 }),
  estimatedAt: timestamp('estimated_at').notNull().defaultNow(),
  isCurrent:   boolean('is_current').notNull().default(true),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('idx_task_effort_estimates_item').on(t.tenantId, t.workItemRef, t.estimatedAt),
]);

/** Time booked against a work item. Distinct from `timesheets` (Finance), which
 *  is a PERIOD claim for billing; this is the per-item grain a cycle-time
 *  analysis reads. */
export const taskTimeEntries = pgTable('task_time_entries', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  workItemRef: varchar('work_item_ref', { length: 64 }).notNull(),
  workerRef:   varchar('worker_ref', { length: 64 }).notNull(),
  startedAt:   timestamp('started_at'),
  endedAt:     timestamp('ended_at'),
  minutes:     integer('minutes').notNull().default(0),
  /** 'manual' | 'timer' | 'derived' — derived means inferred from activity, and
   *  the distinction is what stops inferred time being invoiced. */
  source:      varchar('source', { length: 12 }).notNull().default('manual'),
  isBillable:  boolean('is_billable').notNull().default(false),
  note:        text('note'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_task_time_entries_item').on(t.tenantId, t.workItemRef, t.startedAt),
  index('idx_task_time_entries_worker').on(t.tenantId, t.workerRef, t.startedAt),
]);

/** An item on a synchronisation meeting's agenda. */
export const syncAgendaItems = pgTable('sync_agenda_items', {
  id:         serial('id').primaryKey(),
  tenantId:   integer('tenant_id').notNull(),
  ceremonyRef: varchar('ceremony_ref', { length: 64 }).notNull(),
  title:      varchar('title', { length: 300 }).notNull(),
  detail:     text('detail'),
  ownerRef:   varchar('owner_ref', { length: 64 }),
  minutes:    integer('minutes'),
  position:   integer('position').notNull().default(0),
  /** 'pending' | 'covered' | 'deferred'. */
  status:     varchar('status', { length: 16 }).notNull().default('pending'),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_sync_agenda_items_pos').on(t.tenantId, t.ceremonyRef, t.position),
]);

/** How a two-way sync conflict was settled. The importer's cursor is a
 *  `sync_states` row; this is the per-record adjudication, which has to be
 *  auditable because it silently discards somebody's edit. */
export const syncConflictResolutions = pgTable('sync_conflict_resolutions', {
  id:           serial('id').primaryKey(),
  tenantId:     integer('tenant_id').notNull(),
  connectionId: integer('connection_id'),
  resource:     varchar('resource', { length: 96 }).notNull(),
  localRef:     varchar('local_ref', { length: 64 }),
  remoteRef:    varchar('remote_ref', { length: 160 }),
  field:        varchar('field', { length: 96 }),
  localValue:   text('local_value'),
  remoteValue:  text('remote_value'),
  /** 'local_wins' | 'remote_wins' | 'merged' | 'manual'. */
  resolution:   varchar('resolution', { length: 16 }).notNull(),
  resolvedBy:   varchar('resolved_by', { length: 64 }),
  resolvedAt:   timestamp('resolved_at').notNull().defaultNow(),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('idx_sync_conflict_resolutions_conn').on(t.tenantId, t.connectionId, t.resolvedAt),
]);

/** A measured queue in the flow, with where it hurts. Not a `metric_fact`: a
 *  fact is a number in a series, and this carries the DIAGNOSIS — which stage,
 *  which cause, what to do — which is the part a number cannot hold. */
export const bottleneckAnalysis = pgTable('bottleneck_analysis', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  projectRef:  varchar('project_ref', { length: 64 }),
  stage:       varchar('stage', { length: 64 }).notNull(),
  periodStart: timestamp('period_start').notNull(),
  periodEnd:   timestamp('period_end').notNull(),
  itemsEntered: integer('items_entered').notNull().default(0),
  itemsExited: integer('items_exited').notNull().default(0),
  avgWaitHours: numeric('avg_wait_hours', { precision: 10, scale: 2 }),
  p90WaitHours: numeric('p90_wait_hours', { precision: 10, scale: 2 }),
  /** 'capacity' | 'dependency' | 'review' | 'external' | 'unclear'. */
  cause:       varchar('cause', { length: 24 }),
  recommendation: text('recommendation'),
  computedAt:  timestamp('computed_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_bottleneck_analysis_period').on(t.tenantId, t.projectRef, t.stage, t.periodStart),
]);

/** Who has how much room, by period. */
export const capacityHeatmaps = pgTable('capacity_heatmaps', {
  id:           serial('id').primaryKey(),
  tenantId:     integer('tenant_id').notNull(),
  subjectKind:  varchar('subject_kind', { length: 16 }).notNull().default('user'),
  subjectRef:   varchar('subject_ref', { length: 64 }).notNull(),
  periodStart:  timestamp('period_start').notNull(),
  periodEnd:    timestamp('period_end').notNull(),
  capacityHours: numeric('capacity_hours', { precision: 8, scale: 2 }).notNull().default('0'),
  committedHours: numeric('committed_hours', { precision: 8, scale: 2 }).notNull().default('0'),
  utilisation:  numeric('utilisation', { precision: 5, scale: 2 }),
  /** 'under' | 'healthy' | 'at_risk' | 'over' — banded once so every surface
   *  colours the same cell the same way. */
  band:         varchar('band', { length: 16 }),
  computedAt:   timestamp('computed_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_capacity_heatmaps_subject').on(t.tenantId, t.subjectKind, t.subjectRef, t.periodStart),
]);

/** What a sprint cost and what it returned. The bridge Delivery shares with
 *  Finance, kept as a row because it is reconciled rather than recomputed. */
export const sprintFinancialImpact = pgTable('sprint_financial_impact', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  sprintRef:   varchar('sprint_ref', { length: 64 }).notNull(),
  projectRef:  varchar('project_ref', { length: 64 }),
  laborCost:   numeric('labor_cost', { precision: 16, scale: 2 }).notNull().default('0'),
  toolingCost: numeric('tooling_cost', { precision: 16, scale: 2 }).notNull().default('0'),
  aiCost:      numeric('ai_cost', { precision: 16, scale: 2 }).notNull().default('0'),
  deliveredValue: numeric('delivered_value', { precision: 16, scale: 2 }),
  currency:    varchar('currency', { length: 8 }).notNull().default('USD'),
  computedAt:  timestamp('computed_at').notNull().defaultNow(),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_sprint_financial_impact_sprint').on(t.tenantId, t.sprintRef),
]);

/** A company inside a portfolio. The portfolio itself is a `work_items` row of
 *  kind `initiative` — `portfolios` = `initiatives` was a duplicate-shape cluster
 *  — and this is the membership of a COMPANY in it, which carries an ownership
 *  stake a kernel `memberships` row does not model. */
export const portfolioCompanies = pgTable('portfolio_companies', {
  id:           serial('id').primaryKey(),
  tenantId:     integer('tenant_id').notNull(),
  portfolioRef: varchar('portfolio_ref', { length: 64 }).notNull(),
  companyRef:   varchar('company_ref', { length: 64 }).notNull(),
  ownershipPercent: numeric('ownership_percent', { precision: 6, scale: 3 }),
  investedAmount: numeric('invested_amount', { precision: 18, scale: 2 }),
  currency:     varchar('currency', { length: 8 }).notNull().default('USD'),
  /** 'active' | 'exited' | 'written_off'. */
  status:       varchar('status', { length: 16 }).notNull().default('active'),
  addedAt:      timestamp('added_at').notNull().defaultNow(),
  exitedAt:     timestamp('exited_at'),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_portfolio_companies_company').on(t.tenantId, t.portfolioRef, t.companyRef),
]);

/** An ordered entry in a portfolio view. Kept because the ORDER is editorial —
 *  how the CEO wants the portfolio read — which is not a property of the company
 *  and not derivable from any of its numbers. */
export const portfolioItems = pgTable('portfolio_items', {
  id:           serial('id').primaryKey(),
  tenantId:     integer('tenant_id').notNull(),
  portfolioRef: varchar('portfolio_ref', { length: 64 }).notNull(),
  itemKind:     varchar('item_kind', { length: 32 }).notNull(),
  itemRef:      varchar('item_ref', { length: 64 }).notNull(),
  headline:     varchar('headline', { length: 300 }),
  position:     integer('position').notNull().default(0),
  isFeatured:   boolean('is_featured').notNull().default(false),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_portfolio_items_item').on(t.tenantId, t.portfolioRef, t.itemKind, t.itemRef),
]);

/** An ordered entry on a `lists` row. The list is Revenue's; the ordering
 *  primitive is shared, which is why this is one table rather than one per
 *  list scope. */
export const listItems = pgTable('list_items', {
  id:        serial('id').primaryKey(),
  tenantId:  integer('tenant_id').notNull(),
  listRef:   varchar('list_ref', { length: 64 }).notNull(),
  itemKind:  varchar('item_kind', { length: 32 }).notNull(),
  itemRef:   varchar('item_ref', { length: 64 }).notNull(),
  note:      text('note'),
  position:  integer('position').notNull().default(0),
  addedBy:   varchar('added_by', { length: 64 }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_list_items_item').on(t.tenantId, t.listRef, t.itemKind, t.itemRef),
]);

