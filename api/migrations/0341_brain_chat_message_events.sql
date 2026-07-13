-- Atomic idempotency for messages produced by execution lifecycle events.
-- NULL remains allowed for ordinary user/assistant turns.
ALTER TABLE brain_chat_messages
  ADD COLUMN IF NOT EXISTS event_key VARCHAR(160);

CREATE UNIQUE INDEX IF NOT EXISTS uq_brain_chat_messages_event
  ON brain_chat_messages(chat_id, event_key)
  WHERE event_key IS NOT NULL;
