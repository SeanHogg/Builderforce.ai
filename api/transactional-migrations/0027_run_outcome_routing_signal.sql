-- 0027 · Whether a scored run teaches the routing table (run_model_outcomes.routing_signal).
-- run_model_outcomes lives on THIS (operational) track; the primary track carries the same
-- additive column in migrations/1284_run_outcome_routing_signal.sql so both copies agree.
-- Additive + defaulted TRUE: rows written before this stay valid and keep teaching.
ALTER TABLE run_model_outcomes ADD COLUMN IF NOT EXISTS routing_signal BOOLEAN NOT NULL DEFAULT TRUE;
