/**
 * Growth context — what happens to a published site AFTER it goes live.
 *
 * Three previously-missing halves of "idea → delivered outcome", grouped
 * because they are one chain and nothing else depends on them:
 *
 *   traffic      — `site_traffic_daily`, the per-site/per-day request rollup
 *                  that turns "we shipped it" into "people used it".
 *   site backend — `site_collections` / `site_records`: a published static
 *                  site's public write endpoint and the rows it collects, so a
 *                  contact form on a deployed page has somewhere to post.
 *   marketing    — audiences, verified sender identities, suppression, campaigns
 *                  and the per-recipient send ledger, so a tenant can market the
 *                  thing they just built.
 *
 * Deliberately NOT `sales_campaigns` (commerce.ts / migration 0401) — that is
 * the Builderforce referral team's own CRM, scoped to a user with hand-typed
 * counters. Everything here is tenant-scoped and machine-maintained.
 *
 * This file imports from work/identity/collaboration and nothing imports it, so
 * the schema barrel stays acyclic. See migration 0412.
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
  serial,
  text,
  timestamp,
  type AnyPgColumn,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { objects } from './kernel';
import { creationSessions } from './canvas';
import { tenants } from './identity';
import { mailboxConnections } from './integrations';
import { connectorConnections } from './platform';
import { projects, projectSites } from './delivery';

// ---------------------------------------------------------------------------
// Traffic
// ---------------------------------------------------------------------------

/**
 * Per-site, per-UTC-day request rollup.
 *
 * A row per request would put a database write on the worker's hottest path and
 * dominate Neon cost, so the hosting middleware buffers counts in-isolate and
 * flushes an additive UPSERT (`application/ide/siteTraffic.ts`). `visitors` is
 * approximate by construction — it counts distinct daily visitor hashes an
 * isolate observed, so concurrent isolates can double-count a visitor. The UI
 * labels it as approximate rather than pretending otherwise.
 */
export const siteTrafficDaily = pgTable('site_traffic_daily', {
  id:          serial('id').primaryKey(),
  siteId:      integer('site_id').notNull().references(() => projectSites.id, { onDelete: 'cascade' }),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  projectId:   integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  day:         date('day').notNull(),
  pageViews:   integer('page_views').notNull().default(0),
  assetHits:   integer('asset_hits').notNull().default(0),
  visitors:    integer('visitors').notNull().default(0),
  bytesServed: bigint('bytes_served', { mode: 'number' }).notNull().default(0),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_site_traffic_daily_site_day').on(t.siteId, t.day),
  index('idx_site_traffic_daily_tenant_day').on(t.tenantId, t.day),
  index('idx_site_traffic_daily_project_day').on(t.projectId, t.day),
]);

// ---------------------------------------------------------------------------
// Site backend
// ---------------------------------------------------------------------------

/**
 * A named public write endpoint on a published site, served at
 * `https://<site-host>/__api/collections/<name>`.
 *
 * Reads are never public — exposing a GET would hand every visitor the whole
 * submission list. The owner reads records back through the authenticated
 * project API instead.
 */
export const siteCollections = pgTable('site_collections', {
  id:                   serial('id').primaryKey(),
  siteId:               integer('site_id').notNull().references(() => projectSites.id, { onDelete: 'cascade' }),
  tenantId:             integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  projectId:            integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name:                 varchar('name', { length: 64 }).notNull(),
  acceptsPublicWrites:  boolean('accepts_public_writes').notNull().default(true),
  /** When set, a submission carrying an `email` also lands in this audience. */
  audienceId:           integer('audience_id'),
  /** Per-collection daily write ceiling; 0 = use the platform default. */
  dailyWriteCap:        integer('daily_write_cap').notNull().default(0),
  /**
   * Who may READ this collection back (0465).
   *
   * `none` is today's behaviour and the default, so nothing that exists changes:
   * writes are public, reads are the owner's through the authenticated project
   * API. `owner` additionally lets a SIGNED-IN end user (`site_users`) read the
   * rows they themselves wrote, which is what makes a generated app with accounts
   * possible at all.
   *
   * There is deliberately no `all`. A public read of every submission is the
   * exact failure this module was written to prevent, and offering it as one
   * option among three is how it eventually gets chosen.
   */
  readPolicy:           varchar('read_policy', { length: 16 }).notNull().default('none'),
  recordCount:          integer('record_count').notNull().default(0),
  createdAt:            timestamp('created_at').notNull().defaultNow(),
  updatedAt:            timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_site_collections_site_name').on(t.siteId, t.name),
  index('idx_site_collections_tenant').on(t.tenantId),
  index('idx_site_collections_project').on(t.projectId),
]);

/** One public submission. `ipHash` is a salted hash — rate limiting and dedupe
 *  without ever storing a visitor's IP address. */
export const siteRecords = pgTable('site_records', {
  id:           bigserial('id', { mode: 'number' }).primaryKey(),
  collectionId: integer('collection_id').notNull().references(() => siteCollections.id, { onDelete: 'cascade' }),
  tenantId:     integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  payload:      jsonb('payload').notNull().default({}),
  email:        varchar('email', { length: 320 }),
  /** The end user who wrote this row, when one was signed in (0465). Null keeps
   *  the anonymous form post exactly as it was, and is what an owner-scoped read
   *  filters on — a null-owner row belongs to nobody and is never handed back. */
  siteUserId:   integer('site_user_id').references(() => siteUsers.id, { onDelete: 'set null' }),
  ipHash:       varchar('ip_hash', { length: 64 }),
  userAgent:    varchar('user_agent', { length: 500 }),
  referrer:     varchar('referrer', { length: 1000 }),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('idx_site_records_collection_time').on(t.collectionId, t.createdAt),
  index('idx_site_records_tenant_time').on(t.tenantId, t.createdAt),
  index('idx_site_records_email').on(t.email),
  index('site_records_owner_idx').on(t.collectionId, t.siteUserId),
]);

/**
 * A release of a published site — the register that makes rollback possible.
 *
 * Publishing used to delete every object under the subdomain prefix before
 * writing the new build, so the previous release was gone the moment a worse one
 * shipped. Builds now land under `sites/<sub>/<versionToken>/` and this is the
 * list of them. `project_sites.r2_prefix` stays the POINTER to the current one:
 * a deliberate denormalisation with a single writer, because serving an asset
 * must resolve a site in one read and a join per request is the hot path.
 */
export const siteReleases = pgTable('site_releases', {
  id:           serial('id').primaryKey(),
  siteId:       integer('site_id').notNull().references(() => projectSites.id, { onDelete: 'cascade' }),
  tenantId:     integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  versionToken: varchar('version_token', { length: 32 }).notNull(),
  r2Prefix:     text('r2_prefix').notNull(),
  /** 'browser' (built in the workspace) | 'github' (built by the tenant's Action). */
  source:       varchar('source', { length: 16 }).notNull().default('browser'),
  assetCount:   integer('asset_count').notNull().default(0),
  totalBytes:   bigint('total_bytes', { mode: 'number' }).notNull().default(0),
  publishedAt:  timestamp('published_at').notNull().defaultNow(),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('site_releases_site_version_unique').on(t.siteId, t.versionToken),
  index('site_releases_site_published_idx').on(t.siteId, t.publishedAt),
  index('site_releases_tenant_idx').on(t.tenantId),
]);

/**
 * An END USER of a generated app — someone who signed up to the thing a tenant
 * built, not a Builderforce user.
 *
 * A separate identity space from `users` on purpose. A person signing into
 * someone's recipe app has no Builderforce account, no tenant membership and no
 * platform permissions; conflating the two would make every generated app a door
 * into the platform's own identity.
 *
 * Passwordless by construction — there is no password column and no hash. A
 * generated app is authored by a language model, and a badly-stored password is
 * the one mistake that cannot be walked back. Sign-in is a one-time code sent to
 * the address, so the app never holds a reusable secret.
 */
