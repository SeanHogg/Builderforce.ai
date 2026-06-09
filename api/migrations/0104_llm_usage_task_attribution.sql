-- 0104_llm_usage_task_attribution.sql
-- Attribute usage/cost to the TICKET (task) it was spent on — the finest grain.
--
-- Cost rolls up ticket → project → account: 0103 added project_id, but the
-- starting point is the ticket. A cloud agent run belongs to an execution, which
-- belongs to a task (the ticket); stamping task_id lets "how much has this ticket
-- cost?" be answered with a direct SUM instead of joining execution → task.
--
-- Workspace (segment) is deliberately NOT denormalized here: 0056 keeps
-- llm_usage_log tenant-level on purpose (platform/infra ledger), and its segment
-- trigger RAISEs for segmented tenants. Workspace-level cost is derived by
-- joining project → segment (projects.segment_id) at rollup time.

ALTER TABLE llm_usage_log ADD COLUMN IF NOT EXISTS task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL;

-- Rollup read: "cost by ticket over a window" (ticket → project → account).
CREATE INDEX IF NOT EXISTS idx_llm_usage_task
  ON llm_usage_log (tenant_id, task_id, created_at DESC);

-- Backfill historical cloud-run rows from their execution's task.
UPDATE llm_usage_log u
   SET task_id = e.task_id
  FROM executions e
 WHERE u.task_id IS NULL
   AND u.execution_id = e.id;
