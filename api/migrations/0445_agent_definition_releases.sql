CREATE TABLE IF NOT EXISTS agent_definition_releases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source_kind VARCHAR(32) NOT NULL, source_ref VARCHAR(128) NOT NULL,
  stable_version_id UUID NOT NULL REFERENCES agent_definition_versions(id) ON DELETE RESTRICT,
  canary_version_id UUID REFERENCES agent_definition_versions(id) ON DELETE RESTRICT,
  canary_percent INTEGER NOT NULL DEFAULT 0 CHECK (canary_percent BETWEEN 0 AND 100),
  updated_by VARCHAR(128), created_at TIMESTAMP NOT NULL DEFAULT NOW(), updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, source_kind, source_ref)
);
CREATE TABLE IF NOT EXISTS agent_definition_promotions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source_kind VARCHAR(32) NOT NULL, source_ref VARCHAR(128) NOT NULL,
  from_version_id UUID REFERENCES agent_definition_versions(id) ON DELETE RESTRICT,
  to_version_id UUID NOT NULL REFERENCES agent_definition_versions(id) ON DELETE RESTRICT,
  action VARCHAR(16) NOT NULL, actor_ref VARCHAR(128), created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agent_definition_promotions_source ON agent_definition_promotions(tenant_id, source_kind, source_ref, created_at DESC);
CREATE TRIGGER trg_agent_definition_promotions_immutable BEFORE UPDATE OR DELETE ON agent_definition_promotions FOR EACH ROW EXECUTE FUNCTION reject_agent_identity_history_mutation();
