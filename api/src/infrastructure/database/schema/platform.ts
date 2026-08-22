/**
 * Schema — platform context.
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
  numeric,
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
import { integrationProviderEnum, integrationSyncStatusEnum, objects, voiceCloneStatusEnum, voiceCloneVisibilityEnum } from './kernel';
import { segments, tenants, users } from './identity';
import { ideProjects, importStagedProjects, initiatives, projects } from './delivery';
import { importRuns } from './agents';


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

/**
 * Durable ledger of outbound email attempts rejected before delivery. This is
 * platform-scoped operational evidence for SuperAdmin; it deliberately stores no
 * HTML body, verification code, or provider credential.
 */
export const emailDeliveryFailures = pgTable('email_delivery_failures', {
  id:             serial('id').primaryKey(),
  recipient:      varchar('recipient', { length: 255 }).notNull(),
  deliveryType:   varchar('delivery_type', { length: 64 }).notNull().default('transactional'),
  provider:       varchar('provider', { length: 32 }).notNull().default('resend'),
  providerStatus: integer('provider_status'),
  errorMessage:   text('error_message').notNull(),
  createdAt:      timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('idx_email_delivery_failures_created').on(t.createdAt),
  index('idx_email_delivery_failures_recipient').on(t.recipient, t.createdAt),
]);


/**
 * Per-tenant integration credentials.
 * Token is stored AES-256-GCM encrypted (handled by application layer).
 */
export const integrationCredentials = pgTable('integration_credentials', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenantId:       integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId: uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),  // DB NOT NULL via trigger (0056); optional in TS so single-mode writes need no change
  /** NULL = workspace-global credential; set = scoped to a single project (0074). */
  projectId:      integer('project_id').references(() => projects.id, { onDelete: 'cascade' }),
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
  segmentId: uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),  // DB NOT NULL via trigger (0056); optional in TS so single-mode writes need no change
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


export const importStagedItems = pgTable('import_staged_items', {
  id:              uuid('id').primaryKey().defaultRandom(),
  runId:           uuid('run_id').notNull().references(() => importRuns.id, { onDelete: 'cascade' }),
  tenantId:        integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  stagedProjectId: uuid('staged_project_id').notNull().references(() => importStagedProjects.id, { onDelete: 'cascade' }),
  externalId:      varchar('external_id', { length: 255 }).notNull(),
  externalType:    varchar('external_type', { length: 120 }),
  externalUrl:     varchar('external_url', { length: 500 }),
  title:           text('title').notNull(),
  body:            text('body'),
  state:           varchar('state', { length: 120 }),
  storyPoints:     real('story_points'),
  assigneeExternalId: varchar('assignee_external_id', { length: 255 }),
  externalVersion: varchar('external_version', { length: 128 }),
  contentHash:     varchar('content_hash', { length: 64 }),
  raw:             jsonb('raw'),
  targetTaskType:  varchar('target_task_type', { length: 16 }).notNull().default('task'),
  targetStatus:    varchar('target_status', { length: 64 }).notNull().default('backlog'),
  include:         boolean('include').notNull().default(true),
  createdAt:       timestamp('created_at').notNull().defaultNow(),
});


export const importTypeMappings = pgTable('import_type_mappings', {
  id:             uuid('id').primaryKey().defaultRandom(),
  runId:          uuid('run_id').notNull().references(() => importRuns.id, { onDelete: 'cascade' }),
  tenantId:       integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  externalType:   varchar('external_type', { length: 120 }).notNull(),
  targetTaskType: varchar('target_task_type', { length: 16 }).notNull().default('task'),
  targetStatus:   varchar('target_status', { length: 64 }).notNull().default('backlog'),
  createdAt:      timestamp('created_at').notNull().defaultNow(),
});




