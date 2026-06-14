-- Migration: per-tenant paid-overflow daily cap (T3 · Gateway & LLM, band 0130–0139).
--
-- The gateway always appends a premium-fallback chain + reliability backstop to
-- every cascade so a saturated free pool never surfaces a hard LLM_UNAVAILABLE.
-- Those funded calls run on Builderforce's OWN GOOGLE/OPENROUTER keys, so a
-- Free-plan tenant in a tight retry loop could drive arbitrary spend with no
-- per-tenant ceiling on that path. This adds:
--
--   1. tenants.paid_overflow_daily_cap — a per-tenant daily $ ceiling (millicents)
--      on overflow spend. NULL → plan default (free = $0.50/day; pro/teams
--      effectively unlimited); -1 → unlimited; >=0 → explicit cap.
--   2. llm_usage_log.paid_overflow — marks a usage row as funded-overflow spend
--      (resolved via premium fallback / backstop, not a plan-pool model) so the
--      gate can SUM just the overflow cost per UTC day.
--
-- Once the day's overflow cost reaches the cap the gateway closes the funded
-- overflow path for that tenant for the rest of the UTC day (the tenant's
-- primary pool still runs); it resets at UTC midnight. Preserves the
-- "zero LLM_UNAVAILABLE escapes" guarantee for tenants under their cap.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS paid_overflow_daily_cap INTEGER;

ALTER TABLE llm_usage_log ADD COLUMN IF NOT EXISTS paid_overflow BOOLEAN NOT NULL DEFAULT FALSE;

-- Gate query: SUM(cost_usd_millicents) for one tenant's overflow rows since UTC
-- midnight. Partial index keeps it cheap (only overflow rows are indexed).
CREATE INDEX IF NOT EXISTS idx_llm_usage_log_overflow
  ON llm_usage_log(tenant_id, created_at)
  WHERE paid_overflow = TRUE;
