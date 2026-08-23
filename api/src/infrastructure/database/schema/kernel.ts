/**
 * Schema — the kernel (PRD 20 §2).
 *
 * Twenty-five primitives owned by no domain. Every domain uses them; **no domain
 * may fork one.** Across the three schemas being consolidated they absorb 564
 * source tables: 70 event/log/history tables become rows in `activity_log`, 59
 * balance tables become rows in `ledger_entries` with a denomination column, 58
 * per-vendor connection tables become manifest rows in `connections`, 43
 * membership tables, 33 annotation tables, and so on.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE (PRD 20 §0): a feature may add domain
 * tables; it may not add another instance of an existing shape. Needing comments
 * does not earn a comments table, it earns a row kind. `check-shape-lint.mjs`
 * is that rule as a test.
 *
 * WHY `objects` IS THE ONE NEW TABLE IN A DOCUMENT ABOUT DELETING THEM. Every
 * collapse here replaces a real foreign key (`board_id → boards.id`) with a
 * reference to something whose type is not known at DDL time. A naked
 * `(kind, id)` pair destroys declarative referential integrity — a generic table
 * can orphan rows the per-entity table could not, and nothing in the database
 * says so. `objects` is the registry every addressable entity registers in, so
 * the polymorphic reference is a REAL `uuid` foreign key with a real
 * `ON DELETE CASCADE`. Without it the collapse is strictly worse than the sprawl
 * it replaces; with it the design is more relationally sound than what it
 * replaces. `check-polymorphic-fk.mjs` fails the build if a `(kind, id)` pair
 * appears without one.
 *
 * NO SIBLING IMPORTS, DELIBERATELY. This module references no other schema
 * module — not even `identity` for `tenants.id`. That is interface segregation
 * from PRD 20 §6.2 taken literally: the kernel is what fifteen domains depend
 * on, so it must depend on none of them. `tenant_id` is a plain `integer`
 * column here and the foreign key is declared in the migration, which is where
 * the constraint actually lives anyway. It is also what keeps
 * `check-domain-boundary.mjs` at zero edges out of the kernel.
 *
 * Normal form (PRD 20 §2.2): BCNF, except where a discriminator is the entire
 * point. Subtype payload goes in a typed `attrs` JSONB — never null-padded onto
 * the union, because a base query returning rows full of meaningless nulls is a
 * Liskov violation wearing a schema.
 *
 * See migration 0418.
 */


