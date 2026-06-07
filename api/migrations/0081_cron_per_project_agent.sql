-- 0081: per-agent cron scoping.
--
-- A cron job can be scoped per project AND per agent within that project. The new
-- nullable `project_agent_id` ties a schedule to a specific attached agent
-- (project_agents.id); NULL = project-wide (the project's agents share it). The
-- executor agentHost still runs the job; this column is the ownership/scoping link.
ALTER TABLE cron_jobs
  ADD COLUMN IF NOT EXISTS project_agent_id integer
  REFERENCES project_agents(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_cron_jobs_project_agent ON cron_jobs(project_agent_id);