export const siteUsers = pgTable('site_users', {
  id:          serial('id').primaryKey(),
  siteId:      integer('site_id').notNull().references(() => projectSites.id, { onDelete: 'cascade' }),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  email:       varchar('email', { length: 320 }).notNull(),
  displayName: varchar('display_name', { length: 120 }),
  status:      varchar('status', { length: 16 }).notNull().default('active'),
  lastSeenAt:  timestamp('last_seen_at'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('site_users_site_email_unique').on(t.siteId, t.email),
  index('site_users_tenant_idx').on(t.tenantId),
]);

/**
 * One sign-in attempt, and — once redeemed — the session it became.
 *
 * `codeHash` is set while the one-time code is outstanding and CLEARED on
 * redemption, so an unredeemed request cannot be replayed into a session and a
 * live session carries no credential at all. Only hashes are stored: neither the
 * code nor the session token is recoverable from this table.
 */
export const siteUserSessions = pgTable('site_user_sessions', {
  id:            serial('id').primaryKey(),
  siteUserId:    integer('site_user_id').notNull().references(() => siteUsers.id, { onDelete: 'cascade' }),
  siteId:        integer('site_id').notNull().references(() => projectSites.id, { onDelete: 'cascade' }),
  tenantId:      integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  tokenHash:     varchar('token_hash', { length: 64 }).notNull(),
  codeHash:      varchar('code_hash', { length: 64 }),
  codeExpiresAt: timestamp('code_expires_at'),
  attempts:      integer('attempts').notNull().default(0),
  expiresAt:     timestamp('expires_at').notNull(),
  redeemedAt:    timestamp('redeemed_at'),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('site_user_sessions_token_unique').on(t.tokenHash),
  index('site_user_sessions_user_idx').on(t.siteUserId),
  index('site_user_sessions_site_idx').on(t.siteId),
]);

// ---------------------------------------------------------------------------
// Marketing
// ---------------------------------------------------------------------------

/**
 * A verified `From:` identity. A campaign cannot send until `status='verified'`,
 * so a tenant can never send as a domain they do not control. Ownership is
 * proven with a TXT record resolved over DNS-over-HTTPS — the same verifier the
 * custom-domain flow uses (`application/ide/dnsVerification.ts`).
 */
export const marketingSenderIdentities = pgTable('marketing_sender_identities', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  fromEmail:   varchar('from_email', { length: 320 }).notNull(),
  fromName:    varchar('from_name', { length: 255 }).notNull().default(''),
  replyTo:     varchar('reply_to', { length: 320 }),
  status:      varchar('status', { length: 16 }).notNull().default('pending'),
  verifyToken: varchar('verify_token', { length: 64 }).notNull(),
  verifiedAt:  timestamp('verified_at'),
  lastError:   text('last_error'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_marketing_sender_tenant_email').on(t.tenantId, t.fromEmail),
]);

export const marketingAudiences = pgTable('marketing_audiences', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  projectId:   integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
  name:        varchar('name', { length: 255 }).notNull(),
  description: text('description').notNull().default(''),
  memberCount: integer('member_count').notNull().default(0),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_marketing_audiences_tenant').on(t.tenantId, t.updatedAt),
]);

/** Membership is never deleted on unsubscribe — the row IS the record that
 *  consent was withdrawn, and deleting it would let a re-import resurrect them. */
export const marketingAudienceMembers = pgTable('marketing_audience_members', {
  id:         bigserial('id', { mode: 'number' }).primaryKey(),
  audienceId: integer('audience_id').notNull().references(() => marketingAudiences.id, { onDelete: 'cascade' }),
  tenantId:   integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  email:      varchar('email', { length: 320 }).notNull(),
  name:       varchar('name', { length: 255 }).notNull().default(''),
  status:     varchar('status', { length: 16 }).notNull().default('subscribed'),
  source:     varchar('source', { length: 32 }).notNull().default('manual'),
  attributes: jsonb('attributes').notNull().default({}),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_marketing_audience_member').on(t.audienceId, t.email),
  index('idx_marketing_audience_members_tenant').on(t.tenantId),
]);

/** Tenant-wide do-not-contact, checked at send time regardless of audience. */
export const marketingSuppressions = pgTable('marketing_suppressions', {
  id:        bigserial('id', { mode: 'number' }).primaryKey(),
  tenantId:  integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  email:     varchar('email', { length: 320 }).notNull(),
  reason:    varchar('reason', { length: 32 }).notNull().default('unsubscribed'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_marketing_suppressions_tenant_email').on(t.tenantId, t.email),
]);

/**
 * A reusable subject + HTML body.
 *
 * `source` is not decoration — it decides how the body is TREATED. An
 * `imported` body came from outside and is sanitized on write (script/iframe/
 * `on*` handlers stripped); a `custom` body was authored in-app against the same
 * sanitizer. Recording provenance is what lets that stay auditable after the fact.
 */
export const marketingTemplates = pgTable('marketing_templates', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name:        varchar('name', { length: 255 }).notNull(),
  description: text('description').notNull().default(''),
  subject:     varchar('subject', { length: 500 }).notNull().default(''),
  bodyHtml:    text('body_html').notNull().default(''),
  /** 'builtin' | 'custom' | 'imported' | 'generated' */
  source:      varchar('source', { length: 16 }).notNull().default('custom'),
  /** Logo/hero rendered through `{{logo}}`. SET NULL on asset delete so the
   *  template degrades to "no logo" instead of disappearing with it. */
  assetId:     integer('asset_id').references((): AnyPgColumn => marketingAssets.id, { onDelete: 'set null' }),
  /** Merge fields the body actually references, computed on write — the composer
   *  uses it to tell an author which attributes their audience must carry. */
  mergeFields: jsonb('merge_fields').notNull().default([]),
  createdBy:   varchar('created_by', { length: 64 }),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_marketing_templates_tenant_name').on(t.tenantId, t.name),
  index('idx_marketing_templates_tenant').on(t.tenantId, t.updatedAt),
]);

/**
 * A logo or image an email can actually load.
 *
 * The bytes live in R2 (the existing UPLOADS bucket); only the pointer is a row.
 * `publicToken` IS the access model: a recipient's mail client has no session, so
 * an authenticated asset URL renders as a broken image in every inbox. Rotating
 * the token — not deleting the row — is how an asset is un-published, which keeps
 * the campaigns that referenced it explainable.
 */
export const marketingAssets = pgTable('marketing_assets', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name:        varchar('name', { length: 255 }).notNull(),
  /** 'logo' | 'image'. A logo is singled out because templates reference it by
   *  ROLE (`{{logo}}`), not by id — swapping the logo must not edit N templates. */
  kind:        varchar('kind', { length: 16 }).notNull().default('image'),
  r2Key:       varchar('r2_key', { length: 512 }).notNull(),
  mimeType:    varchar('mime_type', { length: 128 }).notNull().default('image/png'),
  byteSize:    integer('byte_size').notNull().default(0),
  width:       integer('width'),
  height:      integer('height'),
  /** 'uploaded' | 'generated' — a generated logo keeps its prompt for re-rolls. */
  source:      varchar('source', { length: 16 }).notNull().default('uploaded'),
  prompt:      text('prompt'),
  publicToken: varchar('public_token', { length: 64 }).notNull(),
  createdBy:   varchar('created_by', { length: 64 }),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_marketing_assets_token').on(t.publicToken),
  index('idx_marketing_assets_tenant').on(t.tenantId, t.kind, t.updatedAt),
]);

export const marketingCampaigns = pgTable('marketing_campaigns', {
  id:               serial('id').primaryKey(),
  tenantId:         integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  projectId:        integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
  audienceId:       integer('audience_id').notNull().references(() => marketingAudiences.id, { onDelete: 'cascade' }),
  senderIdentityId: integer('sender_identity_id').references(() => marketingSenderIdentities.id, { onDelete: 'set null' }),
  /**
   * How this campaign leaves the building — see {@link CAMPAIGN_TRANSPORTS}.
   * A discriminator plus one nullable pointer per transport, not a polymorphic
   * `sender_ref`: each transport has a different owning table and a different
   * precondition, so "is this campaign sendable?" would otherwise be unwriteable.
   */
  transport:        varchar('transport', { length: 16 }).notNull().default('platform'),
  /** transport='mailbox' — the tenant's own connected Microsoft 365 / Gmail account. */
  mailboxConnectionId: integer('mailbox_connection_id').references(() => mailboxConnections.id, { onDelete: 'set null' }),
  /** transport='sendgrid' — the tenant's Twilio SendGrid connector connection. */
  connectorConnectionId: uuid('connector_connection_id').references(() => connectorConnections.id, { onDelete: 'set null' }),
  templateId:       integer('template_id').references(() => marketingTemplates.id, { onDelete: 'set null' }),
  /** The From: display name actually delivered. Denormalized because it is a
   *  HISTORICAL fact — renaming or disconnecting the mailbox later must not
   *  rewrite what recipients already saw. */
  fromName:         varchar('from_name', { length: 255 }).notNull().default(''),
  name:             varchar('name', { length: 255 }).notNull(),
  subject:          varchar('subject', { length: 500 }).notNull().default(''),
  bodyHtml:         text('body_html').notNull().default(''),
  status:           varchar('status', { length: 16 }).notNull().default('draft'),
  scheduledAt:      timestamp('scheduled_at'),
  startedAt:        timestamp('started_at'),
  completedAt:      timestamp('completed_at'),
  recipients:       integer('recipients').notNull().default(0),
  sent:             integer('sent').notNull().default(0),
  failed:           integer('failed').notNull().default(0),
  suppressed:       integer('suppressed').notNull().default(0),
  opened:           integer('opened').notNull().default(0),
  clicked:          integer('clicked').notNull().default(0),
  /** Launching session, so campaign delivery rolls up into the SAME outcome
   *  ledger as the site it markets. */
  sessionId:        uuid('session_id').references(() => creationSessions.id, { onDelete: 'set null' }),
  createdAt:        timestamp('created_at').notNull().defaultNow(),
  updatedAt:        timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_marketing_campaigns_tenant_status').on(t.tenantId, t.status, t.updatedAt),
]);

/** One row per (campaign, recipient). The unique index is what makes a resumed
 *  or retried send idempotent — a second pass cannot email the same person twice. */
