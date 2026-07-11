-- 0327_manager_types_and_coaching.sql
-- Two related additions to the AI Manager, sharing one mechanism (a composite
-- directive the pass feeds to its AI scoring/prioritization):
--
--   1. Manager TYPES — the manager's DOMAIN focus/persona. A tenant can run a
--      Development manager, a QA manager, an IT Service Desk manager, a DevOps
--      manager, etc. The type shapes what the manager values + prioritizes. The
--      concrete catalog lives in code (managerTypes.ts); this column stores the
--      chosen id. 'general' preserves the existing (domain-neutral) behavior.
--
--   2. Human→manager COACHING directives — standing guidance a human gives the
--      manager ("focus the payments epic", "hold merges on release/*") that the
--      background pass honors on every run. project_id NULL = a tenant-wide
--      directive (a manager scoped to the whole tenant, not one project).

ALTER TABLE project_manager_configs
  ADD COLUMN IF NOT EXISTS manager_type VARCHAR(32) NOT NULL DEFAULT 'general';

CREATE TABLE IF NOT EXISTS manager_directives (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- NULL = tenant-wide guidance; else scoped to one project.
  project_id  INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  directive   TEXT NOT NULL,
  -- active = honored by the pass; done/dismissed = retired (kept for the audit trail).
  status      VARCHAR(16) NOT NULL DEFAULT 'active',
  -- users.id of the human who coached, when known.
  created_by  VARCHAR(36),
  -- 'coach' = the Manager-tab coaching box; 'chat' = the manager.coach MCP tool.
  source      VARCHAR(16) NOT NULL DEFAULT 'coach',
  created_at  TIMESTAMP NOT NULL DEFAULT now(),
  -- Optional auto-expiry so time-boxed guidance stops applying on its own.
  expires_at  TIMESTAMP
);

-- The pass loads active directives for (tenant, project) + (tenant, NULL) every run.
CREATE INDEX IF NOT EXISTS idx_manager_directives_scope
  ON manager_directives(tenant_id, project_id, status);
