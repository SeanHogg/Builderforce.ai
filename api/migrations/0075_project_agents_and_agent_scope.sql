-- Per-agent capability scoping.
--
-- Adds an `agent` value to the assignment_scope enum so skills/personas/content
-- can be assigned to a single agent, and a `project_agents` join table that
-- gives each agent on a project a numeric id. Per-agent artifact assignments
-- reuse artifact_assignments with scope='agent' and scope_id = project_agents.id.

-- NOTE: ALTER TYPE ... ADD VALUE cannot run inside a transaction block; keep it
-- as its own top-level statement.
ALTER TYPE assignment_scope ADD VALUE IF NOT EXISTS 'agent';

-- Agents attached to a project. Polymorphic across the two agent kinds:
--   workforce  → PublishedAgent.id (string)        in agent_ref
--   registered → agents.id (numeric, as string)    in agent_ref
CREATE TABLE IF NOT EXISTS project_agents (
  id          SERIAL       PRIMARY KEY,
  tenant_id   INTEGER      NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id  INTEGER      NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  agent_kind  VARCHAR(16)  NOT NULL,
  agent_ref   VARCHAR(64)  NOT NULL,
  name        VARCHAR(255) NOT NULL,
  role        VARCHAR(64)  NOT NULL DEFAULT 'default',
  governance  TEXT,
  added_by    VARCHAR(36)  REFERENCES users(id),
  created_at  TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMP    NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, project_id, agent_kind, agent_ref)
);

CREATE INDEX IF NOT EXISTS idx_project_agents_project
  ON project_agents(project_id);