export const marketingCampaignSends = pgTable('marketing_campaign_sends', {
  id:         bigserial('id', { mode: 'number' }).primaryKey(),
  campaignId: integer('campaign_id').notNull().references(() => marketingCampaigns.id, { onDelete: 'cascade' }),
  tenantId:   integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  email:      varchar('email', { length: 320 }).notNull(),
  status:     varchar('status', { length: 16 }).notNull().default('queued'),
  error:      text('error'),
  /** Opaque per-recipient token behind the open pixel, click links and the
   *  one-click unsubscribe. Unique so a token resolves to exactly one send. */
  trackToken: varchar('track_token', { length: 64 }).notNull(),
  /** Delivery attempts so far. Load-bearing, not telemetry: a retryable failure
   *  returns the row to `queued`, so without a bound an error we misclassified as
   *  retryable would requeue forever and the campaign would never complete. */
  attempts:   integer('attempts').notNull().default(0),
  openedAt:   timestamp('opened_at'),
  clickedAt:  timestamp('clicked_at'),
  sentAt:     timestamp('sent_at'),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_marketing_sends_campaign_email').on(t.campaignId, t.email),
  uniqueIndex('uq_marketing_sends_token').on(t.trackToken),
  index('idx_marketing_sends_campaign_status').on(t.campaignId, t.status),
]);

/**
 * A campaign published to the workspace's OWN social accounts.
 *
 * Deliberately NOT a `marketing_campaigns` row with a channel column. That table's
 * every load-bearing column is about reaching a list of strangers by email — a
 * NOT NULL audience, a DNS-verified sender identity, suppression, per-recipient
 * unsubscribe tokens — and none of them exist for a post to a Page you own. Forcing
 * one shape over both would mean a fake audience row per social campaign and a
 * "sendable?" check that could not be written. The fact is different, so the table is.
 *
 * `variants` is per-network copy keyed by network: the same announcement is 280
 * characters on X and a paragraph on LinkedIn, and a campaign that could only carry
 * one body would either truncate or under-use every network it touches. Absent key →
 * the shared `body`, so the simple case stays simple.
 */
export const socialCampaigns = pgTable('social_campaigns', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  projectId:   integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
  name:        varchar('name', { length: 255 }).notNull(),
  body:        text('body').notNull().default(''),
  linkUrl:     varchar('link_url', { length: 1000 }).notNull().default(''),
  /** Public https URLs. Instagram and TikTok PULL these themselves, so an
   *  authenticated URL is a failed post rather than a broken image. */
  mediaUrls:   jsonb('media_urls').$type<string[]>().notNull().default([]),
  variants:    jsonb('variants').$type<Record<string, string>>().notNull().default({}),
  status:      varchar('status', { length: 16 }).notNull().default('draft'),
  scheduledAt: timestamp('scheduled_at'),
  startedAt:   timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  targets:     integer('targets').notNull().default(0),
  published:   integer('published').notNull().default(0),
  failed:      integer('failed').notNull().default(0),
  /** Launching canvas session, so social delivery rolls up into the SAME outcome
   *  ledger as the campaign it belongs to. */
  sessionId:   uuid('session_id').references(() => creationSessions.id, { onDelete: 'set null' }),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_social_campaigns_tenant_status').on(t.tenantId, t.status, t.updatedAt),
]);

/** One row per (campaign, account). The unique index is what makes a resumed or
 *  retried publish idempotent — a second pass cannot post the same campaign to the
 *  same Page twice, which on a public feed is not a recoverable mistake. */
export const socialCampaignPosts = pgTable('social_campaign_posts', {
  id:           bigserial('id', { mode: 'number' }).primaryKey(),
  campaignId:   integer('campaign_id').notNull().references(() => socialCampaigns.id, { onDelete: 'cascade' }),
  tenantId:     integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  connectionId: uuid('connection_id').notNull().references(() => connectorConnections.id, { onDelete: 'cascade' }),
  /** Denormalized from the connection because it is a HISTORICAL fact — deleting the
   *  connection later must not erase which network something went out on. */
  network:      varchar('network', { length: 16 }).notNull(),
  /** The copy actually published, after variant resolution. Stored, not recomputed:
   *  editing the campaign afterwards must not rewrite what the world already saw. */
  body:         text('body').notNull().default(''),
  status:       varchar('status', { length: 16 }).notNull().default('queued'),
  externalId:   varchar('external_id', { length: 255 }),
  permalink:    varchar('permalink', { length: 1000 }),
  error:        text('error'),
  /** Attempts so far. Load-bearing exactly as it is for email: a retryable failure
   *  returns the row to `queued`, so without a bound a misclassified error would
   *  requeue forever and the campaign would never complete. */
  attempts:     integer('attempts').notNull().default(0),
  publishedAt:  timestamp('published_at'),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_social_posts_campaign_connection').on(t.campaignId, t.connectionId),
  index('idx_social_posts_campaign_status').on(t.campaignId, t.status),
]);

// ═══ PRD 20 §5 step 2 — target-schema tables ═══
//
// Growth & marketing — the CMO's forty-seven remaining targets (PRD 20 §3.2).
//
// The largest domain: 142 source tables in → 58 out, 65 absorbed by the kernel,
// 2 by the canvas, 10 merged into a sibling. Contributed by all three products
// almost evenly (BF 13 · HV 23 · BR 29), which is why it carried the most
// duplication and the most renaming of the same fact.
//
// WHAT COLLAPSED (§3.3):
//   · `marketing_push_campaigns`, `ri_campaigns` and `sales_campaigns` are
//     `campaign` kinds. Each was a named send to an audience with a status and
//     reply counters; three teams named the counters differently.
//   · `marketing_brand_kits` merged into `brand_kits`. One stored colour and font
//     as columns, the other as a `colors` JSON — the same fact in two shapes, so
//     the column overlap read as 0.11 and the machine could not see it.
//   · `marketing_sessions` became `metric_facts`. `visitor_id`, `landing_path`,
//     `referrer`, `utm`, `converted` is an analytics visit, not an entity.
//   · `nurture_flow_enrollments` and `follow_up_enrollments` joined the one
//     shared sequence enrolment — person + sequence + status + `current_step` +
//     `next_send_at`, four times over.
//   · `channel_performance` and `site_traffic_daily` are derived numbers with
//     their own DDL: `metric_facts` plus a scheduled rollup (§3.2).
//
// Every send below is a kernel `deliveries` row; every recipient list is an
// audience definition, never a copy of the contacts.

// ── Campaigns and sequences ────────────────────────────────────────────────

/** A named send to an audience. */
export const emailCampaigns = pgTable('email_campaigns', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  objectId:    uuid('object_id').references(() => objects.id, { onDelete: 'cascade' }),
  /** 'marketing' | 'push' | 'sales' | 'revenue_intelligence' | 'lifecycle' —
   *  the column that replaced three tables (§3.3). */
  kind:        varchar('kind', { length: 32 }).notNull().default('marketing'),
  name:        varchar('name', { length: 200 }).notNull(),
  subject:     varchar('subject', { length: 300 }),
  preheader:   varchar('preheader', { length: 300 }),
  fromName:    varchar('from_name', { length: 160 }),
  fromEmail:   varchar('from_email', { length: 320 }),
  bodyHtml:    text('body_html'),
  bodyText:    text('body_text'),
  /** A filter, not a copy of the recipients — a materialised list goes stale the
   *  moment somebody unsubscribes. */
  audience:    jsonb('audience'),
  connectionId: integer('connection_id'),
  /** 'draft' | 'scheduled' | 'sending' | 'sent' | 'paused' | 'cancelled'. */
  status:      varchar('status', { length: 16 }).notNull().default('draft'),
  scheduledAt: timestamp('scheduled_at'),
  sentAt:      timestamp('sent_at'),
  /** Denormalised counters. The per-recipient truth is `deliveries`; these exist
   *  so a campaign list is one query rather than one aggregate per row. */
  recipientCount: integer('recipient_count').notNull().default(0),
  openCount:   integer('open_count').notNull().default(0),
  clickCount:  integer('click_count').notNull().default(0),
  replyCount:  integer('reply_count').notNull().default(0),
  bounceCount: integer('bounce_count').notNull().default(0),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_email_campaigns_name').on(t.tenantId, t.name),
  index('idx_email_campaigns_status').on(t.tenantId, t.status, t.scheduledAt),
]);

/** A single marketing email that is not a campaign — a template, a transactional
 *  body, a one-off. Kept apart from `email_campaigns` because it has no audience
 *  and no schedule, which is most of what a campaign IS. */
export const marketingEmails = pgTable('marketing_emails', {
  id:         serial('id').primaryKey(),
  tenantId:   integer('tenant_id').notNull(),
  key:        varchar('key', { length: 96 }).notNull(),
  name:       varchar('name', { length: 200 }).notNull(),
  subject:    varchar('subject', { length: 300 }),
  bodyHtml:   text('body_html'),
  bodyText:   text('body_text'),
  /** Merge fields the body expects, so a send can fail fast on a missing one
   *  rather than mailing `{{first_name}}` to ten thousand people. */
  variables:  jsonb('variables'),
  isTemplate: boolean('is_template').notNull().default(true),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_marketing_emails_key').on(t.tenantId, t.key),
]);

