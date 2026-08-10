-- Durable command/history and per-member collaboration state.

ALTER TABLE creation_session_members
  ADD COLUMN IF NOT EXISTS viewport JSONB NOT NULL DEFAULT '{"x":0,"y":0,"zoom":1}'::jsonb,
  ADD COLUMN IF NOT EXISTS cursor JSONB,
  ADD COLUMN IF NOT EXISTS selection JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS typing BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS creation_session_snapshots (
  session_id UUID NOT NULL REFERENCES creation_sessions(id) ON DELETE CASCADE,
  revision BIGINT NOT NULL,
  graph JSONB NOT NULL,
  viewport JSONB NOT NULL DEFAULT '{"x":0,"y":0,"zoom":1}'::jsonb,
  label VARCHAR(120),
  created_by VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(session_id, revision)
);

CREATE INDEX IF NOT EXISTS idx_creation_snapshots_session_created
  ON creation_session_snapshots(session_id, created_at DESC);

ALTER TABLE creation_session_snapshots ADD COLUMN IF NOT EXISTS label VARCHAR(120);
