-- 0438_execution_claim_evidence.sql
-- Structural provenance for agent completion claims. A claim is immutable history;
-- its evidence edges name the exact tool-audit rows that justify it.

CREATE TABLE IF NOT EXISTS execution_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  execution_id INTEGER NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
  kind VARCHAR(32) NOT NULL,
  statement TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_execution_claims_execution
  ON execution_claims(tenant_id, execution_id, created_at);

CREATE TABLE IF NOT EXISTS execution_claim_evidence (
  claim_id UUID NOT NULL REFERENCES execution_claims(id) ON DELETE CASCADE,
  tool_audit_event_id INTEGER NOT NULL REFERENCES tool_audit_events(id) ON DELETE RESTRICT,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (claim_id, tool_audit_event_id)
);

CREATE INDEX IF NOT EXISTS idx_execution_claim_evidence_event
  ON execution_claim_evidence(tenant_id, tool_audit_event_id);

-- Attach evidence in the same statement/transaction that creates the claim. If no
-- qualifying event exists, reject the claim: a claim row can never exist unsupported.
CREATE OR REPLACE FUNCTION attach_execution_claim_evidence()
RETURNS TRIGGER AS $$
DECLARE
  attached INTEGER;
BEGIN
  INSERT INTO execution_claim_evidence (claim_id, tool_audit_event_id, tenant_id)
  SELECT NEW.id, e.id, NEW.tenant_id
    FROM tool_audit_events e
   WHERE e.tenant_id = NEW.tenant_id
     AND e.execution_id = NEW.execution_id
     AND e.category = 'tool'
     AND e.tool_name ~ '^(write_file|edit_file|delete_file|run_checks|run_command|git_)'
     AND COALESCE(LOWER(e.result), '') NOT LIKE '%"ok":false%'
     AND COALESCE(LOWER(e.result), '') NOT LIKE 'blocked %'
     AND COALESCE(LOWER(e.result), '') NOT LIKE '% refused%';
  GET DIAGNOSTICS attached = ROW_COUNT;
  IF attached = 0 THEN
    RAISE EXCEPTION 'completion claim requires successful tool-audit evidence';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_execution_claim_attach_evidence ON execution_claims;
CREATE TRIGGER trg_execution_claim_attach_evidence
AFTER INSERT ON execution_claims
FOR EACH ROW EXECUTE FUNCTION attach_execution_claim_evidence();

CREATE OR REPLACE FUNCTION reject_execution_claim_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'execution claims and evidence are immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_execution_claims_immutable ON execution_claims;
CREATE TRIGGER trg_execution_claims_immutable
BEFORE UPDATE OR DELETE ON execution_claims
FOR EACH ROW EXECUTE FUNCTION reject_execution_claim_mutation();

DROP TRIGGER IF EXISTS trg_execution_claim_evidence_immutable ON execution_claim_evidence;
CREATE TRIGGER trg_execution_claim_evidence_immutable
BEFORE UPDATE OR DELETE ON execution_claim_evidence
FOR EACH ROW EXECUTE FUNCTION reject_execution_claim_mutation();
