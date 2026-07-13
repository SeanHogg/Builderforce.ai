-- Guest Brain/Ideas chat usage counters on the anonymous lead row.
--
-- A LOGGED-OUT visitor can now try the Brain/Ideas chat before signing up (a
-- top-of-funnel adoption lever). We meter their usage per UTC day on the SAME
-- marketing_sessions lead row so a guest chatter is tracked as an active lead
-- and convert() stamps them the moment they sign up. Per-IP metering (the
-- spoof backstop) is KV-side + ephemeral; these columns are the durable
-- per-visitor counter and give analytics on guest engagement.
ALTER TABLE marketing_sessions
  ADD COLUMN IF NOT EXISTS guest_chat_day    date,
  ADD COLUMN IF NOT EXISTS guest_chat_count  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS guest_chat_tokens integer NOT NULL DEFAULT 0;
