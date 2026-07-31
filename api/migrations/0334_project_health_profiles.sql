-- 0334_project_health_profiles.sql
-- Project Health Profile - stores diagnostic questionnaire answers attached to projects.
-- This is the structured "health profile" that captures project health baseline from
-- the Diagnostic Question Engine (epic #155).
--
-- Each project has exactly one active health profile, with versioning support to track
-- changes over time (re-running the diagnostic captures updates).
--
-- Tables:
--   project_health_profiles   - the active health profile per project
--   project_health_profile_versions - immutable snapshots of prior versions

BEGIN;

-- Active health profile per project (one-to-one relationship)
CREATE TABLE project_health_profiles (
  -- Primary identifier
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Foreign key to project
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  
  -- Schema version for the health profile structure
  schema_version VARCHAR(10) NOT NULL DEFAULT '1.0',
  
  -- Diagnostic answers stored as JSONB, organized by category
  -- Structure: { timeline: {...}, budget: {...}, quality: {...}, risk: {...}, team: {...}, alignment: {...} }
  answers JSONB NOT NULL DEFAULT '{}',
  
  -- Computed health scores derived from answers (optional, can be computed on read)
  computed_scores JSONB,
  
  -- Who submitted this profile
  submitted_by UUID REFERENCES users(id),
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Unique constraint: one active profile per project
  CONSTRAINT one_profile_per_project UNIQUE (project_id)
);

-- Index for fast lookups by project
CREATE INDEX idx_health_profiles_project ON project_health_profiles(project_id);

-- Version history table (immutable snapshots)
CREATE TABLE project_health_profile_versions (
  -- Primary identifier
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Reference to the project
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  
  -- Reference to the profile this version was created from
  profile_id UUID NOT NULL REFERENCES project_health_profiles(id) ON DELETE CASCADE,
  
  -- Schema version at time of snapshot
  schema_version VARCHAR(10) NOT NULL,
  
  -- Snapshot of answers at this version
  answers JSONB NOT NULL,
  
  -- Computed scores at this version
  computed_scores JSONB,
  
  -- Who triggered this version creation
  created_by UUID REFERENCES users(id),
  
  -- When this version was created
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Version number (1, 2, 3, ...) for this project's profile
  version_number INTEGER NOT NULL
);

-- Index for querying versions by project
CREATE INDEX idx_health_profile_versions_project ON project_health_profile_versions(project_id);

-- Index for querying versions by profile
CREATE INDEX idx_health_profile_versions_profile ON project_health_profile_versions(profile_id);

-- Function to automatically update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_health_profile_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update timestamp on profile updates
CREATE TRIGGER health_profile_updated_at
  BEFORE UPDATE ON project_health_profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_health_profile_timestamp();

COMMIT;
