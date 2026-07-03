-- 0272_rename_unified_chats_to_brain_chats.sql
-- Make the chats table name honest.
--
-- Since migration 0026 (`unified_project_chats_origin`), ONE table has served
-- Brain Storm + IDE + project chat, discriminated by an `origin` column — but it
-- kept the misleading name `ide_project_chats` from when it started life IDE-only.
-- The original Brain-only table `brain_chats` (0018) was superseded by it and is
-- now dead (no live reader/writer after the MCP brain.* tools were repointed).
--
-- This migration:
--   1. Drops the dead legacy tables `brain_messages` + `brain_chats`.
--   2. Renames the unified table `ide_project_chats` → `brain_chats` (and its
--      messages table → `brain_chat_messages`) so the name matches reality: the
--      all-modality Brain chat store. FKs, the merge pointer, and the ticket links
--      follow the rename automatically.
--   3. Refreshes the segment-default trigger + index names to the new table name.

-- 1. Drop the dead legacy Brain tables ---------------------------------------
--    `chat_memories.chat_id` FK'd the old brain_chats; that FK is vestigial (chat
--    memories key on agent_host_session_id in practice). CASCADE drops the dangling
--    FK constraint only — chat_memories rows/data are untouched.
DROP TABLE IF EXISTS brain_messages CASCADE;
DROP TABLE IF EXISTS brain_chats CASCADE;

-- 2. Rename the unified, all-modality chat store to an honest name -------------
ALTER TABLE IF EXISTS ide_project_chats          RENAME TO brain_chats;
ALTER TABLE IF EXISTS ide_project_chat_messages  RENAME TO brain_chat_messages;

-- 3. Refresh the segment-default trigger + indexes onto the new name ----------
DROP TRIGGER IF EXISTS trg_ide_project_chats_segment ON brain_chats;
DROP TRIGGER IF EXISTS trg_brain_chats_segment       ON brain_chats;
CREATE TRIGGER trg_brain_chats_segment BEFORE INSERT ON brain_chats
  FOR EACH ROW EXECUTE FUNCTION set_default_segment_id();

ALTER INDEX IF EXISTS idx_ide_project_chats_origin     RENAME TO idx_brain_chats_origin;
ALTER INDEX IF EXISTS idx_ide_project_chats_user_id    RENAME TO idx_brain_chats_user_id;
ALTER INDEX IF EXISTS idx_ide_project_chats_segment    RENAME TO idx_brain_chats_segment;
ALTER INDEX IF EXISTS idx_ide_project_chats_project_id RENAME TO idx_brain_chats_project_id;
