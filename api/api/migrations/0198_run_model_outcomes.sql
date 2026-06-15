-- 0198_run_model_outcomes.sql
-- Learned Model Routing (PRD 13), phase 1 — the OUTCOME fact table.
--
-- One row per TERMINAL cloud run (keyed uniquely by execution_id), joining the run's
-- (action_type, resolved_model) to a composite 0..1 outcome score (PR merged + green
-- CI + finished-without-degradation + efficiency). This is the durable source of
-- truth the analytics panel and the derived `routing:<scope>` KV blob read from; the
-- blob is a cache that the reconcile job rebuilds from a single grouped query over
-- this table, so losing the blob costs one reconcile, never correctness.
CREATE TABLE IF NOT EXISTS run_model_outcomes (
  id                  serial PRIMARY KEY,
  tenant_id           integer REFERENCES tenants(id) ON DELETE SET NULL,
  project_id          integer REFERENCES projects(id) ON DELETE SET NULL,
  task_id             integer REFERENCES tasks(id) ON DELETE SET NULL,
  execution_id        integer NOT NULL,
  cloud_agent_ref     varchar(64),
  action_type         varchar(32) NOT NULL DEFAULT 'other',
  resolved_model      varchar(200) NOT NULL,
  plan                varchar(16) NOT NULL,
  score               real NOT NULL,
  merged              boolean NOT NULL DEFAULT false,
  ci_green            boolean NOT NULL DEFAULT false,
  degraded            boolean NOT NULL DEFAULT false,
  steps               integer NOT NULL DEFAULT 0,
  cost_usd_millicents integer NOT NULL DEFAULT 0,
  terminal_status     varchar(16) NOT NULL,
  created_at          timestamp NOT NULL DEFAULT now()
);

-- One outcome per run — the scorer upserts on this so it is idempotent across the
-- multiple terminal paths (worker finalize, durable terminal tick, container fail).
CREATE UNIQUE INDEX IF NOT EXISTS run_model_outcomes_execution_id_uidx
  ON run_model_outcomes (execution_id);

-- Analytics + reconcile read paths: rank models per (scope, action_type).
CREATE INDEX IF NOT EXISTS run_model_outcomes_tenant_action_model_idx
  ON run_model_outcomes (tenant_id, action_type, resolved_model);
CREATE INDEX IF NOT EXISTS run_model_outcomes_project_action_idx
  ON run_model_outcomes (project_id, action_type);
