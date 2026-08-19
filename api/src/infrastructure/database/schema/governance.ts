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
import { approvalStatusEnum, privacyRequestStatusEnum, privacyRequestTypeEnum, sourceControlProviderEnum } from './kernel';
import { segments, tenants, users } from './identity';
import { agentHosts, agents } from './agents';
import { boards, initiatives, projects, tasks } from './delivery';
import type { AnswerMap, DevexSegments, SurveyQuestion } from '../../../domain/devex/surveys';


export const privacyRequests = pgTable('privacy_requests', {
  id:           serial('id').primaryKey(),
  userId:       varchar('user_id', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  email:        varchar('email', { length: 255 }).notNull(),
  requestType:  privacyRequestTypeEnum('request_type').notNull(),
  details:      text('details'),
  status:       privacyRequestStatusEnum('status').notNull().default('pending'),
  resolution:   text('resolution'),
  jurisdiction: varchar('jurisdiction', { length: 32 }),
  parentRequestId: integer('parent_request_id'),
  dueAt:        timestamp('due_at'),
  verifiedAt:   timestamp('verified_at'),
  fulfillmentEvidence: jsonb('fulfillment_evidence'),
  processorDeletionStatus: jsonb('processor_deletion_status'),
  backupDisposition: text('backup_disposition'),
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
// Stakeholder alignment — project priorities, sign-off and escalation (0452)
// ---------------------------------------------------------------------------

export const stakeholderMapEntries = pgTable('stakeholder_map_entries', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenantId:       integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:      uuid('segment_id').notNull().references(() => segments.id, { onDelete: 'cascade' }),
  projectId:      integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  initiativeId:   uuid('initiative_id').references(() => initiatives.id, { onDelete: 'set null' }),
  stakeholderRef: varchar('stakeholder_ref', { length: 64 }).notNull(),
  displayName:    varchar('display_name', { length: 255 }).notNull(),
  role:           varchar('role', { length: 24 }).notNull(), // required_approver | informed
  teamScope:      varchar('team_scope', { length: 120 }),
  priority:       text('priority'),
  active:         boolean('active').notNull().default(true),
  createdAt:      timestamp('created_at').notNull().defaultNow(),
  updatedAt:      timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_stakeholder_map_project_ref').on(t.tenantId, t.projectId, t.stakeholderRef),
  index('idx_stakeholder_map_project').on(t.tenantId, t.segmentId, t.projectId, t.active),
]);

export const stakeholderHealthProfiles = pgTable('stakeholder_health_profiles', {
  id:        uuid('id').primaryKey().defaultRandom(),
  tenantId:  integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId: uuid('segment_id').notNull().references(() => segments.id, { onDelete: 'cascade' }),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  answers:   jsonb('answers').notNull(),
  score:     integer('score').notNull(),
  updatedBy: varchar('updated_by', { length: 64 }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_stakeholder_health_project').on(t.tenantId, t.projectId),
]);

export const stakeholderPrioritySubmissions = pgTable('stakeholder_priority_submissions', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenantId:       integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:      uuid('segment_id').notNull().references(() => segments.id, { onDelete: 'cascade' }),
  projectId:      integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  stakeholderRef: varchar('stakeholder_ref', { length: 64 }).notNull(),
  teamScope:      varchar('team_scope', { length: 120 }).notNull(),
  priorityKey:    varchar('priority_key', { length: 160 }).notNull(),
  rationale:      text('rationale'),
  submittedAt:    timestamp('submitted_at').notNull().defaultNow(),
}, (t) => [
  index('idx_stakeholder_priority_window').on(t.tenantId, t.projectId, t.teamScope, t.submittedAt),
]);

export const stakeholderConflicts = pgTable('stakeholder_conflicts', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:   uuid('segment_id').notNull().references(() => segments.id, { onDelete: 'cascade' }),
  projectId:   integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  signature:   varchar('signature', { length: 255 }).notNull(),
  teamScope:   varchar('team_scope', { length: 120 }).notNull(),
  priorityKeys: jsonb('priority_keys').notNull(),
  stakeholderRefs: jsonb('stakeholder_refs').notNull(),
  summary:     text('summary').notNull(),
  status:      varchar('status', { length: 16 }).notNull().default('open'),
  detectedAt:  timestamp('detected_at').notNull().defaultNow(),
  resolvedAt:  timestamp('resolved_at'),
}, (t) => [
  uniqueIndex('uq_stakeholder_conflict_signature').on(t.tenantId, t.projectId, t.signature),
  index('idx_stakeholder_conflicts_project').on(t.tenantId, t.projectId, t.status, t.detectedAt),
]);

export const stakeholderAlignmentReviews = pgTable('stakeholder_alignment_reviews', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:   uuid('segment_id').notNull().references(() => segments.id, { onDelete: 'cascade' }),
  projectId:   integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  subjectRef:  varchar('subject_ref', { length: 160 }).notNull(),
  summary:     text('summary').notNull(),
  requiredApproverRefs: jsonb('required_approver_refs').notNull(),
  status:      varchar('status', { length: 16 }).notNull().default('in_review'),
  dueAt:       timestamp('due_at').notNull(),
  createdBy:   varchar('created_by', { length: 64 }),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_stakeholder_reviews_project').on(t.tenantId, t.projectId, t.status, t.dueAt),
]);