import {
  bigint,
  bigserial,
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
/**
 * Schema — the kernel (PRD 20 §2).
 *
 * Twenty-five primitives owned by no domain. Every domain uses them; **no domain
 * may fork one.** Across the three schemas being consolidated they absorb 564
 * source tables: 70 event/log/history tables become rows in `activity_log`, 59
 * balance tables become rows in `ledger_entries` with a denomination column, 58
 * per-vendor connection tables become manifest rows in `connections`, 43
 * membership tables, 33 annotation tables, and so on.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE (PRD 20 §0): a feature may add domain
 * tables; it may not add another instance of an existing shape. Needing comments
 * does not earn a comments table, it earns a row kind. `check-shape-lint.mjs`
 * is that rule as a test.
 *
 * WHY `objects` IS THE ONE NEW TABLE IN A DOCUMENT ABOUT DELETING THEM. Every
 * collapse here replaces a real foreign key (`board_id → boards.id`) with a
 * reference to something whose type is not known at DDL time. A naked
 * `(kind, id)` pair destroys declarative referential integrity — a generic table
 * can orphan rows the per-entity table could not, and nothing in the database
 * says so. `objects` is the registry every addressable entity registers in, so
 * the polymorphic reference is a REAL `uuid` foreign key with a real
 * `ON DELETE CASCADE`. Without it the collapse is strictly worse than the sprawl
 * it replaces; with it the design is more relationally sound than what it
 * replaces. `check-polymorphic-fk.mjs` fails the build if a `(kind, id)` pair
 * appears without one.
 *
 * NO SIBLING IMPORTS, DELIBERATELY. This module references no other schema
 * module — not even `identity` for `tenants.id`. That is interface segregation
 * from PRD 20 §6.2 taken literally: the kernel is what fifteen domains depend
 * on, so it must depend on none of them. `tenant_id` is a plain `integer`
 * column here and the foreign key is declared in the migration, which is where
 * the constraint actually lives anyway. It is also what keeps
 * `check-domain-boundary.mjs` at zero edges out of the kernel.
 *
 * Normal form (PRD 20 §2.2): BCNF, except where a discriminator is the entire
 * point. Subtype payload goes in a typed `attrs` JSONB — never null-padded onto
 * the union, because a base query returning rows full of meaningless nulls is a
 * Liskov violation wearing a schema.
 *
 * See migration 0418.
 */


// ---------------------------------------------------------------------------
// 1 — The registry
// ---------------------------------------------------------------------------

/**
 * Every addressable entity in the platform, registered once.
 *
 * This is the narrowest possible interface: identity and kind, nothing else, so
 * `annotations`, `memberships`, `share_links`, `relations` and `revisions`
 * depend on almost nothing (PRD 20 §6.2, interface segregation).
 *
 * `refId` is the native primary key of the underlying row rendered as text —
 * the platform's ids are a mix of `serial`, `uuid` and `varchar(36)`, and the
 * registry has to address all of them. `(tenantId, kind, refId)` is unique, so
 * registering is idempotent and the lookup from a domain row to its object id is
 * a single index hit.
 *
 * `domain` names the seat on the roster that owns it. It is denormalised
 * deliberately: "what did I touch" and "what does the CFO own" are the two reads
 * this table exists to serve, and neither should need a join to answer.
 */
export const objects = pgTable('objects', {
  id:         uuid('id').primaryKey().defaultRandom(),
  /** Nullable ONLY for platform-global entities (a public catalogue listing, a
   *  marketing page). Tenant-scoped reads filter on it, so a global row is
   *  simply invisible to any one tenant. */
  tenantId:   integer('tenant_id'),
  /** 'task' | 'project' | 'artifact' | 'thread' | 'deal' | 'candidate' | … —
   *  open by design. Adding a kind adds a value, not a table (PRD 20 §6.2). */
  kind:       varchar('kind', { length: 64 }).notNull(),
  /** The underlying row's primary key, as text. */
  refId:      varchar('ref_id', { length: 64 }).notNull(),
  /** One of the fifteen roster domains. */
  domain:     varchar('domain', { length: 32 }).notNull().default('platform'),
  title:      varchar('title', { length: 300 }),
  /** Containment, for breadcrumbs and "open in canvas" — a task's project, an
   *  artifact's session. Self-referencing, so the whole trail is one recursive CTE. */
  parentId:   uuid('parent_id'),
  archivedAt: timestamp('archived_at'),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_objects_ref').on(t.tenantId, t.kind, t.refId),
  index('idx_objects_tenant_kind').on(t.tenantId, t.kind),
  index('idx_objects_tenant_touched').on(t.tenantId, t.updatedAt),
  index('idx_objects_parent').on(t.parentId),
  index('idx_objects_domain').on(t.tenantId, t.domain, t.updatedAt),
]);

// ---------------------------------------------------------------------------
// 2 — Event, ledger, connection
// ---------------------------------------------------------------------------

/**
 * The single audit store. Absorbs 70 per-subsystem event / log / history /
 * audit streams.
 *
 * Migration 0295 already made this call in-repo — it dropped `audit_events` and
 * made this the one audit store — which is why this table is MOVED here rather
 * than created: it is the primitive the other 24 are modelled on.
 *
 * `objectId` is the registry reference the `(targetType, targetId)` pair could
 * never enforce. Both are kept: the pair stays for rows written before the
 * target was registered, the FK is what new writers use.
 */
export const activityLog = pgTable('activity_log', {
  id:           bigserial('id', { mode: 'number' }).primaryKey(),
  /** Stable producer key for retried projections (for example an execution
   * lifecycle outbox event). Null for legacy/direct activity emitters. */
  eventKey:     varchar('event_key', { length: 160 }),
  /** Nullable ONLY for platform-global events (pre-tenant login/registration),
   *  absorbed from the retired audit_events table (mig 0295). Tenant-scoped reads
   *  filter on tenantId, so a global row is simply invisible to any one tenant. */
  tenantId:     integer('tenant_id'),
  segmentId:    uuid('segment_id'),
  projectId:    integer('project_id'),
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
  /** The registry reference. What makes `/api/objects/:id/activity` one endpoint
   *  instead of one per subsystem (PRD 20 §6.3). */
  objectId:     uuid('object_id').references(() => objects.id, { onDelete: 'cascade' }),
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
  index('idx_activity_log_object').on(t.objectId, t.occurredAt),
  // The anonymous visitor journey (1111). Partial, because it serves ONE
  // question — "every visitor event in the last N days", the flow-graph scan —
  // that the tenant-leading indexes above cannot: those rows carry a null tenant,
  // so a window scan across them would read every platform-global row instead.
  index('idx_activity_log_visitor_time').on(t.occurredAt).where(sql`${t.actorType} = 'visitor'`),
]);

/**
 * One money-shaped movement. Absorbs 59 tables: points, tokens, AI credits,
 * enrichment credits, campaign dollars, phone balance, partner and seller
 * balances, payouts, commissions.
 *
 * **Denomination is a column.** That single decision is what stops the 60th
 * balance table: a new currency, credit type or unit is a value, not DDL.
 *
 * Clean BCNF event table — an append-only ledger has no update anomaly to
 * normalise away. `balanceAfter` is a materialised running total, not a
 * derived-value smell: reconstructing a balance by summing an unbounded history
 * on every read is the performance anti-pattern this platform explicitly rejects.
 */
export const ledgerEntries = pgTable('ledger_entries', {
  id:            bigserial('id', { mode: 'number' }).primaryKey(),
  tenantId:      integer('tenant_id').notNull(),
  /** What the movement is ABOUT — a campaign, a run, an order. Nullable: a
   *  monthly credit grant is about nothing but the account. */
  objectId:      uuid('object_id').references(() => objects.id, { onDelete: 'set null' }),
  /** Who holds the balance: 'tenant' | 'user' | 'partner' | 'seller' | 'agent'. */
  accountKind:   varchar('account_kind', { length: 24 }).notNull(),
  accountRef:    varchar('account_ref', { length: 64 }).notNull(),
  /** 'usd_cents' | 'points' | 'ai_credits' | 'enrichment_credits' | 'tokens' |
   *  'minutes' | … — the column that replaces 59 tables. */
  denomination:  varchar('denomination', { length: 32 }).notNull(),
  /** Signed. A spend is negative; there is no separate debit table. */
  amount:        numeric('amount', { precision: 20, scale: 6 }).notNull(),
  balanceAfter:  numeric('balance_after', { precision: 20, scale: 6 }),
  /** 'grant' | 'spend' | 'refund' | 'payout' | 'commission' | 'adjustment' | 'hold' |
   *  'maintenance_cost' (a hosted app's agent-run cost, debited against its
   *  seller — see `application/marketplace/appMaintenanceCost.ts`). */
  entryKind:     varchar('entry_kind', { length: 24 }).notNull(),
  /** Idempotency key / external reference. Unique per denomination so a retried
   *  webhook cannot double-credit. */
  reference:     varchar('reference', { length: 160 }),
  memo:          text('memo'),
  metadata:      jsonb('metadata'),
  occurredAt:    timestamp('occurred_at').notNull().defaultNow(),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_ledger_entries_reference').on(t.tenantId, t.denomination, t.reference),
  index('idx_ledger_entries_account').on(t.tenantId, t.accountKind, t.accountRef, t.denomination, t.occurredAt),
  index('idx_ledger_entries_object').on(t.objectId),
]);

/**
 * One connected third party. Absorbs 58 per-vendor tables — Slack, Jira, Gmail,
 * Google Drive, Stripe, HubSpot, each of which had grown its own.
 *
 * Migration 0410 already proved the pattern in-repo: **vendors are manifest data,
 * not DDL.** Adding a vendor adds a manifest row and zero tables. This is the
 * open/closed principle with a migration number attached (PRD 20 §6.2).
 *
 * `capability` is separate from `vendor` because consent is per-scope: a Drive
 * grant cannot read mail and a mail grant cannot read files, so a tenant that
 * granted one must not implicitly have granted the other. Separate rows keep the
 * consent auditable and let one be revoked without touching the others — the
 * reasoning `drive_connections` (0415) and `mailbox_connections` (0414) each
 * wrote out separately before there was one table to write it in.
 */
export const connections = pgTable('connections', {
  id:              serial('id').primaryKey(),
  tenantId:        integer('tenant_id').notNull(),
  /** A connection belongs to a PERSON: two colleagues connecting the same
   *  workspace must not overwrite one another's grant. */
  userId:          varchar('user_id', { length: 64 }),
  /** Manifest key: 'google' | 'microsoft' | 'slack' | 'jira' | 'stripe' | … */
  vendor:          varchar('vendor', { length: 64 }).notNull(),
  /** 'mail' | 'drive' | 'calendar' | 'board' | 'crm' | 'llm' | 'payments' | 'repo'. */
  capability:      varchar('capability', { length: 32 }).notNull(),
  /** The account on the vendor side — an email, a workspace id, a shop domain.
   *  Part of the key so one user can connect a personal and a work account. */
  externalAccount: varchar('external_account', { length: 320 }).notNull().default(''),
  displayName:     varchar('display_name', { length: 255 }).notNull().default(''),
  /** 'connected' | 'expired' | 'revoked'. `revoked` is terminal until the user
   *  reconnects — it is what lets the UI say "reconnect" instead of failing every
   *  listing with an opaque 401. */
  status:          varchar('status', { length: 16 }).notNull().default('connected'),
  scope:           text('scope').notNull().default(''),
  lastError:       text('last_error'),
  lastSyncedAt:    timestamp('last_synced_at'),
  /** Bumped on every reconnect, and the version token in the listing cache key —
   *  reconnecting is the one event that must invalidate every cached child under
   *  it, and the keyspace (a folder or label id per connection) is unbounded. */
  cacheVersion:    integer('cache_version').notNull().default(1),
  config:          jsonb('config'),
  createdAt:       timestamp('created_at').notNull().defaultNow(),
  updatedAt:       timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_connections_account').on(t.tenantId, t.userId, t.vendor, t.capability, t.externalAccount),
  index('idx_connections_tenant').on(t.tenantId, t.capability, t.status),
  // An inbound xAPI request carries a Basic key and no tenant — resolving the
  // workspace IS the authentication, so that one lookup has no tenant predicate
  // to lead with. Partial to `vendor = 'lrs'` (migration 1114).
  index('idx_connections_lrs_key').on(t.externalAccount).where(sql`vendor = 'lrs'`),
]);

/**
 * Secrets, in one encrypted store. Absorbs 13 per-integration secret tables.
 *
 * Split from `connections` deliberately and this is the one place a 1:1 split
 * earns its keep: the connection row is read on every listing, the secret is
 * read only when a call is actually made. Keeping them apart means the hot read
 * never pulls ciphertext into memory, and a dump of the connection table is not
 * a breach.
 *
 * `expiresAt` is mirrored outside the sealed blob so a refresher can find stale
 * rows without decrypting every one of them — the pattern `mailbox_connections`
 * established in 0414.
 */
export const credentials = pgTable('credentials', {
  id:           serial('id').primaryKey(),
  tenantId:     integer('tenant_id').notNull(),
  connectionId: integer('connection_id').references(() => connections.id, { onDelete: 'cascade' }),
  /** 'oauth' | 'api_key' | 'basic' | 'signing' | 'webhook_secret'. */
  purpose:      varchar('purpose', { length: 32 }).notNull().default('oauth'),
  /** Sealed with the shared per-tenant AES-256-GCM credential crypto. Never a bare secret. */
  secretEnc:    text('secret_enc').notNull(),
  secretIv:     varchar('secret_iv', { length: 64 }).notNull(),
  expiresAt:    timestamp('expires_at'),
  rotatedAt:    timestamp('rotated_at'),
  lastUsedAt:   timestamp('last_used_at'),
  status:       varchar('status', { length: 16 }).notNull().default('active'),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_credentials_purpose').on(t.tenantId, t.connectionId, t.purpose),
  index('idx_credentials_expiry').on(t.status, t.expiresAt),
]);

/**
 * Staging and cursor state per importer. Absorbs 7 tables.
 *
 * One row per (connection, resource) — "where did the Jira issue sync get to"
 * is one lookup, and a stuck importer is one `status` column away from visible
 * rather than inferred from the absence of new rows.
 */
export const syncStates = pgTable('sync_states', {
  id:             serial('id').primaryKey(),
  tenantId:       integer('tenant_id').notNull(),
  connectionId:   integer('connection_id').references(() => connections.id, { onDelete: 'cascade' }),
  /** 'issues' | 'messages' | 'files' | 'contacts' | … */
  resource:       varchar('resource', { length: 96 }).notNull(),
  cursor:         text('cursor'),
  checkpoint:     jsonb('checkpoint'),
  lastRunAt:      timestamp('last_run_at'),
  lastSuccessAt:  timestamp('last_success_at'),
  lastError:      text('last_error'),
  recordsSeen:    bigint('records_seen', { mode: 'number' }).notNull().default(0),
  recordsWritten: bigint('records_written', { mode: 'number' }).notNull().default(0),
  /** 'idle' | 'running' | 'backfilling' | 'error'. */
  status:         varchar('status', { length: 16 }).notNull().default('idle'),
  createdAt:      timestamp('created_at').notNull().defaultNow(),
  updatedAt:      timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_sync_states_resource').on(t.tenantId, t.connectionId, t.resource),
]);

// ---------------------------------------------------------------------------
// 3 — Presence, annotation, access
// ---------------------------------------------------------------------------

/**
 * Who is on this thing. Absorbs 43 tables — chat members, board members, team
 * members, rotation members, cohort members, ceremony participants, meeting
 * attendees.
 *
 * PRD 20 §2.1: fifteen per-feature meeting tables and eight attendee tables exist
 * only because each feature owned its own presence. `useMediaRoom` is already
 * keyed by an arbitrary `roomKey`, so any object can BE a room without OWNING a
 * room table — which makes hoisting presence into the shell a schema decision as
 * much as a navigation one.
 */
export const memberships = pgTable('memberships', {
  id:         bigserial('id', { mode: 'number' }).primaryKey(),
  tenantId:   integer('tenant_id').notNull(),
  objectId:   uuid('object_id').notNull().references(() => objects.id, { onDelete: 'cascade' }),
  /** 'user' | 'agent' | 'team' | 'email' — an invited stranger has no user row yet. */
  memberKind: varchar('member_kind', { length: 16 }).notNull(),
  memberRef:  varchar('member_ref', { length: 320 }).notNull(),
  role:       varchar('role', { length: 32 }).notNull().default('member'),
  /** 'active' | 'invited' | 'left' | 'removed'. Never delete: who WAS on a thing
   *  is the question an audit asks. */
  state:      varchar('state', { length: 16 }).notNull().default('active'),
  joinedAt:   timestamp('joined_at'),
  lastSeenAt: timestamp('last_seen_at'),
  metadata:   jsonb('metadata'),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_memberships_member').on(t.tenantId, t.objectId, t.memberKind, t.memberRef),
  index('idx_memberships_member').on(t.tenantId, t.memberKind, t.memberRef, t.state),
  index('idx_memberships_object').on(t.objectId, t.state),
]);

/**
 * Something a person said about something. Absorbs 33 tables — comments, notes,
 * tags, likes, votes, ratings, reactions.
 *
 * All seven are the same row: an author, a target, and either a body or a value.
 * Splitting them by which screen renders them is the facet mistake from
 * PRD 20 §3.1 wearing seven different names.
 *
 * `anchor` carries the selection a comment is pinned to — a text range, a canvas
 * coordinate, a video timestamp — as typed JSON rather than as three nullable
 * column families, which is the Liskov rule from §6.2 applied to a discriminator.
 */
export const annotations = pgTable('annotations', {
  id:         bigserial('id', { mode: 'number' }).primaryKey(),
  tenantId:   integer('tenant_id').notNull(),
  objectId:   uuid('object_id').notNull().references(() => objects.id, { onDelete: 'cascade' }),
  /** Threading, so one comment component serves replies too. */
  parentId:   bigint('parent_id', { mode: 'number' }),
  /** 'comment' | 'note' | 'tag' | 'like' | 'vote' | 'rating' | 'reaction'. */
  kind:       varchar('kind', { length: 16 }).notNull().default('comment'),
  authorKind: varchar('author_kind', { length: 16 }).notNull().default('user'),
  authorRef:  varchar('author_ref', { length: 64 }),
  authorName: varchar('author_name', { length: 255 }),
  body:       text('body'),
  /** Ratings and votes. A `like` is `value = 1`; it does not need its own table. */
  value:      numeric('value', { precision: 10, scale: 2 }),
  label:      varchar('label', { length: 120 }),
  anchor:     jsonb('anchor'),
  /** ── Moderation (migration 1106) ─────────────────────────────────────────
   *  'published' | 'pending' | 'rejected'. Defaults to published, so every
   *  annotation this platform already writes is unaffected; a writer that
   *  publishes user-authored claims about a NAMED third party (an employer
   *  review) opts into 'pending' and the row stays invisible until approved.
   *
   *  Deliberately NOT `resolvedAt`, which on a comment means "this thread is
   *  settled" — a different fact that can be true of a published row and false
   *  of a pending one, so overloading it would make visibility unanswerable. */
  status:     varchar('status', { length: 16 }).notNull().default('published'),
  resolvedAt: timestamp('resolved_at'),
  deletedAt:  timestamp('deleted_at'),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_annotations_object').on(t.objectId, t.kind, t.createdAt),
  index('idx_annotations_author').on(t.tenantId, t.authorRef),
  index('idx_annotations_parent').on(t.parentId),
]);

/**
 * A token that grants access to one object. Absorbs 24 tables.
 *
 * **One expiry policy, one revocation path.** There are three independent
 * API-key revocation paths in this repo alone today; each is a place a revoked
 * token can keep working because somebody fixed only the other two.
 *
 * The token itself is never stored — only its SHA-256 hash, the same rule
 * `email_verification_codes` already applies to one-time codes.
 */
export const shareLinks = pgTable('share_links', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenantId:     integer('tenant_id').notNull(),
  objectId:     uuid('object_id').notNull().references(() => objects.id, { onDelete: 'cascade' }),
  tokenHash:    varchar('token_hash', { length: 64 }).notNull().unique(),
  /** 'view' | 'comment' | 'edit'. */
  scope:        varchar('scope', { length: 16 }).notNull().default('view'),
  passwordHash: varchar('password_hash', { length: 128 }),
  expiresAt:    timestamp('expires_at'),
  maxUses:      integer('max_uses'),
  useCount:     integer('use_count').notNull().default(0),
  lastUsedAt:   timestamp('last_used_at'),
  revokedAt:    timestamp('revoked_at'),
  createdBy:    varchar('created_by', { length: 64 }),
  /** What the MINTER calls this link — "the quote I sent Acme". Never shown to the
   *  holder; it names the row in the list of links a person has to be able to revoke. */
  label:        varchar('label', { length: 160 }),
  /** Presentation settings the receiving page reads: seller branding, whether control
   *  may be requested, which objects are on show. Read-only, never joined or filtered
   *  on — which is the test for when jsonb is the right shape rather than a table. */
  metadata:     jsonb('metadata'),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_share_links_object').on(t.objectId),
  index('idx_share_links_tenant').on(t.tenantId, t.revokedAt),
]);

