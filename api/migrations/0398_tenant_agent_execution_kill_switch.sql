-- Workspace-level emergency stop for every agent execution surface.
-- TRUE preserves existing behaviour; FALSE is an authoritative deny on new runs.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS agent_execution_enabled BOOLEAN NOT NULL DEFAULT TRUE;

