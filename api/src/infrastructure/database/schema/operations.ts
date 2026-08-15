/**
 * Schema — Field operations, owned by **Operations** (PRD 20 §3).
 *
 * Root entity `work_order`. The sixteenth seat, and the first added since the
 * roster was drawn — so it is worth recording why the fifteen were not enough.
 *
 * ── THE GAP ─────────────────────────────────────────────────────────────────
 * Every one of the fifteen models how a company runs ITSELF: raise (`investor`),
 * market (`growth`), sell (`revenue`), hire (`hiring`), employ (`people`), pay
 * (`finance`), ship software (`delivery`), answer tickets (`support`). Not one
 * models what the company DOES for the customer who pays it. That is fine for a
 * horizontal SaaS, whose product IS the software, and fatal for the niche
 * verticals — field service, trades, property, facilities, clinics, fleet,
 * logistics, manufacturing, professional practice — which is where most
 * companies actually are.
 *
 * `delivery` looks like the home for it and is not: its vocabulary is
 * `work_item` / `sprint` / `release`, the software backlog. A boiler repair is
 * not a sprint item, and filing it as one would put a customer's SLA in a
 * burndown chart. `commerce` is the marketplace (listing, order, gig, booking).
 * `support` is the ticket ABOUT the work, not the work.
 *
 * ── ONE DOMAIN, NOT ONE PER INDUSTRY ────────────────────────────────────────
 * The six industries above share one shape: WORK ordered against an ASSET,
 * executed at a scheduled VISIT, evidenced by an INSPECTION, permitted by a
 * CERTIFICATION, consuming PARTS. The industry is a `discipline` VALUE on the
 * row, never a table — §3.1's "a new kind is a column value" applied at the
 * level the whole domain sits at. The canvas vocabulary
 * (`frontend/src/lib/operationsObjects.ts`) makes the same argument at greater
 * length, and uses these column names deliberately so the board and the system
 * of record speak one language.
 *
 * ── WHAT THE KERNEL ALREADY OWNS, AND IS NOT FORKED HERE ────────────────────
 * The customer is a `party_role`. The engineer is a `user`. A photo is an
 * `artifact`. A conversation about a job is a `thread` + `messages`. An
 * approval is the kernel's, an audit line is `activity_log`, and money leaving
 * for a purchase order is a `ledger_entry`. Twelve tables is what is LEFT after
 * that subtraction — the facts nothing else on the platform holds.
 *
 * NO SIBLING IMPORTS beyond the kernel.
 *
 * See migration 0464.
 */

