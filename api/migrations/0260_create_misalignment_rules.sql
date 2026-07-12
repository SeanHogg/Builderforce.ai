-- Migration 0260: Create priority misalignment rules table
-- Task #347: Priority Misalignment Flagging

-- Create misalignment_rules table
CREATE TABLE IF NOT EXISTS misalignment_rules (
  id TEXT PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  rule_type TEXT NOT NULL CHECK (rule_type IN ('hierarchical', 'strategic', 'dependency')),
  enabled BOOLEAN NOT NULL DEFAULT false,
  severity TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('warning', 'error')),
  threshold INTEGER NOT NULL DEFAULT 1 CHECK (threshold >= 0),
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS misalignment_rules_project_id_idx ON misalignment_rules(project_id);
CREATE INDEX IF NOT EXISTS misalignment_rules_enabled_idx ON misalignment_rules(enabled);
CREATE INDEX IF NOT EXISTS misalignment_rules_type_idx ON misalignment_rules(rule_type);

-- Insert default workspace-wide rules

-- Hierarchical rule: default threshold of 1 level
INSERT INTO misalignment_rules (id, project_id, rule_type, enabled, severity, threshold, description)
VALUES ('hierarchical-default', NULL, 'hierarchical', true, 'warning', 1, 'Detect when a child task priority deviates more than 1 level from its parent')
ON CONFLICT (id) DO NOTHING;

-- Strategic rule: default threshold of 2 levels
INSERT INTO misalignment_rules (id, project_id, rule_type, enabled, severity, threshold, description)
VALUES ('strategic-default', NULL, 'strategic', true, 'warning', 2, 'Detect when task priority deviates more than 2 levels from linked strategic objectives/initiatives')
ON CONFLICT (id) DO NOTHING;

-- Dependency rule: default threshold of 1 level
INSERT INTO misalignment_rules (id, project_id, rule_type, enabled, severity, threshold, description)
VALUES ('dependency-default', NULL, 'dependency', true, 'warning', 1, 'Detect when blocked task priority differs by more than 1 level from its blocker')
ON CONFLICT (id) DO NOTHING;