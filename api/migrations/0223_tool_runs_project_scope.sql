-- Diagnostics & Tools — project-scoped runs.
-- A diagnostic can now be run AGAINST A PROJECT (project_id set), not just the
-- workspace. Project-scoped runs are aggregated into a per-project diagnostic
-- score/rating that rolls up to the tenant. The architecture analysis (the
-- "Architect") records one of these runs when it completes, making it a tracked
-- project diagnostic rather than an assignable agent.

ALTER TABLE tool_runs
  ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_tool_runs_project
  ON tool_runs(tenant_id, project_id, tool_id, created_at DESC);
