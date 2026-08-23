/**
 * Schema — Canvas & ideas, owned by the **Brain** (PRD 20 §3).
 *
 * Root entity `creation_session`. 57 source tables in → 8 out, 46 of them absorbed
 * by the kernel — which is the proof, not a gap: the canvas IS `artifact` +
 * `thread` + `message` + `share_link`, so a domain whose tables nearly all became
 * kernel primitives was generalised correctly (§3).
 *
 * Merged from `brain.ts` and `collaboration.ts`, which imported each other in
 * both directions. §2.1's session test is why they were always one domain: if a
 * thing is authored content, that people can be present in, and can be shared, it
 * is not a feature — it is the canvas. Authoring lived in one file and presence in
 * the other, and every feature that needed both had to import across the seam.
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
import { desc, sql } from 'drizzle-orm';
import { activityEventTypeEnum, integrationProviderEnum, newsletterEventTypeEnum, newsletterSubscriptionStatusEnum, objects, teamMemberKindEnum } from './kernel';
import {
  teams,
  segments,
  tenantApiKeys,
  tenants,
  users,
} from './identity';
import { integrationCredentials } from './platform';
import {
  agentDefinitionVersions,
  chatSessions,
  agentHosts,
  agents,
  executions,
  workflowTriggers,
} from './agents';
import { projects, tasks } from './delivery';

// =========================================================================
// One concept, one module. `ceremony_participants` and `ceremony_schedules` were
// declared here while `ceremony_sessions` — the row they both hang off — was in
// `identity.ts`, so the parent of a canvas concept lived in another seat’s file
// and canvas imported it back. It is here now, above its children.
// =========================================================================

// ---------------------------------------------------------------------------
// Ceremony sessions (standup / planning round-table; migration 0119). One row per
// officially-started, timed ceremony; participants carry turn order + speaking time.
// ---------------------------------------------------------------------------

export const ceremonySessions = pgTable('ceremony_sessions', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenantId:       integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:      uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  projectId:      integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  kind:           varchar('kind', { length: 16 }).notNull(),                       // 'standup' | 'planning'
  /** 'active' | 'completed' | 'abandoned' (0364). Abandoned = concluded without being
   *  conducted (nobody came and unattended ceremonies are not granted); it still frees
   *  the partial unique index so the next scheduled ceremony can open. */
  status:         varchar('status', { length: 16 }).notNull().default('active'),
  facilitatorId:  varchar('facilitator_id', { length: 64 }),
  turnMode:       varchar('turn_mode', { length: 16 }).notNull().default('facilitator'),
  turnSeconds:    integer('turn_seconds').notNull().default(90),
  currentTurn:    integer('current_turn'),                                         // index into participants.turnOrder
  turnStartedAt:  timestamp('turn_started_at'),
  startedAt:      timestamp('started_at').notNull().defaultNow(),
  endedAt:        timestamp('ended_at'),
  /** Set when the frequent cron sweep auto-opened this session from a schedule (0349). */
  scheduleId:     uuid('schedule_id'),
  /** Who closed it (0364): 'human' | 'manager' | 'system'. */
  concludedBy:    varchar('concluded_by', { length: 16 }),
  /** Why it closed (0364): 'facilitator' | 'unattended' | 'no_humans' | 'expired'.
   *  Kept separate from `status` so "completed" never has to mean four things. */
  closeReason:    varchar('close_reason', { length: 24 }),
  /** Denormalised outcome counters (0364) — the history LIST renders from these alone,
   *  so showing 20 past standups costs one query rather than 20 participant fan-outs. */
  humansExpected: integer('humans_expected').notNull().default(0),
  humansPresent:  integer('humans_present').notNull().default(0),
  reassignedCount: integer('reassigned_count').notNull().default(0),
  dispatchedCount: integer('dispatched_count').notNull().default(0),
  /** When the "your ceremony is live, come join" fan-out ran; guards re-notification. */
  notifiedAt:     timestamp('notified_at'),
  /** The calendar/video meeting this ceremony is held in (0366). The ceremony owns
   *  ATTENDANCE; the meeting owns the calendar entry and the media room, so joining the
   *  call writes through to this session's presence rather than keeping a rival record. */
  meetingId:      uuid('meeting_id'),
  createdAt:      timestamp('created_at').notNull().defaultNow(),
  updatedAt:      timestamp('updated_at').notNull().defaultNow(),
});


