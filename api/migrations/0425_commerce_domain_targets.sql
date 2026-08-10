-- 0425_commerce_domain_targets.sql
--
-- Commerce domain targets
--
-- GENERATED from src/infrastructure/database/schema/commerce.ts by
-- scripts/gen-consolidation-migration.mjs (PRD 20 §5 step 2). Edit the Drizzle
-- module and regenerate; do not hand-edit the DDL, or the two sources of truth
-- this file exists to collapse come straight back.
--
-- 20 table(s). Idempotent: replayable against an environment at any
-- point in the sequence.

CREATE TABLE IF NOT EXISTS carts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id INTEGER NOT NULL,
  buyer_ref VARCHAR(64),
  guest_token VARCHAR(64),
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  subtotal_cents INTEGER NOT NULL DEFAULT 0,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL DEFAULT 0,
  discount_code VARCHAR(64),
  status VARCHAR(16) NOT NULL DEFAULT 'open',
  converted_order_id INTEGER,
  expires_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_carts_buyer ON carts (tenant_id, buyer_ref, status);
CREATE INDEX IF NOT EXISTS idx_carts_guest ON carts (guest_token);

CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  object_id UUID REFERENCES objects(id) ON DELETE CASCADE,
  order_number VARCHAR(48) NOT NULL,
  buyer_ref VARCHAR(64),
  buyer_email VARCHAR(320),
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  subtotal_cents INTEGER NOT NULL DEFAULT 0,
  tax_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  provider VARCHAR(48),
  provider_ref VARCHAR(160),
  placed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  fulfilled_at TIMESTAMP,
  refunded_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_number ON orders (tenant_id, order_number);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (tenant_id, status, placed_at);

