-- 0019 · Per-turn cost telemetry on the usage ledger — mirror of migrations/1253.
-- See that file for the column meanings. Additive, nullable, no backfill.

ALTER TABLE llm_usage_log ADD COLUMN IF NOT EXISTS reasoning_tokens INTEGER;
ALTER TABLE llm_usage_log ADD COLUMN IF NOT EXISTS turn_index INTEGER;
ALTER TABLE llm_usage_log ADD COLUMN IF NOT EXISTS tool_schema_tokens INTEGER;
