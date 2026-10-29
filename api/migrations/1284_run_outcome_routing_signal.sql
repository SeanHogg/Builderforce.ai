-- 1284 · Whether a scored run teaches the routing table (run_model_outcomes.routing_signal).
--
-- Learned routing folds every scored outcome into byAction[<action type>] at project,
-- tenant and global scope, and cloud CODE runs read that ranking. A Creation Canvas turn
-- reports its PRD 35 §8.2 uniform row through the same door as a coding run, but it is not
-- evidence about coding models: it must be recorded for telemetry and never ranked.
-- FALSE rows are skipped by the live fold and excluded from every reconcile query, so a
-- rebuild cannot re-admit them.
--
-- Additive + defaulted (TRUE): every existing row keeps teaching exactly as before.
-- Expand now; nothing contracts. The operational track's copy (the table's live home) is
-- transactional-migrations/0027_run_outcome_routing_signal.sql — same DDL on both tracks.
ALTER TABLE run_model_outcomes
  ADD COLUMN IF NOT EXISTS routing_signal BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN run_model_outcomes.routing_signal IS
  'FALSE = recorded for telemetry only: not folded into the routing blob and excluded from reconcile (a Creation Canvas run is not evidence about coding models).';
