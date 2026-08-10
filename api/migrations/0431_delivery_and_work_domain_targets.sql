-- 0431_delivery_and_work_domain_targets.sql
--
-- Delivery and work domain targets
--
-- GENERATED from src/infrastructure/database/schema/delivery.ts by
-- scripts/gen-consolidation-migration.mjs (PRD 20 §5 step 2). Edit the Drizzle
-- module and regenerate; do not hand-edit the DDL, or the two sources of truth
-- this file exists to collapse come straight back.
--
-- 15 table(s). Idempotent: replayable against an environment at any
-- point in the sequence.

CREATE TABLE IF NOT EXISTS kanban_columns (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  board_ref VARCHAR(64) NOT NULL,
  key VARCHAR(48) NOT NULL,
  label VARCHAR(160) NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  wip_limit INTEGER,
  is_terminal BOOLEAN NOT NULL DEFAULT false,
  auto_run_enabled BOOLEAN NOT NULL DEFAULT false,
  color_token VARCHAR(48),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_kanban_columns_key ON kanban_columns (tenant_id, board_ref, key);

CREATE TABLE IF NOT EXISTS action_items (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  object_id UUID REFERENCES objects(id) ON DELETE CASCADE,
  source_ref VARCHAR(64),
  title VARCHAR(300) NOT NULL,
  detail TEXT,
  owner_ref VARCHAR(64),
  due_at TIMESTAMP,
  status VARCHAR(16) NOT NULL DEFAULT 'open',
  promoted_work_item_ref VARCHAR(64),
  created_by VARCHAR(64),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_action_items_owner ON action_items (tenant_id, owner_ref, status, due_at);

CREATE TABLE IF NOT EXISTS approval_actions (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  subject_kind VARCHAR(32) NOT NULL,
  subject_ref VARCHAR(64) NOT NULL,
  approver_kind VARCHAR(16) NOT NULL DEFAULT 'user',
  approver_ref VARCHAR(64) NOT NULL,
  step INTEGER NOT NULL DEFAULT 1,
  state VARCHAR(16) NOT NULL DEFAULT 'waiting',
  requested_at TIMESTAMP,
  acted_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_approval_actions_approver ON approval_actions (tenant_id, subject_kind, subject_ref, approver_ref, step);

CREATE TABLE IF NOT EXISTS sign_offs (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  subject_kind VARCHAR(32) NOT NULL,
  subject_ref VARCHAR(64) NOT NULL,
  subject_version INTEGER,
  approver_ref VARCHAR(64) NOT NULL,
  decision VARCHAR(32) NOT NULL,
  comment TEXT,
  decided_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sign_offs_subject ON sign_offs (tenant_id, subject_kind, subject_ref, decided_at);

CREATE TABLE IF NOT EXISTS release_plans (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  object_id UUID REFERENCES objects(id) ON DELETE CASCADE,
  project_ref VARCHAR(64),
  name VARCHAR(200) NOT NULL,
  version VARCHAR(48),
  summary TEXT,
  target_at TIMESTAMP,
  released_at TIMESTAMP,
  status VARCHAR(16) NOT NULL DEFAULT 'planned',
  blocked_by_ref VARCHAR(64),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_release_plans_name ON release_plans (tenant_id, project_ref, name);

CREATE TABLE IF NOT EXISTS task_effort_estimates (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  work_item_ref VARCHAR(64) NOT NULL,
  unit VARCHAR(16) NOT NULL DEFAULT 'points',
  value NUMERIC(10, 2),
  tshirt VARCHAR(8),
  estimator_kind VARCHAR(16) NOT NULL DEFAULT 'user',
  estimator_ref VARCHAR(64),
  confidence NUMERIC(4, 2),
  estimated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  is_current BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_task_effort_estimates_item ON task_effort_estimates (tenant_id, work_item_ref, estimated_at);

CREATE TABLE IF NOT EXISTS task_time_entries (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  work_item_ref VARCHAR(64) NOT NULL,
  worker_ref VARCHAR(64) NOT NULL,
  started_at TIMESTAMP,
  ended_at TIMESTAMP,
  minutes INTEGER NOT NULL DEFAULT 0,
  source VARCHAR(12) NOT NULL DEFAULT 'manual',
  is_billable BOOLEAN NOT NULL DEFAULT false,
  note TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_task_time_entries_item ON task_time_entries (tenant_id, work_item_ref, started_at);
CREATE INDEX IF NOT EXISTS idx_task_time_entries_worker ON task_time_entries (tenant_id, worker_ref, started_at);

CREATE TABLE IF NOT EXISTS sync_agenda_items (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  ceremony_ref VARCHAR(64) NOT NULL,
  title VARCHAR(300) NOT NULL,
  detail TEXT,
  owner_ref VARCHAR(64),
  minutes INTEGER,
  position INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sync_agenda_items_pos ON sync_agenda_items (tenant_id, ceremony_ref, position);

CREATE TABLE IF NOT EXISTS sync_conflict_resolutions (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  connection_id INTEGER,
  resource VARCHAR(96) NOT NULL,
  local_ref VARCHAR(64),
  remote_ref VARCHAR(160),
  field VARCHAR(96),
  local_value TEXT,
  remote_value TEXT,
  resolution VARCHAR(16) NOT NULL,
  resolved_by VARCHAR(64),
  resolved_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sync_conflict_resolutions_conn ON sync_conflict_resolutions (tenant_id, connection_id, resolved_at);

CREATE TABLE IF NOT EXISTS bottleneck_analysis (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  project_ref VARCHAR(64),
  stage VARCHAR(64) NOT NULL,
  period_start TIMESTAMP NOT NULL,
  period_end TIMESTAMP NOT NULL,
  items_entered INTEGER NOT NULL DEFAULT 0,
  items_exited INTEGER NOT NULL DEFAULT 0,
  avg_wait_hours NUMERIC(10, 2),
  p90_wait_hours NUMERIC(10, 2),
  cause VARCHAR(24),
  recommendation TEXT,
  computed_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bottleneck_analysis_period ON bottleneck_analysis (tenant_id, project_ref, stage, period_start);

CREATE TABLE IF NOT EXISTS capacity_heatmaps (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  subject_kind VARCHAR(16) NOT NULL DEFAULT 'user',
  subject_ref VARCHAR(64) NOT NULL,
  period_start TIMESTAMP NOT NULL,
  period_end TIMESTAMP NOT NULL,
  capacity_hours NUMERIC(8, 2) NOT NULL DEFAULT '0',
  committed_hours NUMERIC(8, 2) NOT NULL DEFAULT '0',
  utilisation NUMERIC(5, 2),
  band VARCHAR(16),
  computed_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_capacity_heatmaps_subject ON capacity_heatmaps (tenant_id, subject_kind, subject_ref, period_start);

CREATE TABLE IF NOT EXISTS sprint_financial_impact (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  sprint_ref VARCHAR(64) NOT NULL,
  project_ref VARCHAR(64),
  labor_cost NUMERIC(16, 2) NOT NULL DEFAULT '0',
  tooling_cost NUMERIC(16, 2) NOT NULL DEFAULT '0',
  ai_cost NUMERIC(16, 2) NOT NULL DEFAULT '0',
  delivered_value NUMERIC(16, 2),
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  computed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sprint_financial_impact_sprint ON sprint_financial_impact (tenant_id, sprint_ref);

CREATE TABLE IF NOT EXISTS portfolio_companies (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  portfolio_ref VARCHAR(64) NOT NULL,
  company_ref VARCHAR(64) NOT NULL,
  ownership_percent NUMERIC(6, 3),
  invested_amount NUMERIC(18, 2),
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  added_at TIMESTAMP NOT NULL DEFAULT NOW(),
  exited_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_portfolio_companies_company ON portfolio_companies (tenant_id, portfolio_ref, company_ref);

CREATE TABLE IF NOT EXISTS portfolio_items (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  portfolio_ref VARCHAR(64) NOT NULL,
  item_kind VARCHAR(32) NOT NULL,
  item_ref VARCHAR(64) NOT NULL,
  headline VARCHAR(300),
  position INTEGER NOT NULL DEFAULT 0,
  is_featured BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_portfolio_items_item ON portfolio_items (tenant_id, portfolio_ref, item_kind, item_ref);

CREATE TABLE IF NOT EXISTS list_items (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  list_ref VARCHAR(64) NOT NULL,
  item_kind VARCHAR(32) NOT NULL,
  item_ref VARCHAR(64) NOT NULL,
  note TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  added_by VARCHAR(64),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_list_items_item ON list_items (tenant_id, list_ref, item_kind, item_ref);

-- Tenancy foreign keys (PRD 20 §4 — every table carries tenant_id).
ALTER TABLE kanban_columns DROP CONSTRAINT IF EXISTS fk_kanban_columns_tenant;
ALTER TABLE kanban_columns ADD CONSTRAINT fk_kanban_columns_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE action_items DROP CONSTRAINT IF EXISTS fk_action_items_tenant;
ALTER TABLE action_items ADD CONSTRAINT fk_action_items_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE approval_actions DROP CONSTRAINT IF EXISTS fk_approval_actions_tenant;
ALTER TABLE approval_actions ADD CONSTRAINT fk_approval_actions_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE sign_offs DROP CONSTRAINT IF EXISTS fk_sign_offs_tenant;
ALTER TABLE sign_offs ADD CONSTRAINT fk_sign_offs_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE release_plans DROP CONSTRAINT IF EXISTS fk_release_plans_tenant;
ALTER TABLE release_plans ADD CONSTRAINT fk_release_plans_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE task_effort_estimates DROP CONSTRAINT IF EXISTS fk_task_effort_estimates_tenant;
ALTER TABLE task_effort_estimates ADD CONSTRAINT fk_task_effort_estimates_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE task_time_entries DROP CONSTRAINT IF EXISTS fk_task_time_entries_tenant;
ALTER TABLE task_time_entries ADD CONSTRAINT fk_task_time_entries_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE sync_agenda_items DROP CONSTRAINT IF EXISTS fk_sync_agenda_items_tenant;
ALTER TABLE sync_agenda_items ADD CONSTRAINT fk_sync_agenda_items_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE sync_conflict_resolutions DROP CONSTRAINT IF EXISTS fk_sync_conflict_resolutions_tenant;
ALTER TABLE sync_conflict_resolutions ADD CONSTRAINT fk_sync_conflict_resolutions_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE bottleneck_analysis DROP CONSTRAINT IF EXISTS fk_bottleneck_analysis_tenant;
ALTER TABLE bottleneck_analysis ADD CONSTRAINT fk_bottleneck_analysis_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE capacity_heatmaps DROP CONSTRAINT IF EXISTS fk_capacity_heatmaps_tenant;
ALTER TABLE capacity_heatmaps ADD CONSTRAINT fk_capacity_heatmaps_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE sprint_financial_impact DROP CONSTRAINT IF EXISTS fk_sprint_financial_impact_tenant;
ALTER TABLE sprint_financial_impact ADD CONSTRAINT fk_sprint_financial_impact_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE portfolio_companies DROP CONSTRAINT IF EXISTS fk_portfolio_companies_tenant;
ALTER TABLE portfolio_companies ADD CONSTRAINT fk_portfolio_companies_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE portfolio_items DROP CONSTRAINT IF EXISTS fk_portfolio_items_tenant;
ALTER TABLE portfolio_items ADD CONSTRAINT fk_portfolio_items_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE list_items DROP CONSTRAINT IF EXISTS fk_list_items_tenant;
ALTER TABLE list_items ADD CONSTRAINT fk_list_items_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
