-- 0197_learned_model_routing.sql
-- Learned Model Routing (PRD 13) — persist the per-task action-type label and one
-- scored outcome row per terminal cloud run, so the router can learn which model
-- best serves each (action_type, plan) scope instead of a static default.
--
-- Closes the schema drift that failed CI: `schema.ts` declared
-- `tasks.action_type` / `tasks.action_type_confidence` and the `run_model_outcomes`
-- table, but no migration created them — so a file-based deploy (migrate.mjs) never
-- provisioned them and `scoreRunOutcome` would write into a table that does not
-- exist. The migration + schema.ts now land together, eliminating the drift window.
--
-- Idempotent / re-runnable: ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT EXISTS,
-- CREATE UNIQUE INDEX IF NOT EXISTS.

-- ── tasks: cached action-type classification ────────────────────────────────
--  action_type            — label a free classifier assigns ONCE per task; re-runs
--                           reuse it. Null = unclassified (router treats as 'other').
--  action_type_confidence — classifier's 0..1 self-report, so low-confidence labels
--                           can be re-classified later without a schema change.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS action_type            VARCHAR(32);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS action_type_confidence REAL;

-- ── run_model_outcomes: one row per TERMINAL cloud run ──────────────────────
-- Joins (action_type, resolved_model, plan) to a composite 0..1 outcome score.
-- The durable source of truth analytics + the derived `routing:<scope>` KV blob
-- read from. Idempotent on execution_id (the scorer upserts via ON CONFLICT, so
-- the UNIQUE index below is REQUIRED, not optional).
CREATE TABLE IF NOT EXISTS run_model_outcomes (
  id                  SERIAL PRIMARY KEY,
  tenant_id           INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
  project_id          INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  task_id             INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  -- The terminal cloud run this scores. No FK — executions is pruned independently
  -- and a scored outcome should survive the run row.
  execution_id        INTEGER NOT NULL,
  cloud_agent_ref     VARCHAR(64),
  action_type         VARCHAR(32)  NOT NULL DEFAULT 'other',
  resolved_model      VARCHAR(200) NOT NULL,
  plan                VARCHAR(16)  NOT NULL,
  score               REAL         NOT NULL,
  merged              BOOLEAN      NOT NULL DEFAULT FALSE,
  ci_green            BOOLEAN      NOT NULL DEFAULT FALSE,
  degraded            BOOLEAN      NOT NULL DEFAULT FALSE,
  steps               INTEGER      NOT NULL DEFAULT 0,
  cost_usd_millicents INTEGER      NOT NULL DEFAULT 0,
  terminal_status     VARCHAR(16)  NOT NULL,
  created_at          TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- Backs the scorer's `onConflictDoNothing({ target: execution_id })` upsert.
CREATE UNIQUE INDEX IF NOT EXISTS run_model_outcomes_execution_id_key
  ON run_model_outcomes (execution_id);

-- Common analytics read: outcomes scoped by tenant + action_type + plan.
CREATE INDEX IF NOT EXISTS run_model_outcomes_scope_idx
  ON run_model_outcomes (tenant_id, action_type, plan);
