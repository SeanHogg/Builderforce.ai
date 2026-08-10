-- Provenance for context-window inputs and decisions at outbound content seams.
CREATE TABLE IF NOT EXISTS agent_context_contributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  execution_id INTEGER NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
  source_kind VARCHAR(32) NOT NULL, source_ref VARCHAR(512),
  trust_tier VARCHAR(16) NOT NULL CHECK (trust_tier IN ('operator','tenant','repository','external')),
  content_hash VARCHAR(64) NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agent_context_contributions_execution ON agent_context_contributions(tenant_id, execution_id, created_at);

CREATE TABLE IF NOT EXISTS agent_outbound_inspections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  execution_id INTEGER NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
  seam VARCHAR(32) NOT NULL, target VARCHAR(512), verdict VARCHAR(16) NOT NULL,
  reasons JSONB NOT NULL DEFAULT '[]'::jsonb, content_hash VARCHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agent_outbound_inspections_execution ON agent_outbound_inspections(tenant_id, execution_id, created_at);

CREATE OR REPLACE FUNCTION reject_agent_trust_history_mutation() RETURNS TRIGGER AS $$
BEGIN RAISE EXCEPTION 'agent trust history is immutable'; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_agent_context_contributions_immutable ON agent_context_contributions;
CREATE TRIGGER trg_agent_context_contributions_immutable BEFORE UPDATE OR DELETE ON agent_context_contributions FOR EACH ROW EXECUTE FUNCTION reject_agent_trust_history_mutation();
DROP TRIGGER IF EXISTS trg_agent_outbound_inspections_immutable ON agent_outbound_inspections;
CREATE TRIGGER trg_agent_outbound_inspections_immutable BEFORE UPDATE OR DELETE ON agent_outbound_inspections FOR EACH ROW EXECUTE FUNCTION reject_agent_trust_history_mutation();
