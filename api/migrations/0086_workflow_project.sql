-- 0086: associate workflow execution records with a project.
--
-- A workflow (execution record) may belong to a project, so the Workflows page
-- can group/filter by project and the Projects page can count its workflows.
-- Nullable + ON DELETE SET NULL: a workflow can be tenant-wide (no project), and
-- deleting a project leaves its workflows intact (just unlinked).
ALTER TABLE workflows
  ADD COLUMN IF NOT EXISTS project_id integer REFERENCES projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS workflows_project_id_idx ON workflows(project_id);
