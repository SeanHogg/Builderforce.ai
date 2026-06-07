-- 0088_tenant_provider_keys.sql
-- BYO LLM provider keys: a tenant can store its own Anthropic (or other vendor)
-- API key so the gateway proxies model calls with the tenant's key + meters them.
-- The key is encrypted at rest (AES-GCM with JWT_SECRET, same as MCP secrets);
-- only `key_enc` is stored, never plaintext.
CREATE TABLE IF NOT EXISTS tenant_llm_provider_keys (
  tenant_id          INTEGER     NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider           TEXT        NOT NULL,
  key_enc            TEXT        NOT NULL,
  created_by_user_id TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, provider)
);
