/**
 * Schema — Integrations, owned by **the platform** (PRD 20 §3).
 *
 * Root entity `connection`. 41 source tables in → 1 out, 33 absorbed by the kernel.
 * Like the canvas, that is the proof rather than a gap: integrations ARE
 * `connection` + `credential` + `delivery` + `sync_state`, and migration 0410
 * already established that a vendor is a manifest row, not DDL.
 *
 * Merged from `drive.ts` and `mailbox.ts`. Both wrote the same paragraph about
 * sealed tokens and a mirrored `expiresAt` — twice, three months apart — which is
 * the duplication `drive_connections = mailbox_connections` names in the
 * signature-duplication baseline.
 */

import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { tenants } from './identity';

// ═══ from drive.ts ═══
/**
 * Connected file storage — an OAuth grant on a real drive (Google Drive /
 * OneDrive).
 *
 * Separate from `mailbox_connections` for the same reason that table is separate
 * from `calendar_connections`: a Drive scope cannot read mail and a mail scope
 * cannot read files, so a tenant that granted one must not implicitly have
 * granted the other. Separate rows make the consent the user actually gave
 * auditable, and let one be revoked without touching the others.
 *
 * Shape follows `mailbox_connections` (0414), which is the current pattern:
 * tokens SEALED with the shared per-tenant AES-256-GCM credential crypto, and
 * `expiresAt` mirrored outside the sealed blob so a refresher can find stale
 * rows without decrypting every one of them.
 *
 * See migration 0415.
 */


/**
 * One connected drive.
 *
 * Keyed by (tenant, user, provider, account) exactly as a mailbox is: a drive
 * belongs to a PERSON, two colleagues connecting the same workspace must not
 * overwrite one another's grant, and including the account is what lets one user
 * connect a personal and a work Google account side by side.
 */
export const driveConnections = pgTable('drive_connections', {
  id:           serial('id').primaryKey(),
  tenantId:     integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  /** users.id — matches the mailbox/calendar width; intentionally no FK, so a
   *  deleted user's grant fails closed on refresh rather than cascading away the
   *  audit of what was connected. */
  userId:       varchar('user_id', { length: 64 }).notNull(),
  /** 'google' | 'microsoft' */
  provider:     varchar('provider', { length: 24 }).notNull(),
  accountEmail: varchar('account_email', { length: 320 }).notNull(),
  displayName:  varchar('display_name', { length: 255 }).notNull().default(''),
  /** Sealed `{ accessToken, refreshToken, expiresAtMs, scope }` — never a bare token. */
  tokenEnc:     text('token_enc').notNull(),
  tokenIv:      varchar('token_iv', { length: 64 }).notNull(),
  expiresAt:    timestamp('expires_at'),
  scope:        text('scope').notNull().default(''),
  /** 'connected' | 'expired' | 'revoked'. `revoked` is terminal until the user
   *  reconnects — it is what lets the UI say "reconnect" instead of failing
   *  every listing with an opaque 401. */
  status:       varchar('status', { length: 16 }).notNull().default('connected'),
  lastError:    text('last_error'),
  /** Bumped on every reconnect, and the version token in the listing cache key —
   *  reconnecting a drive is the one event that must invalidate every cached
   *  folder under it, and the keyspace (a folder id per drive) is unbounded. */
  cacheVersion: integer('cache_version').notNull().default(1),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_drive_connections_account').on(t.tenantId, t.userId, t.provider, t.accountEmail),
  index('idx_drive_connections_tenant').on(t.tenantId, t.status),
]);