/** A nurture flow definition. */
export const nurtureFlows = pgTable('nurture_flows', {
  id:         serial('id').primaryKey(),
  tenantId:   integer('tenant_id').notNull(),
  name:       varchar('name', { length: 200 }).notNull(),
  goal:       varchar('goal', { length: 200 }),
  steps:      jsonb('steps').notNull().default('[]'),
  entryRule:  jsonb('entry_rule'),
  exitRule:   jsonb('exit_rule'),
  status:     varchar('status', { length: 16 }).notNull().default('draft'),
  ownerRef:   varchar('owner_ref', { length: 64 }),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_nurture_flows_name').on(t.tenantId, t.name),
]);

/**
 * One person's position in one sequence.
 *
 * THE COLLAPSE §3.3 NAMES. `outplacement_enrollments`,
 * `nurture_flow_enrollments`, `recruiter_outreach_enrollments` and
 * `follow_up_enrollments` were all person + sequence + status + `current_step` +
 * `next_send_at`. One table, one `sequenceKind`, four fewer places for the
 * scheduler to disagree with itself.
 */
export const followUpEnrollments = pgTable('follow_up_enrollments', {
  id:           serial('id').primaryKey(),
  tenantId:     integer('tenant_id').notNull(),
  /** 'nurture' | 'outreach' | 'outplacement' | 'follow_up' | 'learning'. */
  sequenceKind: varchar('sequence_kind', { length: 24 }).notNull().default('follow_up'),
  sequenceRef:  varchar('sequence_ref', { length: 64 }).notNull(),
  subjectKind:  varchar('subject_kind', { length: 16 }).notNull().default('contact'),
  subjectRef:   varchar('subject_ref', { length: 64 }).notNull(),
  currentStep:  integer('current_step').notNull().default(0),
  nextSendAt:   timestamp('next_send_at'),
  /** 'active' | 'paused' | 'completed' | 'replied' | 'bounced' | 'exited'. */
  status:       varchar('status', { length: 16 }).notNull().default('active'),
  enrolledAt:   timestamp('enrolled_at').notNull().defaultNow(),
  completedAt:  timestamp('completed_at'),
  exitReason:   varchar('exit_reason', { length: 120 }),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_follow_up_enrollments_subject').on(t.tenantId, t.sequenceKind, t.sequenceRef, t.subjectRef),
  index('idx_follow_up_enrollments_due').on(t.status, t.nextSendAt),
]);

/** A customer journey definition — the map, not one person's path through it. */
export const customerJourneys = pgTable('customer_journeys', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  name:        varchar('name', { length: 200 }).notNull(),
  persona:     varchar('persona', { length: 120 }),
  stages:      jsonb('stages').notNull().default('[]'),
  description: text('description'),
  isActive:    boolean('is_active').notNull().default(true),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_customer_journeys_name').on(t.tenantId, t.name),
]);

/** One observed touch on a journey. */
export const journeyTouchpoints = pgTable('journey_touchpoints', {
  id:         bigserial('id', { mode: 'number' }).primaryKey(),
  tenantId:   integer('tenant_id').notNull(),
  journeyId:  integer('journey_id').references(() => customerJourneys.id, { onDelete: 'cascade' }),
  subjectRef: varchar('subject_ref', { length: 64 }),
  visitorId:  varchar('visitor_id', { length: 64 }),
  stage:      varchar('stage', { length: 64 }).notNull(),
  channel:    varchar('channel', { length: 32 }),
  label:      varchar('label', { length: 200 }),
  /** Fractional credit, so a multi-touch model is a stored number rather than a
   *  recomputation per report. */
  attribution: numeric('attribution', { precision: 5, scale: 4 }),
  occurredAt: timestamp('occurred_at').notNull().defaultNow(),
}, (t) => [
  index('idx_journey_touchpoints_subject').on(t.tenantId, t.subjectRef, t.occurredAt),
  index('idx_journey_touchpoints_journey').on(t.journeyId, t.stage, t.occurredAt),
]);

/** A lead. `marketing_leads` ~ `sales_leads` was one of the four pairs left in
 *  the 0.30–0.35 band, and pass B merged them: one table, one `source`. */
export const marketingLeads = pgTable('marketing_leads', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  objectId:    uuid('object_id').references(() => objects.id, { onDelete: 'cascade' }),
  email:       varchar('email', { length: 320 }),
  name:        varchar('name', { length: 200 }),
  company:     varchar('company', { length: 255 }),
  phone:       varchar('phone', { length: 40 }),
  /** 'marketing' | 'sales' | 'partner' | 'referral' — the merge of the pair. */
  origin:      varchar('origin', { length: 24 }).notNull().default('marketing'),
  source:      varchar('source', { length: 96 }),
  campaignId:  integer('campaign_id'),
  utm:         jsonb('utm'),
  score:       numeric('score', { precision: 5, scale: 2 }),
  /** 'new' | 'working' | 'qualified' | 'converted' | 'disqualified'. */
  status:      varchar('status', { length: 16 }).notNull().default('new'),
  ownerRef:    varchar('owner_ref', { length: 64 }),
  convertedContactRef: varchar('converted_contact_ref', { length: 64 }),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_marketing_leads_status').on(t.tenantId, t.status, t.createdAt),
  index('idx_marketing_leads_email').on(t.tenantId, t.email),
]);

/** Somebody waiting for access. Distinct from `region_waitlist` (Identity),
 *  which gates on GEOGRAPHY; this gates on a product or a launch. */
export const waitlistEntries = pgTable('waitlist_entries', {
  id:         serial('id').primaryKey(),
  tenantId:   integer('tenant_id'),
  listKey:    varchar('list_key', { length: 96 }).notNull(),
  email:      varchar('email', { length: 320 }).notNull(),
  name:       varchar('name', { length: 200 }),
  referrer:   varchar('referrer', { length: 500 }),
  position:   integer('position'),
  /** 'waiting' | 'invited' | 'joined' | 'declined'. */
  status:     varchar('status', { length: 16 }).notNull().default('waiting'),
  invitedAt:  timestamp('invited_at'),
  joinedAt:   timestamp('joined_at'),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_waitlist_entries_email').on(t.listKey, t.email),
]);

/** One referral, from whom to whom. The reward is a `ledger_entries` row. */
export const referralEntries = pgTable('referral_entries', {
  id:           serial('id').primaryKey(),
  tenantId:     integer('tenant_id').notNull(),
  referrerRef:  varchar('referrer_ref', { length: 64 }).notNull(),
  refereeEmail: varchar('referee_email', { length: 320 }),
  refereeRef:   varchar('referee_ref', { length: 64 }),
  code:         varchar('code', { length: 64 }),
  /** 'sent' | 'clicked' | 'signed_up' | 'qualified' | 'rewarded' | 'expired'. */
  status:       varchar('status', { length: 16 }).notNull().default('sent'),
  rewardLedgerRef: varchar('reward_ledger_ref', { length: 160 }),
  qualifiedAt:  timestamp('qualified_at'),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_referral_entries_referrer').on(t.tenantId, t.referrerRef, t.status),
]);

/** An affiliate's referral. Distinct from `referral_entries`: an affiliate is a
 *  contracted party with a commission rate, a member referral is a perk. */
export const affiliateReferrals = pgTable('affiliate_referrals', {
  id:           serial('id').primaryKey(),
  tenantId:     integer('tenant_id').notNull(),
  affiliateRef: varchar('affiliate_ref', { length: 64 }).notNull(),
  clickId:      varchar('click_id', { length: 64 }),
  landingPath:  varchar('landing_path', { length: 500 }),
  refereeRef:   varchar('referee_ref', { length: 64 }),
  orderId:      integer('order_id'),
  commissionCents: integer('commission_cents').notNull().default(0),
  currency:     varchar('currency', { length: 8 }).notNull().default('USD'),
  /** 'clicked' | 'converted' | 'approved' | 'paid' | 'reversed'. */
  status:       varchar('status', { length: 16 }).notNull().default('clicked'),
  convertedAt:  timestamp('converted_at'),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_affiliate_referrals_affiliate').on(t.tenantId, t.affiliateRef, t.status),
]);

/** Outreach to a podcast. Kept out of the sequence family because the unit is a
 *  SHOW rather than a person, and the pitch is per-episode. */
export const podcastOutreach = pgTable('podcast_outreach', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  showName:    varchar('show_name', { length: 255 }).notNull(),
  hostName:    varchar('host_name', { length: 200 }),
  contactEmail: varchar('contact_email', { length: 320 }),
  audienceSize: integer('audience_size'),
  topicPitch:  text('topic_pitch'),
  /** 'researching' | 'pitched' | 'booked' | 'recorded' | 'published' | 'passed'. */
  status:      varchar('status', { length: 16 }).notNull().default('researching'),
  recordedAt:  timestamp('recorded_at'),
  publishedUrl: text('published_url'),
  ownerRef:    varchar('owner_ref', { length: 64 }),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_podcast_outreach_show').on(t.tenantId, t.showName),
]);

