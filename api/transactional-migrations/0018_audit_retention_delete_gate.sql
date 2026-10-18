-- 0018 · Retention gate on the operational copy of the execution-claim immutable
-- triggers (0013_run_telemetry.sql). Core counterpart is migrations/1238.
--
-- UPDATE stays forbidden. DELETE is allowed only when the transaction has
-- `SET LOCAL app.retention = 'on'`. Window: 90 days, same SOC 2 evidence window
-- as tool_audit_events. Dual-resident claims/evidence are swept on BOTH endpoints
-- (sweptTablesBounded.ts); this track also restates their autovacuum tuning.

CREATE OR REPLACE FUNCTION reject_execution_claim_mutation() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('app.retention', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'execution claims and evidence are immutable';
END;
$$ LANGUAGE plpgsql;

ALTER TABLE IF EXISTS execution_claims SET (autovacuum_vacuum_scale_factor = 0.05);
ALTER TABLE IF EXISTS execution_claim_evidence SET (autovacuum_vacuum_scale_factor = 0.05);