export const stakeholderAlignmentResponses = pgTable('stakeholder_alignment_responses', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenantId:       integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  reviewId:       uuid('review_id').notNull().references(() => stakeholderAlignmentReviews.id, { onDelete: 'cascade' }),
  stakeholderRef: varchar('stakeholder_ref', { length: 64 }).notNull(),
  response:       varchar('response', { length: 32 }).notNull(),
  comment:        text('comment'),
  respondedAt:    timestamp('responded_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_stakeholder_response_reviewer').on(t.reviewId, t.stakeholderRef),
]);

export const stakeholderEscalations = pgTable('stakeholder_escalations', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenantId:       integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:      uuid('segment_id').notNull().references(() => segments.id, { onDelete: 'cascade' }),
  projectId:      integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  reviewId:       uuid('review_id').notNull().references(() => stakeholderAlignmentReviews.id, { onDelete: 'cascade' }),
  level:          integer('level').notNull().default(1),
  ownerRef:       varchar('owner_ref', { length: 64 }),
  status:         varchar('status', { length: 16 }).notNull().default('open'),
  deadlineAt:     timestamp('deadline_at').notNull(),
  reminder24hAt:  timestamp('reminder_24h_at'),
  reminder4hAt:   timestamp('reminder_4h_at'),
  outcome:        text('outcome'),
  createdAt:      timestamp('created_at').notNull().defaultNow(),
  resolvedAt:     timestamp('resolved_at'),
}, (t) => [
  uniqueIndex('uq_stakeholder_escalation_level').on(t.reviewId, t.level),
  index('idx_stakeholder_escalations_due').on(t.tenantId, t.status, t.deadlineAt),
]);

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

// ═══ PRD 20 §5 step 2 — target-schema tables ═══
//
// Governance & security — the Security seat's two remaining targets
// (PRD 20 §3.2).
//
// 27 source tables in → 15 out. The smallest absorption in the model, and that
// is the right answer: a control, an evidence item and a finding are distinct
// nouns with their own columns, and collapsing them would make an audit
// unauditable. What DID absorb is the surrounding noise — every compliance
// event is an `activity_log` row, every policy pack a `catalog_items` row, every
// attestation a `responses` row against a `question_sets` scorecard.

/** A record that somebody accepted a legal document.
 *
 *  Deliberately not an `annotations` row and not a kernel `settings` flag: an
 *  acceptance must record WHICH VERSION was accepted, from which IP, at which
 *  moment, and must be immutable afterwards. A settings row is last-write-wins,
 *  which is the one property a consent record may not have. */
