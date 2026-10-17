-- 1231 · Composite (chat_id, seq) index on brain_chat_messages.
--
-- `unreadCountsForUser` (application/brain/chatReadState.ts) counts, per chat the user
-- has read, the messages with `seq > last_read_seq`. With only a chat_id index the
-- planner chose a Seq Scan of the whole table (~84k rows) on every attention poll —
-- the single largest row reader on core, and a reason the endpoint never autosuspends.
-- (chat_id, seq) turns each per-chat count into an index range scan, and also serves
-- `markChatRead`'s `max(seq) WHERE chat_id = $1` as a single index probe.
--
-- The chat_id-only index (created in 0025 as idx_ide_project_chat_messages_chat_id,
-- before the 0272 table rename) is a strict prefix of the new one, so every chat_id
-- lookup — including the ON DELETE CASCADE from brain_chats — is still covered. It is
-- dropped so writes stop maintaining a redundant btree.
--
-- Not CONCURRENTLY: scripts/migrate.mjs applies each file inside one transaction, and
-- the table is small enough that a plain build holds its lock only briefly.
CREATE INDEX IF NOT EXISTS idx_brain_chat_messages_chat_seq ON brain_chat_messages (chat_id, seq);
DROP INDEX IF EXISTS idx_ide_project_chat_messages_chat_id;