// ═══ from brain.ts ═══
/**
 * Schema — brain context.
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


export const chatMessages = pgTable('chat_messages', {
  id:        serial('id').primaryKey(),
  tenantId:  integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId: uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),  // DB NOT NULL via trigger (0056); optional in TS so single-mode writes need no change
  agentHostId:    integer('agent_host_id').notNull().references(() => agentHosts.id, { onDelete: 'cascade' }),
  sessionId: integer('session_id').notNull().references(() => chatSessions.id, { onDelete: 'cascade' }),
  role:      varchar('role', { length: 16 }).notNull(),
  content:   text('content').notNull().default(''),
  metadata:  text('metadata'),
  seq:       integer('seq').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});


// ---------------------------------------------------------------------------
// Chat memories — compressed summaries of individual chats
// ---------------------------------------------------------------------------
// (The legacy Brain-only `brain_chats`/`brain_messages` tables — superseded by the
// unified chats table in 0026 and orphaned — were dropped in migration 0271; the
// unified table itself was renamed brain_chats there. See `brainChats` below.)

export const chatMemories = pgTable('chat_memories', {
  id:             serial('id').primaryKey(),
  tenantId:       integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId: uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),  // DB NOT NULL via trigger (0056); optional in TS so single-mode writes need no change
  // Vestigial link to the old legacy brain_chats (dropped 0272) — chat memories
  // are keyed on agent_host_session_id in practice; no FK (plain nullable id).
  chatId:         integer('chat_id').unique(),
  agentHostSessionId:  integer('agent_host_session_id').references(() => chatSessions.id, { onDelete: 'cascade' }).unique(),
  projectId:      integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
  summary:        text('summary').notNull().default(''),
  createdAt:      timestamp('created_at').notNull().defaultNow(),
  updatedAt:      timestamp('updated_at').notNull().defaultNow(),
});


// ---------------------------------------------------------------------------
// Brain chats (unified, all-modality) — Brain Storm, IDE, and project-level chat
// in ONE table (this is the store the live Brain reads/writes on every surface —
// web, VS Code, on-prem). origin = 'brainstorm' | 'ide' | 'project' | 'team' tells
// the page which tools/actions to load. origin='team' is the canonical, always-there
// GROUP chat for a whole team — ONE per (tenant, projectId), projectId NULL for the
// tenant-wide team chat (see migration 0294's uq_team_chat_scope). Named
// `ide_project_chats` until migration 0272
// renamed it `brain_chats` (the `ide_` prefix was a historical artifact — it
// started IDE-only, then 0026 generalized it via the origin column).
// ---------------------------------------------------------------------------

export const brainChats = pgTable('brain_chats', {
  id:        serial('id').primaryKey(),
  projectId: integer('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  tenantId:  integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId: uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),  // DB NOT NULL via trigger (0056); optional in TS so single-mode writes need no change
  userId:    varchar('user_id', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  origin:     varchar('origin', { length: 32 }).notNull().default('ide'),
  title:      varchar('title', { length: 500 }).notNull().default('New chat'),
  summary:    text('summary'),
  isArchived: boolean('is_archived').notNull().default(false),
  /** LOCK primitive (0288): 'shared' = visible/joinable by any tenant teammate
   *  (chats are global to project+tenant); 'locked' = private to owner + members. */
  visibility: varchar('visibility', { length: 16 }).notNull().default('shared'),
  /** What this chat is MAKING (0345) — a capability id from the client-side
   *  registry (document / slides / dataviz / spreadsheet / website / design /
   *  mobile / animation / game3d). Shapes the system prompt and the export format.
   *  NULL = no capability ("anything"). Free-form: an unknown id reads as NULL. */
  capability: varchar('capability', { length: 64 }),
  /** What this chat is FOR (0409) — 'chat' (a CONVERSATION: read, reason, answer)
   *  or 'work' (an EXECUTION: create + staff + link the ticket, then dispatch an
   *  agent to run it). Gates the chat⇄work linking directive at runtime and is the
   *  dimension the mode usage rollup buckets on. Free-form varchar for the same
   *  reason `capability` is: the vocabulary lives in brain-embedded/src/chatMode.ts
   *  and an unknown value resolves to the default on read. */
  mode: varchar('mode', { length: 16 }).notNull().default('chat'),
  /** Consolidation pointer (0266): when this chat was merged into another, the
   *  surviving chat's id. Set with isArchived=true so the source drops out of the
   *  list but any ticket still resolves to the one surviving conversation. */
  mergedIntoChatId: integer('merged_into_chat_id').references((): AnyPgColumn => brainChats.id, { onDelete: 'set null' }),
  /** TEAM CHAT scope (0294): when origin='team', which workforce team this chat is
   *  the group channel for. NULL (with projectId also NULL) = the tenant-wide
   *  "broader team" chat; projectId set = the project team chat. */
  teamId:     integer('team_id').references(() => teams.id, { onDelete: 'cascade' }),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  /** Serves listChats (0417): equality on tenant+origin, then ORDER BY updated_at
   *  DESC LIMIT n. Every other index on this table is equality-only, so without
   *  this one the list sorts every non-archived chat in the tenant per page. The
   *  partial predicate matches the query — archived chats are never listed. */
  index('idx_brain_chats_tenant_origin_recent')
    .on(t.tenantId, t.origin, desc(t.updatedAt))
    .where(sql`is_archived = false`),
]);


// ---------------------------------------------------------------------------
// Chat read state (0361) — per-user read high-water mark for a Brain chat, so the
// web can show an "unread" badge when execution milestones (or a teammate/agent
// message) land in a chat the user is not viewing. Keyed by (chat_id, user_id) so
// it covers BOTH the chat owner (no chat_members row) and shared participants.
// last_read_seq is compared against brain_chat_messages.seq (= the message PK):
// unread when max(seq) > last_read_seq. A row exists only once the user has OPENED
// the chat — so unread accrues only on conversations the user has actually read.
// ---------------------------------------------------------------------------

