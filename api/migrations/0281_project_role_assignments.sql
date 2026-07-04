-- Explicit roster role assignments — the "assign an existing agent / employee / hire
-- to a role" primitive the Recommended Roster and the Workforce → Roles tab both write.
--
-- The recommended roster (rosterService) already INFERS coverage from lane staffing,
-- agent skill-match and human discipline. That is convenient but not steerable — a
-- manager could not say "Ada is our Architect" or "this hired contractor covers QA".
-- This table records those explicit human decisions. The roster merges them into each
-- role's `filledBy` (via = 'assignment') so an assigned role reads as filled.
--
-- Scope:
--   project_id IS NULL  → a WORKSPACE-DEFAULT assignment (managed in Workforce → Roles);
--                         applies to every project's roster.
--   project_id = <id>   → a PROJECT-SPECIFIC assignment (managed in the project's
--                         Recommended Roster card); applies to that project only.
CREATE TABLE IF NOT EXISTS project_role_assignments (
  id             varchar(36) PRIMARY KEY,
  tenant_id      integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- NULL = workspace-default (all projects); set = a specific project's roster.
  project_id     integer REFERENCES projects(id) ON DELETE CASCADE,
  role_key       varchar(120) NOT NULL,          -- built-in role key or job_roles.key
  assignee_kind  varchar(16)  NOT NULL,          -- 'agent' | 'human' | 'hire'
  assignee_ref   varchar(128) NOT NULL,          -- ide_agents.id | user id | freelancer engagement/user id
  assignee_name  varchar(200),                   -- denormalised label for display
  created_by     varchar(36),                    -- users.id that made the assignment
  created_at     timestamp NOT NULL DEFAULT now()
);

-- One row per (scope, role, assignee). COALESCE keeps the workspace-default (NULL
-- project) rows unique too, since a plain unique index treats every NULL as distinct.
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_role_assignment
  ON project_role_assignments(tenant_id, COALESCE(project_id, 0), role_key, assignee_kind, assignee_ref);
CREATE INDEX IF NOT EXISTS idx_project_role_assignments_project
  ON project_role_assignments(tenant_id, project_id);