// ── Advertising ────────────────────────────────────────────────────────────

/** A paid campaign on an ad platform. Separate from `email_campaigns` because
 *  the unit of spend, the audience model and the reporting grain are all
 *  different — the same word, a different noun. */
export const adCampaigns = pgTable('ad_campaigns', {
  id:           serial('id').primaryKey(),
  tenantId:     integer('tenant_id').notNull(),
  objectId:     uuid('object_id').references(() => objects.id, { onDelete: 'cascade' }),
  connectionId: integer('connection_id'),
  platform:     varchar('platform', { length: 32 }).notNull(),
  externalId:   varchar('external_id', { length: 160 }),
  name:         varchar('name', { length: 200 }).notNull(),
  /** OUR normalized objective — see `AdObjective`. Null when a campaign created in
   *  the network's own console uses one our vocabulary has no name for. */
  objective:    varchar('objective', { length: 48 }),
  /** What the NETWORK calls it, kept verbatim so an unmappable objective is still
   *  reportable instead of silently becoming null on both sides. */
  nativeObjective: varchar('native_objective', { length: 64 }),
  /** When the network was last read for this campaign. A stale panel and a campaign
   *  that genuinely spent nothing are otherwise the same picture. */
  lastSyncedAt: timestamp('last_synced_at'),
  dailyBudgetCents: integer('daily_budget_cents'),
  totalBudgetCents: integer('total_budget_cents'),
  currency:     varchar('currency', { length: 8 }).notNull().default('USD'),
  status:       varchar('status', { length: 16 }).notNull().default('draft'),
  startsAt:     timestamp('starts_at'),
  endsAt:       timestamp('ends_at'),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_ad_campaigns_external').on(t.tenantId, t.platform, t.externalId),
]);

/** A targeting group within an ad campaign. */
export const adSets = pgTable('ad_sets', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  campaignId:  integer('campaign_id').references(() => adCampaigns.id, { onDelete: 'cascade' }),
  externalId:  varchar('external_id', { length: 160 }),
  name:        varchar('name', { length: 200 }).notNull(),
  targeting:   jsonb('targeting'),
  bidStrategy: varchar('bid_strategy', { length: 48 }),
  bidCents:    integer('bid_cents'),
  dailyBudgetCents: integer('daily_budget_cents'),
  status:      varchar('status', { length: 16 }).notNull().default('paused'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_ad_sets_external').on(t.tenantId, t.externalId),
]);

/** One creative running in an ad set. The image or video is an `artifacts` row. */
export const ads = pgTable('ads', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  adSetId:     integer('ad_set_id').references(() => adSets.id, { onDelete: 'cascade' }),
  externalId:  varchar('external_id', { length: 160 }),
  name:        varchar('name', { length: 200 }).notNull(),
  headline:    varchar('headline', { length: 300 }),
  body:        text('body'),
  callToAction: varchar('call_to_action', { length: 64 }),
  /** The CTA must carry intent into the session — a paid click landing on a
   *  blank dashboard is the most expensive instance of that bug. */
  destinationUrl: text('destination_url'),
  creativeArtifactId: uuid('creative_artifact_id'),
  status:      varchar('status', { length: 16 }).notNull().default('paused'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_ads_external').on(t.tenantId, t.externalId),
]);

/**
 * One day of delivery for one ad campaign — the measurement half of `ad_campaigns`.
 *
 * Its identity is `(tenant, campaign, date)`, and that UNIQUE index is what makes the
 * insights sweep idempotent: every network reports the last few days repeatedly as
 * conversions attribute late, so a re-sync must UPDATE the day rather than append a
 * second copy of it. Without the constraint, spend would compound on every sweep and
 * the number a founder reads would grow while nothing was being bought.
 *
 * Stored per DAY rather than as a running total because a total cannot be corrected: a
 * campaign's cost-per-lead over the last week is a question only daily rows can answer,
 * and the networks themselves restate history.
 */
export const adInsights = pgTable('ad_insights', {
  id:           serial('id').primaryKey(),
  tenantId:     integer('tenant_id').notNull(),
  campaignId:   integer('campaign_id').notNull().references(() => adCampaigns.id, { onDelete: 'cascade' }),
  /** Denormalized from the campaign ON PURPOSE: every rollup filters by network and
   *  would otherwise join `ad_campaigns` for a value that can never change for a
   *  given campaign. Single writer — the sync — so it cannot drift. */
  platform:     varchar('platform', { length: 32 }).notNull(),
  /** The day, in the ad account's own timezone — the grain every network bills on. */
  date:         date('date').notNull(),
  spendCents:   integer('spend_cents').notNull().default(0),
  impressions:  integer('impressions').notNull().default(0),
  clicks:       integer('clicks').notNull().default(0),
  conversions:  integer('conversions').notNull().default(0),
  currency:     varchar('currency', { length: 8 }).notNull().default('USD'),
  /** When this row was last read from the network — a restated day is visible as a
   *  fresh `synced_at` on an old `date`. */
  syncedAt:     timestamp('synced_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_ad_insights_day').on(t.tenantId, t.campaignId, t.date),
  index('idx_ad_insights_tenant_date').on(t.tenantId, t.date),
]);

/** A paid boost of a listing or profile. */
export const boosts = pgTable('boosts', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  subjectKind: varchar('subject_kind', { length: 32 }).notNull(),
  subjectRef:  varchar('subject_ref', { length: 64 }).notNull(),
  buyerRef:    varchar('buyer_ref', { length: 64 }),
  /** 'featured' | 'top_of_search' | 'homepage' | 'newsletter'. */
  placement:   varchar('placement', { length: 32 }).notNull(),
  startsAt:    timestamp('starts_at').notNull(),
  endsAt:      timestamp('ends_at').notNull(),
  priceCents:  integer('price_cents').notNull().default(0),
  currency:    varchar('currency', { length: 8 }).notNull().default('USD'),
  impressionCount: integer('impression_count').notNull().default(0),
  clickCount:  integer('click_count').notNull().default(0),
  status:      varchar('status', { length: 16 }).notNull().default('scheduled'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_boosts_live').on(t.tenantId, t.placement, t.startsAt, t.endsAt),
]);

/**
 * A boost purchase in flight.
 *
 * Narrowed to an ORDER SATELLITE after `check-signature-duplication.mjs` scored
 * it 0.60 against `course_checkouts`: both had grown their own copy of amount,
 * currency, status, provider reference and completion time, which is the money
 * half of an `orders` row written a second and a third time. Those columns are
 * gone; `orderId` points at the one place they live.
 *
 * What is left is the part a generic order genuinely cannot hold: a boost is
 * bought against a live placement WINDOW, so it can fail on availability rather
 * than on payment, and the requested window has to survive that failure for the
 * buyer to be offered another one.
 */
export const boostCheckouts = pgTable('boost_checkouts', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  boostId:     integer('boost_id').references(() => boosts.id, { onDelete: 'cascade' }),
  /** The `orders` row that carries the money. Null until checkout starts. */
  orderId:     integer('order_id'),
  requestedStartsAt: timestamp('requested_starts_at'),
  requestedEndsAt:   timestamp('requested_ends_at'),
  /** 'unchecked' | 'available' | 'conflict' | 'sold_out'. */
  availability: varchar('availability', { length: 16 }).notNull().default('unchecked'),
  conflictReason: varchar('conflict_reason', { length: 200 }),
  checkedAt:   timestamp('checked_at'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_boost_checkouts_availability').on(t.tenantId, t.availability, t.requestedStartsAt),
]);

// ── Experimentation ────────────────────────────────────────────────────────

/** An A/B test. */
export const abTests = pgTable('ab_tests', {
  id:           serial('id').primaryKey(),
  tenantId:     integer('tenant_id').notNull(),
  key:          varchar('key', { length: 96 }).notNull(),
  name:         varchar('name', { length: 200 }).notNull(),
  hypothesis:   text('hypothesis'),
  /** The `metric_facts` metric that decides it. Named up front, so the test
   *  cannot be re-read against whichever number came out best. */
  primaryMetric: varchar('primary_metric', { length: 96 }),
  minimumSample: integer('minimum_sample'),
  /** 'draft' | 'running' | 'stopped' | 'shipped' | 'abandoned'. */
  status:       varchar('status', { length: 16 }).notNull().default('draft'),
  startedAt:    timestamp('started_at'),
  endedAt:      timestamp('ended_at'),
  winningVariantId: integer('winning_variant_id'),
  conclusion:   text('conclusion'),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_ab_tests_key').on(t.tenantId, t.key),
]);

/** One arm of a test. */
export const abTestVariants = pgTable('ab_test_variants', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  testId:      integer('test_id').references(() => abTests.id, { onDelete: 'cascade' }),
  key:         varchar('key', { length: 48 }).notNull(),
  name:        varchar('name', { length: 160 }).notNull(),
  isControl:   boolean('is_control').notNull().default(false),
  trafficPercent: numeric('traffic_percent', { precision: 5, scale: 2 }).notNull().default('50'),
  payload:     jsonb('payload'),
  exposureCount: integer('exposure_count').notNull().default(0),
  conversionCount: integer('conversion_count').notNull().default(0),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_ab_test_variants_key').on(t.testId, t.key),
]);

