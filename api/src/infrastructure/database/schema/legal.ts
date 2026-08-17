/**
 * Schema — Legal, owned by **Counsel** (migration 0469).
 *
 * ── WHY A SEVENTEENTH SEAT ───────────────────────────────────────────────────
 * The roster gave `governance` to Security, and governance means SOC 2: controls,
 * findings, policies, vendor registers, evidence. That is the compliance posture
 * of a company that already exists. Nothing on the platform owned the acts that
 * make it exist and keep it existing — incorporating, appointing a registered
 * agent, qualifying to do business in a second state, assigning the founders' IP
 * to the company, filing a trademark, and renewing every one of those on a clock.
 *
 * Filing those under `governance` was the option considered and rejected, for the
 * reason bounded contexts exist: a SOC 2 control and a certificate of
 * incorporation are not the same kind of fact, they are not owned by the same
 * person, and a seat that holds both means two things. The Security agent's whole
 * brief — default-deny, restricted tickets, evidence collection — is the wrong
 * brief for "have we filed the annual report in Delaware". The register recorded
 * the current state as "neither", which is how the first ninety days of a company
 * came to have no home.
 *
 * ── WHAT IS DELIBERATELY *NOT* HERE ──────────────────────────────────────────
 * The counterparty is a `party_role`. The agreement itself is a `contract` canvas
 * object over the kernel's signature primitives. The signed artifact is an
 * `artifact`. A renewal warning is a `trigger` over a declared deadline field —
 * the `due-within` comparator already ships. A share class and an equity grant
 * are ownership and belong to the cap table when it exists, not to counsel. What
 * is left is the four facts nothing else on the platform holds: the ENTITY, where
 * it is REGISTERED, what it OWNS that is intangible, and the MATTER somebody is
 * currently arguing about.
 *
 * Every date-bearing row here carries a renewal or expiry column, because the
 * single most valuable thing a legal register does is tell you about a date
 * before it passes rather than after.
 *
 * No sibling imports beyond the kernel's `objects`, per PRD 20 §6.2.
 */

