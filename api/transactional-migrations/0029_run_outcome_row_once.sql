-- 0029 · ONE `run.outcome` row per execution, enforced (expand only).
--
-- The run's uniform outcome row (PRD 35 §8.2) is written by exactly one function at the place an execution's terminal status is
-- persisted. Several paths can race to a terminal status (the Durable Object, a cancel, the reaper, a re-run after an eviction),
-- so uniqueness is a property of the table, not of the callers: inserts use ON CONFLICT DO NOTHING against this index.
--
-- Any duplicates written before this index existed are collapsed first, keeping the earliest row.
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