export const studioVoiceClones = pgTable('studio_voice_clones', {
  id:            serial('id').primaryKey(),
  tenantId:      integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:     uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  /** The enrolling user (owner). */
  userId:        varchar('user_id', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  /** The voice-modality IDE project this clone was enrolled under (0224); NULL = tenant-wide/legacy. */
  ideProjectId:  integer('ide_project_id').references(() => ideProjects.id, { onDelete: 'set null' }),
  name:          varchar('name', { length: 255 }).notNull(),
  description:   text('description'),
  /** Synthesis backend honored at synth time (PRD §8 — never hardcode the engine). */
  provider:      varchar('provider', { length: 64 }).notNull().default('ssm-webgpu'),
  /** R2 key of the reference sample the clone was enrolled from. */
  referenceKey:  varchar('reference_key', { length: 512 }),
  /** Cached speaker embedding (L2-normalised number[]) so synthesis skips re-analysis. */
  embedding:     jsonb('embedding').$type<number[]>(),
  visibility:    voiceCloneVisibilityEnum('visibility').notNull().default('private'),
  status:        voiceCloneStatusEnum('status').notNull().default('ready'),
  /** Marketplace price in millicents (1/100000 USD). 0 = free. */
  priceMillicents: integer('price_millicents').notNull().default(0),
  /** Consent attestation (PRD §5 / ToS §9a) — set only when the enroller affirmed
   *  "this is my voice OR I have written permission". Synthesis is gated on it. */
  consentAttestedAt:  timestamp('consent_attested_at'),
  consentTextVersion: varchar('consent_text_version', { length: 32 }),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byTenant: index('idx_studio_voice_clones_tenant').on(t.tenantId),
  byVisibility: index('idx_studio_voice_clones_visibility').on(t.visibility),
}));


export const studioVoiceCloneLicenses = pgTable('studio_voice_clone_licenses', {
  id:        serial('id').primaryKey(),
  /** The licensee (buyer) tenant + user. */
  tenantId:  integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  userId:    varchar('user_id', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  cloneId:   integer('clone_id').notNull().references(() => studioVoiceClones.id, { onDelete: 'cascade' }),
  status:    varchar('status', { length: 16 }).notNull().default('active'),  // active|revoked
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  uniqueLicense: uniqueIndex('uq_voice_clone_license').on(t.cloneId, t.tenantId),
  byTenant: index('idx_voice_clone_licenses_tenant').on(t.tenantId),
}));


export const studioVoiceovers = pgTable('studio_voiceovers', {
  id:           serial('id').primaryKey(),
  tenantId:     integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  cloneId:      integer('clone_id').notNull().references(() => studioVoiceClones.id, { onDelete: 'cascade' }),
  /** sha256(cloneId + normalizedText + speed + lang) — the read-through cache key.
   *  Identical re-synthesis returns this row instead of re-billing. */
  cacheKey:     varchar('cache_key', { length: 64 }).notNull(),
  text:         text('text').notNull(),
  /** R2 key of the synthesized audio. */
  audioKey:     varchar('audio_key', { length: 512 }).notNull(),
  durationMs:   integer('duration_ms').notNull().default(0),
  wordTimestamps: jsonb('word_timestamps')
    .$type<Array<{ word: string; startMs: number; endMs: number }>>()
    .notNull()
    .default([]),
  costUsdMillicents: integer('cost_usd_millicents').notNull().default(0),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  uniqueCacheKey: uniqueIndex('uq_studio_voiceovers_cache_key').on(t.cacheKey),
  byClone: index('idx_studio_voiceovers_clone').on(t.cloneId),
}));


/** Innovation-funnel pipeline (LENS #5 / CEO): a tracked idea moving through
 *  idea→validated→in_build→shipped→measured (killed = off-ramp). stage_entered_at
 *  is trigger-maintained so the generic tracker PATCH needn't set it. */
export const innovationIdeas = pgTable('innovation_ideas', {
  id:              uuid('id').primaryKey().defaultRandom(),
  tenantId:        integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:       uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  initiativeId:    uuid('initiative_id').references(() => initiatives.id, { onDelete: 'set null' }),
  title:           varchar('title', { length: 255 }).notNull(),
  description:     text('description'),
  stage:           varchar('stage', { length: 16 }).notNull().default('idea'),
  linkedProjectId: integer('linked_project_id').references(() => projects.id, { onDelete: 'set null' }),
  impact:          real('impact'),
  effort:          real('effort'),
  confidence:      real('confidence'),
  outcome:         text('outcome'),
  outcomeValue:    real('outcome_value'),
  killedReason:    text('killed_reason'),
  stageEnteredAt:  timestamp('stage_entered_at').notNull().defaultNow(),
  notes:           text('notes'),
  createdAt:       timestamp('created_at').notNull().defaultNow(),
  updatedAt:       timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byScope: index('idx_innovation_ideas_scope').on(t.tenantId, t.segmentId, t.stage),
}));


