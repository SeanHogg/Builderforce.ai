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
import { webhookSubscriptions } from './billing';
import { integrationProviderEnum, integrationSyncStatusEnum, voiceCloneStatusEnum, voiceCloneVisibilityEnum } from './common';
import { segments, tenants, users } from './identity';
import { initiatives } from './pmo';
import { importRuns } from './runtime';
import { ideProjects, importStagedProjects, projects } from './work';


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


/** Per-delivery audit row. `id` doubles as the replay nonce in the signature. */
export const webhookDeliveries = pgTable('webhook_deliveries', {
  id:             uuid('id').primaryKey().defaultRandom(),
  subscriptionId: uuid('subscription_id').notNull().references(() => webhookSubscriptions.id, { onDelete: 'cascade' }),
  tenantId:       integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:      uuid('segment_id').notNull().references(() => segments.id, { onDelete: 'cascade' }),
  eventType:      varchar('event_type', { length: 64 }).notNull(),
  eventId:        varchar('event_id', { length: 255 }).notNull(),
  status:         varchar('status', { length: 16 }).notNull().default('pending'), // pending|delivered|failed
  responseStatus: integer('response_status'),
  attempts:       integer('attempts').notNull().default(0),
  payload:        text('payload'),          // exact signed POST body, for faithful redelivery
  nextRetryAt:    timestamp('next_retry_at'), // when next retry-eligible; NULL = terminal (delivered or exhausted)
  lastError:      text('last_error'),       // most recent failure reason (truncated)
  createdAt:      timestamp('created_at').notNull().defaultNow(),
  deliveredAt:    timestamp('delivered_at'),
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
