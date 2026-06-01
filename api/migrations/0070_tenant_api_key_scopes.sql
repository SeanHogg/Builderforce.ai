-- Migration 0070: per-scope tenant API keys.
--
-- The cross-domain (channel-3) seams between BurnRateOS and BuilderForce
-- authenticate server-to-server with a tenant API key (bfk_*). The spec
-- (05-integration-embed-and-identity §2.3, §7) requires those service tokens to
-- be scoped to specific endpoints (e.g. `ingest:feedback`, `read:bi.burn`) so a
-- leaked ingest key can't also pull BI data or mint LLM spend.
--
-- `scopes` is a JSON array of scope strings. NULL / empty preserves the existing
-- behaviour: an UNRESTRICTED key with full tenant access (the LLM-gateway keys
-- minted before this migration). A non-empty array restricts the key to exactly
-- those scopes — least privilege for purpose-minted service tokens.
--
-- Idempotent: safe to re-run.

ALTER TABLE tenant_api_keys ADD COLUMN IF NOT EXISTS scopes TEXT;
