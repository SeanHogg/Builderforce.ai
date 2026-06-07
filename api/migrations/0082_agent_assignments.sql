-- 0082: canonical agent-assignment model.
--
-- An agent is registered once (tenant-scoped) and then ASSIGNED to many platform
-- aspects from one place. This is the single polymorphic mapping the user's model
-- requires, replacing the fragmented project_agents / swimlane target /
-- assignedAgentHost notions over time.
--
--   (agent_kind, agent_ref)  → the tenant-scoped agent identity (same coordinates
--                              project_agents uses: workforce | registered + ref)
--   scope                    → which aspect: project | workflow | architecture |
--                              security | swimlane | brain | global
--   scope_id                 → the target id within that scope (project id,
--                              workflow id, swimlane id, …); NULL for brain/global
--   execution_scope          → project | global (e.g. a workflow runs under a
--                              project, or tenant-wide)
CREATE TABLE IF NOT EXISTS agent_assignments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  segment_id      uuid REFERENCES segments(id) ON DELETE CASCADE,
  agent_kind      varchar(16) NOT NULL,
  agent_ref       varchar(64) NOT NULL,
  scope           varchar(24) NOT NULL,
  scope_id        varchar(64),
  execution_scope varchar(16) NOT NULL DEFAULT 'project',
  role            varchar(64) NOT NULL DEFAULT 'default',
  created_at      timestamp NOT NULL DEFAULT now(),
  updated_at      timestamp NOT NULL DEFAULT now()
);

-- One assignment per (tenant, agent, scope, target). NULLs collapse via COALESCE
-- so brain/global (scope_id NULL) is unique per agent+scope.
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_assignments
  ON agent_assignments (tenant_id, agent_kind, agent_ref, scope, COALESCE(scope_id, ''));

CREATE INDEX IF NOT EXISTS idx_agent_assignments_scope
  ON agent_assignments (tenant_id, scope, scope_id);
