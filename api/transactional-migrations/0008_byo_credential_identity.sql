-- 0008 — `byo_credential_id` on the OPERATIONAL copy of `llm_usage_log`.
--
-- The primary twin is api/migrations/0953_byo_credential_identity.sql, which also
-- adds the surrogate `id` to `tenant_llm_provider_keys`. Only the usage column is
-- repeated here: the credential table lives solely on the primary track, and this
-- database holds no foreign keys back to it (PostgreSQL cannot enforce them across
-- two Neon accounts).
--
-- This is the track the rows actually land on in a deployment that binds
-- NEON_TRANSACTIONAL_DATABASE_URL — i.e. production — so without this file every
-- per-key attribution query would read a column that does not exist where the
-- spend is recorded.
--
-- Deliberately NOT cascading and deliberately unconstrained: when a credential is
-- deleted its historical spend must stay attributed to the id that incurred it, or
-- deleting a key would silently rewrite last month's numbers.

ALTER TABLE llm_usage_log ADD COLUMN IF NOT EXISTS byo_credential_id UUID;

CREATE INDEX IF NOT EXISTS idx_llm_usage_byo_credential
  ON llm_usage_log (byo_credential_id, created_at DESC)
  WHERE byo_credential_id IS NOT NULL;
