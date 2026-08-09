-- Immutable agent definitions, per-run principals, delegated capabilities, and
-- pre-declared blast-radius limits.
CREATE TABLE IF NOT EXISTS agent_definition_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source_kind VARCHAR(32) NOT NULL, source_ref VARCHAR(128) NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0), fingerprint VARCHAR(64) NOT NULL,
  definition JSONB NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, source_kind, source_ref, version),
  UNIQUE (tenant_id, source_kind, source_ref, fingerprint)
);
CREATE INDEX IF NOT EXISTS idx_agent_definition_versions_source ON agent_definition_versions(tenant_id, source_kind, source_ref, version DESC);

ALTER TABLE executions ADD COLUMN IF NOT EXISTS agent_definition_version_id UUID REFERENCES agent_definition_versions(id) ON DELETE RESTRICT;
ALTER TABLE agent_dispatches ADD COLUMN IF NOT EXISTS agent_definition_version_id UUID REFERENCES agent_definition_versions(id) ON DELETE RESTRICT;
ALTER TABLE rehearsals ADD COLUMN IF NOT EXISTS agent_definition_version_id UUID REFERENCES agent_definition_versions(id) ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS agent_run_principals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  execution_id INTEGER NOT NULL UNIQUE REFERENCES executions(id) ON DELETE CASCADE,
  agent_definition_version_id UUID REFERENCES agent_definition_versions(id) ON DELETE RESTRICT,
  status VARCHAR(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked','expired')),
  issued_by VARCHAR(128) NOT NULL, expires_at TIMESTAMP NOT NULL, revoked_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agent_run_principals_tenant_status ON agent_run_principals(tenant_id, status, expires_at);

CREATE TABLE IF NOT EXISTS agent_capability_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  principal_id UUID NOT NULL REFERENCES agent_run_principals(id) ON DELETE CASCADE,
  capability VARCHAR(128) NOT NULL, resource_pattern VARCHAR(512), created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_capability_grants ON agent_capability_grants(principal_id, capability, COALESCE(resource_pattern, ''));

CREATE TABLE IF NOT EXISTS agent_credential_delegations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  principal_id UUID NOT NULL REFERENCES agent_run_principals(id) ON DELETE CASCADE,
  credential_kind VARCHAR(32) NOT NULL, credential_ref VARCHAR(128) NOT NULL,
  scopes JSONB NOT NULL DEFAULT '[]'::jsonb, expires_at TIMESTAMP NOT NULL,
  revoked_at TIMESTAMP, created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agent_credential_delegations_principal ON agent_credential_delegations(tenant_id, principal_id, expires_at);

CREATE TABLE IF NOT EXISTS execution_limits (
  execution_id INTEGER PRIMARY KEY REFERENCES executions(id) ON DELETE CASCADE,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  max_files INTEGER CHECK (max_files IS NULL OR max_files >= 0),
  max_repositories INTEGER CHECK (max_repositories IS NULL OR max_repositories >= 0),
  max_spend_millicents INTEGER CHECK (max_spend_millicents IS NULL OR max_spend_millicents >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_execution_limits_tenant ON execution_limits(tenant_id, execution_id);

CREATE OR REPLACE FUNCTION reject_agent_identity_history_mutation() RETURNS TRIGGER AS $$
BEGIN RAISE EXCEPTION 'agent identity history is immutable'; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_agent_definition_versions_immutable ON agent_definition_versions;
CREATE TRIGGER trg_agent_definition_versions_immutable BEFORE UPDATE OR DELETE ON agent_definition_versions FOR EACH ROW EXECUTE FUNCTION reject_agent_identity_history_mutation();
DROP TRIGGER IF EXISTS trg_agent_capability_grants_immutable ON agent_capability_grants;
CREATE TRIGGER trg_agent_capability_grants_immutable BEFORE UPDATE OR DELETE ON agent_capability_grants FOR EACH ROW EXECUTE FUNCTION reject_agent_identity_history_mutation();
