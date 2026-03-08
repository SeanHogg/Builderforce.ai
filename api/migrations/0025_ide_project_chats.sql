-- IDE project chats: persisted AI assistant threads per project
CREATE TABLE IF NOT EXISTS ide_project_chats (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title VARCHAR(500) NOT NULL DEFAULT 'New chat',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ide_project_chat_messages (
  id SERIAL PRIMARY KEY,
  chat_id INTEGER NOT NULL REFERENCES ide_project_chats(id) ON DELETE CASCADE,
  role VARCHAR(16) NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  seq INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ide_project_chats_project_id ON ide_project_chats(project_id);
CREATE INDEX IF NOT EXISTS idx_ide_project_chats_tenant_id ON ide_project_chats(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ide_project_chat_messages_chat_id ON ide_project_chat_messages(chat_id);
