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


// ═══ developer portal / extension marketplace (PRD 24, migrations 0467 + 0472) ═══
//
// ── WHY THESE THREE TABLES AND NOT MORE ─────────────────────────────────────
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
// ── AND THE PUBLISHER IS A TENANT (0472) ────────────────────────────────────
// 0467 shipped `developer_orgs` + `developer_org_members` as a party model beside
// the one that already existed, on the argument that a vendor is not necessarily a
// customer. That was rejected: a developer IS a tenant. The publisher's identity,
// verification state and suspension are now a FACET on `tenants` (nine columns,
// all 1:1 with the row), its staff are `tenant_members`, and its credential is a
// `tenant_api_keys` row. Two of the five tables here went away as a result, and so
// did the third answer to "who may act for this vendor?".
//
// ── WHAT IS DELIBERATELY *NOT* HERE ─────────────────────────────────────────
// No price column, no order table, no payout row: a package sells as a
// `catalog_items` row through the rails `orders`/`payout` already own, and
// `catalog_item_id` is the id that points at it. No `installed_tools` table — an
// install's tools are its version's spec, read through `connectorRegistry`. No
// second scope vocabulary — a grant names scopes from the list `tenant_api_keys`
// already uses (`application/shared/scopeList.ts`).
//
// ── TENANCY: OWNER vs AUDIENCE ──────────────────────────────────────────────
// `extension_packages.tenant_id` is the PUBLISHER's workspace — who owns and may
// edit the listing — not who may see it. A listed package is readable by every
// tenant, which is what publishing means, so the catalogue reads declare
// themselves with `acrossTenants(..., 'public_catalogue', ...)` rather than
// filtering by the caller's tenant. `extension_versions` inherits tenancy through
// its package (declared in `check-tenant-column.mjs`), and
// `tenant_extension_installs` is scoped to the INSTALLING tenant, which is a
// different tenant from the publisher's and the reason both columns exist.

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
  /** The PUBLISHER's workspace — who owns the listing. Not who may install it. */
  tenantId:         integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
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
  index('idx_extension_packages_tenant').on(t.tenantId),
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

// ═══ LTI 1.3 — the LMS a course actually runs in ═══════════════════════════

/**
 * One LTI 1.3 platform registration.
 *
 * Was the `LTI_REGISTRATIONS` JSON secret, and moved here by migration 0480 for
 * the reason that migration argues: the objection to a table was that a
 * registration holds an RSA private key and the generic entity reader redacts by
 * column-name pattern. Sealing the key in the `credentialCrypto` envelope removes
 * the objection rather than arguing with it — what is stored is ciphertext, and a
 * projection that forgot to redact it emits base64 nobody can use.
 *
 * `(issuer, clientId)` is the identity, and `deploymentIds` is checked on every
 * launch: one issuer — `https://canvas.instructure.com` is shared by every Canvas
 * Cloud institution — hosts many deployments, and matching on issuer alone would
 * let one university's LMS launch into another's boards.
 */
