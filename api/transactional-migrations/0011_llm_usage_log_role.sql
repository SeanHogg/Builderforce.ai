-- 0011 · `llm_usage_log.role` — mirrors main-track migration 1167.
--
-- This operational database keeps its own copy of `llm_usage_log` (see
-- 0001_operational_ledger.sql's header: no cross-account FK is possible between
-- Neon accounts), so a column added to the main schema needs the same ALTER here.
-- Nullable, same reasoning as the main-track migration: no producer backfill is
-- honest for a row written before role existed.

ALTER TABLE llm_usage_log ADD COLUMN IF NOT EXISTS role varchar(16);

COMMENT ON COLUMN llm_usage_log.role IS
  'Call-purpose role this call resolved as, when the producer knew it (mirrors main-track migration 1167) — null for most rows until role adoption widens past the cloud engine''s spawn_agent delegations.';
