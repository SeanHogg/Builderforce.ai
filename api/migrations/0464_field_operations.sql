-- 0464 — Field operations: the work a vertical company actually sells.
--
-- ── WHAT WAS MISSING ────────────────────────────────────────────────────────
-- The roster had fifteen seats and every one of them models how a company runs
-- ITSELF: raise (investor), market (growth), sell (revenue), hire (hiring),
-- employ (people), pay (finance), ship software (delivery), answer tickets
-- (support). Not one models what the company DOES for the customer who pays it.
--
-- That is fine for a horizontal SaaS, whose product IS the software. It is fatal
-- for the niche verticals — field service, trades, property, facilities,
-- clinics, veterinary, fleet, logistics, manufacturing, hospitality,
-- professional practice — which is where most companies are. A founder of one
-- could bring their fundraising, hiring, payroll and marketing onto the
-- platform and had nowhere at all to put the job, the visit, the asset, the
-- part, the inspection or the certificate: the operation itself.
--
-- ── WHY NOT `delivery`, `commerce` OR `support` ─────────────────────────────
-- `delivery` is the SOFTWARE backlog — work_item, sprint, release. A boiler
-- repair is not a sprint item, and filing it as one puts a customer's SLA in a
-- burndown chart. `commerce` is the marketplace (listing, order, gig, booking).
-- `support` is the ticket ABOUT the work, not the work. Absorbing operations
-- into any of the three would make that domain mean two things, which is the
-- bounded-context violation §3 exists to refuse.
--
-- ── ONE DOMAIN, NOT ONE PER INDUSTRY ────────────────────────────────────────
-- Lay the verticals side by side and the nouns rhyme: a job / repair /
-- appointment / defect / work order is one shape; a boiler / unit / chair /
-- vehicle / machine is one shape. WORK ordered against an ASSET, executed at a
-- scheduled VISIT, evidenced by an INSPECTION, permitted by a CERTIFICATION,
-- consuming PARTS. So the industry is a `discipline` VALUE on the row and never
-- a table — §3.1's "a new kind is a column value" applied at the level of a
-- whole domain. Six industry packs would be six copies that drift, and the
-- cross-vertical question ("which asset eats the most labour") would become six
-- reports that disagree.
--
-- ── WHAT IS DELIBERATELY *NOT* HERE ─────────────────────────────────────────
-- The customer is a `party_role`. The engineer is a `user`. A site photo is an
-- `artifact`. A conversation about a job is `threads` + `messages`. An approval
-- is the kernel's, an audit line is `activity_log`, and money leaving for a
-- purchase order is a `ledger_entry`. Twelve tables is what is LEFT after that
-- subtraction — the facts nothing else on the platform holds.
--
-- ── NO STORED TOTALS ────────────────────────────────────────────────────────
-- `work_estimates.lines` and `purchase_orders.lines` carry priced lines and
-- there is no `total_cents` column beside them, deliberately: a stored total is
-- the one that ends up disagreeing with the lines printed directly beneath it.
-- The canvas computes it at render (`SpecField.derive`) and any reader sums the
-- same jsonb. One fact in one place, which is the 3NF rule stated for a column
-- that looked like a convenience.
--
-- Additive only. No table here replaces an existing one and nothing is
-- backfilled: the domain has no rows until a tenant creates one.

