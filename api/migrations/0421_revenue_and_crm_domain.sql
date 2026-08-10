-- 0421_revenue_and_crm_domain.sql
--
-- Revenue and CRM domain
--
-- GENERATED from src/infrastructure/database/schema/revenue.ts by
-- scripts/gen-consolidation-migration.mjs (PRD 20 §5 step 2). Edit the Drizzle
-- module and regenerate; do not hand-edit the DDL, or the two sources of truth
-- this file exists to collapse come straight back.
--
-- 20 table(s). Idempotent: replayable against an environment at any
-- point in the sequence.

CREATE TABLE IF NOT EXISTS deals (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  object_id UUID REFERENCES objects(id) ON DELETE CASCADE,
  kind VARCHAR(24) NOT NULL DEFAULT 'sales',
  name VARCHAR(300) NOT NULL,
  pipeline_ref VARCHAR(64),
  stage VARCHAR(64) NOT NULL DEFAULT 'new',
  account_ref VARCHAR(64),
  primary_contact_ref VARCHAR(64),
  owner_ref VARCHAR(64),
  amount NUMERIC(16, 2),
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  probability NUMERIC(5, 2),
  expected_close_at TIMESTAMP,
  closed_at TIMESTAMP,
  outcome VARCHAR(12) NOT NULL DEFAULT 'open',
  lost_reason VARCHAR(160),
  source VARCHAR(64),
  attrs JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_deals_pipeline ON deals (tenant_id, pipeline_ref, stage);
CREATE INDEX IF NOT EXISTS idx_deals_owner ON deals (tenant_id, owner_ref, outcome);
CREATE INDEX IF NOT EXISTS idx_deals_close ON deals (tenant_id, outcome, expected_close_at);

CREATE TABLE IF NOT EXISTS pipeline_stages (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  pipeline_ref VARCHAR(64) NOT NULL,
  key VARCHAR(64) NOT NULL,
  label VARCHAR(160) NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  probability NUMERIC(5, 2),
  outcome VARCHAR(12) NOT NULL DEFAULT 'open',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pipeline_stages_key ON pipeline_stages (tenant_id, pipeline_ref, key);

CREATE TABLE IF NOT EXISTS pipeline_touchpoints (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  deal_id INTEGER REFERENCES deals(id) ON DELETE CASCADE,
  contact_ref VARCHAR(64),
  channel VARCHAR(24) NOT NULL,
  direction VARCHAR(12) NOT NULL DEFAULT 'outbound',
  summary TEXT,
  sentiment VARCHAR(16),
  owner_ref VARCHAR(64),
  occurred_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pipeline_touchpoints_deal ON pipeline_touchpoints (deal_id, occurred_at);

CREATE TABLE IF NOT EXISTS deal_flow_opportunities (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  source VARCHAR(64) NOT NULL,
  company_name VARCHAR(255),
  contact_email VARCHAR(320),
  summary TEXT,
  estimated_value NUMERIC(16, 2),
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  score NUMERIC(5, 2),
  status VARCHAR(16) NOT NULL DEFAULT 'new',
  converted_deal_id INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_deal_flow_opportunities_status ON deal_flow_opportunities (tenant_id, status, created_at);

CREATE TABLE IF NOT EXISTS contact_experiences (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  contact_ref VARCHAR(64) NOT NULL,
  company VARCHAR(255),
  title VARCHAR(200),
  started_at TIMESTAMP,
  ended_at TIMESTAMP,
  is_current BOOLEAN NOT NULL DEFAULT false,
  location VARCHAR(160),
  summary TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_contact_experiences_contact ON contact_experiences (tenant_id, contact_ref, is_current);
CREATE INDEX IF NOT EXISTS idx_contact_experiences_company ON contact_experiences (tenant_id, company);

CREATE TABLE IF NOT EXISTS contact_educations (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  contact_ref VARCHAR(64) NOT NULL,
  institution VARCHAR(255),
  degree VARCHAR(160),
  field VARCHAR(160),
  started_at TIMESTAMP,
  ended_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_contact_educations_contact ON contact_educations (tenant_id, contact_ref);

CREATE TABLE IF NOT EXISTS contact_compensations (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  contact_ref VARCHAR(64) NOT NULL,
  base NUMERIC(14, 2),
  bonus NUMERIC(14, 2),
  equity VARCHAR(96),
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  period VARCHAR(24),
  confidence VARCHAR(16) NOT NULL DEFAULT 'inferred',
  observed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_contact_compensations_contact ON contact_compensations (tenant_id, contact_ref, observed_at);

CREATE TABLE IF NOT EXISTS contact_field_provenance (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  contact_ref VARCHAR(64) NOT NULL,
  field VARCHAR(96) NOT NULL,
  value TEXT,
  source VARCHAR(64) NOT NULL,
  confidence NUMERIC(5, 2),
  observed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  superseded_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_contact_field_provenance_field ON contact_field_provenance (tenant_id, contact_ref, field, observed_at);

CREATE TABLE IF NOT EXISTS enrichment_provider_calls (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  provider VARCHAR(64) NOT NULL,
  operation VARCHAR(64) NOT NULL,
  subject_ref VARCHAR(64),
  request_hash VARCHAR(64),
  outcome VARCHAR(16) NOT NULL,
  cost_cents INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER,
  fields_returned INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  called_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_enrichment_provider_calls_provider ON enrichment_provider_calls (tenant_id, provider, called_at);
CREATE INDEX IF NOT EXISTS idx_enrichment_provider_calls_hash ON enrichment_provider_calls (request_hash);

CREATE TABLE IF NOT EXISTS saved_searches (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  owner_ref VARCHAR(64) NOT NULL,
  scope VARCHAR(32) NOT NULL DEFAULT 'contact',
  name VARCHAR(200) NOT NULL,
  filters JSONB NOT NULL DEFAULT '{}',
  is_shared BOOLEAN NOT NULL DEFAULT false,
  last_run_at TIMESTAMP,
  result_count INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_saved_searches_name ON saved_searches (tenant_id, owner_ref, scope, name);

CREATE TABLE IF NOT EXISTS saved_contact_searches (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  saved_search_id INTEGER REFERENCES saved_searches(id) ON DELETE CASCADE,
  owner_ref VARCHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_saved_contact_searches_search ON saved_contact_searches (saved_search_id);

CREATE TABLE IF NOT EXISTS lists (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  object_id UUID REFERENCES objects(id) ON DELETE CASCADE,
  owner_ref VARCHAR(64),
  scope VARCHAR(32) NOT NULL DEFAULT 'contact',
  name VARCHAR(200) NOT NULL,
  description TEXT,
  item_count INTEGER NOT NULL DEFAULT 0,
  is_shared BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_lists_name ON lists (tenant_id, owner_ref, scope, name);

CREATE TABLE IF NOT EXISTS ri_icps (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  criteria JSONB NOT NULL DEFAULT '{}',
  weightings JSONB,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ri_icps_name ON ri_icps (tenant_id, name);

CREATE TABLE IF NOT EXISTS ri_ids (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  entity_kind VARCHAR(16) NOT NULL,
  canonical_ref VARCHAR(64) NOT NULL,
  source VARCHAR(64) NOT NULL,
  source_id VARCHAR(255) NOT NULL,
  confidence NUMERIC(5, 2),
  resolved_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ri_ids_source ON ri_ids (tenant_id, source, source_id);
CREATE INDEX IF NOT EXISTS idx_ri_ids_canonical ON ri_ids (tenant_id, entity_kind, canonical_ref);

CREATE TABLE IF NOT EXISTS ri_prospects (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  icp_id INTEGER REFERENCES ri_icps(id) ON DELETE SET NULL,
  contact_ref VARCHAR(64),
  company_ref VARCHAR(64),
  score NUMERIC(5, 2),
  signals JSONB,
  status VARCHAR(16) NOT NULL DEFAULT 'new',
  owner_ref VARCHAR(64),
  last_signal_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ri_prospects_score ON ri_prospects (tenant_id, status, score);

CREATE TABLE IF NOT EXISTS ri_sequences (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  name VARCHAR(200) NOT NULL,
  icp_id INTEGER REFERENCES ri_icps(id) ON DELETE SET NULL,
  steps JSONB NOT NULL DEFAULT '[]',
  status VARCHAR(16) NOT NULL DEFAULT 'draft',
  owner_ref VARCHAR(64),
  enrolled_count INTEGER NOT NULL DEFAULT 0,
  reply_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ri_sequences_name ON ri_sequences (tenant_id, name);

CREATE TABLE IF NOT EXISTS communication_tracking (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  delivery_ref VARCHAR(64),
  contact_ref VARCHAR(64),
  deal_id INTEGER,
  channel VARCHAR(24) NOT NULL,
  event VARCHAR(24) NOT NULL,
  occurred_at TIMESTAMP NOT NULL DEFAULT NOW(),
  metadata JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_communication_tracking_contact ON communication_tracking (tenant_id, contact_ref, occurred_at);
CREATE INDEX IF NOT EXISTS idx_communication_tracking_deal ON communication_tracking (deal_id, occurred_at);

CREATE TABLE IF NOT EXISTS inbox_actions (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  thread_ref VARCHAR(64),
  message_ref VARCHAR(64),
  actor_ref VARCHAR(64),
  action VARCHAR(24) NOT NULL,
  target VARCHAR(64),
  snooze_until TIMESTAMP,
  note TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_inbox_actions_thread ON inbox_actions (tenant_id, thread_ref, created_at);

CREATE TABLE IF NOT EXISTS business_phone_numbers (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  e164 VARCHAR(24) NOT NULL,
  provider VARCHAR(48) NOT NULL,
  provider_ref VARCHAR(160),
  country VARCHAR(2),
  capabilities JSONB,
  assigned_to_ref VARCHAR(64),
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  monthly_cents INTEGER NOT NULL DEFAULT 0,
  released_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_business_phone_numbers_e164 ON business_phone_numbers (e164);

CREATE TABLE IF NOT EXISTS cities (
  id SERIAL PRIMARY KEY,
  country VARCHAR(2) NOT NULL,
  region VARCHAR(120),
  name VARCHAR(160) NOT NULL,
  slug VARCHAR(200) NOT NULL,
  latitude NUMERIC(9, 6),
  longitude NUMERIC(9, 6),
  population INTEGER,
  timezone VARCHAR(64),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cities_slug ON cities (slug);
CREATE INDEX IF NOT EXISTS idx_cities_country ON cities (country, name);

-- Tenancy foreign keys (PRD 20 §4 — every table carries tenant_id).
ALTER TABLE deals DROP CONSTRAINT IF EXISTS fk_deals_tenant;
ALTER TABLE deals ADD CONSTRAINT fk_deals_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE pipeline_stages DROP CONSTRAINT IF EXISTS fk_pipeline_stages_tenant;
ALTER TABLE pipeline_stages ADD CONSTRAINT fk_pipeline_stages_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE pipeline_touchpoints DROP CONSTRAINT IF EXISTS fk_pipeline_touchpoints_tenant;
ALTER TABLE pipeline_touchpoints ADD CONSTRAINT fk_pipeline_touchpoints_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE deal_flow_opportunities DROP CONSTRAINT IF EXISTS fk_deal_flow_opportunities_tenant;
ALTER TABLE deal_flow_opportunities ADD CONSTRAINT fk_deal_flow_opportunities_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE contact_experiences DROP CONSTRAINT IF EXISTS fk_contact_experiences_tenant;
ALTER TABLE contact_experiences ADD CONSTRAINT fk_contact_experiences_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE contact_educations DROP CONSTRAINT IF EXISTS fk_contact_educations_tenant;
ALTER TABLE contact_educations ADD CONSTRAINT fk_contact_educations_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE contact_compensations DROP CONSTRAINT IF EXISTS fk_contact_compensations_tenant;
ALTER TABLE contact_compensations ADD CONSTRAINT fk_contact_compensations_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE contact_field_provenance DROP CONSTRAINT IF EXISTS fk_contact_field_provenance_tenant;
ALTER TABLE contact_field_provenance ADD CONSTRAINT fk_contact_field_provenance_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE enrichment_provider_calls DROP CONSTRAINT IF EXISTS fk_enrichment_provider_calls_tenant;
ALTER TABLE enrichment_provider_calls ADD CONSTRAINT fk_enrichment_provider_calls_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE saved_searches DROP CONSTRAINT IF EXISTS fk_saved_searches_tenant;
ALTER TABLE saved_searches ADD CONSTRAINT fk_saved_searches_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE saved_contact_searches DROP CONSTRAINT IF EXISTS fk_saved_contact_searches_tenant;
ALTER TABLE saved_contact_searches ADD CONSTRAINT fk_saved_contact_searches_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE lists DROP CONSTRAINT IF EXISTS fk_lists_tenant;
ALTER TABLE lists ADD CONSTRAINT fk_lists_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE ri_icps DROP CONSTRAINT IF EXISTS fk_ri_icps_tenant;
ALTER TABLE ri_icps ADD CONSTRAINT fk_ri_icps_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE ri_ids DROP CONSTRAINT IF EXISTS fk_ri_ids_tenant;
ALTER TABLE ri_ids ADD CONSTRAINT fk_ri_ids_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE ri_prospects DROP CONSTRAINT IF EXISTS fk_ri_prospects_tenant;
ALTER TABLE ri_prospects ADD CONSTRAINT fk_ri_prospects_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE ri_sequences DROP CONSTRAINT IF EXISTS fk_ri_sequences_tenant;
ALTER TABLE ri_sequences ADD CONSTRAINT fk_ri_sequences_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE communication_tracking DROP CONSTRAINT IF EXISTS fk_communication_tracking_tenant;
ALTER TABLE communication_tracking ADD CONSTRAINT fk_communication_tracking_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE inbox_actions DROP CONSTRAINT IF EXISTS fk_inbox_actions_tenant;
ALTER TABLE inbox_actions ADD CONSTRAINT fk_inbox_actions_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE business_phone_numbers DROP CONSTRAINT IF EXISTS fk_business_phone_numbers_tenant;
ALTER TABLE business_phone_numbers ADD CONSTRAINT fk_business_phone_numbers_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