// ═══ from mailbox.ts ═══
/**
 * Mailbox context — an OAuth grant on a real mailbox (Microsoft 365 / Gmail).
 *
 * Separate from `calendar_connections` (collaboration.ts) even though both are
 * per-user Google/Microsoft grants, because they are not the same permission:
 * a calendar scope cannot read or send mail, and a tenant that grants one must
 * not implicitly have granted the other. Separate rows make the consent the user
 * actually gave auditable.
 *
 * Two deliberate differences from the calendar table, which is the older shape:
 *   • tokens are SEALED (`tokenEnc`/`tokenIv`) with the shared per-tenant
 *     AES-256-GCM credential crypto rather than stored in plaintext columns;
 *   • `expiresAt` is mirrored OUTSIDE the sealed blob so the refresher can find
 *     stale rows without decrypting every one of them.
 *
 * This file imports only from identity, and growth.ts imports it, so the schema
 * barrel stays acyclic. See migration 0414.
 */


/**
 * One connected mailbox.
 *
 * Keyed by (tenant, user, provider, account) rather than by tenant alone: a
 * mailbox belongs to a PERSON, and two colleagues connecting the same workspace
 * must not overwrite one another's grant. Including `accountEmail` in the key is
 * what lets one user connect several mailboxes of the same provider.
 */
export const mailboxConnections = pgTable('mailbox_connections', {
  id:           serial('id').primaryKey(),
  tenantId:     integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  /** users.id — matches calendar_connections' width; intentionally no FK, so a
   *  deleted user's grant fails closed on refresh rather than cascading away the
   *  audit of what was connected. */
  userId:       varchar('user_id', { length: 64 }).notNull(),
  /** 'microsoft' | 'google' */
  provider:     varchar('provider', { length: 24 }).notNull(),
  accountEmail: varchar('account_email', { length: 320 }).notNull(),
  displayName:  varchar('display_name', { length: 255 }).notNull().default(''),
  /** Sealed `{ accessToken, refreshToken, expiresAt, scope }` — never a bare token. */
  tokenEnc:     text('token_enc').notNull(),
  tokenIv:      varchar('token_iv', { length: 64 }).notNull(),
  expiresAt:    timestamp('expires_at'),
  scope:        text('scope').notNull().default(''),
  /** 'connected' | 'expired' | 'revoked'. `revoked` is terminal until the user
   *  reconnects — it is what lets the UI say "reconnect" instead of failing every
   *  send with an opaque 401. */
  status:       varchar('status', { length: 16 }).notNull().default('connected'),
  lastError:    text('last_error'),
  lastSyncedAt: timestamp('last_synced_at'),
  /** False hides the mailbox from campaign sending while leaving it readable — a
   *  shared inbox you want on the canvas but must never blast a campaign from. */
  allowSending: boolean('allow_sending').notNull().default(true),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_mailbox_connections_account').on(t.tenantId, t.userId, t.provider, t.accountEmail),
  index('idx_mailbox_connections_tenant').on(t.tenantId, t.status),
]);

/**
 * Workspace-owned automation applied to messages read through a connected
 * mailbox. These are deliberately provider-neutral: a Gmail label rule and an
 * Exchange inbox rule have incompatible contracts, while the product promise is
 * that the same Builderforce agent can triage either mailbox.
 */
export const mailboxAutomationRules = pgTable('mailbox_automation_rules', {
  id:           serial('id').primaryKey(),
  tenantId:     integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  connectionId: integer('connection_id').notNull().references(() => mailboxConnections.id, { onDelete: 'cascade' }),
  name:         varchar('name', { length: 255 }).notNull(),
  enabled:      boolean('enabled').notNull().default(true),
  fromContains: varchar('from_contains', { length: 320 }).notNull().default(''),
  subjectContains: varchar('subject_contains', { length: 500 }).notNull().default(''),
  agentRef:     varchar('agent_ref', { length: 128 }),
  /** 'draft' | 'approval' | 'automatic' */
  responseMode: varchar('response_mode', { length: 16 }).notNull().default('draft'),
  instructions: text('instructions').notNull().default(''),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_mailbox_automation_rules_connection').on(t.tenantId, t.connectionId, t.enabled),
]);

