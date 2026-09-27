-- Serves GET /api/brain/chats/:id/files ("this chat's changes" in the VS Code
-- ticket rail): work deltas looked up by tenant + chat.
CREATE INDEX IF NOT EXISTS idx_work_deltas_tenant_chat
  ON work_deltas(tenant_id, chat_id)
  WHERE chat_id IS NOT NULL;
