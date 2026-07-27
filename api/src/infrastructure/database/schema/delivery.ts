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
import {
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
import { sql } from 'drizzle-orm';
import { brainChats } from './brain';
import { teams } from './collaboration';
import { AlertMetric, deploymentStatusEnum, reportScheduleEnum, reportTypeEnum } from './common';
import { onCallMembers, segments, tenants, users } from './identity';
import { repoAnalysisRuns, telemetrySpans, workflows } from './runtime';
import { monitoringBoards, projectRepositories, projects, specs, tasks } from './work';


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
