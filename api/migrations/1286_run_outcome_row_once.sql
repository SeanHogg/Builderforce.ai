-- 1286 · ONE cloud `run.outcome` row per execution, enforced — the CORE-track mirror of transactional-migrations/0029 (identical DDL).
--
-- See 0029: the uniqueness belongs to the table because several terminal paths can race, and it is scoped to cloud rows
-- (agent_host_id IS NULL) so a self-hosted host's own events never collide with it. Duplicates written before the index are collapsed
-- first (earliest kept) while concurrent inserts are held off. Expand only; `runTelemetryDatabase()` resolves to this handle wherever
-- the operational endpoint is not split out.
LOCK TABLE tool_audit_events IN SHARE ROW EXCLUSIVE MODE;

DELETE FROM tool_audit_events a
  USING tool_audit_events b
  WHERE a.tool_name = 'run.outcome'
    AND b.tool_name = 'run.outcome'
    AND a.agent_host_id IS NULL
    AND b.agent_host_id IS NULL
    AND a.execution_id IS NOT NULL
    AND a.execution_id = b.execution_id
    AND a.id > b.id;

CREATE UNIQUE INDEX IF NOT EXISTS tool_audit_events_run_outcome_once
  ON tool_audit_events (execution_id)
  WHERE tool_name = 'run.outcome' AND agent_host_id IS NULL;
