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
--
-- Also: cost_usd_millicents becomes NULLABLE with no default. A run that never reported its
-- cost (a canvas turn, a client run with no gateway cost) is UNKNOWN, not free; storing 0
-- made it read as the cheapest run in every average. Existing rows keep the value they have
-- (a 0 already written stays a 0); the writers pass the cost explicitly, so the default was
-- never relied on. Relaxing a constraint is expand-only: nothing is dropped or rewritten.
-- Expand now; nothing contracts. The operational track's copy (the table's live home) is
-- transactional-migrations/0027_run_outcome_routing_signal.sql — same DDL on both tracks.
ALTER TABLE run_model_outcomes
  ADD COLUMN IF NOT EXISTS routing_signal BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE run_model_outcomes ALTER COLUMN cost_usd_millicents DROP NOT NULL;
ALTER TABLE run_model_outcomes ALTER COLUMN cost_usd_millicents DROP DEFAULT;

-- A run that died because the TENANT ran out of budget (quota) says nothing about the model: stored,
-- never taught. Additive + defaulted FALSE.
ALTER TABLE run_model_outcomes
  ADD COLUMN IF NOT EXISTS quota_exhausted BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN run_model_outcomes.quota_exhausted IS
  'TRUE = the run failed because the tenant ran out of quota/budget: not evidence about the model, so routing never learns from it.';

COMMENT ON COLUMN run_model_outcomes.cost_usd_millicents IS
  'Millicents the run cost; NULL = the run reported none (unknown, not zero). Sums and averages skip NULLs.';

COMMENT ON COLUMN run_model_outcomes.routing_signal IS
  'FALSE = recorded for telemetry only: not folded into the routing blob and excluded from reconcile (a Creation Canvas run is not evidence about coding models).';
