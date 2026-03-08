-- Unified project chats: same table for Brain Storm, IDE, and project-level chat.
-- origin = 'brainstorm' | 'ide' | 'project' tells the page which tools/actions to load.
ALTER TABLE ide_project_chats
  ADD COLUMN IF NOT EXISTS origin VARCHAR(32) NOT NULL DEFAULT 'ide',
  ADD COLUMN IF NOT EXISTS user_id VARCHAR(36) NULL REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE ide_project_chat_messages
  ADD COLUMN IF NOT EXISTS metadata TEXT NULL;

-- Allow Brain Storm chats without a project (optional project tie-in)
ALTER TABLE ide_project_chats
  ALTER COLUMN project_id DROP NOT NULL;

-- Optional summary for brainstorm chats (replaces chat_memories for unified chats)
ALTER TABLE ide_project_chats
  ADD COLUMN IF NOT EXISTS summary TEXT NULL;

-- Archive flag (Brain: "delete" = archive; can still list unarchived)
ALTER TABLE ide_project_chats
  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_ide_project_chats_origin ON ide_project_chats(origin);
CREATE INDEX IF NOT EXISTS idx_ide_project_chats_user_id ON ide_project_chats(user_id);
