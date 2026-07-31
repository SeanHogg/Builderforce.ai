-- 0268 — Objectives gain a direct PROJECT scope.
--
-- Before this, an OKR objective could be scoped to a portfolio or an initiative,
-- or linked to delivery work (objective_links → initiative | epic | task). There
-- was NO way to scope an objective directly to a PROJECT, so the Brain's
-- `objectives.create` with a projectId silently dropped it and the Project 360
-- "Direction" dimension reported "No goal or OKR linked" even after OKRs were
-- created for that project.
--
-- Add a nullable project_id (a fourth scope axis). The Project 360's linkedGoalCount
-- now unions objectives directly scoped to the project with the task- and
-- initiative-linked ones. ON DELETE SET NULL: deleting a project orphans the goal to
-- org level rather than destroying it.

ALTER TABLE objectives
  ADD COLUMN IF NOT EXISTS project_id integer REFERENCES projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_objectives_project ON objectives(project_id) WHERE project_id IS NOT NULL;
