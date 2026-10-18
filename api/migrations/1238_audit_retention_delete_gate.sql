-- 1238 · Retention gate on immutable audit DELETE triggers.
--
-- BEFORE UPDATE OR DELETE used to reject every mutation, so the nightly retention
-- sweep could never drain execution_claims / execution_claim_evidence,
-- agent_context_contributions, agent_outbound_inspections, or agent_capability_grants
-- (via agent_run_principals ON DELETE CASCADE). execution_claim_evidence.tool_audit_event_id
-- ON DELETE RESTRICT also blocked the tool_audit_events purge.
--
-- UPDATE stays forbidden. DELETE is allowed only when the transaction has
-- `SET LOCAL app.retention = 'on'` (current_setting('app.retention', true) = 'on').
-- Window: 90 days, the same SOC 2 evidence window as tool_audit_events.
-- Indexes are left in place (a separate ticket drops unused ones).
--
-- agent_definition_versions / agent_definition_promotions stay fully immutable —
-- they share reject_agent_identity_history_mutation with grants, so grants get their
-- own function rather than opening a DELETE hole on the definition history.

CREATE OR REPLACE FUNCTION reject_execution_claim_mutation() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('app.retention', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'execution claims and evidence are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION reject_agent_trust_history_mutation() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('app.retention', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'agent trust history is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION reject_agent_capability_grant_mutation() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('app.retention', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'agent identity history is immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_agent_capability_grants_immutable ON agent_capability_grants;
CREATE TRIGGER trg_agent_capability_grants_immutable
  BEFORE UPDATE OR DELETE ON agent_capability_grants
  FOR EACH ROW EXECUTE FUNCTION reject_agent_capability_grant_mutation();

-- Swept on this endpoint (sweptTablesBounded.ts). Same 0.05 as 1237: nightly bounded
-- purge, not the 0.02 of the high-write 1104 feeds. IF EXISTS: a fresh database that
-- never created the table must not abort the migration. Guarded by check-swept-tables.
ALTER TABLE IF EXISTS execution_claims SET (autovacuum_vacuum_scale_factor = 0.05);
ALTER TABLE IF EXISTS execution_claim_evidence SET (autovacuum_vacuum_scale_factor = 0.05);
ALTER TABLE IF EXISTS agent_context_contributions SET (autovacuum_vacuum_scale_factor = 0.05);
ALTER TABLE IF EXISTS agent_outbound_inspections SET (autovacuum_vacuum_scale_factor = 0.05);
ALTER TABLE IF EXISTS agent_run_principals SET (autovacuum_vacuum_scale_factor = 0.05);
