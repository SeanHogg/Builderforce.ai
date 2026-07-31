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
import {
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
import { sql } from 'drizzle-orm';
import { brainChats, knowledgeDocuments } from './brain';
import { segments, tenants, users } from './identity';
import { agentHosts, jobPostings } from './runtime';
import { projects, tasks } from './work';


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
  metadata:         text('metadata'),  // JSONB on the wire; stringified on insert.
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
  /** True when this call was served by the tenant's OWN provider credential — a
   *  BYO API key or a connected subscription (migration 0284). The platform pays
   *  nothing for these tokens, so `cost_usd_millicents` is forced to 0, and a BYO
   *  row on the on-prem / VSIX `surface` is EXEMPT from the plan token allowance
   *  (see tokenUsage.ts). BYO cloud-agent rows still count (charged). */
  byo:              boolean('byo').notNull().default(false),
  /** Connected LLM provider credential that funded a BYO call (for example
   *  'anthropic' or 'google'). Null for platform-funded calls. */
  byoProvider:      varchar('byo_provider', { length: 32 }),
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
  tenantApiKeyId:    uuid('tenant_api_key_id'),
  llmProduct:        varchar('llm_product', { length: 32 }),
  /** chat | image | ide-chat | brain | dataset-gen | agent */
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
  jobId:              varchar('job_id', { length: 36 }).references(() => jobPostings.id, { onDelete: 'set null' }),
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