import {
  boolean,
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
 * The physical or managed thing work is done TO.
 *
 * First because it is the only row here with a life longer than any single job,
 * and it is what makes the operation's most valuable question answerable at
 * all: what does this asset cost us a year, and is it cheaper to replace.
 */
export const serviceAssets = pgTable('service_assets', {
  id:            serial('id').primaryKey(),
  tenantId:      integer('tenant_id').notNull(),
  objectId:      uuid('object_id').references(() => objects.id, { onDelete: 'cascade' }),
  /** What is written on the asset itself — the plate, the sticker, the unit number. */
  assetTag:      varchar('asset_tag', { length: 64 }).notNull(),
  name:          varchar('name', { length: 200 }).notNull(),
  /** Free text in the tenant's own words: "commercial gas boiler", "HGV tractor". */
  assetClass:    varchar('asset_class', { length: 96 }),
  /** The trade this belongs to. THE column that makes one domain serve every
   *  vertical — see the header. Free-form varchar rather than an enum because a
   *  thirteenth industry must not need a migration. */
  discipline:    varchar('discipline', { length: 32 }).notNull().default('other'),
  /** Who it belongs to — a `party_roles` id. An id, never a joined table: §3's
   *  cross-domain rule applies to rows exactly as it does to services. */
  customerRef:   varchar('customer_ref', { length: 64 }),
  siteName:      varchar('site_name', { length: 200 }),
  siteAddress:   text('site_address'),
  /** How to get in. The field that turns a wasted journey into a completed job. */
  accessNotes:   text('access_notes'),
  makeModel:     varchar('make_model', { length: 200 }),
  serialNumber:  varchar('serial_number', { length: 120 }),
  /** 'critical' | 'important' | 'routine'. Drives priority when two jobs compete
   *  for one engineer. */
  criticality:   varchar('criticality', { length: 16 }).notNull().default('routine'),
  /** 'in_service' | 'out_of_service' | 'retired'. */
  status:        varchar('status', { length: 24 }).notNull().default('in_service'),
  installedAt:   timestamp('installed_at'),
  warrantyUntil: timestamp('warranty_until'),
  /** 0–100 from the most recent inspection. Nullable on purpose: an unassessed
   *  asset must read as unassessed, never as zero — a zero is a condemnation. */
  conditionScore: integer('condition_score'),
  /** Hours, miles or cycles, with the unit beside it, because usage-based
   *  servicing is scheduled against whichever the machine counts. */
  meterReading:  numeric('meter_reading', { precision: 14, scale: 2 }),
  meterUnit:     varchar('meter_unit', { length: 24 }),
  nextServiceAt: timestamp('next_service_at'),
  retiredAt:     timestamp('retired_at'),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_service_assets_tag').on(t.tenantId, t.assetTag),
  index('idx_service_assets_status').on(t.tenantId, t.status, t.discipline, t.updatedAt),
  index('idx_service_assets_due').on(t.tenantId, t.nextServiceAt),
]);

/**
 * One unit of committed work — the seat's root entity.
 *
 * Reactive repair, planned maintenance, installation, warranty and callback are
 * one table with an `order_type`, because they share a lifecycle, a costing and
 * a backlog. Splitting them splits the backlog, which is the one thing a service
 * business must be able to see whole.
 */
export const workOrders = pgTable('work_orders', {
  id:            serial('id').primaryKey(),
  tenantId:      integer('tenant_id').notNull(),
  objectId:      uuid('object_id').references(() => objects.id, { onDelete: 'cascade' }),
  /** The reference quoted on the phone and printed on the invoice. */
  reference:     varchar('reference', { length: 48 }).notNull(),
  title:         varchar('title', { length: 300 }).notNull(),
  /** 'reactive' | 'planned' | 'installation' | 'warranty' | 'callback' | 'inspection'.
   *  `callback` earns its place: it is the number that says whether the first
   *  visit actually fixed anything. */
  orderType:     varchar('order_type', { length: 24 }).notNull().default('reactive'),
  discipline:    varchar('discipline', { length: 32 }).notNull().default('other'),
  /** 'emergency' | 'urgent' | 'routine' | 'scheduled'. */
  priority:      varchar('priority', { length: 16 }).notNull().default('routine'),
  /** 'new' | 'triaged' | 'scheduled' | 'in_progress' | 'awaiting_parts' | 'completed' | 'cancelled'. */
  status:        varchar('status', { length: 24 }).notNull().default('new'),
  assetId:       integer('asset_id').references(() => serviceAssets.id, { onDelete: 'set null' }),
  agreementId:   integer('agreement_id').references(() => serviceAgreements.id, { onDelete: 'set null' }),
  customerRef:   varchar('customer_ref', { length: 64 }),
  /** What the customer actually said, in their words — not the diagnosis. The
   *  two disagreeing is itself diagnostic. */
  reportedFault: text('reported_fault'),
  /** What was wrong and what fixed it. The paragraph the next engineer reads. */
  resolution:    text('resolution'),
  slaDueAt:      timestamp('sla_due_at'),
  /** `user` ids. A jsonb list rather than a join table because assignment is
   *  read with the order every single time and never queried independently. */
  assignedRefs:  jsonb('assigned_refs'),
  /** Parts consumed: [{part, quantity, cost}]. Held here rather than as rows
   *  because they are written once at completion and always read with the job. */
  partsUsed:     jsonb('parts_used'),
  labourHours:   numeric('labour_hours', { precision: 8, scale: 2 }),
  /** Minor units, matching every other money column in the schema. */
  labourRateCents: integer('labour_rate_cents'),
  /** 'billable' | 'agreement' | 'warranty' | 'goodwill'. Goodwill is a decision
   *  somebody made and must be visible, not a silent write-off. */
  billingBasis:  varchar('billing_basis', { length: 16 }).notNull().default('billable'),
  /**
   * Whether it was fixed on the FIRST visit — the domain's headline metric.
   *
   * DERIVED, and recomputed from `work_order_visits` by `operationsRollup.ts` on
   * every sweep. The generic entity writer can set any writable column, so a
   * client CAN assert this one; what the rollup guarantees is that an asserted
   * value is CORRECTED rather than trusted. Saying "never written by a client"
   * would be a comment the code does not enforce, which is worse than the gap.
   *
   * Null means not yet knowable — an order with no recorded attendance is absent
   * from the rate rather than counted as a failure.
   */
  firstTimeFix:  boolean('first_time_fix'),
  completedAt:   timestamp('completed_at'),
  cancelledAt:   timestamp('cancelled_at'),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_work_orders_reference').on(t.tenantId, t.reference),
  index('idx_work_orders_status').on(t.tenantId, t.status, t.priority, t.slaDueAt),
  index('idx_work_orders_asset').on(t.tenantId, t.assetId, t.updatedAt),
]);

/**
 * WHEN and BY WHOM, on the ground.
 *
 * Its own table rather than columns on the order because one order routinely
 * needs several visits — a return trip for a part is the commonest event in
 * field service — and a single-appointment model cannot represent that without
 * lying about first-time fix, which is the number it exists to measure.
 */
export const workOrderVisits = pgTable('work_order_visits', {
  id:              serial('id').primaryKey(),
  tenantId:        integer('tenant_id').notNull(),
  workOrderId:     integer('work_order_id').notNull().references(() => workOrders.id, { onDelete: 'cascade' }),
  /** The attending engineer, as a `user` ref. One per visit: two engineers is
   *  two visits or a crew, and pretending otherwise makes capacity uncountable. */
  engineerRef:     varchar('engineer_ref', { length: 64 }),
  scheduledStart:  timestamp('scheduled_start'),
  /** The window the CUSTOMER was promised — distinct from the scheduled start,
   *  because the promise is what a missed appointment is judged against. */
  arrivalFrom:     timestamp('arrival_from'),
  arrivalUntil:    timestamp('arrival_until'),
  durationMinutes: integer('duration_minutes'),
  /** Excluded from the job's labour and included in the engineer's day. An
   *  operation that plans without it always overbooks. */
  travelMinutes:   integer('travel_minutes'),
  /** Recorded by the app on site, never asserted: this is the evidence an
   *  invoice and an SLA credit are both argued from. */
  checkInAt:       timestamp('check_in_at'),
  checkOutAt:      timestamp('check_out_at'),
  /** 'scheduled' | 'travelling' | 'on_site' | 'completed' | 'partial' |
   *  'no_access' | 'parts_required' | 'aborted'. "Partial" and "parts required"
   *  are different failures and must not collapse into one. */
  outcome:         varchar('outcome', { length: 24 }).notNull().default('scheduled'),
  notes:           text('notes'),
  signedByName:    varchar('signed_by_name', { length: 200 }),
  signedAt:        timestamp('signed_at'),
  createdAt:       timestamp('created_at').notNull().defaultNow(),
  updatedAt:       timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_work_order_visits_order').on(t.tenantId, t.workOrderId, t.scheduledStart),
  index('idx_work_order_visits_engineer').on(t.tenantId, t.engineerRef, t.scheduledStart),
]);

/**
 * The recurring commitment: a maintenance plan, a retainer, an SLA.
 *
 * What turns a service business from a queue of jobs into a book of revenue,
 * and what a planned `work_order` is generated FROM rather than remembered into
 * existence.
 */
export const serviceAgreements = pgTable('service_agreements', {
  id:               serial('id').primaryKey(),
  tenantId:         integer('tenant_id').notNull(),
  objectId:         uuid('object_id').references(() => objects.id, { onDelete: 'cascade' }),
  name:             varchar('name', { length: 200 }).notNull(),
  customerRef:      varchar('customer_ref', { length: 64 }),
  /** 'draft' | 'active' | 'lapsed' | 'cancelled'. */
  status:           varchar('status', { length: 16 }).notNull().default('draft'),
  /** What is covered and — the half every dispute is about — what is not. */
  coverage:         text('coverage'),
  exclusions:       text('exclusions'),
  /** `service_assets` ids. A contract that names a site rather than its assets
   *  cannot answer "is this boiler covered", which is the only question anybody
   *  ever asks it. */
  coveredAssetIds:  jsonb('covered_asset_ids'),
  /** How often planned work falls due: 'monthly' | 'quarterly' | 'annual' | a
   *  usage rule such as '500h'. */
  cadence:          varchar('cadence', { length: 32 }),
  responseHours:    integer('response_hours'),
  /** Distinct from response, and the one that actually carries a penalty. */
  resolutionHours:  integer('resolution_hours'),
  priceCents:       integer('price_cents'),
  currency:         varchar('currency', { length: 3 }).notNull().default('USD'),
  billingCycle:     varchar('billing_cycle', { length: 16 }).notNull().default('annual'),
  /** [{entitlement, included, used}] — "four visits a year, three used" is the
   *  sentence this column exists to make answerable. */
  entitlements:     jsonb('entitlements'),
  startsAt:         timestamp('starts_at'),
  endsAt:           timestamp('ends_at'),
  /** Notice required to cancel — the number that decides when the renewal
   *  conversation has to start. */
  noticeDays:       integer('notice_days'),
  cancelledAt:      timestamp('cancelled_at'),
  createdAt:        timestamp('created_at').notNull().defaultNow(),
  updatedAt:        timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_service_agreements_status').on(t.tenantId, t.status, t.endsAt),
  index('idx_service_agreements_customer').on(t.tenantId, t.customerRef),
]);

/**
 * The priced quote that PRECEDES the work.
 *
 * The platform modelled `invoices`, `bills` and `contracts` and had no object
 * for the thing every service business wins work with — and whose acceptance
 * rate is the most diagnostic number it has. `work_estimates` rather than
 * `estimates` because `task_effort_estimates` already exists in `delivery` and
 * means something else entirely; two tables called estimates in one schema is a
 * grep that returns the wrong one forever.
 */
export const workEstimates = pgTable('work_estimates', {
  id:             serial('id').primaryKey(),
  tenantId:       integer('tenant_id').notNull(),
  reference:      varchar('reference', { length: 48 }).notNull(),
  title:          varchar('title', { length: 300 }).notNull(),
  customerRef:    varchar('customer_ref', { length: 64 }),
  workOrderId:    integer('work_order_id').references(() => workOrders.id, { onDelete: 'set null' }),
  /** 'draft' | 'sent' | 'accepted' | 'declined' | 'expired'. */
  status:         varchar('status', { length: 16 }).notNull().default('draft'),
  /** What is being quoted for, in the customer's language. The paragraph that
   *  decides whether a variation is chargeable later. */
  scope:          text('scope'),
  exclusions:     text('exclusions'),
  /** [{description, quantity, unitPriceCents, amountCents}]. The TOTAL is not a
   *  column: it is the sum of these, and a stored total is the one that ends up
   *  disagreeing with the lines printed beneath it. */
  lines:          jsonb('lines'),
  currency:       varchar('currency', { length: 3 }).notNull().default('USD'),
  validUntil:     timestamp('valid_until'),
  terms:          text('terms'),
  acceptedAt:     timestamp('accepted_at'),
  declinedAt:     timestamp('declined_at'),
  /** 'price' | 'timing' | 'scope' | 'competitor' | 'no_response'. What makes a
   *  win rate diagnosable rather than merely depressing. */
  declineReason:  varchar('decline_reason', { length: 24 }),
  createdAt:      timestamp('created_at').notNull().defaultNow(),
  updatedAt:      timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_work_estimates_reference').on(t.tenantId, t.reference),
  index('idx_work_estimates_status').on(t.tenantId, t.status, t.validUntil),
]);

/**
 * A completed procedure against an asset — the evidence half.
 *
 * Not a `question_set` + `responses` pair, and the distinction is load-bearing:
 * a form is a question set a human answers, while this is a regulated procedure
 * bound to a specific asset whose result is a legal record with a next-due date
 * another object schedules from, and whose inspector's certification must have
 * been valid ON THE DAY.
 */
export const assetInspections = pgTable('asset_inspections', {
  id:              serial('id').primaryKey(),
  tenantId:        integer('tenant_id').notNull(),
  assetId:         integer('asset_id').references(() => serviceAssets.id, { onDelete: 'cascade' }),
  workOrderId:     integer('work_order_id').references(() => workOrders.id, { onDelete: 'set null' }),
  /** 'safety_check' | 'statutory' | 'condition_survey' | 'walkaround' |
   *  'quality_gate' | 'calibration'. */
  inspectionType:  varchar('inspection_type', { length: 32 }).notNull().default('safety_check'),
  /** The standard or regulation, named exactly — the citation an auditor checks. */
  standard:        varchar('standard', { length: 200 }),
  inspectorRef:    varchar('inspector_ref', { length: 64 }),
  performedAt:     timestamp('performed_at'),
  /** [{check, result, note, evidenceRef}] where result is pass | fail | na. */
  lines:           jsonb('lines'),
  /** 'pending' | 'pass' | 'pass_with_actions' | 'fail'. A failed statutory
   *  inspection usually means the asset stops being used today. */
  outcome:         varchar('outcome', { length: 24 }).notNull().default('pending'),
  certificateRef:  varchar('certificate_ref', { length: 96 }),
  nextDueAt:       timestamp('next_due_at'),
  createdAt:       timestamp('created_at').notNull().defaultNow(),
  updatedAt:       timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_asset_inspections_asset').on(t.tenantId, t.assetId, t.performedAt),
  index('idx_asset_inspections_due').on(t.tenantId, t.nextDueAt),
]);

/**
 * The credential the work is only lawful WITH.
 *
 * The expiry is the whole point: an expired certificate does not announce
 * itself, and dispatching against one is how a company loses its own licence.
 * `operator_certifications` rather than `certifications` because the holder is
 * not always a person — a vehicle's MOT and a machine's calibration are the
 * same fact about a different operator.
 */
export const operatorCertifications = pgTable('operator_certifications', {
  id:             serial('id').primaryKey(),
  tenantId:       integer('tenant_id').notNull(),
  /** Who or what holds it: a `user` ref, a `service_assets` ref, or the company. */
  holderRef:      varchar('holder_ref', { length: 64 }),
  holderKind:     varchar('holder_kind', { length: 24 }).notNull().default('user'),
  name:           varchar('name', { length: 200 }).notNull(),
  /** 'trade_registration' | 'practising_certificate' | 'insurance' |
   *  'calibration' | 'operating_licence' | 'training'. */
  credentialType: varchar('credential_type', { length: 32 }).notNull().default('trade_registration'),
  issuer:         varchar('issuer', { length: 200 }),
  reference:      varchar('reference', { length: 120 }),
  /** What it actually permits. Dispatching outside this list is the exposure
   *  this row exists to prevent. */
  scope:          jsonb('scope'),
  issuedAt:       timestamp('issued_at'),
  expiresAt:      timestamp('expires_at'),
  /** Distinct from the issue date, because a certificate can be revoked without
   *  expiring — so "we checked the register" is its own fact. */
  verifiedAt:     timestamp('verified_at'),
  revokedAt:      timestamp('revoked_at'),
  createdAt:      timestamp('created_at').notNull().defaultNow(),
  updatedAt:      timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_operator_certifications_expiry').on(t.tenantId, t.expiresAt),
  index('idx_operator_certifications_holder').on(t.tenantId, t.holderKind, t.holderRef),
]);

/** Who parts are bought from, and how long they take. */
export const operationsSuppliers = pgTable('operations_suppliers', {
  id:            serial('id').primaryKey(),
  tenantId:      integer('tenant_id').notNull(),
  name:          varchar('name', { length: 200 }).notNull(),
  contactName:   varchar('contact_name', { length: 200 }),
  contactEmail:  varchar('contact_email', { length: 200 }),
  contactPhone:  varchar('contact_phone', { length: 48 }),
  /** What they supply, and whether they are the SOLE source of any of it — a
   *  single point of failure with a delivery van attached. */
  supplies:      jsonb('supplies'),
  /** As OBSERVED, not as promised. The field that makes a reorder point
   *  calculable rather than guessed. */
  leadTimeDays:  integer('lead_time_days'),
  minimumOrderCents: integer('minimum_order_cents'),
  currency:      varchar('currency', { length: 3 }).notNull().default('USD'),
  paymentTerms:  varchar('payment_terms', { length: 96 }),
  /** 'prospective' | 'approved' | 'suspended'. */
  status:        varchar('status', { length: 16 }).notNull().default('prospective'),
  /** [{requirement, status, expiresAt}] — insurance, accreditation, a signed
   *  contract. What they must hold to be used at all. */
  approvals:     jsonb('approvals'),
  riskNotes:     text('risk_notes'),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_operations_suppliers_name').on(t.tenantId, t.name),
  index('idx_operations_suppliers_status').on(t.tenantId, t.status),
]);

/**
 * Stock with a reorder point.
 *
 * Van stock and store stock are DIFFERENT balances — `location` is part of the
 * identity, not a note — because merging them is exactly how a job leaves
 * without its part.
 */
export const inventoryItems = pgTable('inventory_items', {
  id:            serial('id').primaryKey(),
  tenantId:      integer('tenant_id').notNull(),
  sku:           varchar('sku', { length: 96 }).notNull(),
  name:          varchar('name', { length: 200 }).notNull(),
  location:      varchar('location', { length: 96 }).notNull().default('main'),
  supplierId:    integer('supplier_id').references(() => operationsSuppliers.id, { onDelete: 'set null' }),
  onHand:        numeric('on_hand', { precision: 12, scale: 2 }).notNull().default('0'),
  onOrder:       numeric('on_order', { precision: 12, scale: 2 }).notNull().default('0'),
  /** Set from usage times lead time, not from a round number that feels safe. */
  reorderPoint:  numeric('reorder_point', { precision: 12, scale: 2 }),
  unitCostCents: integer('unit_cost_cents'),
  currency:      varchar('currency', { length: 3 }).notNull().default('USD'),
  unit:          varchar('unit', { length: 24 }).notNull().default('each'),
  /** When somebody last physically counted it. A balance nobody has counted is
   *  a guess with a decimal point, and this is what says how old the guess is. */
  countedAt:     timestamp('counted_at'),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_inventory_items_sku_location').on(t.tenantId, t.sku, t.location),
  index('idx_inventory_items_reorder').on(t.tenantId, t.location, t.onHand),
]);

/** The replenishment, from raised to received. */
export const purchaseOrders = pgTable('purchase_orders', {
  id:            serial('id').primaryKey(),
  tenantId:      integer('tenant_id').notNull(),
  supplierId:    integer('supplier_id').references(() => operationsSuppliers.id, { onDelete: 'set null' }),
  /** The reference the supplier quotes back. Without it a delivery cannot be
   *  matched to an order. */
  orderNumber:   varchar('order_number', { length: 48 }).notNull(),
  /** 'draft' | 'approved' | 'sent' | 'partially_received' | 'received' | 'cancelled'. */
  status:        varchar('status', { length: 24 }).notNull().default('draft'),
  /** [{sku, description, quantity, unitPriceCents, amountCents}]. No stored
   *  total, for the reason `work_estimates.lines` gives. */
  lines:         jsonb('lines'),
  currency:      varchar('currency', { length: 3 }).notNull().default('USD'),
  raisedAt:      timestamp('raised_at'),
  /** What lateness is measured against — a promise, not a hope. */
  promisedAt:    timestamp('promised_at'),
  /** Who authorised the spend. Written by the approval path, never by a generic
   *  PATCH: it is money, and the entity is registered read-only for that reason. */
  approvedByRef: varchar('approved_by_ref', { length: 64 }),
  approvedAt:    timestamp('approved_at'),
  receivedAt:    timestamp('received_at'),
  cancelledAt:   timestamp('cancelled_at'),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_purchase_orders_number').on(t.tenantId, t.orderNumber),
  index('idx_purchase_orders_status').on(t.tenantId, t.status, t.promisedAt),
]);

/**
 * The movement, with tracking and proof of delivery.
 *
 * Its own table for the same reason `test_run` is not `test_plan`: one order
 * routinely ships several times, short-shipments are the norm, and a part that
 * is late is a job that cannot be booked.
 */
export const inboundShipments = pgTable('inbound_shipments', {
  id:              serial('id').primaryKey(),
  tenantId:        integer('tenant_id').notNull(),
  purchaseOrderId: integer('purchase_order_id').references(() => purchaseOrders.id, { onDelete: 'cascade' }),
  carrier:         varchar('carrier', { length: 120 }),
  trackingRef:     varchar('tracking_ref', { length: 120 }),
  /** 'pending' | 'dispatched' | 'in_transit' | 'delivered' | 'lost'. */
  status:          varchar('status', { length: 16 }).notNull().default('pending'),
  /** Where it is going — the store, a van, or straight to site. The third is
   *  the one that goes wrong. */
  destination:     varchar('destination', { length: 120 }),
  /** What actually SHIPPED, which is a different list from what was ordered. */
  contents:        jsonb('contents'),
  dispatchedAt:    timestamp('dispatched_at'),
  promisedAt:      timestamp('promised_at'),
  /** Written by the receipt or the carrier feed. A part that is "delivered" and
   *  absent is a job booked against nothing. */
  deliveredAt:     timestamp('delivered_at'),
  /** Signature, photo or note — `artifacts` refs, never bytes. */
  proofRefs:       jsonb('proof_refs'),
  createdAt:       timestamp('created_at').notNull().defaultNow(),
  updatedAt:       timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_inbound_shipments_order').on(t.tenantId, t.purchaseOrderId, t.status),
  index('idx_inbound_shipments_promised').on(t.tenantId, t.promisedAt),
]);

/**
 * A safety, environmental or service-failure event.
 *
 * Its own table rather than a `defect` because a defect is REPRODUCED and
 * VERIFIED against a build, and an incident is REPORTED, investigated, and — in
 * most of these industries — reportable to a regulator on a clock. A near miss
 * is recorded here for the same reason an injury is: it is the same event with
 * a luckier ending, and it is the only one you get to learn from for free.
 */
export const operationsIncidents = pgTable('operations_incidents', {
  id:               serial('id').primaryKey(),
  tenantId:         integer('tenant_id').notNull(),
  objectId:         uuid('object_id').references(() => objects.id, { onDelete: 'cascade' }),
  reference:        varchar('reference', { length: 48 }).notNull(),
  title:            varchar('title', { length: 300 }).notNull(),
  /** 'injury' | 'near_miss' | 'environmental' | 'property_damage' |
   *  'service_failure' | 'complaint'. */
  incidentType:     varchar('incident_type', { length: 24 }).notNull().default('near_miss'),
  /** Judged on the realistic worst case, not on what happened to occur:
   *  'critical' | 'major' | 'moderate' | 'minor'. */
  severity:         varchar('severity', { length: 16 }).notNull().default('minor'),
  /** 'reported' | 'investigating' | 'actions_open' | 'closed'. */
  status:           varchar('status', { length: 24 }).notNull().default('reported'),
  occurredAt:       timestamp('occurred_at'),
  assetId:          integer('asset_id').references(() => serviceAssets.id, { onDelete: 'set null' }),
  workOrderId:      integer('work_order_id').references(() => workOrders.id, { onDelete: 'set null' }),
  siteName:         varchar('site_name', { length: 200 }),
  /** Factual and in sequence. No conclusions and no blame: this may be read by
   *  a regulator, an insurer and a court. */
  account:          text('account'),
  immediateAction:  text('immediate_action'),
  /** "Operator error" is where an investigation stops being useful — this says
   *  what ALLOWED the error. */
  rootCause:        text('root_cause'),
  /** [{action, ownerRef, dueAt, status}]. An action with no owner and no date
   *  is a sentence, not a control. */
  correctiveActions: jsonb('corrective_actions'),
  /** Whether it must be notified to a regulator. Getting this wrong is a
   *  criminal matter in most of these industries. */
  reportable:       boolean('reportable').notNull().default(false),
  reportedAt:       timestamp('reported_at'),
  closedAt:         timestamp('closed_at'),
  createdAt:        timestamp('created_at').notNull().defaultNow(),
  updatedAt:        timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_operations_incidents_reference').on(t.tenantId, t.reference),
  index('idx_operations_incidents_status').on(t.tenantId, t.status, t.severity, t.occurredAt),
]);
