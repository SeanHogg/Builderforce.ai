-- 0092_cloud_agent_telemetry.sql
-- Make telemetry first-class for cloud agents (not just self-hosted agent hosts).
--
-- Until now, tool_audit_events and usage_snapshots required a non-null
-- agent_host_id (FK -> agent_hosts). Cloud agents have NO agent_host row, so they
-- physically could not record tool-call audit or token-usage telemetry — which is
-- why cloud runs never populated the Observability timeline.
--
-- This migration:
--   1. drops the NOT NULL on agent_host_id (a row now belongs to EITHER a
--      self-hosted host OR a cloud agent),
--   2. adds cloud_agent_ref (the raw-SQL ide_agents.id; no FK, matching the
--      task.assigned_agent_ref / agent_purchases.agent_id convention),
--   3. adds execution_id so a cloud run's telemetry can be traced back to its
--      execution (cloud runs have no live session key).
--
-- A row is well-formed when at least one of (agent_host_id, cloud_agent_ref) is set.

ALTER TABLE tool_audit_events ALTER COLUMN agent_host_id DROP NOT NULL;
ALTER TABLE tool_audit_events ADD COLUMN IF NOT EXISTS cloud_agent_ref VARCHAR(64);
ALTER TABLE tool_audit_events ADD COLUMN IF NOT EXISTS execution_id    INTEGER;

ALTER TABLE usage_snapshots ALTER COLUMN agent_host_id DROP NOT NULL;
ALTER TABLE usage_snapshots ADD COLUMN IF NOT EXISTS cloud_agent_ref VARCHAR(64);
ALTER TABLE usage_snapshots ADD COLUMN IF NOT EXISTS execution_id    INTEGER;

-- Timeline reads: "all tool events for cloud agent X, newest first".
CREATE INDEX IF NOT EXISTS idx_tool_audit_cloud_agent
  ON tool_audit_events (tenant_id, cloud_agent_ref, ts DESC);
-- Trace reads: "all telemetry for this execution".
CREATE INDEX IF NOT EXISTS idx_tool_audit_execution
  ON tool_audit_events (execution_id);
CREATE INDEX IF NOT EXISTS idx_usage_snapshots_cloud_agent
  ON usage_snapshots (tenant_id, cloud_agent_ref, ts DESC);
CREATE INDEX IF NOT EXISTS idx_usage_snapshots_execution
  ON usage_snapshots (execution_id);
