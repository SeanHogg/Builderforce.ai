-- Migration 0074: project-scoped integration credentials + GitLab provider.
--
-- Until now integration_credentials were workspace-global only (tenant_id +
-- optional segment_id). The project detail "Integrations" tab lets a user store
-- a key that belongs to ONE project, so we add a nullable project_id:
--
--   project_id IS NULL  → workspace-global credential (inherited by all projects)
--   project_id = <n>     → scoped to that single project
--
-- We also add 'gitlab' to the provider enum so GitLab PATs can be stored
-- alongside GitHub / Bitbucket.
--
-- The existing uq_integration_tenant_provider_name unique constraint is left
-- intact: names stay unique per tenant regardless of scope, which avoids the
-- Postgres "NULLs are distinct" pitfall a composite unique on the nullable
-- project_id would introduce.

-- NOTE: ALTER TYPE ... ADD VALUE runs in its own statement (the migrate runner
-- sends each statement as a separate Neon HTTP request, so this is not inside a
-- multi-statement transaction). Idempotent via IF NOT EXISTS.
ALTER TYPE integration_provider ADD VALUE IF NOT EXISTS 'gitlab';

ALTER TABLE integration_credentials
  ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_integration_credentials_project
  ON integration_credentials(tenant_id, project_id);
