-- 0244_sprints_project_scope.sql
-- sprints.project_id — the project-scope axis for agile sprints. Previously sprints
-- were tenant/segment-wide only, but they are created + listed inside the
-- project-scoped Planning ceremony, so a sprint created from project A's board
-- leaked into project B's. Mirrors feature_scores' nullable project scope: NULL =
-- portfolio/segment-level cadence (shared across projects), non-null = one project.
-- The /api/agile/sprints tracker now honours `?project=<id>` on GET and accepts
-- projectId on create/update. Null = unscoped → existing sprints keep showing in
-- the portfolio view with zero backfill. Idempotent / re-runnable.

ALTER TABLE sprints
  ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_sprints_project
  ON sprints(tenant_id, project_id, status);
