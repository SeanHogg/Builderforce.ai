-- 0262_outbound_fetch_log.sql
-- Consumption ledger for the Brain's outbound URL fetch proxy
-- (POST /api/brain/fetch-url). The endpoint is a tenant-authed but otherwise
-- arbitrary outbound GET proxy; beyond the per-tenant rate limit, this ledger
-- meters sustained volume so free-vs-paid caps outbound fetches (the
-- `outbound_fetches` consumption meter). One row per fetch that hit the wire.
--
-- Mirrors error_events / ingestion_usage_log: COUNT(*) over a window is the
-- metered quantity, and the daily grouping powers the meter sparkline.
-- Idempotent / re-runnable: CREATE TABLE IF NOT EXISTS + guarded indexes.

CREATE TABLE IF NOT EXISTS outbound_fetch_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- The URL actually fetched (post-redirect), for audit/debug. Not indexed.
  url         text,
  created_at  timestamp NOT NULL DEFAULT now()
);

-- The window-sum the meter + the cap gate share (tenant + created_at range).
CREATE INDEX IF NOT EXISTS idx_outbound_fetch_log_tenant_created
  ON outbound_fetch_log(tenant_id, created_at);
