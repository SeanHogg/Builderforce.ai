/**
 * Schema — Customer Discovery, part of the founder's journey (§ Idea).
 *
 * Two root entities: a conversation with a real person (`customer_interviews`)
 * and a note toward answering the idea's own question (`research_notes`).
 * Neither belongs to an existing table: hiring's `interviews` is candidate
 * recruiting (wrong bounded context — a different noun wearing the same
 * word), the investor domain's `companies` is the business itself rather than
 * evidence about whether it should exist, and Knowledge's SOP/doc table
 * carries versioning and read-ack semantics a raw interview transcript does
 * not want. Both tables here are intentionally small and structurally
 * identical to each other, following the `tenantId`/`segmentId`/`projectId`
 * scoping tuple `delivery.ts` already uses for project-adjacent work items.
 *
 * `projectId` carries NO `.references()` — matching migration 1120's own
 * precedent for `projects.company_id`: a `.references(() => projects.id)` on
 * a Drizzle column would open a `discovery.ts -> delivery.ts` schema edge
 * `check-domain-boundary` counts, for a pointer the database enforces either
 * way. The FK is declared in the raw migration SQL instead (1122/1123).
 */

import { integer, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { tenants, segments, users } from './identity';

export const customerInterviews = pgTable('customer_interviews', {
  id:              uuid('id').primaryKey().defaultRandom(),
  tenantId:        integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:       uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  // NO `.references(() => projects.id)` — see the header comment: the FK is
  // declared in the raw migration SQL instead, to keep this module from
  // opening a `discovery.ts -> delivery.ts` schema edge.
  projectId:       integer('project_id'),
  title:           varchar('title', { length: 255 }).notNull(),
  participantName: varchar('participant_name', { length: 255 }),
  notes:           text('notes'),
  createdBy:       varchar('created_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  createdAt:       timestamp('created_at').notNull().defaultNow(),
  updatedAt:       timestamp('updated_at').notNull().defaultNow(),
});

export const researchNotes = pgTable('research_notes', {
  id:         uuid('id').primaryKey().defaultRandom(),
  tenantId:   integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:  uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  projectId:  integer('project_id'),
  title:      varchar('title', { length: 255 }).notNull(),
  sourceUrl:  varchar('source_url', { length: 500 }),
  body:       text('body'),
  createdBy:  varchar('created_by', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
});