/**
 * Invite somebody to something. Absorbs 9 tables.
 *
 * Distinct from `share_links` on purpose: a share link grants access to a URL
 * holder, an invitation names a person and expects them to become a member.
 * They converge — accepting an invitation writes a `memberships` row — but the
 * pending state is a different noun with a different lifecycle.
 */
export const invitations = pgTable('invitations', {
  id:         uuid('id').primaryKey().defaultRandom(),
  tenantId:   integer('tenant_id').notNull(),
  objectId:   uuid('object_id').references(() => objects.id, { onDelete: 'cascade' }),
  /** 'tenant' | 'project' | 'team' | 'board' | 'ceremony' | 'engagement'. */
  kind:       varchar('kind', { length: 32 }).notNull(),
  email:      varchar('email', { length: 320 }),
  inviteeRef: varchar('invitee_ref', { length: 64 }),
  role:       varchar('role', { length: 32 }).notNull().default('member'),
  tokenHash:  varchar('token_hash', { length: 64 }).notNull().unique(),
  /** 'pending' | 'accepted' | 'declined' | 'revoked' | 'expired'. */
  state:      varchar('state', { length: 16 }).notNull().default('pending'),
  message:    text('message'),
  invitedBy:  varchar('invited_by', { length: 64 }),
  expiresAt:  timestamp('expires_at'),
  acceptedAt: timestamp('accepted_at'),
  revokedAt:  timestamp('revoked_at'),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_invitations_email').on(t.tenantId, t.email, t.state),
  index('idx_invitations_object').on(t.objectId, t.state),
]);

// ---------------------------------------------------------------------------
// 4 — Configuration and typed edges
// ---------------------------------------------------------------------------

/**
 * Per-feature settings singletons. Absorbs 31 tables.
 *
 * The boundary that keeps this from becoming a junk drawer: **typed user data
 * stays typed columns on its owner.** A user's display name is a column on
 * `users`; whether the user wants weekly digests is a setting. If a query needs
 * to filter or aggregate on it, it is not a setting.
 */
