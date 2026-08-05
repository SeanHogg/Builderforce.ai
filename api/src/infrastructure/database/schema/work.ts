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
import {
  bigint,
  bigserial,
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
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { brainChats, facts } from './brain';
import { teams } from './collaboration';
import { agentTypeEnum, projectStatusEnum, sourceControlProviderEnum, specStatusEnum, taskPriorityEnum, taskTypeEnum, workflowTaskStatusEnum } from './common';
import { prodIncidents, productReleases } from './delivery';
import { securityAudits, sourceControlIntegrations, ticketAudits } from './governance';
import { segments, tenants, users } from './identity';
import { integrationCredentials } from './platform';
import { initiatives } from './pmo';
import { agentHostDirectories, agentHosts, agentMemory, agents, executions, importRuns, jobPostings, ticketRuns, workflowDefinitions, workflows } from './runtime';


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
  uniqueIndex('uidx_ticket_participants_slot').on(t.taskId, t.stageKey, t.roleKey, t.responsibility, t.source),
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
  executionId: integer('execution_id'),
  path:        text('path').notNull(),
  /** 'created' | 'modified' | 'deleted'. */
  change:      text('change').notNull(),
  /** Executing agent label (attribution). */
  agent:       text('agent').notNull(),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  byTask: index('idx_task_file_changes_task').on(t.taskId, t.createdAt),
}));
