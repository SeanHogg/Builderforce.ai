-- Add execution attribution to support session-level execution timelines.
ALTER TABLE executions
ADD COLUMN IF NOT EXISTS claw_id INTEGER REFERENCES coderclaw_instances(id) ON DELETE SET NULL;

ALTER TABLE executions
ADD COLUMN IF NOT EXISTS session_id VARCHAR(128);

CREATE INDEX IF NOT EXISTS executions_claw_idx ON executions (claw_id);
CREATE INDEX IF NOT EXISTS executions_session_idx ON executions (session_id);
CREATE INDEX IF NOT EXISTS executions_tenant_session_idx ON executions (tenant_id, session_id);