/** Which slice of traffic a test applies to. */
export const abTestSegments = pgTable('ab_test_segments', {
  id:        serial('id').primaryKey(),
  tenantId:  integer('tenant_id').notNull(),
  testId:    integer('test_id').references(() => abTests.id, { onDelete: 'cascade' }),
  name:      varchar('name', { length: 160 }).notNull(),
  rule:      jsonb('rule').notNull().default('{}'),
  isExclusion: boolean('is_exclusion').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_ab_test_segments_name').on(t.testId, t.name),
]);

/** A broader experiment — a product bet rather than a traffic split. Kept apart
 *  from `ab_tests` because it has no variants and no traffic allocation: it is a
 *  decision with a review date. */
export const experiments = pgTable('experiments', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  objectId:    uuid('object_id').references(() => objects.id, { onDelete: 'cascade' }),
  name:        varchar('name', { length: 200 }).notNull(),
  hypothesis:  text('hypothesis'),
  successCriteria: text('success_criteria'),
  ownerRef:    varchar('owner_ref', { length: 64 }),
  /** 'proposed' | 'running' | 'concluded' | 'abandoned'. */
  status:      varchar('status', { length: 16 }).notNull().default('proposed'),
  startedAt:   timestamp('started_at'),
  reviewAt:    timestamp('review_at'),
  concludedAt: timestamp('concluded_at'),
  outcome:     text('outcome'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_experiments_name').on(t.tenantId, t.name),
]);

// ── Web surface ────────────────────────────────────────────────────────────

/**
 * A landing page.
 *
 * `landing_pages` ~ `website_pages` is one of the four pairs still in the
 * 0.30–0.35 band, and both are KEPT: a landing page has a campaign, a conversion
 * goal and a lifespan measured in weeks; a website page has a navigation position
 * and a permanent URL that SEO depends on. Merging them is how a campaign page
 * ends up in the sitemap.
 */
export const landingPages = pgTable('landing_pages', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  objectId:    uuid('object_id').references(() => objects.id, { onDelete: 'cascade' }),
  slug:        varchar('slug', { length: 200 }).notNull(),
  title:       varchar('title', { length: 300 }).notNull(),
  campaignId:  integer('campaign_id'),
  goalMetric:  varchar('goal_metric', { length: 96 }),
  /** 'draft' | 'live' | 'ended' | 'archived'. */
  status:      varchar('status', { length: 16 }).notNull().default('draft'),
  /** Which shell renders it — resolved by `classifyShell()`, never by the page
   *  remembering to register itself. */
  shellKind:   varchar('shell_kind', { length: 16 }).notNull().default('public'),
  publishedAt: timestamp('published_at'),
  endsAt:      timestamp('ends_at'),
  viewCount:   integer('view_count').notNull().default(0),
  conversionCount: integer('conversion_count').notNull().default(0),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_landing_pages_slug').on(t.tenantId, t.slug),
]);

/** An ordered block on a landing page. */
export const landingPageBlocks = pgTable('landing_page_blocks', {
  id:        serial('id').primaryKey(),
  tenantId:  integer('tenant_id').notNull(),
  pageId:    integer('page_id').references(() => landingPages.id, { onDelete: 'cascade' }),
  kind:      varchar('kind', { length: 48 }).notNull(),
  content:   jsonb('content'),
  position:  integer('position').notNull().default(0),
  isVisible: boolean('is_visible').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_landing_page_blocks_pos').on(t.pageId, t.position),
]);

/** A permanent page on the marketing site. */
export const websitePages = pgTable('website_pages', {
  id:           serial('id').primaryKey(),
  tenantId:     integer('tenant_id'),
  path:         varchar('path', { length: 500 }).notNull(),
  title:        varchar('title', { length: 300 }).notNull(),
  navLabel:     varchar('nav_label', { length: 160 }),
  navPosition:  integer('nav_position'),
  parentPath:   varchar('parent_path', { length: 500 }),
  bodyMarkdown: text('body_markdown'),
  /** The permanent URL SEO depends on. A redirect here is a decision, which is
   *  why "redirect the whole domain" cannot mean one 301. */
  canonicalPath: varchar('canonical_path', { length: 500 }),
  shellKind:    varchar('shell_kind', { length: 16 }).notNull().default('public'),
  status:       varchar('status', { length: 16 }).notNull().default('draft'),
  publishedAt:  timestamp('published_at'),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_website_pages_path').on(t.tenantId, t.path),
]);

/** A programmatically-generated SEO page. Kept apart from `website_pages`
 *  because it is generated from a template and a data row, and hired.video's
 *  incoming traffic fans out over hundreds of thousands of these. */
export const marketingSeoPages = pgTable('marketing_seo_pages', {
  id:           serial('id').primaryKey(),
  tenantId:     integer('tenant_id'),
  /** '/in/:country/:state/:city', '/salary/:jobSlug/:locationSlug', … */
  pattern:      varchar('pattern', { length: 255 }).notNull(),
  path:         varchar('path', { length: 500 }).notNull(),
  title:        varchar('title', { length: 300 }).notNull(),
  metaDescription: varchar('meta_description', { length: 500 }),
  /** The values that filled the pattern — what makes the page regenerable. */
  params:       jsonb('params'),
  structuredData: jsonb('structured_data'),
  status:       varchar('status', { length: 16 }).notNull().default('published'),
  lastRenderedAt: timestamp('last_rendered_at'),
  impressionCount: integer('impression_count').notNull().default(0),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_marketing_seo_pages_path').on(t.path),
  index('idx_marketing_seo_pages_pattern').on(t.pattern, t.status),
]);

/** An employer branding page. */
export const employerBrandingPages = pgTable('employer_branding_pages', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  slug:        varchar('slug', { length: 200 }).notNull(),
  headline:    varchar('headline', { length: 300 }),
  story:       text('story'),
  values:      jsonb('values'),
  perks:       jsonb('perks'),
  heroArtifactId: uuid('hero_artifact_id'),
  /** Colours through theme TOKENS — an employer page renders in both themes. */
  theme:       jsonb('theme'),
  status:      varchar('status', { length: 16 }).notNull().default('draft'),
  publishedAt: timestamp('published_at'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_employer_branding_pages_slug').on(t.tenantId, t.slug),
]);

/**
 * Every prompt an anonymous visitor submitted (migration 0434).
 *
 * Sessions on this platform start by TYPING, not by signing up — the landing
 * canvas composer opens a real guest session from the first submit. That prompt
 * states the visitor's intent in their own words, which makes it the highest
 * signal a lead ever gives us, and until 0434 it was the one thing not kept: it
 * went to the model and survived only in the visitor's own localStorage.
 *
 * Keyed by the same opaque `visitorId` as `marketing_sessions`, so a prompt
 * joins to its lead row, its first-touch attribution, and — once
 * `MarketingService.markConverted` stamps it — the account it became. Joined on
 * that id rather than by a foreign key, because the lead row is created lazily
 * and a prompt must never be lost to a race with it.
 *
 * NOT tenant-scoped, deliberately: this is written before an account exists, so
 * there is no tenant to scope it to, and the kernel's conversation primitives
 * (`threads`/`messages`) both require one. Recorded as a decision in
 * `check-tenant-column.mjs`.
 *
 * No `promptCount`/`lastPrompt` mirror exists on the lead row: those are derived
 * values, and 3NF is a requirement here rather than an aspiration. The console
 * reads intent through one cached aggregate join — see `GuestPromptService`.
 */
export const marketingSessionPrompts = pgTable('marketing_session_prompts', {
  id:         uuid('id').primaryKey().defaultRandom(),
  visitorId:  varchar('visitor_id', { length: 64 }).notNull(),
  /** The session the prompt opened: `local-<uuid>` pre-signup, the canvas id after. */
  sessionRef: varchar('session_ref', { length: 80 }),
  /** 'landing' | 'canvas' | 'brain' | 'room' — the vocabulary lives in the domain layer. */
  surface:    varchar('surface', { length: 24 }).notNull().default('landing'),
  /** The chat/work mode armed on the composer when it was submitted (0409). */
  mode:       varchar('mode', { length: 16 }),
  prompt:     text('prompt').notNull(),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('idx_marketing_session_prompts_visitor').on(t.visitorId, t.createdAt),
  index('idx_marketing_session_prompts_recent').on(t.createdAt),
]);


/**
 * A banner shown across the shell — and, with `tenantId` NULL, the PLATFORM
 * broadcast a superadmin sends to visitors who have no tenant at all
 * (migration 0434 wired this up; 0432 created it).
 *
 * It is one table for both because they are one thing: an operator-authored
 * message with a tone, an optional call to action, a window it is live in, and
 * an audience it is aimed at. The only difference is who the operator is and
 * whether the audience is inside a workspace, which is exactly what a nullable
 * `tenantId` says.
 *
 * `audience` is the targeting rule, evaluated server-side against the visitor's
 * `marketing_sessions` row — never against anything the client asserts:
 *   `{ scope: 'all'|'guest'|'registered'|'paid', visitorIds?: string[], minPrompts?: number }`
 * `domain/marketing/BroadcastAudience.ts` owns that shape and its predicate.
 *
 * Engagement is NOT counted in columns here. Impression / click / dismissal go
 * to `activity_log` — the kernel's append-only event primitive, whose
 * `tenantId` is already nullable for platform-global events and whose
 * `eventKey` unique index makes an impression idempotent per visitor. Counts
 * are a GROUP BY over that table (cached), so they stay derivable and "which
 * visitor clicked" stays answerable.
 */
