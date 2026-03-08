ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS default_claw_id INTEGER;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS root_working_directory TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'tenants_default_claw_fk'
      AND table_name = 'tenants'
  ) THEN
    ALTER TABLE tenants
      ADD CONSTRAINT tenants_default_claw_fk
      FOREIGN KEY (default_claw_id)
      REFERENCES coderclaw_instances(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tenants_default_claw_id ON tenants(default_claw_id);
CREATE INDEX IF NOT EXISTS idx_projects_root_working_directory ON projects(root_working_directory);
