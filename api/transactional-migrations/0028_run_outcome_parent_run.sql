-- 0028 · A sub-agent's outcome row names its owner (run_model_outcomes.parent_run_id) — PRD 35
-- §8.2, WS5. run_model_outcomes lives on THIS (operational) track; the primary track carries the
-- same additive column in migrations/1285_run_outcome_parent_run.sql so both copies agree.
-- client_run_id is already the row's own run id; parent_run_id holds the OWNER's client_run_id.
-- Additive + nullable: rows written before this stay valid (NULL = an owner's row).
ALTER TABLE run_model_outcomes ADD COLUMN IF NOT EXISTS parent_run_id VARCHAR(128);
