-- 0023 · `brain_chat_steps` — a Brain run's steps (tool calls, LLM turns, memory steps)
-- on the OPERATIONAL endpoint. Mirror: migrations/1276.
--
-- Steps used to be `role:'tool'` rows in core's `brain_chat_messages` ("the single store
-- for run steps", migration 1212). They are run telemetry — written at every tool call —
-- and had grown to 148 MB of a 225 MB transcript table on a 512 MB core. The write path
-- (`appendRaw`, the VS Code sync importer) now routes them here; the transcript read
-- merges them back, so clients still receive them as `role:'tool'` messages.
--
-- No foreign keys: `tenant_id` / `chat_id` name core rows across databases
-- (siblingCascade.ts performs the tenant delete). Ids start at 1e12 so a step id can
-- never equal a `brain_chat_messages` id — clients dedupe the merged transcript by id.

CREATE SEQUENCE IF NOT EXISTS brain_chat_steps_id_seq START WITH 1000000000000;

CREATE TABLE IF NOT EXISTS brain_chat_steps (
  id          BIGINT PRIMARY KEY DEFAULT nextval('brain_chat_steps_id_seq'),
  tenant_id   INTEGER NOT NULL,
  chat_id     INTEGER NOT NULL,
  metadata    TEXT NOT NULL,
  event_key   VARCHAR(160),
  created_at  TIMESTAMP NOT NULL DEFAULT now()
);
ALTER SEQUENCE brain_chat_steps_id_seq OWNED BY brain_chat_steps.id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_brain_chat_steps_event ON brain_chat_steps (chat_id, event_key) WHERE event_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_brain_chat_steps_chat_created ON brain_chat_steps (chat_id, created_at);
CREATE INDEX IF NOT EXISTS idx_brain_chat_steps_tenant ON brain_chat_steps (tenant_id);
