/**
 * Schema — governance context.
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
  index,
  integer,
  jsonb,
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
import { approvalStatusEnum, privacyRequestStatusEnum, privacyRequestTypeEnum, sourceControlProviderEnum } from './common';
import { segments, tenants, users } from './identity';
import { agentHosts, agents } from './runtime';
import { boards, projects, tasks } from './work';


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
