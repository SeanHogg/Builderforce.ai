-- Connector platform — breadth of integrations without a code change per system.
--
-- WHY: the platform had exactly two ways to reach an external system, and both
-- cost more than a customer will pay for one integration:
--   1. a hand-written board adapter (application/boardsync/providerCatalog) —
--      a code change, a review and a deploy per system;
--   2. a tenant MCP extension (tenant_mcp_extensions) — the customer has to
--      BUILD, HOST AND OPERATE an MCP server before they can call one API.
-- Competitors ship 1,200–8,500 connectors because theirs are DATA. These tables
-- make ours data too: a connector is a manifest (base URL, auth shape, actions),
-- authorable in the UI or generated from an OpenAPI spec, executed by one shared
-- runtime that owns SSRF guarding, credential decryption and audit logging.
--
-- Built-in connectors are deliberately NOT seeded here. They live in
-- application/connectors/defaults/ as code, so correcting a path or adding an
-- action ships with the deploy instead of needing a per-tenant data migration —
-- and a tenant created before the fix can never be stuck on a stale copy.

-- Tenant-authored connector definitions. Built-ins are absent by design.
CREATE TABLE IF NOT EXISTS connectors (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connector_key       VARCHAR(64) NOT NULL,
  name                VARCHAR(255) NOT NULL,
  category            VARCHAR(32) NOT NULL DEFAULT 'other',
  icon                VARCHAR(16) NOT NULL DEFAULT '🔌',
  -- 'draft' is editable but NOT advertised to agents; 'published' is live. A
  -- half-written connector must never appear in a model's tool list.
  status              VARCHAR(16) NOT NULL DEFAULT 'draft',
  manifest            JSONB NOT NULL,
  version             INTEGER NOT NULL DEFAULT 1,
  created_by_user_id  VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_connectors_tenant_key UNIQUE (tenant_id, connector_key)
);

CREATE INDEX IF NOT EXISTS idx_connectors_tenant_status ON connectors (tenant_id, status);

-- One credentialed instance of a connector. Keyed by connector_key rather than a
-- FK so a tenant can connect a BUILT-IN (which has no row in `connectors`) and a
-- custom connector through exactly the same path.
CREATE TABLE IF NOT EXISTS connector_connections (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connector_key       VARCHAR(64) NOT NULL,
  name                VARCHAR(255) NOT NULL,
  -- AES-256-GCM, per-tenant derived key (application/integrations/credentialCrypto).
  credentials_enc     TEXT NOT NULL,
  iv                  VARCHAR(64) NOT NULL,
  base_url_override   VARCHAR(500),
  enabled             BOOLEAN NOT NULL DEFAULT TRUE,
  last_tested_at      TIMESTAMP,
  last_test_ok        BOOLEAN,
  last_used_at        TIMESTAMP,
  created_by_user_id  VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_connector_connections_tenant_key_name UNIQUE (tenant_id, connector_key, name)
);

CREATE INDEX IF NOT EXISTS idx_connector_connections_tenant ON connector_connections (tenant_id, enabled);

-- Audit trail for outbound connector calls. Records the SHAPE of each call and
-- never its body: connector payloads routinely carry customer PII, and the auth
-- values are secret. This is what answers "what did the agent do in our CRM?".
CREATE TABLE IF NOT EXISTS connector_call_logs (
  id             BIGSERIAL PRIMARY KEY,
  tenant_id      INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connection_id  UUID REFERENCES connector_connections(id) ON DELETE CASCADE,
  connector_key  VARCHAR(64) NOT NULL,
  action_key     VARCHAR(64) NOT NULL,
  ok             BOOLEAN NOT NULL,
  status_code    INTEGER,
  duration_ms    INTEGER,
  error          TEXT,
  actor_kind     VARCHAR(16) NOT NULL DEFAULT 'agent',
  created_at     TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_connector_call_logs_tenant_time ON connector_call_logs (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_connector_call_logs_connection ON connector_call_logs (connection_id, created_at);
