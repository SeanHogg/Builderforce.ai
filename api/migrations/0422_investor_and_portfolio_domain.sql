-- 0422_investor_and_portfolio_domain.sql
--
-- Investor and portfolio domain
--
-- GENERATED from src/infrastructure/database/schema/investor.ts by
-- scripts/gen-consolidation-migration.mjs (PRD 20 §5 step 2). Edit the Drizzle
-- module and regenerate; do not hand-edit the DDL, or the two sources of truth
-- this file exists to collapse come straight back.
--
-- 12 table(s). Idempotent: replayable against an environment at any
-- point in the sequence.

CREATE TABLE IF NOT EXISTS companies (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  object_id UUID REFERENCES objects(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(200),
  website VARCHAR(255),
  stage VARCHAR(48),
  sector VARCHAR(120),
  country VARCHAR(2),
  founded_at TIMESTAMP,
  headcount INTEGER,
  crm_owner_ref VARCHAR(64),
  crm_status VARCHAR(32),
  crm_last_touched_at TIMESTAMP,
  arr NUMERIC(16, 2),
  valuation NUMERIC(18, 2),
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  is_portfolio BOOLEAN NOT NULL DEFAULT false,
  attrs JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_companies_name ON companies (tenant_id, name);
CREATE INDEX IF NOT EXISTS idx_companies_portfolio ON companies (tenant_id, is_portfolio, stage);

CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  object_id UUID REFERENCES objects(id) ON DELETE CASCADE,
  company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  summary TEXT,
  stage VARCHAR(24) NOT NULL DEFAULT 'concept',
  launched_at TIMESTAMP,
  attrs JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_products_name ON products (tenant_id, company_id, name);

CREATE TABLE IF NOT EXISTS product_ideas (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  object_id UUID REFERENCES objects(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  title VARCHAR(300) NOT NULL,
  body TEXT,
  problem TEXT,
  hypothesis TEXT,
  status VARCHAR(16) NOT NULL DEFAULT 'captured',
  promoted_work_item_ref VARCHAR(64),
  author_ref VARCHAR(64),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_product_ideas_status ON product_ideas (tenant_id, status, updated_at);

CREATE TABLE IF NOT EXISTS data_rooms (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  object_id UUID REFERENCES objects(id) ON DELETE CASCADE,
  company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  purpose VARCHAR(64),
  status VARCHAR(16) NOT NULL DEFAULT 'restricted',
  nda_required BOOLEAN NOT NULL DEFAULT true,
  watermark BOOLEAN NOT NULL DEFAULT true,
  expires_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_data_rooms_name ON data_rooms (tenant_id, company_id, name);

CREATE TABLE IF NOT EXISTS due_diligence_checklists (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  data_room_id INTEGER REFERENCES data_rooms(id) ON DELETE SET NULL,
  name VARCHAR(255) NOT NULL,
  category VARCHAR(32) NOT NULL DEFAULT 'financial',
  owner_ref VARCHAR(64),
  due_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_due_diligence_checklists_company ON due_diligence_checklists (tenant_id, company_id, category);

CREATE TABLE IF NOT EXISTS due_diligence_documents (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  checklist_id INTEGER REFERENCES due_diligence_checklists(id) ON DELETE CASCADE,
  label VARCHAR(255) NOT NULL,
  artifact_id UUID,
  status VARCHAR(16) NOT NULL DEFAULT 'requested',
  required BOOLEAN NOT NULL DEFAULT true,
  reviewer_ref VARCHAR(64),
  reviewed_at TIMESTAMP,
  note TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_due_diligence_documents_checklist ON due_diligence_documents (checklist_id, position);

CREATE TABLE IF NOT EXISTS investment_opportunities (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  object_id UUID REFERENCES objects(id) ON DELETE CASCADE,
  company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  name VARCHAR(255) NOT NULL,
  round VARCHAR(48),
  ask_amount NUMERIC(18, 2),
  pre_money NUMERIC(18, 2),
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  status VARCHAR(16) NOT NULL DEFAULT 'sourced',
  lead_ref VARCHAR(64),
  conviction NUMERIC(5, 2),
  pass_reason TEXT,
  decided_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_investment_opportunities_status ON investment_opportunities (tenant_id, status, updated_at);

CREATE TABLE IF NOT EXISTS investor_peer_comparables (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  peer_name VARCHAR(255) NOT NULL,
  sector VARCHAR(120),
  revenue NUMERIC(18, 2),
  growth_rate NUMERIC(6, 2),
  multiple NUMERIC(8, 2),
  valuation NUMERIC(18, 2),
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  source VARCHAR(96),
  as_of TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_investor_peer_comparables_company ON investor_peer_comparables (tenant_id, company_id, as_of);

CREATE TABLE IF NOT EXISTS validation_dashboards (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  object_id UUID REFERENCES objects(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  name VARCHAR(255) NOT NULL,
  hypothesis TEXT,
  metrics JSONB NOT NULL DEFAULT '[]',
  status VARCHAR(16) NOT NULL DEFAULT 'running',
  started_at TIMESTAMP,
  concluded_at TIMESTAMP,
  conclusion TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_validation_dashboards_name ON validation_dashboards (tenant_id, name);

CREATE TABLE IF NOT EXISTS validation_data_imports (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  dashboard_id INTEGER REFERENCES validation_dashboards(id) ON DELETE CASCADE,
  source VARCHAR(96) NOT NULL,
  artifact_id UUID,
  row_count INTEGER NOT NULL DEFAULT 0,
  mapping JSONB,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  imported_at TIMESTAMP,
  last_error TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_validation_data_imports_dashboard ON validation_data_imports (dashboard_id, imported_at);

CREATE TABLE IF NOT EXISTS scratch_pad_attachments (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  pad_object_id UUID REFERENCES objects(id) ON DELETE CASCADE,
  artifact_id UUID,
  label VARCHAR(255),
  placement JSONB,
  added_by VARCHAR(64),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_scratch_pad_attachments_pad ON scratch_pad_attachments (pad_object_id);

CREATE TABLE IF NOT EXISTS modules (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER,
  key VARCHAR(64) NOT NULL,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  domain VARCHAR(32),
  required_rung INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_modules_key ON modules (tenant_id, key);

-- Tenancy foreign keys (PRD 20 §4 — every table carries tenant_id).
ALTER TABLE companies DROP CONSTRAINT IF EXISTS fk_companies_tenant;
ALTER TABLE companies ADD CONSTRAINT fk_companies_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE products DROP CONSTRAINT IF EXISTS fk_products_tenant;
ALTER TABLE products ADD CONSTRAINT fk_products_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE product_ideas DROP CONSTRAINT IF EXISTS fk_product_ideas_tenant;
ALTER TABLE product_ideas ADD CONSTRAINT fk_product_ideas_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE data_rooms DROP CONSTRAINT IF EXISTS fk_data_rooms_tenant;
ALTER TABLE data_rooms ADD CONSTRAINT fk_data_rooms_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE due_diligence_checklists DROP CONSTRAINT IF EXISTS fk_due_diligence_checklists_tenant;
ALTER TABLE due_diligence_checklists ADD CONSTRAINT fk_due_diligence_checklists_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE due_diligence_documents DROP CONSTRAINT IF EXISTS fk_due_diligence_documents_tenant;
ALTER TABLE due_diligence_documents ADD CONSTRAINT fk_due_diligence_documents_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE investment_opportunities DROP CONSTRAINT IF EXISTS fk_investment_opportunities_tenant;
ALTER TABLE investment_opportunities ADD CONSTRAINT fk_investment_opportunities_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE investor_peer_comparables DROP CONSTRAINT IF EXISTS fk_investor_peer_comparables_tenant;
ALTER TABLE investor_peer_comparables ADD CONSTRAINT fk_investor_peer_comparables_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE validation_dashboards DROP CONSTRAINT IF EXISTS fk_validation_dashboards_tenant;
ALTER TABLE validation_dashboards ADD CONSTRAINT fk_validation_dashboards_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE validation_data_imports DROP CONSTRAINT IF EXISTS fk_validation_data_imports_tenant;
ALTER TABLE validation_data_imports ADD CONSTRAINT fk_validation_data_imports_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE scratch_pad_attachments DROP CONSTRAINT IF EXISTS fk_scratch_pad_attachments_tenant;
ALTER TABLE scratch_pad_attachments ADD CONSTRAINT fk_scratch_pad_attachments_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE modules DROP CONSTRAINT IF EXISTS fk_modules_tenant;
ALTER TABLE modules ADD CONSTRAINT fk_modules_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