/** Provider-neutral lifecycle of the reply produced for one matched message. */
export const mailboxAutomationReplies = pgTable('mailbox_automation_replies', {
  id:           serial('id').primaryKey(),
  tenantId:     integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  connectionId: integer('connection_id').notNull().references(() => mailboxConnections.id, { onDelete: 'cascade' }),
  ruleId:       integer('rule_id').notNull().references(() => mailboxAutomationRules.id, { onDelete: 'cascade' }),
  messageId:    varchar('message_id', { length: 512 }).notNull(),
  sender:       varchar('sender', { length: 500 }).notNull(),
  subject:      varchar('subject', { length: 500 }).notNull().default(''),
  status:       varchar('status', { length: 24 }).notNull().default('processing'),
  draftText:    text('draft_text'),
  approvalId:   varchar('approval_id', { length: 64 }),
  providerSentId: varchar('provider_sent_id', { length: 512 }),
  error:        text('error'),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_mailbox_automation_reply_message').on(t.tenantId, t.connectionId, t.messageId),
  index('idx_mailbox_automation_replies_tenant').on(t.tenantId, t.createdAt),
]);


// ═══ payouts (migration 0459) ═══
// A payout destination has NO table here. It is a `connections` row with
// capability='payout' and a `credentials` row holding the sealed credential —
// the kernel primitive, reached through PayoutAccountService. It was briefly a
// `payout_connections` table whose own comment called it "the SIXTH connection
// of the same shape"; `check-shape-lint` is the reason that sentence is now an
// argument against the table rather than a note beside it.


// ═══ developer portal / extension marketplace (PRD 24, migration 0467) ═══
//
// ── WHY THESE FIVE TABLES AND NOT MORE ──────────────────────────────────────
// Everything a third party could build for this platform lands in one of two
// buckets today: TENANT-PRIVATE (a tenant's own `connectors` row, its own
// `tenant_mcp_extensions` row) or CODE-OWNED (`defaults/`, `BOARD_PROVIDERS`,
// `dataProviderCatalog`, the drive/mailbox/payout/ledger ports). Neither reaches
// another customer, so a vendor's only routes are a pull request we have to merge
// or a workspace of one — which is why nobody builds. These tables are the third
// bucket: authored outside, reviewed by us, installable by any tenant.
//
// ── ONE ARTIFACT, KIND AS A COLUMN ──────────────────────────────────────────
// A published connector, a published MCP server and a published canvas kind are
// the same transaction — a versioned spec, reviewed once, installed under a scope
// grant, optionally sold. Three tables would be three copies of that transaction
// that drift, and the question a reviewer actually asks ("what is installed
// here?") would become three queries that disagree. So `kind` is a VALUE, exactly
// as `discipline` is on `field_jobs` and `builtin_kind` is on `ide_agents`.
//
// ── WHAT IS DELIBERATELY *NOT* HERE ─────────────────────────────────────────
// No price column, no order table, no payout row: a package sells as a
// `catalog_items` row through the rails `orders`/`payout` already own, and
// `catalog_item_id` is the id that points at it. No `installed_tools` table — an
// install's tools are its version's spec, read through `connectorRegistry`. No
// second scope vocabulary — a grant names scopes from the list `tenant_api_keys`
// already uses (`application/shared/scopeList.ts`).
//
// ── NOT TENANT-SCOPED, ON PURPOSE ───────────────────────────────────────────
// A publisher is not our customer, and the four publisher-side tables carry no
// `tenant_id` because there is no tenant that owns a published package — it is
// the same row for every tenant, which is the definition of a global catalogue.
// The tenancy lives on `tenant_extension_installs`, where the grant is. Both
// halves are declared in `check-tenant-column.mjs`'s TENANT_INDEPENDENT map, so
// this is a decision on the record rather than a missing column.

/**
 * A PUBLISHER — the vendor, agency or individual who ships extensions.
 *
 * A first-class party, deliberately distinct from a tenant: the company that
 * builds a payroll connector for us is not necessarily a customer of ours, and
 * their engineers are not members of anybody's workspace. Membership
 * (`developer_org_members`) is how a human reaches one, which is also why there
 * is no `tenant_id` here.
 *
 * `verificationState` is load-bearing rather than cosmetic. It gates the badge on
 * a listing AND the right to charge money, which is the trust half the open MCP
 * registries do not have — 10,000 public servers and no way to tell which one is
 * safe to install.
 */
