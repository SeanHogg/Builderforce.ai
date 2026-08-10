-- 0426_agents_and_runtime_domain_targets.sql
--
-- Agents and runtime domain targets
--
-- GENERATED from src/infrastructure/database/schema/agents.ts by
-- scripts/gen-consolidation-migration.mjs (PRD 20 §5 step 2). Edit the Drizzle
-- module and regenerate; do not hand-edit the DDL, or the two sources of truth
-- this file exists to collapse come straight back.
--
-- 10 table(s). Idempotent: replayable against an environment at any
-- point in the sequence.

CREATE TABLE IF NOT EXISTS answer_cache (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER,
  key_hash VARCHAR(64) NOT NULL,
  model VARCHAR(96),
  answer TEXT,
  payload JSONB,
  tokens_saved INTEGER NOT NULL DEFAULT 0,
  hit_count INTEGER NOT NULL DEFAULT 0,
  last_hit_at TIMESTAMP,
  expires_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_answer_cache_key ON answer_cache (tenant_id, key_hash);
CREATE INDEX IF NOT EXISTS idx_answer_cache_expiry ON answer_cache (expires_at);

CREATE TABLE IF NOT EXISTS enrichment_cache (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER,
  provider VARCHAR(64) NOT NULL,
  request_hash VARCHAR(64) NOT NULL,
  payload JSONB,
  cost_cents_avoided INTEGER NOT NULL DEFAULT 0,
  hit_count INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_enrichment_cache_request ON enrichment_cache (provider, request_hash);
CREATE INDEX IF NOT EXISTS idx_enrichment_cache_expiry ON enrichment_cache (expires_at);

CREATE TABLE IF NOT EXISTS geocoder_cache (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER,
  query_hash VARCHAR(64) NOT NULL,
  query VARCHAR(500),
  latitude NUMERIC(9, 6),
  longitude NUMERIC(9, 6),
  country VARCHAR(2),
  region VARCHAR(120),
  locality VARCHAR(160),
  provider VARCHAR(48),
  hit_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_geocoder_cache_query ON geocoder_cache (query_hash);

CREATE TABLE IF NOT EXISTS model_locks (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER,
  model VARCHAR(96) NOT NULL,
  pool_key VARCHAR(96) NOT NULL DEFAULT 'default',
  holder_ref VARCHAR(64) NOT NULL,
  acquired_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL,
  released_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_model_locks_pool ON model_locks (model, pool_key);
CREATE INDEX IF NOT EXISTS idx_model_locks_expiry ON model_locks (expires_at);

CREATE TABLE IF NOT EXISTS ai_tool_calls (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  run_ref VARCHAR(64),
  message_ref VARCHAR(64),
  tool_name VARCHAR(96) NOT NULL,
  arguments JSONB,
  result JSONB,
  outcome VARCHAR(16) NOT NULL DEFAULT 'ok',
  error TEXT,
  latency_ms INTEGER,
  called_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_tool_calls_run ON ai_tool_calls (tenant_id, run_ref, called_at);
CREATE INDEX IF NOT EXISTS idx_ai_tool_calls_tool ON ai_tool_calls (tenant_id, tool_name, outcome);

CREATE TABLE IF NOT EXISTS ai_usage_records (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  run_ref VARCHAR(64),
  vendor VARCHAR(48) NOT NULL,
  model VARCHAR(96) NOT NULL,
  is_byo BOOLEAN NOT NULL DEFAULT false,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cached_tokens INTEGER NOT NULL DEFAULT 0,
  cost_cents NUMERIC(14, 4) NOT NULL DEFAULT '0',
  latency_ms INTEGER,
  occurred_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_records_tenant ON ai_usage_records (tenant_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_ai_usage_records_model ON ai_usage_records (tenant_id, vendor, model, occurred_at);

CREATE TABLE IF NOT EXISTS ai_email_classifications (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  message_ref VARCHAR(64) NOT NULL,
  label VARCHAR(32) NOT NULL,
  confidence NUMERIC(4, 2),
  intent VARCHAR(96),
  entities JSONB,
  model VARCHAR(96),
  corrected_label VARCHAR(32),
  corrected_by VARCHAR(64),
  classified_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_email_classifications_message ON ai_email_classifications (tenant_id, message_ref, model);
CREATE INDEX IF NOT EXISTS idx_ai_email_classifications_label ON ai_email_classifications (tenant_id, label, classified_at);

CREATE TABLE IF NOT EXISTS ai_voice_agent_calls (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  object_id UUID REFERENCES objects(id) ON DELETE CASCADE,
  agent_ref VARCHAR(64),
  phone_number_ref VARCHAR(64),
  direction VARCHAR(12) NOT NULL DEFAULT 'inbound',
  counterparty VARCHAR(40),
  started_at TIMESTAMP,
  ended_at TIMESTAMP,
  duration_sec INTEGER,
  outcome VARCHAR(16),
  transferred_to VARCHAR(64),
  recording_artifact_id UUID,
  cost_cents NUMERIC(12, 4),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_voice_agent_calls_tenant ON ai_voice_agent_calls (tenant_id, started_at);

CREATE TABLE IF NOT EXISTS ai_competitors (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  name VARCHAR(200) NOT NULL,
  website VARCHAR(255),
  category VARCHAR(96),
  positioning TEXT,
  strengths JSONB,
  weaknesses JSONB,
  pricing_summary TEXT,
  last_reviewed_at TIMESTAMP,
  watch_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_competitors_name ON ai_competitors (tenant_id, name);

CREATE TABLE IF NOT EXISTS workflow_actions (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  workflow_ref VARCHAR(64) NOT NULL,
  node_id VARCHAR(96) NOT NULL,
  kind VARCHAR(32) NOT NULL,
  label VARCHAR(200),
  config JSONB,
  connection_id INTEGER,
  action_key VARCHAR(96),
  position INTEGER NOT NULL DEFAULT 0,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_actions_node ON workflow_actions (tenant_id, workflow_ref, node_id);

-- Tenancy foreign keys (PRD 20 §4 — every table carries tenant_id).
ALTER TABLE answer_cache DROP CONSTRAINT IF EXISTS fk_answer_cache_tenant;
ALTER TABLE answer_cache ADD CONSTRAINT fk_answer_cache_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE enrichment_cache DROP CONSTRAINT IF EXISTS fk_enrichment_cache_tenant;
ALTER TABLE enrichment_cache ADD CONSTRAINT fk_enrichment_cache_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE geocoder_cache DROP CONSTRAINT IF EXISTS fk_geocoder_cache_tenant;
ALTER TABLE geocoder_cache ADD CONSTRAINT fk_geocoder_cache_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE model_locks DROP CONSTRAINT IF EXISTS fk_model_locks_tenant;
ALTER TABLE model_locks ADD CONSTRAINT fk_model_locks_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE ai_tool_calls DROP CONSTRAINT IF EXISTS fk_ai_tool_calls_tenant;
ALTER TABLE ai_tool_calls ADD CONSTRAINT fk_ai_tool_calls_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE ai_usage_records DROP CONSTRAINT IF EXISTS fk_ai_usage_records_tenant;
ALTER TABLE ai_usage_records ADD CONSTRAINT fk_ai_usage_records_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE ai_email_classifications DROP CONSTRAINT IF EXISTS fk_ai_email_classifications_tenant;
ALTER TABLE ai_email_classifications ADD CONSTRAINT fk_ai_email_classifications_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE ai_voice_agent_calls DROP CONSTRAINT IF EXISTS fk_ai_voice_agent_calls_tenant;
ALTER TABLE ai_voice_agent_calls ADD CONSTRAINT fk_ai_voice_agent_calls_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE ai_competitors DROP CONSTRAINT IF EXISTS fk_ai_competitors_tenant;
ALTER TABLE ai_competitors ADD CONSTRAINT fk_ai_competitors_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE workflow_actions DROP CONSTRAINT IF EXISTS fk_workflow_actions_tenant;
ALTER TABLE workflow_actions ADD CONSTRAINT fk_workflow_actions_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