export const announcementBanners = pgTable('announcement_banners', {
  id:         serial('id').primaryKey(),
  /** NULL = a PLATFORM broadcast, authored by a superadmin, aimed at visitors. */
  tenantId:   integer('tenant_id'),
  key:        varchar('key', { length: 96 }).notNull(),
  message:    varchar('message', { length: 500 }).notNull(),
  /** 'info' | 'success' | 'warning' | 'critical' — a token name, not a colour. */
  tone:       varchar('tone', { length: 16 }).notNull().default('info'),
  ctaLabel:   varchar('cta_label', { length: 96 }),
  ctaHref:    varchar('cta_href', { length: 500 }),
  audience:   jsonb('audience'),
  dismissible: boolean('dismissible').notNull().default(true),
  startsAt:   timestamp('starts_at'),
  endsAt:     timestamp('ends_at'),
  /** Superadmin who authored it — the only accountability a platform row carries. */
  createdBy:  varchar('created_by', { length: 36 }),
  /**
   * 'draft' | 'live' | 'archived'. Separate from the starts/ends window on
   * purpose: "is it written" and "is it due" are different questions, and a
   * scheduled banner is authored days before it should appear. Neither is
   * derived from the other, so both are stored.
   */
  status:     varchar('status', { length: 16 }).notNull().default('draft'),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_announcement_banners_key').on(t.tenantId, t.key),
  index('idx_announcement_banners_live').on(t.status, t.startsAt, t.endsAt),
]);

/** How an embeddable widget is laid out on a host page. */
export const embedWidgetLayout = pgTable('embed_widget_layout', {
  id:         serial('id').primaryKey(),
  tenantId:   integer('tenant_id').notNull(),
  widgetKey:  varchar('widget_key', { length: 96 }).notNull(),
  hostPattern: varchar('host_pattern', { length: 255 }),
  /** 'inline' | 'floating' | 'modal' | 'sidebar'. */
  mode:       varchar('mode', { length: 16 }).notNull().default('inline'),
  anchor:     varchar('anchor', { length: 160 }),
  layout:     jsonb('layout'),
  theme:      jsonb('theme'),
  isActive:   boolean('is_active').notNull().default(true),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_embed_widget_layout_key').on(t.tenantId, t.widgetKey, t.hostPattern),
]);

/** A page being heatmapped. */
export const marketingHeatmapPages = pgTable('marketing_heatmap_pages', {
  id:         serial('id').primaryKey(),
  tenantId:   integer('tenant_id').notNull(),
  path:       varchar('path', { length: 500 }).notNull(),
  /** Aggregate click / move / scroll density. Rebuilt from raw events on a
   *  schedule, which is why it is one row per page rather than one per event. */
  clickMap:   jsonb('click_map'),
  scrollMap:  jsonb('scroll_map'),
  sampleCount: integer('sample_count').notNull().default(0),
  periodStart: timestamp('period_start'),
  periodEnd:  timestamp('period_end'),
  computedAt: timestamp('computed_at'),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_marketing_heatmap_pages_path').on(t.tenantId, t.path, t.periodStart),
]);

/** The background image a heatmap is drawn over, per viewport. */
export const marketingHeatmapScreenshots = pgTable('marketing_heatmap_screenshots', {
  id:         serial('id').primaryKey(),
  tenantId:   integer('tenant_id').notNull(),
  pageId:     integer('page_id').references(() => marketingHeatmapPages.id, { onDelete: 'cascade' }),
  artifactId: uuid('artifact_id'),
  viewportWidth: integer('viewport_width').notNull(),
  viewportHeight: integer('viewport_height'),
  /** Captured in both themes — a heatmap over the wrong theme is unreadable. */
  themeMode:  varchar('theme_mode', { length: 8 }).notNull().default('light'),
  capturedAt: timestamp('captured_at').notNull().defaultNow(),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_marketing_heatmap_screenshots_viewport').on(t.pageId, t.viewportWidth, t.themeMode),
]);

// ── Content ────────────────────────────────────────────────────────────────

/**
 * A brand kit.
 *
 * `marketing_brand_kits` collapsed into this (§3.3). The two stored the same
 * fact in two shapes — one colour and font as columns, the other as a `colors`
 * JSON — so their column overlap read as 0.11 and no signature test could have
 * found it. This is the shape that keeps: tokens as data, because a brand kit
 * has to produce a LIGHT and a DARK palette, and a column per colour cannot.
 */
export const brandKits = pgTable('brand_kits', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  name:        varchar('name', { length: 200 }).notNull(),
  /** `{ light: {…tokens}, dark: {…tokens} }`. Both, always — a kit that defines
   *  one theme is a kit that renders unreadable in the other. */
  palette:     jsonb('palette'),
  typography:  jsonb('typography'),
  logoArtifactId: uuid('logo_artifact_id'),
  logoDarkArtifactId: uuid('logo_dark_artifact_id'),
  voice:       text('voice'),
  isDefault:   boolean('is_default').notNull().default(false),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_brand_kits_name').on(t.tenantId, t.name),
]);

/** A piece of content in the marketing pipeline. */
export const marketingContentItems = pgTable('marketing_content_items', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  objectId:    uuid('object_id').references(() => objects.id, { onDelete: 'cascade' }),
  title:       varchar('title', { length: 300 }).notNull(),
  /** 'post' | 'video' | 'email' | 'ad' | 'case_study' | 'whitepaper'. */
  format:      varchar('format', { length: 32 }).notNull(),
  channel:     varchar('channel', { length: 48 }),
  brief:       text('brief'),
  artifactId:  uuid('artifact_id'),
  ownerRef:    varchar('owner_ref', { length: 64 }),
  /** 'idea' | 'drafting' | 'review' | 'scheduled' | 'published' | 'retired'. */
  status:      varchar('status', { length: 16 }).notNull().default('idea'),
  scheduledAt: timestamp('scheduled_at'),
  publishedAt: timestamp('published_at'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_marketing_content_items_status').on(t.tenantId, t.status, t.scheduledAt),
]);

/** A blog post. */
export const blogPosts = pgTable('blog_posts', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id'),
  objectId:    uuid('object_id').references(() => objects.id, { onDelete: 'cascade' }),
  slug:        varchar('slug', { length: 200 }).notNull(),
  title:       varchar('title', { length: 300 }).notNull(),
  excerpt:     text('excerpt'),
  bodyMarkdown: text('body_markdown'),
  authorRef:   varchar('author_ref', { length: 64 }),
  category:    varchar('category', { length: 96 }),
  tags:        jsonb('tags'),
  heroArtifactId: uuid('hero_artifact_id'),
  readMinutes: integer('read_minutes'),
  status:      varchar('status', { length: 16 }).notNull().default('draft'),
  publishedAt: timestamp('published_at'),
  viewCount:   integer('view_count').notNull().default(0),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_blog_posts_slug').on(t.tenantId, t.slug),
  index('idx_blog_posts_published').on(t.status, t.publishedAt),
]);

/** A published video. The file and its renditions are `artifacts`. */
export const videos = pgTable('videos', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  objectId:    uuid('object_id').references(() => objects.id, { onDelete: 'cascade' }),
  artifactId:  uuid('artifact_id'),
  title:       varchar('title', { length: 300 }).notNull(),
  description: text('description'),
  durationMs:  integer('duration_ms'),
  thumbnailArtifactId: uuid('thumbnail_artifact_id'),
  visibility:  varchar('visibility', { length: 16 }).notNull().default('private'),
  viewCount:   integer('view_count').notNull().default(0),
  publishedAt: timestamp('published_at'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_videos_visibility').on(t.tenantId, t.visibility, t.publishedAt),
]);

/** A teaching video attached to a surface. Distinct from `videos`: a learn video
 *  is placed against a FEATURE and has a completion signal. */
export const learnVideos = pgTable('learn_videos', {
  id:         serial('id').primaryKey(),
  tenantId:   integer('tenant_id'),
  videoId:    integer('video_id').references(() => videos.id, { onDelete: 'cascade' }),
  /** Which surface it teaches — one of the fifteen domains, or the canvas. */
  surface:    varchar('surface', { length: 32 }).notNull(),
  featureKey: varchar('feature_key', { length: 96 }),
  title:      varchar('title', { length: 300 }).notNull(),
  position:   integer('position').notNull().default(0),
  isActive:   boolean('is_active').notNull().default(true),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_learn_videos_surface').on(t.tenantId, t.surface, t.featureKey, t.position),
]);

