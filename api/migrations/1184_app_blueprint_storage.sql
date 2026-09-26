-- W2: AppBlueprint storage
-- Stores detected app blueprints per project + commit
-- This is the "one blueprint, many targets" principle from PRD 31

CREATE TABLE IF NOT EXISTS project_app_blueprints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    commit_sha VARCHAR(40) NOT NULL,
    blueprint JSONB NOT NULL,
    detected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Unique constraint: one blueprint per project + commit
    CONSTRAINT uq_project_app_blueprints_project_commit UNIQUE (project_id, commit_sha)
);

-- Index for looking up blueprints by project
CREATE INDEX IF NOT EXISTS idx_project_app_blueprints_project ON project_app_blueprints(project_id);

-- Index for looking up blueprints by commit SHA
CREATE INDEX IF NOT EXISTS idx_project_app_blueprints_commit ON project_app_blueprints(commit_sha);

-- Comments
COMMENT ON TABLE project_app_blueprints IS E'W2: Stores detected AppBlueprints per project + commit. Read by Run loop (W1), Provision (W4), Deploy (W6), Marketplace (W7).';
COMMENT ON COLUMN project_app_blueprints.project_id IS E'Reference to the project this blueprint belongs to.';
COMMENT ON COLUMN project_app_blueprints.commit_sha IS E'Git commit SHA this blueprint was detected from.';
COMMENT ON COLUMN project_app_blueprints.blueprint IS E'The complete AppBlueprint JSON (services, bindings, database, secrets, vars, domains).';
COMMENT ON COLUMN project_app_blueprints.detected_at IS E'When this blueprint was detected.';