export const chatReadState = pgTable('chat_read_state', {
  chatId:      integer('chat_id').notNull().references(() => brainChats.id, { onDelete: 'cascade' }),
  userId:      varchar('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  lastReadSeq: integer('last_read_seq').notNull().default(0),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.chatId, t.userId] }),
  index('idx_chat_read_state_user').on(t.tenantId, t.userId),
]);


// ---------------------------------------------------------------------------
// Chat <-> ticket links (0266) — a many-to-many, lineage-aware edge between a
// Brain chat and a work item of ANY tier (portfolio | objective | initiative |
// epic | task). MANY chats can reference one ticket; ONE chat can reference MANY
// tickets (a brainstorm that spawned several). ticketRef is the target id AS TEXT
// (tasks.id is int; the strategy-tier ids are UUIDs) so one column addresses
// every tier — resolved against the right table by ticketKind at read time.
// ---------------------------------------------------------------------------

export const chatTicketLinks = pgTable('chat_ticket_links', {
  id:         serial('id').primaryKey(),
  tenantId:   integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:  uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  chatId:     integer('chat_id').notNull().references(() => brainChats.id, { onDelete: 'cascade' }),
  /** 'portfolio'|'objective'|'initiative'|'roadmap'|'spec'|'epic'|'gap'|'task' (spine + roadmap + spec + gap). */
  ticketKind: varchar('ticket_kind', { length: 12 }).notNull(),
  /** Target id as text — tasks.id (epic/gap/task) or a UUID (portfolio/objective/initiative/roadmap/spec). */
  ticketRef:  varchar('ticket_ref', { length: 64 }).notNull(),
  /** Lineage: 'created' (ticket spawned from this chat) | 'linked' (attached later). */
  linkType:   varchar('link_type', { length: 16 }).notNull().default('linked'),
  /** User id or agent ref that made the link (provenance). */
  createdBy:  varchar('created_by', { length: 64 }),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_chat_ticket_links').on(t.chatId, t.ticketKind, t.ticketRef),
  index('idx_chat_ticket_links_chat').on(t.tenantId, t.chatId),
  index('idx_chat_ticket_links_ticket').on(t.tenantId, t.ticketKind, t.ticketRef),
]);


export const brainChatMessages = pgTable('brain_chat_messages', {
  id:        serial('id').primaryKey(),
  chatId:    integer('chat_id').notNull().references(() => brainChats.id, { onDelete: 'cascade' }),
  role:      varchar('role', { length: 16 }).notNull(),
  content:   text('content').notNull().default(''),
  metadata:  text('metadata'),
  /** Optional producer idempotency key (for example executionId:phase). */
  eventKey:  varchar('event_key', { length: 160 }),
  seq:       integer('seq').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_brain_chat_messages_event').on(t.chatId, t.eventKey),
]);


// ---------------------------------------------------------------------------
// Team memory — cross-agentHost memory sharing mesh (P4-5)
// ---------------------------------------------------------------------------

export const teamMemory = pgTable('team_memory', {
  id:        uuid('id').primaryKey().defaultRandom(),
  tenantId:  integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId: uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),  // DB NOT NULL via trigger (0056); optional in TS so single-mode writes need no change
  /** Numeric agentHost ID stored as string for flexibility. */
  agentHostId:    varchar('agent_host_id', { length: 64 }).notNull(),
  runId:     varchar('run_id', { length: 64 }).notNull(),
  summary:   text('summary').notNull(),
  /** JSON array of tag strings, stored as text. */
  tags:      text('tags').notNull().default('[]'),
  /** ISO-8601 timestamp provided by the agentHost. */
  timestamp: varchar('timestamp', { length: 32 }).notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});


/**
 * Marketplace listings for KNOWLEDGE documents (migration 0252). Lets a tenant
 * publish a SOP/process/doc/canvas for sale; the listing carries a content
 * snapshot so installing copies it into the buyer's tenant as a new document.
 * Mirrors marketplacePersonas. Charging/checkout (price_cents) is a separate
 * Stripe integration — install currently grants a copy.
 */
export const marketplaceKnowledge = pgTable('marketplace_knowledge', {
  id:               uuid('id').primaryKey().defaultRandom(),
  tenantId:         integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  createdBy:        varchar('created_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  /** The document this listing was published from (SET NULL if it is deleted). */
  sourceDocumentId: uuid('source_document_id').references(() => knowledgeDocuments.id, { onDelete: 'set null' }),
  title:            varchar('title', { length: 255 }).notNull(),
  summary:          text('summary'),
  docType:          varchar('doc_type', { length: 16 }).notNull().default('doc'),
  /** Content snapshot used to recreate the document on install. */
  content:          text('content').notNull().default(''),
  category:         varchar('category', { length: 100 }),
  /** JSON array of tag strings. */
  tags:             text('tags').notNull().default('[]'),
  /** Sale price in cents (0 = free). */
  priceCents:       integer('price_cents').notNull().default(0),
  /** 'private' | 'tenant' | 'public' */
  visibility:       varchar('visibility', { length: 16 }).notNull().default('public'),
  authorName:       varchar('author_name', { length: 255 }),
  installCount:     integer('install_count').notNull().default(0),
  likeCount:        integer('like_count').notNull().default(0),
  createdAt:        timestamp('created_at').notNull().defaultNow(),
  updatedAt:        timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byTenant:   index('idx_marketplace_knowledge_tenant').on(t.tenantId),
}));


/**
 * knowledge_listing_purchases (migration 0320) — proof a tenant bought a PAID
 * knowledge listing, which unlocks install for the whole workspace. Free listings
 * need no row. One purchase per (listing, tenant).
 */
export const knowledgeListingPurchases = pgTable('knowledge_listing_purchases', {
  id:           uuid('id').primaryKey().defaultRandom(),
  listingId:    uuid('listing_id').notNull().references(() => marketplaceKnowledge.id, { onDelete: 'cascade' }),
  tenantId:     integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  purchasedBy:  varchar('purchased_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  priceCents:   integer('price_cents').notNull().default(0),
  provider:     varchar('provider', { length: 24 }).notNull().default('manual'),
  externalRef:  varchar('external_ref', { length: 255 }),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  uniq: uniqueIndex('knowledge_listing_purchase_unique').on(t.listingId, t.tenantId),
}));


// ---------------------------------------------------------------------------
// Knowledge Management — SOPs, processes & documents (migration 0227)
//
// Team-authored knowledge with versioning, tagging, read-acknowledgement
// (audit evidence for SOX/TISAX/ISO) and training assignments with due dates.
// Tenant + segment scoped; optionally project scoped (null = workspace-wide).
// ---------------------------------------------------------------------------

