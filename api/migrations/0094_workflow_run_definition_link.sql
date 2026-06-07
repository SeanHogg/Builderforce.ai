-- 0094: link a workflow run back to its source definition.
--
-- A run (workflows) is an execution OF a workflow definition, but until now it
-- carried no pointer to the definition it came from — only projectId/agentHostId.
-- That made it impossible to show per-workflow run history / counts on the
-- Workflows page (only a flat, project-wide "Recent runs" list was possible).
--
-- Nullable + ON DELETE SET NULL: ad-hoc runs may have no definition, and deleting
-- a definition leaves its run history intact (just unlinked, so telemetry/audit
-- trails survive).
ALTER TABLE workflows
  ADD COLUMN IF NOT EXISTS workflow_definition_id uuid REFERENCES workflow_definitions(id) ON DELETE SET NULL;

-- Run-history reads: "all runs of definition X, newest first".
CREATE INDEX IF NOT EXISTS workflows_definition_id_idx
  ON workflows(workflow_definition_id, created_at DESC);
