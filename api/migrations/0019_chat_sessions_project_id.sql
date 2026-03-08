-- Add optional project linkage to claw chat sessions
ALTER TABLE chat_sessions
  ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_chat_sessions_project ON chat_sessions(tenant_id, project_id);

-- Extend chat_memories to support claw session summaries (not just brain chat summaries)
ALTER TABLE chat_memories
  ALTER COLUMN chat_id DROP NOT NULL;

ALTER TABLE chat_memories
  ADD COLUMN IF NOT EXISTS claw_session_id INTEGER REFERENCES chat_sessions(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_memories_claw_session ON chat_memories(claw_session_id) WHERE claw_session_id IS NOT NULL;