import {
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
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { objects } from './kernel';

/**
 * A legal entity the tenant owns — the company itself, and every subsidiary.
 *
 * More than one row is the normal case and the reason this is a table rather than
 * columns on `companies`: a US startup with a UK subsidiary has two entities, two
 * registered agents, two filing calendars and one cap table, and a single-row
 * model makes the second entity unrepresentable at exactly the moment it starts
 * costing money to get wrong.
 */
export const legalEntities = pgTable('legal_entities', {
  id:              serial('id').primaryKey(),
  tenantId:        integer('tenant_id').notNull(),
  objectId:        uuid('object_id').references(() => objects.id, { onDelete: 'set null' }),
  legalName:       varchar('legal_name', { length: 255 }).notNull(),
  /** 'c-corp' | 'llc' | 'ltd' | 'gmbh' | 'pty' | 'sole-trader' | 'partnership' | … */
  entityType:      varchar('entity_type', { length: 32 }).notNull(),
  /** Where it is INCORPORATED, which is frequently not where it operates —
   *  Delaware being the canonical case, and the distinction that makes the
   *  registrations table below necessary rather than redundant. */
  jurisdiction:    varchar('jurisdiction', { length: 96 }).notNull(),
  registrationNumber: varchar('registration_number', { length: 96 }),
  taxId:           varchar('tax_id', { length: 64 }),
  formedAt:        date('formed_at'),
  /** The agent of record. A missed service of process because nobody knew who the
   *  agent was is the failure this column exists for. */
  registeredAgent: varchar('registered_agent', { length: 255 }),
  registeredAddress: text('registered_address'),
  /** When the agent appointment or the entity's own standing lapses. */
  renewsAt:        date('renews_at'),
  /** 'active' | 'good-standing' | 'delinquent' | 'dissolved'. */
  status:          varchar('status', { length: 24 }).notNull().default('active'),
  /** True for the ONE entity that is the group parent. */
  isParent:        boolean('is_parent').notNull().default(false),
  parentId:        integer('parent_id'),
  notes:           text('notes'),
  createdAt:       timestamp('created_at').notNull().defaultNow(),
  updatedAt:       timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_legal_entities_name').on(t.tenantId, t.legalName, t.jurisdiction),
  index('idx_legal_entities_renewal').on(t.tenantId, t.renewsAt),
]);

/**
 * Permission to do business somewhere that is not where you incorporated.
 *
 * Foreign qualification, sales-tax registration, a professional licence, a data
 * protection registration. One row per (entity, jurisdiction, kind), each with its
 * own renewal date — which is the whole point: these lapse quietly, and the first
 * symptom of a lapsed one is usually a penalty.
 */
export const legalRegistrations = pgTable('legal_registrations', {
  id:            serial('id').primaryKey(),
  tenantId:      integer('tenant_id').notNull(),
  entityId:      integer('entity_id').references(() => legalEntities.id, { onDelete: 'cascade' }),
  jurisdiction:  varchar('jurisdiction', { length: 96 }).notNull(),
  /** 'foreign-qualification' | 'sales-tax' | 'payroll-tax' | 'licence' |
   *  'data-protection' | 'other'. */
  kind:          varchar('kind', { length: 32 }).notNull(),
  reference:     varchar('reference', { length: 96 }),
  registeredAt:  date('registered_at'),
  renewsAt:      date('renews_at'),
  /** 'active' | 'pending' | 'lapsed' | 'withdrawn'. */
  status:        varchar('status', { length: 16 }).notNull().default('pending'),
  ownerRef:      varchar('owner_ref', { length: 64 }),
  notes:         text('notes'),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_legal_registrations').on(t.tenantId, t.entityId, t.jurisdiction, t.kind),
  index('idx_legal_registrations_renewal').on(t.tenantId, t.renewsAt),
]);

/**
 * Intangible property the company owns or has applied for.
 *
 * Trademarks, patents, registered designs, copyrights and the domains that carry
 * the brand — one shape, because every one of them is "a right, in a
 * jurisdiction, in a class, with a filing date and a renewal date", and six
 * tables would be six copies of a renewal calendar.
 *
 * `assignedFrom` is the founder-IP-assignment column and the reason this table is
 * in the FIRST ninety days rather than the fifth year: work a founder did before
 * incorporation belongs to the founder until it is assigned, and a company that
 * cannot say which of its IP has been assigned has a diligence problem it will
 * discover during a raise.
 */
export const intellectualProperty = pgTable('intellectual_property', {
  id:            serial('id').primaryKey(),
  tenantId:      integer('tenant_id').notNull(),
  objectId:      uuid('object_id').references(() => objects.id, { onDelete: 'set null' }),
  entityId:      integer('entity_id').references(() => legalEntities.id, { onDelete: 'set null' }),
  /** 'trademark' | 'patent' | 'design' | 'copyright' | 'domain' | 'trade-secret'. */
  kind:          varchar('kind', { length: 24 }).notNull(),
  title:         varchar('title', { length: 255 }).notNull(),
  jurisdiction:  varchar('jurisdiction', { length: 96 }),
  /** Nice classes for a mark, IPC for a patent — the classification the filing was
   *  made under, verbatim. */
  classification: varchar('classification', { length: 96 }),
  registrationNumber: varchar('registration_number', { length: 96 }),
  filedAt:       date('filed_at'),
  grantedAt:     date('granted_at'),
  renewsAt:      date('renews_at'),
  /** 'idea' | 'filed' | 'pending' | 'registered' | 'opposed' | 'lapsed' | 'abandoned'. */
  status:        varchar('status', { length: 16 }).notNull().default('idea'),
  /** Who it was assigned FROM — a founder, a contractor, an acquired company.
   *  Empty means unassigned, which is a finding and not a blank. */
  assignedFrom:  varchar('assigned_from', { length: 200 }),
  assignedAt:    date('assigned_at'),
  ownerRef:      varchar('owner_ref', { length: 64 }),
  notes:         text('notes'),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_intellectual_property_kind').on(t.tenantId, t.kind, t.status),
  index('idx_intellectual_property_renewal').on(t.tenantId, t.renewsAt),
]);

/**
 * An open legal question with a cost and a counterparty.
 *
 * A dispute, a piece of advice being sought, a diligence request, a regulatory
 * enquiry. Distinct from `governance.findings` — a finding is a control that
 * failed, a matter is a thing being ARGUED — and distinct from a support ticket
 * for the reason `case` is distinct in the people vocabulary: it names an adverse
 * party and it accrues external spend.
 */
export const legalMatters = pgTable('legal_matters', {
  id:            serial('id').primaryKey(),
  tenantId:      integer('tenant_id').notNull(),
  objectId:      uuid('object_id').references(() => objects.id, { onDelete: 'set null' }),
  entityId:      integer('entity_id').references(() => legalEntities.id, { onDelete: 'set null' }),
  title:         varchar('title', { length: 255 }).notNull(),
  /** 'advice' | 'dispute' | 'diligence' | 'regulatory' | 'employment' |
   *  'transaction'. */
  kind:          varchar('kind', { length: 24 }).notNull().default('advice'),
  /** `party_roles.party_ref` for the other side, where there is one. */
  counterpartyRef: varchar('counterparty_ref', { length: 64 }),
  counterpartyName: varchar('counterparty_name', { length: 200 }),
  /** External counsel of record. */
  counsel:       varchar('counsel', { length: 200 }),
  ownerRef:      varchar('owner_ref', { length: 64 }),
  /** 'open' | 'advice-received' | 'settled' | 'closed' | 'escalated'. */
  status:        varchar('status', { length: 24 }).notNull().default('open'),
  /** 'low' | 'medium' | 'high' | 'existential'. */
  exposure:      varchar('exposure', { length: 16 }),
  /** Estimated financial exposure, and what has actually been spent so far. Two
   *  numbers because they answer different questions and a single "cost" column
   *  ends up meaning whichever the last writer intended. */
  exposureAmount: numeric('exposure_amount', { precision: 16, scale: 2 }),
  spendToDate:   numeric('spend_to_date', { precision: 16, scale: 2 }),
  currency:      varchar('currency', { length: 8 }).notNull().default('USD'),
  openedAt:      date('opened_at'),
  /** The next date this matter is JUDGED against — a filing deadline, a hearing,
   *  a response-by. Watchable by a `trigger`, which is the point of storing it. */
  nextActionAt:  date('next_action_at'),
  closedAt:      date('closed_at'),
  /** Milestones: [{at, event, note}]. Not `activity_log`, because a matter's
   *  chronology is EDITABLE — counsel corrects a date after the fact — and an
   *  append-only audit stream must never allow that. */
  timeline:      jsonb('timeline'),
  notes:         text('notes'),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_legal_matters_status').on(t.tenantId, t.status, t.nextActionAt),
]);

/**
 * A stored, encrypted legal FILE — an uploaded NDA, a formation certificate, an
 * executed IP assignment — as distinct from `contract` (canvas-board JSON with
 * no backing table, per that kind's own note) and from the unrelated
 * `legal_documents` in the kernel (the platform's own Terms of Use / Privacy
 * Policy versioning, migration 0012 — a name already taken, which is why this
 * table is `legal_document_files`).
 *
 * Holds no file bytes itself: `currentArtifactId` points at a `kernel.artifacts`
 * row (R2 storage key + checksum + mime), sealed at rest by `fileCrypto.ts`. The
 * reference is a PLAIN uuid rather than a Drizzle `.references()` — `artifacts`
 * lives in `kernel.ts` and this module's own header rule is no sibling imports
 * beyond `objects` — but the constraint is real at the DATABASE level, declared
 * in the migration, the same split `tenant_id` uses one file up.
 *
 * Re-uploading NEVER overwrites `currentArtifactId` in place: it points the
 * column at a NEW `artifacts` row and the old one stays exactly as it was —
 * which is what lets a completed signature keep resolving to the artifact it
 * actually signed after a later version replaces the file on the card.
 *
 * No `status` or `signedAt` column, deliberately: whether this file is shared,
 * awaiting signature or signed is derived at read time from
 * `legal_document_shares` and the `signature_requests` row `signatureRequestId`
 * points at — storing it here would be the exact drift `contract.signatureState`
 * avoids by being written FROM that same join rather than asserted independently.
 */
export const legalDocumentFiles = pgTable('legal_document_files', {
  id:            uuid('id').primaryKey().defaultRandom(),
  tenantId:      integer('tenant_id').notNull(),
  objectId:      uuid('object_id').references(() => objects.id, { onDelete: 'set null' }),
  entityId:      integer('entity_id').references(() => legalEntities.id, { onDelete: 'set null' }),
  matterId:      integer('matter_id').references(() => legalMatters.id, { onDelete: 'set null' }),
  ipId:          integer('ip_id').references(() => intellectualProperty.id, { onDelete: 'set null' }),
  title:         varchar('title', { length: 255 }).notNull(),
  /** 'nda' | 'msa' | 'sow' | 'offer_letter' | 'ip_assignment' | 'formation' |
   *  'registration' | 'other'. */
  category:      varchar('category', { length: 32 }).notNull().default('other'),
  /** The latest `artifacts.id` — the sealed file bytes. Real FK declared in the
   *  migration; see the table note for why not here. */
  currentArtifactId: uuid('current_artifact_id'),
  /** The `signature_requests.id` this file's signature flow created, if any —
   *  same cross-module split as `currentArtifactId`. */
  signatureRequestId: integer('signature_request_id'),
  createdBy:     varchar('created_by', { length: 64 }),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_legal_document_files_tenant').on(t.tenantId, t.updatedAt),
  index('idx_legal_document_files_entity').on(t.entityId),
  index('idx_legal_document_files_matter').on(t.matterId),
]);

/**
 * A revocable link that lets an external counterparty — no account, no session
 * — view or download one `legal_document_files` row. Same mint/hash/resolve
 * shape as `signature_parties.tokenHash` and `form_recipients.tokenHash`
 * (`shareToken.ts`), for the THIRD time now a genuinely repeated pattern.
 *
 * Deliberately separate from the signing flow: a document can be shared for
 * review before anyone is asked to sign it, and a signature's own token
 * (`signature_parties.tokenHash`) already governs the signing act itself — this
 * table governs plain read access.
 */
export const legalDocumentShares = pgTable('legal_document_shares', {
  id:            uuid('id').primaryKey().defaultRandom(),
  tenantId:      integer('tenant_id').notNull(),
  documentId:    uuid('document_id').notNull().references(() => legalDocumentFiles.id, { onDelete: 'cascade' }),
  tokenHash:     varchar('token_hash', { length: 64 }).notNull(),
  /** 'view' | 'download'. */
  permission:    varchar('permission', { length: 16 }).notNull().default('view'),
  recipientEmail: varchar('recipient_email', { length: 320 }),
  expiresAt:     timestamp('expires_at'),
  revokedAt:     timestamp('revoked_at'),
  createdBy:     varchar('created_by', { length: 64 }),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_legal_document_shares_token').on(t.tokenHash),
  index('idx_legal_document_shares_document').on(t.documentId),
]);

// ---------------------------------------------------------------------------
// Co-founder matching (FO-D5's matching half)
// ---------------------------------------------------------------------------
//
// WHY THIS IS FILED UNDER LEGAL AND NOT HIRING. A co-founder is not a hire —
// there is no requisition, no offer, no salary and no manager, and modelling one
// as a `candidate` would put a peer into a funnel that ends in an employment
// relationship. The thing two co-founders actually produce is FORMATION
// paperwork: a founders' agreement, an IP assignment and a vesting schedule, all
// of which are `legal_entities` and `intellectual_property` above. So the
// matching sits beside the paperwork it leads to.
//
// The PAPERWORK half is deliberately not duplicated here: a founders' agreement
// is a `contract` signed through the kernel's signature primitives, and a
// separate founder-agreement table would be a second answer to "is it signed".

/**
 * One person's declaration that they are looking for a co-founder.
 *
 * Cross-tenant by construction: the entire value is meeting somebody who is NOT
 * already in your workspace. `visibility` is the access predicate that makes the
 * discovery read legitimate — the same argument `catalog_items` makes for a
 * public listing — so a private profile is invisible to discovery and a public
 * one is opt-in, explicit and revocable in one column.
 */
export const cofounderProfiles = pgTable('cofounder_profiles', {
  id:            serial('id').primaryKey(),
  tenantId:      integer('tenant_id').notNull(),
  userId:        varchar('user_id', { length: 36 }).notNull(),
  headline:      varchar('headline', { length: 200 }).notNull(),
  bio:           text('bio'),
  /** What the AUTHOR is: the half of the company they already cover. */
  strength:      varchar('strength', { length: 24 }).notNull(),
  /** What they are LOOKING FOR. Stored separately from `strength` rather than
   *  inferred as its complement, because "technical founder seeking technical
   *  co-founder" is a real and common search and a complement rule would make it
   *  unrepresentable. */
  seeking:       varchar('seeking', { length: 24 }).notNull(),
  /** Skills brought and skills needed — chips, matched pairwise by the scorer. */
  brings:        jsonb('brings'),
  needs:         jsonb('needs'),
  /** 'full-time' | 'part-time' | 'nights-weekends' | 'advisory'. The single
   *  largest cause of a co-founder split, and the cheapest to state up front. */
  commitment:    varchar('commitment', { length: 24 }).notNull().default('full-time'),
  /** Equity the author expects, as a percentage. A range would be two columns
   *  pretending to be a negotiation; one honest number is what makes a mismatch
   *  visible before either party has spent six months on it. */
  equityExpectation: numeric('equity_expectation', { precision: 5, scale: 2 }),
  location:      varchar('location', { length: 120 }),
  remoteOk:      boolean('remote_ok').notNull().default(true),
  sectors:       jsonb('sectors'),
  /** 'idea' | 'prototype' | 'launched' | 'revenue'. */
  stage:         varchar('stage', { length: 24 }),
  /** 'open' | 'paused' | 'matched'. */
  status:        varchar('status', { length: 16 }).notNull().default('open'),
  /** 'private' | 'public'. The access predicate for the cross-tenant read. */
  visibility:    varchar('visibility', { length: 16 }).notNull().default('private'),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_cofounder_profiles_user').on(t.tenantId, t.userId),
  index('idx_cofounder_profiles_discovery').on(t.visibility, t.status, t.updatedAt),
]);

/**
 * One person asking to be introduced to another.
 *
 * An introduction and not a "match": the scorer RANKS, a human ASKS, and the
 * other human answers. A product that manufactured mutual matches out of a
 * similarity score would be asserting an agreement neither party gave — the same
 * defect the approval gate exists to stop, in a different currency.
 */
export const cofounderIntroductions = pgTable('cofounder_introductions', {
  id:            serial('id').primaryKey(),
  tenantId:      integer('tenant_id').notNull(),
  fromProfileId: integer('from_profile_id').notNull().references(() => cofounderProfiles.id, { onDelete: 'cascade' }),
  toProfileId:   integer('to_profile_id').notNull().references(() => cofounderProfiles.id, { onDelete: 'cascade' }),
  message:       text('message'),
  /** The score at the moment of asking. Kept so a later ranking change cannot
   *  rewrite why an introduction was made. */
  scoreAtRequest: integer('score_at_request'),
  /** 'requested' | 'accepted' | 'declined' | 'withdrawn'. */
  status:        varchar('status', { length: 16 }).notNull().default('requested'),
  requestedAt:   timestamp('requested_at').notNull().defaultNow(),
  respondedAt:   timestamp('responded_at'),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_cofounder_introductions').on(t.fromProfileId, t.toProfileId),
  index('idx_cofounder_introductions_to').on(t.toProfileId, t.status),
]);