export const settings = pgTable('settings', {
  id:        serial('id').primaryKey(),
  tenantId:  integer('tenant_id').notNull(),
  /** 'tenant' | 'user' | 'project' | 'object'. */
  scope:     varchar('scope', { length: 16 }).notNull().default('tenant'),
  scopeRef:  varchar('scope_ref', { length: 64 }).notNull().default(''),
  /** The feature the singleton belongs to: 'digest' | 'board' | 'security' | … */
  feature:   varchar('feature', { length: 64 }).notNull(),
  value:     jsonb('value').notNull().default('{}'),
  updatedBy: varchar('updated_by', { length: 64 }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_settings_scope').on(t.tenantId, t.scope, t.scopeRef, t.feature),
]);

/**
 * A typed edge between two registered objects. Absorbs 17 tables — mappings,
 * dependencies, associations, overrides, ordered join rows.
 *
 * Both ends are real foreign keys into `objects`, which is the entire argument
 * for the registry: a generic edge table without it can point at a deleted row
 * forever.
 */
export const relations = pgTable('relations', {
  id:        bigserial('id', { mode: 'number' }).primaryKey(),
  tenantId:  integer('tenant_id').notNull(),
  fromId:    uuid('from_id').notNull().references(() => objects.id, { onDelete: 'cascade' }),
  toId:      uuid('to_id').notNull().references(() => objects.id, { onDelete: 'cascade' }),
  /** 'depends_on' | 'blocks' | 'maps_to' | 'overrides' | 'contains' |
   *  'derived_from' | 'duplicates'. */
  kind:      varchar('kind', { length: 48 }).notNull(),
  /** Ordered join rows (a course's modules, a path's courses) are this table with
   *  a position — not their own DDL (PRD 20 §3.3). */
  position:  integer('position').notNull().default(0),
  attrs:     jsonb('attrs'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_relations_edge').on(t.tenantId, t.fromId, t.toId, t.kind),
  index('idx_relations_from').on(t.fromId, t.kind, t.position),
  index('idx_relations_to').on(t.toId, t.kind),
]);

/**
 * A profile per role a person or company can hold. Absorbs 19 tables —
 * candidate, employee, freelancer, investor, partner, seller, recruiter,
 * customer, vendor.
 *
 * A person is not a candidate; a person HOLDS the candidate role, sometimes at
 * the same time as the employee role. Nineteen profile tables could not express
 * that without nineteen joins, which is why the same human arrived in the
 * pipeline twice.
 */
export const partyRoles = pgTable('party_roles', {
  id:        serial('id').primaryKey(),
  tenantId:  integer('tenant_id').notNull(),
  /** 'person' | 'company'. */
  partyKind: varchar('party_kind', { length: 16 }).notNull().default('person'),
  partyRef:  varchar('party_ref', { length: 64 }).notNull(),
  /** 'candidate' | 'employee' | 'freelancer' | 'investor' | 'partner' |
   *  'seller' | 'recruiter' | 'customer' | 'vendor' | 'contact'. */
  role:      varchar('role', { length: 48 }).notNull(),
  status:    varchar('status', { length: 16 }).notNull().default('active'),
  startedAt: timestamp('started_at'),
  endedAt:   timestamp('ended_at'),
  /** Role-specific payload, typed rather than null-padded across the union. */
  attrs:     jsonb('attrs'),
  /** ── Lawful basis and the retention clock (0460) ──────────────────────────
   *  Consent is a fact about a PERSON HOLDING A ROLE, not about an application: a
   *  candidate with four applications has one lawful basis, and putting it on
   *  `job_applications` would repeat it four times and let the copies disagree.
   *  This table already carries exactly one row per (tenant, kind, ref, role) with
   *  a unique index proving it, so it is where the fact belongs — and the same
   *  columns then carry the EMPLOYEE clock, which is the same two facts with the
   *  rule reversed.
   *
   *  'consent' | 'legitimate-interest' | 'contract' | 'legal-obligation'.
   *  Nullable with NO default on purpose: an unknown basis must read as unknown,
   *  and defaulting to 'consent' would assert that somebody agreed to something. */
  consentBasis:   varchar('consent_basis', { length: 32 }),
  consentAt:      timestamp('consent_at'),
  /** 'erase-by' (a rejected candidate's MAXIMUM retention) | 'retain-until' (an
   *  employment record's statutory MINIMUM). One pair of columns, both clocks. */
  retentionBasis: varchar('retention_basis', { length: 16 }),
  retentionDate:  date('retention_date'),
  /** Stamped by the erasure path so a re-import cannot resurrect somebody who
   *  exercised their right to be forgotten — the argument `data_suppression_list`
   *  already makes for marketing, applied to the role rather than the address. */
  erasedAt:       timestamp('erased_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_party_roles_role').on(t.tenantId, t.partyKind, t.partyRef, t.role),
  index('idx_party_roles_role').on(t.tenantId, t.role, t.status),
  index('idx_party_roles_retention').on(t.tenantId, t.retentionDate),
]);

// ---------------------------------------------------------------------------
// 4b — Collection and signature: getting an answer, and an agreement, from a
//      human who is NOT in this workspace (migration 0469)
// ---------------------------------------------------------------------------
//
// WHY THESE ARE KERNEL PRIMITIVES AND NOT PEOPLE TABLES. The canvas contract
// declares both in `people.ts` because HR is the domain that exposed their
// absence — applications, acknowledgements, 360s, exit interviews, pulses and
// accommodation requests are all one shape — and it says in as many words that
// every field it declares is domain NEUTRAL. Support intake, a research
// screener, a customer satisfaction round and an investor NDA are the same two
// objects. Handing the domain that asked first a private copy is how a product
// ends up with three response stores and two answers to "has this person agreed
// yet", which is precisely what §0 forbids. So they live here, owned by no
// domain, and `pulse_surveys` becomes a binding rather than a competitor.
//
// WHY THE PUBLIC SURFACE IS TOKEN-ADDRESSED. The responder and the signer are
// outside the workspace by construction: they have no session, and the row they
// reach reports the tenant rather than the caller asserting one. That is the
// `share_token` cross-tenant reason the scope helper already declares, and it is
// why `slug` here is globally unique rather than unique per tenant — a public
// URL has no tenant to disambiguate it with.

/**
 * One named person a form was sent to — and the ONLY new table on the collection
 * side.
 *
 * ── WHY THERE IS NO `published_forms` AND NO `form_responses` ────────────────
 * Because `question_sets` and `responses` further down this file already ARE the
 * form and the response store: twelve survey tables and thirteen answer tables
 * were consolidated into them. What did NOT exist was the PUBLICATION — a set
 * had no public address, no way to say whether it records who answered, and no
 * enforceable audience, so it could be authored and never sent to anybody
 * outside the workspace. Those are COLUMNS on `question_sets` (`slug`,
 * `anonymous`, `audience_kind`, `confirmation_message`, `object_id`), not a
 * second store. Building a parallel pair here would have been the third response
 * store the canvas contract's own note warns about in as many words.
 *
 * What is genuinely missing is a per-recipient CREDENTIAL. Without one,
 * `audience_kind = 'namedRecipients'` is decoration: a form that says "named
 * recipients only" and whose route lets anyone holding the slug answer is a lie
 * told by a column — the same defect the register logs against the data room's
 * unenforced `nda_required`.
 *
 * The token IS the credential, so only its hash is stored, and the entity
 * layer's redaction removes the column from every generic projection by name.
 */
export const formRecipients = pgTable('form_recipients', {
  id:            serial('id').primaryKey(),
  tenantId:      integer('tenant_id').notNull(),
  questionSetId: uuid('question_set_id').notNull().references(() => questionSets.id, { onDelete: 'cascade' }),
  email:         varchar('email', { length: 320 }).notNull(),
  name:          varchar('name', { length: 200 }),
  tokenHash:     varchar('token_hash', { length: 64 }).notNull(),
  invitedAt:     timestamp('invited_at').notNull().defaultNow(),
  respondedAt:   timestamp('responded_at'),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_form_recipients_email').on(t.questionSetId, t.email),
  uniqueIndex('uq_form_recipients_token').on(t.tokenHash),
]);

/**
 * A request for one or more parties to sign or acknowledge something.
 *
 * `intent` keeps `signed` distinct from `acknowledged`, which is the distinction
 * the contract argues for and the one an auditor will later need: acknowledging a
 * handbook and signing an offer are different acts with different evidentiary
 * weight, and a product that records both as "signed" cannot say which happened.
 * Same table, same trail, different word — a kind is a column value.
 */
export const signatureRequests = pgTable('signature_requests', {
  id:            serial('id').primaryKey(),
  tenantId:      integer('tenant_id').notNull(),
  objectId:      uuid('object_id').references(() => objects.id, { onDelete: 'set null' }),
  subject:       varchar('subject', { length: 200 }).notNull(),
  /** 'sign' | 'acknowledge'. Drives the wording the party sees; the engine treats
   *  both identically, which is the point. */
  intent:        varchar('intent', { length: 16 }).notNull().default('sign'),
  /** What is being agreed to, rendered to the signer verbatim. Held here rather
   *  than resolved from a document at signing time, deliberately: the evidence an
   *  auditor needs is what THIS person saw on THAT day, and a live reference to a
   *  document somebody edited afterwards is not that. */
  documentTitle: varchar('document_title', { length: 200 }).notNull(),
  /** Required UNLESS `documentArtifactId` is set — a request binds to rendered
   *  text OR to a binary file, never neither (enforced by a CHECK constraint). */
  documentBody:  text('document_body'),
  /** A binary file (this row's OWN table, `artifacts`) the signer reviews and
   *  signs instead of — or alongside — rendered text, e.g. an uploaded PDF/DOCX
   *  formation certificate or executed IP assignment. */
  documentArtifactId: uuid('document_artifact_id').references(() => artifacts.id, { onDelete: 'set null' }),
  /** SHA-256 of the artifact's plaintext bytes, frozen at send time — required
   *  together with `documentArtifactId`, for the same reason `documentBody` is
   *  copied rather than referenced: a re-upload must not retroactively change
   *  what was signed. */
  documentChecksum: varchar('document_checksum', { length: 64 }),
  /** The artifact or canvas object the body was rendered from, for provenance. */
  documentRef:   varchar('document_ref', { length: 64 }),
  /** 'draft' | 'sent' | 'completed' | 'declined' | 'cancelled' | 'expired'. */
  status:        varchar('status', { length: 16 }).notNull().default('draft'),
  sentAt:        timestamp('sent_at'),
  completedAt:   timestamp('completed_at'),
  expiresAt:     timestamp('expires_at'),
  /** Days of silence before the sweep nudges. 0 disables reminders entirely — a
   *  standing invitation that must not chase, e.g. an optional consent. */
  remindAfterDays: integer('remind_after_days').notNull().default(3),
  lastRemindedAt: timestamp('last_reminded_at'),
  createdBy:     varchar('created_by', { length: 64 }),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_signature_requests_tenant').on(t.tenantId, t.status, t.updatedAt),
  /** The reminder sweep's own access path: everything sent and not yet chased. */
  index('idx_signature_requests_remind').on(t.status, t.lastRemindedAt),
]);

/**
 * One party on one request, and the audit record of what they did.
 *
 * `evidence` holds what was true at the moment of the act — the instant, the
 * client's user agent, a hash of the address it came from — and never the address
 * itself. A signature record has to be defensible without becoming a second copy
 * of somebody's browsing history.
 */
export const signatureParties = pgTable('signature_parties', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  requestId:   integer('request_id').notNull().references(() => signatureRequests.id, { onDelete: 'cascade' }),
  /** `party_roles.party_ref` when this signer is a known counterparty. */
  partyRef:    varchar('party_ref', { length: 64 }),
  name:        varchar('name', { length: 200 }).notNull(),
  email:       varchar('email', { length: 320 }).notNull(),
  /** Signing ORDER. Countersignature is a real requirement — a customer signs,
   *  then we do — and it is expressed as a position rather than a second table. */
  position:    integer('position').notNull().default(0),
  /** 'pending' | 'viewed' | 'signed' | 'acknowledged' | 'declined'. */
  status:      varchar('status', { length: 16 }).notNull().default('pending'),
  tokenHash:   varchar('token_hash', { length: 64 }).notNull(),
  viewedAt:    timestamp('viewed_at'),
  decidedAt:   timestamp('decided_at'),
  /** What the signer TYPED as their name. The act itself — kept distinct from
   *  `name`, which is what we addressed them as. */
  signedName:  varchar('signed_name', { length: 200 }),
  declineReason: text('decline_reason'),
  evidence:    jsonb('evidence'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_signature_parties_token').on(t.tokenHash),
  index('idx_signature_parties_request').on(t.requestId, t.position),
]);

// ---------------------------------------------------------------------------
// 5 — Work, execution, measurement
// ---------------------------------------------------------------------------

/**
 * A unit of work. Absorbs 25 tables — task, epic, story, subtask, objective,
 * key result, initiative, milestone, and (PRD 20 §3.3) the scored `feature`.
 *
 * **This is the table that gives the domain layer something to be.** The domain
 * layer holds 40 files against the application layer's 643 because a concept
 * spread over 25 tables has nothing coherent to put invariants on. One
 * `work_item` with a `kind` has real ones — a key result cannot be its own
 * parent, a milestone has no assignee, an objective's progress is a rollup of
 * its key results — that 25 tables could only express 25 times, or not at all.
 *
 * `targetValue` / `currentValue` are what make a key result a work item rather
 * than a separate noun: an objective measures, a task completes, and both are
 * "a thing with a parent, an owner and a state".
 */
export const workItems = pgTable('work_items', {
  id:           bigserial('id', { mode: 'number' }).primaryKey(),
  tenantId:     integer('tenant_id').notNull(),
  objectId:     uuid('object_id').references(() => objects.id, { onDelete: 'cascade' }),
  /** 'task' | 'epic' | 'story' | 'subtask' | 'objective' | 'key_result' |
   *  'initiative' | 'milestone' | 'feature'. */
  kind:         varchar('kind', { length: 24 }).notNull().default('task'),
  parentId:     bigint('parent_id', { mode: 'number' }),
  projectRef:   varchar('project_ref', { length: 64 }),
  title:        varchar('title', { length: 300 }).notNull(),
  body:         text('body'),
  /** Free-form: a board's swimlanes define its columns, so status is whatever
   *  lane key the card sits in (the rule migration 0076 already established). */
  status:       varchar('status', { length: 48 }).notNull().default('todo'),
  priority:     varchar('priority', { length: 16 }).notNull().default('medium'),
  assigneeKind: varchar('assignee_kind', { length: 16 }),
  assigneeRef:  varchar('assignee_ref', { length: 64 }),
  startAt:      timestamp('start_at'),
  dueAt:        timestamp('due_at'),
  completedAt:  timestamp('completed_at'),
  progress:     numeric('progress', { precision: 5, scale: 2 }).notNull().default('0'),
  targetValue:  numeric('target_value', { precision: 20, scale: 4 }),
  currentValue: numeric('current_value', { precision: 20, scale: 4 }),
  /** Kind-specific payload — RICE scores on a `feature`, a confidence band on a
   *  `key_result`. Never null-padded onto the union (PRD 20 §2.2). */
  attrs:        jsonb('attrs'),
  position:     integer('position').notNull().default(0),
  createdBy:    varchar('created_by', { length: 64 }),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_work_items_board').on(t.tenantId, t.projectRef, t.kind, t.status, t.position),
  index('idx_work_items_parent').on(t.parentId),
  index('idx_work_items_assignee').on(t.tenantId, t.assigneeKind, t.assigneeRef, t.status),
  index('idx_work_items_object').on(t.objectId),
]);

/**
 * A thing that ran. Absorbs 30 tables — jobs, executions, attempts, steps.
 *
 * Self-referencing through `parentRunId`, which is what collapses the
 * run/attempt/step trio: a step is a run with a parent, an attempt is a run with
 * a parent and an `attempt` number. Three tables were three names for one tree.
 */
export const runs = pgTable('runs', {
  id:          bigserial('id', { mode: 'number' }).primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  objectId:    uuid('object_id').references(() => objects.id, { onDelete: 'set null' }),
  /** 'execution' | 'job' | 'step' | 'attempt' | 'sync' | 'rollup' | 'render'. */
  kind:        varchar('kind', { length: 48 }).notNull(),
  parentRunId: bigint('parent_run_id', { mode: 'number' }),
  /** 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'blocked'. */
  status:      varchar('status', { length: 16 }).notNull().default('queued'),
  attempt:     integer('attempt').notNull().default(1),
  queuedAt:    timestamp('queued_at').notNull().defaultNow(),
  startedAt:   timestamp('started_at'),
  finishedAt:  timestamp('finished_at'),
  durationMs:  integer('duration_ms'),
  error:       text('error'),
  input:       jsonb('input'),
  output:      jsonb('output'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_runs_tenant_status').on(t.tenantId, t.kind, t.status, t.queuedAt),
  index('idx_runs_parent').on(t.parentRunId),
  index('idx_runs_object').on(t.objectId),
]);

/**
 * A derived number that was given its own DDL. Absorbs 28 tables.
 *
 * **Stricter than what it replaces, not looser** (PRD 20 §2.2): a stored derived
 * value depends on other rows rather than on its own key, so moving it out of
 * the entity table and into an explicitly-derived one is a normalisation
 * improvement, not a compromise.
 *
 * One shape means one chart primitive, which is what makes "insights everywhere"
 * affordable instead of a per-feature chart build (PRD 20 §7.1).
 */
export const metricFacts = pgTable('metric_facts', {
  id:           bigserial('id', { mode: 'number' }).primaryKey(),
  tenantId:     integer('tenant_id').notNull(),
  objectId:     uuid('object_id').references(() => objects.id, { onDelete: 'cascade' }),
  /** 'campaign.clicks' | 'delivery.cycle_time_hours' | 'finance.arr' | … */
  metric:       varchar('metric', { length: 96 }).notNull(),
  /** 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'total'. */
  bucket:       varchar('bucket', { length: 16 }).notNull().default('day'),
  bucketAt:     timestamp('bucket_at').notNull(),
  /** The slice, as data: `{"channel":"email","region":"emea"}`. */
  dimension:    jsonb('dimension'),
  /** Canonical serialisation of `dimension`, so the uniqueness of a fact is
   *  enforceable by an index rather than by whoever writes the rollup. */
  dimensionKey: varchar('dimension_key', { length: 200 }).notNull().default(''),
  value:        numeric('value', { precision: 24, scale: 6 }).notNull(),
  unit:         varchar('unit', { length: 24 }),
  computedAt:   timestamp('computed_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_metric_facts_point').on(t.tenantId, t.metric, t.bucket, t.bucketAt, t.dimensionKey),
  index('idx_metric_facts_series').on(t.tenantId, t.metric, t.bucketAt),
  index('idx_metric_facts_object').on(t.objectId, t.metric, t.bucketAt),
]);

// ---------------------------------------------------------------------------
// 6 — Made things
// ---------------------------------------------------------------------------

/**
 * A made object with a kind. Absorbs 30 per-media-type tables.
 *
 * `CREATION_OBJECT_KINDS` already proved this in-repo — **74 heterogeneous
 * artifact kinds in one table**: document, video, game, cad, resume, slides,
 * terminal. This is that table given a name and a home.
 *
 * One viewer with kind-specific renderers, instead of ~30 per-media pages
 * (PRD 20 §7.1).
 */
export const artifacts = pgTable('artifacts', {
  id:         uuid('id').primaryKey().defaultRandom(),
  tenantId:   integer('tenant_id').notNull(),
  objectId:   uuid('object_id').references(() => objects.id, { onDelete: 'cascade' }),
  /** A value of CREATION_OBJECT_KINDS. */
  kind:       varchar('kind', { length: 48 }).notNull(),
  title:      varchar('title', { length: 300 }).notNull().default(''),
  mime:       varchar('mime', { length: 128 }),
  /** R2 key. Access goes through `workspaceStore.ts`, never directly. */
  storageKey: text('storage_key'),
  byteSize:   bigint('byte_size', { mode: 'number' }),
  checksum:   varchar('checksum', { length: 128 }),
  width:      integer('width'),
  height:     integer('height'),
  durationMs: integer('duration_ms'),
  language:   varchar('language', { length: 16 }),
  status:     varchar('status', { length: 16 }).notNull().default('ready'),
  /** THE RENDITION EDGE. A recording, caption, transcript, thumbnail, export or
   *  preview is an artifact DERIVED from another artifact — same columns, same
   *  storage, same viewer, one extra parent. PRD 20 §2 lists `rendition` as a
   *  primitive absorbing 4 tables; writing it out produced a table whose weighted
   *  column overlap with this one is 0.60, and §2.2's own 0.55 rule says collapse
   *  when the shared column set is the majority of both. So it collapsed —
   *  `check-signature-duplication.mjs` caught it on the first run, which is
   *  precisely the job the guard was landed to do, and the kernel is 25 tables
   *  rather than 26 because of it.
   *
   *  A rendition is regenerable and has no independent authorship, so the cascade
   *  runs the right way round: deleting the source deletes them, deleting one
   *  costs nothing. */
  derivedFromId: uuid('derived_from_id'),
  /** Kind-specific payload — a document's blocks, a game's manifest, a
   *  transcript's cue timings. */
  attrs:      jsonb('attrs'),
  createdBy:  varchar('created_by', { length: 64 }),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_artifacts_object').on(t.objectId),
  index('idx_artifacts_tenant_kind').on(t.tenantId, t.kind, t.updatedAt),
  index('idx_artifacts_derived').on(t.derivedFromId, t.kind),
]);

/**
 * The artifact kinds that are RENDITIONS — derived from a source artifact rather
 * than authored. One list, so "show me the transcript" and "do not offer to edit
 * this" are the same question asked once (PRD 20 §7.1: one viewer with
 * kind-specific renderers).
 */
export const RENDITION_KINDS = [
  'recording', 'caption', 'transcript', 'thumbnail', 'export', 'preview',
] as const;
export type RenditionKind = (typeof RENDITION_KINDS)[number];

/**
 * Version history per versionable thing. Absorbs 18 tables.
 *
 * `patch` for the common case (a diff against the previous version) and
 * `snapshotKey` for the periodic full copy, so replaying a document's history is
 * bounded rather than a fold over every edit ever made.
 */
export const revisions = pgTable('revisions', {
  id:          bigserial('id', { mode: 'number' }).primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  objectId:    uuid('object_id').notNull().references(() => objects.id, { onDelete: 'cascade' }),
  version:     integer('version').notNull(),
  label:       varchar('label', { length: 120 }),
  authorRef:   varchar('author_ref', { length: 64 }),
  summary:     text('summary'),
  patch:       jsonb('patch'),
  snapshotKey: text('snapshot_key'),
  byteSize:    bigint('byte_size', { mode: 'number' }),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_revisions_version').on(t.tenantId, t.objectId, t.version),
  index('idx_revisions_object').on(t.objectId, t.version),
]);

/**
 * A point-in-time copy, addressed by object. Absorbs 6 tables.
 *
 * Distinct from `revisions`: a revision is a step in an edit history, a snapshot
 * is taken FOR a reason — before a destructive migration, at a compliance
 * boundary, when a plan was approved. `reason` is what a restore dialogue reads.
 */
export const snapshots = pgTable('snapshots', {
  id:         uuid('id').primaryKey().defaultRandom(),
  tenantId:   integer('tenant_id').notNull(),
  objectId:   uuid('object_id').notNull().references(() => objects.id, { onDelete: 'cascade' }),
  /** 'pre_migration' | 'approval' | 'compliance' | 'manual' | 'scheduled'. */
  reason:     varchar('reason', { length: 48 }).notNull(),
  takenAt:    timestamp('taken_at').notNull().defaultNow(),
  storageKey: text('storage_key'),
  payload:    jsonb('payload'),
  byteSize:   bigint('byte_size', { mode: 'number' }),
  createdBy:  varchar('created_by', { length: 64 }),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('idx_snapshots_object').on(t.objectId, t.takenAt),
]);

/**
 * Templates, presets, packs, listings, offerings. Absorbs 22 tables.
 *
 * `isTemplate` is the template/instance flattening from PRD 20 §3.1: an
 * `X_template` sitting beside an `X` with the same columns is one table and a
 * boolean. Keeping them apart is how the two drift until the template stops
 * producing a valid instance.
 *
 * `tenantId` is nullable here and only here among the kernel's tenant columns:
 * the public marketplace catalogue is genuinely platform-owned, and a listing
 * with no tenant is the row a logged-out visitor reads.
 */
export const catalogItems = pgTable('catalog_items', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenantId:     integer('tenant_id'),
  /** 'template' | 'preset' | 'pack' | 'listing' | 'offering' | 'skill' | 'policy_pack'. */
  kind:         varchar('kind', { length: 32 }).notNull(),
  slug:         varchar('slug', { length: 160 }).notNull(),
  name:         varchar('name', { length: 200 }).notNull(),
  summary:      text('summary'),
  body:         jsonb('body'),
  category:     varchar('category', { length: 64 }),
  tags:         jsonb('tags'),
  version:      varchar('version', { length: 24 }).notNull().default('1.0.0'),
  /** 'private' | 'tenant' | 'public'. */
  visibility:   varchar('visibility', { length: 16 }).notNull().default('private'),
  priceCents:   integer('price_cents'),
  currency:     varchar('currency', { length: 8 }),
  publisherRef: varchar('publisher_ref', { length: 64 }),
  installCount: integer('install_count').notNull().default(0),
  rating:       numeric('rating', { precision: 3, scale: 2 }),
  isTemplate:   boolean('is_template').notNull().default(false),
  publishedAt:  timestamp('published_at'),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_catalog_items_slug').on(t.tenantId, t.kind, t.slug),
  index('idx_catalog_items_public').on(t.kind, t.visibility, t.publishedAt),
]);

// ---------------------------------------------------------------------------
// 7 — Conversation, questions, outbound
// ---------------------------------------------------------------------------

/**
 * A conversation, whatever it is about. Absorbs 5 tables.
 *
 * PRD 20 §2.1's session test: if a thing is authored content, that people can be
 * present in, and can be shared, it is not a feature — it is the canvas. A
 * thread is the conversation half of that, and it is keyed by `objectId` rather
 * than by a per-feature parent id, which is what lets chat, comments, support
 * and ceremony notes be one surface.
 */
export const threads = pgTable('threads', {
  id:            uuid('id').primaryKey().defaultRandom(),
  tenantId:      integer('tenant_id').notNull(),
  objectId:      uuid('object_id').references(() => objects.id, { onDelete: 'cascade' }),
  /** 'chat' | 'comment' | 'support' | 'ceremony' | 'dm' | 'agent'. */
  kind:          varchar('kind', { length: 32 }).notNull().default('chat'),
  title:         varchar('title', { length: 300 }),
  /** 'chat' | 'work' — the distinction migration 0409 introduced. */
  mode:          varchar('mode', { length: 16 }).notNull().default('chat'),
  status:        varchar('status', { length: 16 }).notNull().default('open'),
  lastMessageAt: timestamp('last_message_at'),
  /** Denormalised so a thread list does not fan out one COUNT(*) per row. */
  messageCount:  integer('message_count').notNull().default(0),
  createdBy:     varchar('created_by', { length: 64 }),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_threads_tenant_recent').on(t.tenantId, t.kind, t.lastMessageAt),
  index('idx_threads_object').on(t.objectId),
]);

/** A message in a thread, whatever the channel. Absorbs 12 tables. */
export const messages = pgTable('messages', {
  id:         bigserial('id', { mode: 'number' }).primaryKey(),
  tenantId:   integer('tenant_id').notNull(),
  threadId:   uuid('thread_id').notNull().references(() => threads.id, { onDelete: 'cascade' }),
  authorKind: varchar('author_kind', { length: 16 }).notNull().default('user'),
  authorRef:  varchar('author_ref', { length: 64 }),
  /** 'user' | 'assistant' | 'system' | 'tool'. */
  role:       varchar('role', { length: 16 }).notNull().default('user'),
  body:       text('body'),
  /** Structured content blocks — tool calls, attachments, citations. */
  parts:      jsonb('parts'),
  tokenCount: integer('token_count'),
  model:      varchar('model', { length: 96 }),
  replyToId:  bigint('reply_to_id', { mode: 'number' }),
  editedAt:   timestamp('edited_at'),
  deletedAt:  timestamp('deleted_at'),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('idx_messages_thread').on(t.threadId, t.createdAt),
  index('idx_messages_tenant').on(t.tenantId, t.createdAt),
]);

/**
 * Surveys, pulses, check-ins, scorecards, screening forms. Absorbs 12 tables.
 *
 * **Cadence is config**, not a table per rhythm — a weekly pulse and a one-off
 * survey differ by a JSON key, which is the whole reason there were twelve.
 *
 * ── THE PUBLICATION COLUMNS (migration 0469) ────────────────────────────────
 * A set could be authored and never SENT. The canvas contract declares
 * `PublishedForm`, `FORM_AUDIENCES`, `FORM_STATUSES` and an `anonymous` boolean
 * with an argument for each distinction and had zero consumers, because the
 * store they describe had no public address and no enforceable audience. Those
 * are the five columns below — added HERE rather than as a `published_forms`
 * table, because a second form store is a second answer to "what did this person
 * answer", which is the collapse this table exists to be.
 */
export const questionSets = pgTable('question_sets', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    integer('tenant_id').notNull(),
  /** 'survey' | 'pulse' | 'check_in' | 'scorecard' | 'screening' | 'diagnostic'
   *  | 'form' — the canvas `form` object's own kind. A kind is a column value. */
  kind:        varchar('kind', { length: 32 }).notNull(),
  name:        varchar('name', { length: 200 }).notNull(),
  description: text('description'),
  questions:   jsonb('questions').notNull().default('[]'),
  cadence:     jsonb('cadence'),
  /** The audience's PARAMETERS — segment filters, role filters. The enforceable
   *  discriminator is `audienceKind` below; this is what it is parameterised by,
   *  which is why both exist and neither restates the other. */
  audience:    jsonb('audience'),
  status:      varchar('status', { length: 16 }).notNull().default('draft'),
  opensAt:     timestamp('opens_at'),
  closesAt:    timestamp('closes_at'),
  createdBy:   varchar('created_by', { length: 64 }),
  /** The canvas `form` object this set is the projection of. */
  objectId:    uuid('object_id').references(() => objects.id, { onDelete: 'set null' }),
  /**
   * The PUBLIC address. Globally unique and nullable: a set that has never been
   * published has none, and a published one has no tenant in its URL to
   * disambiguate it with — the row it resolves to reports the tenant rather than
   * the caller asserting one, which is the `share_token` cross-tenant reason.
   */
  slug:        varchar('slug', { length: 64 }),
  /**
   * Whether a response records WHO answered.
   *
   * A boolean and NOT an audience value, which is the distinction the contract
   * argues and the one that is load-bearing: an anonymous engagement pulse must
   * not record the responder even though they are signed in, while a policy
   * acknowledgement is worthless unless it does. Conflating them is how an
   * "anonymous" survey comes to carry a user id.
   */
  anonymous:   boolean('anonymous').notNull().default(false),
  /** 'anyoneWithLink' | 'workspace' | 'namedRecipients'. Enforced by the public
   *  responder route; `form_recipients` is what makes the third value real. */
  audienceKind: varchar('audience_kind', { length: 24 }).notNull().default('anyoneWithLink'),
  /** Shown after a successful submit. Authored, because "thanks" is rarely the
   *  useful thing to say — an applicant wants to know what happens next. */
  confirmationMessage: text('confirmation_message'),
  /**
   * Days of silence before a named-recipient form chases whoever has not
   * answered. 0 opts out — and 0 is the DEFAULT, unlike `signature_requests`,
   * because most published sets are `anyoneWithLink` surveys with nobody to
   * chase and a chasing default would make every publish a mail campaign.
   */
  remindAfterDays: integer('remind_after_days').notNull().default(0),
  /** Stamped by the sweep AFTER delivery, so a transport failure retries next
   *  tick instead of silently skipping a cycle. */
  lastRemindedAt: timestamp('last_reminded_at'),
  /**
   * Whether the ROOM sees the running tally — the facilitation half (migration
   * 1103, `kind = 'poll'`).
   *
   * Its own column and NOT a `status` value, because it is decided independently
   * of whether voting is open: a facilitator hides the count while people vote,
   * so the first three answers do not decide the rest, and reveals it with voting
   * still open. Folding it into `status` would make "reveal" mean "close", which
   * is the one thing a facilitator has to be able to do separately.
   */
  showResultsLive: boolean('show_results_live').notNull().default(true),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_question_sets_tenant').on(t.tenantId, t.kind, t.status),
  uniqueIndex('uq_question_sets_slug').on(t.slug),
  // The reminder sweep's own predicate — see migration 0479.
  index('idx_question_sets_reminders').on(t.status, t.audienceKind, t.remindAfterDays, t.lastRemindedAt),
]);

/**
 * An answer to a question, whatever asked it. Absorbs 13 tables.
 *
 * One value column per type rather than a single stringified `value`: a scorecard
 * average and a pulse trend are aggregates, and aggregating text that happens to
 * look numeric is how a survey reports a score of NaN.
 */
export const responses = pgTable('responses', {
  id:             bigserial('id', { mode: 'number' }).primaryKey(),
  tenantId:       integer('tenant_id').notNull(),
  questionSetId:  uuid('question_set_id').references(() => questionSets.id, { onDelete: 'cascade' }),
  /** What the answer is ABOUT — a candidate being scored, a sprint being reviewed. */
  objectId:       uuid('object_id').references(() => objects.id, { onDelete: 'cascade' }),
  respondentKind: varchar('respondent_kind', { length: 16 }).notNull().default('user'),
  /** NULL on an anonymous form — not "anonymous", not a hashed id, ABSENT. A
   *  column holding a pseudonym on an anonymous survey is a column somebody
   *  eventually joins, and the promise made to the person answering was that
   *  there would be nothing to join. */
  respondentRef:  varchar('respondent_ref', { length: 64 }),
  /**
   * The SUBMISSION one answer belongs to (migration 0469).
   *
   * This table is one row per ANSWER, which is the right grain and left one
   * question unanswerable: "how many people responded". Counting distinct
   * respondents works only while there is a respondent, and on an anonymous form
   * there deliberately is not — so an anonymous pulse could record every answer
   * and never report a response COUNT. A per-submission id closes that without
   * identifying anybody: it groups one person's answers to each other and to
   * nothing else.
   */
  submissionId:   uuid('submission_id'),
  /** The form recipient whose token was used, when the audience is named. */
  recipientId:    integer('recipient_id'),
  questionKey:    varchar('question_key', { length: 120 }).notNull(),
  valueText:      text('value_text'),
  valueNumber:    numeric('value_number', { precision: 20, scale: 6 }),
  valueJson:      jsonb('value_json'),
  submittedAt:    timestamp('submitted_at'),
  createdAt:      timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('idx_responses_set').on(t.questionSetId, t.questionKey),
  index('idx_responses_object').on(t.objectId),
  index('idx_responses_respondent').on(t.tenantId, t.respondentKind, t.respondentRef),
  index('idx_responses_submission').on(t.questionSetId, t.submissionId),
  // The poll tally's own read: every vote for one set, in arrival order. Without it
  // a refresh in front of a room scans every answer the platform holds — see
  // migration 1103.
  index('idx_responses_set_submitted').on(t.questionSetId, t.submittedAt),
]);

/**
 * Anything that leaves the platform. Absorbs 16 tables — outbound sends,
 * dispatches, notifications, alerts, webhook attempts.
 *
 * `retryable` is a column rather than an inference because the mailbox work
 * already learned it the hard way: whether a failure should requeue is a
 * property of the failure, and deriving it from the error string at retry time
 * is how a hard bounce gets retried for a week.
 */
export const deliveries = pgTable('deliveries', {
  id:          bigserial('id', { mode: 'number' }).primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  objectId:    uuid('object_id').references(() => objects.id, { onDelete: 'set null' }),
  /** 'email' | 'webhook' | 'sms' | 'push' | 'slack' | 'in_app'. */
  channel:     varchar('channel', { length: 24 }).notNull(),
  recipient:   varchar('recipient', { length: 320 }).notNull(),
  template:    varchar('template', { length: 96 }),
  subject:     varchar('subject', { length: 300 }),
  payload:     jsonb('payload'),
  /** 'queued' | 'sending' | 'sent' | 'delivered' | 'bounced' | 'failed'. */
  status:      varchar('status', { length: 16 }).notNull().default('queued'),
  attempts:    integer('attempts').notNull().default(0),
  retryable:   boolean('retryable').notNull().default(true),
  provider:    varchar('provider', { length: 48 }),
  providerRef: varchar('provider_ref', { length: 160 }),
  error:       text('error'),
  scheduledAt: timestamp('scheduled_at'),
  sentAt:      timestamp('sent_at'),
  deliveredAt: timestamp('delivered_at'),
  openedAt:    timestamp('opened_at'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_deliveries_queue').on(t.status, t.scheduledAt),
  index('idx_deliveries_tenant').on(t.tenantId, t.channel, t.createdAt),
  index('idx_deliveries_object').on(t.objectId),
]);


// ═══ from common.ts — shared enums and column types ═══
/**
 * Schema — common context.
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

export const tsvector = customType<{ data: string }>({
  dataType() { return 'tsvector'; },
});


// ---------------------------------------------------------------------------
// Enum columns (Builderforce orchestration)
// ---------------------------------------------------------------------------

export const projectStatusEnum = pgEnum('project_status', [
  'active', 'completed', 'archived', 'on_hold',
]);


// Task status is a free-form varchar (see migration 0076): a project's swimlanes
// define its board columns, so a task's status is whatever lane key it sits in.
// The canonical default statuses live in the app-layer `TaskStatus` enum.

export const taskPriorityEnum = pgEnum('task_priority', [
  'low', 'medium', 'high', 'urgent',
]);


export const agentTypeEnum = pgEnum('agent_type', [
  'claude', 'openai', 'ollama', 'http',
]);


// Task type is a fixed, automation-driven dimension (unlike the free-form
// per-board `status` lane key): a plain `task`, or an `epic` that decomposes
// into child tasks (parent_task_id) — see migration 0112.
export const taskTypeEnum = pgEnum('task_type', [
  'task', 'epic', 'gap', 'security',
  // Incident ticket (migration 0325): a first-class board card the Incident Manager
  // agent works, bridged to a prod_incidents record.
  'incident',
  // Hireable work-item kinds (migration 0293): a full product/scope brief a
  // Product-Manager agent authors + publishes for a fixed-bid build, and a UI/UX
  // design (or design-review) gig. Both are publishable to the Gig Marketplace.
  'product', 'design',
]);


export const tenantStatusEnum = pgEnum('tenant_status', [
  'active', 'suspended', 'archived',
]);


export const tenantRoleEnum = pgEnum('tenant_role', [
  'owner', 'manager', 'developer', 'viewer',
]);


// Segment tier (see README "Segment tier"): the isolation level between tenant
// and entity for tenants that are themselves multi-tenant.
export const segmentStatusEnum = pgEnum('segment_status', [
  'active', 'suspended', 'archived',
]);


// How a tenant authenticates users: 'direct' = BuilderForce is the IdP
// (local/OAuth/magic-link, the current model); 'embedded' = an external host is
// the OIDC IdP and identity arrives as claims.
export const tenantKindEnum = pgEnum('tenant_kind', [
  'embedded', 'direct',
]);


// Whether a tenant sub-divides into segments. 'single' tenants are pinned to one
// default segment; 'segmented' tenants get one segment per end-client.
export const tenantIsolationModeEnum = pgEnum('tenant_isolation_mode', [
  'single', 'segmented',
]);


export const sourceControlProviderEnum = pgEnum('source_control_provider', [
  'github', 'bitbucket',
]);


export const authTokenTypeEnum = pgEnum('auth_token_type', [
  'web', 'tenant', 'api', 'host',
]);


export const legalDocumentTypeEnum = pgEnum('legal_document_type', [
  'terms', 'privacy',
]);


export const newsletterSubscriptionStatusEnum = pgEnum('newsletter_subscription_status', [
  'subscribed', 'unsubscribed', 'suppressed',
]);


export const newsletterEventTypeEnum = pgEnum('newsletter_event_type', [
  'subscribed', 'unsubscribed', 'template_sent', 'email_opened', 'email_clicked',
]);


export const privacyRequestTypeEnum = pgEnum('privacy_request_type', [
  'ccpa', 'gdpr', 'access', 'correction', 'deletion', 'portability',
  'restriction', 'objection', 'opt_out', 'appeal', 'automated_decision_review',
]);


export const privacyRequestStatusEnum = pgEnum('privacy_request_status', [
  'pending', 'verifying', 'processing', 'completed', 'denied', 'appealed', 'closed',
]);


export const executionStatusEnum = pgEnum('execution_status', [
  'pending', 'submitted', 'running', 'completed', 'failed', 'cancelled',
  // Non-terminal: a cloud run that called ask_human and is waiting on a person
  // (migration 0120). Not spending, not terminal — resumes once the question is
  // answered. The reaper's running/pending/submitted sweeps deliberately skip it.
  'paused',
]);


export const agentHostStatusEnum = pgEnum('agent_host_status', ['active', 'inactive', 'suspended']);

export const agentHostDirectoryStatusEnum = pgEnum('agent_host_directory_status', ['pending', 'synced', 'error']);


export const specStatusEnum = pgEnum('spec_status', ['draft', 'ready', 'in_progress', 'complete']);

export const workflowTypeEnum = pgEnum('workflow_type', ['feature', 'bugfix', 'refactor', 'planning', 'adversarial', 'custom']);

export const workflowStatusEnum = pgEnum('workflow_status', ['pending', 'running', 'completed', 'failed', 'cancelled']);

export const workflowTaskStatusEnum = pgEnum('workflow_task_status', ['pending', 'running', 'completed', 'failed', 'cancelled']);

export const approvalStatusEnum = pgEnum('approval_status', ['pending', 'approved', 'rejected', 'expired', 'answered']);


/**
 * What the marketplace sells and what a scope can be given (migration 0982).
 *
 * `'content'` was retired: it named browser-only "content blocks" that no table
 * ever held, so every assignment/like/purchase of one pointed at a slug the
 * server could not resolve. Content lives in `knowledge_documents` now.
 * `'agent'` replaced it — a marketplace agent's purchase is recorded in
 * `marketplace_purchases` like every other artifact sale.
 */
export const artifactTypeEnum = pgEnum('artifact_type', ['skill', 'persona', 'agent']);

export const assignmentScopeEnum = pgEnum('assignment_scope', ['tenant', 'host', 'project', 'task', 'agent']);

export const pricingModelEnum = pgEnum('pricing_model', ['flat_fee', 'consumption']);


export const managedAgentHostRequestStatusEnum = pgEnum('managed_agent_host_request_status', [
  'pending', 'provisioning', 'active', 'cancelled', 'failed',
]);


// ---------------------------------------------------------------------------
// Workforce member profiles + lifecycle metrics (migrations 0116–0118)
// ---------------------------------------------------------------------------

/** Which workforce sub-population a member_ref points at — shared by team_members
 *  (0114), member_profiles, and member_metrics_period. Declared here (ahead of the
 *  Workforce Teams section) so all consumers can reference it. */
export const teamMemberKindEnum = pgEnum('team_member_kind', [
  'human', 'cloud_agent', 'host_agent',
]);


export const memberExperienceLevelEnum = pgEnum('member_experience_level', [
  'junior', 'mid', 'senior', 'staff', 'principal',
]);

export const memberAvailabilityStatusEnum = pgEnum('member_availability_status', [
  'available', 'busy', 'focus', 'ooo', 'on_call',
]);

export const memberProfileSyncSourceEnum = pgEnum('member_profile_sync_source', [
  'manual', 'google_calendar',
]);


export const deploymentStatusEnum = pgEnum('deployment_status', [
  'success', 'failed', 'rolled_back',
]);


// ===========================================================================
// PHASE 6 — Dev Analytics & Team Intelligence (DevDynamics)
// ===========================================================================

// ---------------------------------------------------------------------------
// 6a — Integration providers + credentials
// ---------------------------------------------------------------------------

export const integrationProviderEnum = pgEnum('integration_provider', [
  'github', 'gitlab', 'bitbucket', 'jira', 'confluence', 'freshservice', 'rally', 'freshworks',
  'freshdesk',
  'google_calendar',
  // 0221 — single-pane / migration connectors
  'servicenow', 'linear', 'sentry', 'pagerduty', 'monday', 'asana', 'clickup',
  // 0353/0413 — BYO web-search vendor keys. These WIDEN `web_search` from the keyless
  // encyclopedic floor to a general web index; they do not enable it.
  // Ids MUST match CREDENTIALED_WEB_SEARCH_VENDOR_IDS in
  // application/runtime/webSearchVendors.ts (the KEYLESS ids are deliberately absent —
  // there is no credential to store for them, and `searxng` is addressed by an operator
  // env var rather than a stored key).
  // `brave_search` (0353) is RETIRED: no adapter answers to it, so a leftover row
  // resolves to no vendor and is skipped. The label stays only because PostgreSQL has no
  // `ALTER TYPE ... DROP VALUE` — see migration 0413.
  'brave_search',
  'tavily', 'exa', 'linkup',
  // 0355 — Google connectors (OAuth offline credentials). Gmail backs the email
  // workflow node; Google Drive can back a project's file storage.
  'gmail', 'google_drive',
]);


export const integrationSyncStatusEnum = pgEnum('integration_sync_status', [
  'idle', 'syncing', 'success', 'error',
]);


// ---------------------------------------------------------------------------
// 6c — Activity events (commits, PRs, reviews, issues)
// ---------------------------------------------------------------------------

export const activityEventTypeEnum = pgEnum('activity_event_type', [
  'commit', 'pr_opened', 'pr_merged', 'pr_closed', 'pr_reviewed',
  'issue_created', 'issue_resolved', 'issue_commented',
]);


// ---------------------------------------------------------------------------
// 6f — Scheduled reports + subscriptions
// ---------------------------------------------------------------------------

export const reportTypeEnum = pgEnum('report_type', [
  'standup', 'code_review', 'project_status', 'executive_summary', 'portfolio_rollup',
  /** A canvas frame, rendered and delivered on a cadence (mig 0461). The first
   *  report type that is ABOUT something — see `report_schedules.subject_ref`. */
  'board_pack',
]);


export const reportScheduleEnum = pgEnum('report_schedule', [
  'daily', 'weekly', 'monthly',
]);


// ───────────────────────────────────────────────────────────────────────────
// Studio voice cloning (Voice PRD #1994). A clone is an enrolled voice identity
// (a reference sample in R2 + a cached speaker embedding); synthesis output is
// persisted to studio_voiceovers, which doubles as the read-through synthesis
// cache (keyed by sha256(cloneId+text+speed+lang)). Licensing lets one tenant
// use another's published clone. Migration 0127.
// ───────────────────────────────────────────────────────────────────────────

/** Who may use/see a clone: only its owner, anyone with the link, or listed in
 *  the marketplace catalog. */
export const voiceCloneVisibilityEnum = pgEnum('voice_clone_visibility', [
  'private',
  'unlisted',
  'marketplace',
]);


/** Lifecycle: enrolling, usable, or published to the marketplace. */
export const voiceCloneStatusEnum = pgEnum('voice_clone_status', ['draft', 'ready', 'published']);


// ---------------------------------------------------------------------------
// Alerts — threshold alert rules on platform metrics (migration 0234).
//
// A user defines a rule (metric + comparator + threshold + window); the daily
// runAlertSweep evaluates each enabled rule by reusing the existing metric
// collectors and, when it trips (respecting cooldown), raises an alert_event and
// notifies via the shared Slack/email channels (approvalNotifier). The system
// 'eval_drift' alert always fires from runEvalDriftSweep without a rule.
// tenant+segment scoped (uuid PK) like the other planning trackers.
// ---------------------------------------------------------------------------

/** Metric keys a rule may target (kept in lockstep with metricEvaluators). */
export type AlertMetric =
  | 'token_spend_usd'
  | 'token_spend_pct_of_cap'
  | 'cost_per_merged_pr_usd'
  | 'dora_change_failure_rate'
  | 'dora_lead_time_hours'
  | 'ai_effectiveness_score'
  | 'eval_drift';
