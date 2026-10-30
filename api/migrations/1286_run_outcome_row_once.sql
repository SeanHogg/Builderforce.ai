-- 1286 · ONE `run.outcome` row per execution, enforced — the CORE-track mirror of transactional-migrations/0029 (identical DDL).
--
-- See 0029: the uniqueness belongs to the table because several terminal paths can race. Duplicates written before the index are
-- collapsed first (earliest kept). Expand only; `runTelemetryDatabase()` resolves to this handle wherever the operational
-- endpoint is not split out.
DELETE FROM tool_audit_events a
  USING tool_audit_events b
  WHERE a.tool_name = 'run.outcome'
    AND b.tool_name = 'run.outcome'
    AND a.execution_id IS NOT NULL
    AND a.execution_id = b.execution_id
    AND a.id > b.id;

CREATE UNIQUE INDEX IF NOT EXISTS tool_audit_events_run_outcome_once
  ON tool_audit_events (execution_id)
  WHERE tool_name = 'run.outcome';