export const legalDocumentAcceptances = pgTable('legal_document_acceptances', {
  id:           serial('id').primaryKey(),
  tenantId:     integer('tenant_id'),
  /** 'terms' | 'privacy' | 'dpa' | 'aup' | 'nda' | 'cookie'. */
  documentKind: varchar('document_kind', { length: 32 }).notNull(),
  documentVersion: varchar('document_version', { length: 32 }).notNull(),
  /** The published text as it stood — a hash, not the body, so the acceptance is
   *  verifiable without storing the document once per acceptance. */
  documentHash: varchar('document_hash', { length: 64 }),
  partyKind:    varchar('party_kind', { length: 16 }).notNull().default('user'),
  partyRef:     varchar('party_ref', { length: 64 }).notNull(),
  email:        varchar('email', { length: 320 }),
  acceptedAt:   timestamp('accepted_at').notNull().defaultNow(),
  ipAddress:    varchar('ip_address', { length: 45 }),
  userAgent:    varchar('user_agent', { length: 500 }),
  /** Set only when a later version supersedes this acceptance. The row itself is
   *  never updated in place. */
  supersededAt: timestamp('superseded_at'),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_legal_document_acceptances_party').on(t.partyKind, t.partyRef, t.documentKind, t.documentVersion),
  index('idx_legal_document_acceptances_tenant').on(t.tenantId, t.documentKind, t.acceptedAt),
]);

/** A one-time WebAuthn challenge.
 *
 *  Short-lived, single-use and never readable twice — which is why it is a table
 *  rather than a cache entry: a replayed challenge is an authentication bypass,
 *  so consumption has to be a transactional UPDATE, not a best-effort delete
 *  from a store that may or may not have evicted it. */
export const webauthnChallenges = pgTable('webauthn_challenges', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id'),
  userRef:     varchar('user_ref', { length: 64 }),
  /** 'registration' | 'authentication'. */
  purpose:     varchar('purpose', { length: 16 }).notNull(),
  /** Base64url. Unique so a replay collides at the database rather than in code. */
  challenge:   varchar('challenge', { length: 255 }).notNull(),
  rpId:        varchar('rp_id', { length: 255 }),
  /** Set the moment it is used. A non-null value is a terminal state. */
  consumedAt:  timestamp('consumed_at'),
  expiresAt:   timestamp('expires_at').notNull(),
  ipAddress:   varchar('ip_address', { length: 45 }),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_webauthn_challenges_challenge').on(t.challenge),
  index('idx_webauthn_challenges_expiry').on(t.expiresAt),
]);


// ---------------------------------------------------------------------------
// DevEx surveys (migration 0229) — the pulse-survey framework behind the DevEx
// lens and SPACE Satisfaction.
//
// These three tables, the DevFinOps trio and `recommendation_dismissals` below
// were each declared inside the feature that queried them
// (`application/devex/devexSurveys.ts`, `application/finops/finopsTables.ts`,
// `application/insights/recommendationsEngine.ts`), on the reasoning that the
// feature "owns" its table. The cost was real: the application layer declared
// DDL and imported the infrastructure barrel to reference `tenants`, the
// `schema.tables.test.ts` render sweep never saw them (so a broken reference
// thunk surfaced as a 500, not a failing test), `drizzle-kit` did not generate
// their DDL, and a table name could collide with a canonical one unnoticed —
// which is exactly what `finops_soc_controls` did against `soc_controls` and
// what migration 0254 had to repair.
//
// The vocabulary they are typed against lives in `domain/devex/surveys.ts`, so
// a question type means the same thing to the validator and to the column.
// ---------------------------------------------------------------------------

export const devexSurveyTemplates = pgTable('devex_survey_templates', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:   uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  name:        varchar('name', { length: 160 }).notNull(),
  description: text('description').notNull().default(''),
  questions:   jsonb('questions').$type<SurveyQuestion[]>().notNull().default([]),
  isActive:    boolean('is_active').notNull().default(true),
  createdBy:   varchar('created_by', { length: 36 }),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_devex_templates_tenant').on(t.tenantId),
]);

