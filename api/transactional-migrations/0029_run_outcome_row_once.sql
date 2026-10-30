-- 0029 · ONE cloud `run.outcome` row per execution, enforced (expand only).
--
-- The cloud run's uniform outcome row (PRD 35 §8.2) is written by exactly one function at the place an execution's terminal status is
-- persisted. Several paths can race to a terminal status (the Durable Object, a cancel, the reaper, a re-run after an eviction), so
-- uniqueness is a property of the table, not of the callers: inserts use ON CONFLICT DO NOTHING against this index. The index is
-- scoped to CLOUD rows (agent_host_id IS NULL): a self-hosted host reports its own events and must never collide with it.
--
-- Concurrent inserts are held off while duplicates written before the index existed are collapsed (earliest kept) and the index built.
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
