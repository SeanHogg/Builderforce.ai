-- 0283_run_outcome_client_source.sql
-- Learned Model Routing (PRD 13) — let NON-cloud runs contribute outcomes.
--
-- Until now `run_model_outcomes` only recorded TERMINAL cloud runs (keyed by a
-- NOT NULL `execution_id`). IDE-native / on-prem / external-SDK runs go through
-- the gateway but never create a cloud `executions` row, so their (action_type,
-- model) → success signal was lost to the learner. This migration lets those
-- clients POST an outcome (see `POST /llm/v1/run-outcome`):
--   • `source`         — where the outcome came from ('cloud' | 'onprem' | 'ide' | 'external').
--   • `client_run_id`  — the client's own idempotency key (no cloud execution id).
--   • `execution_id`   — now NULLABLE (client runs have none).
--
-- Idempotent / re-runnable: ADD COLUMN IF NOT EXISTS, DROP NOT NULL, and a
-- PARTIAL UNIQUE INDEX so a client run upserts on `client_run_id` while cloud
-- runs keep upserting on `execution_id`.

ALTER TABLE run_model_outcomes
  ADD COLUMN IF NOT EXISTS source varchar(16) NOT NULL DEFAULT 'cloud';

ALTER TABLE run_model_outcomes
  ADD COLUMN IF NOT EXISTS client_run_id varchar(128);

-- Client runs have no cloud execution id.
ALTER TABLE run_model_outcomes
  ALTER COLUMN execution_id DROP NOT NULL;

-- Idempotency for client-reported outcomes (one row per client_run_id). Partial
-- so the many cloud rows with a NULL client_run_id don't collide.
CREATE UNIQUE INDEX IF NOT EXISTS run_model_outcomes_client_run_id_key
  ON run_model_outcomes (client_run_id)
  WHERE client_run_id IS NOT NULL;

-- Analytics can split learned-routing quality by where the run executed.
CREATE INDEX IF NOT EXISTS run_model_outcomes_source_idx
  ON run_model_outcomes (tenant_id, source, action_type);
