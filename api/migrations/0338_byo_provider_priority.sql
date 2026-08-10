-- 0338_byo_provider_priority.sql
--
-- BYO provider PRECEDENCE. When a tenant connects more than one of their own
-- frontier accounts (Anthropic / OpenAI / Google / Meta), the auto-select cloud
-- pin previously ordered the connected flagships by catalog TIER only. This adds
-- a tenant-set precedence so an operator can, e.g., put **Meta first** and have
-- cloud agents lead with it (and fail over across the rest in that order) — the
-- direct answer to "I'm at 75% of my Anthropic usage; route through Meta instead".
--
-- `priority`: LOWER number = tried FIRST (0 = top). NULL = unset → falls back to
-- catalog-tier ordering (today's behaviour), so existing rows are unaffected.
--
-- Idempotent: guarded with IF NOT EXISTS so re-running is safe.

ALTER TABLE tenant_llm_provider_keys ADD COLUMN IF NOT EXISTS priority INTEGER;
