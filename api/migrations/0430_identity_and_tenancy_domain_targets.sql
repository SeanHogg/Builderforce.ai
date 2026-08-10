-- 0430_identity_and_tenancy_domain_targets.sql
--
-- Identity and tenancy domain targets
--
-- GENERATED from src/infrastructure/database/schema/identity.ts by
-- scripts/gen-consolidation-migration.mjs (PRD 20 §5 step 2). Edit the Drizzle
-- module and regenerate; do not hand-edit the DDL, or the two sources of truth
-- this file exists to collapse come straight back.
--
-- 15 table(s). Idempotent: replayable against an environment at any
-- point in the sequence.

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id INTEGER,
  user_id VARCHAR(64) NOT NULL,
  kind VARCHAR(16) NOT NULL DEFAULT 'web',
  token_hash VARCHAR(64) NOT NULL,
  user_agent VARCHAR(500),
  ip_address VARCHAR(45),
  device_label VARCHAR(160),
  location VARCHAR(160),
  last_seen_at TIMESTAMP,
  expires_at TIMESTAMP,
  revoked_at TIMESTAMP,
  revoked_by VARCHAR(64),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sessions_token ON sessions (token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (tenant_id, user_id, revoked_at);

CREATE TABLE IF NOT EXISTS extension_sessions (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER,
  session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
  extension_version VARCHAR(32),
  vscode_version VARCHAR(32),
  workspace_name VARCHAR(255),
  workspace_hash VARCHAR(64),
  repo_remote VARCHAR(500),
  branch VARCHAR(255),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_extension_sessions_session ON extension_sessions (session_id);

CREATE TABLE IF NOT EXISTS workspace_grants (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  workspace_ref VARCHAR(64) NOT NULL,
  grantee_kind VARCHAR(16) NOT NULL DEFAULT 'user',
  grantee_ref VARCHAR(64) NOT NULL,
  access VARCHAR(16) NOT NULL DEFAULT 'read',
  path_scope JSONB,
  granted_by VARCHAR(64),
  expires_at TIMESTAMP,
  revoked_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_workspace_grants_grantee ON workspace_grants (tenant_id, workspace_ref, grantee_kind, grantee_ref);

CREATE TABLE IF NOT EXISTS countries (
  id SERIAL PRIMARY KEY,
  code VARCHAR(2) NOT NULL,
  code3 VARCHAR(3),
  name VARCHAR(120) NOT NULL,
  region VARCHAR(64),
  currency VARCHAR(8),
  calling_code VARCHAR(8),
  is_supported BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_countries_code ON countries (code);

CREATE TABLE IF NOT EXISTS stage_lookup (
  id SERIAL PRIMARY KEY,
  key VARCHAR(48) NOT NULL,
  label VARCHAR(120) NOT NULL,
  category VARCHAR(32) NOT NULL DEFAULT 'company',
  position INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_stage_lookup_key ON stage_lookup (category, key);

CREATE TABLE IF NOT EXISTS availability_slots (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  owner_ref VARCHAR(64) NOT NULL,
  kind VARCHAR(16) NOT NULL DEFAULT 'recurring',
  weekday INTEGER,
  starts_at TIMESTAMP,
  ends_at TIMESTAMP,
  start_minute INTEGER,
  end_minute INTEGER,
  timezone VARCHAR(64) NOT NULL DEFAULT 'UTC',
  connection_id INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_availability_slots_owner ON availability_slots (tenant_id, owner_ref, kind);

CREATE TABLE IF NOT EXISTS onboarding_flows (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER,
  key VARCHAR(64) NOT NULL,
  name VARCHAR(200) NOT NULL,
  audience VARCHAR(32) NOT NULL DEFAULT 'signup',
  description TEXT,
  is_default BOOLEAN NOT NULL DEFAULT false,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_onboarding_flows_key ON onboarding_flows (tenant_id, key);

CREATE TABLE IF NOT EXISTS onboarding_checklists (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER,
  flow_id INTEGER REFERENCES onboarding_flows(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  summary TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  is_required BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_onboarding_checklists_pos ON onboarding_checklists (flow_id, position);

CREATE TABLE IF NOT EXISTS onboarding_tasks (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER,
  checklist_id INTEGER REFERENCES onboarding_checklists(id) ON DELETE CASCADE,
  key VARCHAR(64) NOT NULL,
  title VARCHAR(300) NOT NULL,
  description TEXT,
  action_href VARCHAR(500),
  completion_kind VARCHAR(16) NOT NULL DEFAULT 'manual',
  completion_rule JSONB,
  position INTEGER NOT NULL DEFAULT 0,
  is_required BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_onboarding_tasks_key ON onboarding_tasks (checklist_id, key);

CREATE TABLE IF NOT EXISTS onboarding_progress (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  flow_id INTEGER REFERENCES onboarding_flows(id) ON DELETE CASCADE,
  task_id INTEGER REFERENCES onboarding_tasks(id) ON DELETE CASCADE,
  subject_ref VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  completed_at TIMESTAMP,
  skipped_reason VARCHAR(200),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_onboarding_progress_subject ON onboarding_progress (tenant_id, task_id, subject_ref);
CREATE INDEX IF NOT EXISTS idx_onboarding_progress_flow ON onboarding_progress (tenant_id, flow_id, subject_ref);

CREATE TABLE IF NOT EXISTS region_waitlist (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER,
  email VARCHAR(320) NOT NULL,
  country VARCHAR(2),
  region VARCHAR(120),
  source VARCHAR(64),
  status VARCHAR(16) NOT NULL DEFAULT 'waiting',
  invited_at TIMESTAMP,
  joined_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_region_waitlist_email ON region_waitlist (email, country);

CREATE TABLE IF NOT EXISTS user_badges (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  user_ref VARCHAR(64) NOT NULL,
  badge_key VARCHAR(64) NOT NULL,
  awarded_by VARCHAR(64),
  evidence JSONB,
  awarded_at TIMESTAMP NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMP,
  is_public BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_badges_badge ON user_badges (tenant_id, user_ref, badge_key);

CREATE TABLE IF NOT EXISTS user_stock_media_usage (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  user_ref VARCHAR(64) NOT NULL,
  stock_asset_id INTEGER,
  artifact_id UUID,
  used_at TIMESTAMP NOT NULL DEFAULT NOW(),
  cost_cents INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_stock_media_usage_user ON user_stock_media_usage (tenant_id, user_ref, used_at);

CREATE TABLE IF NOT EXISTS user_terms_agreements (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  signatory_ref VARCHAR(64) NOT NULL,
  document_kind VARCHAR(32) NOT NULL,
  document_version VARCHAR(32) NOT NULL,
  signatory_title VARCHAR(160),
  legal_entity_name VARCHAR(255),
  agreed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  superseded_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_terms_agreements_version ON user_terms_agreements (tenant_id, document_kind, document_version);

CREATE TABLE IF NOT EXISTS session_discussions (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  object_id UUID REFERENCES objects(id) ON DELETE CASCADE,
  session_ref VARCHAR(64) NOT NULL,
  topic VARCHAR(300) NOT NULL,
  thread_id UUID,
  raised_by VARCHAR(64),
  status VARCHAR(16) NOT NULL DEFAULT 'open',
  position INTEGER NOT NULL DEFAULT 0,
  carried_to_ref VARCHAR(64),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_session_discussions_session ON session_discussions (tenant_id, session_ref, position);

-- Tenancy foreign keys (PRD 20 §4 — every table carries tenant_id).
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS fk_sessions_tenant;
ALTER TABLE sessions ADD CONSTRAINT fk_sessions_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE extension_sessions DROP CONSTRAINT IF EXISTS fk_extension_sessions_tenant;
ALTER TABLE extension_sessions ADD CONSTRAINT fk_extension_sessions_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE workspace_grants DROP CONSTRAINT IF EXISTS fk_workspace_grants_tenant;
ALTER TABLE workspace_grants ADD CONSTRAINT fk_workspace_grants_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE availability_slots DROP CONSTRAINT IF EXISTS fk_availability_slots_tenant;
ALTER TABLE availability_slots ADD CONSTRAINT fk_availability_slots_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE onboarding_flows DROP CONSTRAINT IF EXISTS fk_onboarding_flows_tenant;
ALTER TABLE onboarding_flows ADD CONSTRAINT fk_onboarding_flows_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE onboarding_checklists DROP CONSTRAINT IF EXISTS fk_onboarding_checklists_tenant;
ALTER TABLE onboarding_checklists ADD CONSTRAINT fk_onboarding_checklists_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE onboarding_tasks DROP CONSTRAINT IF EXISTS fk_onboarding_tasks_tenant;
ALTER TABLE onboarding_tasks ADD CONSTRAINT fk_onboarding_tasks_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE onboarding_progress DROP CONSTRAINT IF EXISTS fk_onboarding_progress_tenant;
ALTER TABLE onboarding_progress ADD CONSTRAINT fk_onboarding_progress_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE region_waitlist DROP CONSTRAINT IF EXISTS fk_region_waitlist_tenant;
ALTER TABLE region_waitlist ADD CONSTRAINT fk_region_waitlist_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE user_badges DROP CONSTRAINT IF EXISTS fk_user_badges_tenant;
ALTER TABLE user_badges ADD CONSTRAINT fk_user_badges_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE user_stock_media_usage DROP CONSTRAINT IF EXISTS fk_user_stock_media_usage_tenant;
ALTER TABLE user_stock_media_usage ADD CONSTRAINT fk_user_stock_media_usage_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE user_terms_agreements DROP CONSTRAINT IF EXISTS fk_user_terms_agreements_tenant;
ALTER TABLE user_terms_agreements ADD CONSTRAINT fk_user_terms_agreements_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE session_discussions DROP CONSTRAINT IF EXISTS fk_session_discussions_tenant;
ALTER TABLE session_discussions ADD CONSTRAINT fk_session_discussions_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