/** A knowledge document: an SOP, process flow, or general doc. */
export const knowledgeDocuments = pgTable('knowledge_documents', {
  id:            uuid('id').primaryKey().defaultRandom(),
  tenantId:      integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:     uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  projectId:     integer('project_id').references(() => projects.id, { onDelete: 'set null' }), // null = workspace-wide
  docType:       varchar('doc_type', { length: 16 }).notNull().default('sop'),   // 'sop' | 'process' | 'doc' | 'postmortem' | 'known_error'
  title:         varchar('title', { length: 255 }).notNull(),
  summary:       varchar('summary', { length: 500 }),
  content:       text('content').notNull().default(''),
  status:        varchar('status', { length: 16 }).notNull().default('draft'),   // 'draft' | 'published' | 'archived'
  versionNumber: integer('version_number').notNull().default(0),                 // monotonic published version
  requiresAck:   boolean('requires_ack').notNull().default(false),
  /** For an incident RCA / post-mortem (docType 'postmortem'), the prod_incidents
   *  record it reviews (migration 0328) — the Knowledge → incident back-link. Null on
   *  ordinary docs. */
  sourceIncidentId: uuid('source_incident_id'),
  createdBy:     varchar('created_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  updatedBy:     varchar('updated_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  publishedAt:   timestamp('published_at'),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
});


/** Immutable snapshot of a document at the moment it was published. */
export const knowledgeDocumentVersions = pgTable('knowledge_document_versions', {
  id:            uuid('id').primaryKey().defaultRandom(),
  tenantId:      integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  documentId:    uuid('document_id').notNull().references(() => knowledgeDocuments.id, { onDelete: 'cascade' }),
  versionNumber: integer('version_number').notNull(),
  title:         varchar('title', { length: 255 }).notNull(),
  content:       text('content').notNull(),
  changeNote:    varchar('change_note', { length: 500 }),
  publishedBy:   varchar('published_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  uqVersion: uniqueIndex('uq_knowledge_versions').on(t.documentId, t.versionNumber),
}));


/** Free-form tags for filtering/organising knowledge. */
export const knowledgeDocumentTags = pgTable('knowledge_document_tags', {
  id:            uuid('id').primaryKey().defaultRandom(),
  tenantId:      integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  documentId:    uuid('document_id').notNull().references(() => knowledgeDocuments.id, { onDelete: 'cascade' }),
  tag:           varchar('tag', { length: 64 }).notNull(),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  uqTag: uniqueIndex('uq_knowledge_tags').on(t.documentId, t.tag),
}));


/** Audit evidence: a user read & acknowledged a specific published version. */
export const knowledgeAcknowledgements = pgTable('knowledge_acknowledgements', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenantId:       integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  documentId:     uuid('document_id').notNull().references(() => knowledgeDocuments.id, { onDelete: 'cascade' }),
  userId:         varchar('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  versionNumber:  integer('version_number').notNull(),
  acknowledgedAt: timestamp('acknowledged_at').notNull().defaultNow(),
}, (t) => ({
  uqAck: uniqueIndex('uq_knowledge_acks').on(t.documentId, t.userId),
}));


/** Per-document collaborators: users explicitly invited to a page (editor|viewer). */
export const knowledgeDocumentCollaborators = pgTable('knowledge_document_collaborators', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  documentId:  uuid('document_id').notNull().references(() => knowledgeDocuments.id, { onDelete: 'cascade' }),
  userId:      varchar('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  role:        varchar('role', { length: 16 }).notNull().default('editor'), // 'editor' | 'viewer'
  invitedBy:   varchar('invited_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  uqCollab: uniqueIndex('uq_knowledge_collab').on(t.documentId, t.userId),
}));


