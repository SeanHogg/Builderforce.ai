-- 0016 · What memory saved, recorded ON the usage ledger — mirror of migrations/1227.
-- See that file for the column meanings. Additive, defaulted, no backfill.

ALTER TABLE llm_usage_log ADD COLUMN IF NOT EXISTS savings_source VARCHAR(24);
ALTER TABLE llm_usage_log ADD COLUMN IF NOT EXISTS savings_estimated BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE llm_usage_log ADD COLUMN IF NOT EXISTS saved_prompt_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE llm_usage_log ADD COLUMN IF NOT EXISTS saved_completion_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE llm_usage_log ADD COLUMN IF NOT EXISTS recall_prompt_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE llm_usage_log ADD COLUMN IF NOT EXISTS saved_cost_usd_millicents INTEGER NOT NULL DEFAULT 0;
