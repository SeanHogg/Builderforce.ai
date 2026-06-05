-- Add prompt-cache token accounting to llm_usage_log.
--
-- When the upstream is a caching provider (Anthropic via OpenRouter), the
-- gateway previously collapsed cached input into `prompt_tokens` and never
-- recorded the breakdown, so cost accounting charged cache reads at the full
-- input rate (Anthropic bills cache reads at ~0.1x, cache creation at ~1.25x).
--
-- `cache_read_tokens` and `cache_creation_tokens` are a SUBSET of `prompt_tokens`
-- (OpenAI usage shape) — they are not additive to it. They are populated from
-- the vendor usage block (`cache_read_input_tokens` / `cache_creation_input_tokens`
-- on Anthropic-native, or `prompt_tokens_details.cached_tokens` on the
-- OpenAI/OpenRouter-normalized shape). Downstream billing can discount
-- `cache_read_tokens` at 0.1x once it reads these columns.
--
-- Idempotent + backfill-safe: NOT NULL DEFAULT 0 so historical rows read as
-- "no cache activity recorded", which is correct for pre-caching traffic.

ALTER TABLE llm_usage_log ADD COLUMN IF NOT EXISTS cache_read_tokens     integer NOT NULL DEFAULT 0;
ALTER TABLE llm_usage_log ADD COLUMN IF NOT EXISTS cache_creation_tokens integer NOT NULL DEFAULT 0;
