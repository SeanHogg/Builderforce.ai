-- Unified artifact likes table (skills, personas, content)
CREATE TABLE IF NOT EXISTS artifact_likes (
  user_id        VARCHAR(36)  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  artifact_type  artifact_type NOT NULL,
  artifact_slug  VARCHAR(255) NOT NULL,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, artifact_type, artifact_slug)
);

CREATE INDEX idx_artifact_likes_type_slug ON artifact_likes (artifact_type, artifact_slug);