export const developerOrgs = pgTable('developer_orgs', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  /** URL identity — `/developers/<slug>` and the listing byline. Immutable once published. */
  slug:               varchar('slug', { length: 80 }).notNull().unique(),
  legalName:          varchar('legal_name', { length: 200 }).notNull(),
  website:            text('website'),
  supportEmail:       varchar('support_email', { length: 255 }),
  /** `unverified` → `domain_verified` → `identity_verified`. See DEVELOPER_VERIFICATION_STATES. */
  verificationState:  varchar('verification_state', { length: 32 }).notNull().default('unverified'),
  /** The domain being claimed, and the one-time token the DNS TXT record must carry. */
  verificationDomain: varchar('verification_domain', { length: 255 }),
  verificationToken:  varchar('verification_token', { length: 64 }),
  verifiedAt:         timestamp('verified_at', { withTimezone: true }),
  /** Cross-domain id into `connections` (capability='payout'). Deliberately NOT a
   *  foreign key: payouts are the commerce domain's, and a schema import here
   *  would be this module reaching across a bounded context for a nullable link. */
  payoutConnectionId: uuid('payout_connection_id'),
  /** Set when we stand a publisher down. Suspension hides every listing at once. */
  suspendedAt:        timestamp('suspended_at', { withTimezone: true }),
  suspendedReason:    text('suspended_reason'),
  createdAt:          timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:          timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('idx_developer_orgs_state').on(t.verificationState),
]);

/**
 * Who may act for a publisher. `user_id` is a cross-domain id, not a foreign key
 * — identity owns `users`, and a membership row is how this context refers to one.
 */
export const developerOrgMembers = pgTable('developer_org_members', {
  id:              uuid('id').primaryKey().defaultRandom(),
  developerOrgId:  uuid('developer_org_id').notNull().references(() => developerOrgs.id, { onDelete: 'cascade' }),
  userId:          varchar('user_id', { length: 36 }).notNull(),
  /** `owner` (billing + suspension) · `admin` (members) · `publisher` (ship versions). */
  role:            varchar('role', { length: 24 }).notNull().default('publisher'),
  createdAt:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_developer_org_member').on(t.developerOrgId, t.userId),
  index('idx_developer_org_members_user').on(t.userId),
]);

/**
 * A PACKAGE — the thing a tenant installs, and the stable identity across versions.
 *
 * `slug` is unique platform-wide because it is what an install names and what a
 * URL addresses; a per-publisher slug would make two `stripe` packages
 * indistinguishable at the point of installing one.
 *
 * `currentVersionId` is the published head. It is a pointer rather than a copy of
 * the spec for the reason §3 keeps giving: a spec stored twice is a spec that
 * disagrees with itself the first time a version is rolled back.
 */
export const extensionPackages = pgTable('extension_packages', {
  id:               uuid('id').primaryKey().defaultRandom(),
  developerOrgId:   uuid('developer_org_id').notNull().references(() => developerOrgs.id, { onDelete: 'cascade' }),
  slug:             varchar('slug', { length: 100 }).notNull().unique(),
  /** `connector` · `mcp_server` · `canvas_kind` · `agent` · `skill` · `template`.
   *  A VALUE, not a table — see the block comment above. */
  kind:             varchar('kind', { length: 32 }).notNull(),
  name:             varchar('name', { length: 160 }).notNull(),
  tagline:          varchar('tagline', { length: 240 }).notNull().default(''),
  description:      text('description'),
  /** Catalog categories, reusing the public integration vocabulary. */
  categories:       jsonb('categories').$type<string[]>().notNull().default([]),
  iconUrl:          text('icon_url'),
  docsUrl:          text('docs_url'),
  /** `draft` (only the publisher sees it) · `listed` · `delisted`. */
  listingState:     varchar('listing_state', { length: 24 }).notNull().default('draft'),
  currentVersionId: uuid('current_version_id'),
  /** Cross-domain id into `catalog_items` — where price, plans and orders live.
   *  NULL means free. No price column here, deliberately: one fact, one place. */
  catalogItemId:    uuid('catalog_item_id'),
  installCount:     integer('install_count').notNull().default(0),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('idx_extension_packages_org').on(t.developerOrgId),
  index('idx_extension_packages_listed').on(t.listingState, t.kind),
]);

