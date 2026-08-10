-- Interactive editor and Brain work stays available while autonomous tenant agent
-- execution is stopped. Existing and direct-write executions remain governed.
ALTER TABLE executions
  ADD COLUMN IF NOT EXISTS source varchar(16) NOT NULL DEFAULT 'agent';

CREATE INDEX IF NOT EXISTS idx_executions_tenant_source_live
  ON executions (tenant_id, source, status)
  WHERE status IN ('pending', 'submitted', 'running', 'paused');