export const devexCampaigns = pgTable('devex_campaigns', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:   uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  /** NULL = a workspace-wide campaign (the original and still the default). Set =
   *  the campaign asks ONE project's team, which is what lets the project-grained
   *  SPACE lens report a real Satisfaction score instead of an engagement proxy. */
  projectId:   integer('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  templateId:  integer('template_id').references(() => devexSurveyTemplates.id, { onDelete: 'set null' }),
  title:       varchar('title', { length: 200 }).notNull(),
  periodMonth: varchar('period_month', { length: 7 }),
  status:      varchar('status', { length: 16 }).notNull().default('open').$type<'open' | 'closed'>(),
  anonymous:   boolean('anonymous').notNull().default(true),
  recipientCount: integer('recipient_count'),
  openedAt:    timestamp('opened_at').notNull().defaultNow(),
  closedAt:    timestamp('closed_at'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('idx_devex_campaigns_tenant').on(t.tenantId),
]);

export const devexResponses = pgTable('devex_responses', {
  id:             serial('id').primaryKey(),
  tenantId:       integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  campaignId:     integer('campaign_id').notNull().references(() => devexCampaigns.id, { onDelete: 'cascade' }),
  respondentHash: varchar('respondent_hash', { length: 64 }),
  userId:         varchar('user_id', { length: 36 }),
  answers:        jsonb('answers').$type<AnswerMap>().notNull().default({}),
  segments:       jsonb('segments').$type<DevexSegments>().notNull().default({}),
  submittedAt:    timestamp('submitted_at').notNull().defaultNow(),
}, (t) => [
  index('idx_devex_responses_tenant').on(t.tenantId),
  index('idx_devex_responses_campaign').on(t.campaignId),
  index('idx_devex_responses_dedup').on(t.campaignId, t.respondentHash),
]);


// ---------------------------------------------------------------------------
// DevFinOps (migration 0233) — the R&D-credit definition, the SOC 1 Type II
// control register and the log of assembled audit-period reports.
// ---------------------------------------------------------------------------

/** Per-tenant R&D-credit (QRE) definition — the qualified-research filter + rate. */
export const rdTaxCreditConfig = pgTable('rd_tax_credit_config', {
  tenantId:            integer('tenant_id').primaryKey(),
  qualifiedCategories: jsonb('qualified_categories').$type<string[]>().notNull().default(sql`'["innovation","tech_debt"]'::jsonb`),
  blendedLaborRateUsd: real('blended_labor_rate_usd').notNull().default(95),
  qualifiedActionTypes: jsonb('qualified_action_types').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  updatedAt:           timestamp('updated_at').notNull().defaultNow(),
});

/** SOC 1 Type II controls register — one assertion row per control objective.
 *  The table is `finops_soc_controls`, NOT `soc_controls`: the latter is the
 *  unrelated SOC 2 governance tracker declared above. Colliding on it made
 *  0233's CREATE a no-op and 500'd the finops audit report (repaired by 0254),
 *  which is precisely the failure mode a per-feature table declaration hides and
 *  the barrel's duplicate-name test now catches. */
export const finopsSocControls = pgTable('finops_soc_controls', {
  id:           serial('id').primaryKey(),
  tenantId:     integer('tenant_id').notNull(),
  controlRef:   varchar('control_ref', { length: 32 }).notNull(),
  objective:    varchar('objective', { length: 240 }).notNull(),
  category:     varchar('category', { length: 48 }).notNull().default('general'),
  status:       varchar('status', { length: 16 }).notNull().default('gap'),
  owner:        varchar('owner', { length: 120 }),
  note:         text('note').default(''),
  lastReviewed: timestamp('last_reviewed'),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
});

/** Log of assembled audit-ready period reports (the report itself is computed live). */
export const auditReportRuns = pgTable('audit_report_runs', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  periodMonth: varchar('period_month', { length: 7 }).notNull(),
  generatedBy: varchar('generated_by', { length: 36 }),
  summary:     jsonb('summary'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
});


// ---------------------------------------------------------------------------
// Dismissed recommendations (migration 0232). The recommendations themselves are
// computed live from finance/engineering/allocation insights; only the dismissal
// is persisted, keyed by the rule's stable `rec_key`.
// ---------------------------------------------------------------------------
export const recommendationDismissals = pgTable('recommendation_dismissals', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  recKey:      varchar('rec_key', { length: 120 }).notNull(),
  dismissedBy: varchar('dismissed_by', { length: 36 }),
  dismissedAt: timestamp('dismissed_at').notNull().defaultNow(),
}, (t) => [
  unique('recommendation_dismissals_tenant_id_rec_key_key').on(t.tenantId, t.recKey),
]);
