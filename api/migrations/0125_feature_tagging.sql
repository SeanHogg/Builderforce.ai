-- 0125_feature_tagging.sql
-- Feature Tagging System
--
-- A curated set of predefined tags for product feature status:
--   * SHIPPED - Feature has been released to production
--   * IN_PROGRESS - Feature is actively being developed or has partial functionality released
--   * NOT_STARTED - Feature has been defined but development has not yet begun
--   * BROKEN - Feature is in development or shipped, but has critical issues preventing its intended use
--

-- Add feature_sign column to tasks to track the feature's overall status
ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS feature_sign VARCHAR(24) NOT NULL DEFAULT 'NOT_STARTED';

-- Create unique constraint to prevent note: this allows any value but we document the enum above
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_feature_sign ON tasks(tenant_id, feature_sign) WHERE status = 'backlog' OR status = 'todo';

-- Validate feature_sign values on INSERT/UPDATE to ensure only valid tags
CREATE OR REPLACE FUNCTION validate_feature_sign()
RETURNS TRIGGER AS $$
DECLARE
  valid_tags TEXT[] := ARRAY['SHIPPED', 'IN_PROGRESS', 'NOT_STARTED', 'BROKEN'];
  sign_value TEXT;
BEGIN
  sign_value := NEW.feature_sign;

  -- Only validate when feature_sign is set (not null)
  IF sign_value IS NOT NULL THEN
    -- Check if the value is one of the allowed tags
    IF NOT (sign_value = ANY(valid_tags)) THEN
      RAISE EXCEPTION 'Invalid feature_sign value: %. Allowed values are: %',
        sign_value,
        array_to_string(valid_tags, ', ');
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach trigger to tasks table
DROP TRIGGER IF EXISTS trigger_validate_feature_sign ON tasks;
CREATE TRIGGER trigger_validate_feature_sign
  BEFORE INSERT OR UPDATE ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION validate_feature_sign();

-- Add feature_sign to available filters for tasks board
-- This is a normalized lookup table for the feature status
CREATE TABLE IF NOT EXISTS feature_signs (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  value VARCHAR(24) NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  color VARCHAR(32) NOT NULL DEFAULT '#94A3B8',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(tenant_id, value)
);

-- Insert default feature tags for each tenant
-- These are seeded on first creation of a tenant
CREATE OR REPLACE FUNCTION seed_default_feature_signs()
RETURNS void AS $$
DECLARE
  tenant_record RECORD;
BEGIN
  FOR tenant_record IN SELECT id FROM tenants WHERE status = 'active' AND kind = 'single'
  LOOP
    -- Only seed if no feature signs exist for this tenant
    IF NOT EXISTS (SELECT 1 FROM feature_signs WHERE tenant_id = tenant_record.id) THEN
      INSERT INTO feature_signs (tenant_id, value, label, description, color) VALUES
        (tenant_record.id, 'SHIPPED', '✅ Shipped', 'Feature has been released to production', '#10B981'),
        (tenant_record.id, 'IN_PROGRESS', '🔧 Partial/In-Progress', 'Feature is actively being developed or has partial functionality released', '#F59E0B'),
        (tenant_record.id, 'NOT_STARTED', '❌ Not Started', 'Feature has been defined but development has not yet begun', '#6B7280'),
        (tenant_record.id, 'BROKEN', '🐛 Broken', 'Feature is in development or shipped, but has critical issues preventing its intended use', '#EF4444');

      RAISE NOTICE 'Seeded default feature signs for tenant %', tenant_record.id;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Create an index for fast filtering by feature_sign
CREATE INDEX IF NOT EXISTS idx_tasks_feature_sign_status ON tasks(tenant_id, feature_sign, status);

-- Add feature_sign to combined index with status for common queries (e.g., "all broken tasks in backlog")
CREATE INDEX IF NOT EXISTS idx_tasks_status_feature_sign ON tasks(tenant_id, status, feature_sign);