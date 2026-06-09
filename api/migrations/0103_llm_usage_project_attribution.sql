-- 0103_llm_usage_project_attribution.sql
-- Attribute usage/cost to the PROJECT it was spent on, so spend rolls up
-- project → account (tenant).
--
-- 0096 made llm_usage_log attributable by agent (host / cloud_agent_ref /
-- execution_id) and 0097 stamped an authoritative per-call cost. But there was
-- still no project dimension: a cloud agent run belongs to a task, which belongs
-- to a project, yet the cost row carried neither — so "how much has this project
-- spent?" could not be answered, only "how much has the tenant spent?".
--
-- This adds project_id (nullable; a web/SDK call with no project context leaves it
-- null and rolls up at the account level only). The cloud-agent execution loop
-- stamps it from the run's task→project at write time, mirroring how cost itself
-- is denormalized so the dashboard SUMs a column instead of joining at read time.

ALTER TABLE llm_usage_log ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL;

-- Rollup read: "cost by project over a window" (project → account spend).
CREATE INDEX IF NOT EXISTS idx_llm_usage_project
  ON llm_usage_log (tenant_id, project_id, created_at DESC);

-- Backfill historical cloud-run rows from their execution's task→project, so the
-- per-project spend isn't blank for past runs.
UPDATE llm_usage_log u
   SET project_id = t.project_id
  FROM executions e
  JOIN tasks t ON t.id = e.task_id
 WHERE u.project_id IS NULL
   AND u.execution_id = e.id;
