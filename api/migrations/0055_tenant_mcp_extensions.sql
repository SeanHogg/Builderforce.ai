-- Migration: Tenant MCP extensions — the server-side half of the Brain's
-- extension contract.
--
-- A tenant registers a custom MCP server (URL + optional bearer secret). The
-- LLM gateway advertises that server's tools to the Brain and relays tool calls
-- SERVER-TO-SERVER, so the customer's MCP secret never reaches the browser. The
-- secret is encrypted at rest with JWT_SECRET (AES-GCM, same scheme as MFA
-- secrets). Owner-managed via /api/tenants/:tenantId/mcp-extensions.

CREATE TABLE IF NOT EXISTS tenant_mcp_extensions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                VARCHAR(255) NOT NULL,
  server_url          TEXT NOT NULL,
  secret_enc          TEXT,
  enabled             BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_user_id  VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  last_used_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The gateway looks up enabled extensions for a tenant on every Brain session.
CREATE INDEX IF NOT EXISTS idx_tenant_mcp_extensions_tenant
  ON tenant_mcp_extensions (tenant_id) WHERE enabled = TRUE;
