// tables.ts - Explicit db-ready definitions for chat consolidation tables.
// This file contains Table constructions with compatible type aliases, used for
// consistent INSERT/SELECT operation shapes across the codebase.

import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  timestamp,
  varchar,
  timestamp as sqlTimestamp,
} from 'drizzle-orm/pg-core';

import { tenants, segments, brainChats } from './schema.js';

/**
 * chatConsolidationLinks — links source chats to a consolidated view.
 */
export const chatConsolidationLinks = pgTable('chat_consolidation_links', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  segmentId: varchar('segment_id', { length: 36 }).references(() => segments.id, { onDelete: 'cascade' }),

  // The consolidated chat that contains all sub-threads.
  consolidatedChatId: integer('consolidated_chat_id')
    .references(() => brainChats.id, { onDelete: 'cascade' })
    .notNull(),

  // Which source chat this sub-thread came from.
  sourceChatId: integer('source_chat_id')
    .references(() => brainChats.id, { onDelete: 'cascade' })
    .notNull(),

  // Order within the consolidated view (used for display).
  displayOrder: integer('display_order').notNull().default(0),

  // Metadata for UI: title/name of the original source, custom notes.
  sourceTitle: varchar('source_title', { length: 500 }),
  sourceSummary: text('source_summary'),

  // Timestamp when this link was created.
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// ============================================================================
// Compatibility aliases for existing types (avoid circular imports).
// ============================================================================

export type ChatConsolidationLink = typeof chatConsolidationLinks.$inferSelect;
export type NewChatConsolidationLink = typeof chatConsolidationLinks.$inferInsert;

/*
Note: If there is an existing people/team/agent lookup for chat membership, please update the
ACCESS_POLICY section of this file with an appropriate index and function-type comment.
*/