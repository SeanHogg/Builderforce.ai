-- 0024 · The run's pipeline route on the usage ledger — mirror of migrations/1277.
-- See that file for the column meanings. Additive, nullable, no backfill.

ALTER TABLE llm_usage_log ADD COLUMN IF NOT EXISTS pipeline_route VARCHAR(8);
ALTER TABLE llm_usage_log ADD COLUMN IF NOT EXISTS route_score REAL;
