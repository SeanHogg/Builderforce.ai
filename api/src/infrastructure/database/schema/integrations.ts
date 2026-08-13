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
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
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
