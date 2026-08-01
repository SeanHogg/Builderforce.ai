-- Operational database baseline.
-- References to primary-database entities are scalar IDs by design: PostgreSQL
-- cannot enforce foreign keys across separate Neon accounts.

CREATE TABLE IF NOT EXISTS api_error_log (
  id serial PRIMARY KEY, method varchar(10), path varchar(500), message text,
  stack text, created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS llm_failover_log (
  id serial PRIMARY KEY, model varchar(200) NOT NULL, error_code integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS llm_health_probes (
  id serial PRIMARY KEY, vendor varchar(32) NOT NULL, status varchar(16) NOT NULL,
  probed_count integer NOT NULL DEFAULT 0, ok_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0, latency_ms integer NOT NULL DEFAULT 0,
  models_json jsonb NOT NULL DEFAULT '[]'::jsonb, trigger varchar(16) NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS llm_usage_log (
  id serial PRIMARY KEY, tenant_id integer, user_id varchar(36),
  llm_product varchar(32) NOT NULL DEFAULT 'builderforceLLM', model varchar(200) NOT NULL,
  prompt_tokens integer NOT NULL DEFAULT 0, completion_tokens integer NOT NULL DEFAULT 0,
  total_tokens integer NOT NULL DEFAULT 0, cache_read_tokens integer NOT NULL DEFAULT 0,
  cache_creation_tokens integer NOT NULL DEFAULT 0, retries integer NOT NULL DEFAULT 0,
  streamed boolean NOT NULL DEFAULT false, metadata text, idempotency_key varchar(128),
  use_case varchar(128), tenant_api_key_id uuid, agent_host_id integer,
  cloud_agent_ref varchar(64), execution_id integer, task_id integer, project_id integer,
  cost_usd_millicents integer NOT NULL DEFAULT 0, trace_id varchar(48),
  paid_overflow boolean NOT NULL DEFAULT false, byo boolean NOT NULL DEFAULT false,
  byo_provider varchar(32), surface varchar(16) NOT NULL DEFAULT 'web',
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tx_llm_usage_tenant_time ON llm_usage_log(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tx_llm_usage_idempotency ON llm_usage_log(tenant_id, idempotency_key, created_at);

CREATE TABLE IF NOT EXISTS ingestion_usage_log (
  id serial PRIMARY KEY, tenant_id integer, project_id integer,
  source varchar(32) NOT NULL DEFAULT 'repo_import', provider varchar(32),
  bytes_ingested bigint NOT NULL DEFAULT 0, items_ingested integer NOT NULL DEFAULT 0,
  metadata text, created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tx_ingestion_tenant_time ON ingestion_usage_log(tenant_id, created_at);

CREATE TABLE IF NOT EXISTS llm_traces (
  id serial PRIMARY KEY, trace_id varchar(48) NOT NULL UNIQUE, tenant_id integer,
  user_id varchar(36), agent_host_id integer, tenant_api_key_id uuid,
  llm_product varchar(32), surface varchar(16) NOT NULL DEFAULT 'chat',
  effective_plan varchar(8), premium_override boolean NOT NULL DEFAULT false,
  resolved_model varchar(200), resolved_vendor varchar(32), status integer,
  success boolean NOT NULL DEFAULT false, outcome varchar(32), classification varchar(16),
  attempt_count integer NOT NULL DEFAULT 0, retries integer NOT NULL DEFAULT 0,
  schema_retries integer NOT NULL DEFAULT 0, duration_ms integer NOT NULL DEFAULT 0,
  prompt_tokens integer NOT NULL DEFAULT 0, completion_tokens integer NOT NULL DEFAULT 0,
  total_tokens integer NOT NULL DEFAULT 0, use_case varchar(128), idempotency_key varchar(128),
  consumer_request_id varchar(128), request_ip varchar(64), origin varchar(255),
  user_agent text, streamed boolean NOT NULL DEFAULT false, error_message text,
  request_shape text, candidate_chain text, attempts text, request_body text,
  response_body text, caller_metadata text, created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tx_llm_traces_tenant_time ON llm_traces(tenant_id, created_at);

CREATE TABLE IF NOT EXISTS activity_log (
  id bigserial PRIMARY KEY, tenant_id integer, segment_id uuid, project_id integer,
  actor_type varchar(16) NOT NULL, actor_ref varchar(64), actor_name varchar(255),
  engagement_id varchar(36), verb varchar(64) NOT NULL, target_type varchar(32),
  target_id varchar(64), target_label varchar(300), summary text, metadata jsonb,
  occurred_at timestamp NOT NULL DEFAULT now(), created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_activity_log_tenant_time ON activity_log(tenant_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_activity_log_actor ON activity_log(tenant_id, actor_type, actor_ref, occurred_at);
CREATE INDEX IF NOT EXISTS idx_activity_log_target ON activity_log(tenant_id, target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_project ON activity_log(tenant_id, project_id, occurred_at);
