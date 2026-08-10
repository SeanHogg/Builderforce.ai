-- Count anonymous guest usage per user submit, not per internal model/tool-loop call.
ALTER TABLE marketing_sessions
  ADD COLUMN IF NOT EXISTS guest_chat_turn_id VARCHAR(128),
  ADD COLUMN IF NOT EXISTS guest_chat_turn_fingerprint VARCHAR(64);

-- Existing same-day counts cannot be separated into real submits versus the
-- incorrectly charged internal iterations. Give affected guests a clean slate.
UPDATE marketing_sessions
SET guest_chat_day = NULL,
    guest_chat_count = 0,
    guest_chat_tokens = 0,
    guest_chat_turn_id = NULL,
    guest_chat_turn_fingerprint = NULL
WHERE guest_chat_day = CURRENT_DATE;
