-- 1285 · A sub-agent's outcome row names its owner (PRD 35 §8.2, WS5) — the CORE-track mirror of
-- transactional-migrations/0028_run_outcome_parent_run.sql (same convention as 1282 <-> 0025).
--
-- run_model_outcomes.client_run_id is already the row's own run id, so only the owner pointer is
-- new: parent_run_id holds the owner's client_run_id, and a child is one more row of the owner's
-- tree, never a second run of it. NULL for an owner (and for every row written before this).
--
-- Expand only, IF NOT EXISTS, nullable: a no-op wherever the column exists, old rows stay valid.
-- Numbers: origin/main ends at 1283 / 0026; ws4-canvas takes 1284 / 0027, so this takes 1285 / 0028.
ALTER TABLE run_model_outcomes ADD COLUMN IF NOT EXISTS parent_run_id VARCHAR(128);
