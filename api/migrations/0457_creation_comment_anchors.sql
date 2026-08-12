ALTER TABLE creation_session_comments
  ADD COLUMN IF NOT EXISTS anchor jsonb;

CREATE INDEX IF NOT EXISTS idx_creation_comments_anchor
  ON creation_session_comments USING gin (anchor)
  WHERE anchor IS NOT NULL;
