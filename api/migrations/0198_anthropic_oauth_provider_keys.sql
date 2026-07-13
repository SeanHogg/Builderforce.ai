-- 0198_anthropic_oauth_provider_keys.sql
-- BYO Claude SUBSCRIPTION auth: a tenant can connect their own Claude Pro/Max
-- subscription (OAuth) instead of pasting an Anthropic API key, so the gateway
-- runs their BuilderForce-V2 (Claude Agent SDK) agents on the tenant's OWN
-- subscription at $0 marginal token cost.
--
-- The existing `tenant_llm_provider_keys.key_enc` stores either:
--   • an API key (auth_type='api_key', the original behaviour), or
--   • an encrypted JSON blob `{access, refresh, expires}` (auth_type='oauth').
-- `auth_type` is the discriminator the storage layer reads to decode key_enc and
-- the gateway reads to pick the auth header (x-api-key vs Bearer + oauth beta).
--
-- IMPORTANT (policy): an OAuth credential is a personal subscription token, valid
-- ONLY for the connecting tenant's own use — never resold/shared across tenants.
--
-- Idempotent / re-runnable: ADD COLUMN IF NOT EXISTS, with a default that keeps
-- every existing row (all API keys) correct without a backfill.
ALTER TABLE tenant_llm_provider_keys
  ADD COLUMN IF NOT EXISTS auth_type TEXT NOT NULL DEFAULT 'api_key';