export const ltiRegistrations = pgTable('lti_registrations', {
  id:                serial('id').primaryKey(),
  tenantId:          integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  /** What an administrator recognises. Never used for matching. */
  label:             varchar('label', { length: 160 }).notNull(),
  issuer:            varchar('issuer', { length: 255 }).notNull(),
  clientId:          varchar('client_id', { length: 255 }).notNull(),
  deploymentIds:     jsonb('deployment_ids').$type<string[]>().notNull().default([]),
  authLoginUrl:      text('auth_login_url').notNull(),
  accessTokenUrl:    text('access_token_url').notNull(),
  keySetUrl:         text('key_set_url').notNull(),
  /** Published on /api/lti/jwks so the platform can verify our client assertion. */
  toolKeyId:         varchar('tool_key_id', { length: 64 }).notNull(),
  /** The PUBLIC half, in the clear on purpose: /api/lti/jwks serves it to the
   *  world. Stored beside the sealed private half — and DERIVED from it at write
   *  time — so publishing and matching a launch never decrypt anything, and the
   *  two halves cannot drift into an `invalid_client` with no further detail. */
  toolPublicJwk:     jsonb('tool_public_jwk').$type<Record<string, unknown>>().notNull(),
  /** AES-256-GCM ciphertext of `{ jwk }`. NEVER plaintext, NEVER in a response. */
  toolPrivateKeyEnc: text('tool_private_key_enc').notNull(),
  toolPrivateKeyIv:  varchar('tool_private_key_iv', { length: 32 }).notNull(),
  /** 'active' | 'disabled'. Disabling retires a registration without destroying
   *  the audit of the launches it authorised. */
  status:            varchar('status', { length: 16 }).notNull().default('active'),
  createdBy:         varchar('created_by', { length: 64 }),
  createdAt:         timestamp('created_at').notNull().defaultNow(),
  updatedAt:         timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_lti_registrations_issuer_client').on(t.issuer, t.clientId),
  index('idx_lti_registrations_tenant').on(t.tenantId, t.status),
]);

/**
 * One LMS course context ↔ one canvas board.
 *
 * The decision migration 0481 records: a launch RESUMES the board bound to its
 * course and creates one on first launch. Keyed on the COURSE and not the
 * resource link, because a course-navigation launch and an assignment launch are
 * two doors into the same module — a board per link would give one cohort two
 * rosters that drift apart.
 */
export const ltiContextBindings = pgTable('lti_context_bindings', {
  id:              serial('id').primaryKey(),
  tenantId:        integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  registrationId:  integer('registration_id').notNull().references(() => ltiRegistrations.id, { onDelete: 'cascade' }),
  issuer:          varchar('issuer', { length: 255 }).notNull(),
  deploymentId:    varchar('deployment_id', { length: 255 }).notNull(),
  contextId:       varchar('context_id', { length: 255 }).notNull(),
  /** Frozen at first launch, so a renamed board still says where it came from. */
  contextLabel:    varchar('context_label', { length: 255 }),
  contextTitle:    varchar('context_title', { length: 255 }),
  /** Cross-domain id into `creation_sessions` — the board a launch lands on. */
  sessionId:       uuid('session_id').notNull(),
  /** The `cohort` object that carries `ltiIssuer` / `ltiMembershipsUrl`. */
  cohortObjectId:  uuid('cohort_object_id'),
  /** NRPS. Null when the platform did not grant the roster scope. */
  membershipsUrl:  text('memberships_url'),
  createdAt:       timestamp('created_at').notNull().defaultNow(),
  updatedAt:       timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_lti_context_bindings_context').on(t.issuer, t.deploymentId, t.contextId),
  index('idx_lti_context_bindings_tenant').on(t.tenantId, t.sessionId),
]);

/**
 * One LMS resource link ↔ one `assignment` object on the course's board.
 *
 * This is where `ltiLineItemUrl` comes from, which is what `submission.mark`
 * pushes a score through. A second link in the same course adds an object; it
 * never adds a board.
 */
export const ltiResourceBindings = pgTable('lti_resource_bindings', {
  id:                 serial('id').primaryKey(),
  tenantId:           integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  bindingId:          integer('binding_id').notNull().references(() => ltiContextBindings.id, { onDelete: 'cascade' }),
  resourceLinkId:     varchar('resource_link_id', { length: 255 }).notNull(),
  resourceLinkTitle:  varchar('resource_link_title', { length: 255 }),
  assignmentObjectId: uuid('assignment_object_id'),
  /** AGS. Null when the platform did not grant the score scope — which is exactly
   *  when `submission.mark` must NOT claim it pushed a grade back. */
  lineItemUrl:        text('line_item_url'),
  createdAt:          timestamp('created_at').notNull().defaultNow(),
  updatedAt:          timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_lti_resource_bindings_link').on(t.bindingId, t.resourceLinkId),
]);