/**
 * One immutable submission of a package.
 *
 * `spec` is the payload whose meaning is decided by the package's `kind` — a
 * connector manifest, an MCP server descriptor, a canvas kind definition. It is
 * UNTRUSTED INPUT in exactly the sense `connectorManifest.ts` means it, and it is
 * re-parsed on every read for the same reason a tenant-authored manifest is: a
 * stored spec can outlive a contract change, and a skipped package is visible
 * where a half-understood one fails mid-call.
 *
 * `requestedScopes` is the security boundary. An install grants exactly these; a
 * version that widens them re-prompts the admin rather than inheriting the
 * previous grant, which is the whole reason the grant is stored per install.
 */
export const extensionVersions = pgTable('extension_versions', {
  id:              uuid('id').primaryKey().defaultRandom(),
  packageId:       uuid('package_id').notNull().references(() => extensionPackages.id, { onDelete: 'cascade' }),
  semver:          varchar('semver', { length: 32 }).notNull(),
  spec:            jsonb('spec').$type<Record<string, unknown>>().notNull(),
  requestedScopes: jsonb('requested_scopes').$type<string[]>().notNull().default([]),
  changelog:       text('changelog'),
  /** `pending` → `approved` | `rejected`. Set by the review pipeline, never by a publisher. */
  reviewState:     varchar('review_state', { length: 24 }).notNull().default('pending'),
  /** Every check the pipeline ran, with its verdict — the audit trail for an approval. */
  reviewFindings:  jsonb('review_findings').$type<Array<Record<string, unknown>>>().notNull().default([]),
  reviewedAt:      timestamp('reviewed_at', { withTimezone: true }),
  publishedAt:     timestamp('published_at', { withTimezone: true }),
  createdAt:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_extension_version_semver').on(t.packageId, t.semver),
  index('idx_extension_versions_review').on(t.reviewState),
]);

/**
 * An INSTALL — the grant, and the only tenant-scoped table in this set.
 *
 * `grantedScopes` is a snapshot of what the admin actually approved, not a
 * pointer at the version's request: the version is immutable but the NEXT one is
 * not, and a grant that followed the head would silently widen when the publisher
 * shipped. `connectionId` links the credential the tenant supplied at install
 * time, which lives sealed on the kernel's `credentials` exactly like every other
 * connector connection — no secret is stored here.
 */
export const tenantExtensionInstalls = pgTable('tenant_extension_installs', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenantId:       integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  packageId:      uuid('package_id').notNull().references(() => extensionPackages.id, { onDelete: 'cascade' }),
  versionId:      uuid('version_id').notNull().references(() => extensionVersions.id, { onDelete: 'restrict' }),
  grantedScopes:  jsonb('granted_scopes').$type<string[]>().notNull().default([]),
  /** Cross-domain id into `connector_connections` — where the sealed credential is. */
  connectionId:   uuid('connection_id'),
  installedByUserId: varchar('installed_by_user_id', { length: 36 }),
  /** Set instead of deleting: an uninstall must not orphan the call logs that
   *  reference it, and a reinstall should be able to see it happened before. */
  disabledAt:     timestamp('disabled_at', { withTimezone: true }),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_tenant_extension_install').on(t.tenantId, t.packageId),
  index('idx_tenant_extension_installs_tenant').on(t.tenantId, t.disabledAt),
]);
