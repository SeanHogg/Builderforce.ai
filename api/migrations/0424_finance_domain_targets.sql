-- 0424_finance_domain_targets.sql
--
-- Finance domain targets
--
-- GENERATED from src/infrastructure/database/schema/finance.ts by
-- scripts/gen-consolidation-migration.mjs (PRD 20 §5 step 2). Edit the Drizzle
-- module and regenerate; do not hand-edit the DDL, or the two sources of truth
-- this file exists to collapse come straight back.
--
-- 20 table(s). Idempotent: replayable against an environment at any
-- point in the sequence.

CREATE TABLE IF NOT EXISTS billing_plans (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER,
  kind VARCHAR(24) NOT NULL DEFAULT 'subscription',
  code VARCHAR(64) NOT NULL,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  amount_cents INTEGER NOT NULL DEFAULT 0,
  interval VARCHAR(16) NOT NULL DEFAULT 'monthly',
  trial_days INTEGER NOT NULL DEFAULT 0,
  feature_keys JSONB,
  provider_ref VARCHAR(160),
  is_public BOOLEAN NOT NULL DEFAULT true,
  position INTEGER NOT NULL DEFAULT 0,
  retired_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_plans_code ON billing_plans (tenant_id, code);
CREATE INDEX IF NOT EXISTS idx_billing_plans_public ON billing_plans (is_public, position);

CREATE TABLE IF NOT EXISTS plan_features (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER,
  plan_id INTEGER REFERENCES billing_plans(id) ON DELETE CASCADE,
  feature_key VARCHAR(96) NOT NULL,
  limit_value NUMERIC(20, 4),
  unit VARCHAR(24),
  enforcement VARCHAR(12) NOT NULL DEFAULT 'hard',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_plan_features_key ON plan_features (plan_id, feature_key);

CREATE TABLE IF NOT EXISTS business_pricing_models (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  name VARCHAR(200) NOT NULL,
  model VARCHAR(24) NOT NULL,
  assumptions JSONB,
  base_price NUMERIC(14, 2),
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  is_current BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_business_pricing_models_name ON business_pricing_models (tenant_id, name);

CREATE TABLE IF NOT EXISTS pricing_simulations (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  pricing_model_id INTEGER REFERENCES business_pricing_models(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  inputs JSONB NOT NULL DEFAULT '{}',
  results JSONB,
  projected_mrr NUMERIC(16, 2),
  projected_churn NUMERIC(5, 2),
  run_at TIMESTAMP,
  created_by VARCHAR(64),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pricing_simulations_model ON pricing_simulations (pricing_model_id, run_at);

CREATE TABLE IF NOT EXISTS break_even_scenarios (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  object_id UUID REFERENCES objects(id) ON DELETE CASCADE,
  kind VARCHAR(24) NOT NULL DEFAULT 'break_even',
  name VARCHAR(200) NOT NULL,
  description TEXT,
  horizon_months INTEGER NOT NULL DEFAULT 12,
  projections JSONB,
  break_even_at TIMESTAMP,
  status VARCHAR(16) NOT NULL DEFAULT 'draft',
  is_baseline BOOLEAN NOT NULL DEFAULT false,
  created_by VARCHAR(64),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_break_even_scenarios_name ON break_even_scenarios (tenant_id, name);
CREATE INDEX IF NOT EXISTS idx_break_even_scenarios_kind ON break_even_scenarios (tenant_id, kind, updated_at);

CREATE TABLE IF NOT EXISTS scenario_assumptions (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  scenario_id INTEGER REFERENCES break_even_scenarios(id) ON DELETE CASCADE,
  key VARCHAR(96) NOT NULL,
  label VARCHAR(200),
  value NUMERIC(20, 6),
  unit VARCHAR(24),
  role VARCHAR(16) NOT NULL DEFAULT 'given',
  min_value NUMERIC(20, 6),
  max_value NUMERIC(20, 6),
  note TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_scenario_assumptions_key ON scenario_assumptions (scenario_id, key);

CREATE TABLE IF NOT EXISTS monte_carlo_simulations (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  scenario_id INTEGER REFERENCES break_even_scenarios(id) ON DELETE CASCADE,
  iterations INTEGER NOT NULL DEFAULT 10000,
  seed INTEGER,
  percentiles JSONB,
  histogram JSONB,
  run_at TIMESTAMP,
  duration_ms INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_monte_carlo_simulations_scenario ON monte_carlo_simulations (scenario_id, run_at);

CREATE TABLE IF NOT EXISTS saved_calculations (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  name VARCHAR(200) NOT NULL,
  formula TEXT NOT NULL,
  inputs JSONB,
  result NUMERIC(24, 6),
  unit VARCHAR(24),
  owner_ref VARCHAR(64),
  computed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_saved_calculations_name ON saved_calculations (tenant_id, owner_ref, name);

CREATE TABLE IF NOT EXISTS custom_kpis (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  key VARCHAR(96) NOT NULL,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  unit VARCHAR(24),
  good_direction VARCHAR(8) NOT NULL DEFAULT 'up',
  target NUMERIC(20, 4),
  cadence VARCHAR(16) NOT NULL DEFAULT 'month',
  owner_ref VARCHAR(64),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_custom_kpis_key ON custom_kpis (tenant_id, key);

CREATE TABLE IF NOT EXISTS kpi_formulas (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  kpi_id INTEGER REFERENCES custom_kpis(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  expression TEXT NOT NULL,
  inputs JSONB,
  effective_from TIMESTAMP NOT NULL DEFAULT NOW(),
  effective_to TIMESTAMP,
  created_by VARCHAR(64),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_kpi_formulas_version ON kpi_formulas (kpi_id, version);

CREATE TABLE IF NOT EXISTS expenses (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  object_id UUID REFERENCES objects(id) ON DELETE SET NULL,
  category VARCHAR(96) NOT NULL,
  vendor VARCHAR(200),
  description TEXT,
  amount NUMERIC(16, 2) NOT NULL,
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  incurred_at TIMESTAMP NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'draft',
  submitted_by VARCHAR(64),
  approved_by VARCHAR(64),
  receipt_artifact_id UUID,
  cost_centre VARCHAR(96),
  is_recurring BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_expenses_status ON expenses (tenant_id, status, incurred_at);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses (tenant_id, category, incurred_at);

CREATE TABLE IF NOT EXISTS invoice_line_items (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  invoice_ref VARCHAR(64) NOT NULL,
  description VARCHAR(500) NOT NULL,
  quantity NUMERIC(14, 4) NOT NULL DEFAULT '1',
  unit_amount NUMERIC(16, 4) NOT NULL,
  amount NUMERIC(16, 2) NOT NULL,
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  tax_rate NUMERIC(6, 3),
  tax_amount NUMERIC(16, 2),
  source_kind VARCHAR(32),
  source_ref VARCHAR(64),
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_invoice_line_items_invoice ON invoice_line_items (tenant_id, invoice_ref, position);

CREATE TABLE IF NOT EXISTS payment_methods (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  owner_ref VARCHAR(64),
  provider VARCHAR(48) NOT NULL,
  provider_ref VARCHAR(160) NOT NULL,
  kind VARCHAR(16) NOT NULL DEFAULT 'card',
  brand VARCHAR(32),
  last4 VARCHAR(4),
  exp_month INTEGER,
  exp_year INTEGER,
  is_default BOOLEAN NOT NULL DEFAULT false,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_methods_provider ON payment_methods (tenant_id, provider, provider_ref);

CREATE TABLE IF NOT EXISTS funding_rounds (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  object_id UUID REFERENCES objects(id) ON DELETE CASCADE,
  company_ref VARCHAR(64),
  name VARCHAR(120) NOT NULL,
  instrument VARCHAR(32) NOT NULL DEFAULT 'equity',
  amount_raised NUMERIC(18, 2),
  pre_money NUMERIC(18, 2),
  post_money NUMERIC(18, 2),
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  lead_investor VARCHAR(200),
  closed_at TIMESTAMP,
  status VARCHAR(16) NOT NULL DEFAULT 'open',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_funding_rounds_name ON funding_rounds (tenant_id, company_ref, name);

CREATE TABLE IF NOT EXISTS compensation_structures (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  role_family VARCHAR(96) NOT NULL,
  level VARCHAR(32) NOT NULL,
  location VARCHAR(120),
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  base_min NUMERIC(14, 2),
  base_mid NUMERIC(14, 2),
  base_max NUMERIC(14, 2),
  bonus_percent NUMERIC(5, 2),
  equity_percent NUMERIC(8, 5),
  effective_from TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_compensation_structures_band ON compensation_structures (tenant_id, role_family, level, location);

CREATE TABLE IF NOT EXISTS timesheets (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  worker_ref VARCHAR(64) NOT NULL,
  period_start TIMESTAMP NOT NULL,
  period_end TIMESTAMP NOT NULL,
  hours NUMERIC(8, 2) NOT NULL DEFAULT '0',
  billable_hours NUMERIC(8, 2) NOT NULL DEFAULT '0',
  rate NUMERIC(12, 2),
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  status VARCHAR(16) NOT NULL DEFAULT 'draft',
  approved_by VARCHAR(64),
  submitted_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_timesheets_period ON timesheets (tenant_id, worker_ref, period_start);
CREATE INDEX IF NOT EXISTS idx_timesheets_status ON timesheets (tenant_id, status, period_end);

CREATE TABLE IF NOT EXISTS payback_period (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  subject_kind VARCHAR(32) NOT NULL,
  subject_ref VARCHAR(64) NOT NULL,
  investment NUMERIC(18, 2) NOT NULL,
  monthly_return NUMERIC(18, 2),
  payback_months NUMERIC(8, 2),
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  computed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payback_period_subject ON payback_period (tenant_id, subject_kind, subject_ref);

CREATE TABLE IF NOT EXISTS roi_timeline_entries (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  subject_kind VARCHAR(32) NOT NULL,
  subject_ref VARCHAR(64) NOT NULL,
  period_at TIMESTAMP NOT NULL,
  cost NUMERIC(18, 2) NOT NULL DEFAULT '0',
  benefit NUMERIC(18, 2) NOT NULL DEFAULT '0',
  cumulative NUMERIC(18, 2),
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  note TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_roi_timeline_entries_point ON roi_timeline_entries (tenant_id, subject_kind, subject_ref, period_at);

CREATE TABLE IF NOT EXISTS churn_predictions (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  account_ref VARCHAR(64) NOT NULL,
  probability NUMERIC(5, 4) NOT NULL,
  band VARCHAR(16) NOT NULL,
  drivers JSONB,
  model VARCHAR(96),
  horizon_days INTEGER NOT NULL DEFAULT 90,
  predicted_at TIMESTAMP NOT NULL DEFAULT NOW(),
  outcome VARCHAR(16),
  outcome_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_churn_predictions_band ON churn_predictions (tenant_id, band, predicted_at);
CREATE INDEX IF NOT EXISTS idx_churn_predictions_account ON churn_predictions (tenant_id, account_ref, predicted_at);

CREATE TABLE IF NOT EXISTS point_redemptions (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  member_ref VARCHAR(64) NOT NULL,
  reward_key VARCHAR(96) NOT NULL,
  points_spent INTEGER NOT NULL,
  ledger_ref VARCHAR(160),
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  fulfilled_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_point_redemptions_member ON point_redemptions (tenant_id, member_ref, created_at);

-- Tenancy foreign keys (PRD 20 §4 — every table carries tenant_id).
ALTER TABLE billing_plans DROP CONSTRAINT IF EXISTS fk_billing_plans_tenant;
ALTER TABLE billing_plans ADD CONSTRAINT fk_billing_plans_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE plan_features DROP CONSTRAINT IF EXISTS fk_plan_features_tenant;
ALTER TABLE plan_features ADD CONSTRAINT fk_plan_features_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE business_pricing_models DROP CONSTRAINT IF EXISTS fk_business_pricing_models_tenant;
ALTER TABLE business_pricing_models ADD CONSTRAINT fk_business_pricing_models_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE pricing_simulations DROP CONSTRAINT IF EXISTS fk_pricing_simulations_tenant;
ALTER TABLE pricing_simulations ADD CONSTRAINT fk_pricing_simulations_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE break_even_scenarios DROP CONSTRAINT IF EXISTS fk_break_even_scenarios_tenant;
ALTER TABLE break_even_scenarios ADD CONSTRAINT fk_break_even_scenarios_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE scenario_assumptions DROP CONSTRAINT IF EXISTS fk_scenario_assumptions_tenant;
ALTER TABLE scenario_assumptions ADD CONSTRAINT fk_scenario_assumptions_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE monte_carlo_simulations DROP CONSTRAINT IF EXISTS fk_monte_carlo_simulations_tenant;
ALTER TABLE monte_carlo_simulations ADD CONSTRAINT fk_monte_carlo_simulations_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE saved_calculations DROP CONSTRAINT IF EXISTS fk_saved_calculations_tenant;
ALTER TABLE saved_calculations ADD CONSTRAINT fk_saved_calculations_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE custom_kpis DROP CONSTRAINT IF EXISTS fk_custom_kpis_tenant;
ALTER TABLE custom_kpis ADD CONSTRAINT fk_custom_kpis_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE kpi_formulas DROP CONSTRAINT IF EXISTS fk_kpi_formulas_tenant;
ALTER TABLE kpi_formulas ADD CONSTRAINT fk_kpi_formulas_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE expenses DROP CONSTRAINT IF EXISTS fk_expenses_tenant;
ALTER TABLE expenses ADD CONSTRAINT fk_expenses_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE invoice_line_items DROP CONSTRAINT IF EXISTS fk_invoice_line_items_tenant;
ALTER TABLE invoice_line_items ADD CONSTRAINT fk_invoice_line_items_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE payment_methods DROP CONSTRAINT IF EXISTS fk_payment_methods_tenant;
ALTER TABLE payment_methods ADD CONSTRAINT fk_payment_methods_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE funding_rounds DROP CONSTRAINT IF EXISTS fk_funding_rounds_tenant;
ALTER TABLE funding_rounds ADD CONSTRAINT fk_funding_rounds_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE compensation_structures DROP CONSTRAINT IF EXISTS fk_compensation_structures_tenant;
ALTER TABLE compensation_structures ADD CONSTRAINT fk_compensation_structures_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE timesheets DROP CONSTRAINT IF EXISTS fk_timesheets_tenant;
ALTER TABLE timesheets ADD CONSTRAINT fk_timesheets_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE payback_period DROP CONSTRAINT IF EXISTS fk_payback_period_tenant;
ALTER TABLE payback_period ADD CONSTRAINT fk_payback_period_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE roi_timeline_entries DROP CONSTRAINT IF EXISTS fk_roi_timeline_entries_tenant;
ALTER TABLE roi_timeline_entries ADD CONSTRAINT fk_roi_timeline_entries_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE churn_predictions DROP CONSTRAINT IF EXISTS fk_churn_predictions_tenant;
ALTER TABLE churn_predictions ADD CONSTRAINT fk_churn_predictions_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE point_redemptions DROP CONSTRAINT IF EXISTS fk_point_redemptions_tenant;
ALTER TABLE point_redemptions ADD CONSTRAINT fk_point_redemptions_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
