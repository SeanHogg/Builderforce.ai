-- Migration 0047: Origin allowlist for tenant API keys (browser-safe key model).
--
-- A `bfk_*` key with no allowlist is a server-only key — any request that
-- carries an `Origin` header (i.e. came from a browser) is rejected. To use
-- the key from a browser, the owner must register the origins explicitly:
--   ['https://hired.video', 'https://*.hired.video', 'http://localhost:3000']
-- The single literal `'*'` opens the key to any origin (escape hatch).
--
-- Storing as JSONB so the array is queryable without a join table; tiny
-- partial index on the not-null path keeps the auth check fast.
--
-- Idempotent: safe to re-run.

ALTER TABLE tenant_api_keys
  ADD COLUMN IF NOT EXISTS allowed_origins JSONB;

CREATE INDEX IF NOT EXISTS idx_tenant_api_keys_allowed_origins
  ON tenant_api_keys USING GIN (allowed_origins)
  WHERE allowed_origins IS NOT NULL;
