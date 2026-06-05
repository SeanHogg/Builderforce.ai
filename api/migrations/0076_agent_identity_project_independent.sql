-- Make agents project-independent for capability assignment.
--
-- An agent (workforce or registered) is NOT tied to a project — it can be used
-- anywhere (IDE, Workflow, on-prem, cloud) and associated with 0..N projects as
-- swimlanes. Per-agent skills/personas/content therefore attach to the AGENT
-- ITSELF, not to a project↔agent junction.
--
-- We model that "agent identity" as a project_agents row with project_id NULL:
-- the canonical, tenant-wide handle for a given (agent_kind, agent_ref). It
-- gives the agent a stable numeric id so artifact_assignments can keep using
-- scope='agent' + scope_id = project_agents.id. Project-scoped rows (project_id
-- NOT NULL) still exist as swimlane attachments layered on top.

ALTER TABLE project_agents ALTER COLUMN project_id DROP NOT NULL;

-- The old all-columns UNIQUE treated NULL project_ids as distinct (Postgres
-- default), so it could no longer guarantee a single canonical identity row.
-- Replace it with two partial unique indexes:
--   * one canonical project-less identity row per (tenant, kind, ref)
--   * one attachment per (tenant, project, kind, ref) for project-scoped rows
ALTER TABLE project_agents
  DROP CONSTRAINT IF EXISTS project_agents_tenant_id_project_id_agent_kind_agent_ref_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_project_agents_identity
  ON project_agents (tenant_id, agent_kind, agent_ref)
  WHERE project_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_project_agents_attachment
  ON project_agents (tenant_id, project_id, agent_kind, agent_ref)
  WHERE project_id IS NOT NULL;
