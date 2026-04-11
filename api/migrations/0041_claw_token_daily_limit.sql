-- Migration: add per-claw daily token budget column
-- token_daily_limit: optional integer cap on tokens consumed per calendar day.
-- NULL means no per-claw cap (the tenant plan-level limit still applies).

ALTER TABLE coderclaw_instances ADD COLUMN IF NOT EXISTS token_daily_limit INTEGER;
