-- `tenant_skill_assignments` + `agent_host_skill_assignments` -> `skill_assignments`
-- (PRD 20 §4, duplicate-shape cluster).
--
-- The two tables were the same fact at two scopes: (tenant, skill_slug, assigned_by,
-- assigned_at), with the host-level one adding `agent_host_id`. Its own docstring
-- said so — "overrides or supplements the tenant-level assignment for a specific
-- agentHost" — which is a SCOPE, and a scope is a column value, not a table.
--
-- The cost of the split was not the storage, it was the reading: two route files
-- each carried the same select + join + insert + delete twice over, once per scope,
-- and "which skills can this host use" had to union two queries that could drift.
--
-- `scope` reuses the existing `assignment_scope` enum rather than inventing a
-- parallel vocabulary, so a skill assignment and every other scoped assignment in
-- the platform answer "at what level" with the same values.
--
-- The CHECK is what keeps the two scopes honest in the database rather than in the
-- application: a host-scoped row must name a host, and a tenant-scoped row must not.

CREATE TABLE IF NOT EXISTS skill_assignments (
  id            serial PRIMARY KEY,
  tenant_id     integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  scope         assignment_scope NOT NULL DEFAULT 'tenant',
  -- NULL for a tenant-wide assignment; set for one host.
  agent_host_id integer REFERENCES agent_hosts(id) ON DELETE CASCADE,
  skill_slug    varchar(255) NOT NULL,
  assigned_by   varchar(36),
  assigned_at   timestamp NOT NULL DEFAULT now(),
  CONSTRAINT skill_assignments_scope_host CHECK (
    (scope = 'host'   AND agent_host_id IS NOT NULL) OR
    (scope = 'tenant' AND agent_host_id IS NULL)
  )
);

-- One assignment per (scope target, skill). Two partial unique indexes rather than
-- one over a nullable column: in Postgres NULLs are distinct, so a single index on
-- (tenant_id, agent_host_id, skill_slug) would let the same tenant-wide skill be
-- assigned twice. Both `onConflictDoNothing` paths depend on these.
CREATE UNIQUE INDEX IF NOT EXISTS uq_skill_assignments_tenant
  ON skill_assignments (tenant_id, skill_slug)
  WHERE agent_host_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_skill_assignments_host
  ON skill_assignments (agent_host_id, skill_slug)
  WHERE agent_host_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_skill_assignments_tenant
  ON skill_assignments (tenant_id, scope);

INSERT INTO skill_assignments (tenant_id, scope, agent_host_id, skill_slug, assigned_by, assigned_at)
SELECT tenant_id, 'tenant', NULL, skill_slug, assigned_by, assigned_at
FROM tenant_skill_assignments
ON CONFLICT DO NOTHING;

INSERT INTO skill_assignments (tenant_id, scope, agent_host_id, skill_slug, assigned_by, assigned_at)
SELECT tenant_id, 'host', agent_host_id, skill_slug, assigned_by, assigned_at
FROM agent_host_skill_assignments
ON CONFLICT DO NOTHING;

DROP TABLE IF EXISTS tenant_skill_assignments;
DROP TABLE IF EXISTS agent_host_skill_assignments;
