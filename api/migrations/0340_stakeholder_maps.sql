-- Migration 0340: Stakeholder Maps
-- Defines a lightweight dedicated store for stakeholder maps per initiative.
-- Supports optional projectId (loose matching for initiatives within a project).
-- References user IDs to avoid duplicating full prospectus user profiles.

-- Create stakeholder_maps table
CREATE TABLE stakeholder_maps (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  initiative_id TEXT NOT NULL,
  project_id    TEXT,
  approver_ids  TEXT[] NOT NULL DEFAULT '{}',
  informed_party_ids TEXT[] NOT NULL DEFAULT '{}',
  version       INTEGER NOT NULL DEFAULT 1,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by    TEXT NOT NULL,
  updated_by    TEXT NOT NULL
);

-- Create indexes for efficient queries
CREATE INDEX stakeholder_maps_tenant_idx ON stakeholder_maps(tenant_id);
CREATE INDEX stakeholder_maps_initiative_idx ON stakeholder_maps(tenant_id, initiative_id);
CREATE INDEX stakeholder_maps_project_idx ON stakeholder_maps(tenant_id, project_id) WHERE project_id IS NOT NULL;

-- Add row-level security for multi-tenant isolation
ALTER TABLE stakeholder_maps ENABLE ROW LEVEL SECURITY;

-- Only tenants can access their own rows
CREATE POLICY tenant_isolation ON stakeholder_maps
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant')::TEXT);

-- Add trigger for updated_at timestamp
CREATE OR REPLACE FUNCTION update_stakeholder_maps_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER stakeholder_maps_updated_at_trigger
  BEFORE UPDATE ON stakeholder_maps
  FOR EACH ROW
  EXECUTE FUNCTION update_stakeholder_maps_updated_at();

-- Initial data: no default stakeholders required (optimized empty store, better than NULLs)