-- Migration 0043: Tenant API keys (bfk_*) for the builderforceLLM gateway.
--
-- Tenant-scoped, long-lived API key issued from the portal for tenant apps
-- (hired.video, burnrateos, 3rd-party customers) to call /llm/v1/chat/completions
-- without minting a fake CoderClaw or holding a short-lived web JWT.
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS tenant_api_keys (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           INTEGER      NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                VARCHAR(255) NOT NULL,
  key_hash            VARCHAR(64)  NOT NULL UNIQUE,
  created_by_user_id  VARCHAR(36)  REFERENCES users(id) ON DELETE SET NULL,
  last_used_at        TIMESTAMPTZ,
  revoked_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenant_api_keys_tenant_id ON tenant_api_keys(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_api_keys_hash      ON tenant_api_keys(key_hash);