CREATE TABLE IF NOT EXISTS order_line_items (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  catalog_item_id UUID,
  description VARCHAR(500) NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_cents INTEGER NOT NULL DEFAULT 0,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  seller_ref VARCHAR(64),
  commission_cents INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_order_line_items_order ON order_line_items (order_id, position);

CREATE TABLE IF NOT EXISTS template_licenses (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  catalog_item_id UUID,
  licensee_ref VARCHAR(64) NOT NULL,
  scope VARCHAR(16) NOT NULL DEFAULT 'single',
  seat_limit INTEGER,
  seats_used INTEGER NOT NULL DEFAULT 0,
  order_id INTEGER,
  starts_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP,
  revoked_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_template_licenses_licensee ON template_licenses (tenant_id, catalog_item_id, licensee_ref);

CREATE TABLE IF NOT EXISTS whitelabel_tenants (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  reseller_ref VARCHAR(64) NOT NULL,
  domain VARCHAR(255),
  brand_name VARCHAR(200),
  theme JSONB,
  support_email VARCHAR(320),
  revenue_share_percent NUMERIC(5, 2),
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_whitelabel_tenants_domain ON whitelabel_tenants (domain);

CREATE TABLE IF NOT EXISTS agency_brandings (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  agency_ref VARCHAR(64) NOT NULL,
  name VARCHAR(200) NOT NULL,
  logo_artifact_id UUID,
  theme JSONB,
  tagline VARCHAR(300),
  website VARCHAR(255),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_agency_brandings_agency ON agency_brandings (tenant_id, agency_ref);

CREATE TABLE IF NOT EXISTS agency_clients (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  agency_ref VARCHAR(64) NOT NULL,
  client_name VARCHAR(255) NOT NULL,
  company_ref VARCHAR(64),
  retainer_cents INTEGER,
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  started_at TIMESTAMP,
  ended_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_agency_clients_name ON agency_clients (tenant_id, agency_ref, client_name);

CREATE TABLE IF NOT EXISTS booking_services (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  slug VARCHAR(160) NOT NULL,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  duration_min INTEGER NOT NULL DEFAULT 30,
  buffer_min INTEGER NOT NULL DEFAULT 0,
  price_cents INTEGER NOT NULL DEFAULT 0,
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  mode VARCHAR(16) NOT NULL DEFAULT 'one_to_one',
  capacity INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_booking_services_slug ON booking_services (tenant_id, slug);

CREATE TABLE IF NOT EXISTS booking_hosts (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  service_id INTEGER REFERENCES booking_services(id) ON DELETE CASCADE,
  host_ref VARCHAR(64) NOT NULL,
  connection_id INTEGER,
  timezone VARCHAR(64) NOT NULL DEFAULT 'UTC',
  priority INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_booking_hosts_host ON booking_hosts (service_id, host_ref);

CREATE TABLE IF NOT EXISTS booking_reservations (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  object_id UUID REFERENCES objects(id) ON DELETE CASCADE,
  service_id INTEGER REFERENCES booking_services(id) ON DELETE SET NULL,
  host_ref VARCHAR(64),
  booker_ref VARCHAR(64),
  booker_email VARCHAR(320),
  starts_at TIMESTAMP NOT NULL,
  ends_at TIMESTAMP NOT NULL,
  timezone VARCHAR(64) NOT NULL DEFAULT 'UTC',
  status VARCHAR(16) NOT NULL DEFAULT 'confirmed',
  meeting_url TEXT,
  order_id INTEGER,
  cancel_reason VARCHAR(200),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_booking_reservations_host ON booking_reservations (tenant_id, host_ref, starts_at);
CREATE INDEX IF NOT EXISTS idx_booking_reservations_status ON booking_reservations (tenant_id, status, starts_at);

CREATE TABLE IF NOT EXISTS gig_projects (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  object_id UUID REFERENCES objects(id) ON DELETE CASCADE,
  client_ref VARCHAR(64) NOT NULL,
  title VARCHAR(300) NOT NULL,
  brief TEXT,
  skills JSONB,
  budget_min_cents INTEGER,
  budget_max_cents INTEGER,
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  pricing VARCHAR(16) NOT NULL DEFAULT 'fixed',
  status VARCHAR(16) NOT NULL DEFAULT 'draft',
  awarded_bid_id INTEGER,
  due_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gig_projects_status ON gig_projects (tenant_id, status, created_at);

CREATE TABLE IF NOT EXISTS gig_bids (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  gig_project_id INTEGER REFERENCES gig_projects(id) ON DELETE CASCADE,
  bidder_ref VARCHAR(64) NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  delivery_days INTEGER,
  pitch TEXT,
  status VARCHAR(16) NOT NULL DEFAULT 'submitted',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gig_bids_bidder ON gig_bids (gig_project_id, bidder_ref);

CREATE TABLE IF NOT EXISTS gig_disputes (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  gig_project_id INTEGER REFERENCES gig_projects(id) ON DELETE CASCADE,
  raised_by_ref VARCHAR(64) NOT NULL,
  reason VARCHAR(200) NOT NULL,
  detail TEXT,
  amount_disputed_cents INTEGER,
  status VARCHAR(16) NOT NULL DEFAULT 'open',
  resolution TEXT,
  resolved_by VARCHAR(64),
  resolved_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gig_disputes_status ON gig_disputes (tenant_id, status, created_at);

CREATE TABLE IF NOT EXISTS consultant_consultations (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  consultant_ref VARCHAR(64) NOT NULL,
  client_ref VARCHAR(64),
  reservation_id INTEGER,
  topic VARCHAR(300),
  duration_min INTEGER,
  rate_cents INTEGER,
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  status VARCHAR(16) NOT NULL DEFAULT 'scheduled',
  recording_artifact_id UUID,
  held_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_consultant_consultations_consultant ON consultant_consultations (tenant_id, consultant_ref, held_at);

CREATE TABLE IF NOT EXISTS consultant_knowledge_docs (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  consultant_ref VARCHAR(64) NOT NULL,
  artifact_id UUID,
  title VARCHAR(300) NOT NULL,
  summary TEXT,
  price_cents INTEGER NOT NULL DEFAULT 0,
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  visibility VARCHAR(16) NOT NULL DEFAULT 'private',
  download_count INTEGER NOT NULL DEFAULT 0,
  published_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_consultant_knowledge_docs_consultant ON consultant_knowledge_docs (tenant_id, consultant_ref, published_at);

CREATE TABLE IF NOT EXISTS card_decks (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  object_id UUID REFERENCES objects(id) ON DELETE CASCADE,
  slug VARCHAR(160) NOT NULL,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  cards JSONB NOT NULL DEFAULT '[]',
  card_count INTEGER NOT NULL DEFAULT 0,
  price_cents INTEGER NOT NULL DEFAULT 0,
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  visibility VARCHAR(16) NOT NULL DEFAULT 'private',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_card_decks_slug ON card_decks (tenant_id, slug);

CREATE TABLE IF NOT EXISTS exclusive_boards (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  object_id UUID REFERENCES objects(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  entry_rule JSONB,
  member_cap INTEGER,
  member_count INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_exclusive_boards_name ON exclusive_boards (tenant_id, name);

CREATE TABLE IF NOT EXISTS community_resources (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER,
  object_id UUID REFERENCES objects(id) ON DELETE CASCADE,
  title VARCHAR(300) NOT NULL,
  url TEXT,
  artifact_id UUID,
  category VARCHAR(96),
  summary TEXT,
  author_ref VARCHAR(64),
  upvote_count INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(16) NOT NULL DEFAULT 'published',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_community_resources_category ON community_resources (category, upvote_count);

CREATE TABLE IF NOT EXISTS partner_program_opt_ins (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  partner_ref VARCHAR(64) NOT NULL,
  program_key VARCHAR(96) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  commission_percent NUMERIC(5, 2),
  terms JSONB,
  accepted_at TIMESTAMP,
  left_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_partner_program_opt_ins_program ON partner_program_opt_ins (tenant_id, partner_ref, program_key);

CREATE TABLE IF NOT EXISTS inbox_seat_addons (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  order_id INTEGER,
  seats INTEGER NOT NULL DEFAULT 1,
  unit_cents INTEGER NOT NULL DEFAULT 0,
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  starts_at TIMESTAMP NOT NULL DEFAULT NOW(),
  ends_at TIMESTAMP,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_inbox_seat_addons_tenant ON inbox_seat_addons (tenant_id, status, ends_at);

-- Tenancy foreign keys (PRD 20 §4 — every table carries tenant_id).
ALTER TABLE carts DROP CONSTRAINT IF EXISTS fk_carts_tenant;
ALTER TABLE carts ADD CONSTRAINT fk_carts_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE orders DROP CONSTRAINT IF EXISTS fk_orders_tenant;
ALTER TABLE orders ADD CONSTRAINT fk_orders_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE order_line_items DROP CONSTRAINT IF EXISTS fk_order_line_items_tenant;
ALTER TABLE order_line_items ADD CONSTRAINT fk_order_line_items_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE template_licenses DROP CONSTRAINT IF EXISTS fk_template_licenses_tenant;
ALTER TABLE template_licenses ADD CONSTRAINT fk_template_licenses_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE whitelabel_tenants DROP CONSTRAINT IF EXISTS fk_whitelabel_tenants_tenant;
ALTER TABLE whitelabel_tenants ADD CONSTRAINT fk_whitelabel_tenants_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE agency_brandings DROP CONSTRAINT IF EXISTS fk_agency_brandings_tenant;
ALTER TABLE agency_brandings ADD CONSTRAINT fk_agency_brandings_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE agency_clients DROP CONSTRAINT IF EXISTS fk_agency_clients_tenant;
ALTER TABLE agency_clients ADD CONSTRAINT fk_agency_clients_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE booking_services DROP CONSTRAINT IF EXISTS fk_booking_services_tenant;
ALTER TABLE booking_services ADD CONSTRAINT fk_booking_services_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE booking_hosts DROP CONSTRAINT IF EXISTS fk_booking_hosts_tenant;
ALTER TABLE booking_hosts ADD CONSTRAINT fk_booking_hosts_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE booking_reservations DROP CONSTRAINT IF EXISTS fk_booking_reservations_tenant;
ALTER TABLE booking_reservations ADD CONSTRAINT fk_booking_reservations_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE gig_projects DROP CONSTRAINT IF EXISTS fk_gig_projects_tenant;
ALTER TABLE gig_projects ADD CONSTRAINT fk_gig_projects_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE gig_bids DROP CONSTRAINT IF EXISTS fk_gig_bids_tenant;
ALTER TABLE gig_bids ADD CONSTRAINT fk_gig_bids_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE gig_disputes DROP CONSTRAINT IF EXISTS fk_gig_disputes_tenant;
ALTER TABLE gig_disputes ADD CONSTRAINT fk_gig_disputes_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE consultant_consultations DROP CONSTRAINT IF EXISTS fk_consultant_consultations_tenant;
ALTER TABLE consultant_consultations ADD CONSTRAINT fk_consultant_consultations_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE consultant_knowledge_docs DROP CONSTRAINT IF EXISTS fk_consultant_knowledge_docs_tenant;
ALTER TABLE consultant_knowledge_docs ADD CONSTRAINT fk_consultant_knowledge_docs_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE card_decks DROP CONSTRAINT IF EXISTS fk_card_decks_tenant;
ALTER TABLE card_decks ADD CONSTRAINT fk_card_decks_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE exclusive_boards DROP CONSTRAINT IF EXISTS fk_exclusive_boards_tenant;
ALTER TABLE exclusive_boards ADD CONSTRAINT fk_exclusive_boards_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE community_resources DROP CONSTRAINT IF EXISTS fk_community_resources_tenant;
ALTER TABLE community_resources ADD CONSTRAINT fk_community_resources_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE partner_program_opt_ins DROP CONSTRAINT IF EXISTS fk_partner_program_opt_ins_tenant;
ALTER TABLE partner_program_opt_ins ADD CONSTRAINT fk_partner_program_opt_ins_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE inbox_seat_addons DROP CONSTRAINT IF EXISTS fk_inbox_seat_addons_tenant;
ALTER TABLE inbox_seat_addons ADD CONSTRAINT fk_inbox_seat_addons_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
