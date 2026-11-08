-- 1329 · Signed provenance for every synthesized voice clip (expand-only).
--
-- One row per clip, whichever engine made it: the server-signed manifest (stored
-- verbatim, it is what the HMAC covers) plus the two ways a stranger finds it —
-- the SHA-256 of the clip's PCM16 bytes and the 64-bit watermark id embedded in
-- the audio. A new kind of provenance elsewhere is a column value, not a table;
-- this table is voice-specific because its lookup keys are.
CREATE TABLE IF NOT EXISTS voice_clip_provenance (
  id            UUID PRIMARY KEY,
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- SET NULL, not CASCADE: a signed provenance record must outlive the deletion of its voice
  -- (a clip circulating in the wild still verifies, as "voice deleted").
  clone_id      INTEGER REFERENCES studio_voice_clones(id) ON DELETE SET NULL,
  -- The voice's name when the clip was made, so the record is meaningful after the clone is gone.
  voice_name    VARCHAR(200),
  voiceover_id  INTEGER REFERENCES studio_voiceovers(id) ON DELETE SET NULL,
  engine        VARCHAR(32) NOT NULL,
  audio_sha256  VARCHAR(64) NOT NULL,
  watermark_id  VARCHAR(16) NOT NULL,
  watermarked   BOOLEAN NOT NULL DEFAULT TRUE,
  manifest      JSONB NOT NULL,
  signature     VARCHAR(128) NOT NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_voice_clip_provenance_watermark ON voice_clip_provenance (watermark_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_voice_clip_provenance_voiceover ON voice_clip_provenance (voiceover_id);
CREATE INDEX IF NOT EXISTS idx_voice_clip_provenance_audio ON voice_clip_provenance (audio_sha256);
CREATE INDEX IF NOT EXISTS idx_voice_clip_provenance_clone ON voice_clip_provenance (clone_id);
