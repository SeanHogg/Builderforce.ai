-- Unified artifact assignments: skills, personas, and content at any scope level
-- Supports tenant / claw / project / task scopes with precedence resolution

-- Custom enum types
DO $$ BEGIN
  CREATE TYPE artifact_type AS ENUM ('skill', 'persona', 'content');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE assignment_scope AS ENUM ('tenant', 'claw', 'project', 'task');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Artifact assignments table
CREATE TABLE IF NOT EXISTS artifact_assignments (
  id             SERIAL       NOT NULL,
  tenant_id      INTEGER      NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  artifact_type  artifact_type  NOT NULL,
  artifact_slug  VARCHAR(255)   NOT NULL,
  scope          assignment_scope NOT NULL,
  scope_id       INTEGER      NOT NULL,
  assigned_by    VARCHAR(36)  REFERENCES users(id),
  config         TEXT,
  assigned_at    TIMESTAMP    NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, artifact_type, artifact_slug, scope, scope_id)
);

-- Index for fast lookups by scope
CREATE INDEX IF NOT EXISTS idx_artifact_assignments_scope
  ON artifact_assignments(scope, scope_id);

-- Index for tenant-level queries
CREATE INDEX IF NOT EXISTS idx_artifact_assignments_tenant
  ON artifact_assignments(tenant_id, artifact_type);
