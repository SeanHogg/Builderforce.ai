-- 1276 · `brain_chat_steps` — PRIMARY mirror of transactional-migrations/0023 (see that
-- file for the reasoning). In production the table is written on the operational
-- endpoint only and this copy stays empty; it exists so an environment with ONE
-- database (local, tests), where the operational handle resolves to core, has it.

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