/**
 * Outbound-fetch consumption ledger (migration 0262) — one row per Brain
 * `/fetch-url` request that hit the wire. COUNT(*) over a window is the metered
 * quantity for the `outbound_fetches` consumption meter + the abuse cap gate,
 * mirroring error_events / ingestion_usage_log.
 */
export const outboundFetchLog = pgTable('outbound_fetch_log', {
  id:        uuid('id').primaryKey().defaultRandom(),
  tenantId:  integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  url:       text('url'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});


// ═══ PRD 20 §5 step 2 — target-schema tables ═══
//
// Platform & observability — the platform's nine remaining targets (PRD 20 §3.2).
//
// The single largest absorption ratio in the model: 137 source tables in → 16
// out, with 92 taken by the kernel. Every alert, every notification, every
// webhook attempt, every per-subsystem event feed and every derived counter had
// its own DDL; they are `deliveries`, `activity_log` and `metric_facts` rows now.
//
// What survives is the part observability genuinely owns and the kernel cannot
// express: what to WATCH, what a breach MEANS, and how a dashboard is arranged.

/** A synthetic monitor. */
export const uptimeMonitors = pgTable('uptime_monitors', {
  id:            serial('id').primaryKey(),
  tenantId:      integer('tenant_id').notNull(),
  name:          varchar('name', { length: 200 }).notNull(),
  /** 'http' | 'tcp' | 'dns' | 'browser' | 'heartbeat'. */
  kind:          varchar('kind', { length: 16 }).notNull().default('http'),
  target:        text('target').notNull(),
  method:        varchar('method', { length: 8 }).notNull().default('GET'),
  expectStatus:  integer('expect_status').notNull().default(200),
  expectBody:    varchar('expect_body', { length: 500 }),
  intervalSec:   integer('interval_sec').notNull().default(300),
  timeoutMs:     integer('timeout_ms').notNull().default(10000),
  regions:       jsonb('regions'),
  /** How many consecutive failures before it is DOWN. Flap suppression as a
   *  column, so one implementation decides it rather than each alert path. */
  failThreshold: integer('fail_threshold').notNull().default(2),
  enabled:       boolean('enabled').notNull().default(true),
  /** Denormalised current state, so a status page is one query. */
  currentStatus: varchar('current_status', { length: 16 }).notNull().default('unknown'),
  lastCheckedAt: timestamp('last_checked_at'),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_uptime_monitors_name').on(t.tenantId, t.name),
  index('idx_uptime_monitors_due').on(t.enabled, t.lastCheckedAt),
]);

/** One execution of a monitor. Not a `runs` row: a check is a MEASUREMENT at
 *  very high volume with a fixed shape and a short retention, and mixing it into
 *  the execution tree would make the tree unqueryable for what it is for. */
export const uptimeChecks = pgTable('uptime_checks', {
  id:          bigserial('id', { mode: 'number' }).primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  monitorId:   integer('monitor_id').references(() => uptimeMonitors.id, { onDelete: 'cascade' }),
  region:      varchar('region', { length: 32 }),
  /** 'up' | 'down' | 'degraded'. */
  status:      varchar('status', { length: 16 }).notNull(),
  statusCode:  integer('status_code'),
  latencyMs:   integer('latency_ms'),
  error:       text('error'),
  checkedAt:   timestamp('checked_at').notNull().defaultNow(),
}, (t) => [
  index('idx_uptime_checks_monitor').on(t.monitorId, t.checkedAt),
]);

/** What a metric crossing a line MEANS. The metric's values are `metric_facts`
 *  and the notification is a `deliveries` row; this is the judgement between
 *  them, which is the only part that is neither a number nor a send. */
export const metricThresholds = pgTable('metric_thresholds', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  metric:      varchar('metric', { length: 96 }).notNull(),
  dimensionKey: varchar('dimension_key', { length: 200 }).notNull().default(''),
  /** 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'change_pct'. */
  comparator:  varchar('comparator', { length: 16 }).notNull(),
  value:       numeric('value', { precision: 24, scale: 6 }).notNull(),
  /** 'info' | 'warning' | 'critical'. */
  severity:    varchar('severity', { length: 16 }).notNull().default('warning'),
  /** Consecutive breaching buckets before it fires — the same flap suppression
   *  `uptime_monitors.failThreshold` applies, expressed once per concept. */
  sustainBuckets: integer('sustain_buckets').notNull().default(1),
  /** Who to tell. Resolved to `deliveries` rows at fire time. */
  notify:      jsonb('notify'),
  enabled:     boolean('enabled').notNull().default(true),
  lastFiredAt: timestamp('last_fired_at'),
  cooldownMin: integer('cooldown_min').notNull().default(60),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_metric_thresholds_metric').on(t.tenantId, t.metric, t.dimensionKey, t.comparator, t.value),
  index('idx_metric_thresholds_enabled').on(t.tenantId, t.enabled),
]);

