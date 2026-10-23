-- 1254 · Verifier-cascade outcomes — the D2 difficulty router's training rows
-- (LLM Cost Optimization · D1/D2).
--
-- One row per WEAK-model attempt the D1 verifier cascade judged: which step it was
-- (action type, role, the step's features as the cascade saw them BEFORE the attempt),
-- which weak model tried it, which verifier judged it and whether it passed. Written by
-- `recordCascadeOutcome` (application/llm/difficultyGate.ts); read once a day by the
-- training sweep (application/llm/difficultyTraining.ts), which fits one head per tenant
-- (and a global fallback) and caches it in KV. The hot path never reads this table.
--
-- `features` holds the RAW `DifficultyFeatures` (@builderforce/difficulty-router), not
-- the vector: a change of feature scaling re-featurizes old rows instead of orphaning them.
--
-- References to core entities are plain ids (tenant, execution) — the table is run
-- telemetry, written while an agent runs, like `run_model_outcomes`.

CREATE TABLE IF NOT EXISTS cascade_outcomes (
  id            BIGSERIAL PRIMARY KEY,
  tenant_id     INTEGER NOT NULL,
  execution_id  VARCHAR(128) NOT NULL,
  action_type   VARCHAR(32) NOT NULL,
  role          VARCHAR(16) NOT NULL,
  weak_model    VARCHAR(200) NOT NULL,
  passed        BOOLEAN NOT NULL,
  verifier      VARCHAR(64) NOT NULL,
  features      JSONB NOT NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

-- The training sweep reads each tenant's recent rows, oldest first.
CREATE INDEX IF NOT EXISTS cascade_outcomes_tenant_created_idx
  ON cascade_outcomes (tenant_id, created_at);
