-- 0098_spec_kind.sql
-- Classify a spec/PRD by kind. The Architect analysis task writes its result back
-- as a PRD with kind='architecture' (one per project), distinct from the feature
-- PRDs users author by hand. The project list aggregates on (project_id, kind) to
-- decide whether to show "Run Architecture Analysis" or "View Arch Analysis", so a
-- composite index keeps that lookup cheap.
ALTER TABLE specs ADD COLUMN IF NOT EXISTS kind varchar(32) NOT NULL DEFAULT 'feature';
CREATE INDEX IF NOT EXISTS idx_specs_project_kind ON specs (project_id, kind);