/** How a dashboard is arranged. The widgets are registry keys, resolved through
 *  the one pinnable-widget registry; the numbers are `metric_facts`. This row is
 *  the ARRANGEMENT, which is the only part that is neither. */
export const dashboardLayouts = pgTable('dashboard_layouts', {
  id:         serial('id').primaryKey(),
  tenantId:   integer('tenant_id').notNull(),
  objectId:   uuid('object_id').references(() => objects.id, { onDelete: 'cascade' }),
  ownerRef:   varchar('owner_ref', { length: 64 }),
  /** Which surface it belongs to — one of the fifteen domains, or the canvas. */
  surface:    varchar('surface', { length: 32 }).notNull().default('platform'),
  name:       varchar('name', { length: 200 }).notNull(),
  /** Widget key + grid position + size. Never queried per-widget, so JSON. */
  layout:     jsonb('layout').notNull().default('[]'),
  isDefault:  boolean('is_default').notNull().default(false),
  isShared:   boolean('is_shared').notNull().default(false),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_dashboard_layouts_name').on(t.tenantId, t.ownerRef, t.surface, t.name),
]);

/** A sign-off on a generated report. The REPORT is an `artifacts` row and its
 *  run is a `runs` row; the approval is a decision somebody is accountable for,
 *  which must survive the report being regenerated. */
export const reportApprovals = pgTable('report_approvals', {
  id:         serial('id').primaryKey(),
  tenantId:   integer('tenant_id').notNull(),
  reportRef:  varchar('report_ref', { length: 64 }).notNull(),
  artifactId: uuid('artifact_id'),
  approverRef: varchar('approver_ref', { length: 64 }).notNull(),
  /** 'pending' | 'approved' | 'rejected' | 'withdrawn'. */
  decision:   varchar('decision', { length: 16 }).notNull().default('pending'),
  comment:    text('comment'),
  decidedAt:  timestamp('decided_at'),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_report_approvals_approver').on(t.tenantId, t.reportRef, t.approverRef),
]);

/** A platform capability flag. Distinct from a `plan_features` entitlement and
 *  from a kernel `settings` row: this is what the PLATFORM has shipped, which
 *  gates a rollout, where the other two gate a customer. */
export const systemFeatures = pgTable('system_features', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id'),
  key:         varchar('key', { length: 96 }).notNull(),
  name:        varchar('name', { length: 200 }).notNull(),
  description: text('description'),
  /** 'off' | 'internal' | 'beta' | 'ga' | 'deprecated'. */
  stage:       varchar('stage', { length: 16 }).notNull().default('off'),
  rolloutPercent: integer('rollout_percent').notNull().default(0),
  /** Tenant ids, user ids or segment keys explicitly opted in ahead of rollout. */
  allowList:   jsonb('allow_list'),
  domain:      varchar('domain', { length: 32 }),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_system_features_key').on(t.key),
]);

/** The platform's own published price list. Distinct from `billing_plans`: a
 *  plan is what a tenant is ON, this is what the public pricing page SAYS, and
 *  the two diverge every time a legacy price is honoured. */
