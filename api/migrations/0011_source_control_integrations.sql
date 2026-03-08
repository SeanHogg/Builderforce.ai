DO $$
BEGIN
  CREATE TYPE source_control_provider AS ENUM ('github', 'bitbucket');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS source_control_integrations (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider source_control_provider NOT NULL,
  name VARCHAR(255) NOT NULL,
  account_identifier VARCHAR(255) NOT NULL,
  host_url VARCHAR(500),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS source_control_integration_id INTEGER REFERENCES source_control_integrations(id) ON DELETE SET NULL;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS source_control_provider source_control_provider;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS source_control_repo_full_name VARCHAR(255);

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS source_control_repo_url VARCHAR(500);

CREATE INDEX IF NOT EXISTS idx_source_control_integrations_tenant_id ON source_control_integrations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_source_control_integrations_provider ON source_control_integrations(provider);
CREATE INDEX IF NOT EXISTS idx_projects_source_control_integration_id ON projects(source_control_integration_id);
