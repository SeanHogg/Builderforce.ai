-- 0427_platform_observability_domain_targets.sql
--
-- Platform observability domain targets
--
-- GENERATED from src/infrastructure/database/schema/platform.ts by
-- scripts/gen-consolidation-migration.mjs (PRD 20 §5 step 2). Edit the Drizzle
-- module and regenerate; do not hand-edit the DDL, or the two sources of truth
-- this file exists to collapse come straight back.
--
-- 9 table(s). Idempotent: replayable against an environment at any
-- point in the sequence.

CREATE TABLE IF NOT EXISTS uptime_monitors (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  name VARCHAR(200) NOT NULL,
  kind VARCHAR(16) NOT NULL DEFAULT 'http',
  target TEXT NOT NULL,
  method VARCHAR(8) NOT NULL DEFAULT 'GET',
  expect_status INTEGER NOT NULL DEFAULT 200,
  expect_body VARCHAR(500),
  interval_sec INTEGER NOT NULL DEFAULT 300,
  timeout_ms INTEGER NOT NULL DEFAULT 10000,
  regions JSONB,
  fail_threshold INTEGER NOT NULL DEFAULT 2,
  enabled BOOLEAN NOT NULL DEFAULT true,
  current_status VARCHAR(16) NOT NULL DEFAULT 'unknown',
  last_checked_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_uptime_monitors_name ON uptime_monitors (tenant_id, name);
CREATE INDEX IF NOT EXISTS idx_uptime_monitors_due ON uptime_monitors (enabled, last_checked_at);

CREATE TABLE IF NOT EXISTS uptime_checks (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  monitor_id INTEGER REFERENCES uptime_monitors(id) ON DELETE CASCADE,
  region VARCHAR(32),
  status VARCHAR(16) NOT NULL,
  status_code INTEGER,
  latency_ms INTEGER,
  error TEXT,
  checked_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_uptime_checks_monitor ON uptime_checks (monitor_id, checked_at);

CREATE TABLE IF NOT EXISTS metric_thresholds (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  metric VARCHAR(96) NOT NULL,
  dimension_key VARCHAR(200) NOT NULL DEFAULT '',
  comparator VARCHAR(16) NOT NULL,
  value NUMERIC(24, 6) NOT NULL,
  severity VARCHAR(16) NOT NULL DEFAULT 'warning',
  sustain_buckets INTEGER NOT NULL DEFAULT 1,
  notify JSONB,
  enabled BOOLEAN NOT NULL DEFAULT true,
  last_fired_at TIMESTAMP,
  cooldown_min INTEGER NOT NULL DEFAULT 60,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_metric_thresholds_metric ON metric_thresholds (tenant_id, metric, dimension_key, comparator, value);
CREATE INDEX IF NOT EXISTS idx_metric_thresholds_enabled ON metric_thresholds (tenant_id, enabled);

CREATE TABLE IF NOT EXISTS dashboard_layouts (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  object_id UUID REFERENCES objects(id) ON DELETE CASCADE,
  owner_ref VARCHAR(64),
  surface VARCHAR(32) NOT NULL DEFAULT 'platform',
  name VARCHAR(200) NOT NULL,
  layout JSONB NOT NULL DEFAULT '[]',
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_shared BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_dashboard_layouts_name ON dashboard_layouts (tenant_id, owner_ref, surface, name);

CREATE TABLE IF NOT EXISTS report_approvals (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  report_ref VARCHAR(64) NOT NULL,
  artifact_id UUID,
  approver_ref VARCHAR(64) NOT NULL,
  decision VARCHAR(16) NOT NULL DEFAULT 'pending',
  comment TEXT,
  decided_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_report_approvals_approver ON report_approvals (tenant_id, report_ref, approver_ref);

CREATE TABLE IF NOT EXISTS system_features (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER,
  key VARCHAR(96) NOT NULL,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  stage VARCHAR(16) NOT NULL DEFAULT 'off',
  rollout_percent INTEGER NOT NULL DEFAULT 0,
  allow_list JSONB,
  domain VARCHAR(32),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_system_features_key ON system_features (key);

CREATE TABLE IF NOT EXISTS platform_pricing (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER,
  plan_code VARCHAR(64) NOT NULL,
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  monthly_cents INTEGER NOT NULL DEFAULT 0,
  yearly_cents INTEGER NOT NULL DEFAULT 0,
  region VARCHAR(16) NOT NULL DEFAULT 'global',
  effective_from TIMESTAMP NOT NULL DEFAULT NOW(),
  effective_to TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_pricing_plan ON platform_pricing (plan_code, region, effective_from);

CREATE TABLE IF NOT EXISTS queue_job_to_process (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER,
  queue VARCHAR(64) NOT NULL DEFAULT 'default',
  job_kind VARCHAR(96) NOT NULL,
  payload JSONB,
  priority INTEGER NOT NULL DEFAULT 0,
  run_after TIMESTAMP NOT NULL DEFAULT NOW(),
  claimed_by VARCHAR(64),
  claimed_at TIMESTAMP,
  lease_expires_at TIMESTAMP,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  last_error TEXT,
  status VARCHAR(16) NOT NULL DEFAULT 'queued',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_queue_job_to_process_ready ON queue_job_to_process (status, queue, priority, run_after);
CREATE INDEX IF NOT EXISTS idx_queue_job_to_process_lease ON queue_job_to_process (status, lease_expires_at);

CREATE TABLE IF NOT EXISTS queue_job_to_resume (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER,
  run_ref VARCHAR(64),
  resume_kind VARCHAR(96) NOT NULL,
  continuation JSONB,
  awaiting_kind VARCHAR(32) NOT NULL,
  awaiting_ref VARCHAR(128),
  wake_at TIMESTAMP,
  status VARCHAR(16) NOT NULL DEFAULT 'waiting',
  resumed_at TIMESTAMP,
  expires_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_queue_job_to_resume_wake ON queue_job_to_resume (status, wake_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_queue_job_to_resume_awaiting ON queue_job_to_resume (awaiting_kind, awaiting_ref);

-- Tenancy foreign keys (PRD 20 §4 — every table carries tenant_id).
ALTER TABLE uptime_monitors DROP CONSTRAINT IF EXISTS fk_uptime_monitors_tenant;
ALTER TABLE uptime_monitors ADD CONSTRAINT fk_uptime_monitors_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE uptime_checks DROP CONSTRAINT IF EXISTS fk_uptime_checks_tenant;
ALTER TABLE uptime_checks ADD CONSTRAINT fk_uptime_checks_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE metric_thresholds DROP CONSTRAINT IF EXISTS fk_metric_thresholds_tenant;
ALTER TABLE metric_thresholds ADD CONSTRAINT fk_metric_thresholds_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE dashboard_layouts DROP CONSTRAINT IF EXISTS fk_dashboard_layouts_tenant;
ALTER TABLE dashboard_layouts ADD CONSTRAINT fk_dashboard_layouts_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE report_approvals DROP CONSTRAINT IF EXISTS fk_report_approvals_tenant;
ALTER TABLE report_approvals ADD CONSTRAINT fk_report_approvals_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE system_features DROP CONSTRAINT IF EXISTS fk_system_features_tenant;
ALTER TABLE system_features ADD CONSTRAINT fk_system_features_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE platform_pricing DROP CONSTRAINT IF EXISTS fk_platform_pricing_tenant;
ALTER TABLE platform_pricing ADD CONSTRAINT fk_platform_pricing_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE queue_job_to_process DROP CONSTRAINT IF EXISTS fk_queue_job_to_process_tenant;
ALTER TABLE queue_job_to_process ADD CONSTRAINT fk_queue_job_to_process_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE queue_job_to_resume DROP CONSTRAINT IF EXISTS fk_queue_job_to_resume_tenant;
ALTER TABLE queue_job_to_resume ADD CONSTRAINT fk_queue_job_to_resume_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
