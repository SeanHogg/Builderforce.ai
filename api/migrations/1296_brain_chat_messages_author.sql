-- 1296 · The author of a human message is a fact of the message (PRD 42 Part E).
--
-- `brain_chat_messages.author_user_id` is the user who sent a role='user' message, stamped
-- server-side from the authenticated caller (never from the request body). It lets a shared
-- chat tell "mine" from "a teammate's" so a teammate's message can be translated for the viewer.
-- Mirrors `brain_chats.user_id` (varchar(36), FK users ON DELETE SET NULL).
--
-- NULL for assistant / agent / system / tool rows, for machine callers, and for every row written
-- before this. NULL means "unknown author": the client never translates it.
--
-- Expand only: one nullable column, no default, no backfill. The old Worker's INSERT never
-- names it and its SELECTs never read it. Idempotent / re-runnable; reversible by DROP COLUMN.
-- The FK is added NOT VALID (no table scan under lock; there are no rows to violate it) and
-- the index is a plain build: scripts/migrate.mjs applies each file inside one transaction.
SET LOCAL lock_timeout = '3s';

ALTER TABLE brain_chat_messages
  ADD COLUMN IF NOT EXISTS author_user_id VARCHAR(36) NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'brain_chat_messages_author_user_id_fkey') THEN
    ALTER TABLE brain_chat_messages
      ADD CONSTRAINT brain_chat_messages_author_user_id_fkey
      FOREIGN KEY (author_user_id) REFERENCES users(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS brain_chat_messages_author_user_id_idx
  ON brain_chat_messages (author_user_id) WHERE author_user_id IS NOT NULL;