/** A video embedded on a marketing page. */
export const pageEmbedVideos = pgTable('page_embed_videos', {
  id:         serial('id').primaryKey(),
  tenantId:   integer('tenant_id').notNull(),
  pagePath:   varchar('page_path', { length: 500 }).notNull(),
  videoId:    integer('video_id').references(() => videos.id, { onDelete: 'cascade' }),
  anchor:     varchar('anchor', { length: 160 }),
  autoplay:   boolean('autoplay').notNull().default(false),
  position:   integer('position').notNull().default(0),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_page_embed_videos_pos').on(t.tenantId, t.pagePath, t.position),
]);

/** An ingest of a creator's YouTube channel. The run is a `runs` row; this is
 *  the ingest's standing configuration and its watermark. */
export const creatorYoutubeIngests = pgTable('creator_youtube_ingests', {
  id:           serial('id').primaryKey(),
  tenantId:     integer('tenant_id').notNull(),
  connectionId: integer('connection_id'),
  channelId:    varchar('channel_id', { length: 96 }).notNull(),
  channelTitle: varchar('channel_title', { length: 255 }),
  lastVideoAt:  timestamp('last_video_at'),
  importedCount: integer('imported_count').notNull().default(0),
  autoImport:   boolean('auto_import').notNull().default(true),
  status:       varchar('status', { length: 16 }).notNull().default('active'),
  lastError:    text('last_error'),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_creator_youtube_ingests_channel').on(t.tenantId, t.channelId),
]);

/** An audience a piece of content is written for. */
export const contentAudiences = pgTable('content_audiences', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  key:         varchar('key', { length: 96 }).notNull(),
  name:        varchar('name', { length: 200 }).notNull(),
  description: text('description'),
  painPoints:  jsonb('pain_points'),
  channels:    jsonb('channels'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_content_audiences_key').on(t.tenantId, t.key),
]);

/** A place content is targeted at — the location half of programmatic SEO. */
export const contentLocations = pgTable('content_locations', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id'),
  slug:        varchar('slug', { length: 200 }).notNull(),
  name:        varchar('name', { length: 200 }).notNull(),
  country:     varchar('country', { length: 2 }),
  region:      varchar('region', { length: 120 }),
  cityId:      integer('city_id'),
  /** Whether pages have been generated for it, so a sweep is resumable. */
  isGenerated: boolean('is_generated').notNull().default(false),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_content_locations_slug').on(t.tenantId, t.slug),
]);

// ── Community and events ───────────────────────────────────────────────────

/** A post in the community feed. */
export const feedPosts = pgTable('feed_posts', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id'),
  objectId:    uuid('object_id').references(() => objects.id, { onDelete: 'cascade' }),
  authorRef:   varchar('author_ref', { length: 64 }),
  body:        text('body'),
  artifactId:  uuid('artifact_id'),
  linkUrl:     text('link_url'),
  /** Likes and comments are `annotations` rows; these are the denormalised
   *  counts so a feed page is one query. */
  likeCount:   integer('like_count').notNull().default(0),
  commentCount: integer('comment_count').notNull().default(0),
  /** 'published' | 'hidden' | 'removed'. */
  status:      varchar('status', { length: 16 }).notNull().default('published'),
  pinnedUntil: timestamp('pinned_until'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_feed_posts_recent').on(t.tenantId, t.status, t.createdAt),
]);

/** A feed capability, gated by rung. Progressive disclosure gates STATE, never
 *  capability: a locked feature is listed and dimmed, never absent. */
export const feedFeatures = pgTable('feed_features', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id'),
  key:         varchar('key', { length: 96 }).notNull(),
  label:       varchar('label', { length: 200 }).notNull(),
  requiredRung: integer('required_rung').notNull().default(0),
  isEnabled:   boolean('is_enabled').notNull().default(true),
  position:    integer('position').notNull().default(0),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_feed_features_key').on(t.tenantId, t.key),
]);

/** An aggregated activity feed row. Distinct from `activity_log`: the audit
 *  stream is append-only and complete, this is the CURATED, fan-out-on-write
 *  projection a social feed reads, and it is allowed to forget. */
export const activityFeed = pgTable('activity_feed', {
  id:          bigserial('id', { mode: 'number' }).primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  audienceRef: varchar('audience_ref', { length: 64 }).notNull(),
  objectId:    uuid('object_id').references(() => objects.id, { onDelete: 'cascade' }),
  verb:        varchar('verb', { length: 64 }).notNull(),
  actorRef:    varchar('actor_ref', { length: 64 }),
  summary:     varchar('summary', { length: 500 }),
  /** Coalesced repeats — "3 people commented" is one row, not three. */
  groupKey:    varchar('group_key', { length: 160 }),
  groupCount:  integer('group_count').notNull().default(1),
  seenAt:      timestamp('seen_at'),
  occurredAt:  timestamp('occurred_at').notNull().defaultNow(),
}, (t) => [
  index('idx_activity_feed_audience').on(t.tenantId, t.audienceRef, t.occurredAt),
  uniqueIndex('uq_activity_feed_group').on(t.tenantId, t.audienceRef, t.groupKey),
]);

/** A category an event belongs to. */
export const eventCategories = pgTable('event_categories', {
  id:        serial('id').primaryKey(),
  tenantId:  integer('tenant_id'),
  key:       varchar('key', { length: 64 }).notNull(),
  label:     varchar('label', { length: 160 }).notNull(),
  colorToken: varchar('color_token', { length: 48 }),
  position:  integer('position').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_event_categories_key').on(t.tenantId, t.key),
]);

/** Somebody waiting for a place at a full event. */
export const eventWaitlist = pgTable('event_waitlist', {
  id:         serial('id').primaryKey(),
  tenantId:   integer('tenant_id').notNull(),
  eventRef:   varchar('event_ref', { length: 64 }).notNull(),
  partyRef:   varchar('party_ref', { length: 64 }),
  email:      varchar('email', { length: 320 }),
  position:   integer('position'),
  /** 'waiting' | 'offered' | 'accepted' | 'expired' | 'declined'. */
  status:     varchar('status', { length: 16 }).notNull().default('waiting'),
  offeredAt:  timestamp('offered_at'),
  offerExpiresAt: timestamp('offer_expires_at'),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_event_waitlist_party').on(t.tenantId, t.eventRef, t.email),
]);

/** A reminder that was actually sent for an event. The SEND is a `deliveries`
 *  row; this is the idempotency record that stops a retried scheduler mailing
 *  the same person twice. */
export const eventRemindersSent = pgTable('event_reminders_sent', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  eventRef:    varchar('event_ref', { length: 64 }).notNull(),
  recipientRef: varchar('recipient_ref', { length: 64 }),
  recipientEmail: varchar('recipient_email', { length: 320 }),
  /** 'week' | 'day' | 'hour' | 'starting'. */
  offsetKey:   varchar('offset_key', { length: 24 }).notNull(),
  deliveryRef: varchar('delivery_ref', { length: 64 }),
  sentAt:      timestamp('sent_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_event_reminders_sent_offset').on(t.tenantId, t.eventRef, t.recipientEmail, t.offsetKey),
]);

/** A suggested pairing between two attendees. */
export const eventMatchmaking = pgTable('event_matchmaking', {
  id:         serial('id').primaryKey(),
  tenantId:   integer('tenant_id').notNull(),
  eventRef:   varchar('event_ref', { length: 64 }).notNull(),
  partyARef:  varchar('party_a_ref', { length: 64 }).notNull(),
  partyBRef:  varchar('party_b_ref', { length: 64 }).notNull(),
  score:      numeric('score', { precision: 5, scale: 2 }),
  reasons:    jsonb('reasons'),
  /** 'suggested' | 'accepted' | 'declined' | 'met'. */
  status:     varchar('status', { length: 16 }).notNull().default('suggested'),
  slotAt:     timestamp('slot_at'),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_event_matchmaking_pair').on(t.tenantId, t.eventRef, t.partyARef, t.partyBRef),
]);

// ── Misc growth surfaces ───────────────────────────────────────────────────

/**
 * A client creative order.
 *
 * One of the three tables the machine kept and should have (§3.3):
 * `promo_projects` is a client creative ORDER, not a project. Collapsing it into
 * the delivery domain's project tree would have put a paid deliverable with a
 * client, a brief and a revision allowance onto a kanban board that models
 * internal work.
 */
export const promoProjects = pgTable('promo_projects', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  objectId:    uuid('object_id').references(() => objects.id, { onDelete: 'cascade' }),
  clientRef:   varchar('client_ref', { length: 64 }),
  orderId:     integer('order_id'),
  title:       varchar('title', { length: 300 }).notNull(),
  brief:       text('brief'),
  /** 'video' | 'design' | 'copy' | 'campaign'. */
  deliverable: varchar('deliverable', { length: 32 }).notNull(),
  revisionsAllowed: integer('revisions_allowed').notNull().default(2),
  revisionsUsed: integer('revisions_used').notNull().default(0),
  dueAt:       timestamp('due_at'),
  /** 'briefed' | 'in_production' | 'review' | 'delivered' | 'cancelled'. */
  status:      varchar('status', { length: 16 }).notNull().default('briefed'),
  deliveredArtifactId: uuid('delivered_artifact_id'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_promo_projects_status').on(t.tenantId, t.status, t.dueAt),
]);
