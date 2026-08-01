/**
 * Schema — collaboration context.
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
import { brainChats } from './brain';
import { activityEventTypeEnum, integrationProviderEnum, newsletterEventTypeEnum, newsletterSubscriptionStatusEnum, teamMemberKindEnum } from './common';
import { errorCollectors, prodIncidents, qaSchedules } from './delivery';
import { ceremonySessions, pokerSessions, segments, tenants, users } from './identity';
import { integrationCredentials } from './platform';
import { agentHosts, agents, executions, workflowTriggers } from './runtime';
import { projects, tasks } from './work';


/**
 * Per-address email consent — the record every LIFECYCLE send checks and no
 * TRANSACTIONAL send does. Keyed on EMAIL, not user id: a cold workspace/chat
 * invite goes to an address with no `users` row, and an unsubscribe taken from
 * that mail must survive both "no account yet" and "account later deleted"
 * (hence `userId` is a nullable ON DELETE SET NULL convenience link, not the key).
 *
 * A MISSING row means "no preference expressed" and reads as all-allowed, exactly
 * like the column defaults — so the reader never has to distinguish the two.
 * `unsubscribedAll` is the CAN-SPAM global opt-out and overrides every category.
 * (0352)
 */
export const emailPreferences = pgTable('email_preferences', {
  id:               uuid('id').primaryKey().defaultRandom(),
  userId:           varchar('user_id', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  email:            varchar('email', { length: 255 }).notNull().unique(),
  productUpdates:   boolean('product_updates').notNull().default(true),
  onboardingTips:   boolean('onboarding_tips').notNull().default(true),
  digests:          boolean('digests').notNull().default(true),
  unsubscribedAll:  boolean('unsubscribed_all').notNull().default(false),
  unsubscribedAt:   timestamp('unsubscribed_at'),
  createdAt:        timestamp('created_at').notNull().defaultNow(),
  updatedAt:        timestamp('updated_at').notNull().defaultNow(),
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
 * Unified activity / audit log (migration 0287) — the ONE canonical, append-only
 * stream of "who did what, to what, when" across the whole workforce: team
 * members, external talent / hires, and AI agents alike. Replaces the fragmented
 * per-domain event tables as the single trace surface; written through the
 * `recordActivity()` emitter (application/activity/activityLog.ts).
 *
 * Actor is polymorphic via (actorType, actorRef) — see the migration header for
 * the per-type ref mapping. actorName is denormalised so the timeline renders
 * without a heterogeneous fan-join. `verb` is free-form so new event kinds need
 * no migration.
 */
export const activityLog = pgTable('activity_log', {
  id:           bigserial('id', { mode: 'number' }).primaryKey(),
  /** Stable producer key for retried projections (for example an execution
   * lifecycle outbox event). Null for legacy/direct activity emitters. */
  eventKey:     varchar('event_key', { length: 160 }),
  /** Nullable ONLY for platform-global events (pre-tenant login/registration),
   *  absorbed from the retired audit_events table (mig 0295). Tenant-scoped reads
   *  filter on tenantId, so a global row is simply invisible to any one tenant. */
  tenantId:     integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:    uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  projectId:    integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
  /** human | hire | cloud_agent | host_agent | system */
  actorType:    varchar('actor_type', { length: 16 }).notNull(),
  /** Id into the per-type table (users.id / ide_agents.id / agent_hosts.id); null for system. */
  actorRef:     varchar('actor_ref', { length: 64 }),
  /** Denormalised display label — avoids a per-row fan-join across actor tables. */
  actorName:    varchar('actor_name', { length: 255 }),
  /** freelancer_engagements.id — binds a cross-tenant hire action; nullable. */
  engagementId: varchar('engagement_id', { length: 36 }),
  /** Free-form action verb: 'task.created', 'comment.added', 'deploy.recorded', … */
  verb:         varchar('verb', { length: 64 }).notNull(),
  targetType:   varchar('target_type', { length: 32 }),
  targetId:     varchar('target_id', { length: 64 }),
  targetLabel:  varchar('target_label', { length: 300 }),
  summary:      text('summary'),
  metadata:     jsonb('metadata'),
  occurredAt:   timestamp('occurred_at').notNull().defaultNow(),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('idx_activity_log_event_key').on(t.eventKey),
  index('idx_activity_log_tenant_time').on(t.tenantId, t.occurredAt),
  index('idx_activity_log_actor').on(t.tenantId, t.actorType, t.actorRef, t.occurredAt),
  index('idx_activity_log_target').on(t.tenantId, t.targetType, t.targetId),
  index('idx_activity_log_project').on(t.tenantId, t.projectId, t.occurredAt),
]);


/** One-time 6-digit email-ownership codes issued at password signup (and re-issued when
 *  an unverified account tries to sign in). The code itself is never stored — only its
 *  SHA-256 hash. A row is consumed on success, superseded when a newer code is issued,
 *  and rejected once `attempts` hits the cap or `expiresAt` passes. (mig 0285) */
export const emailVerificationCodes = pgTable('email_verification_codes', {
  id:         uuid('id').primaryKey().defaultRandom(),
  userId:     varchar('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  email:      varchar('email', { length: 255 }).notNull(),
  codeHash:   varchar('code_hash', { length: 64 }).notNull(),
  expiresAt:  timestamp('expires_at').notNull(),
  attempts:   integer('attempts').notNull().default(0),
  consumedAt: timestamp('consumed_at'),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
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
  avatarUrl:     text('avatar_url'), // unbounded external URL (GitHub/Jira/R2); widened mig 0356
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
  /** Tombstone pointer: when this profile was merged into another, the survivor's
   *  id (and is_active is set false). Kept — not deleted — so the merge is
   *  auditable and reversible. NULL = a live, un-merged contributor. (0205) */
  mergedIntoId:  integer('merged_into_id').references((): AnyPgColumn => contributors.id, { onDelete: 'set null' }),
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
  avatarUrl:     text('avatar_url'), // unbounded external provider URL; widened mig 0356
  createdAt:     timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  unique('uq_identity_provider_external').on(t.tenantId, t.provider, t.externalId),
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
  /** Project this activity is attributed to, resolved at ingest from the connected
   *  repo (project_repositories, else projects.source_control_repo_full_name).
   *  NULL = repo not linked to a project yet. (0212) */
  projectId:      integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
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
  /** Reversibility marker: when a contributor was merged away, its events are
   *  re-pointed to the survivor and stamped with the loser's id here, so an
   *  un-merge can move exactly those rows back set-based. NULL = never moved. (0205) */
  mergedFromContributorId: integer('merged_from_contributor_id'),
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


/**
 * Audit + undo log for contributor consolidation (0205). One row per merge of a
 * `source` (loser, tombstoned) contributor into a `target` (survivor). The bulk
 * reassignment (activity_events) is reversed via activity_events.merged_from_
 * contributor_id; the small things without a column marker (moved/deduped
 * identities, team memberships, the survivor's prior user link) live in
 * undoPayload so a revert can restore them exactly.
 */
export const contributorMerges = pgTable('contributor_merges', {
  id:                   uuid('id').primaryKey().defaultRandom(),
  tenantId:             integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:            uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  targetContributorId:  integer('target_contributor_id').references(() => contributors.id, { onDelete: 'set null' }),
  sourceContributorId:  integer('source_contributor_id').references(() => contributors.id, { onDelete: 'set null' }),
  movedActivityCount:   integer('moved_activity_count').notNull().default(0),
  movedIdentityCount:   integer('moved_identity_count').notNull().default(0),
  undoPayload:          jsonb('undo_payload'),
  status:               varchar('status', { length: 16 }).notNull().default('merged'), // 'merged' | 'reverted'
  mergedByUserId:       varchar('merged_by_user_id', { length: 36 }),
  mergedAt:             timestamp('merged_at').notNull().defaultNow(),
  revertedAt:           timestamp('reverted_at'),
});


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
  /** A team can give itself an avatar (0294) — shown on the team card + as the face
   *  of its team chat. An /api/brain/upload R2 URL or any image URL. */
  avatarUrl:   text('avatar_url'), // unbounded image URL (R2 upload w/ query params); widened mig 0356
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
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
  /** Was this seat EXPECTED (0364)? A roster seat is required; someone who walked into
   *  a live ceremony is not, so an ad-hoc joiner can never be counted a no-show. */
  required:    boolean('required').notNull().default(true),
  /** First / last moment this member was observed in the room (attendance heartbeat). */
  joinedAt:    timestamp('joined_at'),
  leftAt:      timestamp('left_at'),
  /** Resolved verdict written ONCE at conclude (0364): 'unknown' (still open) |
   *  'present' | 'absent' (required, never observed) | 'excused' (optional, never
   *  observed). Absence is a fact, not a fault — see ceremonyAttendance.ts. */
  attendance:  varchar('attendance', { length: 12 }).notNull().default('unknown'),
  /** Provenance of that verdict (0366): 'derived' (inferred from presence/speaking —
   *  recomputable) | 'pto' (approved leave covered the ceremony → excused) | 'manual'
   *  (a manager asserted it; NEVER recomputed). This column is what lets a re-conclude
   *  refresh inferred verdicts without silently discarding a human's correction. */
  attendanceSource: varchar('attendance_source', { length: 12 }).notNull().default('derived'),
  /** Why, in the corrector's own words ("dialled in from the airport"). */
  attendanceNote:   varchar('attendance_note', { length: 280 }),
  /** Who corrected it and when — an absence feeds the rules that can move someone's
   *  work, so changing one is attributable. Null for derived/pto verdicts. */
  attendanceSetBy:  varchar('attendance_set_by', { length: 64 }),
  attendanceSetAt:  timestamp('attendance_set_at'),
  /** When this member was invited to join the live session (guards re-notification). */
  notifiedAt:  timestamp('notified_at'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
});


// ---------------------------------------------------------------------------
// Ceremony schedules (migration 0349) — the cadence layer that makes standups /
// plannings run themselves. The frequent cron sweep (runDueCeremonies) opens a
// ceremony_sessions row with its roster pre-seeded for every enabled row whose
// nextRunAt has elapsed, then re-arms nextRunAt from the cron expression.
//
// Cadence is the SAME representation as qaSchedules / workflowTriggers (5-field
// cron + IANA timezone via domain/workflowSchedule.nextCronTime) — one cadence
// language across every scheduled subsystem. `kind` mirrors ceremonySessions.kind
// exactly; retros are their own subsystem (retrospectives) and are not modelled here.
// ---------------------------------------------------------------------------

export const ceremonySchedules = pgTable('ceremony_schedules', {
  id:               uuid('id').primaryKey().defaultRandom(),
  tenantId:         integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:        uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  projectId:        integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  kind:             varchar('kind', { length: 16 }).notNull().default('standup'),   // 'standup' | 'planning'
  cron:             varchar('cron', { length: 120 }).notNull(),
  timezone:         varchar('timezone', { length: 64 }).notNull().default('UTC'),
  enabled:          boolean('enabled').notNull().default(true),
  /** Stamped onto the auto-opened session; null inherits the board's setting. */
  turnMode:         varchar('turn_mode', { length: 16 }),
  turnSeconds:      integer('turn_seconds'),
  /** 'members' (derive from project members) | 'roster' (explicit participants). */
  participantScope: varchar('participant_scope', { length: 16 }).notNull().default('members'),
  /** JSON array of { kind, ref, name }; used when participantScope = 'roster'. */
  participants:     text('participants').notNull().default('[]'),
  maxParticipants:  integer('max_participants').notNull().default(25),
  /** Server-side dispatch when the opened session completes (was client-driven). */
  autoDispatch:     boolean('auto_dispatch').notNull().default(false),
  nextRunAt:        timestamp('next_run_at'),
  lastRunAt:        timestamp('last_run_at'),
  lastStatus:       varchar('last_status', { length: 24 }),
  lastSessionId:    uuid('last_session_id'),
  createdBy:        varchar('created_by', { length: 36 }),
  createdAt:        timestamp('created_at').notNull().defaultNow(),
  updatedAt:        timestamp('updated_at').notNull().defaultNow(),
});


// ---------------------------------------------------------------------------
// Live video/audio collaboration — scheduled meetings + calendar connections
// (migration 0292). A meeting is a standup / planning / retro / ad-hoc / direct
// call; peers exchange WebRTC media via the CeremonyRoomDO relay keyed off
// `roomKey`. Calendars are per-user OAuth grants used to schedule + list events.
// ---------------------------------------------------------------------------

export const meetings = pgTable('meetings', {
  id:               uuid('id').primaryKey().defaultRandom(),
  tenantId:         integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:        uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  // Nullable: an ad-hoc / direct call need not belong to a project.
  projectId:        integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
  kind:             varchar('kind', { length: 16 }).notNull().default('adhoc'),        // standup|planning|retrospective|adhoc|direct|interview|review
  title:            varchar('title', { length: 255 }).notNull(),
  description:      text('description'),
  /** Gig Marketplace (0293): track a review/interview meeting against the exact
   *  work item, job posting, or engagement it concerns (all optional back-links). */
  ticketId:         integer('ticket_id').references((): AnyPgColumn => tasks.id, { onDelete: 'set null' }),
  jobId:            varchar('job_id', { length: 36 }),
  engagementId:     varchar('engagement_id', { length: 36 }),
  /** Team Chat backchannel (0294): the meeting IS a team chat — joining opens this
   *  conversation, and people who can't attend still post their updates here so the
   *  chat keeps going after the call. Resolved to the scope's canonical team chat. */
  chatId:           integer('chat_id').references((): AnyPgColumn => brainChats.id, { onDelete: 'set null' }),
  scheduledAt:      timestamp('scheduled_at', { withTimezone: true }),                 // null = start-now
  durationMinutes:  integer('duration_minutes').notNull().default(30),
  status:           varchar('status', { length: 16 }).notNull().default('scheduled'),  // scheduled|live|ended|cancelled
  createdBy:        varchar('created_by', { length: 64 }),
  roomKey:          varchar('room_key', { length: 64 }).notNull(),                     // media relay room (media:<roomKey>)
  videoEnabled:     boolean('video_enabled').notNull().default(true),
  calendarProvider: varchar('calendar_provider', { length: 16 }),                      // google|microsoft
  calendarEventId:  varchar('calendar_event_id', { length: 255 }),
  calendarHtmlLink: text('calendar_html_link'),
  startedAt:        timestamp('started_at', { withTimezone: true }),
  endedAt:          timestamp('ended_at', { withTimezone: true }),
  /** Recording/transcription (0330): the generated minutes (recap + decisions +
   *  action items) built from the transcript on meeting end. Also posted into the
   *  linked team chat as the durable artifact. Null until summarized. */
  summary:            text('summary'),
  summaryGeneratedAt: timestamp('summary_generated_at', { withTimezone: true }),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});


export const meetingAttendees = pgTable('meeting_attendees', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  meetingId:   uuid('meeting_id').notNull().references(() => meetings.id, { onDelete: 'cascade' }),
  memberKind:  varchar('member_kind', { length: 16 }).notNull().default('human'),      // human|cloud_agent|host_agent
  memberRef:   varchar('member_ref', { length: 64 }).notNull(),
  memberName:  varchar('member_name', { length: 255 }).notNull(),
  email:       varchar('email', { length: 255 }),
  role:        varchar('role', { length: 16 }).notNull().default('attendee'),          // host|attendee
  response:    varchar('response', { length: 16 }).notNull().default('invited'),       // invited|accepted|declined|tentative
  joinedAt:    timestamp('joined_at', { withTimezone: true }),
  leftAt:      timestamp('left_at', { withTimezone: true }),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});


export const calendarConnections = pgTable('calendar_connections', {
  id:            uuid('id').primaryKey().defaultRandom(),
  tenantId:      integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  userId:        varchar('user_id', { length: 64 }).notNull(),                         // users.id (the connector)
  provider:      varchar('provider', { length: 16 }).notNull(),                        // google|microsoft
  accountEmail:  varchar('account_email', { length: 255 }),
  accessToken:   text('access_token').notNull(),
  refreshToken:  text('refresh_token'),
  expiresAt:     timestamp('expires_at', { withTimezone: true }),
  scope:         text('scope'),
  calendarId:    varchar('calendar_id', { length: 255 }).notNull().default('primary'),
  createdAt:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
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
  // When triaged into the backlog, the task it spawned/linked (migration 0161).
  triagedTaskId: integer('triaged_task_id').references(() => tasks.id, { onDelete: 'set null' }),
  triagedAt:   timestamp('triaged_at'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  // UNIQUE (segment_id, external_ref) enforced in migration 0071.
});


/** A daily uptime sample per service — Uptime % on the Quality slide. One row per
 *  (service, day). Fed by a status-page connector (not yet built — manual until
 *  then) or derived from prodIncidents downtime. */
export const uptimeSamples = pgTable('uptime_samples', {
  id:              uuid('id').primaryKey().defaultRandom(),
  tenantId:        integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:       uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  serviceName:     varchar('service_name', { length: 120 }).notNull().default('production'),
  periodDay:       date('period_day').notNull(),
  uptimePct:       real('uptime_pct').notNull().default(100), // 0..100 for the day
  downtimeMinutes: real('downtime_minutes').notNull().default(0),
  source:          varchar('source', { length: 24 }).notNull().default('manual'), // statuspage | pingdom | betterstack | manual
  createdAt:       timestamp('created_at').notNull().defaultNow(),
  updatedAt:       timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byDay: index('idx_uptime_samples_day').on(t.tenantId, t.periodDay),
  uqDay: uniqueIndex('uq_uptime_samples_day').on(t.tenantId, t.serviceName, t.periodDay),
}));


/** Employer hires a freelancer (optionally onto a project). Hire record + the
 *  cross-tenant membership bridge. Soft-terminate via terminatedAt. */
export const freelancerEngagements = pgTable('freelancer_engagements', {
  id:                 varchar('id', { length: 36 }).primaryKey(),
  tenantId:           integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  projectId:          integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
  freelancerUserId:   varchar('freelancer_user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  status:             varchar('status', { length: 20 }).notNull().default('invited'), // invited|interviewing|active|declined|terminated
  /** Gig Marketplace (0293): how much of the employer workspace an ACTIVE engagement
   *  grants this freelancer — enforced by EngagementAccessService. Default 'project'
   *  = view + work the engaged project's board (incl. moving a ticket to In Review). */
  accessScope:        varchar('access_scope', { length: 20 }).notNull().default('project'), // project|board_readonly|tenant
  rateCents:          integer('rate_cents'),
  currency:           varchar('currency', { length: 3 }).notNull().default('USD'),
  title:              varchar('title', { length: 200 }),
  note:               text('note'),
  createdByUserId:    varchar('created_by_user_id', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  invitedAt:          timestamp('invited_at').notNull().defaultNow(),
  hiredAt:            timestamp('hired_at'),
  terminatedAt:       timestamp('terminated_at'),
  terminatedReason:   text('terminated_reason'),
  createdAt:          timestamp('created_at').notNull().defaultNow(),
  updatedAt:          timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byTenant:     index('idx_engagements_tenant').on(t.tenantId),
  byFreelancer: index('idx_engagements_freelancer').on(t.freelancerUserId),
}));


/** Raw audited "click sense" + engagement stream (portal + VSIX). Append-only. */
export const activitySignals = pgTable('activity_signals', {
  // DB is `bigserial` — declaring it as such makes the id DB-generated and OPTIONAL
  // on insert (a plain bigint().primaryKey() forces callers to invent one).
  id:               bigserial('id', { mode: 'number' }).primaryKey(),
  userId:           varchar('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  tenantId:         integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  engagementId:     varchar('engagement_id', { length: 36 }).references(() => freelancerEngagements.id, { onDelete: 'set null' }),
  projectId:        integer('project_id'),
  source:           varchar('source', { length: 20 }).notNull(),   // portal|vscode|agent|meeting|system
  kind:             varchar('kind', { length: 40 }).notNull(),     // nav|tool_exec|ticket_move|project_update|agent_message|agent_run|meeting|heartbeat
  ref:              varchar('ref', { length: 300 }),
  weight:           integer('weight').notNull().default(1),
  durationSeconds:  integer('duration_seconds'),
  metadata:         text('metadata'),
  sessionId:        varchar('session_id', { length: 64 }),
  occurredAt:       timestamp('occurred_at').notNull().defaultNow(),
  createdAt:        timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  byUserDay:      index('idx_signals_user_day').on(t.userId, t.occurredAt),
  byEngagement:   index('idx_signals_engagement').on(t.engagementId, t.occurredAt),
}));


/** Resolved billable blocks — "what did you do today". Editable pre-submit.
 *  Named timecardEntries (table timecard_entries) to avoid the existing per-task
 *  `time_entries`/`timeEntries` (migration 0247) — a different subsystem. */
export const timecardEntries = pgTable('timecard_entries', {
  id:            varchar('id', { length: 36 }).primaryKey(),
  engagementId:  varchar('engagement_id', { length: 36 }).notNull().references(() => freelancerEngagements.id, { onDelete: 'cascade' }),
  userId:        varchar('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  tenantId:      integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  workDate:      date('work_date').notNull(),
  minutes:       integer('minutes').notNull().default(0),
  source:        varchar('source', { length: 20 }).notNull().default('auto'), // auto|manual|meeting
  description:   text('description'),
  billable:      boolean('billable').notNull().default(true),
  resolvedFrom:  text('resolved_from'),   // JSON audit
  timecardId:    varchar('timecard_id', { length: 36 }),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byEngagementDate: index('idx_timecard_entries_engagement_date').on(t.engagementId, t.workDate),
  byCard:           index('idx_timecard_entries_card').on(t.timecardId),
}));


/** Approvable per-engagement period rollup. */
export const timecards = pgTable('timecards', {
  id:                 varchar('id', { length: 36 }).primaryKey(),
  engagementId:       varchar('engagement_id', { length: 36 }).notNull().references(() => freelancerEngagements.id, { onDelete: 'cascade' }),
  userId:             varchar('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  tenantId:           integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  periodStart:        date('period_start').notNull(),
  periodEnd:          date('period_end').notNull(),
  status:             varchar('status', { length: 20 }).notNull().default('draft'), // draft|submitted|approved|rejected|paid
  totalMinutes:       integer('total_minutes').notNull().default(0),
  billableMinutes:    integer('billable_minutes').notNull().default(0),
  rateCents:          integer('rate_cents'),
  currency:           varchar('currency', { length: 3 }).notNull().default('USD'),
  amountCents:        integer('amount_cents').notNull().default(0),
  submittedAt:        timestamp('submitted_at'),
  approvedAt:         timestamp('approved_at'),
  approvedByUserId:   varchar('approved_by_user_id', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  rejectReason:       text('reject_reason'),
  createdAt:          timestamp('created_at').notNull().defaultNow(),
  updatedAt:          timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byEngagement: index('idx_timecards_engagement').on(t.engagementId),
}));


/** In-app notifications for both sides of the marketplace. */
export const freelancerNotifications = pgTable('freelancer_notifications', {
  // DB is `bigserial` (0273) — declare it as such so Drizzle treats the id as
  // DB-generated and OPTIONAL on insert (a plain bigint().primaryKey() would
  // force every caller to invent an id).
  id:         bigserial('id', { mode: 'number' }).primaryKey(),
  userId:     varchar('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  tenantId:   integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  kind:       varchar('kind', { length: 40 }).notNull(),
  title:      varchar('title', { length: 200 }).notNull(),
  body:       text('body'),
  ref:        varchar('ref', { length: 200 }),
  readAt:     timestamp('read_at'),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  byUser: index('idx_notifications_user').on(t.userId, t.createdAt),
}));


// ---------------------------------------------------------------------------
// EMP-15 — internal sentiment / pulse survey (migration 0317).
// ---------------------------------------------------------------------------
export const pulseSurveys = pgTable('pulse_surveys', {
  id:        uuid('id').primaryKey().defaultRandom(),
  tenantId:  integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId: uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  question:  varchar('question', { length: 255 }).notNull(),
  scale:     integer('scale').notNull().default(5),
  active:    boolean('active').notNull().default(true),
  createdBy: varchar('created_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  closedAt:  timestamp('closed_at'),
});


export const pulseResponses = pgTable('pulse_responses', {
  id:        uuid('id').primaryKey().defaultRandom(),
  surveyId:  uuid('survey_id').notNull().references(() => pulseSurveys.id, { onDelete: 'cascade' }),
  tenantId:  integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId: uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  userId:    varchar('user_id', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  score:     integer('score').notNull(),
  comment:   text('comment'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  uqUser: uniqueIndex('uq_pulse_response_user').on(t.surveyId, t.userId),
}));


// ---------------------------------------------------------------------------
// EMP-16 — manager coaching notes attached to a workforce member (mig 0311).
// Polymorphic (member_kind, member_ref) identity; no FK on member_ref.
// ---------------------------------------------------------------------------
export const coachingNotes = pgTable('coaching_notes', {
  id:         serial('id').primaryKey(),
  tenantId:   integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:  uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  memberKind: varchar('member_kind', { length: 16 }).notNull(),
  memberRef:  varchar('member_ref', { length: 64 }).notNull(),
  note:       text('note').notNull(),
  authorId:   varchar('author_id', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('idx_coaching_notes_member').on(t.tenantId, t.memberKind, t.memberRef),
]);


// ---------------------------------------------------------------------------
// Product Feedback collection (migration 0354)
// ---------------------------------------------------------------------------

/**
 * A project's feedback collector — the human-input twin of [[errorCollectors]].
 * ONE per project (one ingest key = one embeddable snippet), so any application
 * carrying the snippet can gather feature requests, bug reports and ideas from
 * its own users. `keyHash` authenticates the public snippet POST; `dailyLimit`
 * is the abuse ceiling on an endpoint that opens TICKETS.
 */
export const feedbackCollectors = pgTable('feedback_collectors', {
  id:               uuid('id').primaryKey().defaultRandom(),
  tenantId:         integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  projectId:        integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name:             varchar('name', { length: 255 }).notNull(),
  /** SHA-256 of the bff_* ingest key (raw key shown once at creation). */
  keyHash:          varchar('key_hash', { length: 64 }).unique(),
  enabled:          boolean('enabled').notNull().default(true),
  /** Open a backlog ticket per submission (off = record + triage only). */
  autoCreateTask:   boolean('auto_create_task').notNull().default(true),
  /** Submissions accepted from this collector per rolling 24h. */
  dailyLimit:       integer('daily_limit').notNull().default(100),
  /** '*' or a comma-separated origin allow-list the snippet may post from. */
  allowedOrigins:   text('allowed_origins').notNull().default('*'),
  lastSubmissionAt: timestamp('last_submission_at'),
  createdBy:        varchar('created_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  createdAt:        timestamp('created_at').notNull().defaultNow(),
  updatedAt:        timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  // One collector per project — a project's feedback has a single front door.
  uqProject: uniqueIndex('uq_feedback_collectors_project').on(t.tenantId, t.projectId),
}));


/**
 * A single feedback request and its link to the backlog ticket it opened.
 * `collectorId` is NULL for an IN-APP submission (the signed-in right-edge
 * feedback panel), which the session authenticates and which needs no key.
 * `fingerprint` collapses a repeat/double submit onto the existing request.
 */
export const feedbackSubmissions = pgTable('feedback_submissions', {
  id:              uuid('id').primaryKey().defaultRandom(),
  tenantId:        integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  projectId:       integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  collectorId:     uuid('collector_id').references(() => feedbackCollectors.id, { onDelete: 'set null' }),
  /** 'feature' | 'bug' | 'idea' | 'other'. */
  kind:            varchar('kind', { length: 16 }).notNull().default('feature'),
  title:           varchar('title', { length: 300 }).notNull(),
  body:            text('body').notNull(),
  /** 'new' | 'approved' | 'declined' — approval is the human gate on execution. */
  status:          varchar('status', { length: 16 }).notNull().default('new'),
  submitterUserId: varchar('submitter_user_id', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  submitterEmail:  varchar('submitter_email', { length: 255 }),
  submitterName:   varchar('submitter_name', { length: 255 }),
  pageUrl:         text('page_url'),
  userAgent:       text('user_agent'),
  appVersion:      varchar('app_version', { length: 64 }),
  context:         jsonb('context'),
  /** SHA-256 of kind+title+body — the duplicate-collapse key. */
  fingerprint:     varchar('fingerprint', { length: 128 }).notNull(),
  taskId:          integer('task_id').references(() => tasks.id, { onDelete: 'set null' }),
  reviewedBy:      varchar('reviewed_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  reviewedAt:      timestamp('reviewed_at'),
  createdAt:       timestamp('created_at').notNull().defaultNow(),
  updatedAt:       timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byProject:     index('idx_feedback_submissions_project').on(t.projectId, t.createdAt),
  byTenant:      index('idx_feedback_submissions_tenant_status').on(t.tenantId, t.status, t.createdAt),
  byCollector:   index('idx_feedback_submissions_collector').on(t.collectorId, t.createdAt),
  byFingerprint: index('idx_feedback_submissions_fingerprint').on(t.projectId, t.fingerprint),
}));


// ---------------------------------------------------------------------------
// Rehearsal (migration 0372)
//
// The same loop, the same registry, the same capability provider as a live run —
// wrapped in a shadow decorator that RECORDS every effect instead of performing it.
// This is what makes an agent change testable before it reaches a real ticket.
// ---------------------------------------------------------------------------

/** One rehearsal: a dry-run of a ticket, a replay of a past execution against the ref
 *  it originally saw, or a trial of one agent across several past tickets. */
export const rehearsals = pgTable('rehearsals', {
  id:                uuid('id').primaryKey().defaultRandom(),
  tenantId:          integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  projectId:         integer('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  /** 'dry_run' | 'replay' | 'trial'. */
  kind:              varchar('kind', { length: 16 }).notNull(),
  /** 'queued' | 'running' | 'completed' | 'failed'. */
  status:            varchar('status', { length: 16 }).notNull().default('queued'),
  /** ide_agents.id by value (no FK — same convention as tasks.assignedAgentRef). */
  agentRef:          varchar('agent_ref', { length: 64 }),
  agentLabel:        varchar('agent_label', { length: 255 }).notNull().default('agent'),
  model:             varchar('model', { length: 120 }),
  taskId:            integer('task_id').references(() => tasks.id, { onDelete: 'cascade' }),
  /** kind='replay': the execution being re-run. */
  sourceExecutionId: integer('source_execution_id'),
  /** The git ref the source run actually saw — replay reads are pinned to it, so a
   *  comparison is against the same tree rather than against a moved main. */
  frozenRef:         varchar('frozen_ref', { length: 255 }),
  /** The shadow execution this rehearsal drove (executions.mode='rehearsal'). */
  executionId:       integer('execution_id'),
  steps:             integer('steps').notNull().default(0),
  suppressedWrites:  integer('suppressed_writes').notNull().default(0),
  finishedOk:        boolean('finished_ok'),
  summary:           text('summary'),
  errorMessage:      text('error_message'),
  /** The user who started the rehearsal. `users.id` is a VARCHAR(36), so this column
   *  must be too — an `integer` here is not merely a mismatch, it makes the FK
   *  unimplementable in Postgres and the migration fails outright. */
  createdBy:         varchar('created_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  createdAt:         timestamp('created_at').notNull().defaultNow(),
  startedAt:         timestamp('started_at'),
  completedAt:       timestamp('completed_at'),
});


/** One suppressed effect, in order. THIS is the deliverable — the commit the agent
 *  would have made, the memory it would have written, the human it would have paged. */
export const rehearsalSteps = pgTable('rehearsal_steps', {
  id:           uuid('id').primaryKey().defaultRandom(),
  rehearsalId:  uuid('rehearsal_id').notNull().references(() => rehearsals.id, { onDelete: 'cascade' }),
  tenantId:     integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  seq:          integer('seq').notNull(),
  /** The capability op: 'repo.write' | 'repo.edit' | 'repo.delete' | 'memory.remember'
   *  | 'memory.forget' | 'human.ask' | 'coordinate.claim'. */
  op:           varchar('op', { length: 64 }).notNull(),
  /** Primary subject: a file path, a memory key, a resource string. */
  target:       varchar('target', { length: 512 }),
  /** JSON payload of what would have been written/sent. */
  detail:       text('detail'),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
});


// ---------------------------------------------------------------------------
// Creation Sessions (migration 0388)
// ---------------------------------------------------------------------------

/** A durable, tenant-owned infinite canvas. A Project is optional context, not
 *  the owner of the session; project associations live in the link table below. */
export const creationSessions = pgTable('creation_sessions', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenantId:       integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:      uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  title:          varchar('title', { length: 255 }).notNull().default('Untitled session'),
  description:    text('description'),
  status:         varchar('status', { length: 16 }).notNull().default('active'),
  createdBy:      varchar('created_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  updatedBy:      varchar('updated_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  canvasRevision: bigint('canvas_revision', { mode: 'number' }).notNull().default(0),
  viewport:       jsonb('viewport').notNull().default(sql`'{"x":0,"y":0,"zoom":1}'::jsonb`),
  preview:        jsonb('preview'),
  lastActivityAt: timestamp('last_activity_at').notNull().defaultNow(),
  createdAt:      timestamp('created_at').notNull().defaultNow(),
  updatedAt:      timestamp('updated_at').notNull().defaultNow(),
  archivedAt:     timestamp('archived_at'),
  branchParentSessionId: uuid('branch_parent_session_id').references((): AnyPgColumn => creationSessions.id, { onDelete: 'set null' }),
  branchBaseRevision: bigint('branch_base_revision', { mode: 'number' }),
}, (t) => ({
  byTenantActivity: index('idx_creation_sessions_tenant_activity').on(t.tenantId, t.status, t.lastActivityAt),
  byCreator: index('idx_creation_sessions_creator').on(t.createdBy, t.lastActivityAt),
  bySegment: index('idx_creation_sessions_segment').on(t.tenantId, t.segmentId, t.lastActivityAt),
}));

export const creationSessionObjects = pgTable('creation_session_objects', {
  id:               uuid('id').primaryKey().defaultRandom(),
  sessionId:        uuid('session_id').notNull().references(() => creationSessions.id, { onDelete: 'cascade' }),
  kind:             varchar('kind', { length: 48 }).notNull(),
  resourceType:     varchar('resource_type', { length: 64 }),
  resourceId:       varchar('resource_id', { length: 128 }),
  resourceRevision: varchar('resource_revision', { length: 128 }),
  canvasData:       jsonb('canvas_data').notNull().default(sql`'{}'::jsonb`),
  content:          jsonb('content'),
  searchText:       text('search_text').notNull().default(''),
  createdBy:        varchar('created_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  updatedBy:        varchar('updated_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  lockedBy:         varchar('locked_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  lockExpiresAt:    timestamp('lock_expires_at'),
  createdAt:        timestamp('created_at').notNull().defaultNow(),
  updatedAt:        timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  bySession: index('idx_creation_objects_session').on(t.sessionId, t.createdAt),
  byResource: uniqueIndex('uq_creation_objects_resource').on(t.sessionId, t.resourceType, t.resourceId)
    .where(sql`${t.resourceId} IS NOT NULL`),
}));

/** Session-owned Brain/user transcript. It deliberately does not live inside a
 * Chat placement: removing a visual Chat Object must never erase conversation. */
export const creationSessionTimeline = pgTable('creation_session_timeline', {
  id:              bigserial('id', { mode: 'number' }).primaryKey(),
  sessionId:       uuid('session_id').notNull().references(() => creationSessions.id, { onDelete: 'cascade' }),
  clientMessageId: varchar('client_message_id', { length: 128 }).notNull(),
  messageRole:     varchar('message_role', { length: 16 }).notNull(),
  body:            text('body').notNull(),
  metadata:        jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
  createdBy:       varchar('created_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  createdAt:       timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  bySession: index('idx_creation_timeline_session_id').on(t.sessionId, t.id),
  messageId: uniqueIndex('uq_creation_timeline_message').on(t.sessionId, t.clientMessageId),
}));

export const creationSessionConnections = pgTable('creation_session_connections', {
  id:             uuid('id').primaryKey().defaultRandom(),
  sessionId:      uuid('session_id').notNull().references(() => creationSessions.id, { onDelete: 'cascade' }),
  sourceObjectId: uuid('source_object_id').notNull().references(() => creationSessionObjects.id, { onDelete: 'cascade' }),
  targetObjectId: uuid('target_object_id').notNull().references(() => creationSessionObjects.id, { onDelete: 'cascade' }),
  kind:           varchar('kind', { length: 24 }).notNull().default('reference'),
  label:          varchar('label', { length: 255 }),
  metadata:       jsonb('metadata'),
  createdBy:      varchar('created_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  createdAt:      timestamp('created_at').notNull().defaultNow(),
}, (t) => ({ bySession: index('idx_creation_connections_session').on(t.sessionId, t.createdAt) }));

export const creationSessionMembers = pgTable('creation_session_members', {
  sessionId:        uuid('session_id').notNull().references(() => creationSessions.id, { onDelete: 'cascade' }),
  userId:           varchar('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  role:             varchar('role', { length: 16 }).notNull().default('viewer'),
  invitedBy:        varchar('invited_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  lastSeenRevision: bigint('last_seen_revision', { mode: 'number' }).notNull().default(0),
  lastSeenAt:       timestamp('last_seen_at').notNull().defaultNow(),
  viewport:         jsonb('viewport').notNull().default(sql`'{"x":0,"y":0,"zoom":1}'::jsonb`),
  cursor:           jsonb('cursor'),
  selection:        jsonb('selection').notNull().default(sql`'[]'::jsonb`),
  typing:           boolean('typing').notNull().default(false),
  pinned:           boolean('pinned').notNull().default(false),
  watchState:       varchar('watch_state', { length: 24 }).notNull().default('mentions'),
  followingUserId:  varchar('following_user_id', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  joinedAt:         timestamp('joined_at').notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.sessionId, t.userId] }),
  byUser: index('idx_creation_members_user').on(t.userId, t.joinedAt),
  byPresence: index('idx_creation_members_presence').on(t.sessionId, t.lastSeenAt),
}));

/** One-time, expiring invitation to a Creation Session. Only a SHA-256 token
 * digest is stored so a database read cannot be used to join the Session. */
export const creationSessionInvites = pgTable('creation_session_invites', {
  id:         uuid('id').primaryKey().defaultRandom(),
  sessionId:  uuid('session_id').notNull().references(() => creationSessions.id, { onDelete: 'cascade' }),
  tenantId:   integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  email:      varchar('email', { length: 320 }).notNull(),
  role:       varchar('role', { length: 16 }).notNull(),
  tokenHash:  varchar('token_hash', { length: 64 }).notNull().unique(),
  expiresAt:  timestamp('expires_at').notNull(),
  acceptedBy: varchar('accepted_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  acceptedAt: timestamp('accepted_at'),
  revokedAt:  timestamp('revoked_at'),
  createdBy:  varchar('created_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  bySession: index('idx_creation_session_invites_session').on(t.sessionId, t.createdAt),
  byEmail: index('idx_creation_session_invites_email').on(t.tenantId, t.email, t.expiresAt),
}));

export const creationSessionSnapshots = pgTable('creation_session_snapshots', {
  sessionId: uuid('session_id').notNull().references(() => creationSessions.id, { onDelete: 'cascade' }),
  revision:  bigint('revision', { mode: 'number' }).notNull(),
  graph:     jsonb('graph').notNull(),
  viewport:  jsonb('viewport').notNull().default(sql`'{"x":0,"y":0,"zoom":1}'::jsonb`),
  label:     varchar('label', { length: 120 }),
  createdBy: varchar('created_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.sessionId, t.revision] }),
  byCreated: index('idx_creation_snapshots_session_created').on(t.sessionId, t.createdAt),
}));

export const creationSessionEvents = pgTable('creation_session_events', {
  id:             uuid('id').primaryKey().defaultRandom(),
  sessionId:      uuid('session_id').notNull().references(() => creationSessions.id, { onDelete: 'cascade' }),
  revision:       bigint('revision', { mode: 'number' }).notNull(),
  actorType:      varchar('actor_type', { length: 16 }).notNull().default('user'),
  actorRef:       varchar('actor_ref', { length: 128 }),
  eventType:      varchar('event_type', { length: 64 }).notNull(),
  objectId:       uuid('object_id').references(() => creationSessionObjects.id, { onDelete: 'set null' }),
  payload:        jsonb('payload').notNull().default(sql`'{}'::jsonb`),
  idempotencyKey: varchar('idempotency_key', { length: 128 }),
  createdAt:      timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  byRevision: uniqueIndex('uq_creation_events_revision').on(t.sessionId, t.revision),
  byIdempotency: uniqueIndex('uq_creation_events_idempotency').on(t.sessionId, t.idempotencyKey)
    .where(sql`${t.idempotencyKey} IS NOT NULL`),
  bySession: index('idx_creation_events_session_revision').on(t.sessionId, t.revision),
}));

export const creationSessionComments = pgTable('creation_session_comments', {
  id:              uuid('id').primaryKey().defaultRandom(),
  sessionId:       uuid('session_id').notNull().references(() => creationSessions.id, { onDelete: 'cascade' }),
  objectId:        uuid('object_id').references(() => creationSessionObjects.id, { onDelete: 'set null' }),
  parentCommentId: uuid('parent_comment_id'),
  body:            text('body').notNull(),
  mentions:        jsonb('mentions').notNull().default(sql`'[]'::jsonb`),
  createdBy:       varchar('created_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  resolvedBy:      varchar('resolved_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  resolvedAt:      timestamp('resolved_at'),
  createdAt:       timestamp('created_at').notNull().defaultNow(),
  updatedAt:       timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  bySession: index('idx_creation_comments_session').on(t.sessionId, t.createdAt),
  byObject: index('idx_creation_comments_object').on(t.objectId, t.createdAt).where(sql`${t.objectId} IS NOT NULL`),
}));

export const creationSessionProjectLinks = pgTable('creation_session_project_links', {
  sessionId: uuid('session_id').notNull().references(() => creationSessions.id, { onDelete: 'cascade' }),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  addedBy:   varchar('added_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.sessionId, t.projectId] }),
  byProject: index('idx_creation_project_links_project').on(t.projectId, t.createdAt),
}));

/** Tenant-authored reusable Session graphs. Built-in Marketplace packs remain
 * code-signed catalog entries; private/tenant variants persist here. */
export const creationSessionTemplates = pgTable('creation_session_templates', {
  id:                   uuid('id').primaryKey().defaultRandom(),
  tenantId:             integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:            uuid('segment_id').notNull().references(() => segments.id, { onDelete: 'cascade' }),
  name:                 varchar('name', { length: 160 }).notNull(),
  description:          text('description'),
  category:             varchar('category', { length: 80 }).notNull().default('Custom'),
  graph:                jsonb('graph').notNull(),
  visibility:           varchar('visibility', { length: 16 }).notNull().default('private'),
  marketplaceListingId: varchar('marketplace_listing_id', { length: 128 }),
  createdBy:            varchar('created_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  updatedBy:            varchar('updated_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  createdAt:            timestamp('created_at').notNull().defaultNow(),
  updatedAt:            timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byTenant: index('idx_creation_templates_tenant_updated').on(t.tenantId, t.segmentId, t.updatedAt),
  byMarketplace: index('idx_creation_templates_marketplace').on(t.marketplaceListingId).where(sql`${t.marketplaceListingId} IS NOT NULL`),
}));

export const creationSessionClaims = pgTable('creation_session_claims', {
  userId:          varchar('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  clientSessionId: varchar('client_session_id', { length: 160 }).notNull(),
  serverSessionId: uuid('server_session_id').notNull().unique().references(() => creationSessions.id, { onDelete: 'cascade' }),
  claimedAt:       timestamp('claimed_at').notNull().defaultNow(),
}, (t) => ({ pk: primaryKey({ columns: [t.userId, t.clientSessionId] }) }));
