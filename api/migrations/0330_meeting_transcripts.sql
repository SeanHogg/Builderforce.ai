-- 0330_meeting_transcripts.sql
-- Meeting recording/transcription + AI minutes, and live agent voice presence.
--
-- Two coupled additions on top of 0292 (meetings):
--
--   1. meeting_transcript_segments — the running transcript of a live meeting.
--      Each row is one spoken line: a human line captured client-side (browser
--      SpeechRecognition, broadcast + persisted), or an AGENT line produced by an
--      LLM turn (with optional synthesized TTS audio stored in R2). Ordered by
--      `at_ms` (ms since the meeting started) so the transcript reads in sequence.
--      This is the raw material the post-meeting AI summary (minutes) is built from
--      and the searchable meeting history.
--
--   2. meetings.summary / summary_generated_at — the generated minutes (a short
--      recap + decisions + action items), also posted into the linked team chat
--      (meetings.chat_id → brain_chat_messages) as the durable artifact.
--
-- Idempotent: CREATE TABLE / ADD COLUMN IF NOT EXISTS throughout.

-- 1. Transcript segments -----------------------------------------------------
CREATE TABLE IF NOT EXISTS meeting_transcript_segments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  meeting_id    UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  speaker_ref   VARCHAR(64) NOT NULL,                   -- users.id / ide_agents.id
  speaker_name  VARCHAR(255) NOT NULL,
  speaker_kind  VARCHAR(16) NOT NULL DEFAULT 'human',   -- human|agent
  text          TEXT NOT NULL,
  -- Milliseconds since the meeting started — the transcript ordering key (a live
  -- caption arrives out of DB-insert order across peers, so we sort on this).
  at_ms         BIGINT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Transcript for a meeting, in spoken order.
CREATE INDEX IF NOT EXISTS idx_meeting_transcript_meeting
  ON meeting_transcript_segments(meeting_id, at_ms);

-- 2. Generated minutes on the meeting ----------------------------------------
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS summary TEXT;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS summary_generated_at TIMESTAMPTZ;
