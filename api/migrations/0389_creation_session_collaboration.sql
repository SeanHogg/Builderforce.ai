-- Forward-only collaboration upgrade for Creation Sessions.
-- 0388 may already be recorded as applied in production, so presence/comments
-- must be introduced in a new migration rather than by editing its old body.

ALTER TABLE creation_session_members
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_creation_members_presence
  ON creation_session_members(session_id, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS creation_session_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES creation_sessions(id) ON DELETE CASCADE,
  object_id UUID REFERENCES creation_session_objects(id) ON DELETE SET NULL,
  parent_comment_id UUID REFERENCES creation_session_comments(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 5000),
  mentions JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  resolved_by VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_creation_comments_session
  ON creation_session_comments(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_creation_comments_object
  ON creation_session_comments(object_id, created_at DESC)
  WHERE object_id IS NOT NULL;
