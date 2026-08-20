-- 0007 — the `premium` flag on the OPERATIONAL copy of `llm_usage_log`.
--
-- The primary twin is api/migrations/0952_premium_daily_cap.sql, which also adds
-- `tenants.premium_daily_cap`. Only the usage column is repeated here: `tenants`
-- lives solely on the primary track, and this database holds no foreign keys back
-- to it (PostgreSQL cannot enforce them across two Neon accounts).
--
-- This is the track the rows actually land on in a deployment that binds
-- NEON_TRANSACTIONAL_DATABASE_URL — i.e. production — so without this file the
-- premium daily cap would sum a column that does not exist where the spend is
-- recorded, and would therefore never fire.
--
-- WHY A COLUMN AND NOT A jsonb KEY: premium-ness was only ever stamped as
-- `metadata.premiumSurchargeMillicents`, which is neither indexable nor summable
-- without a full scan. A cap that cannot be measured cheaply is a cap that gets
-- disabled the first time it costs latency.

ALTER TABLE llm_usage_log ADD COLUMN IF NOT EXISTS premium BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_llm_usage_log_premium
  ON llm_usage_log(tenant_id, created_at) WHERE premium = TRUE;
