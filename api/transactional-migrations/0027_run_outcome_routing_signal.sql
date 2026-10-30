-- 0027 · Whether a scored run teaches the routing table (run_model_outcomes.routing_signal).
-- run_model_outcomes lives on THIS (operational) track; the primary track carries the same
-- additive column in migrations/1284_run_outcome_routing_signal.sql so both copies agree.
-- Additive + defaulted TRUE: rows written before this stay valid and keep teaching.
ALTER TABLE run_model_outcomes ADD COLUMN IF NOT EXISTS routing_signal BOOLEAN NOT NULL DEFAULT TRUE;
-- cost_usd_millicents is NULLABLE with no default: a run that reported no cost is UNKNOWN, not free
-- (see migrations/1284). Relaxing the constraint is expand-only; existing values are untouched.
ALTER TABLE run_model_outcomes ALTER COLUMN cost_usd_millicents DROP NOT NULL;
ALTER TABLE run_model_outcomes ALTER COLUMN cost_usd_millicents DROP DEFAULT;

-- A run that died because the TENANT ran out of budget (quota) says nothing about the model (see
-- migrations/1284). Additive + defaulted FALSE.
ALTER TABLE run_model_outcomes ADD COLUMN IF NOT EXISTS quota_exhausted BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN run_model_outcomes.quota_exhausted IS
  'TRUE = the run failed because the tenant ran out of quota/budget: not evidence about the model, so routing never learns from it.';

COMMENT ON COLUMN run_model_outcomes.cost_usd_millicents IS
  'Millicents the run cost; NULL = the run reported none (unknown, not zero). Sums and averages skip NULLs.';

COMMENT ON COLUMN run_model_outcomes.routing_signal IS
  'FALSE = recorded for telemetry only: not folded into the routing blob and excluded from reconcile (a Creation Canvas run is not evidence about coding models).';