// ---------------------------------------------------------------------------
// FACTS library — structured (subject, predicate, object) triples with
// provenance. Powers /api/facts + the /facts page; recallable by agent tooling.
// Migration 0300. project_id NULL → tenant-global fact; set → project-scoped.
// ---------------------------------------------------------------------------
export const facts = pgTable('facts', {
  id:         uuid('id').primaryKey().defaultRandom(),
  tenantId:   integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  projectId:  integer('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  subject:    varchar('subject', { length: 255 }).notNull(),
  predicate:  varchar('predicate', { length: 255 }).notNull(),
  object:     text('object').notNull(),
  source:     varchar('source', { length: 255 }),
  confidence: real('confidence'),
  createdBy:  varchar('created_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('idx_facts_tenant_updated').on(t.tenantId, t.updatedAt),
  index('idx_facts_tenant_subject').on(t.tenantId, t.subject),
  index('idx_facts_tenant_predicate').on(t.tenantId, t.predicate),
  index('idx_facts_tenant_project').on(t.tenantId, t.projectId),
]);


/**
 * Two-party employer<->freelancer thread (0298). Read state is tracked per SIDE
 * via the two watermark columns, not per message, so a thread with many managers
 * on the employer side stays correct.
 */
export const freelancerConversations = pgTable('freelancer_conversations', {
  id:                   varchar('id', { length: 36 }).primaryKey(),
  tenantId:             integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  freelancerUserId:     varchar('freelancer_user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** The manager who opened the thread (employer-side default notify target). */
  employerUserId:       varchar('employer_user_id', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  /** What the thread hangs off: engagement | job | proposal | direct. */
  subjectType:          varchar('subject_type', { length: 20 }).notNull().default('direct'),
  engagementId:         varchar('engagement_id', { length: 36 }).references(() => freelancerEngagements.id, { onDelete: 'set null' }),
  /** `job_postings.id` / `job_proposals.id` — the hiring domain owns both, so they
   *  are ids here rather than imported tables (§3). FKs in migration 0298. */
  jobId:                varchar('job_id', { length: 36 }),
  proposalId:           varchar('proposal_id', { length: 36 }),
  projectId:            integer('project_id'),
  title:                varchar('title', { length: 200 }),
  /** Denormalized last-message cache so the list view renders without a per-row scan. */
  lastMessageAt:        timestamp('last_message_at'),
  lastMessagePreview:   varchar('last_message_preview', { length: 280 }),
  lastSenderUserId:     varchar('last_sender_user_id', { length: 36 }),
  employerLastReadAt:   timestamp('employer_last_read_at'),
  freelancerLastReadAt: timestamp('freelancer_last_read_at'),
  createdAt:            timestamp('created_at').notNull().defaultNow(),
  updatedAt:            timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byTenant:     index('idx_fl_conv_tenant').on(t.tenantId, t.lastMessageAt),
  byFreelancer: index('idx_fl_conv_freelancer').on(t.freelancerUserId, t.lastMessageAt),
}));


/** A single message in a {@link freelancerConversations} thread (0298). */
export const freelancerMessages = pgTable('freelancer_messages', {
  id:             varchar('id', { length: 36 }).primaryKey(),
  conversationId: varchar('conversation_id', { length: 36 }).notNull().references(() => freelancerConversations.id, { onDelete: 'cascade' }),
  senderUserId:   varchar('sender_user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  body:           text('body').notNull(),
  /** Optional attachment (R2 object) — a signed/served link the recipient can open. */
  attachmentKey:  varchar('attachment_key', { length: 255 }),
  attachmentName: varchar('attachment_name', { length: 255 }),
  attachmentType: varchar('attachment_type', { length: 120 }),
  createdAt:      timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  byConversation: index('idx_fl_msg_conversation').on(t.conversationId, t.createdAt),
}));


// ═══ from collaboration.ts ═══
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
 * Unified activity / audit log — MOVED to the kernel (PRD 20 §2).
 *
 * It was always the primitive the other 24 are modelled on: migration 0295
 * dropped `audit_events` and made this the single audit store, which is the
 * in-repo precedent the whole kernel argument rests on. It now lives in
 * `schema/kernel.ts`, re-exported here so the ~40 modules importing
 * `activityLog` from this context keep working.
 */
export { activityLog } from './kernel';





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
  /** The grant, sealed by `oauthTokenVault` with the tenant's key — the same
   *  storage every other per-user connection uses (mailbox, drive). NULL only for
   *  a row written before migration 1107 and not yet touched since. */
  tokenEnc:      text('token_enc'),
  tokenIv:       text('token_iv'),
  /** LEGACY plaintext grant (pre-1107). Read-only fallback: the first refresh
   *  after 1107 seals the row and clears these. Dropped once the backfill drains
   *  — see the migration note. Never write to them. */
  accessToken:   text('access_token'),
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
  /** `fixed_bid|hourly|fte` — the shape AT THE TIME OF HIRE (migration 0930). A
   *  declared denormalisation of `job_postings.engagement_type` with a single writer
   *  (`application/marketplace/engagementShape.ts`): the direct-hire path has no posting
   *  to join to, and the escrow work gate cannot be correct without it. NULL means
   *  "not stated", which the gate reads as not-fixed-price. */
  engagementType:     varchar('engagement_type', { length: 20 }),
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


/**
 * One deliverable in a FIXED-PRICE payment schedule, and its escrow state.
 *
 * Hourly work is transacted through `timecards`; a fixed bid had no equivalent, so a
 * freelancer could be hired on one and there was nowhere to record what the
 * deliverables were, whether the money existed, or that a deliverable was accepted
 * (migration 0924). This is the AGREEMENT half only — no balance lives here. Every
 * hold, payout and refund is a `ledger_entries` row (`entry_kind` already carries
 * `'hold'`), per PRD 20's rule that the finance domain holds no balances.
 *
 * `job_id` and `engagement_id` are both nullable with a CHECK that one is set: a
 * schedule is proposed against a JOB while bidding and carried forward onto the
 * ENGAGEMENT when the bid is accepted, so the rows the client agreed to are the same
 * rows they later fund. The legal transitions live in `application/marketplace/escrow.ts`.
 */
export const engagementMilestones = pgTable('engagement_milestones', {
  id:                varchar('id', { length: 36 }).primaryKey(),
  tenantId:          integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  /** `job_postings.id` — hiring’s, so an id (§3). FK in migration 0924. */
  jobId:             varchar('job_id', { length: 36 }),
  engagementId:      varchar('engagement_id', { length: 36 }).references(() => freelancerEngagements.id, { onDelete: 'cascade' }),
  proposalId:        varchar('proposal_id', { length: 36 }),
  /** Denormalised from the engagement with a single writer (the accept path): a
   *  release must pay whoever was engaged at the time, not whoever is engaged now. */
  freelancerUserId:  varchar('freelancer_user_id', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  title:             varchar('title', { length: 200 }).notNull(),
  description:       text('description'),
  /** Position in the schedule — part of the agreement, so not a sort on `created_at`. */
  sequence:          integer('sequence').notNull().default(0),
  amountCents:       integer('amount_cents').notNull().default(0),
  currency:          varchar('currency', { length: 3 }).notNull().default('USD'),
  /** draft|funded|submitted|approved|released|cancelled|disputed — see escrow.ts. */
  status:            varchar('status', { length: 20 }).notNull().default('draft'),
  dueAt:             timestamp('due_at'),
  fundedAt:          timestamp('funded_at'),
  submittedAt:       timestamp('submitted_at'),
  approvedAt:        timestamp('approved_at'),
  releasedAt:        timestamp('released_at'),
  cancelledAt:       timestamp('cancelled_at'),
  submissionNote:    text('submission_note'),
  rejectionReason:   text('rejection_reason'),
  createdByUserId:   varchar('created_by_user_id', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  createdAt:         timestamp('created_at').notNull().defaultNow(),
  updatedAt:         timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byEngagement:  index('idx_engagement_milestones_engagement').on(t.engagementId, t.sequence),
  byJob:         index('idx_engagement_milestones_job').on(t.jobId, t.sequence),
  byTenant:      index('idx_engagement_milestones_tenant_status').on(t.tenantId, t.status),
  byFreelancer:  index('idx_engagement_milestones_freelancer').on(t.freelancerUserId, t.status),
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
  agentDefinitionVersionId: uuid('agent_definition_version_id').references(() => agentDefinitionVersions.id, { onDelete: 'restrict' }),
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

/** A folder for organizing Creation Sessions (migration 1118). Real entity
 *  rather than a free-text label on the session: that was the same mistake
 *  {@link creationSessionProjectLinks} already reasons about — a folder's
 *  name and its optional Project tie are both facts about the FOLDER, and
 *  storing them per-session would let sessions in the "same" folder disagree. */
export const creationSessionFolders = pgTable('creation_session_folders', {
  id:         uuid('id').primaryKey().defaultRandom(),
  tenantId:   integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:  uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  name:       varchar('name', { length: 120 }).notNull(),
  /** Every session filed into this folder is, by that fact, tied to this Project. */
  projectId:  integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
  createdBy:  varchar('created_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  uqName: uniqueIndex('uq_creation_session_folders_name').on(t.tenantId, t.segmentId, sql`lower(${t.name})`),
  byProject: index('idx_creation_session_folders_project').on(t.projectId, t.createdAt),
}));

/** A durable, tenant-owned infinite canvas. A Project is optional context, not
 *  the owner of the session; project associations live in the link table below. */
export const creationSessions = pgTable('creation_sessions', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenantId:       integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:      uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  title:          varchar('title', { length: 255 }).notNull().default('Untitled session'),
  description:    text('description'),
  folderId:       uuid('folder_id').references(() => creationSessionFolders.id, { onDelete: 'set null' }),
  status:         varchar('status', { length: 16 }).notNull().default('active'),
  /** What this canvas session is FOR (0409) — 'chat' (a conversation: read, reason,
   *  answer, author objects) or 'work' (an execution: turn the conclusion into a
   *  ticket and dispatch an agent to run it). Same vocabulary as `brain_chats.mode`
   *  (brain-embedded/src/chatMode.ts); an unknown value resolves to the default. */
  mode:           varchar('mode', { length: 16 }).notNull().default('chat'),
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
  byFolder: index('idx_creation_sessions_tenant_folder').on(t.tenantId, t.segmentId, t.folderId, t.lastActivityAt),
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
/**
 * `creation_session_invites` was DROPPED by migration 0435 (PRD 20 §5 step 5,
 * family 1). A canvas-session invitation is now an `invitations` row with
 * `kind = 'session'` whose `object_id` points at the session's registry entry.
 * Read and write it through `application/kernel/InvitationService`.
 */

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

/** Outcome telemetry is the value ledger for Creation Sessions. Unlike the
 * low-level revision event stream, every row carries a correlation id and can
 * roll up without exposing canvas content: session -> project -> tenant ->
 * platform. A single user/agent action may emit started + terminal rows. */
export const creationOutcomeEvents = pgTable('creation_outcome_events', {
  id:             uuid('id').primaryKey().defaultRandom(),
  correlationId:  varchar('correlation_id', { length: 128 }).notNull(),
  sessionId:      uuid('session_id').notNull().references(() => creationSessions.id, { onDelete: 'cascade' }),
  tenantId:       integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  projectId:      integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
  actorType:      varchar('actor_type', { length: 16 }).notNull().default('user'),
  actorRef:       varchar('actor_ref', { length: 128 }),
  action:         varchar('action', { length: 64 }).notNull(),
  phase:          varchar('phase', { length: 16 }).notNull(),
  metricKey:      varchar('metric_key', { length: 80 }),
  metricValue:    real('metric_value'),
  unit:           varchar('unit', { length: 24 }),
  artifactId:     varchar('artifact_id', { length: 128 }),
  durationMs:     integer('duration_ms'),
  costUsdMillicents: integer('cost_usd_millicents'),
  metadata:       jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
  occurredAt:     timestamp('occurred_at').notNull().defaultNow(),
}, (t) => ({
  bySession: index('idx_creation_outcomes_session_time').on(t.sessionId, t.occurredAt),
  byProject: index('idx_creation_outcomes_project_time').on(t.projectId, t.occurredAt),
  byTenant: index('idx_creation_outcomes_tenant_time').on(t.tenantId, t.occurredAt),
  byCorrelation: index('idx_creation_outcomes_correlation').on(t.sessionId, t.correlationId),
  correlationPhase: uniqueIndex('uq_creation_outcomes_correlation_phase').on(t.sessionId, t.correlationId, t.action, t.phase),
}));

export const creationSessionComments = pgTable('creation_session_comments', {
  id:              uuid('id').primaryKey().defaultRandom(),
  sessionId:       uuid('session_id').notNull().references(() => creationSessions.id, { onDelete: 'cascade' }),
  objectId:        uuid('object_id').references(() => creationSessionObjects.id, { onDelete: 'set null' }),
  parentCommentId: uuid('parent_comment_id'),
  body:            text('body').notNull(),
  mentions:        jsonb('mentions').notNull().default(sql`'[]'::jsonb`),
  /** Stable semantic location, e.g. {kind:'resume-field',revisionId,section,entryId,field}. */
  anchor:          jsonb('anchor'),
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
  /**
   * WHAT THIS LINK MEANS (0473).
   *
   * `reference` — the original behaviour and the default: this board mentions
   *   that project. Many-to-many, and copied when a board is branched or copied.
   * `app` — this board IS that project. The identity link written when a board
   *   is converted into an app, unique on BOTH sides (partial indexes), and
   *   deliberately NOT copied by branch/copy: a copy of a board is a new board,
   *   not a second claim on somebody's running app.
   *
   * A role on the existing association rather than a `project_id` column on
   * `creation_sessions`: the relationship already had a home, and storing it
   * twice is two facts free to disagree.
   */
  linkKind:  varchar('link_kind', { length: 16 }).notNull().default('reference'),
  addedBy:   varchar('added_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.sessionId, t.projectId] }),
  byProject: index('idx_creation_project_links_project').on(t.projectId, t.createdAt),
}));

/** The two roles a session↔project link can carry. Shared so the conversion
 *  path, the branch/copy filter and the readers cannot drift on the spelling. */
export const SESSION_PROJECT_LINK_REFERENCE = 'reference';
export const SESSION_PROJECT_LINK_APP = 'app';

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

/**
 * A registered third-party canvas widget (migration 1101).
 *
 * Somebody else's page, which a board may embed in a sandboxed frame and speak to
 * over the fixed vocabulary in `@builderforce/canvas-widget-protocol`. This is the
 * SERVER half of the widget runtime: what was registered, what it is allowed to
 * do, and the single origin its messages may arrive from.
 *
 * `entryOrigin` is DERIVED from `entryUrl` at registration and never accepted from
 * the caller — a manifest that declares its own trusted origin is a manifest that
 * trusts itself. It is stored rather than recomputed because it is a security
 * predicate compared in more than one runtime, and a predicate recomputed in three
 * places will one day be computed differently in one of them.
 *
 * There is no placement table. A widget ON a board is a `creation_session_objects`
 * row whose `resource_type` is 'canvas_widget' and whose `resource_id` is this
 * row's id — geometry, z-order, locking and the revision protocol already belong
 * to the canvas graph, and a second placement table would fork all four.
 */
export const canvasWidgets = pgTable('canvas_widgets', {
  id:              uuid('id').primaryKey().defaultRandom(),
  tenantId:        integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  /** Caller-chosen stable id, unique per workspace, so an integrator can upsert
   *  from CI without storing our uuid. */
  widgetKey:       varchar('widget_key', { length: 64 }).notNull(),
  name:            varchar('name', { length: 120 }).notNull(),
  description:     text('description'),
  entryUrl:        text('entry_url').notNull(),
  entryOrigin:     varchar('entry_origin', { length: 255 }).notNull(),
  iconUrl:         text('icon_url'),
  /** The APPROVED permission set, from CANVAS_WIDGET_PERMISSIONS. The host reads
   *  this — never what the frame claims about itself at runtime. */
  permissions:     jsonb('permissions').$type<string[]>().notNull().default([]),
  version:         varchar('version', { length: 32 }).notNull().default('1.0.0'),
  defaultWidth:    integer('default_width').notNull().default(480),
  defaultHeight:   integer('default_height').notNull().default(360),
  /** 'active' | 'disabled'. Disabling stops the host mounting the frame without
   *  deleting the registration, so a board that already placed it shows a disabled
   *  card rather than an empty rectangle. */
  status:          varchar('status', { length: 16 }).notNull().default('active'),
  createdByKeyId:  uuid('created_by_key_id').references(() => tenantApiKeys.id, { onDelete: 'set null' }),
  createdAt:       timestamp('created_at').notNull().defaultNow(),
  updatedAt:       timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byKey:    uniqueIndex('uq_canvas_widgets_key').on(t.tenantId, t.widgetKey),
  byTenant: index('idx_canvas_widgets_tenant_status').on(t.tenantId, t.status),
}));

// ═══ PRD 20 §5 step 2 — target-schema tables ═══
//
// Canvas & ideas — the Brain's two remaining targets (PRD 20 §3.2).
//
// 57 source tables in → 8 out, 46 absorbed by the kernel. **That is the proof,
// not a gap** (§3): the canvas IS `artifact` + `thread` + `message` +
// `share_link`, so a domain whose tables nearly all became kernel primitives was
// generalised correctly.
//
// §2.1's session test is what did it. 75 tables across the three schemas sat in
// exactly one shape — authored content, that people can be present in, that can
// be shared — and needed zero new tables: 13 authoring containers, 15 per-feature
// meeting tables, 8 attendee tables, 6 transcript/recording tables, 16
// share-and-view tables (six independently reinvented view-duration tracking) and
// 18 thread/message tables. `scratch_pad_meetings` existed only because the pad
// owned its own meeting; hoisting presence into the shell is what deleted it.
//
// The two that survive are the two the session test does NOT cover: a licensed
// asset the tenant does not own, and an interview conducted with nobody present.

/**
 * A licensed stock asset available to compose with.
 *
 * Not an `artifacts` row, and the distinction is a licensing one rather than a
 * modelling one: an artifact is something the tenant MADE and owns. A stock
 * asset is something a provider licensed under terms, and the terms — attribution,
 * territory, expiry, per-seat usage caps — are the whole reason the row exists.
 * Using one COPIES it into `artifacts`; the usage is recorded against this row.
 */
export const stockMediaAssets = pgTable('stock_media_assets', {
  id:           serial('id').primaryKey(),
  tenantId:     integer('tenant_id'),
  provider:     varchar('provider', { length: 48 }).notNull(),
  providerRef:  varchar('provider_ref', { length: 160 }).notNull(),
  /** 'image' | 'video' | 'audio' | 'icon' | 'font' | 'model3d'. */
  kind:         varchar('kind', { length: 24 }).notNull(),
  title:        varchar('title', { length: 300 }),
  previewUrl:   text('preview_url'),
  width:        integer('width'),
  height:       integer('height'),
  durationMs:   integer('duration_ms'),
  keywords:     jsonb('keywords'),
  /** The terms. `attributionRequired` is a column and not a JSON key because a
   *  render pipeline has to filter on it before it composes, not after. */
  licenseKind:  varchar('license_kind', { length: 32 }).notNull().default('royalty_free'),
  attributionRequired: boolean('attribution_required').notNull().default(false),
  attributionText: varchar('attribution_text', { length: 500 }),
  licenseExpiresAt: timestamp('license_expires_at'),
  costCents:    integer('cost_cents').notNull().default(0),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_stock_media_assets_provider').on(t.provider, t.providerRef),
  index('idx_stock_media_assets_kind').on(t.kind, t.licenseKind),
]);

/**
 * An asynchronous interview — a recorded session with nobody else present.
 *
 * The session test says authored content plus PRESENCE plus shareable is the
 * canvas. This is the case that fails the middle clause on purpose: an async
 * interview is a prompt, a timer and a recording, with no room and no
 * participants, and modelling it as a meeting with zero attendees is how the
 * question "who was in this" starts returning a lie.
 *
 * The questions are a `question_sets` row, the takes are `artifacts` derived
 * from one another, and the reviewer's scores are `responses`.
 */
export const studioAsyncInterviews = pgTable('studio_async_interviews', {
  id:            serial('id').primaryKey(),
  tenantId:      integer('tenant_id').notNull(),
  objectId:      uuid('object_id').references(() => objects.id, { onDelete: 'cascade' }),
  questionSetId: uuid('question_set_id'),
  subjectRef:    varchar('subject_ref', { length: 64 }),
  subjectEmail:  varchar('subject_email', { length: 320 }),
  /** How the subject is let in. A `share_links` token, so there is one
   *  revocation path rather than a second one invented here. */
  shareLinkId:   uuid('share_link_id'),
  /** Seconds allowed per question, and how many attempts. Config, not columns
   *  per question — the per-question overrides live on the question set. */
  thinkSeconds:  integer('think_seconds').notNull().default(30),
  answerSeconds: integer('answer_seconds').notNull().default(120),
  maxTakes:      integer('max_takes').notNull().default(2),
  /** 'draft' | 'sent' | 'started' | 'submitted' | 'reviewed' | 'expired'. */
  status:        varchar('status', { length: 16 }).notNull().default('draft'),
  invitedAt:     timestamp('invited_at'),
  startedAt:     timestamp('started_at'),
  submittedAt:   timestamp('submitted_at'),
  expiresAt:     timestamp('expires_at'),
  reviewerRef:   varchar('reviewer_ref', { length: 64 }),
  reviewedAt:    timestamp('reviewed_at'),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_studio_async_interviews_status').on(t.tenantId, t.status, t.expiresAt),
  index('idx_studio_async_interviews_subject').on(t.tenantId, t.subjectRef),
]);


// ---------------------------------------------------------------------------
// Moved here from `identity.ts` (PRD 20 §3). Each hangs off a CANVAS aggregate —
// a brain chat, a dev team, a meeting — and was only in Identity because it also
// names a user. Same reason as the agents.ts block: naming a user does not make a
// row Identity's, or Identity ends up importing the domains that depend on it.
// ---------------------------------------------------------------------------

export const chatMembers = pgTable('chat_members', {
  id:           serial('id').primaryKey(),
  chatId:       integer('chat_id').notNull().references(() => brainChats.id, { onDelete: 'cascade' }),
  tenantId:     integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:    uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  /** Resolved member (an existing account); NULL while the invite is pending. */
  userId:       varchar('user_id', { length: 36 }).references(() => users.id, { onDelete: 'cascade' }),
  /** Lower-cased; set for a cold invite whose email has no account yet. */
  invitedEmail: varchar('invited_email', { length: 255 }),
  role:         varchar('role', { length: 24 }).notNull().default('participant'),
  /** 'active' (has access now) | 'pending' (email invite, converts on access). */
  status:       varchar('status', { length: 16 }).notNull().default('active'),
  invitedBy:    varchar('invited_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_chat_members_user').on(t.chatId, t.userId),
  index('idx_chat_members_user').on(t.tenantId, t.userId),
]);


export const devTeamMembers = pgTable('dev_team_members', {
  id:            serial('id').primaryKey(),
  teamId:        integer('team_id').notNull().references(() => devTeams.id, { onDelete: 'cascade' }),
  contributorId: integer('contributor_id').notNull().references(() => contributors.id, { onDelete: 'cascade' }),
  /** 'manager' | 'member' | 'lead' */
  memberRole:    varchar('member_role', { length: 50 }).notNull().default('member'),
  joinedAt:      timestamp('joined_at').notNull().defaultNow(),
}, (t) => [
  unique('uq_team_contributor').on(t.teamId, t.contributorId),
]);


/**
 * meeting_transcript_segments (0330) — the running transcript of a live meeting.
 * One row per spoken line: a human line captured client-side (browser
 * SpeechRecognition) or an AGENT line produced by an LLM turn. Ordered by `atMs`
 * (ms since the meeting started).
 */
export const meetingTranscriptSegments = pgTable('meeting_transcript_segments', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  meetingId:   uuid('meeting_id').notNull().references(() => meetings.id, { onDelete: 'cascade' }),
  speakerRef:  varchar('speaker_ref', { length: 64 }).notNull(),
  speakerName: varchar('speaker_name', { length: 255 }).notNull(),
  speakerKind: varchar('speaker_kind', { length: 16 }).notNull().default('human'), // human|agent
  text:        text('text').notNull(),
  atMs:        bigint('at_ms', { mode: 'number' }).notNull().default(0),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});


// ---------------------------------------------------------------------------
// Moved here from `identity.ts` (PRD 20 SS3). `poker_stories` and `poker_votes`
// were already in this module; the SESSION they both hang off was in Identity,
// which split one ceremony across two domains and made Canvas import Identity to
// reach its own aggregate root.
// ---------------------------------------------------------------------------

export const pokerSessions = pgTable('poker_sessions', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenantId:       integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:      uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  name:           varchar('name', { length: 255 }).notNull(),
  votingSystem:   varchar('voting_system', { length: 20 }).notNull().default('fibonacci'),
  status:         varchar('status', { length: 20 }).notNull().default('active'),
  facilitatorId:  varchar('facilitator_id', { length: 64 }),
  createdAt:      timestamp('created_at').notNull().defaultNow(),
  updatedAt:      timestamp('updated_at').notNull().defaultNow(),
});
