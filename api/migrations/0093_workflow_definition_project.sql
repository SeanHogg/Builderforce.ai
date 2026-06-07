-- 0093: bind a workflow definition to a project.
--
-- A workflow (the visually-authored definition) may belong to a project, or be
-- independent of any project (tenant-wide). Until now a definition only carried
-- an execution_scope flag ('project' | 'global') with no actual project FK, so
-- the Workflows page could not show/group by a named project the way Projects
-- does. This adds the binding.
--
-- Nullable + ON DELETE SET NULL: a workflow can be tenant-wide (no project), and
-- deleting a project leaves its workflow definitions intact (just unlinked).
ALTER TABLE workflow_definitions
  ADD COLUMN IF NOT EXISTS project_id integer REFERENCES projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS workflow_definitions_project_id_idx
  ON workflow_definitions(project_id);

-- Backfill: an unbound definition is tenant-wide, so align execution_scope with
-- the new binding (no project ⇒ global). Project-bound rows can't exist yet.
UPDATE workflow_definitions
  SET execution_scope = 'global'
  WHERE project_id IS NULL AND execution_scope <> 'global';
