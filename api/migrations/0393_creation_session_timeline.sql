-- Session-owned conversation timeline. Conversation is durable even when every
-- Chat placement is removed from the Canvas.
CREATE TABLE IF NOT EXISTS creation_session_timeline (
  id BIGSERIAL PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES creation_sessions(id) ON DELETE CASCADE,
  client_message_id VARCHAR(128) NOT NULL,
  message_role VARCHAR(16) NOT NULL CHECK (message_role IN ('user', 'assistant', 'system')),
  body TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_creation_timeline_session_id
  ON creation_session_timeline(session_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_creation_timeline_message
  ON creation_session_timeline(session_id, client_message_id);

-- Older Canvas clients accidentally stored renderer/action labels in the
-- semantic kind column. Normalize those rows before strict contract validation.
UPDATE creation_session_connections SET kind = CASE
  WHEN kind IN ('data', 'control', 'reference', 'presentation', 'delivery', 'membership') THEN kind
  WHEN kind IN ('visualizes', 'measures') THEN 'data'
  WHEN kind IN ('publishes', 'runs', 'triggers') THEN 'control'
  WHEN kind IN ('delivers', 'assigned') THEN 'delivery'
  WHEN kind IN ('contains', 'joins') THEN 'membership'
  ELSE 'reference'
END;

DO $$
BEGIN
  ALTER TABLE creation_session_connections
    ADD CONSTRAINT creation_session_connections_kind_check
    CHECK (kind IN ('data', 'control', 'reference', 'presentation', 'delivery', 'membership'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