export const platformPricing = pgTable('platform_pricing', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id'),
  planCode:    varchar('plan_code', { length: 64 }).notNull(),
  currency:    varchar('currency', { length: 8 }).notNull().default('USD'),
  monthlyCents: integer('monthly_cents').notNull().default(0),
  yearlyCents: integer('yearly_cents').notNull().default(0),
  /** Country or region this price applies in — purchasing-power pricing is a
   *  row, not a code branch. */
  region:      varchar('region', { length: 16 }).notNull().default('global'),
  effectiveFrom: timestamp('effective_from').notNull().defaultNow(),
  effectiveTo: timestamp('effective_to'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_platform_pricing_plan').on(t.planCode, t.region, t.effectiveFrom),
]);

/** Singleton draft + published snapshot for the public pricing surfaces. Draft
 * edits are deliberately separate from the immutable published snapshot so a
 * half-finished admin edit can never leak onto marketing pages. */
export const platformPricingConfiguration = pgTable('platform_pricing_configuration', {
  key:               varchar('key', { length: 32 }).primaryKey(),
  draftDocument:     jsonb('draft_document').notNull(),
  publishedDocument: jsonb('published_document').notNull(),
  publishedAt:       timestamp('published_at').notNull().defaultNow(),
  publishedBy:       varchar('published_by', { length: 36 }),
  updatedAt:         timestamp('updated_at').notNull().defaultNow(),
});

/**
 * A queued unit of background processing.
 *
 * `queue_job_to_process` and `queue_job_to_resume` are kept as two tables and
 * that is deliberate: a job to PROCESS is claimed once and runs to completion; a
 * job to RESUME is a suspended continuation with a wake condition and a payload
 * that must survive an isolate. They share a name and not a lifecycle, which is
 * the same "same word, different noun" test that kept `modules` apart from
 * `course_modules` (§3.3).
 */
export const queueJobToProcess = pgTable('queue_job_to_process', {
  id:          bigserial('id', { mode: 'number' }).primaryKey(),
  tenantId:    integer('tenant_id'),
  queue:       varchar('queue', { length: 64 }).notNull().default('default'),
  jobKind:     varchar('job_kind', { length: 96 }).notNull(),
  payload:     jsonb('payload'),
  priority:    integer('priority').notNull().default(0),
  runAfter:    timestamp('run_after').notNull().defaultNow(),
  /** Claimed by exactly one worker; the lease expires so a dead worker's job
   *  returns to the queue rather than disappearing. */
  claimedBy:   varchar('claimed_by', { length: 64 }),
  claimedAt:   timestamp('claimed_at'),
  leaseExpiresAt: timestamp('lease_expires_at'),
  attempts:    integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(5),
  lastError:   text('last_error'),
  /** 'queued' | 'claimed' | 'done' | 'failed' | 'dead'. */
  status:      varchar('status', { length: 16 }).notNull().default('queued'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_queue_job_to_process_ready').on(t.status, t.queue, t.priority, t.runAfter),
  index('idx_queue_job_to_process_lease').on(t.status, t.leaseExpiresAt),
]);

/** A suspended continuation waiting on a condition. */
export const queueJobToResume = pgTable('queue_job_to_resume', {
  id:            bigserial('id', { mode: 'number' }).primaryKey(),
  tenantId:      integer('tenant_id'),
  /** The `runs` row this continuation belongs to. */
  runRef:        varchar('run_ref', { length: 64 }),
  resumeKind:    varchar('resume_kind', { length: 96 }).notNull(),
  /** The serialised continuation. Its whole point is surviving an isolate. */
  continuation:  jsonb('continuation'),
  /** What wakes it: a webhook token, a human decision, a timer, a child run. */
  awaitingKind:  varchar('awaiting_kind', { length: 32 }).notNull(),
  awaitingRef:   varchar('awaiting_ref', { length: 128 }),
  wakeAt:        timestamp('wake_at'),
  /** 'waiting' | 'resumed' | 'expired' | 'cancelled'. */
  status:        varchar('status', { length: 16 }).notNull().default('waiting'),
  resumedAt:     timestamp('resumed_at'),
  expiresAt:     timestamp('expires_at'),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_queue_job_to_resume_wake').on(t.status, t.wakeAt),
  uniqueIndex('uq_queue_job_to_resume_awaiting').on(t.awaitingKind, t.awaitingRef),
]);
