-- 0332_brain_chat_trace.sql
-- Persist the Brain chat TOOL/LLM-turn timeline so it survives a reload.
--
-- A Brain run streams trace events (llm | tool | message | recall | learn |
-- reconcile | error) that the webview renders as the "thinking" / tool-call
-- timeline. Until now those events lived only in the browser, so reopening a
-- chat lost every tool turn. This table stores them append-only, one row per
-- event, so the frontend can GET /api/brain/chats/:id/trace and rehydrate the
-- timeline on chat load.
--
-- Idempotent: CREATE ... IF NOT EXISTS. Cascades with the chat.

CREATE TABLE IF NOT EXISTS brain_chat_trace (
  id          SERIAL PRIMARY KEY,
  chat_id     INTEGER NOT NULL REFERENCES brain_chats(id) ON DELETE CASCADE,
  turn_seq    INTEGER,                                  -- per-run turn ordinal
  kind        VARCHAR(24) NOT NULL,                     -- llm|tool|message|recall|learn|reconcile|error
  label       VARCHAR(120),                             -- tool name / model id / step name
  args_json   TEXT,                                     -- JSON-as-text call arguments
  result_json TEXT,                                     -- JSON-as-text result
  is_error    BOOLEAN NOT NULL DEFAULT FALSE,
  duration_ms INTEGER,                                  -- full-step wall time (ms)
  ttft_ms     INTEGER,                                  -- time-to-first-token (ms) for llm steps
  created_at  TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brain_chat_trace_chat ON brain_chat_trace(chat_id, id);