-- ---------------------------------------------------------------------------
-- 1 — The thing being served
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS service_assets (
  id               serial PRIMARY KEY,
  tenant_id        integer NOT NULL,
  object_id        uuid REFERENCES objects(id) ON DELETE CASCADE,
  asset_tag        varchar(64) NOT NULL,
  name             varchar(200) NOT NULL,
  asset_class      varchar(96),
  -- The column that makes ONE domain serve every vertical. Free-form rather
  -- than an enum because a thirteenth industry must not need a migration.
  discipline       varchar(32) NOT NULL DEFAULT 'other',
  customer_ref     varchar(64),
  site_name        varchar(200),
  site_address     text,
  access_notes     text,
  make_model       varchar(200),
  serial_number    varchar(120),
  criticality      varchar(16) NOT NULL DEFAULT 'routine',
  status           varchar(24) NOT NULL DEFAULT 'in_service',
  installed_at     timestamp,
  warranty_until   timestamp,
  -- Nullable on purpose: an unassessed asset must read as unassessed. A zero
  -- would read as a condemnation nobody issued.
  condition_score  integer,
  meter_reading    numeric(14,2),
  meter_unit       varchar(24),
  next_service_at  timestamp,
  retired_at       timestamp,
  created_at       timestamp NOT NULL DEFAULT NOW(),
  updated_at       timestamp NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_service_assets_tag ON service_assets (tenant_id, asset_tag);
CREATE INDEX IF NOT EXISTS idx_service_assets_status ON service_assets (tenant_id, status, discipline, updated_at);
CREATE INDEX IF NOT EXISTS idx_service_assets_due ON service_assets (tenant_id, next_service_at);

-- ---------------------------------------------------------------------------
-- 2 — The commercial frame (declared before the work that references it)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS service_agreements (
  id                serial PRIMARY KEY,
  tenant_id         integer NOT NULL,
  object_id         uuid REFERENCES objects(id) ON DELETE CASCADE,
  name              varchar(200) NOT NULL,
  customer_ref      varchar(64),
  status            varchar(16) NOT NULL DEFAULT 'draft',
  coverage          text,
  exclusions        text,
  covered_asset_ids jsonb,
  cadence           varchar(32),
  response_hours    integer,
  resolution_hours  integer,
  price_cents       integer,
  currency          varchar(3) NOT NULL DEFAULT 'USD',
  billing_cycle     varchar(16) NOT NULL DEFAULT 'annual',
  entitlements      jsonb,
  starts_at         timestamp,
  ends_at           timestamp,
  notice_days       integer,
  cancelled_at      timestamp,
  created_at        timestamp NOT NULL DEFAULT NOW(),
  updated_at        timestamp NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_service_agreements_status ON service_agreements (tenant_id, status, ends_at);
CREATE INDEX IF NOT EXISTS idx_service_agreements_customer ON service_agreements (tenant_id, customer_ref);

-- ---------------------------------------------------------------------------
-- 3 — The work, and the visits that execute it
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS work_orders (
  id                serial PRIMARY KEY,
  tenant_id         integer NOT NULL,
  object_id         uuid REFERENCES objects(id) ON DELETE CASCADE,
  reference         varchar(48) NOT NULL,
  title             varchar(300) NOT NULL,
  -- reactive | planned | installation | warranty | callback | inspection.
  -- `callback` earns its place: it is the number that says whether the first
  -- visit actually fixed anything.
  order_type        varchar(24) NOT NULL DEFAULT 'reactive',
  discipline        varchar(32) NOT NULL DEFAULT 'other',
  priority          varchar(16) NOT NULL DEFAULT 'routine',
  status            varchar(24) NOT NULL DEFAULT 'new',
  asset_id          integer REFERENCES service_assets(id) ON DELETE SET NULL,
  agreement_id      integer REFERENCES service_agreements(id) ON DELETE SET NULL,
  customer_ref      varchar(64),
  reported_fault    text,
  resolution        text,
  sla_due_at        timestamp,
  assigned_refs     jsonb,
  parts_used        jsonb,
  labour_hours      numeric(8,2),
  labour_rate_cents integer,
  billing_basis     varchar(16) NOT NULL DEFAULT 'billable',
  -- Nullable and written by the completion path from the visits, never by a
  -- client: it is the headline operational metric of the whole domain and a
  -- self-reported one is worthless. NULL means "not yet knowable".
  first_time_fix    boolean,
  completed_at      timestamp,
  cancelled_at      timestamp,
  created_at        timestamp NOT NULL DEFAULT NOW(),
  updated_at        timestamp NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_work_orders_reference ON work_orders (tenant_id, reference);
CREATE INDEX IF NOT EXISTS idx_work_orders_status ON work_orders (tenant_id, status, priority, sla_due_at);
CREATE INDEX IF NOT EXISTS idx_work_orders_asset ON work_orders (tenant_id, asset_id, updated_at);

-- One order, MANY visits. A return trip for a part is the commonest event in
-- field service, and a single-appointment model cannot represent it without
-- lying about first-time fix — the number the table above exists to measure.
CREATE TABLE IF NOT EXISTS work_order_visits (
  id               serial PRIMARY KEY,
  tenant_id        integer NOT NULL,
  work_order_id    integer NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  engineer_ref     varchar(64),
  scheduled_start  timestamp,
  -- The window the CUSTOMER was promised, distinct from the scheduled start:
  -- the promise is what a missed appointment is judged against.
  arrival_from     timestamp,
  arrival_until    timestamp,
  duration_minutes integer,
  travel_minutes   integer,
  -- Recorded by the app on site, never asserted: this is the evidence an
  -- invoice and an SLA credit are both argued from.
  check_in_at      timestamp,
  check_out_at     timestamp,
  outcome          varchar(24) NOT NULL DEFAULT 'scheduled',
  notes            text,
  signed_by_name   varchar(200),
  signed_at        timestamp,
  created_at       timestamp NOT NULL DEFAULT NOW(),
  updated_at       timestamp NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_work_order_visits_order ON work_order_visits (tenant_id, work_order_id, scheduled_start);
CREATE INDEX IF NOT EXISTS idx_work_order_visits_engineer ON work_order_visits (tenant_id, engineer_ref, scheduled_start);

-- ---------------------------------------------------------------------------
-- 4 — The quote that PRECEDES the invoice
-- ---------------------------------------------------------------------------
-- `work_estimates`, not `estimates`: `task_effort_estimates` already exists in
-- `delivery` and means something else entirely. Two tables called estimates in
-- one schema is a grep that returns the wrong one forever.

CREATE TABLE IF NOT EXISTS work_estimates (
  id             serial PRIMARY KEY,
  tenant_id      integer NOT NULL,
  reference      varchar(48) NOT NULL,
  title          varchar(300) NOT NULL,
  customer_ref   varchar(64),
  work_order_id  integer REFERENCES work_orders(id) ON DELETE SET NULL,
  status         varchar(16) NOT NULL DEFAULT 'draft',
  scope          text,
  exclusions     text,
  -- [{description, quantity, unitPriceCents, amountCents}]. No total column —
  -- see the header.
  lines          jsonb,
  currency       varchar(3) NOT NULL DEFAULT 'USD',
  valid_until    timestamp,
  terms          text,
  accepted_at    timestamp,
  declined_at    timestamp,
  decline_reason varchar(24),
  created_at     timestamp NOT NULL DEFAULT NOW(),
  updated_at     timestamp NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_work_estimates_reference ON work_estimates (tenant_id, reference);
CREATE INDEX IF NOT EXISTS idx_work_estimates_status ON work_estimates (tenant_id, status, valid_until);

-- ---------------------------------------------------------------------------
-- 5 — The evidence, and the permission
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS asset_inspections (
  id              serial PRIMARY KEY,
  tenant_id       integer NOT NULL,
  asset_id        integer REFERENCES service_assets(id) ON DELETE CASCADE,
  work_order_id   integer REFERENCES work_orders(id) ON DELETE SET NULL,
  inspection_type varchar(32) NOT NULL DEFAULT 'safety_check',
  -- Named exactly — the citation an auditor checks.
  standard        varchar(200),
  inspector_ref   varchar(64),
  performed_at    timestamp,
  -- [{check, result, note, evidenceRef}] where result is pass | fail | na.
  lines           jsonb,
  outcome         varchar(24) NOT NULL DEFAULT 'pending',
  certificate_ref varchar(96),
  next_due_at     timestamp,
  created_at      timestamp NOT NULL DEFAULT NOW(),
  updated_at      timestamp NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_asset_inspections_asset ON asset_inspections (tenant_id, asset_id, performed_at);
CREATE INDEX IF NOT EXISTS idx_asset_inspections_due ON asset_inspections (tenant_id, next_due_at);

-- The credential the work is only lawful WITH. `operator_certifications`
-- because the holder is not always a person: a vehicle's inspection and a
-- machine's calibration are the same fact about a different operator.
CREATE TABLE IF NOT EXISTS operator_certifications (
  id              serial PRIMARY KEY,
  tenant_id       integer NOT NULL,
  holder_ref      varchar(64),
  holder_kind     varchar(24) NOT NULL DEFAULT 'user',
  name            varchar(200) NOT NULL,
  credential_type varchar(32) NOT NULL DEFAULT 'trade_registration',
  issuer          varchar(200),
  reference       varchar(120),
  scope           jsonb,
  issued_at       timestamp,
  -- The most important column in the table: an expired certificate does not
  -- announce itself, and dispatching against one can cost a company its own
  -- licence to operate.
  expires_at      timestamp,
  -- Distinct from the issue date, because a certificate can be REVOKED without
  -- expiring — so "we checked the register, and when" is its own fact.
  verified_at     timestamp,
  revoked_at      timestamp,
  created_at      timestamp NOT NULL DEFAULT NOW(),
  updated_at      timestamp NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_operator_certifications_expiry ON operator_certifications (tenant_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_operator_certifications_holder ON operator_certifications (tenant_id, holder_kind, holder_ref);

-- ---------------------------------------------------------------------------
-- 6 — What the work consumes
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS operations_suppliers (
  id                 serial PRIMARY KEY,
  tenant_id          integer NOT NULL,
  name               varchar(200) NOT NULL,
  contact_name       varchar(200),
  contact_email      varchar(200),
  contact_phone      varchar(48),
  supplies           jsonb,
  -- As OBSERVED, not as promised. The field that makes a reorder point
  -- calculable rather than guessed.
  lead_time_days     integer,
  minimum_order_cents integer,
  currency           varchar(3) NOT NULL DEFAULT 'USD',
  payment_terms      varchar(96),
  status             varchar(16) NOT NULL DEFAULT 'prospective',
  approvals          jsonb,
  risk_notes         text,
  created_at         timestamp NOT NULL DEFAULT NOW(),
  updated_at         timestamp NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_operations_suppliers_name ON operations_suppliers (tenant_id, name);
CREATE INDEX IF NOT EXISTS idx_operations_suppliers_status ON operations_suppliers (tenant_id, status);

-- Van stock and store stock are DIFFERENT balances, so `location` is part of
-- the identity rather than a note: merging them is exactly how a job leaves
-- without its part.
CREATE TABLE IF NOT EXISTS inventory_items (
  id              serial PRIMARY KEY,
  tenant_id       integer NOT NULL,
  sku             varchar(96) NOT NULL,
  name            varchar(200) NOT NULL,
  location        varchar(96) NOT NULL DEFAULT 'main',
  supplier_id     integer REFERENCES operations_suppliers(id) ON DELETE SET NULL,
  on_hand         numeric(12,2) NOT NULL DEFAULT 0,
  on_order        numeric(12,2) NOT NULL DEFAULT 0,
  reorder_point   numeric(12,2),
  unit_cost_cents integer,
  currency        varchar(3) NOT NULL DEFAULT 'USD',
  unit            varchar(24) NOT NULL DEFAULT 'each',
  -- A balance nobody has counted is a guess with a decimal point; this says how
  -- old the guess is.
  counted_at      timestamp,
  created_at      timestamp NOT NULL DEFAULT NOW(),
  updated_at      timestamp NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_items_sku_location ON inventory_items (tenant_id, sku, location);
CREATE INDEX IF NOT EXISTS idx_inventory_items_reorder ON inventory_items (tenant_id, location, on_hand);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id              serial PRIMARY KEY,
  tenant_id       integer NOT NULL,
  supplier_id     integer REFERENCES operations_suppliers(id) ON DELETE SET NULL,
  order_number    varchar(48) NOT NULL,
  status          varchar(24) NOT NULL DEFAULT 'draft',
  lines           jsonb,
  currency        varchar(3) NOT NULL DEFAULT 'USD',
  raised_at       timestamp,
  -- What lateness is measured against: a promise, not a hope.
  promised_at     timestamp,
  -- Written by the approval path, never by a generic PATCH — the entity is
  -- registered read-only for exactly this reason. It is money.
  approved_by_ref varchar(64),
  approved_at     timestamp,
  received_at     timestamp,
  cancelled_at    timestamp,
  created_at      timestamp NOT NULL DEFAULT NOW(),
  updated_at      timestamp NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_orders_number ON purchase_orders (tenant_id, order_number);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON purchase_orders (tenant_id, status, promised_at);

-- One order ships several times and short-shipments are the norm, so what
-- SHIPPED and what was ORDERED are two different lists.
CREATE TABLE IF NOT EXISTS inbound_shipments (
  id                serial PRIMARY KEY,
  tenant_id         integer NOT NULL,
  purchase_order_id integer REFERENCES purchase_orders(id) ON DELETE CASCADE,
  carrier           varchar(120),
  tracking_ref      varchar(120),
  status            varchar(16) NOT NULL DEFAULT 'pending',
  destination       varchar(120),
  contents          jsonb,
  dispatched_at     timestamp,
  promised_at       timestamp,
  -- A part that is "delivered" and absent is a job booked against nothing.
  delivered_at      timestamp,
  proof_refs        jsonb,
  created_at        timestamp NOT NULL DEFAULT NOW(),
  updated_at        timestamp NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inbound_shipments_order ON inbound_shipments (tenant_id, purchase_order_id, status);
CREATE INDEX IF NOT EXISTS idx_inbound_shipments_promised ON inbound_shipments (tenant_id, promised_at);

-- ---------------------------------------------------------------------------
-- 7 — When it goes wrong
-- ---------------------------------------------------------------------------
-- Its own table rather than a `defect`: a defect is REPRODUCED and VERIFIED
-- against a build; an incident is REPORTED, investigated, and — in most of
-- these industries — reportable to a regulator on a clock. A near miss is
-- recorded for the same reason an injury is: it is the same event with a
-- luckier ending, and the only one you get to learn from for free.
--
-- The canvas classifies `incident` as RESTRICTED by default
-- (`RESTRICTED_BY_DEFAULT_KINDS`) because it names the person it happened to
-- and records their harm. It stays readable through the seat's own surface —
-- an operation cannot run its safety register from a table it cannot open —
-- and does not leave the workspace on a share link.

CREATE TABLE IF NOT EXISTS operations_incidents (
  id                serial PRIMARY KEY,
  tenant_id         integer NOT NULL,
  object_id         uuid REFERENCES objects(id) ON DELETE CASCADE,
  reference         varchar(48) NOT NULL,
  title             varchar(300) NOT NULL,
  incident_type     varchar(24) NOT NULL DEFAULT 'near_miss',
  -- Judged on the realistic worst case, not on what happened to occur.
  severity          varchar(16) NOT NULL DEFAULT 'minor',
  status            varchar(24) NOT NULL DEFAULT 'reported',
  occurred_at       timestamp,
  asset_id          integer REFERENCES service_assets(id) ON DELETE SET NULL,
  work_order_id     integer REFERENCES work_orders(id) ON DELETE SET NULL,
  site_name         varchar(200),
  -- Factual and in sequence. No conclusions and no blame: this may be read by a
  -- regulator, an insurer and a court.
  account           text,
  immediate_action  text,
  -- "Operator error" is where an investigation stops being useful. This says
  -- what ALLOWED the error.
  root_cause        text,
  -- [{action, ownerRef, dueAt, status}]. An action with no owner and no date is
  -- a sentence, not a control.
  corrective_actions jsonb,
  reportable        boolean NOT NULL DEFAULT false,
  reported_at       timestamp,
  closed_at         timestamp,
  created_at        timestamp NOT NULL DEFAULT NOW(),
  updated_at        timestamp NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_operations_incidents_reference ON operations_incidents (tenant_id, reference);
CREATE INDEX IF NOT EXISTS idx_operations_incidents_status ON operations_incidents (tenant_id, status, severity, occurred_at);

COMMENT ON TABLE work_orders IS
  'Root entity of the operations seat: one unit of committed work, whatever the vertical calls it. `order_type` carries reactive/planned/installation/warranty/callback; `discipline` carries the industry. See migration 0464.';
COMMENT ON TABLE service_assets IS
  'The physical or managed thing work is done TO — the only row in the domain with a life longer than any single job, and what makes lifetime cost per asset answerable.';
COMMENT ON COLUMN work_orders.first_time_fix IS
  'Whether the job was fixed on the FIRST visit. Written by the completion path from work_order_visits, never by a client: it is the domain''s headline metric and a self-reported one is worthless. NULL = not yet knowable.';
