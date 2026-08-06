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
import {
  boolean,
  index,
  integer,
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
import { freelancerEngagements, teams } from './collaboration';
import { chatSessions, segments, tenants, users } from './identity';
import { marketplacePersonas } from './llm';
import { agentHosts, jobPostings, jobProposals } from './runtime';
import { projects, tasks } from './work';


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
});


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
  jobId:                varchar('job_id', { length: 36 }).references(() => jobPostings.id, { onDelete: 'set null' }),
  proposalId:           varchar('proposal_id', { length: 36 }).references(() => jobProposals.id, { onDelete: 'set null' }),
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
